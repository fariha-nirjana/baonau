import { formatUnits } from "viem";
import { assetByAddress } from "./assets";
import type { AuditEntry } from "./audit";
import { display, type Currency } from "./money";

/**
 * A receipt: one audit entry in words a person can read. Every attempt gets
 * one, including the ones the risk engine blocked and the ones the contract
 * reverted, and each links to its transaction when there is one.
 */
export type Receipt = {
  at: string;
  /** Who acted: the agent (and what prompted it), the keeper, the owner, the guardian, or the scripted attacker. */
  actor: string;
  what: string;
  outcome: "done" | "blocked by the risk engine" | "reverted by the contract" | "sent to the owner" | "waiting out the delay" | "failed";
  /** The agent's stated reason, or the keeper's trigger. */
  why: string;
  /** Why it was refused, when it was. */
  refusal: string | null;
  url: string | null;
  /** Matches the `ref` on the on-chain Trade event. */
  ref: string;
};

type Result = {
  ok?: boolean;
  stage?: string;
  message?: string;
  escalated?: boolean;
  url?: string;
  error?: { name: string; explanation: string } | null;
  events?: { name: string; args: Record<string, string> }[];
};

const ACTORS: Record<string, string> = {
  chat: "Agent, asked by the investor",
  ask: "Agent, asked by the investor",
  autopilot: "Agent, on its own under the plan",
  keeper: "Keeper script, no agent involved",
  owner: "Owner",
  guardian: "Guardian",
};

function actorOf(source: string) {
  if (source.startsWith("item:")) return "Agent, after reading an outside item";
  if (source.startsWith("compromised")) return "COMPROMISED AGENT (scripted attacker with the real agent key)";
  return ACTORS[source] ?? `Agent (${source})`;
}

function describeEvents(events: Result["events"], currency: Currency): string[] {
  return (events ?? []).flatMap((e) => {
    const name = (e.args.asset && assetByAddress(e.args.asset)?.name) || "asset";
    switch (e.name) {
      case "Trade":
        return [`${e.args.isBuy === "true" ? "Bought" : "Sold"} ${name} for ${display(formatUnits(BigInt(e.args.usdAmount), 6), currency)} at ${formatUnits(BigInt(e.args.price), 8)}`];
      case "StopLossTriggered":
        return [`Stop-loss sold all ${name} for ${display(formatUnits(BigInt(e.args.usdAmount), 6), currency)} at ${formatUnits(BigInt(e.args.price), 8)}`];
      case "ProtectModeEntered":
        return [`Buying paused until ${new Date(Number(e.args.until) * 1000).toISOString()}`];
      case "TradeRequested":
        return [`Request ${e.args.requestId} created for the owner`];
      case "PolicyProposed":
        return [`Mandate change queued until ${new Date(Number(e.args.eta) * 1000).toISOString()}`];
      case "StopLossHaltProposed":
        return [`Stop-loss halt queued until ${new Date(Number(e.args.eta) * 1000).toISOString()}`];
      case "ChangeCancelled":
        return ["A waiting change was cancelled"];
      case "PolicyChanged":
        return ["Mandate in force"];
      default:
        return [];
    }
  });
}

export function receiptOf(entry: AuditEntry, currency: Currency = "BDT"): Receipt {
  const { record } = entry;
  const result = (entry.result ?? {}) as Result;
  const done = describeEvents(result.events, currency);
  const queued = (result.events ?? []).some((e) => e.name.endsWith("Proposed"));

  let outcome: Receipt["outcome"];
  if (result.ok) outcome = result.escalated ? "sent to the owner" : queued ? "waiting out the delay" : "done";
  else if (result.stage === "risk") outcome = "blocked by the risk engine";
  else if (result.stage === "onchain" || result.stage === "preflight") outcome = "reverted by the contract";
  else outcome = "failed";

  const attempted =
    record.legs?.map((l) => `${l.side} ${l.symbol} for ${display(l.usd, currency)}`).join(", ") ??
    (typeof record.args.goal === "string" ? record.args.goal : record.tool.replace(/_/g, " "));

  return {
    at: record.at,
    actor: actorOf(record.source),
    what: result.ok && done.length ? done.join(". ") : `Tried to ${attempted}`,
    outcome,
    why: record.reason,
    refusal: result.ok ? null : (result.error?.explanation ?? result.message ?? null),
    url: result.url ?? null,
    ref: entry.ref,
  };
}

export function recentReceipts(entries: AuditEntry[], limit: number, currency: Currency = "BDT"): Receipt[] {
  return entries
    .filter((e) => e.record.tool !== "set_prices")
    .slice(-limit)
    .reverse()
    .map((e) => receiptOf(e, currency));
}
