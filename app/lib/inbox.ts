import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import payeeNames from "../config/payees.json";
import { runAgent, type AgentEvent } from "./agent";
import { readBills, type Bill } from "./bills";
import { defaultBlocklist, type BlockEntry } from "./policy";
import { readDocument, type DocumentFields, type ReadResult } from "./reader";
import { getMandates, type Mandate } from "./wallet";

/** Facts that plain code works out by comparing the document's fields with the wallet. */
export type DocumentChecks = {
  /** The mandate whose payee address equals the address in the document. */
  matchedMandateId: number | null;
  /** The mandate of a payee whose name the document claims to be from. */
  claimedSenderMandateId: number | null;
  /** The document uses a known payee's name but asks for payment to a different address. */
  payeeMismatch: boolean;
  /** An unpaid bill with the same mandate and the same amount. */
  matchedBillId: string | null;
  onScreeningList: boolean;
};

export const payeeName = (mandateId: number): string | null =>
  (payeeNames.byMandateId as Record<string, string>)[String(mandateId)] ?? null;

const lower = (s: string) => s.toLowerCase();

export function checkDocument(
  fields: DocumentFields,
  mandates: Mandate[],
  bills: Bill[],
  blocklist: BlockEntry[],
): DocumentChecks {
  const approved = mandates.filter((m) => m.status === "approved");
  const address = fields.payeeAddress ? lower(fields.payeeAddress) : null;

  const matched = address ? approved.find((m) => lower(m.payee) === address) : undefined;
  const sender = fields.senderName ? lower(fields.senderName) : null;
  const claimed = sender
    ? approved.find((m) => {
        const name = payeeName(m.id);
        return name !== null && (sender.includes(lower(name)) || lower(name).includes(sender));
      })
    : undefined;

  const billMandate = matched ?? (address ? undefined : claimed);
  const bill =
    billMandate && fields.amount
      ? bills.find(
          (b) => b.status === "due" && b.mandateId === billMandate.id && Number(b.amount) === Number(fields.amount),
        )
      : undefined;

  return {
    matchedMandateId: matched?.id ?? null,
    claimedSenderMandateId: claimed?.id ?? null,
    payeeMismatch: Boolean(claimed && address && lower(claimed.payee) !== address),
    matchedBillId: bill?.id ?? null,
    onScreeningList: Boolean(address && blocklist.some((b) => lower(b.address) === address)),
  };
}

export type DocumentRun = ReadResult & { checks: DocumentChecks; reply: string };

/**
 * Handles one incoming document end to end: the quarantined reader extracts
 * fields, code checks them against the wallet, and the agent decides what to do
 * from those fields alone. Anything it does is marked as triggered by a document.
 */
export async function handleDocument(
  text: string,
  label: string,
  onEvent?: (event: AgentEvent) => void,
): Promise<DocumentRun> {
  const read = await readDocument(text);
  const checks = checkDocument(read.fields, await getMandates(), readBills(), defaultBlocklist());

  const history: ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        "A document arrived for the wallet owner. You are not shown its text.",
        "A separate reader extracted the fields below, and code compared them with the wallet.",
        "",
        JSON.stringify({ fields: read.fields, checks }, null, 2),
        "",
        "Decide what to do. If it matches an unpaid bill, pay that bill and pass its bill_id.",
        "If payeeMismatch or onScreeningList is true, do not pay or propose anything, and warn the owner.",
        "Otherwise explain what the owner should look at.",
      ].join("\n"),
    },
  ];

  const reply = await runAgent(history, { ctx: { source: `document:${label}`, untrusted: true }, onEvent });
  return { ...read, checks, reply };
}
