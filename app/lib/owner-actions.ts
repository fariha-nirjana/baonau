import { parseUnits, type Address, type Hex } from "viem";
import { nowIso } from "./clock";
import { listApprovals, updateApproval } from "./approvals";
import { assets, SYMBOLS, type AssetSymbol } from "./assets";
import { appendAudit, refOf, type AuditRecord } from "./audit";
import { getClients, roleClient } from "./chain";
import { chainConfig, PRICE_DECIMALS } from "./config";
import {
  listPaymentRequests,
  readMeta,
  fallbackMeta,
  updatePaymentRequest,
  writeMeta,
  commitmentKey,
  releaseKey,
  type CommitmentMeta,
} from "./commitments";
import { listDrafts, updateDraft, type CommitmentDraft, type Draft } from "./drafts";
import { readPlan, writePlan } from "./plan";
import { executeApproved } from "./tools";
import {
  APPROVAL_TYPES,
  approvalDomain,
  CHANGE_KEYS,
  getPortfolio,
  sendAsRole,
  type AssetRule,
  type Mandate,
  type RawCall,
  type TradeApproval,
  type TxResult,
} from "./vault";

/**
 * What the owner and the guardian do with their own keys. In the demo these
 * keys sit on the server so that a button can sign. In a real product each
 * person signs in their own wallet. Nothing the agent's tools run can reach
 * these keys.
 */

const policyOf = (m: Mandate) => ({
  maxTradeBps: Math.round(m.maxTradePct * 100),
  maxDailyVolumeBps: Math.round(m.maxDailyVolumePct * 100),
  dailyLossBps: Math.round(m.dailyLossPct * 100),
  maxSlippageBps: Math.round(m.maxSlippagePct * 100),
  minDefensiveBps: Math.round(m.minDefensivePct * 100),
  maxLossStreak: m.maxLossStreak,
  cooldown: m.cooldownSeconds,
});

const ruleOf = (r: AssetRule) => ({
  allowed: r.allowed,
  defensive: r.defensive,
  maxExposureBps: Math.round(r.maxExposurePct * 100),
  stopPrice: r.stopPrice === null ? 0n : parseUnits(r.stopPrice, PRICE_DECIMALS),
});

const bigintToString = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const AGENT_SESSION_SECONDS = 60 * 24 * 3600;
const APPROVAL_SECONDS = 30 * 60;

async function act(
  role: "owner" | "guardian",
  to: "vault" | "mandate",
  tool: string,
  reason: string,
  call: RawCall,
  /** Shown on the receipt: which commitment, by name. */
  about?: { commitment: number; name: string; amount?: number },
): Promise<TxResult> {
  const result = await sendAsRole(role, to, call);
  const args = JSON.parse(JSON.stringify(call.args, bigintToString)) as unknown[];
  const record: AuditRecord = { at: nowIso(), tool, args: { call: call.functionName, args, ...about }, reason, source: role, risk: null };
  appendAudit({ ref: refOf(record), record, result });
  return result;
}

