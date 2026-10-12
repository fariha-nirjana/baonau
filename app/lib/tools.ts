import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { parseUnits } from "viem";
import { z } from "zod";
import { assetBySymbol, type AssetSymbol } from "./assets";
import { appendAudit, readAudit, refOf, type AuditRecord } from "./audit";
import { chainConfig, PRICE_DECIMALS, USD_SYMBOL } from "./config";
import { addDraft, type MandateDraft } from "./drafts";
import { display, rateNote, toUsd, type Currency } from "./money";
import { markBought, readPlan, type Language } from "./plan";
import { planRebalance } from "./planner";
import { movesFrom, readPrices } from "./prices";
import { recentReceipts } from "./receipts";
import { defaultScamList, evaluate, historyFromAudit, type Action, type Facts, type Leg } from "./risk";
import {
  getPortfolio,
  sendAsAgent,
  toAssetUnits,
  toUsdUnits,
  type AgentCall,
  type AssetRule,
  type Mandate,
  type Order,
  type Portfolio,
  type Position,
  type SendOptions,
} from "./vault";

const asset = z.enum(["IDX", "BOND", "GOLD", "MEME"]).describe("IDX is the index fund, BOND the bond fund, GOLD is gold.");
const mandateAsset = z.enum(["IDX", "BOND", "GOLD"]);
const amount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "amount must be a plain decimal like 500 or 12.50")
  .describe('A plain decimal such as "500" or "12.50", in the currency given by `currency`.');
const currency = z
  .enum([USD_SYMBOL, "BDT", "CNY", "USD"])
  .default(USD_SYMBOL)
  .describe("The currency the amount is in. Pass the user's own currency and let the tool convert it.");
const reason = z.string().min(1).describe("One sentence on why you are doing this. It goes into the receipt.");
const pct = (min: number, max: number) => z.number().min(min).max(max);

const schemas = {
  get_portfolio: z.object({}),
  get_mandate: z.object({}),
  get_market: z.object({}),
  get_activity: z.object({ limit: z.number().int().min(1).max(20).default(8) }),
  buy: z.object({ asset, amount, currency, reason }),
  sell: z.object({
    asset,
    amount: z.union([amount, z.literal("all")]).describe('The value to sell, or "all" for the whole holding.'),
    currency,
    reason,
  }),
  rebalance: z.object({ reason }),
  request_owner_approval: z.object({ asset, side: z.enum(["buy", "sell"]), amount, currency, reason }),
  draft_mandate: z.object({
    max_trade_pct: pct(0.1, 100).describe("Largest single trade, as a percent of the portfolio."),
    daily_volume_pct: pct(0.1, 600).describe("Most the agent may trade in a day, as a percent of the portfolio."),
    daily_loss_pct: pct(0.1, 100).describe("A fall this large in one day pauses all buying."),
    min_defensive_pct: pct(0, 100).describe("Least that must stay in cash plus the bond fund."),
    loss_streak: z.number().int().min(0).max(20).describe("Losing sells in a row that pause buying. 0 turns the rule off."),
    cooldown_minutes: z.number().min(1).max(43200).describe("How long buying stays paused after a loss trigger, in minutes."),
    assets: z
      .array(
        z.object({
          asset: mandateAsset,
          max_share_pct: pct(0, 100).describe("Cap on this asset's share of the portfolio."),
          target_pct: pct(0, 100).describe("The share the plan aims for. It cannot be above the cap."),
          stop_loss_drop_pct: pct(1, 90)
            .nullable()
            .optional()
            .describe("Sell the holding if the price falls this far below today's price. null for no stop. Leave out to keep the current stop."),
        }),
      )
      .min(1),
    recurring_buy: z
      .object({ asset: mandateAsset, amount, currency, every_hours: z.number().min(0.01).max(8760) })
      .nullable()
      .optional(),
    reason,
  }),
  request_stop_loss_halt: z.object({ reason }),
} as const;

