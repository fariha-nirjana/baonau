import { parseUnits } from "viem";
import blocklistFile from "../config/blocklist.json";
import type { AuditEntry } from "./audit";
import type { Bill } from "./bills";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import type { Mandate, Overview } from "./wallet";

/**
 * Layer 2: the off-chain policy engine.
 *
 * It checks what the agent wants to do before anything is signed, and it is plain
 * code with no model in it. It covers what the contract cannot know (screening
 * lists, spending patterns, where an instruction came from). The contract still
 * enforces the hard limits if this layer is bypassed.
 */

export type Action =
  | { kind: "pay"; mandateId: number; amount: string; billId?: string }
  | { kind: "request_approval"; mandateId: number; amount: string }
  | { kind: "propose_payee"; payee: string }
  | { kind: "move_funds"; from: number; to: number; amount: string };

export type PastPayment = { at: Date; mandateId: number; amount: string };
export type BlockEntry = { address: string; label: string };

export type Facts = {
  overview: Overview;
  mandates: Mandate[];
  history: PastPayment[];
  /** What the owner expects to pay. */
  bills: Bill[];
  blocklist: BlockEntry[];
  now: Date;
  /** True when the instruction came from a document or message the owner did not write. */
  untrusted: boolean;
};

export type Outcome = "pass" | "escalate" | "block";
export type Check = { id: string; outcome: Outcome; detail: string };

export type Verdict = {
  /** allow: sign it. escalate: send to the owner for approval. block: do nothing. */
  decision: "allow" | "escalate" | "block";
  checks: Check[];
  explanation: string;
};

export const UNUSUAL_MULTIPLE = 2n;
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
export const VELOCITY_MAX_PAYMENTS = 5;

const units = (amount: string) => parseUnits(amount, TOKEN_DECIMALS);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const money = (amount: string) => `${amount} ${TOKEN_SYMBOL}`;

export function defaultBlocklist(): BlockEntry[] {
  return blocklistFile.entries;
}

/** Successful payments from the audit log, as the history the pattern checks compare against. */
export function historyFromAudit(entries: AuditEntry[]): PastPayment[] {
  return entries
    .filter((e) => e.record.tool === "pay" && (e.result as { ok?: boolean; escalated?: boolean })?.ok === true)
    .filter((e) => !(e.result as { escalated?: boolean }).escalated)
    .map((e) => ({
      at: new Date(e.record.at),
      mandateId: Number(e.record.args.mandate_id),
      amount: String(e.record.args.amount),
    }));
}

function screen(address: string, facts: Facts): Check {
  const hit = facts.blocklist.find((b) => same(b.address, address));
  return hit
    ? { id: "screening", outcome: "block", detail: `The payee is on the screening list: ${hit.label}.` }
    : { id: "screening", outcome: "pass", detail: "The payee is not on the screening list." };
}

