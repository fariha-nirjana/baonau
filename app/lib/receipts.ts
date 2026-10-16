import { formatUnits } from "viem";
import { assetByAddress } from "./assets";
import type { AuditEntry } from "./audit";
import { commitmentKey, releaseKey } from "./commitments";
import { display, type Currency } from "./money";
import { GATE_LABELS, type Outcome } from "./risk";
import { CHANGE_KEYS } from "./vault";

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
  outcome:
    | "done"
    | "blocked by the risk engine"
    | "reverted by the contract"
    | "sent to the owner"
    | "waiting out the delay"
    /** a change that waited and was later cancelled by the owner or the trusted contact */
    | "cancelled"
    /** a change that waited out its delay and was then applied */
    | "applied after the wait"
    | "decided not to act"
    | "failed";
  /** The agent's stated reason, or the keeper's trigger. */
  why: string;
  /** Why it was refused, when it was. */
  refusal: string | null;
  /**
   * The gate trace: every rule that was checked before anything was signed,
   * each with pass or fail and the reason. Empty when no check ran off-chain
   * (the keeper, the owner, or the scripted attacker, where the contract's
   * own answer is the whole story).
   */
  gates: { id: string; label: string; outcome: Outcome; detail: string }[];
  /** The contract's own verdict when the transaction reached the chain. */
  contract: { verdict: "accepted" | "reverted"; reason: string | null } | null;
  url: string | null;
  /** Matches the `ref` on the on-chain Trade event. */
  ref: string;
  /** The agent chose to say no (the decline tool), as opposed to a fail-safe abstention after an error. */
  declined: boolean;
  /** The commitment it was about, for payments, set-asides and releases. */
  commitment: number | null;
  /** Set when money went to a commitment's payee: how much, in tUSD. */
  paid: number | null;
};

type Result = {
  ok?: boolean;
  abstained?: boolean;
  signed?: boolean;
  stage?: string;
  message?: string;
  escalated?: boolean;
  url?: string;
  error?: { name: string; explanation: string } | null;
  events?: { name: string; args: Record<string, string> }[];
};

const clock = (seconds: string) => `${new Date(Number(seconds) * 1000).toISOString().slice(11, 16)} UTC`;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const ACTORS: Record<string, string> = {
  chat: "Agent, asked by the investor",
  ask: "Agent, asked by the investor",
  autopilot: "Agent, on its own under the plan",
  keeper: "Keeper script, no agent involved",
  owner: "Owner",
  guardian: "Guardian",
  "owner-approved": "Agent, with the owner's signed approval for this one trade",
};

function actorOf(source: string) {
  if (source.startsWith("item:")) return "Agent, after reading an outside item";
  if (source.startsWith("compromised")) return "COMPROMISED AGENT (scripted attacker with the real agent key)";
  return ACTORS[source] ?? `Agent (${source})`;
}

const usd = (units: string) => formatUnits(BigInt(units), 6);

