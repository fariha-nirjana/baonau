import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsUnbackedAction } from "./claims";

test("a reply that claims an action needs a tool that acted", () => {
  const reply = "I've put both changes in as requests: the bigger loss limit and the stop-loss off.";
  assert.equal(claimsUnbackedAction(reply, false), true);
  assert.equal(claimsUnbackedAction(reply, true), false);
});

test("offers, questions and plain answers are not claims", () => {
  assert.equal(claimsUnbackedAction("Want me to prepare both, or sit with it a bit?", false), false);
  assert.equal(claimsUnbackedAction("Your daily loss limit is 5%. Raising it waits two minutes.", false), false);
  assert.equal(claimsUnbackedAction("I have no way to move money to a new wallet.", false), false);
});