type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  get_portfolio: "Read the portfolio: what is held, what it is worth, today's loss, and how much the agent can still trade today.",
  get_mandate: "Read the signed mandate: every limit, each asset's cap and stop price, who holds which key, and any change that is waiting.",
  get_market: "Read current prices, how far each has moved in the last hour, and any risk signals such as a token being on the scam list.",
  get_activity:
    "Read the latest receipts, newest first: trades, refusals, stop-losses the keeper fired, changes the owner or guardian made. Use it when asked what happened.",
  buy: "Buy an asset with cash from the vault. The mandate decides whether it goes through.",
  sell: "Sell an asset into cash. Selling is always possible within the size limits, including while buying is paused.",
  rebalance:
    "Move the portfolio towards the plan's target shares in one transaction. The tool works out the trades and keeps them inside the mandate.",
  request_owner_approval: "Ask the owner to approve one trade that is above your size limits. Nothing is traded until they approve.",
  draft_mandate:
    "Write a mandate for the owner to read and sign: from their goal when there is none yet, or as a change to the current one. You cannot sign it. Give every term each time. Anything that raises the risk only takes effect after a waiting period, and the guardian can cancel it.",
  request_stop_loss_halt:
    "Prepare a request to switch the automatic stop-loss off, for the owner to sign. It does not take effect until a waiting period has passed, and the guardian can cancel it.",
};

export const toolDefs: ChatCompletionFunctionTool[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  // drop the $schema marker, which some OpenAI-compatible providers reject
  const parameters: Record<string, unknown> = { ...z.toJSONSchema(schemas[name]) };
  delete parameters.$schema;
  return { type: "function", function: { name, description: descriptions[name], parameters } };
});

export type ToolContext = {
  /** Where the current instruction came from, for the audit log. */
  source: string;
  /** True when the instruction came from news, token text or a message the owner did not write. */
  untrusted?: boolean;
  /** Skip the off-chain risk engine. Only for showing that the contract holds without it. */
  bypassRisk?: boolean;
  send?: SendOptions;
  currency?: Currency;
  language?: Language;
};

// ---------------------------------------------------------------- reads

const show = (usd: string | number, ctx: ToolContext) => display(usd, ctx.currency);

function portfolioView(p: Portfolio, ctx: ToolContext) {
  return {
    total_value: show(p.totalValue, ctx),
    cash: show(p.cash, ctx),
    cash_share_pct: p.cashSharePct,
    cash_and_defensive_share_pct: p.defensiveSharePct,
    holdings: p.positions
      .filter((x) => Number(x.amount) > 0 || x.rule.allowed)
      .map((x) => ({
        asset: x.symbol,
        name: x.label,
        units: x.amount,
        value: show(x.value, ctx),
        share_pct: x.sharePct,
        cap_pct: x.rule.maxExposurePct,
        cost: show(x.cost, ctx),
      })),
    today: {
      loss_pct: p.today.lossPct,
      largest_single_trade: show(p.today.maxTrade, ctx),
      trading_left_today: show(p.today.volumeLeft, ctx),
      losing_sells_in_a_row: p.today.lossStreak,
    },
    buying_paused: p.protect.active,
    buying_paused_until: p.protect.cooldownUntil,
    agent_paused: p.agent.paused,
    mandate_signed: p.mandateSigned,
    money_note: `${rateNote(ctx.currency ?? "BDT")}. Test money on a testnet, no real value.`,
  };
}

function mandateView(p: Portfolio) {
  return {
    signed: p.mandateSigned,
    limits: {
      max_trade_pct: p.mandate.maxTradePct,
      daily_volume_pct: p.mandate.maxDailyVolumePct,
      daily_loss_pct: p.mandate.dailyLossPct,
      min_defensive_pct: p.mandate.minDefensivePct,
      loss_streak: p.mandate.maxLossStreak,
      cooldown_minutes: Math.round((p.mandate.cooldownSeconds / 60) * 100) / 100,
    },
    assets: p.positions
      .filter((x) => x.rule.allowed)
      .map((x) => ({
        asset: x.symbol,
        name: x.label,
        max_share_pct: x.rule.maxExposurePct,
        counts_as_defensive: x.rule.defensive,
        stop_price: x.rule.stopPrice,
        price_now: x.price,
        change_waiting: x.pendingRule,
      })),
    plan: readPlan(),
    rules_of_change: `Lowering risk applies at once. Raising risk waits ${p.settings.loosenDelaySeconds} seconds, and the guardian can cancel it during the wait.`,
    leverage: "Not possible. The vault has no way to borrow.",
    keys: {
      owner: "sets the mandate, approves requests, deposits and withdraws",
      guardian: "can pause the agent, cancel a waiting change and halt the stop-loss in an emergency. Cannot move funds.",
      agent: `can trade inside the mandate until ${p.agent.keyExpires ?? "no key is set"}`,
    },
    changes_waiting: {
      mandate: p.pending.mandate,
      stop_loss_halt_applies_from: p.stopLoss.haltRequestAppliesFrom,
      withdrawal_address: p.pending.withdrawalAddress,
    },
    stop_loss_halted_until: p.stopLoss.haltedUntil,
  };
}