/** Signs a draft the agent prepared. Whatever in it raises the risk is only queued by this. */
export async function signDraft(id: string): Promise<{ draft: Draft; results: TxResult[] }> {
  const draft = listDrafts().find((d) => d.id === id);
  if (!draft) throw new Error(`There is no draft ${id}.`);
  if (draft.status !== "draft") throw new Error(`Draft ${id} is already ${draft.status}.`);
  const results: TxResult[] = [];

  if (draft.kind === "halt_stop_loss") {
    results.push(await act("owner", "mandate", "halt_stop_loss", draft.reason, { functionName: "haltStopLoss", args: [] }));
  } else if (draft.commitment && draft.kind === "add_commitment") {
    results.push(...(await addCommitment(draft.commitment, draft.reason)));
  } else if (draft.commitment && draft.kind === "set_aside") {
    results.push(await commitmentActions.setAside(draft.commitment.id!, draft.commitment.amountUsd, draft.reason));
  } else if (draft.commitment && draft.kind === "release_commitment") {
    results.push(await commitmentActions.release(draft.commitment.id!, draft.commitment.amountUsd, draft.reason));
  } else if (draft.payload) {
    const { mandate, rules, plan } = draft.payload;
    const symbols = SYMBOLS.filter((s) => rules[s]) as AssetSymbol[];
    if (draft.kind === "sign_mandate") {
      // the first mandate also gives the agent its key
      const agent = getClients().agentAccount.address;
      const expiry = BigInt(Math.floor(Date.now() / 1000) + AGENT_SESSION_SECONDS);
      results.push(
        await act("owner", "mandate", "sign_mandate", draft.reason, {
          functionName: "signMandate",
          args: [policyOf(mandate), symbols.map((s) => assets()[s].address), symbols.map((s) => ruleOf(rules[s]!)), agent, expiry],
        }),
      );
    } else {
      const p = await getPortfolio();
      if (JSON.stringify(policyOf(mandate)) !== JSON.stringify(policyOf(p.mandate))) {
        results.push(await act("owner", "mandate", "change_mandate", draft.reason, { functionName: "proposePolicy", args: [policyOf(mandate)] }));
      }
      for (const s of symbols) {
        const current = p.positions.find((x) => x.symbol === s)!.rule;
        const same = JSON.stringify(ruleOf(rules[s]!), bigintToString) === JSON.stringify(ruleOf(current), bigintToString);
        if (!same) {
          results.push(
            await act("owner", "mandate", "change_asset_rule", draft.reason, { functionName: "proposeAssetRule", args: [assets()[s].address, ruleOf(rules[s]!)] }),
          );
        }
      }
    }
    if (results.every((r) => r.ok)) writePlan({ ...readPlan(), ...plan });
  }

  if (results.every((r) => r.ok)) updateDraft(id, { status: "signed", txs: results.flatMap((r) => (r.ok ? [r.hash] : [])) });
  return { draft, results };
}

/** Applies every waiting change whose delay has passed. Returns what it applied and what is still waiting. */
export async function applyReady() {
  const p = await getPortfolio();
  const now = new Date(p.at).getTime();
  const applied: { what: string; result: TxResult }[] = [];
  const waiting: { what: string; appliesFrom: string }[] = [];
  const consider = async (
    what: string,
    at: string | null | undefined,
    functionName: string,
    args: readonly unknown[] = [],
    to: "vault" | "mandate" = "mandate",
    about?: { commitment: number; name: string },
  ) => {
    if (!at) return;
    if (new Date(at).getTime() <= now) {
      applied.push({ what, result: await act("owner", to, "apply_change", `Waiting period over: ${what}`, { functionName, args }, about) });
    } else {
      waiting.push({ what, appliesFrom: at });
    }
  };
  await consider("mandate change", p.pending.mandate?.appliesFrom, "applyPolicy");
  for (const pos of p.positions) await consider(`${pos.name} rule`, pos.pendingRule?.appliesFrom, "applyAssetRule", [pos.address]);
  await consider("stop-loss halt", p.stopLoss.haltRequestAppliesFrom, "applyStopLossHalt");
  await consider("withdrawal address", p.pending.withdrawalAddress?.appliesFrom, "applyWithdrawalAddress");
  await consider("agent key", p.pending.agentKey?.appliesFrom, "applyAgent");
  await consider("trusted contact change", p.pending.guardian?.appliesFrom, "applyGuardian");
  await consider("waiting period", p.pending.waitingPeriod?.appliesFrom, "applyLoosenDelay");
  await consider("unpause", p.pending.unpause?.appliesFrom, "applyUnpause");
  const meta = readMeta();
  for (const c of p.commitments) {
    const name = (meta[String(c.id)] ?? fallbackMeta(c)).name;
    await consider(name, c.pending?.appliesFrom, "applyCommitment", [BigInt(c.id)], "mandate", { commitment: c.id, name });
    await consider(`moving money from ${name} back into investing`, c.pendingRelease?.appliesFrom, "applyRelease", [BigInt(c.id)], "vault", { commitment: c.id, name });
  }
  return { applied, waiting };
}

