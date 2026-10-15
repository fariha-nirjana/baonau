import type { Address } from "viem";

/**
 * The parts of commitments that the screens need too: the types and the
 * status rule. No server imports here, so the browser can load it.
 */

export type CommitmentKind = "rent" | "bill" | "tuition" | "family" | "savings" | "other";
export const COMMITMENT_KINDS: CommitmentKind[] = ["rent", "bill", "tuition", "family", "savings", "other"];

export type CommitmentMeta = {
  name: string;
  kind: CommitmentKind;
  /** Who gets paid, as people say it. Null for money set aside with nobody to pay. */
  payeeName: string | null;
  /** True: a due payment goes out by itself. False: the owner is asked each time. */
  autopay: boolean;
};

/** One commitment as the vault and the mandate report it, amounts in tUSD. */
export type CommitmentView = {
  id: number;
  /** Null for money set aside with nobody to pay. */
  payee: Address | null;
  maxAmount: string;
  periodSeconds: number;
  windowSeconds: number;
  nextDue: string | null;
  active: boolean;
  reserved: string;
  /** When the agent may pay the next due date: the due date minus the window. */
  payableFrom: string | null;
  /** New terms that raise risk and are waiting out the delay. */
  pending: (Omit<CommitmentView, "id" | "reserved" | "pending" | "pendingRelease" | "payableFrom"> & { appliesFrom: string }) | null;
  /** Money asked to go back into investing, waiting out the delay. */
  pendingRelease: { amount: string; appliesFrom: string } | null;
};

// ---------------------------------------------------------------- status

export type CommitmentStatus =
  /** A new payee or new terms waiting out the delay; nothing can be paid yet. */
  | { kind: "waiting"; appliesFrom: string }
  /** Removed, or a single payment that has been made. */
  | { kind: "closed" }
  /** Money set aside with nobody to pay. */
  | { kind: "reserved" }
  /** Less set aside than the next payment needs. */
  | { kind: "needs_funding"; shortBy: number; dueSoon: boolean }
  /** Funded, and the due window is open. */
  | { kind: "due" }
  /** Funded, waiting for the due window. */
  | { kind: "ready" };

/** What the owner sees on a commitment's card. Plain code, so it can be tested. */
export function statusOf(c: CommitmentView, now: Date): CommitmentStatus {
  if (!c.active) return c.pending?.active ? { kind: "waiting", appliesFrom: c.pending.appliesFrom } : { kind: "closed" };
  if (!c.payee) return { kind: "reserved" };
  const open = c.payableFrom !== null && now.getTime() >= new Date(c.payableFrom).getTime();
  const short = Number(c.maxAmount) - Number(c.reserved);
  if (short > 1e-6) return { kind: "needs_funding", shortBy: Math.round(short * 1e6) / 1e6, dueSoon: open };
  return open ? { kind: "due" } : { kind: "ready" };
}


/**
 * A payment the agent may not make alone: not due yet, prompted by outside
 * text, or set to "ask each time". The owner pays it with their own key, which
 * the vault allows at any time, and it counts for the current due date.
 */
export type PaymentRequest = {
  id: string;
  createdAt: string;
  commitment: number;
  /** tUSD */
  amount: string;
  reason: string;
  /** The due date this request is for, so the scheduler asks once per date. */
  forDue: string | null;
  status: "waiting" | "paid" | "dismissed" | "failed";
  tx?: string;
  note?: string;
};