async function gatherFacts(portfolio: Portfolio, ctx: ToolContext): Promise<Facts> {
  const meme = chainConfig().MEME_ADDRESS;
  const current = Object.fromEntries(portfolio.positions.map((x) => [x.symbol, Number(x.price)]));
  const now = new Date(portfolio.at);
  return {
    portfolio,
    history: historyFromAudit(readAudit()),
    moves: movesFrom(readPrices(), current, now),
    scamList: defaultScamList([{ address: meme, label: "reported pump-and-dump" }]),
    now,
    untrusted: ctx.untrusted ?? false,
  };
}

async function marketView(ctx: ToolContext) {
  const p = await getPortfolio();
  const facts = await gatherFacts(p, ctx);
  return {
    prices: p.positions.map((x) => {
      const move = facts.moves[x.symbol];
      const scam = facts.scamList.find((s) => s.address.toLowerCase() === x.address.toLowerCase());
      return {
        asset: x.symbol,
        name: x.label,
        price: x.price,
        price_updated: x.priceUpdatedAt,
        price_out_of_date: x.priceIsStale,
        change_last_hour_pct: move ? Math.round(move.pct * 100) / 100 : null,
        in_mandate: x.rule.allowed,
        risk_signal: scam ? `On the scam token list: ${scam.label}` : null,
      };
    }),
    note: "Prices come from the demo's own price feed. They describe what has happened and are not a forecast.",
  };
}

// ---------------------------------------------------------------- trades

const priceUnits = (p: Position) => parseUnits(p.price, PRICE_DECIMALS);
/** Asset units worth `usd` at the oracle price, never more than is held. */
function unitsFor(p: Position, usd: string): bigint {
  const held = toAssetUnits(p.amount);
  const units = (toUsdUnits(usd) * 10n ** 20n) / priceUnits(p);
  return units > held ? held : units;
}
const usdOf = (p: Position, units: bigint) => Number((units * priceUnits(p)) / 10n ** 20n) / 1e6;

type Prepared = { legs: Leg[]; call: (ref: `0x${string}`) => AgentCall; escalation?: (ref: `0x${string}`) => AgentCall };

async function trade(
  tool: ToolName,
  args: Record<string, unknown>,
  why: string,
  ctx: ToolContext,
  kind: Action["kind"],
  prepare: (p: Portfolio) => Prepared | { error: string },
) {
  const portfolio = await getPortfolio();
  const prepared = prepare(portfolio);
  if ("error" in prepared) return { ok: false, stage: "input", message: prepared.error };

  const record: AuditRecord = {
    at: new Date().toISOString(),
    tool,
    args,
    reason: why,
    source: ctx.source,
    legs: prepared.legs,
    risk: null,
  };
  if (!ctx.bypassRisk) {
    const action: Action =
      kind === "rebalance" ? { kind, legs: prepared.legs } : ({ kind, ...prepared.legs[0] } as Action);
    record.risk = evaluate(action, await gatherFacts(portfolio, ctx));
  }
  const verdict = record.risk;
  const ref = refOf(record);

  if (verdict?.decision === "block" || (verdict?.decision === "escalate" && !prepared.escalation)) {
    const result = { ok: false, stage: "risk", message: verdict.explanation } as const;
    appendAudit({ ref, record, result });
    return { ...result, audit_ref: ref };
  }

  // A trade the risk engine will not let the agent make alone becomes a request to the owner.
  if (verdict?.decision === "escalate" && prepared.escalation) {
    const sent = await sendAsAgent(prepared.escalation(ref), ctx.send);
    const requestId = sent.ok ? sent.events.find((e) => e.name === "TradeRequested")?.args.requestId : undefined;
    const result = sent.ok
      ? { ...sent, escalated: true, request_id: requestId, message: `Not traded. ${verdict.explanation} Request ${requestId} is waiting for the owner.` }
      : sent;
    appendAudit({ ref, record, result });
    return { ...result, audit_ref: ref };
  }

  const result = await sendAsAgent(prepared.call(ref), ctx.send);
  appendAudit({ ref, record, result });
  if (result.ok && ctx.source === "autopilot" && tool === "buy") markBought(prepared.legs[0].symbol, new Date());
  return { ...result, audit_ref: ref };
}

