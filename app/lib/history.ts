import { decodeEventLog, formatUnits, type Hex } from "viem";
import { mandateAbi } from "./abi";
import { assetByAddress } from "./assets";
import { chainConfig, PRICE_DECIMALS } from "./config";

/**
 * The mandate as it was signed, and every change to it since, read from the
 * mandate contract's own events. The public RPC only serves 200 blocks of
 * logs per call, so the events come from the Blockscout explorer's API in one
 * request instead. Nothing here is written by the app: it is what the chain
 * recorded.
 */

export type Terms = {
  maxTradePct: number;
  maxDailyVolumePct: number;
  dailyLossPct: number;
  maxSlippagePct: number;
  minDefensivePct: number;
  maxLossStreak: number;
  cooldownMinutes: number;
};

export type Rule = { symbol: string; allowed: boolean; defensive: boolean; maxExposurePct: number; stopPrice: string | null };

export type Change = {
  /** The event's name, e.g. PolicyChanged, AssetRuleChanged, GuardianChanged. */
  kind: string;
  at: string;
  tx: Hex;
  url: string;
  terms?: Terms;
  rule?: Rule;
  /** For address changes and the agent key. */
  address?: string;
  /** Waiting period in seconds, for LoosenDelayChanged. */
  seconds?: number;
};

export type SignedMandate = {
  at: string;
  tx: Hex;
  url: string;
  terms: Terms | null;
  rules: Rule[];
  agent: { address: string; expires: string } | null;
  /** Changes that took effect after signing, oldest first. Proposals that were cancelled are not here. */
  changes: Change[];
  /** How many riskier changes were proposed and how many were cancelled, for context. */
  proposed: number;
  cancelled: number;
};

type ExplorerLog = { topics: (Hex | null)[]; data: Hex; transactionHash: Hex; timeStamp: Hex; blockNumber: Hex; logIndex: Hex };

const pct = (bps: unknown) => Number(bps) / 100;

function termsOf(p: Record<string, unknown>): Terms {
  return {
    maxTradePct: pct(p.maxTradeBps),
    maxDailyVolumePct: pct(p.maxDailyVolumeBps),
    dailyLossPct: pct(p.dailyLossBps),
    maxSlippagePct: pct(p.maxSlippageBps),
    minDefensivePct: pct(p.minDefensiveBps),
    maxLossStreak: Number(p.maxLossStreak),
    cooldownMinutes: Math.round(Number(p.cooldown) / 60),
  };
}

function ruleOf(asset: string, r: Record<string, unknown>): Rule {
  const stop = BigInt(r.stopPrice as bigint);
  return {
    symbol: assetByAddress(asset)?.token ?? asset,
    allowed: Boolean(r.allowed),
    defensive: Boolean(r.defensive),
    maxExposurePct: pct(r.maxExposureBps),
    stopPrice: stop === 0n ? null : formatUnits(stop, PRICE_DECIMALS),
  };
}

let cache: { at: number; value: SignedMandate | null } | null = null;
const CACHE_MS = 30_000;

/** The explorer API for this chain. Base Sepolia's Blockscout unless set. */
function explorerApi() {
  return process.env.BLOCKSCOUT_API_URL ?? "https://base-sepolia.blockscout.com/api";
}

const creation = new Map<string, number>();

/** The block the mandate was created in, so the log search does not start from the genesis block (that query times out). */
async function createdAt(mandate: string): Promise<number> {
  const known = creation.get(mandate.toLowerCase());
  if (known !== undefined) return known;
  const res = await fetch(`${explorerApi()}?module=contract&action=getcontractcreation&contractaddresses=${mandate}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as { result?: { blockNumber?: string }[] };
  const block = Number(body.result?.[0]?.blockNumber ?? 0);
  if (!block) throw new Error("the explorer does not know when the mandate was created");
  creation.set(mandate.toLowerCase(), block);
  return block;
}

export async function signedMandate(mandate: string): Promise<SignedMandate | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const fromBlock = await createdAt(mandate);
  const url = `${explorerApi()}?module=logs&action=getLogs&address=${mandate}&fromBlock=${fromBlock}&toBlock=latest`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`explorer answered ${res.status}`);
  const body = (await res.json()) as { status: string; message: string; result: ExplorerLog[] | string };
  const logs = Array.isArray(body.result) ? body.result : [];
  const txUrl = (tx: Hex) => `${chainConfig().EXPLORER_URL}/tx/${tx}`;

  const events = logs
    .map((l) => {
      try {
        const decoded = decodeEventLog({ abi: mandateAbi, topics: l.topics.filter(Boolean) as [Hex, ...Hex[]], data: l.data });
        return { name: decoded.eventName as string, args: decoded.args as unknown as Record<string, unknown>, tx: l.transactionHash, at: new Date(Number(l.timeStamp) * 1000).toISOString(), order: Number(l.blockNumber) * 10_000 + Number(l.logIndex) };
      } catch {
        return null;
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.order - b.order);

  const signing = events.find((e) => e.name === "MandateSigned");
  if (!signing) {
    cache = { at: Date.now(), value: null };
    return null;
  }
  const inSigning = events.filter((e) => e.tx === signing.tx);
  const policy = inSigning.find((e) => e.name === "PolicyChanged");
  const agent = inSigning.find((e) => e.name === "AgentSet");
  const after = events.filter((e) => e.order > signing.order);

  const changes: Change[] = [];
  for (const e of after) {
    const base = { kind: e.name, at: e.at, tx: e.tx, url: txUrl(e.tx) };
    if (e.name === "PolicyChanged") changes.push({ ...base, terms: termsOf(e.args.policy as Record<string, unknown>) });
    else if (e.name === "AssetRuleChanged") changes.push({ ...base, rule: ruleOf(String(e.args.asset), e.args.rule as Record<string, unknown>) });
    else if (e.name === "GuardianChanged") changes.push({ ...base, address: String(e.args.to) });
    else if (e.name === "WithdrawalAddressChanged") changes.push({ ...base, address: String(e.args.to) });
    else if (e.name === "LoosenDelayChanged") changes.push({ ...base, seconds: Number(e.args.delay) });
    else if (e.name === "AgentSet") changes.push({ ...base, address: String(e.args.agent) });
    else if (e.name === "AgentRevoked") changes.push({ ...base });
  }

  const value: SignedMandate = {
    at: signing.at,
    tx: signing.tx,
    url: txUrl(signing.tx),
    terms: policy ? termsOf(policy.args.policy as Record<string, unknown>) : null,
    rules: inSigning.filter((e) => e.name === "AssetRuleChanged").map((e) => ruleOf(String(e.args.asset), e.args.rule as Record<string, unknown>)),
    agent: agent ? { address: String(agent.args.agent), expires: new Date(Number(agent.args.expiry) * 1000).toISOString() } : null,
    changes,
    proposed: after.filter((e) => e.name.endsWith("Proposed")).length,
    cancelled: after.filter((e) => e.name === "ChangeCancelled").length,
  };
  cache = { at: Date.now(), value };
  return value;
}
