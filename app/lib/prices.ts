import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AssetSymbol } from "./assets";
import type { PriceMove } from "./risk";
import { dataPath } from "./store";

/** One line per keeper tick, so the risk engine can tell an ordinary price from an abnormal move. */
export type PricePoint = { at: string; prices: Partial<Record<AssetSymbol, number>> };

const FILE = "prices.jsonl";

export function recordPrices(point: PricePoint) {
  const path = dataPath(FILE);
  mkdirSync(dirname(/* turbopackIgnore: true */ path), { recursive: true });
  appendFileSync(/* turbopackIgnore: true */ path, JSON.stringify(point) + "\n");
}

export function readPrices(): PricePoint[] {
  const path = dataPath(FILE);
  if (!existsSync(/* turbopackIgnore: true */ path)) return [];
  return readFileSync(/* turbopackIgnore: true */ path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PricePoint];
      } catch {
        return [];
      }
    });
}

/** The change from the oldest price inside the window to the price now, per asset. */
export function movesFrom(
  history: PricePoint[],
  current: Partial<Record<AssetSymbol, number>>,
  now: Date,
  windowMinutes = 60,
): Partial<Record<AssetSymbol, PriceMove>> {
  const since = now.getTime() - windowMinutes * 60_000;
  const window = history.filter((p) => new Date(p.at).getTime() >= since);
  const moves: Partial<Record<AssetSymbol, PriceMove>> = {};
  for (const symbol of Object.keys(current) as AssetSymbol[]) {
    const first = window.find((p) => p.prices[symbol] !== undefined)?.prices[symbol];
    const last = current[symbol];
    if (first && last) moves[symbol] = { pct: ((last - first) / first) * 100, minutes: windowMinutes };
  }
  return moves;
}
