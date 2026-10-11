import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import type { Verdict } from "./policy";

const LOG_PATH = join(process.cwd(), "data", "audit.jsonl");

/** What the agent intended and why, written before anything is signed. */
export type AuditRecord = {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  /** Where the instruction came from, e.g. "chat" or "invoice:tuition-fall.pdf". */
  source: string;
  /** The policy engine's decision and every check behind it. Null when the engine was bypassed. */
  policy: Verdict | null;
  /** Who pays whom and why, in the style of travel rule metadata. Only on payments. */
  transfer?: { from: string; to: string; purpose: string; amount: string; asset: string };
};

export type AuditEntry = { ref: Hex; record: AuditRecord; result: unknown };

/**
 * The hash of the record goes on-chain with the payment as `ref`, so each
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
    .map((line) => JSON.parse(line) as AuditEntry);
}
