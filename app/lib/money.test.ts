import assert from "node:assert/strict";
import { test } from "node:test";
import { display, rateNote, toUsd } from "./money";

test("shows the investor's currency first and tUSD next to it", () => {
  assert.equal(display("40.983606", "BDT"), "৳5,000 (≈ 40.98 tUSD)");
  assert.equal(display(41, "CNY"), "¥291.1 (≈ 41 tUSD)");
  assert.equal(display("1234.5", "USD"), "$1,234.5 (≈ 1,234.5 tUSD)");
});

test("converts an amount typed in a display currency, rounding down", () => {
  assert.equal(toUsd(5000, "BDT"), "40.983606");
  assert.equal(toUsd(500, "BDT"), "4.09836");
  assert.equal(toUsd(12.5, "tUSD"), "12.5");
  assert.equal(toUsd(71, "CNY"), "10");
});

test("labels the rate as a demo rate", () => {
  assert.equal(rateNote("BDT"), "demo rate ৳122 = 1 tUSD");
});
