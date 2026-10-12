import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import type { Leg, Verdict } from "./risk";

const LOG_PATH = join(process.cwd(), "data", "audit.jsonl");

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
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

export function readAudit(): AuditEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, "utf8")
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