/**
 * The owner signs for one trade the agent asked for, and the agent then makes
 * it. The signature is EIP-712 typed data: it names the vault, the chain, the
 * exact trade, a nonce and a window of half an hour, and the vault accepts it
 * once.
 */
export async function approveRequest(id: string) {
  const request = listApprovals().find((r) => r.id === id);
  if (!request) throw new Error(`There is no request ${id}.`);
  if (request.status !== "waiting") throw new Error(`Request ${id} is already ${request.status}.`);
  const cfg = chainConfig();
  const asset = assets()[request.symbol].address;
  const now = (await getClients().publicClient.getBlock()).timestamp;
  const approval: TradeApproval = {
    action: request.side === "buy" ? 0 : 1,
    assetIn: request.side === "buy" ? cfg.USD_ADDRESS : asset,
    assetOut: request.side === "buy" ? asset : cfg.USD_ADDRESS,
    amount: BigInt(request.amount),
    nonce: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
    // a minute of slack for clocks, well inside the one hour the vault allows
    validFrom: now - 60n,
    expiry: now + BigInt(APPROVAL_SECONDS),
  };
  const signature: Hex = await roleClient("owner").account.signTypedData({
    domain: approvalDomain(),
    types: APPROVAL_TYPES,
    primaryType: "TradeApproval",
    message: approval,
  });
  updateApproval(id, { status: "signed", nonce: approval.nonce.toString(), validFrom: Number(approval.validFrom), expiry: Number(approval.expiry), signature });

  const record: AuditRecord = {
    at: nowIso(),
    tool: "sign_approval",
    args: { request: id, nonce: approval.nonce.toString(), validForSeconds: APPROVAL_SECONDS },
    reason: `Owner signed for request ${id}: ${request.side} ${request.symbol}`,
    source: "owner",
    risk: null,
  };
  appendAudit({ ref: refOf(record), record, result: { ok: true, signed: true } });
  return executeApproved({ ...request, status: "signed" }, approval, signature, { source: "owner-approved" });
}

/** The owner says no. If a signature already exists, it is also cancelled on-chain so it can never be used. */
export async function rejectRequest(id: string, by: "owner" | "guardian" = "owner") {
  const request = listApprovals().find((r) => r.id === id);
  if (!request) throw new Error(`There is no request ${id}.`);
  updateApproval(id, { status: "rejected", note: `Rejected by the ${by}` });
  if (request.nonce && request.status === "signed") {
    return act("owner", "vault", "cancel_approval", `Cancelled the signed approval for request ${id}`, { functionName: "cancelApproval", args: [BigInt(request.nonce)] });
  }
  const record: AuditRecord = { at: nowIso(), tool: "reject_request", args: { request: id }, reason: `The ${by} rejected request ${id}`, source: by, risk: null };
  appendAudit({ ref: refOf(record), record, result: { ok: true } });
  return { ok: true as const };
}

function keyOf(what: Vetoable): Hex {
  const c = /^(commitment|release)-(\d+)$/.exec(what);
  if (c) return c[1] === "commitment" ? commitmentKey(Number(c[2])) : releaseKey(Number(c[2]));
  return what in VETO_KEYS ? VETO_KEYS[what as keyof typeof VETO_KEYS] : CHANGE_KEYS.rule(assets()[what as AssetSymbol].address);
}

