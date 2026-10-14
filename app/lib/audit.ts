import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import { nowIso } from "./clock";
import type { Leg, Verdict } from "./risk";
import { dataPath } from "./store";

const logPath = () => dataPath("audit.jsonl");

/** What the agent intended and why, written before anything is signed. */
export type AuditRecord = {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  /** Where the instruction came from, e.g. "chat", "autopilot" or "news:item-12". */
  source: string;
  /** The trade in tUSD terms, one entry per leg. Empty for actions that are not trades. */
  legs?: Leg[];
  /** The risk engine's decision and every check behind it. Null when the engine was bypassed. */
  risk: Verdict | null;
};

/**
 * A decision not to act, logged like any action. It covers the agent declining
 * a trade and the fail-safe cases: a model error, a timeout or output that
 * could not be used all mean nothing is sent.
 */
export function logAbstention(what: string, reason: string, source: string) {
  const record: AuditRecord = { at: nowIso(), tool: "abstain", args: { what }, reason, source, risk: null };
  appendAudit({ ref: refOf(record), record, result: { ok: true, abstained: true } });
}

/** Attempted and completed actions alike are logged, including ones the contract reverted. */
export type AuditEntry = { ref: Hex; record: AuditRecord; result: unknown };

/**
 * The hash of the record goes on-chain with the trade as `ref`, so each
 * on-chain event can be matched to the off-chain reasoning that produced it.
 */
export function refOf(record: AuditRecord): Hex {
  return keccak256(toHex(JSON.stringify(record)));
}

export function appendAudit(entry: AuditEntry) {
  mkdirSync(dirname(logPath()), { recursive: true });
  appendFileSync(logPath(), JSON.stringify(entry) + "\n");
}

export function readAudit(): AuditEntry[] {
  if (!existsSync(logPath())) return [];
  return readFileSync(logPath(), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        return [];
      }
    });
}
