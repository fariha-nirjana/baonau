// Run from app/:  npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, type Facts, type PastPayment } from "./policy";
import type { Mandate, Overview } from "./wallet";

const NOW = new Date("2026-10-15T10:00:00Z");
const UNI = "0x3Af0207f147C499c5e5332aA53C5cAeA080Ed52A";
const LANDLORD = "0x2ac296e73f317991C2b1A8eE07A9c6DC0939d13A";
const SCAM = "0x00000000000000000000000000000000DeaDBeef";

const mandate = (over: Partial<Mandate>): Mandate => ({
  id: 1,
  purpose: "Tuition",
  payee: UNI,
  bucket: 1,
  status: "approved",
  active: true,
  activeFrom: "2026-10-11T00:00:00.000Z",
  expiry: "2027-10-11T00:00:00.000Z",
  periodDays: 30,
  capPerPeriod: "5000",
  remainingThisPeriod: "5000",
  ...over,
});

const overview: Overview = {
  balance: "10000",
  unallocated: "2400",
  buckets: [
    { id: 0, name: "Unallocated", locked: false, balance: "2400" },
    { id: 1, name: "Tuition", locked: true, balance: "6000" },
    { id: 2, name: "Rent", locked: true, balance: "1600" },
  ],
  limits: { perPayment: "2000", perDay: "3000", leftToday: "3000" },
  agentExposure: "3000",
  paused: false,
  agent: { address: "0x22E60BCE31F77B057FD8F11d48C3C5c9B5e161F2", keyExpires: "2026-12-10T00:00:00.000Z" },
};

const facts = (over: Partial<Facts> = {}): Facts => ({
  overview,
  mandates: [mandate({}), mandate({ id: 2, purpose: "Rent", payee: LANDLORD, bucket: 2, capPerPeriod: "800", remainingThisPeriod: "800" })],
  history: [],
  bills: [
    { id: "fee", mandateId: 1, label: "Services fee", amount: "250", dueDate: "2026-10-16", status: "due" },
    { id: "old", mandateId: 1, label: "Instalment 1", amount: "1500", dueDate: "2026-09-20", status: "paid" },
  ],
  blocklist: [{ address: SCAM, label: "reported scam" }],
  now: NOW,
  untrusted: false,
  ...over,
});

const paid = (minutesAgo: number, amount: string, mandateId = 1): PastPayment => ({
  at: new Date(NOW.getTime() - minutesAgo * 60_000),
  mandateId,
  amount,
});

const outcomeOf = (v: ReturnType<typeof evaluate>, id: string) => v.checks.find((c) => c.id === id)?.outcome;

test("allows a normal payment within limits", () => {
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "1500" }, facts());
  assert.equal(v.decision, "allow");
  assert.match(v.explanation, /^Allowed\./);
});

test("blocks a mandate that does not exist or is only proposed", () => {
  assert.equal(evaluate({ kind: "pay", mandateId: 9, amount: "10" }, facts()).decision, "block");
  const proposed = facts({ mandates: [mandate({ status: "proposed", active: false })] });
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "10" }, proposed).decision, "block");
});

test("blocks a mandate still in its waiting period", () => {
  const waiting = facts({ mandates: [mandate({ active: false })] });
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "10" }, waiting);
  assert.equal(v.decision, "block");
  assert.equal(outcomeOf(v, "mandate"), "block");
});

test("blocks a payee that lands on the screening list after approval", () => {
  const listed = facts({ mandates: [mandate({ payee: SCAM })] });
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "10" }, listed);
  assert.equal(v.decision, "block");
  assert.equal(outcomeOf(v, "screening"), "block");
});

test("escalates amounts above each limit", () => {
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "2000.000001" }, facts()).decision, "escalate");
  assert.equal(evaluate({ kind: "pay", mandateId: 2, amount: "801" }, facts()).decision, "escalate");
  const lowDay = facts({ overview: { ...overview, limits: { ...overview.limits, leftToday: "100" } } });
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "101" }, lowDay).decision, "escalate");
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "2000" }, facts()).decision, "allow");
});

test("blocks when the bucket is short, with a hint to budget first", () => {
  const v = evaluate({ kind: "pay", mandateId: 2, amount: "800" }, facts({
    overview: { ...overview, buckets: [overview.buckets[0], overview.buckets[1], { ...overview.buckets[2], balance: "0" }] },
  }));
  assert.equal(v.decision, "block");
  assert.match(v.explanation, /Move funds into it first/);
});

