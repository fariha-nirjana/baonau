import type { AssetSymbol } from "./assets";
import type { Portfolio, Position } from "./vault";

/** A portfolio for tests: 1,000 tUSD with the demo mandate, built without touching a chain. */
export function testPortfolio(over: { values?: Partial<Record<AssetSymbol, number>>; patch?: (p: Portfolio) => void } = {}): Portfolio {
  const values: Record<AssetSymbol, number> = { IDX: 300, BOND: 300, GOLD: 100, MEME: 0, ...over.values };
  const total = 1000;
  const cash = total - values.IDX - values.BOND - values.GOLD - values.MEME;
  const position = (symbol: AssetSymbol, name: string, price: number, cap: number, defensive: boolean, allowed = true): Position => ({
    symbol,
    name,
    label: `${name}, simulated test asset (testnet)`,
    address: `0x${symbol.charCodeAt(0).toString(16).padStart(40, "0")}`,
    amount: String(values[symbol] / price),
    price: String(price),
    priceUpdatedAt: "2026-10-13T00:00:00.000Z",
    priceIsStale: false,
    value: String(values[symbol]),
    cost: String(values[symbol]),
    sharePct: (values[symbol] / total) * 100,
    rule: { allowed, defensive, maxExposurePct: cap, stopPrice: symbol === "IDX" ? "102" : null },
    pendingRule: null,
  });
  const p: Portfolio = {
    at: "2026-10-13T00:10:00.000Z",
    vaultAddress: "0x00000000000000000000000000000000000000f1",
    mandateAddress: "0x00000000000000000000000000000000000000f2",
    totalValue: String(total),
    cash: String(cash),
    setAside: "0",
    commitments: [],
    cashSharePct: (cash / total) * 100,
    defensiveSharePct: ((cash + values.BOND) / total) * 100,
    positions: [
      position("IDX", "Index fund", 120, 40, false),
      position("BOND", "Bond fund", 100, 60, true),
      position("GOLD", "Gold", 250, 20, false),
      position("MEME", "Moon Meme Coin", 0.02, 0, false, false),
    ],
    mandate: { maxTradePct: 10, maxDailyVolumePct: 40, dailyLossPct: 8, maxSlippagePct: 1, minDefensivePct: 25, maxLossStreak: 3, cooldownSeconds: 600 },
    mandateSigned: true,
    signableFrom: null,
    today: { snapshotTaken: true, startValue: String(total), lossPct: 0, maxTrade: "100", volumeUsed: "0", volumeLeft: "400", lossStreak: 0 },
    protect: { active: false, cooldownUntil: null },
    agentExposure: { tradable: "400", maxCost: "4" },
    agent: { address: "0x00000000000000000000000000000000000000a1", keyExpires: "2026-12-12T00:00:00.000Z", paused: false, pausedBy: null },
    stopLoss: { haltedUntil: null, haltRequestAppliesFrom: null },
    keys: {
      owner: "0x00000000000000000000000000000000000000b1",
      guardian: "0x00000000000000000000000000000000000000c1",
      withdrawalAddress: "0x00000000000000000000000000000000000000b1",
    },
    pending: { mandate: null, withdrawalAddress: null, agentKey: null, guardian: null, waitingPeriod: null, unpause: null },
    settings: { loosenDelaySeconds: 120, maxPriceAgeSeconds: 3600 },
  };
  over.patch?.(p);
  return p;
}
