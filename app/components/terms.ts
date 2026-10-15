import type { Draft } from "@/lib/drafts";
import { fill, formatLeft, type Strings } from "./i18n";
import { ASSET_NAME, money } from "./Overview";
import type { AppState, Settings } from "./types";

// ---------------------------------------------------------------- plain terms

/** A mandate draft as plain sentences with the investor's own money. */
export function plainTerms(payload: NonNullable<Draft["payload"]>, state: AppState, settings: Settings, t: Strings): string[] {
  const m = payload.mandate;
  const value = Number(state.portfolio.totalValue);
  const names = ASSET_NAME[settings.language];
  // a stop price reads better as a fall from today's price
  const stopText = (symbol: string, stop: number) => {
    const price = Number(state.portfolio.positions.find((x) => x.symbol === symbol)?.price ?? 0);
    const drop = price > 0 ? Math.round((1 - stop / price) * 100) : 0;
    return fill(t.plain.stop, { drop, price: stop.toLocaleString("en-US", { maximumFractionDigits: 2 }) });
  };
  const out = [
    fill(t.plain.trade, { pct: m.maxTradePct, amount: money(value * (m.maxTradePct / 100), settings.currency) }),
    fill(t.plain.day, { pct: m.maxDailyVolumePct, amount: money(value * (m.maxDailyVolumePct / 100), settings.currency) }),
    fill(t.plain.loss, { pct: m.dailyLossPct }),
  ];
  if (m.maxLossStreak) out.push(fill(t.plain.streak, { n: m.maxLossStreak, time: formatLeft(m.cooldownSeconds, t) }));
  out.push(fill(t.plain.floor, { pct: m.minDefensivePct }), fill(t.plain.slippage, { pct: m.maxSlippagePct }));
  for (const [symbol, rule] of Object.entries(payload.rules) as [keyof typeof names, NonNullable<(typeof payload.rules)[keyof typeof payload.rules]>][]) {
    out.push(
      rule.allowed
        ? fill(t.plain.asset, { asset: names[symbol], pct: rule.maxExposurePct, stop: rule.stopPrice ? stopText(symbol, Number(rule.stopPrice)) : "" })
        : fill(t.plain.notAllowed, { asset: names[symbol] }),
    );
  }
  for (const r of payload.plan.recurring) {
    out.push(fill(r.everyHours === 24 ? t.plain.recurringDay : t.plain.recurring, { amount: money(r.usd, settings.currency), asset: names[r.symbol], hours: r.everyHours }));
  }
  out.push(t.plain.always);
  return out;
}

