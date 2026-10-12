import scamFile from "../config/scam-tokens.json";
import type { AssetSymbol } from "./assets";
import type { AuditEntry } from "./audit";
import { USD_SYMBOL } from "./config";
import type { Portfolio, Position } from "./vault";

/**
 * Layer 3: the off-chain risk engine.
 *
 * It looks at what the agent wants to do before anything is signed, and it is
 * plain code with no model in it. It can only make things stricter: it allows
 * what the mandate allows, sends a trade to the owner, or blocks it. It can
 * never authorise anything the contract forbids, and if it is bypassed the
 * contract still enforces every limit. What it adds is the things the
 * contract cannot know (a scam list, abnormal prices, trading patterns, where
 * an instruction came from) and a plain reason for every refusal.
 */

export type Side = "buy" | "sell";
/** `usd` is the trade's value in tUSD: what a buy spends, or what a sell is worth at the oracle price. */
export type Leg = { symbol: AssetSymbol; side: Side; usd: number };

export type Action =
  | ({ kind: "trade" } & Leg)
  | { kind: "rebalance"; legs: Leg[] }
  | ({ kind: "request_approval" } & Leg);

export type PastTrade = { at: Date; symbol: AssetSymbol; side: Side; usd: number };
export type ScamEntry = { address: string; label: string };
/** How far a price has moved over the recent window, in percent. Negative is a fall. */
export type PriceMove = { pct: number; minutes: number };

export type Facts = {
  portfolio: Portfolio;
  history: PastTrade[];
  moves: Partial<Record<AssetSymbol, PriceMove>>;
  scamList: ScamEntry[];
  now: Date;
  /** True when the instruction came from news, token text or a message the owner did not write. */
  untrusted: boolean;
};

export type Outcome = "pass" | "escalate" | "block";
export type Check = { id: string; outcome: Outcome; detail: string };

export type Verdict = {
  /** allow: sign it. escalate: send to the owner for approval. block: do nothing. */
  decision: "allow" | "escalate" | "block";
  checks: Check[];
  explanation: string;
};

/** A move this large inside the window, measured against the asset's own cap on one oracle update, is flagged. */
export const ABNORMAL_MOVE_PCT = 8;
export const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
export const VELOCITY_MAX_TRADES = 6;
/** Buying more risk once today's loss has used this share of the daily loss limit needs the owner. */
export const LOSS_CHASING_SHARE = 0.5;