const findPosition = (p: Portfolio, symbol: string) => p.positions.find((x) => x.symbol === symbol);

function prepareSingle(p: Portfolio, symbol: AssetSymbol, side: "buy" | "sell", value: string, approvalOnly: boolean): Prepared | { error: string } {
  const pos = findPosition(p, symbol);
  const info = assetBySymbol(symbol);
  if (!pos || !info) return { error: `Unknown asset ${symbol}.` };

  if (side === "buy") {
    const usdIn = toUsdUnits(value);
    const request = (ref: `0x${string}`): AgentCall => ({ functionName: "requestTrade", args: [info.address, true, usdIn, ref] });
    return {
      legs: [{ symbol, side, usd: Number(value) }],
      call: approvalOnly ? request : (ref) => ({ functionName: "buy", args: [info.address, usdIn, ref] }),
      escalation: request,
    };
  }
  const units = value === "all" ? toAssetUnits(pos.amount) : unitsFor(pos, value);
  if (units === 0n) return { error: `The vault holds no ${pos.name}.` };
  const request = (ref: `0x${string}`): AgentCall => ({ functionName: "requestTrade", args: [info.address, false, units, ref] });
  return {
    legs: [{ symbol, side, usd: usdOf(pos, units) }],
    call: approvalOnly ? request : (ref) => ({ functionName: "sell", args: [info.address, units, ref] }),
    escalation: request,
  };
}

function prepareRebalance(p: Portfolio): Prepared | { error: string; plan?: unknown } {
  const targets = readPlan().targets;
  if (Object.keys(targets).length === 0) return { error: "There is no plan with target shares yet. Draft a mandate first." };
  const plan = planRebalance(p, targets);
  if (plan.legs.length === 0) {
    return { error: `Nothing to rebalance: every asset is close enough to its target. ${plan.notes.join(" ")}`.trim() };
  }
  const orders: Order[] = plan.legs.map((leg) => {
    const pos = findPosition(p, leg.symbol)!;
    const sellsAll = leg.side === "sell" && leg.usd >= Number(pos.value) * 0.999;
    return {
      asset: pos.address,
      isBuy: leg.side === "buy",
      amount: leg.side === "buy" ? toUsdUnits(leg.usd.toFixed(6)) : sellsAll ? toAssetUnits(pos.amount) : unitsFor(pos, leg.usd.toFixed(6)),
    };
  });
  return { legs: plan.legs, call: (ref) => ({ functionName: "rebalance", args: [orders, ref] }) };
}

// ---------------------------------------------------------------- mandate drafts

type DraftArgs = z.infer<typeof schemas.draft_mandate>;

