import { formatUnits, parseEventLogs, parseUnits, type Abi, type Address, type Hex } from "viem";
import { policyVaultAbi, priceOracleAbi } from "./abi";
import { assets, SYMBOLS, type AssetSymbol } from "./assets";
import { getClients, hasMulticall, roleClient, txUrl, type DemoRole } from "./chain";
import { chainConfig, PRICE_DECIMALS, USD_DECIMALS } from "./config";
import { decodePolicyError, errorMessage, type PolicyError } from "./errors";

export const toUsdUnits = (amount: string) => parseUnits(amount, USD_DECIMALS);
export const fromUsdUnits = (amount: bigint) => formatUnits(amount, USD_DECIMALS);
export const toAssetUnits = (amount: string) => parseUnits(amount, 18);
export const fromAssetUnits = (amount: bigint) => formatUnits(amount, 18);
export const fromPrice = (price: bigint) => formatUnits(price, PRICE_DECIMALS);

const vault = () => ({ address: chainConfig().VAULT_ADDRESS, abi: policyVaultAbi }) as const;
const iso = (seconds: bigint | number) => new Date(Number(seconds) * 1000).toISOString();
const orNull = (seconds: bigint | number) => (Number(seconds) === 0 ? null : iso(seconds));

// ---------------------------------------------------------------- reads

/** The mandate as signed, with shares as percentages. */
export type Mandate = {
  maxTradePct: number;
  maxDailyVolumePct: number;
  dailyLossPct: number;
  maxSlippagePct: number;
  minDefensivePct: number;
  /** Losing sells in a row that start a cooldown. Zero means the rule is off. */
  maxLossStreak: number;
  cooldownSeconds: number;
};

export type AssetRule = { allowed: boolean; defensive: boolean; maxExposurePct: number; stopPrice: string | null };

export type Position = {
  symbol: AssetSymbol;
  name: string;
  label: string;
  address: Address;
  /** Units held, as a decimal string. */
  amount: string;
  price: string;
  priceUpdatedAt: string;
  priceIsStale: boolean;
  /** Value in tUSD. */
  value: string;
  /** What the units held now cost, in tUSD. */
  cost: string;
  sharePct: number;
  rule: AssetRule;
  /** A looser rule that is waiting out the delay, if any. */
  pendingRule: (AssetRule & { appliesFrom: string }) | null;
};

export type Portfolio = {
  /** Chain time of this reading. Countdowns are measured against it, not the local clock. */
  at: string;
  totalValue: string;
  cash: string;
  cashSharePct: number;
  defensiveSharePct: number;
  positions: Position[];
  mandate: Mandate;
  /** False until the owner has signed a first mandate. */
  mandateSigned: boolean;
  today: {
    /** False until someone has touched the vault on this UTC day and the day-start value has been taken. */
    snapshotTaken: boolean;
    startValue: string;
    lossPct: number;
    /** Largest single trade the agent can make right now, in tUSD. */
    maxTrade: string;
    volumeUsed: string;
    volumeLeft: string;
    lossStreak: number;
  };
  protect: {
    /** True while buying is blocked by the daily loss limit or a cooldown. */
    active: boolean;
    cooldownUntil: string | null;
  };
  /** What a fully compromised agent key could still do today. It can send nothing out of the vault. */
  agentExposure: { tradable: string; maxCost: string };
  agent: { address: Address; keyExpires: string | null; paused: boolean };
  stopLoss: { haltedUntil: string | null; haltRequestAppliesFrom: string | null };
  keys: { owner: Address; guardian: Address; withdrawalAddress: Address };
  pending: {
    mandate: (Mandate & { appliesFrom: string }) | null;
    withdrawalAddress: { to: Address; appliesFrom: string } | null;
  };
  settings: { loosenDelaySeconds: number; maxPriceAgeSeconds: number };
};

type Read = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

/** One round trip where the chain has multicall, plain parallel reads where it does not. */
async function readAll(reads: Read[], blockNumber?: bigint): Promise<unknown[]> {
  const { publicClient } = getClients();
  if (hasMulticall()) {
    return publicClient.multicall({ allowFailure: false, contracts: reads, blockNumber }) as Promise<unknown[]>;
  }
  return Promise.all(reads.map((r) => publicClient.readContract({ ...r, blockNumber })));
}

type RawPolicy = {
  maxTradeBps: number;
  maxDailyVolumeBps: number;
  dailyLossBps: number;
  maxSlippageBps: number;
  minDefensiveBps: number;
  maxLossStreak: number;
  cooldown: number;
};
type RawRule = { allowed: boolean; defensive: boolean; maxExposureBps: number; stopPrice: bigint };

