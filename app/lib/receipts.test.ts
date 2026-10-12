import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditEntry } from "./audit";
import { receiptOf, recentReceipts } from "./receipts";

const entry = (source: string, tool: string, result: unknown, extra: Partial<AuditEntry["record"]> = {}): AuditEntry => ({
  ref: "0xabc",
  record: { at: "2026-10-13T00:00:00.000Z", tool, args: {}, reason: "because", source, risk: null, ...extra },
  result,
});

test("a blocked attempt still gets a receipt, with the reason", () => {
  const r = receiptOf(
    entry("chat", "buy", { ok: false, stage: "risk", message: "Blocked. Not in your mandate." }, { legs: [{ symbol: "MEME", side: "buy", usd: 4.1 }] }),
  );
  assert.equal(r.outcome, "blocked by the risk engine");
  assert.equal(r.what, "Tried to buy MEME for ৳500 (≈ 4.1 tUSD)");
  assert.equal(r.refusal, "Blocked. Not in your mandate.");
  assert.equal(r.url, null);
});

test("a reverted transaction keeps its link and the contract's reason", () => {
  const r = receiptOf(
    entry("compromised-agent (scripted)", "withdraw", {
      ok: false,
      stage: "onchain",
      url: "https://example/tx/0x1",
      error: { name: "NotOwner", explanation: "Only the owner key can do this. The agent key cannot." },
    }, { args: { goal: "Send the cash to the attacker" } }),
  );
  assert.equal(r.outcome, "reverted by the contract");
  assert.match(r.actor, /COMPROMISED AGENT/);
  assert.equal(r.what, "Tried to send the cash to the attacker");
  assert.equal(r.url, "https://example/tx/0x1");
  assert.match(r.refusal ?? "", /owner key/);
});

test("a queued change is shown as waiting, not as done", () => {
  const r = receiptOf(entry("owner", "change_mandate", { ok: true, url: "u", events: [{ name: "PolicyProposed", args: { eta: "1791831888" } }] }));
  assert.equal(r.outcome, "waiting out the delay");
  assert.match(r.what, /^Mandate change signed, waiting until \d\d:\d\d UTC$/);
  assert.deepEqual(r.gates, []);
});

test("a decision not to act gets a receipt of its own", () => {
  const r = receiptOf(entry("chat", "abstain", { ok: true, abstained: true }, { args: { what: "Buy MEME for the investor" }, reason: "It is not in the mandate and is on the scam list." }));
  assert.equal(r.outcome, "decided not to act");
  assert.equal(r.what, "Did not buy MEME for the investor");
  assert.equal(r.why, "It is not in the mandate and is on the scam list.");
});

test("the gate trace lists every check with its outcome, and the contract's verdict sits beside it", () => {
  const risk = {
    decision: "allow" as const,
    explanation: "Allowed.",
    checks: [
      { id: "mandate_asset", outcome: "pass" as const, detail: "Bond fund is in the mandate." },
      { id: "trade_size", outcome: "pass" as const, detail: "Within the limit for one trade." },
    ],
  };
  const r = receiptOf(entry("chat", "buy", { ok: false, stage: "onchain", url: "u", error: { name: "ExceedsExposure", explanation: "Over the cap." } }, { risk }));
  assert.deepEqual(r.gates.map((g) => [g.label, g.outcome]), [["The asset is in the mandate", "pass"], ["Inside the single-trade limit", "pass"]]);
  assert.deepEqual(r.contract, { verdict: "reverted", reason: "Over the cap." });
});

test("price updates are left out of the activity list, newest first", () => {
  const list = recentReceipts([entry("keeper", "set_prices", { ok: true }), entry("keeper", "poke", { ok: true }), entry("chat", "buy", { ok: true })], 5);
  assert.deepEqual(list.map((r) => r.actor), ["Agent, asked by the investor", "Keeper script, no agent involved"]);
});