function buildDraft(a: DraftArgs, p: Portfolio, ctx: ToolContext) {
  const problems: string[] = [];
  const mandate: Mandate = {
    maxTradePct: a.max_trade_pct,
    maxDailyVolumePct: a.daily_volume_pct,
    dailyLossPct: a.daily_loss_pct,
    maxSlippagePct: p.mandateSigned ? p.mandate.maxSlippagePct : 1,
    minDefensivePct: a.min_defensive_pct,
    maxLossStreak: a.loss_streak,
    cooldownSeconds: Math.round(a.cooldown_minutes * 60),
  };

  const rules: MandateDraft["rules"] = {};
  const targets: Record<string, number> = {};
  let risky = 0;
  for (const row of a.assets) {
    const pos = findPosition(p, row.asset)!;
    if (row.target_pct > row.max_share_pct) problems.push(`${row.asset}: the target of ${row.target_pct}% is above its cap of ${row.max_share_pct}%.`);
    // the bond fund is the defensive asset in this demo; nothing else counts towards the floor
    const defensive = row.asset === "BOND";
    if (!defensive) risky += row.target_pct;
    const stopPrice =
      row.stop_loss_drop_pct === undefined
        ? pos.rule.stopPrice
        : row.stop_loss_drop_pct === null
          ? null
          : (Number(pos.price) * (1 - row.stop_loss_drop_pct / 100)).toFixed(2);
    rules[row.asset] = { allowed: true, defensive, maxExposurePct: row.max_share_pct, stopPrice };
    targets[row.asset] = row.target_pct;
  }
  const totalTarget = a.assets.reduce((sum, r) => sum + r.target_pct, 0);
  if (totalTarget > 100) problems.push(`The targets add up to ${totalTarget}%, which is more than the whole portfolio.`);
  // fees and price moves shift the shares a little, so targets that sit right on the floor could never be reached
  if (100 - risky < a.min_defensive_pct + 2) {
    problems.push(
      `The targets leave ${100 - risky}% in cash and the bond fund. That must be at least 2 points above the ${a.min_defensive_pct}% minimum in the same mandate, or the last purchases would be refused.`,
    );
  }

  const recurring = [];
  if (a.recurring_buy) {
    const usd = toUsd(Number(a.recurring_buy.amount), a.recurring_buy.currency as Currency | typeof USD_SYMBOL);
    if (!rules[a.recurring_buy.asset]) problems.push(`The recurring buy is for ${a.recurring_buy.asset}, which is not in this mandate.`);
    if (Number(usd) > (Number(p.totalValue) * a.max_trade_pct) / 100) {
      problems.push(`The recurring buy of ${show(usd, ctx)} is above the single-trade limit of ${a.max_trade_pct}% of the portfolio.`);
    }
    recurring.push({ symbol: a.recurring_buy.asset, usd, everyHours: a.recurring_buy.every_hours, lastRunAt: null });
  }
  if (problems.length) return { ok: false as const, message: `The mandate does not hold together. ${problems.join(" ")}` };

  // compare with what is signed now, term by term: is this a rise in risk, a cut, or nothing?
  const raises: string[] = [];
  const lowers: string[] = [];
  if (p.mandateSigned) {
    const m = p.mandate;
    const cmp = (label: string, now: number, next: number, higherIsRiskier: boolean) => {
      if (now === next) return;
      ((next > now) === higherIsRiskier ? raises : lowers).push(`${label}: ${now} to ${next}`);
    };
    cmp("largest trade %", m.maxTradePct, mandate.maxTradePct, true);
    cmp("daily volume %", m.maxDailyVolumePct, mandate.maxDailyVolumePct, true);
    cmp("daily loss limit %", m.dailyLossPct, mandate.dailyLossPct, true);
    cmp("minimum defensive %", m.minDefensivePct, mandate.minDefensivePct, false);
    cmp("cooldown minutes", m.cooldownSeconds / 60, mandate.cooldownSeconds / 60, false);
    if (m.maxLossStreak !== mandate.maxLossStreak) {
      const looser = mandate.maxLossStreak === 0 || (m.maxLossStreak !== 0 && mandate.maxLossStreak > m.maxLossStreak);
      (looser ? raises : lowers).push(`losing sells before a pause: ${m.maxLossStreak} to ${mandate.maxLossStreak}`);
    }
    for (const pos of p.positions) {
      const next: AssetRule = rules[pos.symbol] ?? { ...pos.rule, allowed: false };
      if (!rules[pos.symbol] && !pos.rule.allowed) continue;
      rules[pos.symbol] = next;
      if (next.allowed !== pos.rule.allowed) (next.allowed ? raises : lowers).push(`${pos.name}: ${next.allowed ? "added to" : "removed from"} the mandate`);
      cmp(`${pos.name} cap %`, pos.rule.maxExposurePct, next.maxExposurePct, true);
      cmp(`${pos.name} stop price`, Number(pos.rule.stopPrice ?? 0), Number(next.stopPrice ?? 0), false);
    }
  }

  const summary = [
    `Assets: ${a.assets.map((r) => `${findPosition(p, r.asset)!.name} up to ${r.max_share_pct}% (aim ${r.target_pct}%)`).join(", ")}`,
    `At least ${mandate.minDefensivePct}% stays in cash and the bond fund`,
    `Largest single trade: ${mandate.maxTradePct}% of the portfolio`,
    `Most traded in a day: ${mandate.maxDailyVolumePct}% of the portfolio`,
    `Buying pauses if the portfolio falls ${mandate.dailyLossPct}% in a day${mandate.maxLossStreak ? ` or after ${mandate.maxLossStreak} losing sells in a row` : ""}, for ${a.cooldown_minutes} minutes`,
    ...a.assets
      .filter((r) => rules[r.asset]?.stopPrice)
      .map((r) => `${findPosition(p, r.asset)!.name} is sold automatically at ${rules[r.asset]!.stopPrice} (now ${findPosition(p, r.asset)!.price})`),
    ...(recurring.length ? [`Recurring buy: ${show(recurring[0].usd, ctx)} of ${recurring[0].symbol} every ${recurring[0].everyHours} hours`] : []),
    "No borrowing. Lowering risk is immediate, raising risk waits and the guardian can cancel it",
  ];

  if (p.mandateSigned && raises.length === 0 && lowers.length === 0 && recurring.length === 0) {
    const sameTargets = JSON.stringify(readPlan().targets) === JSON.stringify(targets);
    if (sameTargets) return { ok: false as const, message: "This is the same as the mandate already signed. Nothing to change." };
  }

  const risk = !p.mandateSigned ? "first_mandate" : raises.length ? "raises" : "lowers";
  const draft = addDraft({
    kind: p.mandateSigned ? "change_mandate" : "sign_mandate",
    summary,
    risk,
    reason: a.reason,
    payload: { mandate, rules, plan: { targets, driftPct: readPlan().driftPct, recurring } },
  });
  const wait = p.settings.loosenDelaySeconds;
  return {
    ok: true as const,
    draft_id: draft.id,
    summary,
    raises_risk: raises,
    lowers_risk: lowers,
    what_happens_next:
      risk === "first_mandate"
        ? "Nothing is in force yet. When the owner signs, the mandate goes on-chain and the agent can start."
        : risk === "raises"
          ? `Nothing has changed. If the owner signs, the whole change waits ${wait} seconds before it can take effect, and the guardian can cancel it in that time. The current mandate stays in force meanwhile.`
          : "Nothing has changed yet. This only lowers risk, so it applies as soon as the owner signs.",
  };
}