const mandateOf = (p: RawPolicy): Mandate => ({
  maxTradePct: p.maxTradeBps / 100,
  maxDailyVolumePct: p.maxDailyVolumeBps / 100,
  dailyLossPct: p.dailyLossBps / 100,
  maxSlippagePct: p.maxSlippageBps / 100,
  minDefensivePct: p.minDefensiveBps / 100,
  maxLossStreak: p.maxLossStreak,
  cooldownSeconds: p.cooldown,
});

const ruleOf = (r: RawRule): AssetRule => ({
  allowed: r.allowed,
  defensive: r.defensive,
  maxExposurePct: r.maxExposureBps / 100,
  stopPrice: r.stopPrice === 0n ? null : fromPrice(r.stopPrice),
});

const ruleKey = (asset: Address) => `0x${asset.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
const textKey = (text: string) => `0x${Buffer.from(text, "utf8").toString("hex").padEnd(64, "0")}` as Hex;
export const CHANGE_KEYS = {
  mandate: textKey("policy"),
  stopLossHalt: textKey("stop-loss halt"),
  withdrawalAddress: textKey("withdrawal address"),
  rule: ruleKey,
} as const;

export async function getPortfolio(): Promise<Portfolio> {
  const { publicClient } = getClients();
  const cfg = chainConfig();
  const v = vault();
  const oracle = { address: cfg.ORACLE_ADDRESS, abi: priceOracleAbi as Abi };
  const list = SYMBOLS.map((s) => assets()[s]);
  const block = await publicClient.getBlock();

  const scalar: Read[] = [
    { ...v, functionName: "getPolicy" },
    { ...v, functionName: "getPendingPolicy" },
    { ...v, functionName: "holdings", args: [cfg.USD_ADDRESS] },
    { ...v, functionName: "portfolioValue" },
    { ...v, functionName: "defensiveBps" },
    { ...v, functionName: "drawdownBps" },
    { ...v, functionName: "inProtectMode" },
    { ...v, functionName: "dailyVolumeRemaining" },
    { ...v, functionName: "agentExposure" },
    { ...v, functionName: "dayStartValue" },
    { ...v, functionName: "day" },
    { ...v, functionName: "volumeToday" },
    { ...v, functionName: "cooldownUntil" },
    { ...v, functionName: "lossStreak" },
    { ...v, functionName: "paused" },
    { ...v, functionName: "initialized" },
    { ...v, functionName: "agent" },
    { ...v, functionName: "agentExpiry" },
    { ...v, functionName: "owner" },
    { ...v, functionName: "guardian" },
    { ...v, functionName: "withdrawalAddress" },
    { ...v, functionName: "pendingWithdrawalAddress" },
    { ...v, functionName: "stopLossHaltedUntil" },
    { ...v, functionName: "loosenDelay" },
    { ...v, functionName: "maxPriceAge" },
    { ...v, functionName: "pendingEta", args: [CHANGE_KEYS.mandate] },
    { ...v, functionName: "pendingEta", args: [CHANGE_KEYS.stopLossHalt] },
    { ...v, functionName: "pendingEta", args: [CHANGE_KEYS.withdrawalAddress] },
  ];
  const perAsset = (a: Address): Read[] => [
    { ...v, functionName: "holdings", args: [a] },
    { ...v, functionName: "costBasis", args: [a] },
    { ...v, functionName: "getRule", args: [a] },
    { ...v, functionName: "getPendingRule", args: [a] },
    { ...v, functionName: "pendingEta", args: [ruleKey(a)] },
    { ...oracle, functionName: "getPrice", args: [a] },
  ];
  const PER = 6;
  const out = await readAll([...scalar, ...list.flatMap((a) => perAsset(a.address))], block.number);

  const [policy, pendingPolicy, cash, total, defensiveBps, drawdownBps, inProtect, volumeLeft, exposure] = out as [
    RawPolicy, RawPolicy, bigint, bigint, bigint, bigint, boolean, bigint, readonly [bigint, bigint],
  ];
  const [dayStart, day, volumeToday, cooldownUntil, lossStreak, paused, initialized, agent, agentExpiry] = out.slice(9) as [
    bigint, bigint, bigint, bigint, number, boolean, boolean, Address, bigint,
  ];
  const [owner, guardian, withdrawalAddress, pendingWithdrawal, haltedUntil, loosenDelay, maxPriceAge] = out.slice(18) as [
    Address, Address, Address, Address, bigint, bigint, bigint,
  ];
  const [mandateEta, haltEta, withdrawalEta] = out.slice(25) as [bigint, bigint, bigint];

  const now = block.timestamp;
  const sameDay = now / 86400n === BigInt(day);
  const share = (value: bigint) => (total === 0n ? 0 : Number((value * 10000n) / total) / 100);

  const positions = list.map((a, i): Position => {
    const [held, cost, rule, pendingRule, ruleEta, priceTuple] = out.slice(scalar.length + i * PER) as [
      bigint, bigint, RawRule, RawRule, bigint, readonly [bigint, bigint],
    ];
    const [px, updatedAt] = priceTuple;
    const value = (held * px) / 10n ** 20n;
    return {
      symbol: a.symbol,
      name: a.name,
      label: a.label,
      address: a.address,
      amount: fromAssetUnits(held),
      price: fromPrice(px),
      priceUpdatedAt: iso(updatedAt),
      priceIsStale: now > updatedAt + maxPriceAge,
      value: fromUsdUnits(value),
      cost: fromUsdUnits(cost),
      sharePct: share(value),
      rule: ruleOf(rule),
      pendingRule: ruleEta === 0n ? null : { ...ruleOf(pendingRule), appliesFrom: iso(ruleEta) },
    };
  });

  return {
    at: iso(now),
    totalValue: fromUsdUnits(total),
    cash: fromUsdUnits(cash),
    cashSharePct: share(cash),
    defensiveSharePct: Number(defensiveBps) / 100,
    positions,
    mandate: mandateOf(policy),
    mandateSigned: initialized,
    today: {
      snapshotTaken: sameDay,
      startValue: fromUsdUnits(sameDay ? dayStart : total),
      lossPct: Number(drawdownBps) / 100,
      maxTrade: fromUsdUnits((total * BigInt(policy.maxTradeBps)) / 10000n),
      volumeUsed: fromUsdUnits(sameDay ? volumeToday : 0n),
      volumeLeft: fromUsdUnits(volumeLeft),
      lossStreak,
    },
    protect: { active: inProtect, cooldownUntil: cooldownUntil > now ? iso(cooldownUntil) : null },
    agentExposure: { tradable: fromUsdUnits(exposure[0]), maxCost: fromUsdUnits(exposure[1]) },
    agent: { address: agent, keyExpires: orNull(agentExpiry), paused },
    stopLoss: { haltedUntil: haltedUntil > now ? iso(haltedUntil) : null, haltRequestAppliesFrom: orNull(haltEta) },
    keys: { owner, guardian, withdrawalAddress },
    pending: {
      mandate: mandateEta === 0n ? null : { ...mandateOf(pendingPolicy), appliesFrom: iso(mandateEta) },
      withdrawalAddress: withdrawalEta === 0n ? null : { to: pendingWithdrawal, appliesFrom: iso(withdrawalEta) },
    },
    settings: { loosenDelaySeconds: Number(loosenDelay), maxPriceAgeSeconds: Number(maxPriceAge) },
  };
}

/** A trade the agent asked the owner to approve. */
export type TradeRequest = {
  id: number;
  symbol: AssetSymbol | null;
  name: string;
  side: "buy" | "sell";
  /** Value in tUSD: what a buy would spend, or what a sell is worth at the current price. */
  usd: string;
  expires: string;
  ref: Hex;
};

/** The pending, unexpired requests among the latest twelve. */
export async function getRequests(): Promise<TradeRequest[]> {
  const { publicClient } = getClients();
  const v = vault();
  const [count, block] = await Promise.all([publicClient.readContract({ ...v, functionName: "requestCount" }), publicClient.getBlock()]);
  const ids = Array.from({ length: Math.min(Number(count), 12) }, (_, i) => Number(count) - i);
  if (ids.length === 0) return [];
  const rows = (await readAll(ids.map((id) => ({ ...v, abi: v.abi as Abi, functionName: "getRequest", args: [BigInt(id)] })))) as {
    asset: Address;
    isBuy: boolean;
    amount: bigint;
    ref: Hex;
    expiry: bigint;
    status: number;
  }[];
  const list = SYMBOLS.map((s) => assets()[s]);
  const prices = (await readAll(
    list.map((a) => ({ address: chainConfig().ORACLE_ADDRESS, abi: priceOracleAbi as Abi, functionName: "getPrice", args: [a.address] })),
  )) as (readonly [bigint, bigint])[];
  return rows.flatMap((r, i) => {
    if (r.status !== 1 || r.expiry < block.timestamp) return [];
    const at = list.findIndex((a) => a.address.toLowerCase() === r.asset.toLowerCase());
    const usd = r.isBuy ? r.amount : at < 0 ? 0n : (r.amount * prices[at][0]) / 10n ** 20n;
    return [
      {
        id: ids[i],
        symbol: at < 0 ? null : list[at].symbol,
        name: at < 0 ? r.asset : list[at].name,
        side: r.isBuy ? ("buy" as const) : ("sell" as const),
        usd: fromUsdUnits(usd),
        expires: iso(r.expiry),
        ref: r.ref,
      },
    ];
  });
}

// ---------------------------------------------------------------- writes

export type Order = { asset: Address; isBuy: boolean; amount: bigint };

/** The calls the agent's key is meant to make. */
export type AgentCall =
  | { functionName: "buy"; args: readonly [asset: Address, usdIn: bigint, ref: Hex] }
  | { functionName: "sell"; args: readonly [asset: Address, amount: bigint, ref: Hex] }
  | { functionName: "rebalance"; args: readonly [orders: readonly Order[], ref: Hex] }
  | { functionName: "requestTrade"; args: readonly [asset: Address, isBuy: boolean, amount: bigint, ref: Hex] };

/** Any vault function at all, for showing what happens when the agent key tries something it must not. */
export type RawCall = { functionName: string; args: readonly unknown[] };

/** An event emitted by the transaction, with its arguments as strings. */
export type TxEvent = { name: string; args: Record<string, string> };

export type TxResult =
  | { ok: true; hash: Hex; url: string; block: string; events: TxEvent[] }
  | {
      ok: false;
      /** preflight: refused in simulation, nothing sent. onchain: sent, mined and reverted by the contract. */
      stage: "preflight" | "onchain" | "network";
      error: PolicyError | null;
      message: string;
      hash?: Hex;
      url?: string;
    };

export type SendOptions = {
  /**
   * Skip the simulation and send the transaction even if it will revert.
   * Used to show the contract refusing a call when every off-chain check is bypassed.
   */
  force?: boolean;
};

/**
 * Public RPC endpoints are load balanced, and a node can lag a block or two behind
 * the one that mined our transaction. Wait until reads at that block succeed, so the
 * next read or simulation does not see stale state.
 */
async function untilNodeHasBlock(blockNumber: bigint) {
  const { publicClient } = getClients();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await publicClient.readContract({ ...vault(), functionName: "paused", blockNumber });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const stringify = (value: unknown): string =>
  typeof value === "object" && value !== null
    ? JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))
    : String(value);

type Sender = { account: ReturnType<typeof getClients>["agentAccount"]; client: ReturnType<typeof getClients>["agentClient"] };

async function send(sender: Sender, target: { address: Address; abi: Abi }, call: RawCall, opts: SendOptions): Promise<TxResult> {
  const { publicClient } = getClients();
  const request = { ...target, ...call, account: sender.account };

  if (!opts.force) {
    try {
      await publicClient.simulateContract(request);
    } catch (err) {
      return { ok: false, stage: "preflight", error: decodePolicyError(err), message: errorMessage(err) };
    }
  }

  let hash: Hex;
  try {
    // a fixed gas limit skips gas estimation, which would otherwise refuse to send a reverting call
    hash = await sender.client.writeContract({ ...request, chain: sender.client.chain, ...(opts.force ? { gas: 900_000n } : {}) });
  } catch (err) {
    return { ok: false, stage: "network", error: decodePolicyError(err), message: errorMessage(err) };
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: hasMulticall() ? 2 : 1 });
  await untilNodeHasBlock(receipt.blockNumber);
  if (receipt.status === "success") {
    const events = parseEventLogs({ abi: target.abi, logs: receipt.logs }).map((log) => ({
      name: log.eventName,
      args: Object.fromEntries(Object.entries((log.args ?? {}) as Record<string, unknown>).map(([k, v]) => [k, stringify(v)])),
    }));
    return { ok: true, hash, url: txUrl(hash), block: receipt.blockNumber.toString(), events };
  }

  // The transaction is on-chain and reverted. Replay it to read the contract's reason.
  let error: PolicyError | null = null;
  let message = "The contract reverted the transaction.";
  try {
    await publicClient.simulateContract({ ...request, blockNumber: receipt.blockNumber });
  } catch (err) {
    error = decodePolicyError(err);
    message = error?.explanation ?? errorMessage(err);
  }
  return { ok: false, stage: "onchain", error, message, hash, url: txUrl(hash) };
}

/** Sends one call signed by the agent's session key. Never throws for a contract refusal. */
export async function sendAsAgent(call: AgentCall | RawCall, opts: SendOptions = {}): Promise<TxResult> {
  const { agentAccount, agentClient } = getClients();
  return send({ account: agentAccount, client: agentClient }, { address: vault().address, abi: policyVaultAbi as Abi }, call, opts);
}

/** Sends one call signed by the owner, guardian or oracle updater key. For the demo scripts and sign buttons. */
export async function sendAsRole(
  role: DemoRole,
  target: "vault" | "oracle" | { address: Address; abi: Abi },
  call: RawCall,
  opts: SendOptions = {},
): Promise<TxResult> {
  const cfg = chainConfig();
  const to =
    target === "vault"
      ? { address: cfg.VAULT_ADDRESS, abi: policyVaultAbi as Abi }
      : target === "oracle"
        ? { address: cfg.ORACLE_ADDRESS, abi: priceOracleAbi as Abi }
        : target;
  return send(roleClient(role) as unknown as Sender, to, call, opts);
}
