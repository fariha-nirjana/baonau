import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { appendAudit, readAudit, refOf, type AuditRecord } from "./audit";
import { readBills, updateBill } from "./bills";
import { chainConfig, TOKEN_SYMBOL } from "./config";
import payeeNames from "../config/payees.json";
import { defaultBlocklist, evaluate, historyFromAudit, type Action } from "./policy";
import { getMandates, getOverview, sendAsAgent, toUnits, type AgentCall, type SendOptions } from "./wallet";

const amount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "amount must be a plain decimal like 1500 or 12.50")
  .describe("Amount in tUSD as a decimal string, e.g. \"1500\" or \"12.50\"");
const id = z.number().int().nonnegative();
const reason = z.string().min(1).describe("One sentence on why you are doing this. It is stored in the audit log.");

const schemas = {
  get_wallet_overview: z.object({}),
  list_mandates: z.object({}),
  list_bills: z.object({}),
  pay: z.object({
    mandate_id: id,
    amount,
    bill_id: z.string().max(40).optional().describe("The id of the bill this pays, from list_bills, when there is one."),
    reason,
  }),
  move_funds: z.object({ from_bucket: id, to_bucket: id, amount, reason }),
  request_owner_approval: z.object({ mandate_id: id, amount, reason }),
  propose_payee: z.object({
    payee_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    purpose: z.string().min(1).max(80),
    bucket: id,
    cap_per_period: amount,
    period_days: z.number().int().min(1).max(366),
    valid_days: z.number().int().min(2).max(3660),
    reason,
  }),
} as const;

type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  get_wallet_overview: "Read the wallet: total balance, budget buckets, spending limits and how much is left today.",
  list_mandates:
    "List the payees the owner has approved. Each mandate has an id, a purpose, a cap per period and the bucket it pays from.",
  list_bills: "List the bills the owner expects to pay: which mandate, how much, the due date and whether it is paid.",
  pay: "Pay the payee of an approved mandate. You pay by mandate id. There is no way to pay an address directly.",
  move_funds:
    "Move money between budget buckets. Bucket 0 is unallocated money. You cannot take money out of a locked bucket.",
  request_owner_approval:
    "Ask the owner to approve a payment under an existing mandate that is above your limits. Nothing is paid until they approve.",
  propose_payee:
    "Suggest a new payee to the owner. It cannot be paid until the owner approves it and a waiting period has passed.",
};

export const toolDefs: ChatCompletionFunctionTool[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  // drop the $schema marker, which some OpenAI-compatible providers reject
  const parameters: Record<string, unknown> = { ...z.toJSONSchema(schemas[name]) };
  delete parameters.$schema;
  return { type: "function", function: { name, description: descriptions[name], parameters } };
});

export type ToolContext = {
  /** Where the current instruction came from, for the audit log. */
  source: string;
  /** True when the instruction came from a document or message the owner did not write. */
  untrusted?: boolean;
  /** Skip the off-chain policy engine. Only for showing that the contract holds without it. */
  bypassPolicy?: boolean;
  send?: SendOptions;
};

