import { formatUnits, parseEventLogs, parseUnits, type Abi, type Address, type Hex } from "viem";
import { mandateAbi, policyVaultAbi, priceOracleAbi } from "./abi";
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

const mandates = new Map<string, Address>();
/** The mandate a vault is bound to. It never changes, so it is read once. */
export async function mandateAddress(): Promise<Address> {
  const v = chainConfig().VAULT_ADDRESS;
  let m = mandates.get(v);
  if (!m) {
    m = (await getClients().publicClient.readContract({ ...vault(), functionName: "mandate" })) as Address;
    mandates.set(v, m);
  }
  return m;
}

// ---------------------------------------------------------------- reads

/** The mandate's limits as signed, with shares as percentages. */
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
  vaultAddress: Address;
  mandateAddress: Address;
  totalValue: string;
  cash: string;
  cashSharePct: number;
  defensiveSharePct: number;
  positions: Position[];
  mandate: Mandate;
  /** False until the owner has signed a first mandate. */
  mandateSigned: boolean;
  /** Set while a first mandate cannot be signed yet (a later vault of the same owner starts with a wait). */
  signableFrom: string | null;
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
  agent: {
    /** The zero address when there is no key, for example after a full withdrawal ended the mandate. */
    address: Address;
    keyExpires: string | null;
    paused: boolean;
    /** Who the pause belongs to. The owner can lift their own at once; a guardian's needs the guardian or the wait. */
    pausedBy: "owner" | "guardian" | null;
  };
  stopLoss: { haltedUntil: string | null; haltRequestAppliesFrom: string | null };
  keys: { owner: Address; guardian: Address; withdrawalAddress: Address };
  /** Changes that raise the risk and are waiting out the delay. */
  pending: {
    mandate: (Mandate & { appliesFrom: string }) | null;
    withdrawalAddress: { to: Address; appliesFrom: string } | null;
    agentKey: { address: Address; expires: string; appliesFrom: string } | null;
    /** `to` is the zero address when the request is to have no guardian. */
    guardian: { to: Address; appliesFrom: string } | null;
    waitingPeriod: { seconds: number; appliesFrom: string } | null;
    unpause: { appliesFrom: string } | null;
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

/** Runs named reads in one batch and gives the answers back under the same names. */
async function readNamed<K extends string>(reads: Record<K, Read>, blockNumber?: bigint): Promise<Record<K, unknown>> {
  const keys = Object.keys(reads) as K[];
  const out = await readAll(keys.map((k) => reads[k]), blockNumber);
  return Object.fromEntries(keys.map((k, i) => [k, out[i]])) as Record<K, unknown>;
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
/** The keys the mandate files waiting changes under. They match the constants in Mandate.sol. */
export const CHANGE_KEYS = {
  mandate: textKey("policy"),
  stopLossHalt: textKey("stop-loss halt"),
  withdrawalAddress: textKey("withdrawal address"),
  agentKey: textKey("agent key"),
  guardian: textKey("guardian"),
  waitingPeriod: textKey("waiting period"),
  unpause: textKey("unpause"),
  rule: ruleKey,
} as const;

const ZERO = "0x0000000000000000000000000000000000000000";

export async function getPortfolio(): Promise<Portfolio> {
  const { publicClient } = getClients();
  const cfg = chainConfig();
  const v = { address: cfg.VAULT_ADDRESS, abi: policyVaultAbi as Abi };
  const m = { address: await mandateAddress(), abi: mandateAbi as Abi };
  const oracle = { address: cfg.ORACLE_ADDRESS, abi: priceOracleAbi as Abi };
  const list = SYMBOLS.map((s) => assets()[s]);
  const block = await publicClient.getBlock();
  const eta = (key: Hex): Read => ({ ...m, functionName: "pendingEta", args: [key] });

  const r = await readNamed(
    {
      cash: { ...v, functionName: "holdings", args: [cfg.USD_ADDRESS] },
      total: { ...v, functionName: "portfolioValue" },
      defensiveBps: { ...v, functionName: "defensiveBps" },
      drawdownBps: { ...v, functionName: "drawdownBps" },
      inProtect: { ...v, functionName: "inProtectMode" },
      volumeLeft: { ...v, functionName: "dailyVolumeRemaining" },
      exposure: { ...v, functionName: "agentExposure" },
      dayStart: { ...v, functionName: "dayStartValue" },
      day: { ...v, functionName: "day" },
      volumeToday: { ...v, functionName: "volumeToday" },
      cooldownUntil: { ...v, functionName: "cooldownUntil" },
      lossStreak: { ...v, functionName: "lossStreak" },
      maxPriceAge: { ...v, functionName: "maxPriceAge" },
      policy: { ...m, functionName: "getPolicy" },
      pendingPolicy: { ...m, functionName: "getPendingPolicy" },
      signed: { ...m, functionName: "signed" },
      activeFrom: { ...m, functionName: "activeFrom" },
      paused: { ...m, functionName: "paused" },
      pausedByGuardian: { ...m, functionName: "pausedByGuardian" },
      agent: { ...m, functionName: "agent" },
      agentExpiry: { ...m, functionName: "agentExpiry" },
      owner: { ...m, functionName: "owner" },
      guardian: { ...m, functionName: "guardian" },
      withdrawalAddress: { ...m, functionName: "withdrawalAddress" },
      haltedUntil: { ...m, functionName: "stopLossHaltedUntil" },
      loosenDelay: { ...m, functionName: "loosenDelay" },
      pendingWithdrawal: { ...m, functionName: "pendingWithdrawalAddress" },
      pendingAgent: { ...m, functionName: "pendingAgent" },
      pendingAgentExpiry: { ...m, functionName: "pendingAgentExpiry" },
      pendingGuardian: { ...m, functionName: "pendingGuardian" },
      pendingDelay: { ...m, functionName: "pendingLoosenDelay" },
      mandateEta: eta(CHANGE_KEYS.mandate),
      haltEta: eta(CHANGE_KEYS.stopLossHalt),
      withdrawalEta: eta(CHANGE_KEYS.withdrawalAddress),
      agentEta: eta(CHANGE_KEYS.agentKey),
      guardianEta: eta(CHANGE_KEYS.guardian),
      delayEta: eta(CHANGE_KEYS.waitingPeriod),
      unpauseEta: eta(CHANGE_KEYS.unpause),
    },
    block.number,
  );
  const perAsset = await readAll(
    list.flatMap((a): Read[] => [
      { ...v, functionName: "holdings", args: [a.address] },
      { ...v, functionName: "costBasis", args: [a.address] },
      { ...m, functionName: "getRule", args: [a.address] },
      { ...m, functionName: "getPendingRule", args: [a.address] },
      eta(ruleKey(a.address)),
      { ...oracle, functionName: "getPrice", args: [a.address] },
    ]),
    block.number,
  );
  const PER = 6;

  const policy = r.policy as RawPolicy;
  const total = r.total as bigint;
  const cash = r.cash as bigint;
  const maxPriceAge = r.maxPriceAge as bigint;
  const exposure = r.exposure as readonly [bigint, bigint];
  const now = block.timestamp;
  const sameDay = now / 86400n === BigInt(r.day as bigint);
  const share = (value: bigint) => (total === 0n ? 0 : Number((value * 10000n) / total) / 100);
  const when = (key: keyof typeof r) => (Number(r[key] as bigint) === 0 ? null : iso(r[key] as bigint));

  const positions = list.map((a, i): Position => {
    const [held, cost, rule, pendingRule, ruleEta, priceTuple] = perAsset.slice(i * PER) as [
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

  const paused = r.paused as boolean;
  return {
    at: iso(now),
    vaultAddress: v.address,
    mandateAddress: m.address,
    totalValue: fromUsdUnits(total),
    cash: fromUsdUnits(cash),
    cashSharePct: share(cash),
    defensiveSharePct: Number(r.defensiveBps as bigint) / 100,
    positions,
    mandate: mandateOf(policy),
    mandateSigned: r.signed as boolean,
    signableFrom: !(r.signed as boolean) && (r.activeFrom as bigint) > now ? iso(r.activeFrom as bigint) : null,
    today: {
      snapshotTaken: sameDay,
      startValue: fromUsdUnits(sameDay ? (r.dayStart as bigint) : total),
      lossPct: Number(r.drawdownBps as bigint) / 100,
      maxTrade: fromUsdUnits((total * BigInt(policy.maxTradeBps)) / 10000n),
      volumeUsed: fromUsdUnits(sameDay ? (r.volumeToday as bigint) : 0n),
      volumeLeft: fromUsdUnits(r.volumeLeft as bigint),
      lossStreak: r.lossStreak as number,
    },
    protect: { active: r.inProtect as boolean, cooldownUntil: (r.cooldownUntil as bigint) > now ? iso(r.cooldownUntil as bigint) : null },
    agentExposure: { tradable: fromUsdUnits(exposure[0]), maxCost: fromUsdUnits(exposure[1]) },
    agent: {
      address: r.agent as Address,
      keyExpires: orNull(r.agentExpiry as bigint),
      paused,
      pausedBy: !paused ? null : (r.pausedByGuardian as boolean) ? "guardian" : "owner",
    },
    stopLoss: { haltedUntil: (r.haltedUntil as bigint) > now ? iso(r.haltedUntil as bigint) : null, haltRequestAppliesFrom: when("haltEta") },
    keys: { owner: r.owner as Address, guardian: r.guardian as Address, withdrawalAddress: r.withdrawalAddress as Address },
    pending: {
      mandate: when("mandateEta") ? { ...mandateOf(r.pendingPolicy as RawPolicy), appliesFrom: when("mandateEta")! } : null,
      withdrawalAddress: when("withdrawalEta") ? { to: r.pendingWithdrawal as Address, appliesFrom: when("withdrawalEta")! } : null,
      agentKey: when("agentEta")
        ? { address: r.pendingAgent as Address, expires: iso(r.pendingAgentExpiry as bigint), appliesFrom: when("agentEta")! }
        : null,
      guardian: when("guardianEta") ? { to: r.pendingGuardian as Address, appliesFrom: when("guardianEta")! } : null,
      waitingPeriod: when("delayEta") ? { seconds: Number(r.pendingDelay as bigint), appliesFrom: when("delayEta")! } : null,
      unpause: when("unpauseEta") ? { appliesFrom: when("unpauseEta")! } : null,
    },
    settings: { loosenDelaySeconds: Number(r.loosenDelay as bigint), maxPriceAgeSeconds: Number(maxPriceAge) },
  };
}

export const NO_ADDRESS = ZERO as Address;

// ---------------------------------------------------------------- writes

export type Order = { asset: Address; isBuy: boolean; amount: bigint };

/** What the owner signs to let one exact trade past the agent's size limits. Matches TradeApproval in PolicyVault.sol. */
export type TradeApproval = {
  /** 0 buy, 1 sell */
  action: number;
  assetIn: Address;
  assetOut: Address;
  amount: bigint;
  nonce: bigint;
  validFrom: bigint;
  expiry: bigint;
};

export const APPROVAL_TYPES = {
  TradeApproval: [
    { name: "action", type: "uint8" },
    { name: "assetIn", type: "address" },
    { name: "assetOut", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validFrom", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** The EIP-712 domain: an approval is only good for this vault on this chain. */
export function approvalDomain() {
  const cfg = chainConfig();
  return { name: "PolicyVault", version: "1", chainId: cfg.CHAIN_ID, verifyingContract: cfg.VAULT_ADDRESS } as const;
}

/** The calls the agent's key is meant to make. */
export type AgentCall =
  | { functionName: "buy"; args: readonly [asset: Address, usdIn: bigint, ref: Hex] }
  | { functionName: "sell"; args: readonly [asset: Address, amount: bigint, ref: Hex] }
  | { functionName: "rebalance"; args: readonly [orders: readonly Order[], ref: Hex] }
  | { functionName: "tradeWithApproval"; args: readonly [approval: TradeApproval, signature: Hex, ref: Hex] };

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
      await publicClient.readContract({ ...vault(), functionName: "day", blockNumber });
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
    // one transaction can emit from both contracts: a withdrawal that empties the vault also ends the mandate
    const events = parseEventLogs({ abi: [...target.abi, ...(mandateAbi as Abi), ...(policyVaultAbi as Abi)], logs: receipt.logs }).map((log) => ({
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

/**
 * Sends one call signed by the agent's session key. Never throws for a contract refusal.
 * @param to "mandate" only for showing that the agent key has no powers there
 */
export async function sendAsAgent(call: AgentCall | RawCall, opts: SendOptions = {}, to: "vault" | "mandate" = "vault"): Promise<TxResult> {
  const { agentAccount, agentClient } = getClients();
  const target =
    to === "vault" ? { address: vault().address, abi: policyVaultAbi as Abi } : { address: await mandateAddress(), abi: mandateAbi as Abi };
  return send({ account: agentAccount, client: agentClient }, target, call, opts);
}

/** Sends one call signed by the owner, guardian or oracle updater key. For the demo scripts and sign buttons. */
export async function sendAsRole(
  role: DemoRole,
  target: "vault" | "mandate" | "oracle" | { address: Address; abi: Abi },
  call: RawCall,
  opts: SendOptions = {},
): Promise<TxResult> {
  const cfg = chainConfig();
  const to =
    target === "vault"
      ? { address: cfg.VAULT_ADDRESS, abi: policyVaultAbi as Abi }
      : target === "mandate"
        ? { address: await mandateAddress(), abi: mandateAbi as Abi }
        : target === "oracle"
        ? { address: cfg.ORACLE_ADDRESS, abi: priceOracleAbi as Abi }
        : target;
  return send(roleClient(role) as unknown as Sender, to, call, opts);
}
