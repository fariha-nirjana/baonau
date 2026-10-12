import type { AssetSymbol } from "./assets";
import type { Currency } from "./money";
import type { Targets } from "./planner";
import { readJson, writeJson } from "./store";

export type Language = "en" | "zh" | "bn";

export type RecurringBuy = { symbol: AssetSymbol; usd: string; everyHours: number; lastRunAt: string | null };

/**
 * The strategy: what the agent is trying to do inside the mandate. It lives
 * off-chain because it is the agent's job, not a limit. Whatever it says, the
 * agent can only act on it as far as the mandate on-chain allows.
 */
export type Plan = {
  targets: Targets;
  /** Rebalance when an asset is this many percentage points away from its target. */
  driftPct: number;
  recurring: RecurringBuy[];
  language: Language;
  currency: Currency;
};

const FILE = "plan.json";

export const DEFAULT_PLAN: Plan = { targets: {}, driftPct: 5, recurring: [], language: "en", currency: "BDT" };

export function readPlan(): Plan {
  return { ...DEFAULT_PLAN, ...readJson<Partial<Plan>>(FILE, {}) };
}

export function writePlan(plan: Plan) {
  writeJson(FILE, plan);
}

/** Recurring buys whose interval has passed at `now`. */
export function dueBuys(plan: Plan, now: Date): RecurringBuy[] {
  return plan.recurring.filter(
    (r) => r.lastRunAt === null || now.getTime() - new Date(r.lastRunAt).getTime() >= r.everyHours * 3600_000,
  );
}

export function markBought(symbol: AssetSymbol, at: Date) {
  const plan = readPlan();
  for (const r of plan.recurring) if (r.symbol === symbol) r.lastRunAt = at.toISOString();
  writePlan(plan);
}