function describeEvents(events: Result["events"], currency: Currency, name: string | null): string[] {
  const what = name ?? "the commitment";
  return (events ?? []).flatMap((e) => {
    const name = (e.args.asset && assetByAddress(e.args.asset)?.name) || "asset";
    switch (e.name) {
      case "Trade":
        return [`${e.args.isBuy === "true" ? "Bought" : "Sold"} ${name} for ${display(formatUnits(BigInt(e.args.usdAmount), 6), currency)} at ${formatUnits(BigInt(e.args.price), 8)}`];
      case "StopLossTriggered":
        return [`Stop-loss sold all ${name} for ${display(formatUnits(BigInt(e.args.usdAmount), 6), currency)} at ${formatUnits(BigInt(e.args.price), 8)}`];
      case "ProtectModeEntered":
        return [`Buying paused until ${clock(e.args.until)}`];
      case "ApprovalUsed":
        return ["Used the owner's signed approval, which now cannot be used again"];
      case "Terminated":
        return ["Everything was withdrawn, so the mandate ended and the agent's key was revoked"];
      case "MandateSigned":
        return ["First mandate signed"];
      case "AgentProposed":
        return [`New agent key signed for, waiting until ${clock(e.args.eta)}`];
      case "GuardianProposed":
        return [`Trusted contact change signed for, waiting until ${clock(e.args.eta)}`];
      case "UnpauseProposed":
        return [`Lifting the trusted contact's pause signed for, waiting until ${clock(e.args.eta)}`];
      case "LoosenDelayProposed":
        return [`Shorter waiting period signed for, waiting until ${clock(e.args.eta)}`];
      case "WithdrawalAddressProposed":
        return [`New withdrawal address signed for, waiting until ${clock(e.args.eta)}`];
      case "AssetRuleProposed":
        return [`Looser rule for ${name} signed for, waiting until ${clock(e.args.eta)}`];
      case "Paused":
        return ["The agent was paused"];
      case "Unpaused":
        return ["The agent was unpaused"];
      case "StopLossHalted":
        return [`Stop-loss halted until ${clock(e.args.until)}`];
      case "StopLossResumed":
        return ["Stop-loss switched back on"];
      case "PolicyProposed":
        return [`Mandate change signed, waiting until ${clock(e.args.eta)}`];
      case "StopLossHaltProposed":
        return [`Stop-loss halt signed, waiting until ${clock(e.args.eta)}`];
      case "ChangeCancelled":
        return ["A waiting change was cancelled"];
      case "PolicyChanged":
        return ["Mandate limits in force"];
      case "CommitmentPaid":
        return [`Paid ${display(usd(e.args.amount), currency)} for ${what} (exactly ${usd(e.args.amount)} tUSD sent)`];
      case "CommitmentProposed":
        return [`${what} signed for, waiting until ${clock(e.args.eta)} before it can be paid`];
      case "CommitmentChanged":
        return [`${what} in force`];
      case "Reserved":
        return [`Set aside ${display(usd(e.args.amount), currency)} for ${what}`];
      case "ReleaseProposed":
        return [`Asked to move ${display(usd(e.args.amount), currency)} from ${what} back into investing, waiting until ${clock(e.args.eta)}`];
      case "Released":
        return [`Moved ${display(usd(e.args.amount), currency)} from ${what} back into investing`];
      default:
        return [];
    }
  });
}

export function receiptOf(entry: AuditEntry, currency: Currency = "BDT"): Receipt {
  const { record } = entry;
  const result = (entry.result ?? {}) as Result;
  const name = typeof record.args.name === "string" ? record.args.name : null;
  const done = describeEvents(result.events, currency, name);
  const queued = (result.events ?? []).some((e) => e.name.endsWith("Proposed"));

  let outcome: Receipt["outcome"];
  if (result.abstained) outcome = "decided not to act";
  else if (result.ok) outcome = result.escalated ? "sent to the owner" : queued ? "waiting out the delay" : "done";
  else if (result.stage === "risk") outcome = "blocked by the risk engine";
  else if (result.stage === "onchain" || result.stage === "preflight") outcome = "reverted by the contract";
  else outcome = "failed";

  const attempted =
    record.legs?.map((l) => `${l.side} ${l.symbol} for ${display(l.usd, currency)}`).join(", ") ??
    (record.tool === "pay_commitment" ? `pay ${display(Number(record.args.amount), currency)} for ${name ?? "a commitment"}` : undefined) ??
    (typeof record.args.goal === "string" ? lowerFirst(record.args.goal) : record.tool.replace(/_/g, " "));

  return {
    at: record.at,
    actor: actorOf(record.source),
    what: record.tool === "poke"
      ? result.ok
        ? "Recorded today's starting value"
        : "Could not record today's starting value"
      : result.abstained
      ? record.args.what
        ? `Decided not to: ${lowerFirst(String(record.args.what))}`
        : "Decided not to act"
      : result.signed
        ? "Signed an approval for one trade"
        : result.ok && done.length
          ? done.join(". ")
          : result.escalated
            ? `Asked the owner to sign for: ${attempted}`
            : `Tried to ${attempted}`,
    outcome,
    why: record.reason,
    refusal: result.ok ? null : (result.error?.explanation ?? result.message ?? null),
    gates: (record.risk?.checks ?? []).map((c) => ({ id: c.id, label: GATE_LABELS[c.id] ?? c.id, outcome: c.outcome, detail: c.detail })),
    contract: result.url ? { verdict: result.ok ? "accepted" : "reverted", reason: result.ok ? null : (result.error?.explanation ?? result.message ?? null) } : null,
    url: result.url ?? null,
    ref: entry.ref,
    declined: Boolean(result.abstained) && record.args.kind === "declined",
    commitment: typeof record.args.commitment === "number" ? record.args.commitment : null,
    paid: (() => {
      const e = (result.events ?? []).find((x) => x.name === "CommitmentPaid");
      return e ? Number(usd(e.args.amount)) : null;
    })(),
  };
}

