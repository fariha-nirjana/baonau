import type { Hex } from "viem";
import type { AssetSymbol } from "./assets";
import { readJson, writeJson } from "./store";

/**
 * A trade above the agent's size limits, waiting for the owner. The agent can
 * ask. Only the owner's signature, for exactly this trade, lets it through,
 * and the vault checks that signature itself.
 */
export type ApprovalRequest = {
  id: string;
  createdAt: string;
  symbol: AssetSymbol;
  side: "buy" | "sell";
  /** Stable units for a buy, asset units for a sell, as a whole-number string. */
  amount: string;
  /** The trade's value in tUSD when it was requested. */
  usd: number;
  reason: string;
  status: "waiting" | "signed" | "used" | "rejected" | "failed";
  /** Set once the owner has signed. */
  nonce?: string;
  validFrom?: number;
  expiry?: number;
  signature?: Hex;
  tx?: string;
  note?: string;
};

const FILE = "approvals.json";

export function listApprovals(): ApprovalRequest[] {
  return readJson<ApprovalRequest[]>(FILE, []);
}

export function addApproval(request: Omit<ApprovalRequest, "id" | "createdAt" | "status">): ApprovalRequest {
  const all = listApprovals();
  const full: ApprovalRequest = { ...request, id: `r${all.length + 1}`, createdAt: new Date().toISOString(), status: "waiting" };
  writeJson(FILE, [...all, full]);
  return full;
}

export function updateApproval(id: string, patch: Partial<ApprovalRequest>) {
  writeJson(
    FILE,
    listApprovals().map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
}
