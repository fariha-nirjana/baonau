import { parseUnits, type Abi } from "viem";
import { nowIso } from "./clock";
import { priceOracleAbi } from "./abi";
import { assets, SYMBOLS, type AssetSymbol } from "./assets";
import { appendAudit, refOf, type AuditRecord } from "./audit";
import { getClients } from "./chain";
import { chainConfig, PRICE_DECIMALS } from "./config";
import { recordPrices } from "./prices";
import { fromPrice, getPortfolio, sendAsRole, type TxResult } from "./vault";

/**
 * The keeper: the plain script that keeps protection running without the
 * agent. It pushes prices to the oracle, takes the day-start snapshot, starts
 * protect mode when the loss limit is reached and fires stop-losses. Nothing
 * here needs the agent's key or a model, and anyone could run it.
 */

const oracle = () => ({ address: chainConfig().ORACLE_ADDRESS, abi: priceOracleAbi as Abi });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(tool: string, args: Record<string, unknown>, reason: string, result: TxResult) {
  const record: AuditRecord = { at: nowIso(), tool, args, reason, source: "keeper", risk: null };
  appendAudit({ ref: refOf(record), record, result });
}

async function readFeeds() {
  const { publicClient } = getClients();
  const list = SYMBOLS.map((s) => assets()[s]);
  const [minInterval, ...rows] = await Promise.all([
    publicClient.readContract({ ...oracle(), functionName: "minInterval" }) as Promise<bigint>,
    ...list.map((a) => publicClient.readContract({ ...oracle(), functionName: "allowedRange", args: [a.address] }) as Promise<readonly [bigint, bigint]>),
    ...list.map((a) => publicClient.readContract({ ...oracle(), functionName: "getPrice", args: [a.address] }) as Promise<readonly [bigint, bigint]>),
  ]);
  const n = list.length;
  return {
    minIntervalMs: Number(minInterval) * 1000,
    feeds: list.map((a, i) => {
      const [lowest, highest] = rows[i] as readonly [bigint, bigint];
      const [price] = rows[n + i] as readonly [bigint, bigint];
      return { ...a, price, lowest, highest };
    }),
  };
}

/**
 * Pushes one update for all four feeds. A symbol in `targets` moves towards its
 * target as far as the oracle's per-update bound allows; the others are pushed
 * unchanged, which refreshes their timestamps.
 * @returns the prices now on-chain and whether every target was reached
 */
export async function pushPrices(targets: Partial<Record<AssetSymbol, number>> = {}) {
  const { feeds } = await readFeeds();
  let reached = true;
  const next = feeds.map((f) => {
    const target = targets[f.symbol];
    if (target === undefined) return f.price;
    const want = parseUnits(target.toFixed(PRICE_DECIMALS), PRICE_DECIMALS);
    const clamped = want < f.lowest ? f.lowest : want > f.highest ? f.highest : want;
    if (clamped !== want) reached = false;
    return clamped;
  });
  const result = await sendAsRole("updater", "oracle", { functionName: "setPrices", args: [feeds.map((f) => f.address), next] });
  const prices = Object.fromEntries(feeds.map((f, i) => [f.symbol, Number(fromPrice(next[i]))])) as Record<AssetSymbol, number>;
  if (result.ok) recordPrices({ at: nowIso(), prices });
  log("set_prices", { prices }, "Price update", result);
  return { result, prices, reached };
}

/**
 * Pushes fresh prices when any feed is out of date. The app calls this before
 * the agent acts, the way a real price feed would always be current; without
 * it a demo left idle for an hour leaves the agent unable to trade. Does
 * nothing when prices are fresh or when this server has no price updater key.
 */
export async function refreshIfStale(): Promise<boolean> {
  try {
    const p = await getPortfolio();
    if (!p.positions.some((x) => x.priceIsStale)) return false;
    const pushed = await pushPrices();
    return pushed.result.ok;
  } catch {
    return false;
  }
}

/** Moves prices to their targets, in as many updates as the oracle's bounds require. */
export async function movePrices(targets: Partial<Record<AssetSymbol, number>>, onStep?: (prices: Record<AssetSymbol, number>) => void) {
  const { minIntervalMs } = await readFeeds();
  for (let step = 0; step < 40; step++) {
    const pushed = await pushPrices(targets);
    if (!pushed.result.ok) return pushed;
    onStep?.(pushed.prices);
    if (pushed.reached) return pushed;
    await sleep(minIntervalMs + 1000);
  }
  throw new Error("The targets are too far away to reach in 40 oracle updates.");
}

export type KeeperReport = {
  pricesRefreshed: boolean;
  snapshotOrProtect: TxResult | null;
  stopLosses: { symbol: AssetSymbol; result: TxResult }[];
  notes: string[];
};

/**
 * One pass: refresh stale prices, take the day's snapshot or start protect
 * mode if either is due, and trigger every stop-loss whose price has been reached.
 */
export async function keeperTick(opts: { refresh?: boolean } = {}): Promise<KeeperReport> {
  const report: KeeperReport = { pricesRefreshed: false, snapshotOrProtect: null, stopLosses: [], notes: [] };
  let p = await getPortfolio();

  // refresh once prices are halfway to being too old for the vault to trade on
  const halfLife = (p.settings.maxPriceAgeSeconds * 1000) / 2;
  const oldest = Math.min(...p.positions.map((x) => new Date(x.priceUpdatedAt).getTime()));
  if (opts.refresh || new Date(p.at).getTime() - oldest > halfLife) {
    const pushed = await pushPrices();
    report.pricesRefreshed = pushed.result.ok;
    if (!pushed.result.ok) report.notes.push(`Price refresh failed: ${pushed.result.message}`);
    p = await getPortfolio();
  }

  for (const pos of p.positions) {
    const stop = pos.rule.stopPrice;
    if (stop === null || Number(pos.amount) === 0 || Number(pos.price) > Number(stop)) continue;
    if (p.stopLoss.haltedUntil) {
      report.notes.push(`${pos.name} is at its stop price, but the stop-loss is halted until ${p.stopLoss.haltedUntil}.`);
      continue;
    }
    // any key can trigger a stop-loss; the keeper happens to use the price updater's
    const result = await sendAsRole("updater", "vault", { functionName: "triggerStopLoss", args: [pos.address] });
    log("trigger_stop_loss", { asset: pos.symbol, price: pos.price, stopPrice: stop }, `${pos.name} reached its stop price of ${stop}`, result);
    report.stopLosses.push({ symbol: pos.symbol, result });
  }
  if (report.stopLosses.length) p = await getPortfolio();

  const lossLimitHit = p.mandateSigned && p.today.lossPct >= p.mandate.dailyLossPct && p.today.lossPct > 0 && !p.protect.cooldownUntil;
  if (p.mandateSigned && (!p.today.snapshotTaken || lossLimitHit)) {
    const result = await sendAsRole("updater", "vault", { functionName: "poke", args: [] });
    const why = lossLimitHit ? `Down ${p.today.lossPct}% today, at the daily loss limit` : "First touch of the day: record the day-start value";
    log("poke", {}, why, result);
    report.snapshotOrProtect = result;
  }
  return report;
}
