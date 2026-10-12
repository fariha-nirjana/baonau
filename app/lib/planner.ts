import type { AssetSymbol } from "./assets";
import type { Leg } from "./risk";
import type { Portfolio } from "./vault";

/** Target share of the portfolio per asset, in percent. Whatever is left over stays in cash. */
export type Targets = Partial<Record<AssetSymbol, number>>;

export type RebalancePlan = {
  /** Sells first, then buys, so the buys have cash to spend. */
  legs: Leg[];
  /** How far each asset is from its target, in percentage points. Positive means overweight. */
  drift: Partial<Record<AssetSymbol, number>>;
  /** Why the plan stops short of the targets, when it does. */
  notes: string[];
};

const round = (usd: number) => Math.floor(usd * 1e6) / 1e6;

/**
 * Works out the trades that move the portfolio towards its targets without
 * breaking the mandate: no leg above the per-trade limit, no asset above its
 * cap, no more volume than is left today. Plain arithmetic, so the same
 * portfolio always gives the same plan and the model never does the sums.
 */
export function planRebalance(p: Portfolio, targets: Targets, minTradeUsd?: number): RebalancePlan {
  const total = Number(p.totalValue);
  // the limit is a share of the portfolio, which shrinks a little with each leg's fee, so stay just under it
  const maxTrade = Number(p.today.maxTrade) * 0.99;
  const floor = minTradeUsd ?? Math.max(0.05, total * 0.002);
  const notes: string[] = [];
  const drift: RebalancePlan["drift"] = {};
  const sells: Leg[] = [];
  const buys: Leg[] = [];
  if (total <= 0) return { legs: [], drift, notes: ["The vault is empty."] };

  for (const pos of p.positions) {
    const held = Number(pos.value);
    let target = targets[pos.symbol] ?? 0;
    if (target === 0 && held === 0) continue;
    if (target > pos.rule.maxExposurePct) {
      notes.push(`${pos.name}: the target of ${target}% is above its ${pos.rule.maxExposurePct}% cap, so the cap is used.`);
      target = pos.rule.maxExposurePct;
    }
    drift[pos.symbol] = Math.round((pos.sharePct - target) * 100) / 100;
    const diff = (total * target) / 100 - held;
    if (Math.abs(diff) < floor) continue;

    if (diff < 0) {
      sells.push({ symbol: pos.symbol, side: "sell", usd: round(Math.min(-diff, held)) });
    } else if (!pos.rule.allowed) {
      notes.push(`${pos.name} is not in the mandate, so none is bought.`);
    } else if (pos.rule.stopPrice !== null && Number(pos.price) <= Number(pos.rule.stopPrice)) {
      notes.push(`${pos.name} is at or below its stop price, so none is bought.`);
    } else {
      // leave a little under the cap for the fee, which shrinks the portfolio the share is measured against
      const room = (total * pos.rule.maxExposurePct) / 100 - held - total * 0.002;
      buys.push({ symbol: pos.symbol, side: "buy", usd: round(Math.min(diff, Math.max(room, 0))) });
    }
  }

  sells.sort((a, b) => b.usd - a.usd);
  buys.sort((a, b) => b.usd - a.usd);
  if (buys.length && p.protect.active) {
    notes.push("Buying is paused after a loss trigger, so only the sells are planned.");
    buys.length = 0;
  }

  let volumeLeft = Number(p.today.volumeLeft);
  // keep back a little cash for fees
  let cash = Number(p.cash) - total * 0.003;
  const legs: Leg[] = [];
  for (const leg of [...sells, ...buys]) {
    let usd = leg.usd;
    if (usd > maxTrade) {
      usd = round(maxTrade);
      notes.push(`${leg.symbol}: cut to the per-trade limit of ${p.mandate.maxTradePct}% of the portfolio. The rest can follow in a later rebalance.`);
    }
    if (usd > volumeLeft) {
      usd = round(Math.max(volumeLeft, 0));
      notes.push(`${leg.symbol}: cut to what is left of today's trading volume.`);
    }
    if (leg.side === "buy" && usd > cash) {
      usd = round(Math.max(cash, 0));
      notes.push(`${leg.symbol}: cut to the cash available.`);
    }
    if (usd < floor) continue;
    legs.push({ ...leg, usd });
    volumeLeft -= usd;
    cash += leg.side === "sell" ? usd * 0.997 : -usd;
  }
  return { legs, drift, notes };
}

/** True when any asset is at least `driftPct` percentage points away from its target. */
export function needsRebalance(plan: RebalancePlan, driftPct: number): boolean {
  return Object.values(plan.drift).some((d) => Math.abs(d ?? 0) >= driftPct);
}
