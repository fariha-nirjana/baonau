"use client";

import { useState, type ReactNode } from "react";
import type { Draft } from "@/lib/drafts";
import type { Receipt } from "@/lib/receipts";
import type { TxResult } from "@/lib/vault";
import { Mascot } from "./Mascot";
import type { Act, AppState, Mood, Settings } from "./types";
import { Bar, Button, Card, Chip, Eyebrow, Money, moneyText, short, shortTime, useCountdown } from "./ui";

type ViewProps = { state: AppState; settings: Settings; act: Act; skew: number };

function useBusy(act: Act) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, ...args: Parameters<Act>) => {
    setBusy(id);
    try {
      return await act(...args);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- portfolio

function ExposureCard({ state, settings, mood, speech }: { state: AppState; settings: Settings; mood: Mood; speech: string }) {
  const p = state.portfolio;
  const cap = Number(p.today.volumeUsed) + Number(p.today.volumeLeft);
  const used = cap > 0 ? (Number(p.today.volumeUsed) / cap) * 100 : 0;
  return (
    <section className={`mood-${mood} flex gap-6 rounded-(--radius-card) border p-7`} style={{ background: "var(--mood-soft)", borderColor: "var(--mood-line)" }}>
      <div className="min-w-0 flex-1">
        <Eyebrow>If the AI were hacked today</Eyebrow>
        <div className="mt-4 grid grid-cols-3 gap-5">
          <div>
            <p className="text-base text-muted">It could send out of your vault</p>
            <p className="num mt-1 text-5xl font-semibold">{moneyText(0, settings.currency)}</p>
            <p className="mt-1 text-sm text-muted">Always. Only you can withdraw.</p>
          </div>
          <div>
            <p className="text-base text-muted">It could still trade, inside your assets</p>
            <div className="mt-1">
              <Money usd={p.agentExposure.tradable} currency={settings.currency} size="lg" />
            </div>
          </div>
          <div>
            <p className="text-base text-muted">Those trades could cost at most</p>
            <div className="mt-1">
              <Money usd={p.agentExposure.maxCost} currency={settings.currency} size="lg" />
            </div>
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-base">
            <span>
              {moneyText(p.today.volumeUsed, settings.currency)} of today&apos;s trading allowance used
            </span>
            <span className="font-semibold">{moneyText(p.today.volumeLeft, settings.currency)} left</span>
          </div>
          <Bar value={used} />
        </div>
        <p className="mt-4 text-base text-muted">This is a limit on the AI. It is not a limit on the market: prices of the assets you hold can still fall.</p>
      </div>
      <div className="flex w-52 shrink-0 flex-col items-center justify-center gap-3">
        <p className="rounded-2xl bg-card px-4 py-2.5 text-center text-base font-semibold shadow-sm">{speech}</p>
        <Mascot mood={mood} />
      </div>
    </section>
  );
}

function Holdings({ state, settings }: { state: AppState; settings: Settings }) {
  const p = state.portfolio;
  const lossShare = p.mandate.dailyLossPct > 0 ? (p.today.lossPct / p.mandate.dailyLossPct) * 100 : 0;
  return (
    <Card>
      <div className="flex items-start justify-between gap-6">
        <div>
          <Eyebrow>Portfolio value</Eyebrow>
          <div className="mt-2">
            <Money usd={p.totalValue} currency={settings.currency} size="xl" />
          </div>
        </div>
        <div className="w-72">
          <div className="mb-2 flex justify-between text-base">
            <span>Down today</span>
            <span className="font-semibold">
              {p.today.lossPct}% of {p.mandate.dailyLossPct}% limit
            </span>
          </div>
          <Bar value={lossShare} tone={lossShare >= 100 ? "coral" : lossShare >= 50 ? "sun" : "leaf"} />
          <p className="mt-2 text-sm text-muted">
            {p.protect.active ? "Buying is paused. Selling still works." : `At ${p.mandate.dailyLossPct}% all buying pauses.`}
          </p>
        </div>
      </div>

      <div className="mt-7 space-y-5">
        <div className="grid grid-cols-[13rem_1fr_9rem] items-center gap-5">
          <div>
            <p className="text-lg font-semibold">Cash</p>
            <p className="text-sm text-muted">tUSD, test money</p>
          </div>
          <Bar value={p.cashSharePct} tone="sun" />
          <div className="text-right">
            <Money usd={p.cash} currency={settings.currency} />
            <p className="text-sm text-muted">{p.cashSharePct}%</p>
          </div>
        </div>
        {p.positions
          .filter((x) => x.rule.allowed || Number(x.amount) > 0)
          .map((x) => (
            <div key={x.symbol} className="grid grid-cols-[13rem_1fr_9rem] items-center gap-5">
              <div>
                <p className="text-lg font-semibold">
                  {x.name} {x.rule.defensive ? <Chip tone="info">Defensive</Chip> : null}
                </p>
                <p className="text-sm text-muted">Simulated, testnet. Price {x.price}</p>
              </div>
              <div>
                <Bar value={x.sharePct} cap={x.rule.maxExposurePct} target={state.plan.targets[x.symbol]} />
                <p className="mt-1.5 text-sm text-muted">
                  Cap {x.rule.maxExposurePct}%{state.plan.targets[x.symbol] !== undefined ? `, plan ${state.plan.targets[x.symbol]}%` : ""}
                  {x.rule.stopPrice ? `, sells itself at ${x.rule.stopPrice}` : ""}
                </p>
              </div>
              <div className="text-right">
                <Money usd={x.value} currency={settings.currency} />
                <p className="text-sm text-muted">{x.sharePct}%</p>
              </div>
            </div>
          ))}
      </div>
      <p className="mt-6 text-sm text-muted">The thick mark on each bar is the cap in your mandate. The thin mark is what the plan aims for.</p>
    </Card>
  );
}

function Keys({ state }: { state: AppState }) {
  const p = state.portfolio;
  const rows: [string, string, string, ReactNode][] = [
    ["O", "You (owner)", "Sign the mandate, approve, withdraw", <Chip key="o" tone="good">Active</Chip>],
    ["G", "Guardian", "Can only say no: pause, cancel, halt", <Chip key="g" tone="good">Active</Chip>],
    [
      "A",
      `${state.brand.agent} (the AI)`,
      p.agent.keyExpires ? `Trades inside the mandate until ${shortTime(p.agent.keyExpires)}` : "No key issued",
      <Chip key="a" tone={p.agent.paused ? "warn" : "info"}>
        {p.agent.paused ? "Paused" : "Bounded"}
      </Chip>,
    ],
  ];
  return (
    <Card>
      <h2 className="font-display text-2xl font-semibold">Who holds the keys</h2>
      <ul className="mt-4 space-y-4">
        {rows.map(([letter, who, what, chip]) => (
          <li key={letter} className="flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-xl bg-mint text-lg font-semibold text-leaf">{letter}</span>
            <div className="flex-1">
              <p className="text-lg font-semibold">{who}</p>
              <p className="text-base text-muted">{what}</p>
            </div>
            {chip}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">Withdrawals go to {short(p.keys.withdrawalAddress)} only. Changing that address takes a waiting period.</p>
    </Card>
  );
}

function Limits({ state, settings }: { state: AppState; settings: Settings }) {
  const p = state.portfolio;
  const cells: [string, ReactNode, string][] = [
    ["Largest single trade", <Money key="t" usd={p.today.maxTrade} currency={settings.currency} />, `${p.mandate.maxTradePct}% of the portfolio`],
    ["Left to trade today", <Money key="v" usd={p.today.volumeLeft} currency={settings.currency} />, `${p.mandate.maxDailyVolumePct}% a day`],
    ["In cash and defensive", <span key="d" className="num text-lg font-semibold">{p.defensiveSharePct}%</span>, `at least ${p.mandate.minDefensivePct}%`],
  ];
  return (
    <Card>
      <h2 className="font-display text-2xl font-semibold">What {state.brand.agent} may do</h2>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {cells.map(([label, value, note]) => (
          <div key={label} className="rounded-2xl bg-cream p-4">
            <p className="text-base text-muted">{label}</p>
            <div className="mt-1">{value}</div>
            <p className="mt-1 text-sm text-muted">{note}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-base text-leaf">The AI cannot change these. Only you can, and anything riskier waits.</p>
    </Card>
  );
}

export function PortfolioView({ state, settings, mood, speech }: ViewProps & { mood: Mood; speech: string }) {
  if (!state.portfolio.mandateSigned) {
    return (
      <Card className="text-center">
        <div className="mx-auto w-fit">
          <Mascot mood="calm" />
        </div>
        <h2 className="mt-3 font-display text-3xl font-semibold">No mandate yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-lg text-muted">
          Tell {state.brand.agent} your goal in your own words. It will draft a mandate for you to read and sign. Until you sign, it cannot trade.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <ExposureCard state={state} settings={settings} mood={mood} speech={speech} />
      <Holdings state={state} settings={settings} />
      <div className="grid grid-cols-2 gap-6">
        <Limits state={state} settings={settings} />
        <Keys state={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mandate

function Waiting({ label, detail, appliesFrom, vetoKey, applyReady, settings, act, skew }: { label: string; detail: string; appliesFrom: string; vetoKey: string; applyReady?: boolean } & Omit<ViewProps, "state">) {
  const left = useCountdown(appliesFrom, skew);
  const { busy, run } = useBusy(act);
  return (
    <div className="slide-in flex items-center gap-4 rounded-2xl border border-sun bg-sun-soft p-4">
      <div className="flex-1">
        <p className="text-lg font-semibold">{label}</p>
        <p className="text-base text-sun-ink">{detail}</p>
      </div>
      <div className="text-right">
        <p className="num text-2xl font-semibold">{left ?? "Ready"}</p>
        <p className="text-sm text-sun-ink">{left ? "until it can take effect" : "the wait is over"}</p>
      </div>
      {settings.role === "guardian" ? (
        <Button kind="danger" busy={busy === "veto"} onClick={() => run("veto", "guardian", "veto", vetoKey)}>
          Cancel it
        </Button>
      ) : !left && applyReady !== false ? (
        <Button busy={busy === "apply"} onClick={() => run("apply", "owner", "apply")}>
          Apply now
        </Button>
      ) : null}
    </div>
  );
}

export function MandateView({ state, settings, act, skew }: ViewProps) {
  const p = state.portfolio;
  const m = p.mandate;
  const { busy, run } = useBusy(act);
  const haltLeft = useCountdown(p.stopLoss.haltedUntil, skew);
  const pm = p.pending.mandate;
  const changed = pm
    ? ([
        ["largest trade", m.maxTradePct, pm.maxTradePct, "%"],
        ["daily trading", m.maxDailyVolumePct, pm.maxDailyVolumePct, "%"],
        ["daily loss limit", m.dailyLossPct, pm.dailyLossPct, "%"],
        ["minimum defensive", m.minDefensivePct, pm.minDefensivePct, "%"],
        ["losing sells before a pause", m.maxLossStreak, pm.maxLossStreak, ""],
        ["cooldown minutes", m.cooldownSeconds / 60, pm.cooldownSeconds / 60, ""],
      ] as const)
        .filter(([, a, b]) => a !== b)
        .map(([label, a, b, unit]) => `${label} ${a}${unit} to ${b}${unit}`)
        .join(", ")
    : "";

  const terms: [string, string][] = [
    ["Largest single trade", `${m.maxTradePct}% of the portfolio`],
    ["Most traded in a day", `${m.maxDailyVolumePct}% of the portfolio`],
    ["Daily loss limit", `A fall of ${m.dailyLossPct}% in a day pauses all buying`],
    ["Minimum defensive share", `At least ${m.minDefensivePct}% in cash and defensive assets`],
    ["Losing streak", m.maxLossStreak ? `${m.maxLossStreak} losing sells in a row pause buying` : "Off"],
    ["Pause length", `${Math.round(m.cooldownSeconds / 60)} minutes after a loss trigger`],
    ["Borrowing", "Prohibited. The vault has no way to borrow"],
    ["Withdrawals", `Any time, by you, to ${short(p.keys.withdrawalAddress)}`],
  ];

  const waiting = pm || p.stopLoss.haltRequestAppliesFrom || p.pending.withdrawalAddress || p.positions.some((x) => x.pendingRule);

  return (
    <div className="space-y-6">
      {waiting ? (
        <Card>
          <Eyebrow>Waiting to take effect</Eyebrow>
          <p className="mt-1 text-base text-muted">These would raise the risk, so they wait. The current mandate stays in force. The guardian can cancel any of them.</p>
          <div className="mt-4 space-y-3">
            {pm ? <Waiting label="Mandate change" detail={changed} appliesFrom={pm.appliesFrom} vetoKey="mandate" settings={settings} act={act} skew={skew} /> : null}
            {p.stopLoss.haltRequestAppliesFrom ? (
              <Waiting label="Switch off the stop-loss" detail="The stop-loss keeps working until then" appliesFrom={p.stopLoss.haltRequestAppliesFrom} vetoKey="stop-loss-halt" settings={settings} act={act} skew={skew} />
            ) : null}
            {p.pending.withdrawalAddress ? (
              <Waiting label="New withdrawal address" detail={`To ${short(p.pending.withdrawalAddress.to)}`} appliesFrom={p.pending.withdrawalAddress.appliesFrom} vetoKey="withdrawal-address" settings={settings} act={act} skew={skew} />
            ) : null}
            {p.positions.map((x) =>
              x.pendingRule ? (
                <Waiting
                  key={x.symbol}
                  label={`${x.name} rule`}
                  detail={`Cap ${x.rule.maxExposurePct}% to ${x.pendingRule.maxExposurePct}%, stop price ${x.rule.stopPrice ?? "none"} to ${x.pendingRule.stopPrice ?? "none"}${x.pendingRule.allowed !== x.rule.allowed ? (x.pendingRule.allowed ? ", added to the mandate" : "") : ""}`}
                  appliesFrom={x.pendingRule.appliesFrom}
                  vetoKey={x.symbol}
                  settings={settings}
                  act={act}
                  skew={skew}
                />
              ) : null,
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>Investment mandate</Eyebrow>
            <h2 className="mt-1 font-display text-3xl font-semibold">{p.mandateSigned ? "Signed and enforced on-chain" : "Not signed yet"}</h2>
          </div>
          <a href={`${state.explorer}/address/${state.vault}`} target="_blank" rel="noreferrer" className="text-base font-semibold text-leaf underline">
            View contract
          </a>
        </div>

        <h3 className="mt-6 text-lg font-semibold">Assets the AI may hold</h3>
        <div className="mt-2 divide-y divide-line rounded-2xl border border-line">
          {p.positions
            .filter((x) => x.rule.allowed)
            .map((x) => (
              <div key={x.symbol} className="grid grid-cols-[1fr_8rem_12rem] items-center gap-4 px-5 py-3.5 text-lg">
                <span>
                  <span className="font-semibold">{x.name}</span> <span className="text-base text-muted">simulated tokenized asset (testnet)</span>
                </span>
                <span>up to {x.rule.maxExposurePct}%</span>
                <span className="text-base text-muted">{x.rule.stopPrice ? `sold automatically at ${x.rule.stopPrice}` : x.rule.defensive ? "counts as defensive" : "no stop price"}</span>
              </div>
            ))}
        </div>

        <h3 className="mt-6 text-lg font-semibold">Limits</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-8">
          {terms.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-3 text-lg">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-mint p-5">
            <p className="text-lg font-semibold text-leaf">Lowering risk: immediate</p>
            <p className="mt-1 text-base text-muted">Lower caps, a higher stop price, pausing the AI. No wait, for you or your guardian.</p>
          </div>
          <div className="rounded-2xl bg-sun-soft p-5">
            <p className="text-lg font-semibold text-sun-ink">Raising risk: waits {Math.round(p.settings.loosenDelaySeconds / 60)} min in this demo</p>
            <p className="mt-1 text-base text-muted">Higher limits, new assets, switching off the stop-loss, a new withdrawal address. A real vault would wait a day.</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h3 className="text-xl font-semibold">Automatic stop-loss</h3>
            <p className="text-base text-muted">
              {haltLeft ? `Halted by the guardian. It switches back on by itself in ${haltLeft}.` : "On. Anyone can trigger it once a price reaches its stop, so it does not depend on the AI."}
            </p>
          </div>
          <Chip tone={haltLeft ? "warn" : "good"}>{haltLeft ? "Halted" : "On"}</Chip>
          {haltLeft ? (
            <Button busy={busy === "resume"} onClick={() => run("resume", settings.role, "resume-stop-loss")}>
              Switch back on
            </Button>
          ) : settings.role === "guardian" ? (
            <Button kind="danger" busy={busy === "halt"} onClick={() => run("halt", "guardian", "halt-stop-loss")}>
              Emergency halt
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- approvals

function DraftCard({ draft, settings, act }: { draft: Draft } & Omit<ViewProps, "state" | "skew">) {
  const { busy, run } = useBusy(act);
  const title = { sign_mandate: "Your first mandate", change_mandate: "Change to your mandate", halt_stop_loss: "Switch off the stop-loss" }[draft.kind];
  return (
    <Card className="slide-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-2xl font-semibold">{title}</h3>
          <p className="mt-1 text-base text-muted">Prepared by the AI. Reason given: {draft.reason}</p>
        </div>
        <Chip tone={draft.risk === "raises" ? "warn" : "good"}>{{ first_mandate: "Starts on signing", lowers: "Lowers risk: immediate", raises: "Raises risk: will wait" }[draft.risk]}</Chip>
      </div>
      <ul className="mt-4 space-y-2">
        {draft.summary.map((line) => (
          <li key={line} className="flex gap-3 text-lg">
            <span className="text-leaf">✓</span>
            {line}
          </li>
        ))}
      </ul>
      {draft.risk === "raises" ? (
        <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">Signing does not put this in force. It starts a waiting period, and your guardian is told and can cancel it.</p>
      ) : null}
      {settings.role === "owner" ? (
        <div className="mt-5 flex gap-3">
          <Button busy={busy === "sign"} onClick={() => run("sign", "owner", "sign", draft.id)}>
            Sign with my key
          </Button>
          <Button kind="ghost" busy={busy === "dismiss"} onClick={() => run("dismiss", "owner", "dismiss", draft.id)}>
            Not now
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-base text-muted">Only the owner can sign this.</p>
      )}
    </Card>
  );
}

export function ApprovalsView({ state, settings, act }: ViewProps) {
  const { busy, run } = useBusy(act);
  if (state.drafts.length === 0 && state.requests.length === 0) {
    return (
      <Card className="text-center">
        <h2 className="font-display text-3xl font-semibold">Nothing needs you</h2>
        <p className="mt-2 text-lg text-muted">Trades above the AI&apos;s limits and changes to your mandate will wait here for your decision.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {state.drafts.map((d) => (
        <DraftCard key={d.id} draft={d} settings={settings} act={act} />
      ))}
      {state.requests.map((r) => (
        <Card key={r.id} className="slide-in">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Eyebrow>Trade request {r.id}</Eyebrow>
              <h3 className="mt-1 font-display text-2xl font-semibold">
                {r.side === "buy" ? "Buy" : "Sell"} {r.name} for {moneyText(r.usd, settings.currency)}
              </h3>
              <p className="mt-1 text-base text-muted">Above what the AI may trade alone. If you approve, every other rule in the mandate still applies. Expires {shortTime(r.expires)}.</p>
            </div>
            {settings.role === "owner" ? (
              <Button busy={busy === `a${r.id}`} onClick={() => run(`a${r.id}`, "owner", "approve", String(r.id))}>
                Approve
              </Button>
            ) : null}
            <Button kind="danger" busy={busy === `r${r.id}`} onClick={() => run(`r${r.id}`, settings.role, "reject", String(r.id))}>
              Reject
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- activity

const OUTCOME_TONE: Record<Receipt["outcome"], "good" | "warn" | "bad" | "info" | "plain"> = {
  done: "good",
  "blocked by the risk engine": "warn",
  "reverted by the contract": "bad",
  "sent to the owner": "info",
  "waiting out the delay": "warn",
  failed: "plain",
};

export function ReceiptRow({ r }: { r: Receipt }) {
  return (
    <li className="slide-in flex gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{r.what}</p>
        <p className="text-base text-muted">
          {r.actor}. {r.refusal ?? r.why}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Chip tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Chip>
        <p className="mt-1.5 text-sm text-muted">
          {shortTime(r.at)}
          {r.url ? (
            <>
              {" · "}
              <a href={r.url} target="_blank" rel="noreferrer" className="font-semibold text-leaf underline">
                transaction
              </a>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

export function ActivityView({ state }: ViewProps) {
  return (
    <Card className="p-0!">
      <div className="px-7 pt-7">
        <Eyebrow>Receipts</Eyebrow>
        <p className="mt-1 text-base text-muted">Everything that was tried, including what was refused. Each line with a transaction can be checked on the block explorer.</p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {state.receipts.length ? state.receipts.map((r) => <ReceiptRow key={r.ref + r.at} r={r} />) : <li className="px-7 py-6 text-lg text-muted">Nothing yet.</li>}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- security demo

type AttackStep = { goal: string; expected: string; result: TxResult };
type AttackEnd = { totalValue: string; cost: string; agentExposure: { tradable: string; maxCost: string } };

export function DemoView({ state, settings, act, onAttack }: ViewProps & { onAttack: (running: boolean) => void }) {
  const [steps, setSteps] = useState<AttackStep[]>([]);
  const [end, setEnd] = useState<AttackEnd | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState("101");
  const { busy, run } = useBusy(act);
  const idx = state.portfolio.positions.find((x) => x.symbol === "IDX");

  async function attack() {
    setSteps([]);
    setEnd(null);
    setError(null);
    setRunning(true);
    onAttack(true);
    try {
      const res = await fetch("/api/attack", { method: "POST" });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line) as { type: string } & Record<string, unknown>;
          if (msg.type === "step") setSteps((s) => [...s, msg as unknown as AttackStep]);
          if (msg.type === "end") setEnd(msg as unknown as AttackEnd);
          if (msg.type === "error") setError(String(msg.message));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRunning(false);
    onAttack(false);
    await act("demo", "noop").catch(() => undefined);
  }

  const reverted = steps.filter((s) => !s.result.ok).length;
  return (
    <div className="space-y-6">
      <section className="rounded-(--radius-card) border-2 border-coral bg-coral-soft p-7">
        <div className="flex items-start gap-6">
          <div className="flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-coral">Compromised-agent mode. Scripted attacker, not the AI model</p>
            <h2 className="mt-2 font-display text-3xl font-semibold">Assume the AI has been taken over</h2>
            <p className="mt-2 max-w-3xl text-lg">
              This replaces the AI&apos;s output with an attacker&apos;s list of actions, skips the risk checks, and signs every call with the real agent key. Each call is sent to the chain even when it is certain to fail, so every line below ends in a real transaction.
            </p>
          </div>
          <Button kind="danger" busy={running} onClick={attack} className="shrink-0 bg-coral! text-white!">
            Run the attack
          </Button>
        </div>
      </section>

      {steps.length || running ? (
        <Card className="p-0!">
          <ol className="divide-y divide-line">
            {steps.map((s, i) => (
              <li key={i} className="slide-in flex items-center gap-4 px-7 py-4">
                <span className="num flex size-10 shrink-0 items-center justify-center rounded-full bg-cream text-lg font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold">{s.goal}</p>
                  <p className="text-base text-muted">{s.result.ok ? "Inside the mandate, so it went through." : (s.result.error?.explanation ?? s.result.message)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Chip tone={s.result.ok ? "info" : "bad"}>{s.result.ok ? "Went through, inside the mandate" : `Reverted: ${s.result.error?.name ?? "refused"}`}</Chip>
                  {"url" in s.result && s.result.url ? (
                    <p className="mt-1.5 text-sm">
                      <a href={s.result.url} target="_blank" rel="noreferrer" className="font-semibold text-leaf underline">
                        transaction
                      </a>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
            {running ? <li className="px-7 py-4 text-lg text-muted">Sending the next call to the chain…</li> : null}
          </ol>
        </Card>
      ) : null}
      {error ? <p className="rounded-2xl bg-coral-soft p-4 text-lg text-coral">{error}</p> : null}

      {end ? (
        <Card className="slide-in">
          <div className="flex items-center gap-6">
            <Mascot mood="shield" size={120} />
            <div>
              <h3 className="font-display text-3xl font-semibold">
                {reverted} of {steps.length} attempts reverted. Sent out of the vault: {moneyText(0, settings.currency)}
              </h3>
              <p className="mt-2 text-lg text-muted">
                {steps.length - reverted > 0
                  ? `${steps.length - reverted} trade went through because it was inside the mandate. It cost ${moneyText(end.cost, settings.currency)} in fees.`
                  : "Nothing went through this time: today's trading allowance was already used, or buying was paused."}{" "}
                The most the stolen key could still trade today is {moneyText(end.agentExposure.tradable, settings.currency)}, at a cost of at most {moneyText(end.agentExposure.maxCost, settings.currency)}. It can still make poor trades inside those limits. It cannot take the money.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>Demo controls: the simulated market</Eyebrow>
        <p className="mt-1 text-base text-muted">Prices here come from this demo&apos;s own feed. The feed refuses any single move larger than its bound, so a big fall is pushed in steps.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-lg">Index fund price is {idx?.price}. Move it to</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} className="num w-24 rounded-xl border border-line bg-cream px-3 py-2.5 text-lg" />
          <Button kind="ghost" busy={busy === "price"} onClick={() => run("price", "demo", "price", `IDX=${price}`)}>
            Move price and run the keeper
          </Button>
          <Button kind="ghost" busy={busy === "keeper"} onClick={() => run("keeper", "demo", "keeper", "refresh")}>
            Refresh prices
          </Button>
          <Button kind="ghost" busy={busy === "auto"} onClick={() => run("auto", "demo", "autopilot")}>
            Run the AI&apos;s scheduled check
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">The keeper is a plain script with no AI in it. It fires the stop-loss when a price reaches its stop{idx?.rule.stopPrice ? ` (index fund: ${idx.rule.stopPrice})` : ""}.</p>
      </Card>
    </div>
  );
}
