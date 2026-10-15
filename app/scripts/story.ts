// Walks the demo prices along a scripted path, one oracle update per step, and
// records the vault's value after each, so the overview chart has a story to draw:
// a climb, a dip, a recovery. Every point is a real oracle update and a real read.
// Run from app/:
//   npm run story                       15 steps, 20 seconds apart (about 5 minutes)
//   npm run story -- --every 6 --fresh  faster, and clear the chart's earlier readings first
// Prices stay above every stop price and the dip stays far inside the daily loss limit.
import { pushPrices } from "../lib/keeper";
import { writeJson } from "../lib/store";
import { recordValue } from "../lib/values";
import { getPortfolio } from "../lib/vault";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const every = Math.max(5, Number(option("--every") ?? 20)) * 1000;

// multipliers on today's price: index climbs, dips, recovers; gold leans the other way; bonds barely move
const PATH = {
  IDX: [1, 1.008, 1.02, 1.014, 1.03, 1.045, 1.032, 1.006, 0.992, 1.004, 1.024, 1.038, 1.052, 1.047, 1.062],
  GOLD: [1, 0.998, 0.994, 0.997, 0.991, 0.986, 0.99, 1.002, 1.009, 1.006, 0.999, 0.995, 0.99, 0.993, 0.989],
  BOND: [1, 1.0005, 1.001, 1.001, 1.0015, 1.001, 1.0015, 1.002, 1.0025, 1.002, 1.002, 1.0025, 1.003, 1.003, 1.0035],
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const start = await getPortfolio();
  const base = Object.fromEntries(start.positions.map((p) => [p.symbol, Number(p.price)]));
  for (const p of start.positions) {
    const path = PATH[p.symbol as keyof typeof PATH];
    if (!path || !p.rule.stopPrice) continue;
    const low = Math.min(...path) * base[p.symbol];
    if (low <= Number(p.rule.stopPrice)) throw new Error(`${p.symbol} would fall to ${low.toFixed(2)}, at or below its stop price ${p.rule.stopPrice}. Raise its price first.`);
  }
  if (args.includes("--fresh")) writeJson("values.json", []);

  for (let i = 0; i < PATH.IDX.length; i++) {
    const targets = { IDX: base.IDX * PATH.IDX[i], GOLD: base.GOLD * PATH.GOLD[i], BOND: base.BOND * PATH.BOND[i] };
    const pushed = await pushPrices(targets);
    if (!pushed.result.ok) throw new Error(`Price update failed: ${pushed.result.message}`);
    const p = await getPortfolio();
    recordValue({ at: p.at, value: Number(p.totalValue) });
    console.log(`${String(i + 1).padStart(2)}/${PATH.IDX.length}  IDX ${pushed.prices.IDX.toFixed(2)}  GOLD ${pushed.prices.GOLD.toFixed(2)}  BOND ${pushed.prices.BOND.toFixed(2)}  value ${p.totalValue}`);
    if (i < PATH.IDX.length - 1) await sleep(every);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
