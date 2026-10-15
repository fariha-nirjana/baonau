import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY, parseDue, periodOf, statusOf, testnetPayee, windowFor, type CommitmentView } from "./commitments";
import { testPortfolio } from "./fixtures";
import { evaluatePayment } from "./risk";

const NOW = new Date("2026-10-20T00:00:00.000Z");
const rent = (over: Partial<CommitmentView> = {}): CommitmentView => ({
  id: 1,
  payee: "0x00000000000000000000000000000000000000aa",
  maxAmount: "100",
  periodSeconds: 30 * DAY,
  windowSeconds: 3 * DAY,
  nextDue: "2026-10-22T00:00:00.000Z",
  active: true,
  reserved: "100",
  payableFrom: "2026-10-19T00:00:00.000Z",
  pending: null,
  pendingRelease: null,
  ...over,
});

test("a funded commitment inside its window is due, before it is ready", () => {
  assert.equal(statusOf(rent(), NOW).kind, "due");
  assert.equal(statusOf(rent({ payableFrom: "2026-10-21T00:00:00.000Z" }), NOW).kind, "ready");
});

test("a short reserve needs funding, and says by how much", () => {
  const s = statusOf(rent({ reserved: "40" }), NOW);
  assert.deepEqual(s, { kind: "needs_funding", shortBy: 60, dueSoon: true });
});

test("a new payee waiting is shown as waiting, a removed one as closed, money with nobody to pay as reserved", () => {
  const waiting = rent({ active: false, pending: { ...rent(), appliesFrom: "2026-10-20T00:02:00.000Z" } });
  assert.deepEqual(statusOf(waiting, NOW), { kind: "waiting", appliesFrom: "2026-10-20T00:02:00.000Z" });
  assert.equal(statusOf(rent({ active: false }), NOW).kind, "closed");
  assert.equal(statusOf(rent({ payee: null, payableFrom: null }), NOW).kind, "reserved");
});

test("due dates read as dates, full times or 'in N minutes'", () => {
  assert.equal(parseDue("2026-11-01", NOW)?.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(parseDue("in 5 minutes", NOW)?.getTime(), NOW.getTime() + 300_000);
  assert.equal(parseDue("in 2 days", NOW)?.getTime(), NOW.getTime() + 2 * DAY * 1000);
  assert.equal(parseDue("someday", NOW), null);
});

test("schedules and windows fit the contract's bounds", () => {
  assert.equal(periodOf("once"), 0);
  assert.equal(periodOf("month"), 30 * DAY);
  assert.equal(periodOf("days", 10), 10 * DAY);
  assert.equal(windowFor(30 * DAY), 3 * DAY);
  assert.equal(windowFor(DAY), DAY, "never wider than the period");
  assert.equal(windowFor(0), 3 * DAY);
});

test("a testnet payee address is the same for the same name, whatever the spacing or case", () => {
  assert.equal(testnetPayee("Greenway Housing"), testnetPayee("  greenway housing "));
  assert.notEqual(testnetPayee("Greenway Housing"), testnetPayee("Greenway Homes"));
});

const facts = (over: Partial<Parameters<typeof evaluatePayment>[0]> = {}) => ({
  portfolio: testPortfolio(),
  commitment: rent(),
  amount: 100,
  scamList: [],
  now: NOW,
  untrusted: false,
  ...over,
});

test("a due, funded payment to its payee is allowed and every check is listed", () => {
  const v = evaluatePayment(facts());
  assert.equal(v.decision, "allow");
  for (const id of ["commitment_active", "payee_screen", "commitment_amount", "reserve", "due_window", "source"]) {
    assert.ok(v.checks.some((c) => c.id === id && c.outcome === "pass"), id);
  }
});

test("more than the commitment allows, or than is set aside, is blocked", () => {
  assert.equal(evaluatePayment(facts({ amount: 101 })).decision, "block");
  assert.equal(evaluatePayment(facts({ commitment: rent({ reserved: "50" }) })).decision, "block");
});

test("not due yet, or prompted by outside text, goes to the owner", () => {
  assert.equal(evaluatePayment(facts({ commitment: rent({ payableFrom: "2026-10-21T00:00:00.000Z" }) })).decision, "escalate");
  assert.equal(evaluatePayment(facts({ untrusted: true })).decision, "escalate");
});

test("a payee on the scam list, or money with nobody to pay, is blocked", () => {
  assert.equal(evaluatePayment(facts({ scamList: [{ address: "0x00000000000000000000000000000000000000AA", label: "x" }] })).decision, "block");
  assert.equal(evaluatePayment(facts({ commitment: rent({ payee: null }) })).decision, "block");
});