const money = (usd: number) => `${Math.round(usd * 100) / 100} ${USD_SYMBOL}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function defaultScamList(extra: ScamEntry[] = []): ScamEntry[] {
  return [...scamFile.entries, ...extra];
}

/** Successful agent trades from the audit log, as the history the pattern checks compare against. */
export function historyFromAudit(entries: AuditEntry[]): PastTrade[] {
  return entries.flatMap((e) => {
    const result = e.result as { ok?: boolean; escalated?: boolean } | null;
    if (!result?.ok || result.escalated) return [];
    return (e.record.legs ?? []).map((leg) => ({ at: new Date(e.record.at), ...leg }));
  });
}

/** The few numbers the checks need, kept separate so a rebalance can be walked leg by leg. */
type State = { total: number; cash: number; defensive: number; value: Record<string, number>; volumeLeft: number };

function stateOf(p: Portfolio): State {
  const value = Object.fromEntries(p.positions.map((x) => [x.symbol, Number(x.value)]));
  return {
    total: Number(p.totalValue),
    cash: Number(p.cash),
    defensive: (Number(p.totalValue) * p.defensiveSharePct) / 100,
    value,
    volumeLeft: Number(p.today.volumeLeft),
  };
}

function apply(state: State, leg: Leg, position: Position) {
  const sign = leg.side === "buy" ? 1 : -1;
  state.cash -= sign * leg.usd;
  state.value[leg.symbol] = (state.value[leg.symbol] ?? 0) + sign * leg.usd;
  if (!position.rule.defensive) state.defensive -= sign * leg.usd;
  state.volumeLeft -= leg.usd;
}

function checkLeg(leg: Leg, facts: Facts, state: State, direct: boolean): Check[] {
  const p = facts.portfolio;
  const position = p.positions.find((x) => x.symbol === leg.symbol);
  if (!position) return [{ id: "asset", outcome: "block", detail: `${leg.symbol} is not a token this vault knows.` }];
  const checks: Check[] = [];
  const buying = leg.side === "buy";

  const scam = facts.scamList.find((s) => same(s.address, position.address));
  if (scam && buying) {
    checks.push({ id: "scam_list", outcome: "block", detail: `${position.name} is on the scam token list: ${scam.label}.` });
  }

  if (buying && !position.rule.allowed) {
    checks.push({ id: "mandate_asset", outcome: "block", detail: `${position.name} is not in your mandate, so it cannot be bought.` });
    return checks;
  }
  checks.push({ id: "mandate_asset", outcome: "pass", detail: `${position.name} is in the mandate.` });

  if (leg.usd <= 0) checks.push({ id: "amount", outcome: "block", detail: "The amount must be more than zero." });

  if (position.priceIsStale) {
    checks.push({ id: "price", outcome: "block", detail: `The price of ${position.name} is out of date, so it is not safe to trade on.` });
  }

  if (buying) {
    if (p.protect.active) {
      checks.push({
        id: "protect_mode",
        outcome: "block",
        detail: p.protect.cooldownUntil
          ? `Buying is paused until ${p.protect.cooldownUntil} after a loss trigger. Selling still works.`
          : `The portfolio is down ${p.today.lossPct}% today, at or past the ${p.mandate.dailyLossPct}% daily loss limit, so buying is paused.`,
      });
    }
    if (position.rule.stopPrice !== null && Number(position.price) <= Number(position.rule.stopPrice)) {
      checks.push({
        id: "stop_price",
        outcome: "block",
        detail: `${position.name} is at ${position.price}, at or below its stop price of ${position.rule.stopPrice}.`,
      });
    }
    if (leg.usd > state.cash) {
      checks.push({ id: "cash", outcome: "block", detail: `There is ${money(state.cash)} in cash, less than the ${money(leg.usd)} this needs.` });
    }
    const after = ((state.value[leg.symbol] ?? 0) + leg.usd) / state.total;
    if (after * 100 > position.rule.maxExposurePct) {
      checks.push({
        id: "exposure",
        outcome: "block",
        detail: `This would make ${position.name} ${Math.round(after * 1000) / 10}% of the portfolio. The mandate allows at most ${position.rule.maxExposurePct}%.`,
      });
    }
    if (!position.rule.defensive) {
      const defensiveAfter = (state.defensive - leg.usd) / state.total;
      if (defensiveAfter * 100 < p.mandate.minDefensivePct) {
        checks.push({
          id: "defensive_floor",
          outcome: "block",
          detail: `This would leave ${Math.round(defensiveAfter * 1000) / 10}% in cash and defensive assets. The mandate requires at least ${p.mandate.minDefensivePct}%.`,
        });
      }
    }
  } else if (leg.usd > (state.value[leg.symbol] ?? 0) * 1.000001) {
    checks.push({ id: "holding", outcome: "block", detail: `The vault holds ${money(state.value[leg.symbol] ?? 0)} of ${position.name}, less than this sale.` });
  }

  // An approval request is allowed to exceed the agent's size limits, that is its purpose.
  if (direct) {
    const maxTrade = Number(p.today.maxTrade);
    if (leg.usd > maxTrade) {
      checks.push({
        id: "trade_size",
        outcome: "escalate",
        detail: `${money(leg.usd)} is above the limit for one trade (${p.mandate.maxTradePct}% of the portfolio, ${money(maxTrade)} now).`,
      });
    } else if (leg.usd > state.volumeLeft) {
      checks.push({
        id: "daily_volume",
        outcome: "escalate",
        detail: `${money(leg.usd)} is more than the ${money(Math.max(state.volumeLeft, 0))} of trading left for today.`,
      });
    } else {
      checks.push({ id: "limits", outcome: "pass", detail: "The size is within the agent's limits." });
    }
  }

  const move = facts.moves[leg.symbol];
  if (move && Math.abs(move.pct) >= ABNORMAL_MOVE_PCT) {
    checks.push({
      id: "abnormal_price",
      outcome: "escalate",
      detail: `${position.name} has ${move.pct > 0 ? "risen" : "fallen"} ${Math.abs(Math.round(move.pct * 10) / 10)}% in the last ${move.minutes} minutes, which is unusual. A person should confirm a trade in a market like this.`,
    });
  }

  if (buying && !position.rule.defensive && p.today.lossPct >= p.mandate.dailyLossPct * LOSS_CHASING_SHARE && p.today.lossPct > 0) {
    checks.push({
      id: "chasing_losses",
      outcome: "escalate",
      detail: `The portfolio is already down ${p.today.lossPct}% today. Adding risk after a loss needs your confirmation.`,
    });
  }

  return checks;
}

function checkContext(facts: Facts): Check[] {
  const p = facts.portfolio;
  const checks: Check[] = [];
  if (!p.mandateSigned) {
    checks.push({ id: "mandate", outcome: "block", detail: "There is no signed mandate yet, so the agent cannot trade." });
  }
  if (p.agent.paused) checks.push({ id: "agent", outcome: "block", detail: "The agent is paused." });
  if (p.agent.keyExpires !== null && new Date(p.agent.keyExpires) <= new Date(p.at)) {
    checks.push({ id: "agent", outcome: "block", detail: "The agent's session key has expired." });
  }

  const recent = facts.history.filter((t) => facts.now.getTime() - t.at.getTime() < VELOCITY_WINDOW_MS);
  if (recent.length >= VELOCITY_MAX_TRADES) {
    checks.push({
      id: "velocity",
      outcome: "block",
      detail: `${recent.length} trades in the last 10 minutes. That is churning, and each trade costs a fee, so trading is paused for now.`,
    });
  }

  // The agent never trades on its own because of something it read.
  if (facts.untrusted) {
    checks.push({
      id: "source",
      outcome: "escalate",
      detail: "This trade was prompted by news or other outside text, not by you or by your plan, so you must confirm it.",
    });
  }
  return checks;
}

export function evaluate(action: Action, facts: Facts): Verdict {
  const state = stateOf(facts.portfolio);
  const legs = action.kind === "rebalance" ? action.legs : [{ symbol: action.symbol, side: action.side, usd: action.usd }];
  const direct = action.kind !== "request_approval";

  const checks: Check[] = direct ? checkContext(facts) : checkContext(facts).filter((c) => c.id !== "velocity");
  if (legs.length === 0) checks.push({ id: "amount", outcome: "block", detail: "There is nothing to trade." });
  for (const leg of legs) {
    checks.push(...checkLeg(leg, facts, state, direct));
    const position = facts.portfolio.positions.find((x) => x.symbol === leg.symbol);
    if (position) apply(state, leg, position);
  }

  const decision = checks.some((c) => c.outcome === "block")
    ? "block"
    : checks.some((c) => c.outcome === "escalate")
      ? "escalate"
      : "allow";

  const reasons = [...new Set(checks.filter((c) => c.outcome === (decision === "allow" ? "pass" : decision)).map((c) => c.detail))];
  const lead = { allow: "Allowed.", escalate: "Needs the owner's approval.", block: "Blocked." }[decision];
  return { decision, checks, explanation: `${lead} ${decision === "allow" ? "Every check passed." : reasons.join(" ")}` };
}
