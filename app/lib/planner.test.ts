import assert from "node:assert/strict";
import { test } from "node:test";
import { testPortfolio } from "./fixtures";
import { needsRebalance, planRebalance } from "./planner";

test("plans sells before buys and moves towards the targets", () => {
  // index is at 30% against a 25% target, bond at 30% against 35%
  const plan = planRebalance(testPortfolio(), { IDX: 25, BOND: 35, GOLD: 10 });
  assert.deepEqual(plan.legs, [
    { symbol: "IDX", side: "sell", usd: 50 },
    { symbol: "BOND", side: "buy", usd: 50 },
  ]);
  assert.deepEqual(plan.drift, { IDX: 5, BOND: -5, GOLD: 0 });
  assert.equal(needsRebalance(plan, 5), true);
});

test("does nothing when everything is close to target", () => {
  const plan = planRebalance(testPortfolio(), { IDX: 30, BOND: 30.1, GOLD: 10 });
  assert.deepEqual(plan.legs, []);
  assert.equal(needsRebalance(plan, 5), false);
});

test("cuts each leg to the single-trade limit", () => {
  const plan = planRebalance(testPortfolio(), { IDX: 5, BOND: 55, GOLD: 10 });
  // just under the 100 limit, because the limit falls slightly as earlier legs pay their fees
  assert.equal(plan.legs[0].usd, 99);
  assert.equal(plan.legs[1].usd, 99);
  assert.ok(plan.notes.some((n) => n.includes("per-trade limit")));
});

test("never plans above an asset's cap", () => {
  // gold's cap is 20%: a 50% target is treated as 20%
  const p = testPortfolio({ patch: (x) => (x.today.maxTrade = "500") });
  const plan = planRebalance(p, { IDX: 30, BOND: 30, GOLD: 50 });
  const gold = plan.legs.find((l) => l.symbol === "GOLD")!;
  assert.ok(gold.usd <= 100, `planned ${gold.usd}`);
  assert.ok(plan.notes.some((n) => n.includes("cap")));
});

test("stays inside what is left of today's volume", () => {
  const p = testPortfolio({ patch: (x) => (x.today.volumeLeft = "120") });
  const plan = planRebalance(p, { IDX: 20, BOND: 40, GOLD: 10 });
  const volume = plan.legs.reduce((sum, l) => sum + l.usd, 0);
  assert.ok(volume <= 120, `planned ${volume}`);
});

test("plans only sells while buying is paused", () => {
  const p = testPortfolio({ patch: (x) => (x.protect = { active: true, cooldownUntil: "2026-10-13T00:20:00.000Z" }) });
  const plan = planRebalance(p, { IDX: 20, BOND: 40, GOLD: 10 });
  assert.deepEqual(plan.legs.map((l) => l.side), ["sell"]);
});

test("does not buy an asset at its stop price or one outside the mandate", () => {
  const p = testPortfolio({ patch: (x) => (x.positions[0].price = "101") });
  const plan = planRebalance(p, { IDX: 40, BOND: 30, GOLD: 10, MEME: 5 });
  assert.deepEqual(plan.legs, []);
  assert.equal(plan.notes.length, 2);
});

test("sells an asset that has no target any more", () => {
  const plan = planRebalance(testPortfolio(), { IDX: 30, BOND: 30 });
  assert.deepEqual(plan.legs, [{ symbol: "GOLD", side: "sell", usd: 99 }]);
});
