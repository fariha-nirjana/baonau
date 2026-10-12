import assert from "node:assert/strict";
import { test } from "node:test";
import { testPortfolio } from "./fixtures";
import { evaluate, historyFromAudit, type Action, type Facts } from "./risk";

const NOW = new Date("2026-10-13T00:10:00.000Z");
const facts = (over: Partial<Facts> = {}): Facts => ({
  portfolio: testPortfolio(),
  history: [],
  moves: {},
  scamList: [],
  now: NOW,
  untrusted: false,
  ...over,
});
const buy = (symbol: "IDX" | "BOND" | "GOLD" | "MEME", usd: number): Action => ({ kind: "trade", symbol, side: "buy", usd });
const sell = (symbol: "IDX" | "BOND" | "GOLD" | "MEME", usd: number): Action => ({ kind: "trade", symbol, side: "sell", usd });
const failed = (v: ReturnType<typeof evaluate>) => v.checks.filter((c) => c.outcome !== "pass").map((c) => c.id);

test("allows a trade inside the mandate", () => {
  const v = evaluate(buy("BOND", 50), facts());
  assert.equal(v.decision, "allow");
});

test("blocks an asset that is not in the mandate, and names the scam list when it is on it", () => {
  const p = testPortfolio();
  const meme = p.positions.find((x) => x.symbol === "MEME")!;
  const v = evaluate(buy("MEME", 50), facts({ portfolio: p, scamList: [{ address: meme.address, label: "reported pump-and-dump" }] }));
  assert.equal(v.decision, "block");
  assert.deepEqual(failed(v), ["scam_list", "mandate_asset"]);
  assert.match(v.explanation, /pump-and-dump/);
});

test("sends a trade above the single-trade limit to the owner", () => {
  const v = evaluate(buy("BOND", 150), facts());
  assert.equal(v.decision, "escalate");
  assert.deepEqual(failed(v), ["trade_size"]);
});

test("sends a trade to the owner when today's volume is used up", () => {
  const v = evaluate(buy("BOND", 80), facts({ portfolio: testPortfolio({ patch: (p) => (p.today.volumeLeft = "50") }) }));
  assert.equal(v.decision, "escalate");
  assert.deepEqual(failed(v), ["daily_volume"]);
});

test("blocks a buy that would push an asset over its cap", () => {
  // gold is at 10% with a 20% cap; 110 more would make it 21%
  const v = evaluate({ kind: "approved_trade", symbol: "GOLD", side: "buy", usd: 110 }, facts());
  assert.equal(v.decision, "block");
  assert.deepEqual(failed(v), ["exposure"]);
});

test("blocks a buy that would leave too little in defensive assets", () => {
  // cash 100 + bond 150 = 25% defensive; any more risk breaks the 25% floor
  const p = testPortfolio({ values: { IDX: 350, BOND: 150, GOLD: 150, MEME: 0 }, patch: (x) => (x.cash = "350") });
  p.positions[0].rule.maxExposurePct = 80;
  p.defensiveSharePct = 50;
  const ok = evaluate(buy("IDX", 100), facts({ portfolio: p }));
  assert.equal(ok.decision, "allow");
  p.defensiveSharePct = 30;
  const v = evaluate(buy("IDX", 100), facts({ portfolio: p }));
  assert.equal(v.decision, "block");
  assert.deepEqual(failed(v), ["defensive_floor"]);
});

test("blocks buying in protect mode but still allows selling", () => {
  const p = testPortfolio({ patch: (x) => (x.protect = { active: true, cooldownUntil: "2026-10-13T00:20:00.000Z" }) });
  assert.deepEqual(failed(evaluate(buy("BOND", 50), facts({ portfolio: p }))), ["protect_mode"]);
  assert.equal(evaluate(sell("IDX", 50), facts({ portfolio: p })).decision, "allow");
});

test("blocks a buy at or below the stop price", () => {
  const p = testPortfolio({ patch: (x) => (x.positions[0].price = "101") });
  assert.deepEqual(failed(evaluate(buy("IDX", 50), facts({ portfolio: p }))), ["stop_price"]);
});

test("blocks trading on an out-of-date price, with a paused agent, or with no mandate", () => {
  const stale = testPortfolio({ patch: (x) => (x.positions[1].priceIsStale = true) });
  assert.deepEqual(failed(evaluate(buy("BOND", 50), facts({ portfolio: stale }))), ["price"]);
  const paused = testPortfolio({ patch: (x) => (x.agent.paused = true) });
  assert.deepEqual(failed(evaluate(buy("BOND", 50), facts({ portfolio: paused }))), ["agent"]);
  const unsigned = testPortfolio({ patch: (x) => (x.mandateSigned = false) });
  assert.deepEqual(failed(evaluate(buy("BOND", 50), facts({ portfolio: unsigned }))), ["mandate"]);
});

