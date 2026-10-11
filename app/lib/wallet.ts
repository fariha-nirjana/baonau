import { formatUnits, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { policyWalletAbi, testUsdAbi } from "./abi";
import { getClients, txUrl } from "./chain";
import { chainConfig, TOKEN_DECIMALS } from "./config";
import { decodePolicyError, errorMessage, type PolicyError } from "./errors";

const MANDATE_STATUS = ["none", "proposed", "approved", "revoked"] as const;

export const toUnits = (amount: string) => parseUnits(amount, TOKEN_DECIMALS);
export const fromUnits = (amount: bigint) => formatUnits(amount, TOKEN_DECIMALS);

const wallet = () => ({ address: chainConfig().WALLET_ADDRESS, abi: policyWalletAbi }) as const;

// ---------------------------------------------------------------- reads

export type Bucket = { id: number; name: string; locked: boolean; balance: string };

export type Mandate = {
  id: number;
  purpose: string;
  payee: Address;
  bucket: number;
  status: (typeof MANDATE_STATUS)[number];
  active: boolean;
  activeFrom: string;
  expiry: string;
  periodDays: number;
  capPerPeriod: string;
  remainingThisPeriod: string;
};

export type Overview = {
  balance: string;
  unallocated: string;
  buckets: Bucket[];
  limits: { perPayment: string; perDay: string; leftToday: string };
  /** The most the agent key alone could still move today. */
  agentExposure: string;
  paused: boolean;
  agent: { address: Address; keyExpires: string };
};

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

export async function getBuckets(): Promise<Bucket[]> {
  const { publicClient } = getClients();
  const count = Number(await publicClient.readContract({ ...wallet(), functionName: "bucketCount" }));
  const rows = await publicClient.multicall({
    allowFailure: false,
    contracts: Array.from({ length: count }, (_, id) => ({
      ...wallet(),
      functionName: "getBucket" as const,
      args: [BigInt(id)] as const,
    })),
  });
  return rows.map(([name, locked, balance], id) => ({ id, name, locked, balance: fromUnits(balance) }));
}

export async function getMandates(): Promise<Mandate[]> {
  const { publicClient } = getClients();
  const count = Number(await publicClient.readContract({ ...wallet(), functionName: "mandateCount" }));
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));
  const [mandates, remaining, active] = await Promise.all([
    publicClient.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ ...wallet(), functionName: "getMandate" as const, args: [id] as const })),
    }),
    publicClient.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ ...wallet(), functionName: "mandateRemaining" as const, args: [id] as const })),
    }),
    publicClient.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ ...wallet(), functionName: "isMandateActive" as const, args: [id] as const })),
    }),
  ]);
  return mandates.map((m, i) => ({
    id: i + 1,
    purpose: m.purpose,
    payee: m.payee,
    bucket: Number(m.bucket),
    status: MANDATE_STATUS[m.status],
    active: active[i],
    activeFrom: iso(m.activeFrom),
    expiry: iso(m.expiry),
    periodDays: Number(m.period) / 86400,
    capPerPeriod: fromUnits(m.capPerPeriod),
    remainingThisPeriod: fromUnits(remaining[i]),
  }));
}

export async function getOverview(): Promise<Overview> {
  const { publicClient } = getClients();
  const cfg = chainConfig();
  const [balance, unallocated, perTxCap, dailyCap, dailyRemaining, exposure, paused, agent, agentExpiry] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: cfg.TOKEN_ADDRESS, abi: testUsdAbi, functionName: "balanceOf", args: [cfg.WALLET_ADDRESS] },
        { ...wallet(), functionName: "unallocated" },
        { ...wallet(), functionName: "perTxCap" },
        { ...wallet(), functionName: "dailyCap" },
        { ...wallet(), functionName: "dailyRemaining" },
        { ...wallet(), functionName: "agentExposure" },
        { ...wallet(), functionName: "paused" },
        { ...wallet(), functionName: "agent" },
        { ...wallet(), functionName: "agentExpiry" },
      ],
    });
  return {
    balance: fromUnits(balance),
    unallocated: fromUnits(unallocated),
    buckets: await getBuckets(),
    limits: { perPayment: fromUnits(perTxCap), perDay: fromUnits(dailyCap), leftToday: fromUnits(dailyRemaining) },
    agentExposure: fromUnits(exposure),
    paused,
    agent: { address: agent, keyExpires: iso(agentExpiry) },
  };
}

export async function tokenBalanceOf(who: Address) {
  const { publicClient } = getClients();
  const cfg = chainConfig();
  return fromUnits(
    await publicClient.readContract({
      address: cfg.TOKEN_ADDRESS,
      abi: testUsdAbi,
      functionName: "balanceOf",
      args: [who],
    }),
  );
}

// ---------------------------------------------------------------- writes

export type AgentCall =
  | { functionName: "pay"; args: readonly [mandateId: bigint, amount: bigint, ref: Hex] }
  | { functionName: "requestPayment"; args: readonly [mandateId: bigint, amount: bigint, ref: Hex] }
  | { functionName: "moveFunds"; args: readonly [from: bigint, to: bigint, amount: bigint] }
  | {
      functionName: "proposeMandate";
      args: readonly [payee: Address, bucket: bigint, cap: bigint, period: bigint, expiry: bigint, purpose: string];
    };

/** A wallet event emitted by the transaction, with its arguments as strings. */
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
      await publicClient.readContract({ ...wallet(), functionName: "paused", blockNumber });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Sends one call signed by the agent's session key. Never throws for a contract refusal. */
export async function sendAsAgent(call: AgentCall, opts: SendOptions = {}): Promise<TxResult> {
  const { publicClient, agentClient, agentAccount } = getClients();
  const request = { ...wallet(), ...call, account: agentAccount } as const;

  if (!opts.force) {
    try {
      // @ts-expect-error the union of calls is too wide for viem's inference, each member is valid
      await publicClient.simulateContract(request);
    } catch (err) {
      return { ok: false, stage: "preflight", error: decodePolicyError(err), message: errorMessage(err) };
    }
  }

  let hash: Hex;
  try {
    // a fixed gas limit skips gas estimation, which would otherwise refuse to send a reverting call
    // @ts-expect-error same union width issue as above
    hash = await agentClient.writeContract(opts.force ? { ...request, gas: 400_000n } : request);
  } catch (err) {
    return { ok: false, stage: "network", error: decodePolicyError(err), message: errorMessage(err) };
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  await untilNodeHasBlock(receipt.blockNumber);
  if (receipt.status === "success") {
    const events = parseEventLogs({ abi: policyWalletAbi, logs: receipt.logs }).map((log) => ({
      name: log.eventName,
      args: Object.fromEntries(Object.entries(log.args as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
    }));
    return { ok: true, hash, url: txUrl(hash), block: receipt.blockNumber.toString(), events };
  }

  // The transaction is on-chain and reverted. Replay it to read the contract's reason.
  let error: PolicyError | null = null;
  let message = "The contract reverted the transaction.";
  try {
    // @ts-expect-error same union width issue as above
    await publicClient.simulateContract({ ...request, blockNumber: receipt.blockNumber });
  } catch (err) {
    error = decodePolicyError(err);
    message = error?.explanation ?? errorMessage(err);
  }
  return { ok: false, stage: "onchain", error, message, hash, url: txUrl(hash) };
}