test("escalates an amount far above this payee's history", () => {
  const history = [paid(60 * 24 * 40, "100"), paid(60 * 24 * 10, "120")];
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "241" }, facts({ history })).decision, "escalate");
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "240" }, facts({ history })).decision, "allow");
});

test("does not judge amounts with fewer than two earlier payments", () => {
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "1900" }, facts({ history: [paid(60 * 24 * 40, "10")] }));
  assert.equal(v.decision, "allow");
  assert.equal(outcomeOf(v, "unusual_amount"), undefined);
});

test("escalates a repeat of the same amount within a day", () => {
  const history = [paid(30, "800", 2)];
  const v = evaluate({ kind: "pay", mandateId: 2, amount: "800" }, facts({
    history,
    mandates: [mandate({ id: 2, purpose: "Rent", payee: LANDLORD, bucket: 2, capPerPeriod: "2000", remainingThisPeriod: "1200" })],
  }));
  assert.equal(v.decision, "escalate");
  assert.equal(outcomeOf(v, "duplicate"), "escalate");
  const old = [paid(60 * 25, "800", 2)];
  assert.equal(outcomeOf(evaluate({ kind: "pay", mandateId: 2, amount: "800" }, facts({ history: old })), "duplicate"), undefined);
});

test("blocks a burst of payments", () => {
  const history = [1, 2, 3, 4, 5].map((m) => paid(m, `${m}`));
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "7" }, facts({ history }));
  assert.equal(v.decision, "block");
  assert.equal(outcomeOf(v, "velocity"), "block");
});

test("escalates a payment triggered by a document", () => {
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "100" }, facts({ untrusted: true }));
  assert.equal(v.decision, "escalate");
  assert.equal(outcomeOf(v, "source"), "escalate");
});

test("a document may trigger a payment alone only when it matches an expected bill", () => {
  const doc = facts({ untrusted: true });
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "250", billId: "fee" }, doc);
  assert.equal(v.decision, "allow");
  assert.equal(outcomeOf(v, "bill"), "pass");
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "250" }, doc).decision, "escalate");
});

test("blocks a bill that is unknown, already paid, or does not match the payment", () => {
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "250", billId: "nope" }, facts()).decision, "block");
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "1500", billId: "old" }, facts()).decision, "block");
  assert.equal(evaluate({ kind: "pay", mandateId: 1, amount: "251", billId: "fee" }, facts()).decision, "block");
  assert.equal(evaluate({ kind: "pay", mandateId: 2, amount: "250", billId: "fee" }, facts()).decision, "block");
});

test("an approval request may exceed limits but is still screened", () => {
  assert.equal(evaluate({ kind: "request_approval", mandateId: 1, amount: "4500" }, facts()).decision, "allow");
  const listed = facts({ mandates: [mandate({ payee: SCAM })] });
  assert.equal(evaluate({ kind: "request_approval", mandateId: 1, amount: "4500" }, listed).decision, "block");
});

test("blocks proposing a screened payee, in any letter case", () => {
  assert.equal(evaluate({ kind: "propose_payee", payee: SCAM.toLowerCase() }, facts()).decision, "block");
});

test("blocks a lookalike of an approved payee", () => {
  const lookalike = UNI.slice(0, 6) + "0".repeat(32) + UNI.slice(-4);
  const v = evaluate({ kind: "propose_payee", payee: lookalike }, facts());
  assert.equal(v.decision, "block");
  assert.match(v.explanation, /starts and ends like/);
  assert.equal(evaluate({ kind: "propose_payee", payee: UNI }, facts()).decision, "block");
});

test("allows proposing an ordinary new payee, since the owner still decides", () => {
  const v = evaluate({ kind: "propose_payee", payee: "0x1111111111111111111111111111111111111111" }, facts({ untrusted: true }));
  assert.equal(v.decision, "allow");
});

test("block outranks escalate", () => {
  const v = evaluate({ kind: "pay", mandateId: 1, amount: "9000" }, facts({ mandates: [mandate({ payee: SCAM })] }));
  assert.equal(v.decision, "block");
});

test("moving funds is always allowed here, the contract guards locked buckets", () => {
  assert.equal(evaluate({ kind: "move_funds", from: 0, to: 1, amount: "5" }, facts()).decision, "allow");
});
