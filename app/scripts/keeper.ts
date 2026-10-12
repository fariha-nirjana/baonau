// The keeper: prices, the day's snapshot, protect mode and stop-losses. Run from app/:
//   npm run keeper                      one pass (refreshes prices if they are getting old)
//   npm run keeper -- --refresh         one pass, always refreshing prices
//   npm run keeper -- --set IDX=101     move a price (in steps if the oracle's bound requires), then one pass
//   npm run keeper -- --watch 60        a pass every 60 seconds
import type { AssetSymbol } from "../lib/assets";
import { SYMBOLS } from "../lib/assets";
import { keeperTick, movePrices } from "../lib/keeper";

const show = (label: string, value: unknown) => console.log(`${label} ${JSON.stringify(value)}`);

async function pass(refresh: boolean) {
  const report = await keeperTick({ refresh });
  console.log(`prices refreshed: ${report.pricesRefreshed}`);
  for (const s of report.stopLosses) show(`stop-loss ${s.symbol}:`, s.result.ok ? { ok: true, url: s.result.url, events: s.result.events.map((e) => e.name) } : s.result);
  if (report.snapshotOrProtect) show("poke:", report.snapshotOrProtect.ok ? { ok: true, url: report.snapshotOrProtect.url, events: report.snapshotOrProtect.events.map((e) => e.name) } : report.snapshotOrProtect);
  for (const n of report.notes) console.log(`note: ${n}`);
}

async function main() {
  const args = process.argv.slice(2);
  const targets: Partial<Record<AssetSymbol, number>> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") continue;
    const [symbol, price] = (args[i + 1] ?? "").split("=");
    if (!SYMBOLS.includes(symbol as AssetSymbol) || !Number(price)) throw new Error("Use --set SYMBOL=price, e.g. --set IDX=101");
    targets[symbol as AssetSymbol] = Number(price);
  }
  if (Object.keys(targets).length) {
    await movePrices(targets, (prices) => show("prices now:", prices));
  }

  const watchAt = args.indexOf("--watch");
  if (watchAt < 0) return pass(args.includes("--refresh"));
  const every = Number(args[watchAt + 1] ?? 60);
  for (;;) {
    console.log(`\n${new Date().toISOString()}`);
    await pass(false).catch((err) => console.error(err instanceof Error ? err.message : err));
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