/** The key a queued change is filed under, from the event that queued it. */
function queuedKey(e: { name: string; args: Record<string, unknown> }): string | null {
  switch (e.name) {
    case "PolicyProposed": return CHANGE_KEYS.mandate;
    case "StopLossHaltProposed": return CHANGE_KEYS.stopLossHalt;
    case "WithdrawalAddressProposed": return CHANGE_KEYS.withdrawalAddress;
    case "AgentProposed": return CHANGE_KEYS.agentKey;
    case "GuardianProposed": return CHANGE_KEYS.guardian;
    case "LoosenDelayProposed": return CHANGE_KEYS.waitingPeriod;
    case "UnpauseProposed": return CHANGE_KEYS.unpause;
    case "AssetRuleProposed": return CHANGE_KEYS.rule(String(e.args.asset) as `0x${string}`);
    case "CommitmentProposed": return commitmentKey(Number(e.args.id));
    case "ReleaseProposed": return releaseKey(Number(e.args.id));
    default: return null;
  }
}

/** The key a later entry settled: cancelled through cancelChange, or applied through an apply call. */
function settledKey(entry: AuditEntry): { key: string; how: "cancelled" | "applied after the wait" } | null {
  const result = (entry.result ?? {}) as Result;
  if (!result.ok) return null;
  const args = entry.record.args as { call?: string; args?: unknown[] };
  const first = args.args?.[0];
  switch (args.call) {
    case "cancelChange": return { key: String(first).toLowerCase(), how: "cancelled" };
    case "applyPolicy": return { key: CHANGE_KEYS.mandate, how: "applied after the wait" };
    case "applyStopLossHalt": return { key: CHANGE_KEYS.stopLossHalt, how: "applied after the wait" };
    case "applyWithdrawalAddress": return { key: CHANGE_KEYS.withdrawalAddress, how: "applied after the wait" };
    case "applyAgent": return { key: CHANGE_KEYS.agentKey, how: "applied after the wait" };
    case "applyGuardian": return { key: CHANGE_KEYS.guardian, how: "applied after the wait" };
    case "applyLoosenDelay": return { key: CHANGE_KEYS.waitingPeriod, how: "applied after the wait" };
    case "applyUnpause": return { key: CHANGE_KEYS.unpause, how: "applied after the wait" };
    case "applyAssetRule": return { key: CHANGE_KEYS.rule(String(first) as `0x${string}`), how: "applied after the wait" };
    case "applyCommitment": return { key: commitmentKey(Number(first)), how: "applied after the wait" };
    case "applyRelease": return { key: releaseKey(Number(first)), how: "applied after the wait" };
    default: return null;
  }
}

export function recentReceipts(entries: AuditEntry[], limit: number, currency: Currency = "BDT"): Receipt[] {
  // a receipt for a queued change says what became of it: a later cancel or apply with the same key settles it
  const settled = new Map<number, Receipt["outcome"]>();
  entries.forEach((entry, i) => {
    const events = ((entry.result ?? {}) as Result).events ?? [];
    const key = events.map(queuedKey).find((k) => k !== null)?.toLowerCase();
    if (!key) return;
    for (const later of entries.slice(i + 1)) {
      const s = settledKey(later);
      if (s && s.key.toLowerCase() === key) {
        settled.set(i, s.how);
        break;
      }
    }
  });
  return entries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.record.tool !== "set_prices")
    .slice(-limit)
    .reverse()
    .map(({ entry, i }) => {
      const r = receiptOf(entry, currency);
      const how = settled.get(i);
      return how && r.outcome === "waiting out the delay" ? { ...r, outcome: how } : r;
    });
}
