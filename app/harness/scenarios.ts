import type { AssetSymbol } from "../lib/assets";

/**
 * Six synthetic markets, hour by hour for three days. Synthetic on purpose:
 * no third-party price data is used, every path is reproducible from its seed,
 * and each one is built to stress a different rule. None of them is a forecast.
 */

export type Prices = Record<AssetSymbol, number>;
export type Step = {
  /** What the price feed reports. The vault and the agent only ever see this. */
  feed: Prices;
  /** What the assets are really worth. It differs from the feed only in the manipulation scenario. */
  truth: Prices;
};
export type ScenarioId = "bull" | "bear" | "crash" | "choppy" | "flash" | "oracle";
export type Scenario = { id: ScenarioId; name: string; stress: string; steps: Step[] };

export const STEPS = 72;
export const START: Prices = { IDX: 120, BOND: 100, GOLD: 250, MEME: 0.02 };
/** The most one feed update may move each price, as set in the oracle. */
const FEED_BOUND: Prices = { IDX: 0.1, BOND: 0.03, GOLD: 0.05, MEME: 0.5 };
/** Hourly volatility: bond low, gold medium, index medium-high, the meme coin extreme. */
const VOL: Prices = { IDX: 0.006, BOND: 0.001, GOLD: 0.004, MEME: 0.06 };
const SYMBOLS: AssetSymbol[] = ["IDX", "BOND", "GOLD", "MEME"];

/** A small seeded generator, so a seed always gives the same market. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

type Shape = {
  name: string;
  stress: string;
  /** Hourly drift per asset at this step. */
  drift: (step: number) => Partial<Prices>;
  volScale?: number;
  /** Extra hourly move the feed reports on top of the truth, for the manipulation scenario. */
  feedSkew?: (step: number) => Partial<Prices>;
};

const SHAPES: Record<ScenarioId, Shape> = {
  bull: {
    name: "Steady growth",
    stress: "Do the limits get in the way when nothing is wrong?",
    drift: () => ({ IDX: 0.002, GOLD: 0.0005, BOND: 0.0001, MEME: 0.005 }),
  },
  bear: {
    name: "Long decline",
    stress: "A slow loss, day after day.",
    drift: () => ({ IDX: -0.002, GOLD: -0.0003, BOND: 0.0001, MEME: -0.008 }),
  },
  crash: {
    name: "Crash",
    stress: "The index loses about 30% in half a day. The stop-loss and the daily loss limit are both in play.",
    drift: (s) => (s >= 24 && s < 36 ? { IDX: -0.03, GOLD: -0.008, BOND: 0.0005, MEME: -0.08 } : { BOND: 0.0001 }),
  },
  choppy: {
    name: "Flat and choppy",
    stress: "Lots of movement going nowhere. Fees and losing sells add up.",
    drift: () => ({}),
    volScale: 2.5,
  },
  flash: {
    name: "Flash crash",
    stress: "A sharp fall that recovers within hours. Does protection overreact?",
    drift: (s) => (s === 30 || s === 31 ? { IDX: -0.09, GOLD: -0.02 } : s >= 32 && s < 38 ? { IDX: 0.033, GOLD: 0.007 } : {}),
  },
  oracle: {
    name: "Price feed manipulation",
    stress: "The feed reports a fall that did not happen. The vault trusts the feed, so this is the scenario that shows its limits.",
    drift: () => ({}),
    volScale: 0.5,
    feedSkew: (s) => (s >= 30 && s < 34 ? { IDX: -0.095 } : s >= 34 && s < 38 ? { IDX: 0.105 } : {}),
  },
};

export const SCENARIO_IDS = Object.keys(SHAPES) as ScenarioId[];

export function buildScenario(id: ScenarioId, seed: number): Scenario {
  const shape = SHAPES[id];
  const rand = rng(seed * 7919 + SCENARIO_IDS.indexOf(id) * 104729 + 1);
  let truth = { ...START };
  let feed = { ...START };
  const steps: Step[] = [];
  for (let s = 0; s < STEPS; s++) {
    const drift = shape.drift(s);
    const skew = shape.feedSkew?.(s) ?? {};
    const nextTruth = { ...truth };
    const nextFeed = { ...feed };
    for (const sym of SYMBOLS) {
      const move = (drift[sym] ?? 0) + VOL[sym] * (shape.volScale ?? 1) * gaussian(rand);
      nextTruth[sym] = Math.max(truth[sym] * (1 + move), START[sym] * 0.01);
      // the feed follows the truth unless it is being pushed off it, and never faster than the oracle allows
      const wanted = skew[sym] !== undefined ? feed[sym] * (1 + skew[sym]!) : nextTruth[sym];
      const low = feed[sym] * (1 - FEED_BOUND[sym]);
      const high = feed[sym] * (1 + FEED_BOUND[sym]);
      nextFeed[sym] = Math.min(Math.max(wanted, low), high);
    }
    truth = nextTruth;
    feed = nextFeed;
    steps.push({ feed: round(feed), truth: round(truth) });
  }
  // by the last step the feed has caught up with the truth again, so both worlds are valued on the same prices
  steps[STEPS - 1].feed = { ...steps[STEPS - 1].truth };
  return { id, name: shape.name, stress: shape.stress, steps };
}

function round(p: Prices): Prices {
  return { IDX: +p.IDX.toFixed(4), BOND: +p.BOND.toFixed(4), GOLD: +p.GOLD.toFixed(4), MEME: +p.MEME.toFixed(6) };
}

export const scenarioMeta = SCENARIO_IDS.map((id) => ({ id, name: SHAPES[id].name, stress: SHAPES[id].stress }));
