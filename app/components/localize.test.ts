import assert from "node:assert/strict";
import { test } from "node:test";
import { localize } from "./localize";

test("a rule check sentence is shown in the chosen language", () => {
  const s = "Within the limit for one trade (10% of the portfolio, ৳490 (≈ 4.02 tUSD) now).";
  assert.equal(localize(s, "en"), "Within the single-trade limit: 10% of the portfolio (৳490 (≈ 4.02 tUSD) now).");
  assert.equal(localize(s, "zh"), "在单笔上限内：组合的 10%，当前为 ৳490 (≈ 4.02 tUSD)。");
});

test("a contract refusal keeps the values it was given", () => {
  const s = "MEME is not in the mandate, so the agent cannot buy it.";
  assert.equal(localize(s, "bn"), "ম্যান্ডেটে MEME অনুমোদিত নয়। এজেন্ট এটি কিনতে পারে না।");
});

test("headlines joined with a full stop are translated part by part", () => {
  const s = "Bought IDX for ৳300 at 120. Buying paused until 08:16 UTC";
  assert.equal(localize(s, "zh"), "以 120 的价格买入 IDX，金额 ৳300。买入暂停至 08:16 UTC");
});

test("text without a template stays as stored", () => {
  assert.equal(localize("Something the model wrote.", "bn"), "Something the model wrote.");
  assert.equal(localize(null, "zh"), "");
});
