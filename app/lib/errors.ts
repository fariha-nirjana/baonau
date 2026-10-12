import { BaseError, ContractFunctionRevertedError, decodeErrorResult, formatUnits, type Abi } from "viem";
import { mockExchangeAbi, policyVaultAbi, priceOracleAbi } from "./abi";
import { assetByAddress } from "./assets";
import { PRICE_DECIMALS, USD_DECIMALS, USD_SYMBOL } from "./config";

export type PolicyError = {
  /** The contract's custom error name, e.g. ExceedsTradeLimit. */
  name: string;
  args: string[];
  /** One sentence a non-technical user can read. */
  explanation: string;
};

const usd = (v: unknown) => `${formatUnits(BigInt(v as bigint), USD_DECIMALS)} ${USD_SYMBOL}`;
const price = (v: unknown) => formatUnits(BigInt(v as bigint), PRICE_DECIMALS);
const pct = (v: unknown) => `${Number(v) / 100}%`;
const when = (v: unknown) => new Date(Number(v) * 1000).toISOString();
const asset = (v: unknown) => assetByAddress(String(v))?.name ?? `the token at ${v}`;

const explain: Record<string, (a: readonly unknown[]) => string> = {
  NotOwner: () => "Only the owner key can do this. The agent key cannot.",
  NotGuardian: () => "Only the guardian key can do this.",
  NotOwnerOrGuardian: () => "Only the owner or the guardian can do this.",
  NotAgent: () => "This key is not the vault's agent key.",
  AgentKeyExpired: () => "The agent's session key has expired. The owner must issue a new one.",
  WalletPaused: () => "The agent is paused. Only the owner can unpause it.",
  AlreadyInitialized: () => "The first mandate is already signed. Later changes go through the normal rules.",
  ZeroAddress: () => "That address is empty.",
  ZeroAmount: () => "The amount must be more than zero.",
  InvalidAgent: () => "That address cannot be used for this role.",
  InvalidExpiry: () => "The agent key's expiry must be in the future and at most 90 days away.",
  InvalidPolicy: () => "Those mandate values are outside what the vault accepts.",
  GuardianAlreadySet: () => "There is already a guardian. Only the guardian can pass the role on.",
  TooManyAssets: () => "The vault cannot list more assets.",
  TooManyOrders: () => "That is too many trades for one transaction.",
  NotAnAsset: () => "The cash token cannot be listed as an investment.",
  UnknownAsset: (a) => `${asset(a[0])} has never been in the mandate, so there is nothing to sell.`,
  AssetNotAllowed: (a) => `${asset(a[0])} is not in the mandate, so the agent cannot buy it.`,
  StalePrice: (a) => `The price of ${asset(a[0])} was last updated ${when(a[1])}, which is too old to trade on.`,
  ExceedsTradeLimit: (a) => `${usd(a[0])} is above the limit for a single trade, which is ${usd(a[1])} right now.`,
  ExceedsDailyVolume: (a) => `${usd(a[0])} is more than the ${usd(a[1])} of trading left for today.`,
  ExceedsExposure: (a) => `This would make ${asset(a[0])} ${pct(a[1])} of the portfolio. The mandate allows at most ${pct(a[2])}.`,
  ExceedsDailyLoss: (a) => `The portfolio is down ${pct(a[0])} today, at or past the ${pct(a[1])} daily loss limit, so buying is blocked.`,
  BelowDefensiveFloor: (a) => `This would leave ${pct(a[0])} in cash and defensive assets. The mandate requires at least ${pct(a[1])}.`,
  StopLossIsHalted: (a) => `The stop-loss is halted until ${when(a[0])}.`,
  CooldownActive: (a) => `Buying is blocked until ${when(a[0])} after a loss trigger. Selling still works.`,
  BelowStopPrice: (a) => `${asset(a[0])} is at ${price(a[1])}, at or below its stop price of ${price(a[2])}, so it cannot be bought.`,
  StopNotReached: (a) => `${asset(a[0])} is at ${price(a[1])}, above its stop price of ${price(a[2])}.`,
  NothingToSell: (a) => `The vault holds no ${asset(a[0])}.`,
  InsufficientBalance: (a) => `The vault holds less than this trade needs (asked for ${a[1]}, available ${a[2]}, in the token's smallest units).`,
  SlippageTooHigh: () => "The exchange offered a worse price than the mandate accepts.",
  RequestNotPending: (a) => `Request ${a[0]} is not waiting for approval.`,
  RequestExpired: (a) => `Request ${a[0]} has expired.`,
  NoPendingChange: () => "There is no change waiting.",
  ChangeNotReady: (a) => `This change raises the risk, so it waits. It can be applied from ${when(a[0])}, unless the guardian cancels it.`,
  // price oracle
  NotUpdater: () => "Only the oracle's updater key can set prices.",
  NoFeed: () => "The oracle has no price for that token.",
  UpdateTooSoon: (a) => `That price was just updated. The next update is allowed from ${when(a[1])}.`,
  DeviationTooLarge: (a) => `The oracle refused a price of ${price(a[1])}. One update may only move it between ${price(a[2])} and ${price(a[3])}.`,
  // exchange
  InsufficientOutput: () => "The exchange could not fill the trade at the minimum the vault asked for.",
};

const knownErrors = [...policyVaultAbi, ...priceOracleAbi, ...mockExchangeAbi].filter((x) => x.type === "error") as Abi;

/** Turns a viem error into the contract's own reason, or null if it was not a contract revert. */
export function decodePolicyError(err: unknown): PolicyError | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return null;

  let name = revert.data?.errorName;
  let args: readonly unknown[] = revert.data?.args ?? [];
  // an error raised by the oracle or the exchange is not in the vault's own ABI
  if (!name && revert.raw) {
    try {
      const decoded = decodeErrorResult({ abi: knownErrors, data: revert.raw });
      name = decoded.errorName;
      args = decoded.args ?? [];
    } catch {
      return null;
    }
  }
  if (!name) return null;
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
