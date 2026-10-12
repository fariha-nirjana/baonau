import { parseUnits, type Address } from "viem";
import { assets, SYMBOLS, type AssetSymbol } from "./assets";
import { appendAudit, refOf, type AuditRecord } from "./audit";
import { PRICE_DECIMALS } from "./config";
import { listDrafts, updateDraft, type Draft } from "./drafts";
import { readPlan, writePlan } from "./plan";
import { CHANGE_KEYS, getPortfolio, sendAsRole, type AssetRule, type Mandate, type RawCall, type TxResult } from "./vault";

/**
 * What the owner and the guardian do with their own keys. In the demo these
 * keys sit on the server so that a button can sign. In a real product each
 * person signs in their own wallet. Nothing the agent runs imports this file.
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

async function act(role: "owner" | "guardian", tool: string, reason: string, call: RawCall): Promise<TxResult> {
  const result = await sendAsRole(role, "vault", call);
  const args = JSON.parse(JSON.stringify(call.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as unknown[];
  const record: AuditRecord = { at: new Date().toISOString(), tool, args: { call: call.functionName, args }, reason, source: role, risk: null };
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
    results.push(await act("owner", "halt_stop_loss", draft.reason, { functionName: "haltStopLoss", args: [] }));
  } else if (draft.payload) {
    const { mandate, rules, plan } = draft.payload;
    const symbols = SYMBOLS.filter((s) => rules[s]) as AssetSymbol[];
    if (draft.kind === "sign_mandate") {
      results.push(
        await act("owner", "sign_mandate", draft.reason, {
          functionName: "initialize",
          args: [policyOf(mandate), symbols.map((s) => assets()[s].address), symbols.map((s) => ruleOf(rules[s]!))],
        }),
      );
    } else {
      const p = await getPortfolio();
      if (JSON.stringify(policyOf(mandate)) !== JSON.stringify(policyOf(p.mandate))) {
        results.push(await act("owner", "change_mandate", draft.reason, { functionName: "proposePolicy", args: [policyOf(mandate)] }));
      }
      for (const s of symbols) {
        const current = p.positions.find((x) => x.symbol === s)!.rule;
        const same = JSON.stringify(ruleOf(rules[s]!), bigintToString) === JSON.stringify(ruleOf(current), bigintToString);
        if (!same) {
          results.push(await act("owner", "change_asset_rule", draft.reason, { functionName: "proposeAssetRule", args: [assets()[s].address, ruleOf(rules[s]!)] }));
        }
      }
    }
    if (results.every((r) => r.ok)) writePlan({ ...readPlan(), ...plan });
  }

  const ok = results.every((r) => r.ok);
  if (ok) updateDraft(id, { status: "signed", txs: results.flatMap((r) => (r.ok ? [r.hash] : [])) });
  return { draft, results };
}

const bigintToString = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Applies every waiting change whose delay has passed. Returns what it applied and what is still waiting. */
export async function applyReady() {
  const p = await getPortfolio();
  const now = new Date(p.at).getTime();
  const ready = (at: string | null | undefined) => !!at && new Date(at).getTime() <= now;
  const applied: { what: string; result: TxResult }[] = [];
  const waiting: { what: string; appliesFrom: string }[] = [];
  const consider = async (what: string, at: string | null | undefined, call: RawCall) => {
    if (!at) return;
    if (ready(at)) applied.push({ what, result: await act("owner", "apply_change", `Waiting period over: ${what}`, call) });
    else waiting.push({ what, appliesFrom: at });
  };
  await consider("mandate change", p.pending.mandate?.appliesFrom, { functionName: "applyPolicy", args: [] });
  for (const pos of p.positions) {
    await consider(`${pos.name} rule`, pos.pendingRule?.appliesFrom, { functionName: "applyAssetRule", args: [pos.address] });
  }
  await consider("stop-loss halt", p.stopLoss.haltRequestAppliesFrom, { functionName: "applyStopLossHalt", args: [] });
  await consider("withdrawal address", p.pending.withdrawalAddress?.appliesFrom, { functionName: "applyWithdrawalAddress", args: [] });
  return { applied, waiting };
}

export const ownerActions = {
  approveRequest: (id: number) => act("owner", "approve_request", `Owner approved request ${id}`, { functionName: "approveRequest", args: [BigInt(id)] }),
  rejectRequest: (id: number) => act("owner", "reject_request", `Owner rejected request ${id}`, { functionName: "rejectRequest", args: [BigInt(id)] }),
  pause: () => act("owner", "pause_agent", "Owner paused the agent", { functionName: "pause", args: [] }),
  unpause: () => act("owner", "unpause_agent", "Owner unpaused the agent", { functionName: "unpause", args: [] }),
  resumeStopLoss: () => act("owner", "resume_stop_loss", "Owner switched the stop-loss back on", { functionName: "resumeStopLoss", args: [] }),
  proposeWithdrawalAddress: (to: Address) =>
    act("owner", "change_withdrawal_address", "Owner asked to change the withdrawal address", { functionName: "proposeWithdrawalAddress", args: [to] }),
};

export type Vetoable = "mandate" | "stop-loss-halt" | "withdrawal-address" | AssetSymbol;

export const guardianActions = {
  /** The guardian's "no": cancels a change that is waiting. */
  veto: (what: Vetoable) => {
    const key =
      what === "mandate"
        ? CHANGE_KEYS.mandate
        : what === "stop-loss-halt"
          ? CHANGE_KEYS.stopLossHalt
          : what === "withdrawal-address"
            ? CHANGE_KEYS.withdrawalAddress
            : CHANGE_KEYS.rule(assets()[what].address);
    return act("guardian", "veto", `Guardian cancelled the waiting change: ${what}`, { functionName: "cancelChange", args: [key] });
  },
  pause: () => act("guardian", "pause_agent", "Guardian paused the agent", { functionName: "pause", args: [] }),
  haltStopLoss: () => act("guardian", "halt_stop_loss", "Guardian halted the stop-loss (price feed emergency)", { functionName: "haltStopLoss", args: [] }),
  resumeStopLoss: () => act("guardian", "resume_stop_loss", "Guardian switched the stop-loss back on", { functionName: "resumeStopLoss", args: [] }),
  rejectRequest: (id: number) => act("guardian", "reject_request", `Guardian rejected request ${id}`, { functionName: "rejectRequest", args: [BigInt(id)] }),
};
