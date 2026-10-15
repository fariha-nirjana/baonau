import scamFile from "../config/scam-tokens.json";
import { BRAND } from "./brand";
import type { AssetSymbol } from "./assets";
import type { AuditEntry } from "./audit";
import { USD_SYMBOL } from "./config";
import type { CommitmentView } from "./commitments";
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
  /** A trade the owner has signed an approval for: the two size limits are lifted, every other gate still applies. */
  | ({ kind: "approved_trade" } & Leg);

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
  /** allow: send it. escalate: ask the owner to sign for it. block: do nothing. */
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

/**
 * The gates, in the order they are checked. A receipt shows every one of them
 * with pass or fail, so the reader sees what was checked and not only what failed.
 */
export const GATE_LABELS: Record<string, string> = {
  mandate: "A mandate is signed",
  agent: "The agent has a live key and is not paused",
  velocity: "Not trading too often",
  source: "Asked for by the investor or the plan",
  scam_list: "Not on the scam token list",
  mandate_asset: "The asset is in the mandate",
  amount: "The amount is more than zero",
  price: "The price is up to date",
  protect_mode: "Buying is not paused after a loss",
  stop_price: "Above the asset's stop price",
  cash: "Enough cash",
  holding: "Enough of the asset to sell",
  exposure: "Inside the asset's cap",
  defensive_floor: "Enough left in cash and defensive assets",
  trade_size: "Inside the single-trade limit",
  daily_volume: "Inside today's trading allowance",
  abnormal_price: "No abnormal price move",
  chasing_losses: "Not adding risk right after a loss",
  commitment_active: "The commitment is active and has a payee",
  payee_screen: "The payee is not on the scam list",
  due_window: "The payment is due",
  commitment_amount: "Inside the commitment's amount",
  reserve: "Enough is set aside for it",
};

