import assert from "node:assert/strict";
import { test } from "node:test";
import { testPortfolio } from "../lib/fixtures";
import type { Portfolio } from "../lib/vault";
import type { Receipt } from "../lib/receipts";
import { mimoOf, type MimoInputs } from "./mimo";
import type { AppState } from "./types";

const receipt = (over: Partial<Receipt>): Receipt => ({
  at: "2026-10-13T00:05:00.000Z",
  actor: "Agent, asked by the investor",
  what: "Tried to buy MEME",
  outcome: "done",
  why: "",
  refusal: null,
  gates: [],
  contract: null,
  url: null,
  ref: "0x1",
  declined: false,
  ...over,
});

function inputs(over: { patch?: (p: Portfolio) => void; receipts?: Receipt[] } & Partial<Omit<MimoInputs, "state">> = {}): MimoInputs {
  const state = {
    portfolio: testPortfolio({ patch: over.patch }),
    history: [],
    requests: [],
    plan: { targets: {} },
    drafts: [],
    receipts: over.receipts ?? [],
    brand: { product: "P", tagline: "", agent: "Mimo", agentRole: "" },
    explorer: "",
    vault: "",
    mandate: "",
  } as unknown as AppState;
  return { state, role: "owner", attacking: false, thinking: false, seen: new Set(), dismissed: new Set(), ...over };
}

test("calm when nothing is happening", () => {
  assert.equal(mimoOf(inputs()).mood, "calm");
});

test("a waiting rise in risk holds the line for the owner and warns the guardian", () => {
  const patch = (p: Portfolio) => {
    p.pending.mandate = { ...p.mandate, dailyLossPct: 24, appliesFrom: "2026-10-13T00:12:00.000Z" };
  };
  assert.equal(mimoOf(inputs({ patch })).mood, "holding");
  assert.equal(mimoOf(inputs({ patch, role: "guardian" })).mood, "warning");
});

test("a fresh revert raises the shield, with the variant for its cause, until it is acknowledged", () => {
  const attack = receipt({ outcome: "reverted by the contract", actor: "COMPROMISED AGENT (scripted attacker with the real agent key)" });
  const shown = mimoOf(inputs({ receipts: [attack] }));
  assert.equal(shown.mood, "shield");
  assert.equal(shown.variant, "code");
  assert.deepEqual(shown.receiptRefs, [attack.ref + attack.at]);
  assert.equal(mimoOf(inputs({ receipts: [attack], seen: new Set(shown.receiptRefs) })).mood, "calm");

  const blocked = receipt({ outcome: "blocked by the risk engine" });
  assert.equal(mimoOf(inputs({ receipts: [blocked] })).variant, "chat");
  const declined = receipt({ outcome: "decided not to act", declined: true });
  assert.equal(mimoOf(inputs({ receipts: [declined] })).mood, "shield");
  assert.equal(mimoOf(inputs({ receipts: [declined] })).variant, "chat");
  // a fail-safe abstention (the model errored) is not a refusal and raises nothing
  assert.equal(mimoOf(inputs({ receipts: [receipt({ outcome: "decided not to act" })] })).mood, "calm");
  const failed = receipt({ outcome: "reverted by the contract" });
  assert.equal(mimoOf(inputs({ receipts: [failed] })).variant, "card");
});

test("the shield outranks everything, and thinking does not hide a waiting change", () => {
  const patch = (p: Portfolio) => {
    p.protect.active = true;
    p.pending.mandate = { ...p.mandate, appliesFrom: "2026-10-13T00:12:00.000Z" };
  };
  assert.equal(mimoOf(inputs({ patch, attacking: true })).mood, "shield");
  assert.equal(mimoOf(inputs({ patch })).mood, "warning");
  const waitingOnly = (p: Portfolio) => {
    p.pending.mandate = { ...p.mandate, appliesFrom: "2026-10-13T00:12:00.000Z" };
  };
  assert.equal(mimoOf(inputs({ patch: waitingOnly, thinking: true })).mood, "holding");
});

test("a dismissed alert gives way to the next one, and a new request alerts again", () => {
  const at = (iso: string) => (p: Portfolio) => {
    p.pending.mandate = { ...p.mandate, appliesFrom: iso };
    p.today.lossPct = 3;
  };
  const first = mimoOf(inputs({ patch: at("2026-10-13T00:12:00.000Z") }));
  assert.equal(first.mood, "holding");
  const dismissed = new Set([first.dismissKey as string]);
  assert.equal(mimoOf(inputs({ patch: at("2026-10-13T00:12:00.000Z"), dismissed })).mood, "worried");
  assert.equal(mimoOf(inputs({ patch: at("2026-10-13T00:20:00.000Z"), dismissed })).mood, "holding");
});