async function write(
  tool: ToolName,
  args: Record<string, unknown>,
  why: string,
  ctx: ToolContext,
  action: Action,
  build: (ref: `0x${string}`) => AgentCall,
) {
  const record: AuditRecord = {
    at: new Date().toISOString(),
    tool,
    args,
    reason: why,
    source: ctx.source,
    policy: null,
  };

  if (!ctx.bypassPolicy) {
    const [overview, mandates] = await Promise.all([getOverview(), getMandates()]);
    record.policy = evaluate(action, {
      overview,
      mandates,
      history: historyFromAudit(readAudit()),
      bills: readBills(),
      blocklist: defaultBlocklist(),
      now: new Date(),
      untrusted: ctx.untrusted ?? false,
    });
    if (action.kind === "pay" || action.kind === "request_approval") {
      const mandate = mandates.find((m) => m.id === action.mandateId);
      if (mandate) {
        record.transfer = {
          from: chainConfig().WALLET_ADDRESS,
          to: mandate.payee,
          purpose: mandate.purpose,
          amount: action.amount,
          asset: TOKEN_SYMBOL,
        };
      }
    }
  }

  const verdict = record.policy;
  const ref = refOf(record);

  if (verdict?.decision === "block") {
    const result = { ok: false, stage: "policy", message: verdict.explanation } as const;
    appendAudit({ ref, record, result });
    return { ...result, audit_ref: ref };
  }

  // A payment the policy engine will not let the agent make alone becomes a request to the owner.
  if (verdict?.decision === "escalate" && action.kind === "pay") {
    const sent = await sendAsAgent(
      { functionName: "requestPayment", args: [BigInt(action.mandateId), toUnits(action.amount), ref] },
      ctx.send,
    );
    const requestId = sent.ok ? sent.events.find((e) => e.name === "PaymentRequested")?.args.requestId : undefined;
    const result = sent.ok
      ? { ...sent, escalated: true, request_id: requestId, message: `Not paid. ${verdict.explanation} Request ${requestId} is waiting for the owner.` }
      : sent;
    appendAudit({ ref, record, result });
    if (sent.ok && action.billId) updateBill(action.billId, { status: "requested", tx: sent.hash });
    return { ...result, audit_ref: ref };
  }

  const result = await sendAsAgent(build(ref), ctx.send);
  appendAudit({ ref, record, result });
  if (result.ok && action.kind === "pay" && action.billId) updateBill(action.billId, { status: "paid", tx: result.hash });
  return { ...result, audit_ref: ref };
}

/** Runs one tool call from the model. Bad input comes back as an error result, never as a thrown exception. */
export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<unknown> {
  if (!(name in schemas)) return { ok: false, message: `Unknown tool: ${name}` };
  const tool = name as ToolName;

  let json: unknown;
  try {
    json = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, message: "Tool arguments were not valid JSON." };
  }
  const parsed = schemas[tool].safeParse(json);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  try {
    switch (tool) {
      case "get_wallet_overview":
        return await getOverview();
      case "list_mandates": {
        const names = payeeNames.byMandateId as Record<string, string>;
        return (await getMandates()).map((m) => ({ ...m, payeeName: names[String(m.id)] ?? null }));
      }
      case "list_bills":
        return readBills();
      case "pay": {
        const a = parsed.data as z.infer<typeof schemas.pay>;
        const action: Action = { kind: "pay", mandateId: a.mandate_id, amount: a.amount, billId: a.bill_id };
        return await write(tool, a, a.reason, ctx, action, (ref) => ({
          functionName: "pay",
          args: [BigInt(a.mandate_id), toUnits(a.amount), ref],
        }));
      }
      case "move_funds": {
        const a = parsed.data as z.infer<typeof schemas.move_funds>;
        const action: Action = { kind: "move_funds", from: a.from_bucket, to: a.to_bucket, amount: a.amount };
        return await write(tool, a, a.reason, ctx, action, () => ({
          functionName: "moveFunds",
          args: [BigInt(a.from_bucket), BigInt(a.to_bucket), toUnits(a.amount)],
        }));
      }
      case "request_owner_approval": {
        const a = parsed.data as z.infer<typeof schemas.request_owner_approval>;
        const action: Action = { kind: "request_approval", mandateId: a.mandate_id, amount: a.amount };
        return await write(tool, a, a.reason, ctx, action, (ref) => ({
          functionName: "requestPayment",
          args: [BigInt(a.mandate_id), toUnits(a.amount), ref],
        }));
      }
      case "propose_payee": {
        const a = parsed.data as z.infer<typeof schemas.propose_payee>;
        const expiry = BigInt(Math.floor(Date.now() / 1000) + a.valid_days * 86400);
        // lower case sidesteps checksum errors in addresses the model copied from a document
        const payee = a.payee_address.toLowerCase() as `0x${string}`;
        return await write(tool, a, a.reason, ctx, { kind: "propose_payee", payee }, () => ({
          functionName: "proposeMandate",
          args: [
            payee,
            BigInt(a.bucket),
            toUnits(a.cap_per_period),
            BigInt(a.period_days * 86400),
            expiry,
            a.purpose,
          ],
        }));
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