function checkLeg(leg: Leg, facts: Facts, state: State, direct: boolean): Check[] {
  const p = facts.portfolio;
  const position = p.positions.find((x) => x.symbol === leg.symbol);
  if (!position) return [{ id: "mandate_asset", outcome: "block", detail: `${leg.symbol} is not a token this vault knows.` }];
  const checks: Check[] = [];
  const buying = leg.side === "buy";
  const gate = (id: string, failed: Outcome | false, fail: string, pass: string) =>
    checks.push(failed ? { id, outcome: failed, detail: fail } : { id, outcome: "pass", detail: pass });
  const round = (share: number) => Math.round(share * 1000) / 10;

  if (buying) {
    const scam = facts.scamList.find((s) => same(s.address, position.address));
    gate("scam_list", scam ? "block" : false, `${position.name} is on the scam token list: ${scam?.label}.`, `${position.name} is not on the scam token list.`);
  }
  if (buying && !position.rule.allowed) {
    // nothing below can matter for an asset the mandate does not include
    gate("mandate_asset", "block", `${position.name} is not in your mandate, so it cannot be bought.`, "");
    return checks;
  }
  gate("mandate_asset", false, "", `${position.name} is in the mandate.`);
  gate("amount", leg.usd <= 0 ? "block" : false, "The amount must be more than zero.", `${money(leg.usd)}.`);
  gate(
    "price",
    position.priceIsStale ? "block" : false,
    `The price of ${position.name} is out of date, so it is not safe to trade on.`,
    `Priced at ${position.price}, updated ${position.priceUpdatedAt}.`,
  );

  if (buying) {
    gate(
      "protect_mode",
      p.protect.active ? "block" : false,
      p.protect.cooldownUntil
        ? `Buying is paused until ${p.protect.cooldownUntil} after a loss trigger. Selling still works.`
        : `The portfolio is down ${p.today.lossPct}% today, at or past the ${p.mandate.dailyLossPct}% daily loss limit, so buying is paused.`,
      `Down ${p.today.lossPct}% today, under the ${p.mandate.dailyLossPct}% limit, and no cooldown is running.`,
    );
    const stop = position.rule.stopPrice;
    gate(
      "stop_price",
      stop !== null && Number(position.price) <= Number(stop) ? "block" : false,
      `${position.name} is at ${position.price}, at or below its stop price of ${stop}.`,
      stop === null ? "No stop price is set for this asset." : `At ${position.price}, above its stop price of ${stop}.`,
    );
    gate("cash", leg.usd > state.cash ? "block" : false, `There is ${money(state.cash)} in cash, less than the ${money(leg.usd)} this needs.`, `${money(state.cash)} in cash.`);
    const after = ((state.value[leg.symbol] ?? 0) + leg.usd) / state.total;
    gate(
      "exposure",
      after * 100 > position.rule.maxExposurePct ? "block" : false,
      `This would make ${position.name} ${round(after)}% of the portfolio. The mandate allows at most ${position.rule.maxExposurePct}%.`,
      `${position.name} would be ${round(after)}% of the portfolio, within its ${position.rule.maxExposurePct}% cap.`,
    );
    if (position.rule.defensive) {
      gate("defensive_floor", false, "", `${position.name} is a defensive asset, so buying it does not lower the defensive share.`);
    } else {
      const defensiveAfter = (state.defensive - leg.usd) / state.total;
      gate(
        "defensive_floor",
        defensiveAfter * 100 < p.mandate.minDefensivePct ? "block" : false,
        `This would leave ${round(defensiveAfter)}% in cash and defensive assets. The mandate requires at least ${p.mandate.minDefensivePct}%.`,
        `${round(defensiveAfter)}% would stay in cash and defensive assets, above the ${p.mandate.minDefensivePct}% minimum.`,
      );
    }
  } else {
    const held = state.value[leg.symbol] ?? 0;
    gate("holding", leg.usd > held * 1.000001 ? "block" : false, `The vault holds ${money(held)} of ${position.name}, less than this sale.`, `The vault holds ${money(held)} of ${position.name}.`);
  }

  // A trade the owner has signed for is allowed past the two size limits. That is all the signature does.
  if (direct) {
    const maxTrade = Number(p.today.maxTrade);
    gate(
      "trade_size",
      leg.usd > maxTrade ? "escalate" : false,
      `${money(leg.usd)} is above the limit for one trade (${p.mandate.maxTradePct}% of the portfolio, ${money(maxTrade)} now).`,
      `Within the limit for one trade (${p.mandate.maxTradePct}% of the portfolio, ${money(maxTrade)} now).`,
    );
    gate(
      "daily_volume",
      leg.usd > state.volumeLeft ? "escalate" : false,
      `${money(leg.usd)} is more than the ${money(Math.max(state.volumeLeft, 0))} of trading left for today.`,
      `${money(Math.max(state.volumeLeft, 0))} of today's trading allowance is left.`,
    );
  } else {
    checks.push({ id: "trade_size", outcome: "pass", detail: "Lifted for this one trade by the owner's signed approval." });
    checks.push({ id: "daily_volume", outcome: "pass", detail: "Lifted for this one trade by the owner's signed approval." });
  }

  const move = facts.moves[leg.symbol];
  gate(
    "abnormal_price",
    move && Math.abs(move.pct) >= ABNORMAL_MOVE_PCT ? "escalate" : false,
    move ? `${position.name} has ${move.pct > 0 ? "risen" : "fallen"} ${Math.abs(Math.round(move.pct * 10) / 10)}% in the last ${move.minutes} minutes, which is unusual. A person should confirm a trade in a market like this.` : "",
    move ? `${position.name} has moved ${Math.round(move.pct * 10) / 10}% in the last ${move.minutes} minutes.` : "No recent price history to compare against.",
  );

  if (buying && !position.rule.defensive) {
    const chasing = p.today.lossPct >= p.mandate.dailyLossPct * LOSS_CHASING_SHARE && p.today.lossPct > 0;
    gate(
      "chasing_losses",
      chasing ? "escalate" : false,
      `The portfolio is already down ${p.today.lossPct}% today. Adding risk after a loss needs your confirmation.`,
      `Down ${p.today.lossPct}% today, less than half the daily loss limit.`,
    );
  }
  return checks;
}

function checkContext(facts: Facts, direct: boolean): Check[] {
  const p = facts.portfolio;
  const checks: Check[] = [];
  const gate = (id: string, failed: Outcome | false, fail: string, pass: string) =>
    checks.push(failed ? { id, outcome: failed, detail: fail } : { id, outcome: "pass", detail: pass });

  gate("mandate", p.mandateSigned ? false : "block", "There is no signed mandate yet, so the agent cannot trade.", "Signed and in force.");
  const noKey = /^0x0+$/.test(p.agent.address);
  const expired = p.agent.keyExpires !== null && new Date(p.agent.keyExpires) <= new Date(p.at);
  gate(
    "agent",
    p.agent.paused || noKey || expired ? "block" : false,
    p.agent.paused ? "The agent is paused." : noKey ? "The agent has no key. The owner must issue one, and a new key waits out the delay." : "The agent's session key has expired.",
    `Key valid until ${p.agent.keyExpires?.slice(0, 10)}.`,
  );

  // An owner-signed trade is one deliberate act, so the churn check does not apply to it.
  if (direct) {
    const recent = facts.history.filter((t) => facts.now.getTime() - t.at.getTime() < VELOCITY_WINDOW_MS);
    gate(
      "velocity",
      recent.length >= VELOCITY_MAX_TRADES ? "block" : false,
      `${recent.length} trades in the last 10 minutes. That is churning, and each trade costs a fee, so trading is paused for now.`,
      `${recent.length} trades in the last 10 minutes.`,
    );
  }

  // The agent never trades on its own because of something it read.
  gate(
    "source",
    facts.untrusted ? "escalate" : false,
    "This trade was prompted by news or other outside text, not by you or by your plan, so you must confirm it.",
    "Prompted by the investor or by the plan.",
  );
  return checks;
}

