import { BaseError, ContractFunctionRevertedError, formatUnits } from "viem";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

export type PolicyError = {
  /** The contract's custom error name, e.g. OverPerTxCap. */
  name: string;
  args: string[];
  /** One sentence a non-technical user can read. */
  explanation: string;
};

const usd = (v: unknown) => `${formatUnits(BigInt(v as bigint), TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`;
const when = (v: unknown) => new Date(Number(v) * 1000).toISOString();

const explain: Record<string, (a: readonly unknown[]) => string> = {
  NotOwner: () => "Only the owner key can do this. The agent key cannot.",
  NotGuardian: () => "Only the guardian key can do this.",
  NotOwnerOrGuardian: () => "Only the owner or the guardian can do this.",
  NotAgent: () => "This key is not the wallet's agent key.",
  AgentKeyExpired: () => "The agent's session key has expired. The owner must issue a new one.",
  WalletPaused: () => "The wallet is paused. Only the owner can unpause it.",
  ZeroAmount: () => "The amount must be more than zero.",
  UnknownBucket: (a) => `Budget bucket ${a[0]} does not exist.`,
  SameBucket: () => "The source and destination buckets are the same.",
  BucketLocked: (a) => `Bucket ${a[0]} is locked. Money in it can only leave through its mandate.`,
  InsufficientBucket: (a) => `Bucket ${a[0]} holds ${usd(a[2])}, which is less than the ${usd(a[1])} needed.`,
  MandateNotApproved: (a) => `Mandate ${a[0]} has not been approved by the owner, so nothing can be paid under it.`,
  MandateInWaitingPeriod: (a) => `Mandate ${a[0]} is still in its waiting period until ${when(a[1])}.`,
  MandateExpired: (a) => `Mandate ${a[0]} has expired.`,
  OverPerTxCap: (a) => `${usd(a[0])} is above the per-payment limit of ${usd(a[1])}.`,
  OverDailyCap: (a) => `${usd(a[0])} is more than the ${usd(a[1])} left in today's limit.`,
  OverMandateCap: (a) => `${usd(a[1])} is more than the ${usd(a[2])} left under mandate ${a[0]} for this period.`,
  RequestNotPending: (a) => `Request ${a[0]} is not waiting for approval.`,
  InvalidPayee: () => "That payee address is not valid.",
  InvalidPeriod: () => "A mandate period must be at least one day.",
  InvalidExpiry: () => "The expiry must be later than the end of the waiting period.",
};

/** Turns a viem error into the contract's own reason, or null if it was not a contract revert. */
export function decodePolicyError(err: unknown): PolicyError | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError) || !revert.data) return null;
  const name = revert.data.errorName;
  const args = revert.data.args ?? [];
  return {
    name,
    args: args.map(String),
    explanation: explain[name]?.(args) ?? `The contract refused this call (${name}).`,
  };
}

export function errorMessage(err: unknown) {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}
