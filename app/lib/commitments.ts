import { encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { chainConfig } from "./config";
import { readJson, writeJson } from "./store";

/**
 * Commitments: money with a job already (rent, bills, tuition, money sent
 * home). The chain holds what matters for safety: the payee, the most one
 * payment may be, the schedule, and the money set aside, which the agent can
 * never trade. This file holds what people read: a name, a kind, the payee's
 * name, and whether a due payment goes out by itself or waits for the owner.
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

const encoded = (label: string, id: number) => encodeAbiParameters([{ type: "string" }, { type: "uint256" }], [label, BigInt(id)]);
/** The key a waiting change to a commitment is filed under. Matches Mandate.commitmentKey. */
export const commitmentKey = (id: number): Hex => keccak256(encoded("commitment", id));
/** The key a waiting release is filed under. Matches Mandate.releaseKey. */
export const releaseKey = (id: number): Hex => keccak256(encoded("release", id));

/**
 * A testnet address for a payee name. Nobody holds its key, so test money
 * sent there simply stays there. Real payees would be real accounts.
 */
export function testnetPayee(name: string): Address {
  return getAddress(`0x${keccak256(toHex(`baonau testnet payee: ${name.trim().toLowerCase()}`)).slice(26)}`);
}

// ---------------------------------------------------------------- names and settings

const FILE = "commitments.json";
type Store = Record<string, Record<string, CommitmentMeta>>;

const vaultKey = () => chainConfig().VAULT_ADDRESS.toLowerCase();

export function readMeta(): Record<string, CommitmentMeta> {
  return readJson<Store>(FILE, {})[vaultKey()] ?? {};
}

export function writeMeta(id: number, meta: CommitmentMeta) {
  const all = readJson<Store>(FILE, {});
  all[vaultKey()] = { ...(all[vaultKey()] ?? {}), [String(id)]: meta };
  writeJson(FILE, all);
}

/** A name for a commitment that has none on file, for example one added from another device. */
export function fallbackMeta(c: CommitmentView): CommitmentMeta {
  return { name: `Commitment ${c.id}`, kind: c.payee ? "other" : "savings", payeeName: null, autopay: false };
}

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

// ---------------------------------------------------------------- finding one

/** Finds a commitment by its number or by a word from its name, payee or kind. */
export function findCommitment(views: CommitmentView[], query: string): { ok: true; commitment: CommitmentView } | { ok: false; message: string } {
  const meta = readMeta();
  const named = (c: CommitmentView) => meta[String(c.id)] ?? fallbackMeta(c);
  const q = query.trim().toLowerCase();
  const byNumber = views.find((c) => String(c.id) === q.replace(/^#/, ""));
  if (byNumber) return { ok: true, commitment: byNumber };
  const hits = views.filter((c) => {
    const m = named(c);
    return [m.name, m.payeeName ?? "", m.kind].some((s) => s.toLowerCase().includes(q) || (q.length > 2 && q.includes(s.toLowerCase()) && s.length > 2));
  });
  const live = hits.filter((c) => c.active || c.pending);
  const pick = live.length ? live : hits;
  if (pick.length === 1) return { ok: true, commitment: pick[0] };
  const list = views.map((c) => `${c.id}: ${named(c).name}`).join(", ") || "none yet";
  return { ok: false, message: pick.length ? `More than one commitment matches "${query}". Use its number: ${list}.` : `No commitment matches "${query}". The commitments are: ${list}.` };
}

// ---------------------------------------------------------------- schedules

export const DAY = 86_400;

export function periodOf(every: "month" | "week" | "once" | "days", days?: number): number {
  if (every === "once") return 0;
  if (every === "week") return 7 * DAY;
  if (every === "month") return 30 * DAY;
  return Math.max(1, Math.round(days ?? 1)) * DAY;
}

/** How long before a due date the agent may pay: three days, never more than the period, never under an hour. */
export function windowFor(periodSeconds: number): number {
  const three = 3 * DAY;
  return periodSeconds === 0 ? three : Math.max(3600, Math.min(three, periodSeconds));
}

/**
 * Reads a first due date: "2026-11-01" (09:00 in Dhaka), a full ISO time, or
 * "in 5 minutes", "in 2 hours", "in 3 days" for a demo.
 */
export function parseDue(text: string, now: Date): Date | null {
  const t = text.trim().toLowerCase();
  const rel = t.match(/^in\s+(\d+(?:\.\d+)?)\s*(minute|min|hour|hr|day)s?$/);
  if (rel) {
    const unit = rel[2].startsWith("min") ? 60 : rel[2].startsWith("h") ? 3600 : DAY;
    return new Date(now.getTime() + Number(rel[1]) * unit * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T03:00:00.000Z`);
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------- payments waiting for the owner

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

const REQUESTS = "payment-requests.json";

export function listPaymentRequests(): PaymentRequest[] {
  return readJson<PaymentRequest[]>(REQUESTS, []);
}

export function addPaymentRequest(r: Omit<PaymentRequest, "id" | "createdAt" | "status">): PaymentRequest {
  const all = listPaymentRequests();
  const full: PaymentRequest = { ...r, id: `p${all.length + 1}`, createdAt: new Date().toISOString(), status: "waiting" };
  writeJson(REQUESTS, [...all, full]);
  return full;
}

export function updatePaymentRequest(id: string, patch: Partial<PaymentRequest>) {
  writeJson(
    REQUESTS,
    listPaymentRequests().map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
}

// ---------------------------------------------------------------- notices, once per due date

const NOTICES = "commitment-notices.json";

/** True the first time it is called for this commitment and due date, so a shortfall is reported once. */
export function firstNotice(id: number, due: string | null): boolean {
  const seen = readJson<string[]>(NOTICES, []);
  const key = `${chainConfig().VAULT_ADDRESS.toLowerCase()}:${id}:${due}`;
  if (seen.includes(key)) return false;
  writeJson(NOTICES, [...seen, key]);
  return true;
}