test("blocks selling more than is held", () => {
  assert.deepEqual(failed(evaluate(sell("GOLD", 150), facts())), ["holding", "trade_size"]);
});

test("asks the owner when the price has moved abnormally", () => {
  const v = evaluate(buy("IDX", 50), facts({ moves: { IDX: { pct: -12.4, minutes: 60 } } }));
  assert.equal(v.decision, "escalate");
  assert.deepEqual(failed(v), ["abnormal_price"]);
  assert.match(v.explanation, /fallen 12.4%/);
});

test("asks the owner before adding risk after a loss, but not before buying the defensive asset", () => {
  const down = testPortfolio({ patch: (x) => (x.today.lossPct = 5) });
  assert.deepEqual(failed(evaluate(buy("IDX", 50), facts({ portfolio: down }))), ["chasing_losses"]);
  assert.equal(evaluate(buy("BOND", 50), facts({ portfolio: down })).decision, "allow");
});

test("blocks churning", () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ at: new Date(NOW.getTime() - i * 60_000), symbol: "IDX" as const, side: "buy" as const, usd: 10 }));
  assert.deepEqual(failed(evaluate(buy("BOND", 50), facts({ history }))), ["velocity"]);
});

test("a trade prompted by outside text always goes to the owner", () => {
  const v = evaluate(sell("IDX", 50), facts({ untrusted: true }));
  assert.equal(v.decision, "escalate");
  assert.deepEqual(failed(v), ["source"]);
});

test("a rebalance is checked leg by leg, with sells freeing cash for the buys", () => {
  const p = testPortfolio({ values: { IDX: 400, BOND: 500, GOLD: 100, MEME: 0 } });
  // no cash at the start: the buy only works because the sell comes first
  const v = evaluate({ kind: "rebalance", legs: [{ symbol: "IDX", side: "sell", usd: 100 }, { symbol: "BOND", side: "buy", usd: 90 }] }, facts({ portfolio: p }));
  assert.equal(v.decision, "allow");
  const reversed = evaluate({ kind: "rebalance", legs: [{ symbol: "BOND", side: "buy", usd: 90 }, { symbol: "IDX", side: "sell", usd: 100 }] }, facts({ portfolio: p }));
  assert.deepEqual(failed(reversed), ["cash"]);
});

test("every gate is listed on the trace, passes included", () => {
  const v = evaluate(buy("IDX", 50), facts());
  assert.deepEqual(
    v.checks.map((c) => c.id),
    ["mandate", "agent", "velocity", "source", "scam_list", "mandate_asset", "amount", "price", "protect_mode", "stop_price", "cash", "exposure", "defensive_floor", "trade_size", "daily_volume", "abnormal_price", "chasing_losses"],
  );
  assert.ok(v.checks.every((c) => c.outcome === "pass" && c.detail.length > 0));
});

test("an owner-signed trade is past the two size limits and still faces every other gate", () => {
  const big = evaluate({ kind: "approved_trade", symbol: "BOND", side: "buy", usd: 250 }, facts());
  assert.equal(big.decision, "allow");
  const paused = testPortfolio({ patch: (x) => (x.protect = { active: true, cooldownUntil: "2026-10-13T00:20:00.000Z" }) });
  assert.deepEqual(failed(evaluate({ kind: "approved_trade", symbol: "BOND", side: "buy", usd: 250 }, facts({ portfolio: paused }))), ["protect_mode"]);
});

test("it can only make things stricter: no fact turns a refusal into an approval", () => {
  // the mandate refuses MEME whatever else is true
  for (const untrusted of [true, false]) {
    for (const lossPct of [0, 5]) {
      const p = testPortfolio({ patch: (x) => (x.today.lossPct = lossPct) });
      assert.equal(evaluate(buy("MEME", 1), facts({ portfolio: p, untrusted })).decision, "block");
    }
  }
});

test("history counts trades that went through and skips refusals and requests", () => {
  const entry = (result: unknown) => ({
    ref: "0x00" as const,
    record: { at: NOW.toISOString(), tool: "buy", args: {}, reason: "", source: "chat", legs: [{ symbol: "IDX" as const, side: "buy" as const, usd: 10 }], risk: null },
    result,
  });
  const history = historyFromAudit([entry({ ok: true }), entry({ ok: false }), entry({ ok: true, escalated: true })]);
  assert.equal(history.length, 1);
});
