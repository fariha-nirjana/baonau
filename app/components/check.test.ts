import assert from "node:assert/strict";
import { test } from "node:test";
import { questionsOf } from "./Check";
import { strings } from "./i18n";
import type { Settings } from "./types";

const settings: Settings = { currency: "BDT", language: "en", role: "owner" };
const terms = { maxTradePct: 10, maxDailyVolumePct: 40, dailyLossPct: 8, waitSeconds: 120, valueUsd: 5000 / 122 };

test("the right answer to the trade question is the per-trade limit, in the investor's money", () => {
  const [q1] = questionsOf(terms, settings, strings("en"));
  assert.equal(q1.options[q1.correct], "৳500");
  assert.equal(new Set(q1.options).size, 3, "every option is different");
});

test("each question has exactly one right answer, not always in the same place", () => {
  const qs = questionsOf(terms, settings, strings("en"));
  assert.equal(qs.length, 4);
  for (const q of qs) {
    assert.ok(q.correct >= 0 && q.correct < q.options.length);
    assert.equal(new Set(q.options).size, q.options.length);
  }
  assert.ok(new Set(qs.map((q) => q.correct)).size > 1);
});

test("when the daily allowance equals the trade limit, the wrong amount still differs from the right one", () => {
  const [q1] = questionsOf({ ...terms, maxDailyVolumePct: 10 }, settings, strings("en"));
  assert.equal(new Set(q1.options).size, 3);
});

test("the waiting period in the answer follows the vault's setting", () => {
  const q3 = questionsOf({ ...terms, waitSeconds: 86_400 }, settings, strings("en"))[2];
  assert.match(q3.options[q3.correct], /24 h/);
});
