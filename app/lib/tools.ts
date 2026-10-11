import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { appendAudit, refOf, type AuditRecord } from "./audit";
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
  pay: z.object({ mandate_id: id, amount, reason }),
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
  send?: SendOptions;
};

async function write(
  tool: ToolName,
  args: Record<string, unknown>,
  why: string,
  ctx: ToolContext,
  build: (ref: `0x${string}`) => AgentCall,
) {
  const record: AuditRecord = { at: new Date().toISOString(), tool, args, reason: why, source: ctx.source };
  const ref = refOf(record);
  const result = await sendAsAgent(build(ref), ctx.send);
  appendAudit({ ref, record, result });
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
      case "list_mandates":
        return await getMandates();
      case "pay": {
        const a = parsed.data as z.infer<typeof schemas.pay>;
        return await write(tool, a, a.reason, ctx, (ref) => ({
          functionName: "pay",
          args: [BigInt(a.mandate_id), toUnits(a.amount), ref],
        }));
      }
      case "move_funds": {
        const a = parsed.data as z.infer<typeof schemas.move_funds>;
        return await write(tool, a, a.reason, ctx, () => ({
          functionName: "moveFunds",
          args: [BigInt(a.from_bucket), BigInt(a.to_bucket), toUnits(a.amount)],
        }));
      }
      case "request_owner_approval": {
        const a = parsed.data as z.infer<typeof schemas.request_owner_approval>;
        return await write(tool, a, a.reason, ctx, (ref) => ({
          functionName: "requestPayment",
          args: [BigInt(a.mandate_id), toUnits(a.amount), ref],
        }));
      }
      case "propose_payee": {
        const a = parsed.data as z.infer<typeof schemas.propose_payee>;
        const expiry = BigInt(Math.floor(Date.now() / 1000) + a.valid_days * 86400);
        return await write(tool, a, a.reason, ctx, () => ({
          functionName: "proposeMandate",
          args: [
            a.payee_address as `0x${string}`,
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