export const ownerActions = {
  /** The owner drops one of their own waiting requests. Unlike the guardian, they may drop the guardian change too. */
  cancel: (what: Vetoable | "guardian") => {
    const key = what === "guardian" ? CHANGE_KEYS.guardian : keyOf(what);
    return act("owner", "mandate", "cancel_request", `Owner dropped the waiting change: ${what}`, { functionName: "cancelChange", args: [key] });
  },
  pause: () => act("owner", "mandate", "pause_agent", "Owner paused the agent", { functionName: "pause", args: [] }),
  /** Lifts the owner's own pause at once. A guardian's pause is only queued by this. */
  unpause: () => act("owner", "mandate", "unpause_agent", "Owner asked to unpause the agent", { functionName: "unpause", args: [] }),
  resumeStopLoss: () => act("owner", "mandate", "resume_stop_loss", "Owner switched the stop-loss back on", { functionName: "resumeStopLoss", args: [] }),
  proposeWithdrawalAddress: (to: Address) =>
    act("owner", "mandate", "change_withdrawal_address", "Owner asked to change the withdrawal address", { functionName: "proposeWithdrawalAddress", args: [to] }),
  removeGuardian: () =>
    act("owner", "mandate", "remove_guardian", "Owner asked to remove the trusted contact", { functionName: "setGuardian", args: ["0x0000000000000000000000000000000000000000"] }),
};

/** Everything the guardian may cancel. Its own removal is not on the list: the contract refuses that. */
export type Vetoable =
  | "mandate"
  | "stop-loss-halt"
  | "withdrawal-address"
  | "agent-key"
  | "waiting-period"
  | "unpause"
  | AssetSymbol
  /** a new payee or new terms waiting, or money waiting to go back into investing */
  | `commitment-${number}`
  | `release-${number}`;

const VETO_KEYS: Record<Exclude<Vetoable, AssetSymbol | `commitment-${number}` | `release-${number}`>, Hex> = {
  mandate: CHANGE_KEYS.mandate,
  "stop-loss-halt": CHANGE_KEYS.stopLossHalt,
  "withdrawal-address": CHANGE_KEYS.withdrawalAddress,
  "agent-key": CHANGE_KEYS.agentKey,
  "waiting-period": CHANGE_KEYS.waitingPeriod,
  unpause: CHANGE_KEYS.unpause,
};

export const guardianActions = {
  /** The guardian's "no": cancels a change that is waiting. */
  veto: (what: Vetoable) =>
    act("guardian", "mandate", "veto", `Trusted contact cancelled the waiting change: ${what}`, { functionName: "cancelChange", args: [keyOf(what)] }),
  /** Shown in the demo to prove the point: the contract refuses this one. */
  vetoOwnRemoval: () =>
    act("guardian", "mandate", "veto", "Trusted contact tried to cancel their own removal", { functionName: "cancelChange", args: [CHANGE_KEYS.guardian] }),
  pause: () => act("guardian", "mandate", "pause_agent", "Trusted contact paused the agent", { functionName: "pause", args: [] }),
  unpause: () => act("guardian", "mandate", "unpause_agent", "Trusted contact lifted the pause", { functionName: "unpause", args: [] }),
  haltStopLoss: () =>
    act("guardian", "mandate", "halt_stop_loss", "Trusted contact halted the stop-loss (price feed emergency)", { functionName: "haltStopLoss", args: [] }),
  resumeStopLoss: () => act("guardian", "mandate", "resume_stop_loss", "Trusted contact switched the stop-loss back on", { functionName: "resumeStopLoss", args: [] }),
};

// ---------------------------------------------------------------- commitments

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const nameOf = (id: number) => (readMeta()[String(id)] ?? { name: `Commitment ${id}` }).name;
const units = (usd: string | number) => parseUnits(Number(usd).toFixed(6), 6);

/**
 * Adds a commitment: the terms go to the mandate (a new payee waits; money
 * kept aside with nobody to pay applies at once), the name stays here, and
 * the money to set aside is moved out of the portfolio straight away.
 */