/** Runs one tool call from the model. Bad input comes back as an error result, never as a thrown exception. */
export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<unknown> {
  if (!(name in schemas)) return { ok: false, message: `Unknown tool: ${name}` };
  const tool = name as ToolName;

  let json: unknown;
  try {
    json = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, message: "Tool arguments were not valid JSON." };
  }
  const parsed = schemas[tool].safeParse(json);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  try {
    switch (tool) {
      case "get_portfolio":
        return portfolioView(await getPortfolio(), ctx);
      case "get_mandate":
        return mandateView(await getPortfolio());
      case "get_market":
        return await marketView(ctx);
      case "get_activity": {
        const a = parsed.data as z.infer<typeof schemas.get_activity>;
        return recentReceipts(readAudit(), a.limit, ctx.currency).map((r) => ({ ...r, ref: undefined }));
      }
      case "buy": {
        const a = parsed.data as z.infer<typeof schemas.buy>;
        const usd = toUsd(Number(a.amount), a.currency as Currency | typeof USD_SYMBOL);
        return await trade(tool, a, a.reason, ctx, "trade", (p) => prepareSingle(p, a.asset, "buy", usd, false));
      }
      case "sell": {
        const a = parsed.data as z.infer<typeof schemas.sell>;
        const value = a.amount === "all" ? "all" : toUsd(Number(a.amount), a.currency as Currency | typeof USD_SYMBOL);
        return await trade(tool, a, a.reason, ctx, "trade", (p) => prepareSingle(p, a.asset, "sell", value, false));
      }
      case "rebalance": {
        const a = parsed.data as z.infer<typeof schemas.rebalance>;
        return await trade(tool, a, a.reason, ctx, "rebalance", prepareRebalance);
      }
      case "request_owner_approval": {
        const a = parsed.data as z.infer<typeof schemas.request_owner_approval>;
        const usd = toUsd(Number(a.amount), a.currency as Currency | typeof USD_SYMBOL);
        return await trade(tool, a, a.reason, ctx, "request_approval", (p) => prepareSingle(p, a.asset, a.side, usd, true));
      }
      case "draft_mandate":
        return buildDraft(parsed.data as DraftArgs, await getPortfolio(), ctx);
      case "request_stop_loss_halt": {
        const a = parsed.data as z.infer<typeof schemas.request_stop_loss_halt>;
        const p = await getPortfolio();
        const draft = addDraft({
          kind: "halt_stop_loss",
          summary: ["Switch off the automatic stop-loss for up to 3 days"],
          risk: "raises",
          reason: a.reason,
          payload: null,
        });
        return {
          ok: true,
          draft_id: draft.id,
          what_happens_next: `Nothing has changed and the stop-loss is still on. If the owner signs, the halt waits ${p.settings.loosenDelaySeconds} seconds before it can take effect, and the guardian can cancel it in that time.`,
        };
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