export function evaluate(action: Action, facts: Facts): Verdict {
  const state = stateOf(facts.portfolio);
  const legs = action.kind === "rebalance" ? action.legs : [{ symbol: action.symbol, side: action.side, usd: action.usd }];
  const direct = action.kind !== "approved_trade";

  const checks: Check[] = checkContext(facts, direct);
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

// ---------------------------------------------------------------- payments

export type PaymentFacts = {
  portfolio: Portfolio;
  commitment: CommitmentView;
  /** The payment in tUSD. */
  amount: number;
  scamList: ScamEntry[];
  now: Date;
  untrusted: boolean;
};

/**
 * Checks a payment the agent wants to make from a commitment. The vault
 * enforces the payee, the amount, the reserve and the due window itself; this
 * adds the scam list, where the instruction came from, and a plain reason.
 * A payment that is not due yet goes to the owner, who may pay early.
 */
export function evaluatePayment(f: PaymentFacts): Verdict {
  const p = f.portfolio;
  const c = f.commitment;
  const checks: Check[] = [];
  const gate = (id: string, failed: Outcome | false, fail: string, pass: string) =>
    checks.push(failed ? { id, outcome: failed, detail: fail } : { id, outcome: "pass", detail: pass });

  gate("mandate", p.mandateSigned ? false : "block", "There is no signed mandate yet, so the agent cannot pay anything.", "Signed and in force.");
  const noKey = /^0x0+$/.test(p.agent.address);
  gate("agent", p.agent.paused || noKey ? "block" : false, p.agent.paused ? "The agent is paused." : "The agent has no key.", "The agent's key is live.");
  gate(
    "source",
    f.untrusted ? "escalate" : false,
    "This payment was prompted by outside text, not by you or a schedule you set, so you must confirm it.",
    "Asked for by you or by a schedule you set.",
  );
  gate(
    "commitment_active",
    c.active && c.payee ? false : "block",
    !c.active ? "This commitment is not active, so nothing can be paid from it." : "This is money set aside with nobody to pay.",
    "Active, with an approved payee.",
  );
  const scam = c.payee ? f.scamList.find((s) => same(s.address, c.payee!)) : undefined;
  gate("payee_screen", scam ? "block" : false, `The payee is on the scam list: ${scam?.label}.`, "The payee is not on the scam list.");
  gate("amount", f.amount <= 0 ? "block" : false, "The amount must be more than zero.", `${money(f.amount)}.`);
  gate(
    "commitment_amount",
    f.amount > Number(c.maxAmount) + 1e-9 ? "block" : false,
    `${money(f.amount)} is more than this commitment allows in one payment (${money(Number(c.maxAmount))}).`,
    `Within the ${money(Number(c.maxAmount))} this commitment allows.`,
  );
  gate(
    "reserve",
    f.amount > Number(c.reserved) + 1e-9 ? "block" : false,
    `Only ${money(Number(c.reserved))} is set aside for it. Top it up first; nothing is taken from your investments.`,
    `${money(Number(c.reserved))} is set aside.`,
  );
  const open = c.payableFrom !== null && f.now.getTime() >= new Date(c.payableFrom).getTime();
  gate(
    "due_window",
    open ? false : "escalate",
    `It is not due yet: ${BRAND.agent} may pay it from ${c.payableFrom}. You can pay it early yourself.`,
    c.nextDue ? `Due ${c.nextDue}.` : "Due now.",
  );

  const decision = checks.some((x) => x.outcome === "block") ? "block" : checks.some((x) => x.outcome === "escalate") ? "escalate" : "allow";
  const reasons = [...new Set(checks.filter((x) => x.outcome === (decision === "allow" ? "pass" : decision)).map((x) => x.detail))];
  const lead = { allow: "Allowed.", escalate: "Needs the owner.", block: "Blocked." }[decision];
  return { decision, checks, explanation: `${lead} ${decision === "allow" ? "Every check passed." : reasons.join(" ")}` };
}