function checkPayment(
  action: { mandateId: number; amount: string; billId?: string },
  facts: Facts,
  direct: boolean,
): Check[] {
  const mandate = facts.mandates.find((m) => m.id === action.mandateId);
  if (!mandate || mandate.status !== "approved") {
    return [{ id: "mandate", outcome: "block", detail: `Mandate ${action.mandateId} is not an approved payee.` }];
  }

  const checks: Check[] = [];
  const amount = units(action.amount);
  checks.push(screen(mandate.payee, facts));

  if (!mandate.active) {
    checks.push({
      id: "mandate",
      outcome: "block",
      detail: `"${mandate.purpose}" is not payable yet. Its waiting period ends ${mandate.activeFrom}, and it expires ${mandate.expiry}.`,
    });
  } else {
    checks.push({ id: "mandate", outcome: "pass", detail: `"${mandate.purpose}" is an approved, active payee.` });
  }

  // an approval request is allowed to exceed the agent's limits, that is its purpose
  if (direct) {
    const limits: [string, string][] = [
      ["the per-payment limit", facts.overview.limits.perPayment],
      ["what is left of today's limit", facts.overview.limits.leftToday],
      ["what is left under this mandate for the period", mandate.remainingThisPeriod],
    ];
    const over = limits.find(([, limit]) => amount > units(limit));
    checks.push(
      over
        ? { id: "limits", outcome: "escalate", detail: `${money(action.amount)} is above ${over[0]} (${money(over[1])}).` }
        : { id: "limits", outcome: "pass", detail: "The amount is within the agent's limits." },
    );

    const bucket = facts.overview.buckets.find((b) => b.id === mandate.bucket);
    if (bucket && amount > units(bucket.balance)) {
      checks.push({
        id: "budget",
        outcome: "block",
        detail: `The ${bucket.name} bucket holds ${money(bucket.balance)}. Move funds into it first.`,
      });
    }
  }

  const past = facts.history.filter((p) => p.mandateId === mandate.id);
  if (past.length >= 2) {
    const largest = past.reduce((max, p) => (units(p.amount) > max ? units(p.amount) : max), 0n);
    checks.push(
      amount > largest * UNUSUAL_MULTIPLE
        ? {
            id: "unusual_amount",
            outcome: "escalate",
            detail: `${money(action.amount)} is more than twice the largest earlier payment to this payee.`,
          }
        : { id: "unusual_amount", outcome: "pass", detail: "The amount is in line with earlier payments." },
    );
  }

  const duplicate = past.find(
    (p) => units(p.amount) === amount && facts.now.getTime() - p.at.getTime() < DUPLICATE_WINDOW_MS,
  );
  if (duplicate) {
    checks.push({
      id: "duplicate",
      outcome: "escalate",
      detail: `The same amount was already paid to this payee at ${duplicate.at.toISOString()}.`,
    });
  }

  const recent = facts.history.filter((p) => facts.now.getTime() - p.at.getTime() < VELOCITY_WINDOW_MS);
  if (recent.length >= VELOCITY_MAX_PAYMENTS) {
    checks.push({
      id: "velocity",
      outcome: "block",
      detail: `${recent.length} payments in the last 10 minutes. Payments are paused for a cooldown.`,
    });
  }

  let expected = false;
  if (action.billId !== undefined) {
    const bill = facts.bills.find((b) => b.id === action.billId);
    if (!bill) {
      checks.push({ id: "bill", outcome: "block", detail: `There is no bill "${action.billId}".` });
    } else if (bill.status !== "due") {
      checks.push({ id: "bill", outcome: "block", detail: `"${bill.label}" is already ${bill.status}.` });
    } else if (bill.mandateId !== mandate.id || units(bill.amount) !== amount) {
      checks.push({
        id: "bill",
        outcome: "block",
        detail: `"${bill.label}" is for ${money(bill.amount)} under mandate ${bill.mandateId}, which does not match this payment.`,
      });
    } else {
      expected = true;
      checks.push({ id: "bill", outcome: "pass", detail: `Matches the expected bill "${bill.label}", due ${bill.dueDate}.` });
    }
  }

  // The agent may act alone on a document only when it agrees with a bill the owner already expects.
  if (facts.untrusted && direct && !expected) {
    checks.push({
      id: "source",
      outcome: "escalate",
      detail: "This payment was triggered by a document and matches no expected bill, so the owner must confirm it.",
    });
  }

  return checks;
}

function checkNewPayee(action: { payee: string }, facts: Facts): Check[] {
  const checks = [screen(action.payee, facts)];

  // address poisoning: an address built to look like one the user already pays
  const known = facts.mandates.filter((m) => m.status === "approved");
  if (known.some((m) => same(m.payee, action.payee))) {
    checks.push({ id: "lookalike", outcome: "block", detail: "This address is already an approved payee." });
  } else {
    const twin = known.find(
      (m) =>
        same(m.payee.slice(0, 6), action.payee.slice(0, 6)) && same(m.payee.slice(-4), action.payee.slice(-4)),
    );
    if (twin) {
      checks.push({
        id: "lookalike",
        outcome: "block",
        detail: `This address starts and ends like the approved payee "${twin.purpose}" but is a different address.`,
      });
    }
  }

  if (facts.untrusted) {
    checks.push({
      id: "source",
      outcome: "pass",
      detail: "Suggested by a document. The owner must approve it and the waiting period applies.",
    });
  }
  return checks;
}

export function evaluate(action: Action, facts: Facts): Verdict {
  let checks: Check[];
  switch (action.kind) {
    case "pay":
      checks = checkPayment(action, facts, true);
      break;
    case "request_approval":
      checks = checkPayment(action, facts, false);
      break;
    case "propose_payee":
      checks = checkNewPayee(action, facts);
      break;
    case "move_funds":
      checks = [{ id: "budgeting", outcome: "pass", detail: "Moving money between buckets keeps it in the wallet." }];
      break;
  }

  const decision = checks.some((c) => c.outcome === "block")
    ? "block"
    : checks.some((c) => c.outcome === "escalate")
      ? "escalate"
      : "allow";

  const reasons = checks.filter((c) => c.outcome === (decision === "allow" ? "pass" : decision)).map((c) => c.detail);
  const lead = { allow: "Allowed.", escalate: "Needs the owner's approval.", block: "Blocked." }[decision];
  return { decision, checks, explanation: `${lead} ${reasons.join(" ")}` };
}