export async function addCommitment(d: CommitmentDraft, reason: string): Promise<TxResult[]> {
  if (!d.terms || !d.meta) throw new Error("A new commitment needs its terms and a name.");
  const p = await getPortfolio();
  const id = p.commitments.length + 1;
  const t = d.terms;
  const terms = {
    payee: t.payee ?? ZERO_ADDRESS,
    maxAmount: units(t.maxAmountUsd),
    period: t.periodSeconds,
    window: t.windowSeconds,
    nextDue: t.nextDue ? BigInt(Math.floor(new Date(t.nextDue).getTime() / 1000)) : 0n,
    active: true,
  };
  writeMeta(id, d.meta);
  const about = { commitment: id, name: d.meta.name };
  const results = [await act("owner", "mandate", "add_commitment", reason, { functionName: "proposeCommitment", args: [BigInt(id), terms] }, about)];
  if (results[0].ok && Number(d.amountUsd) > 0) {
    results.push(await act("owner", "vault", "set_aside", reason, { functionName: "reserve", args: [BigInt(id), units(d.amountUsd)] }, { ...about, amount: Number(d.amountUsd) }));
  }
  return results;
}

export const commitmentActions = {
  /** From free cash, at once. Setting money aside only lowers risk. */
  setAside: (id: number, usd: string, reason = "Owner set money aside") =>
    act("owner", "vault", "set_aside", reason, { functionName: "reserve", args: [BigInt(id), units(usd)] }, { commitment: id, name: nameOf(id), amount: Number(usd) }),
  /** Back into investing. It waits, and the trusted contact can cancel it. */
  release: (id: number, usd: string, reason = "Owner asked to move money back into investing") =>
    act("owner", "vault", "release_commitment", reason, { functionName: "proposeRelease", args: [BigInt(id), units(usd)] }, { commitment: id, name: nameOf(id), amount: Number(usd) }),
  /** The owner pays now, early or on time. It counts for the current due date. */
  payNow: async (id: number, usd: string, requestId?: string) => {
    const result = await act(
      "owner",
      "vault",
      "pay_commitment",
      requestId ? `Owner paid request ${requestId}` : "Owner paid it now",
      { functionName: "payCommitment", args: [BigInt(id), units(usd), "0x" + "00".repeat(32)] },
      { commitment: id, name: nameOf(id), amount: Number(usd) },
    );
    if (requestId) updatePaymentRequest(requestId, result.ok ? { status: "paid", tx: result.hash } : { status: "failed", note: result.error?.explanation ?? result.message });
    return result;
  },
  /** Ends a commitment at once. Money set aside for it stays set aside until moved back or withdrawn. */
  remove: async (id: number) => {
    const p = await getPortfolio();
    const c = p.commitments.find((x) => x.id === id);
    if (!c) throw new Error(`There is no commitment ${id}.`);
    const terms = {
      payee: c.payee ?? ZERO_ADDRESS,
      maxAmount: units(c.maxAmount),
      period: c.periodSeconds,
      window: c.windowSeconds,
      nextDue: c.nextDue ? BigInt(Math.floor(new Date(c.nextDue).getTime() / 1000)) : 0n,
      active: false,
    };
    return act("owner", "mandate", "remove_commitment", "Owner ended the commitment", { functionName: "proposeCommitment", args: [BigInt(id), terms] }, { commitment: id, name: nameOf(id) });
  },
  /** Off-chain: whether a due payment goes out by itself or waits for the owner. */
  setAutopay: (id: number, on: boolean) => {
    const current: CommitmentMeta = readMeta()[String(id)] ?? { name: `Commitment ${id}`, kind: "other", payeeName: null, autopay: false };
    writeMeta(id, { ...current, autopay: on });
    return { ok: true as const };
  },
  dismissRequest: (requestId: string) => {
    if (!listPaymentRequests().some((r) => r.id === requestId)) throw new Error(`There is no payment request ${requestId}.`);
    updatePaymentRequest(requestId, { status: "dismissed" });
    return { ok: true as const };
  },
};
