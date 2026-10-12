import type { AssetSymbol } from "./assets";
import type { Plan } from "./plan";
import { readJson, writeJson } from "./store";
import type { AssetRule, Mandate } from "./vault";

/**
 * Things only the owner can do, prepared for the owner to read and sign.
 * The agent can write a draft. It cannot sign one: signing needs the owner
 * key, and anything in a draft that raises the risk then waits out the delay
 * on-chain, where the guardian can cancel it.
 */
export type MandateDraft = {
  mandate: Mandate;
  rules: Partial<Record<AssetSymbol, AssetRule>>;
  /** The strategy that goes with it, saved when the draft is signed. */
  plan: Pick<Plan, "targets" | "driftPct" | "recurring">;
};

export type Draft = {
  id: string;
  createdAt: string;
  kind: "sign_mandate" | "change_mandate" | "halt_stop_loss";
  /** Plain lines for the owner, one per term. */
  summary: string[];
  /** lowers: applies at once. raises: waits out the delay and the guardian can cancel it. */
  risk: "first_mandate" | "lowers" | "raises";
  reason: string;
  payload: MandateDraft | null;
  status: "draft" | "signed" | "dismissed";
  txs?: string[];
};

const FILE = "owner-drafts.json";

export function listDrafts(): Draft[] {
  return readJson<Draft[]>(FILE, []);
}

export function addDraft(draft: Omit<Draft, "id" | "createdAt" | "status">): Draft {
  const all = listDrafts();
  const full: Draft = { ...draft, id: `d${all.length + 1}`, createdAt: new Date().toISOString(), status: "draft" };
  writeJson(FILE, [...all, full]);
  return full;
}

export function updateDraft(id: string, patch: Partial<Draft>) {
  writeJson(
    FILE,
    listDrafts().map((d) => (d.id === id ? { ...d, ...patch } : d)),
  );
}
