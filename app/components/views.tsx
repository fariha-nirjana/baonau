"use client";

import { useState, type ReactNode } from "react";
import type { AssetSymbol } from "@/lib/assets";
import type { Draft } from "@/lib/drafts";
import type { Receipt } from "@/lib/receipts";
import type { TxResult } from "@/lib/vault";
import { Icon, type IconName } from "./icons";
import { Mascot } from "./Mascot";
import { waitingCount, type MimoSay } from "./mimo";
import type { Act, AppState, Settings } from "./types";
import { Bar, Button, Card, Chip, Eyebrow, Money, moneyText, short, shortTime, Sparkline, useCountdown, type Tone } from "./ui";

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

const ASSET_ICON: Record<AssetSymbol | "USD", [IconName, string]> = {
  USD: ["coins", "bg-mint text-leaf"],
  IDX: ["chart", "bg-sky-soft text-sky"],
  BOND: ["bond", "bg-mint text-leaf"],
  GOLD: ["gold", "bg-sun-soft text-sun-ink"],
  MEME: ["bolt", "bg-coral-soft text-coral"],
};

function IconTile({ name, tone, size = 44 }: { name: IconName; tone: string; size?: number }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl ${tone}`} style={{ width: size, height: size }}>
      <Icon name={name} size={Math.round(size * 0.48)} />
    </span>
  );
}

// ---------------------------------------------------------------- portfolio

/** A change shown without red or green: neutral ink with an arrow and a sign (in China red means up). */
export function Change({ pct, suffix = "today" }: { pct: number; suffix?: string }) {
  const flat = Math.abs(pct) < 0.005;
  const mark = flat ? "" : pct > 0 ? "▲ +" : "▼ −";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1 text-sm font-semibold text-ink">
      {mark}
      {Math.abs(pct).toFixed(2)}% {suffix}
    </span>
  );
}

/** A speech bubble with its tail pointing right, at the mascot. */
function SpeechBubble({ children, onAck }: { children: ReactNode; onAck?: () => void }) {
  return (
    <div className="card-shadow relative rounded-2xl border border-line bg-card px-4 py-3">
      <p className="text-[0.95rem] leading-snug font-semibold">{children}</p>
      {onAck ? (
        <button onClick={onAck} className="mt-1 text-sm font-semibold text-leaf underline">
          Got it
        </button>
      ) : null}
      <span aria-hidden className="absolute top-1/2 -right-[7px] size-3.5 -translate-y-1/2 rotate-45 border-t border-r border-line bg-card" />
    </div>
  );
}

function ValueCard({ state, settings, mimo, onAck }: { state: AppState; settings: Settings; mimo: MimoSay; onAck: () => void }) {
  const p = state.portfolio;
  const start = Number(p.today.startValue);
  const change = start > 0 ? ((Number(p.totalValue) - start) / start) * 100 : 0;
  return (
    <Card className={`mood-${mimo.mood} relative h-[19rem] overflow-hidden p-0!`}>
      {/* the mascot stands in the corner on a soft blob, as in the team's mockup */}
      <div aria-hidden className="absolute -right-16 -bottom-24 size-[22rem] rounded-full transition-colors duration-500" style={{ background: "var(--mood-soft)" }} />
      <Icon name="sparkle" size={22} strokeWidth={1.6} className="absolute right-[15.5rem] bottom-16 text-sun" />
      <Icon name="sparkle" size={16} strokeWidth={1.8} className="absolute top-24 right-7 text-sun" />
      <div className="absolute right-4 -bottom-6">
        <Mascot mood={mimo.mood} variant={mimo.variant} size={240} />
      </div>
      <div className="absolute top-6 right-[14.5rem] z-10 w-56">
        <SpeechBubble onAck={mimo.dismissKey ? onAck : undefined}>{mimo.line}</SpeechBubble>
      </div>

      <div className="relative flex h-full flex-col p-6 pr-[30rem]">
        <Eyebrow>Portfolio value</Eyebrow>
        <div className="mt-2">
          <Money usd={p.totalValue} currency={settings.currency} size="xl" />
        </div>
        <div className="mt-2">
          <Change pct={change} />
        </div>
      </div>
      <div className="absolute right-[16rem] bottom-10 left-0 h-24">
        {state.history.length >= 2 ? <Sparkline points={state.history.slice(-120)} height={96} /> : <p className="px-6 pt-10 text-sm text-muted">The chart fills in as the app reads the vault.</p>}
      </div>
      <p className="absolute bottom-4 left-6 text-xs text-muted">Values as read from the vault by this app. Simulated test assets on a testnet.</p>
    </Card>
  );
}

function HoldingCard({ icon, name, badge, usd, share, cap, target, note, settings }: { icon: [IconName, string]; name: string; badge?: ReactNode; usd: string; share: number; cap?: number; target?: number; note: string; settings: Settings }) {
  return (
    <Card className="p-5!">
      <div className="flex items-start gap-4">
        <IconTile name={icon[0]} tone={icon[1]} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-muted">
            {name} {badge}
          </p>
          <div className="mt-0.5">
            <Money usd={usd} currency={settings.currency} size="lg" />
          </div>
          <p className="mt-1 text-sm text-muted">
            {share}% of portfolio{cap !== undefined ? ` · cap ${cap}%` : ""}
            {target !== undefined ? ` · plan ${target}%` : ""}
          </p>
        </div>
      </div>
      {cap !== undefined ? (
        <div className="mt-4">
          <Bar value={share} cap={cap} target={target} />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted">{note}</p>
    </Card>
  );
}

function Holdings({ state, settings }: { state: AppState; settings: Settings }) {
  const p = state.portfolio;
  return (
    <div className="grid grid-cols-2 gap-4">
      <HoldingCard icon={ASSET_ICON.USD} name="Cash" usd={p.cash} share={p.cashSharePct} note="tUSD, test money. Counts as defensive." settings={settings} />
      {p.positions
        .filter((x) => x.rule.allowed || Number(x.amount) > 0)
        .map((x) => (
          <HoldingCard
            key={x.symbol}
            icon={ASSET_ICON[x.symbol]}
            name={x.name}
            badge={x.rule.defensive ? <Chip tone="info">Defensive</Chip> : !x.rule.allowed ? <Chip tone="bad">Not allowed</Chip> : null}
            usd={x.value}
            share={x.sharePct}
            cap={x.rule.allowed ? x.rule.maxExposurePct : undefined}
            target={state.plan.targets[x.symbol]}
            note={`Simulated test asset (testnet). Price ${x.price}${x.rule.stopPrice ? `, sells itself at ${x.rule.stopPrice}` : ""}.`}
            settings={settings}
          />
        ))}
    </div>
  );
}

function ExposureCard({ state, settings }: { state: AppState; settings: Settings }) {
  const p = state.portfolio;
  const cap = Number(p.today.volumeUsed) + Number(p.today.volumeLeft);
  const used = cap > 0 ? (Number(p.today.volumeUsed) / cap) * 100 : 0;
  const tiles: [string, ReactNode][] = [
    ["Could send out of the vault", <span key="s" className="num text-2xl font-bold">{moneyText(0, settings.currency)}</span>],
    ["Could still trade today", <span key="t" className="num text-2xl font-bold">{moneyText(p.agentExposure.tradable, settings.currency)}</span>],
    ["Down today", <span key="d" className="num text-2xl font-bold">{p.today.lossPct}%<span className="text-base font-semibold text-muted"> of {p.mandate.dailyLossPct}%</span></span>],
  ];
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>If the AI were hacked today</Eyebrow>
        <Chip tone="good" icon="shieldCheck">
          Enforced by contract
        </Chip>
      </div>
      <p className="mt-3 text-lg">The most its trades could cost you today is</p>
      <div className="mt-1">
        <Money usd={p.agentExposure.maxCost} currency={settings.currency} size="xl" />
      </div>
      <div className="mt-5">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-cream">
          <div className="bg-sun transition-[width] duration-700" style={{ width: `${used}%` }} />
          <div className="flex-1 bg-leaf" />
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-muted">{moneyText(p.today.volumeUsed, settings.currency)} of today&apos;s trading allowance used</span>
          <span className="font-semibold text-leaf">{moneyText(p.today.volumeLeft, settings.currency)} left</span>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-cream p-3.5">
            <p className="text-sm text-muted">{label}</p>
            <div className="mt-1">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">This is a limit on the AI, not on the market: prices of the assets you hold can still fall.</p>
    </Card>
  );
}

function Keys({ state }: { state: AppState }) {
  const p = state.portfolio;
  const hasGuardian = !/^0x0+$/.test(p.keys.guardian);
  const rows: [string, string, string, ReactNode, string][] = [
    ["O", "You (owner)", "Sign the mandate, sign for single trades, withdraw", <Chip key="o" tone="good">Active</Chip>, "bg-mint text-leaf"],
    [
      "G",
      "Guardian",
      hasGuardian ? "Can only say no: pause, cancel a waiting change, halt the stop-loss" : "Nobody appointed. You can add one at any time",
      <Chip key="g" tone={hasGuardian ? "good" : "plain"}>
        {hasGuardian ? "Active" : "None"}
      </Chip>,
      "bg-sky-soft text-sky",
    ],
    [
      "A",
      `${state.brand.agent} (the AI)`,
      p.agent.keyExpires ? `Trades inside the mandate until ${shortTime(p.agent.keyExpires)}` : "No key. A new one waits out the delay",
      <Chip key="a" tone={p.agent.paused || !p.agent.keyExpires ? "warn" : "info"}>
        {!p.agent.keyExpires ? "No key" : p.agent.paused ? "Paused" : "Bounded"}
      </Chip>,
      "bg-sun-soft text-sun-ink",
    ],
  ];
  return (
    <Card>
      <h2 className="font-display text-2xl font-semibold">Who holds the keys</h2>
      <ul className="mt-4 space-y-4">
        {rows.map(([letter, who, what, chip, tone]) => (
          <li key={letter} className="flex items-center gap-3.5">
            <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${tone}`}>{letter}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[1.05rem] font-semibold">{who}</p>
              <p className="text-sm text-muted">{what}</p>
            </div>
            {chip}
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-1.5 border-t border-dashed border-line pt-4 text-[0.95rem]">
        <p className="flex items-center gap-2 font-semibold text-leaf">
          <Icon name="lock" size={16} />
          The AI cannot change its own limits.
        </p>
        <p className="text-sm text-muted">Withdrawals go to {short(p.keys.withdrawalAddress)} only. Changing that address takes a waiting period.</p>
      </div>
    </Card>
  );
}

export function PortfolioView({ state, settings, mimo, onAck }: ViewProps & { mimo: MimoSay; onAck: () => void }) {
  if (!state.portfolio.mandateSigned) {
    return (
      <Card className="flex items-center gap-8">
        <Mascot mood={mimo.mood} variant={mimo.variant} size={200} />
        <div>
          <h2 className="font-display text-3xl font-semibold">No mandate yet</h2>
          <p className="mt-2 max-w-xl text-lg text-muted">
            Tell {state.brand.agent} your goal in your own words. It will draft a mandate for you to read and sign. Until you sign, it cannot trade.
          </p>
          {state.portfolio.signableFrom ? (
            <p className="mt-4 max-w-xl rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">
              This is not your first vault, so its mandate can be signed from {shortTime(state.portfolio.signableFrom)}. Opening a new vault is not a way around the waiting period.
            </p>
          ) : null}
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <ValueCard state={state} settings={settings} mimo={mimo} onAck={onAck} />
      <Holdings state={state} settings={settings} />
      <div className="grid grid-cols-[1.15fr_1fr] gap-5">
        <ExposureCard state={state} settings={settings} />
        <Keys state={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mandate

function RuleTile({ label, value, fill, note }: { label: string; value: string; fill: number | null; note: string }) {
  return (
    <Card className="p-5!">
      <p className="text-[0.95rem] font-semibold text-muted">{label}</p>
      <p className="num mt-1 text-4xl font-bold">{value}</p>
      {fill !== null ? (
        <div className="mt-3">
          <Bar value={fill} tone={fill >= 100 ? "coral" : fill >= 60 ? "sun" : "leaf"} />
        </div>
      ) : (
        <div className="mt-3 h-2.5" />
      )}
      <p className="mt-2 text-sm text-muted">{note}</p>
    </Card>
  );
}

export function MandateView({ state, settings, act, skew }: ViewProps) {
  const p = state.portfolio;
  const m = p.mandate;
  const { busy, run } = useBusy(act);
  const haltLeft = useCountdown(p.stopLoss.haltedUntil, skew);
  const volumeCap = Number(p.today.volumeUsed) + Number(p.today.volumeLeft);
  const waiting = waitingCount(state);

  const terms: [string, string][] = [
    ["Losing streak", m.maxLossStreak ? `${m.maxLossStreak} losing sells in a row pause buying` : "Off"],
    ["Pause length", `${Math.round(m.cooldownSeconds / 60)} minutes after a loss trigger`],
    ["Borrowing", "Prohibited. The vault has no way to borrow"],
    ["Withdrawals", `Any time, by you, to ${short(p.keys.withdrawalAddress)}`],
    ["Waiting period", `${Math.round(p.settings.loosenDelaySeconds / 60)} minutes in this demo`],
    ["Trades above the limits", "Only with your signature for that one trade, valid 30 minutes"],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <RuleTile label="Max per trade" value={`${m.maxTradePct}%`} fill={null} note={`${moneyText(p.today.maxTrade, settings.currency)} at today's value`} />
        <RuleTile label="Trading per day" value={`${m.maxDailyVolumePct}%`} fill={volumeCap > 0 ? (Number(p.today.volumeUsed) / volumeCap) * 100 : 0} note={`${moneyText(p.today.volumeLeft, settings.currency)} left today`} />
        <RuleTile label="Daily loss limit" value={`${m.dailyLossPct}%`} fill={m.dailyLossPct > 0 ? (p.today.lossPct / m.dailyLossPct) * 100 : 0} note={`Down ${p.today.lossPct}% from the day-start value`} />
        <RuleTile label="Defensive minimum" value={`${m.minDefensivePct}%`} fill={null} note={`${p.defensiveSharePct}% in cash and bonds now`} />
      </div>

      {waiting ? (
        <p className="rounded-2xl border border-sun bg-sun-soft p-4 text-base text-sun-ink">
          <span className="font-semibold">
            {waiting} {waiting === 1 ? "change that raises the risk is" : "changes that raise the risk are"} waiting.
          </span>{" "}
          The rules below stay in force until the wait is over. The countdown is under Approvals.
        </p>
      ) : null}

      <div className="grid grid-cols-[1.4fr_1fr] gap-5">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold">Assets the AI may hold</h2>
            <a href={`${state.explorer}/address/${state.mandate}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-leaf underline">
              Mandate contract
            </a>
          </div>
          <ul className="mt-3 divide-y divide-dashed divide-line">
            <li className="flex items-center gap-3.5 py-3">
              <IconTile name={ASSET_ICON.USD[0]} tone={ASSET_ICON.USD[1]} size={40} />
              <div className="flex-1">
                <p className="font-semibold">Cash (tUSD)</p>
                <p className="text-sm text-muted">Test money. Always allowed</p>
              </div>
              <Chip tone="good" icon="check">
                Allowed
              </Chip>
            </li>
            {p.positions.map((x) => (
              <li key={x.symbol} className="flex items-center gap-3.5 py-3">
                <IconTile name={ASSET_ICON[x.symbol][0]} tone={ASSET_ICON[x.symbol][1]} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {x.name} <span className="text-sm font-normal text-muted">simulated test asset</span>
                  </p>
                  <p className="text-sm text-muted">
                    {x.rule.allowed
                      ? `Up to ${x.rule.maxExposurePct}%${x.rule.stopPrice ? `, sold automatically at ${x.rule.stopPrice}` : ""}${x.rule.defensive ? ", counts as defensive" : ""}`
                      : "Not in the mandate. The vault refuses any buy"}
                  </p>
                </div>
                <Chip tone={x.rule.allowed ? "good" : "bad"} icon={x.rule.allowed ? "check" : "x"}>
                  {x.rule.allowed ? "Allowed" : "Not allowed"}
                </Chip>
              </li>
            ))}
          </ul>
        </Card>

        <Card className={`mood-${p.protect.active ? "warning" : "calm"} flex flex-col items-center text-center`}>
          <div className="rounded-full p-2" style={{ background: "var(--mood-soft)" }}>
            <Mascot mood={p.protect.active ? "warning" : "calm"} size={130} still />
          </div>
          <h3 className="mt-2 font-display text-2xl font-semibold">Protect mode</h3>
          <p className="mt-1 text-[0.95rem] text-muted">
            If today&apos;s loss reaches {m.dailyLossPct}%, or {m.maxLossStreak} sells in a row lose money, buying stops. Selling into tUSD still works, so stop-losses keep running.
          </p>
          <div className="mt-3">
            <Chip tone={p.protect.active ? "warn" : "good"} icon={p.protect.active ? "alert" : "check"}>
              {p.protect.active ? (p.protect.cooldownUntil ? `On until ${shortTime(p.protect.cooldownUntil)}` : "On for the rest of the day") : "Off, you're within limits"}
            </Chip>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-2xl font-semibold">More terms</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-8">
          {terms.map(([k, v]) => (
            <div key={k} className="border-b border-dashed border-line py-3 text-[1.05rem]">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-mint p-5">
            <p className="flex items-center gap-2 text-lg font-semibold text-leaf">
              <Icon name="chartDown" size={20} />
              Lowering risk: immediate
            </p>
            <p className="mt-1 text-[0.95rem] text-muted">Lower caps, a higher stop price, pausing the AI. No wait, for you or your guardian.</p>
          </div>
          <div className="rounded-2xl bg-sun-soft p-5">
            <p className="flex items-center gap-2 text-lg font-semibold text-sun-ink">
              <Icon name="clock" size={20} />
              Raising risk: waits {Math.round(p.settings.loosenDelaySeconds / 60)} min in this demo
            </p>
            <p className="mt-1 text-[0.95rem] text-muted">Higher limits, new assets, switching off the stop-loss, a new withdrawal address, a new key for the AI. A real vault would wait a day.</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        <Keys state={state} />
        <Card>
          <div className="flex items-center gap-3">
            <IconTile name="shield" tone={haltLeft ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"} />
            <h3 className="flex-1 font-display text-2xl font-semibold">Automatic stop-loss</h3>
            <Chip tone={haltLeft ? "warn" : "good"}>{haltLeft ? "Halted" : "On"}</Chip>
          </div>
          <p className="mt-3 text-[0.95rem] text-muted">
            {haltLeft ? `Halted by the guardian. It switches back on by itself in ${haltLeft}.` : "Anyone can trigger it once a price reaches its stop, so it does not depend on the AI. Proceeds stay in the vault as tUSD."}
          </p>
          <div className="mt-4">
            {haltLeft ? (
              <Button busy={busy === "resume"} onClick={() => run("resume", settings.role, "resume-stop-loss")}>
                Switch back on
              </Button>
            ) : settings.role === "guardian" ? (
              <Button kind="ghost" busy={busy === "halt"} onClick={() => run("halt", "guardian", "halt-stop-loss")}>
                Emergency halt
              </Button>
            ) : (
              <p className="text-sm text-muted">Only your guardian can halt it at once. If you ask, it waits like any other rise in risk.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- approvals

function DraftCard({ draft, settings, act }: { draft: Draft } & Omit<ViewProps, "state" | "skew">) {
  const { busy, run } = useBusy(act);
  const title = { sign_mandate: "Your first mandate", change_mandate: "Change to your mandate", halt_stop_loss: "Switch off the stop-loss" }[draft.kind];
  return (
    <Card className="slide-in">
      <div className="flex items-start gap-4">
        <IconTile name="mandate" tone={draft.risk === "raises" ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl font-semibold">{title}</h3>
          <p className="text-[0.95rem] text-muted">Prepared by the AI, {shortTime(draft.createdAt)}</p>
        </div>
        <Chip tone={draft.risk === "raises" ? "warn" : "good"} icon={draft.risk === "raises" ? "clock" : "check"}>
          {{ first_mandate: "Starts on signing", lowers: "Lowers risk: immediate", raises: "Raises risk: will wait" }[draft.risk]}
        </Chip>
      </div>
      <div className="mt-4 rounded-2xl bg-cream p-4">
        <p className="text-sm font-semibold text-muted">Reason given</p>
        <p className="mt-0.5 font-semibold">{draft.reason}</p>
      </div>
      <ul className="mt-4 space-y-2">
        {draft.summary.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-[1.05rem]">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mint text-leaf">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
            {line}
          </li>
        ))}
      </ul>
      {draft.risk === "raises" ? <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-[0.95rem] text-sun-ink">Signing does not put this in force. It starts a waiting period, and your guardian is told and can cancel it.</p> : null}
      {settings.role === "owner" ? (
        <div className="mt-5 flex justify-end gap-3">
          <Button kind="ghost" busy={busy === "dismiss"} onClick={() => run("dismiss", "owner", "dismiss", draft.id)}>
            Not now
          </Button>
          <Button busy={busy === "sign"} onClick={() => run("sign", "owner", "sign", draft.id)}>
            <Icon name="check" size={18} />
            Sign with my key
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[0.95rem] text-muted">Only the owner can sign this.</p>
      )}
    </Card>
  );
}

type QueueItem = { key: string; label: string; detail: ReactNode; appliesFrom: string; vetoKey: string | null };

function queueOf(state: AppState): QueueItem[] {
  const p = state.portfolio;
  const m = p.mandate;
  const pm = p.pending.mandate;
  const items: QueueItem[] = [];
  if (pm) {
    const changed = (
      [
        ["Max per trade", m.maxTradePct, pm.maxTradePct, "%"],
        ["Trading per day", m.maxDailyVolumePct, pm.maxDailyVolumePct, "%"],
        ["Daily loss limit", m.dailyLossPct, pm.dailyLossPct, "%"],
        ["Defensive minimum", m.minDefensivePct, pm.minDefensivePct, "%"],
        ["Losing sells before a pause", m.maxLossStreak, pm.maxLossStreak, ""],
        ["Pause minutes", m.cooldownSeconds / 60, pm.cooldownSeconds / 60, ""],
      ] as const
    ).filter(([, a, b]) => a !== b);
    items.push({
      key: "mandate",
      label: "Mandate change",
      detail: (
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          {changed.map(([label, a, b, unit]) => (
            <div key={label}>
              <p className="text-sm font-semibold text-muted">{label}</p>
              <p className="num flex items-center gap-3 text-3xl font-bold">
                {a}
                {unit}
                <Icon name="arrow" size={22} className="text-sun-ink" />
                {b}
                {unit}
              </p>
            </div>
          ))}
        </div>
      ),
      appliesFrom: pm.appliesFrom,
      vetoKey: "mandate",
    });
  }
  if (p.stopLoss.haltRequestAppliesFrom) items.push({ key: "halt", label: "Switch off the stop-loss", detail: "The stop-loss keeps working until then.", appliesFrom: p.stopLoss.haltRequestAppliesFrom, vetoKey: "stop-loss-halt" });
  if (p.pending.withdrawalAddress) items.push({ key: "wd", label: "New withdrawal address", detail: `To ${short(p.pending.withdrawalAddress.to)}. Withdrawals keep going to ${short(p.keys.withdrawalAddress)} until then.`, appliesFrom: p.pending.withdrawalAddress.appliesFrom, vetoKey: "withdrawal-address" });
  if (p.pending.agentKey) items.push({ key: "agent", label: "New or longer-lived key for the AI", detail: `Key ${short(p.pending.agentKey.address)}, valid until ${shortTime(p.pending.agentKey.expires)}.`, appliesFrom: p.pending.agentKey.appliesFrom, vetoKey: "agent-key" });
  if (p.pending.unpause) items.push({ key: "unpause", label: "Lift the guardian's pause", detail: "The AI stays paused until then.", appliesFrom: p.pending.unpause.appliesFrom, vetoKey: "unpause" });
  if (p.pending.waitingPeriod) items.push({ key: "delay", label: "Shorter waiting period", detail: `From ${Math.round(p.settings.loosenDelaySeconds / 60)} to ${Math.round(p.pending.waitingPeriod.seconds / 60)} minutes.`, appliesFrom: p.pending.waitingPeriod.appliesFrom, vetoKey: "waiting-period" });
  if (p.pending.guardian) {
    items.push({
      key: "guardian",
      label: /^0x0+$/.test(p.pending.guardian.to) ? "Remove the guardian" : "Replace the guardian",
      detail: "The one change the guardian cannot cancel. Any loosening after it takes another full wait.",
      appliesFrom: p.pending.guardian.appliesFrom,
      vetoKey: null,
    });
  }
  for (const x of p.positions) {
    if (!x.pendingRule) continue;
    items.push({
      key: x.symbol,
      label: `${x.name} rule`,
      detail: `Cap ${x.rule.maxExposurePct}% to ${x.pendingRule.maxExposurePct}%, stop price ${x.rule.stopPrice ?? "none"} to ${x.pendingRule.stopPrice ?? "none"}${x.pendingRule.allowed && !x.rule.allowed ? ", added to the mandate" : ""}.`,
      appliesFrom: x.pendingRule.appliesFrom,
      vetoKey: x.symbol,
    });
  }
  return items;
}

function QueueCard({ item, settings, act, skew }: { item: QueueItem } & Omit<ViewProps, "state">) {
  const left = useCountdown(item.appliesFrom, skew);
  const { busy, run } = useBusy(act);
  return (
    <section className="slide-in rounded-(--radius-card) border-2 border-dashed border-sun bg-[#fffbef] p-6">
      <div className="flex items-start gap-4">
        <IconTile name="clock" tone="bg-sun-soft text-sun-ink" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl font-semibold">{item.label}</h3>
          <p className="text-[0.95rem] text-muted">Raises the risk, so it waits</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-muted">{left ? "Can take effect in" : "The wait is over"}</p>
          <p className="num text-4xl font-bold text-sun-ink">{left ?? "Ready"}</p>
        </div>
      </div>
      <div className="mt-4 text-[1.05rem]">{item.detail}</div>
      <p className="mt-4 text-[0.95rem] text-muted">Tightening rules is instant. Loosening waits, and your guardian can still cancel it.</p>
      <div className="mt-4 flex justify-end gap-3">
        {settings.role === "guardian" ? (
          item.vetoKey ? (
            <Button kind="dark" busy={busy === "veto"} onClick={() => run("veto", "guardian", "veto", item.vetoKey as string)}>
              Cancel it
            </Button>
          ) : (
            <Button kind="ghost" busy={busy === "own"} onClick={() => run("own", "guardian", "veto-own-removal")}>
              Try to cancel
            </Button>
          )
        ) : (
          <>
            <Button kind="ghost" busy={busy === "cancel"} onClick={() => run("cancel", "owner", "cancel", item.vetoKey ?? "guardian")}>
              Cancel change
            </Button>
            {!left ? (
              <Button busy={busy === "apply"} onClick={() => run("apply", "owner", "apply")}>
                Apply now
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export function ApprovalsView({ state, settings, act, skew }: ViewProps) {
  const { busy, run } = useBusy(act);
  const queue = queueOf(state);
  if (state.drafts.length === 0 && state.requests.length === 0 && queue.length === 0) {
    return (
      <Card className="flex items-center gap-6">
        <Mascot mood="calm" size={120} still />
        <div>
          <h2 className="font-display text-3xl font-semibold">Nothing needs you</h2>
          <p className="mt-2 text-lg text-muted">Trades above the AI&apos;s limits, drafts to sign and riskier changes waiting their turn show up here.</p>
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      {state.drafts.map((d) => (
        <DraftCard key={d.id} draft={d} settings={settings} act={act} />
      ))}
      {state.requests.map((r) => (
        <Card key={r.id} className="slide-in">
          <div className="flex items-start gap-4">
            <IconTile name="coins" tone="bg-sun-soft text-sun-ink" />
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-2xl font-semibold">Trade request</h3>
              <p className="text-[0.95rem] text-muted">
                From {state.brand.agent}, {shortTime(r.createdAt)}
              </p>
            </div>
            <Chip tone="warn" icon="clock">
              {r.status === "signed" ? "Signed, trading" : "Needs your signature"}
            </Chip>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="num text-4xl font-bold">{moneyText(r.usd, settings.currency)}</span>
            <span className="text-lg text-muted">{r.side}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${ASSET_ICON[r.symbol][1]}`}>
              <Icon name={ASSET_ICON[r.symbol][0]} size={16} />
              {r.symbol}
            </span>
          </div>
          <div className="mt-4 rounded-2xl bg-cream p-4">
            <p className="text-sm font-semibold text-muted">{state.brand.agent}&apos;s reason</p>
            <p className="mt-0.5 font-semibold">{r.reason}</p>
          </div>
          <p className="mt-4 text-[0.95rem] text-muted">
            This is above what the AI may trade alone. Your signature covers exactly this trade, once, for 30 minutes. It lifts the size limits only: the asset caps, the defensive minimum, protect mode and the stop price still apply.
          </p>
          {settings.role === "owner" ? (
            <div className="mt-5 flex justify-end gap-3">
              <Button kind="ghost" busy={busy === `r${r.id}`} onClick={() => run(`r${r.id}`, "owner", "reject", r.id)}>
                Decline
              </Button>
              <Button busy={busy === `a${r.id}`} onClick={() => run(`a${r.id}`, "owner", "approve", r.id)}>
                <Icon name="check" size={18} />
                Sign for this trade
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-[0.95rem] text-muted">Only the owner can sign.</p>
          )}
        </Card>
      ))}
      {queue.map((item) => (
        <QueueCard key={item.key} item={item} settings={settings} act={act} skew={skew} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- activity

const OUTCOME: Record<Receipt["outcome"], [Tone, string, IconName]> = {
  done: ["good", "Done", "check"],
  "blocked by the risk engine": ["bad", "Blocked by the checks", "x"],
  "reverted by the contract": ["bad", "Reverted by the contract", "x"],
  "sent to the owner": ["warn", "Sent to you", "clock"],
  "waiting out the delay": ["warn", "Waiting out the delay", "clock"],
  "decided not to act": ["plain", "Decided not to act", "info"],
  failed: ["plain", "Failed", "alert"],
};

const GATE_MARK = { pass: ["check", "bg-mint text-leaf"], escalate: ["clock", "bg-sun-soft text-sun-ink"], block: ["x", "bg-coral-soft text-coral"] } as const;

const STOPPED: Receipt["outcome"][] = ["blocked by the risk engine", "reverted by the contract"];

export function ReceiptRow({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  const [tone, label, icon] = OUTCOME[r.outcome];
  const stopped = STOPPED.includes(r.outcome);
  return (
    <li className={`slide-in rounded-2xl ${stopped ? "bg-linear-to-r from-coral-soft to-transparent" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 px-4 py-3.5 text-left">
        <span className="num w-24 shrink-0 text-sm font-semibold text-muted">{shortTime(r.at)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{r.what}</span>
          <span className="block truncate text-sm text-muted">{r.actor}</span>
        </span>
        <Chip tone={tone} icon={icon}>
          {label}
        </Chip>
        <Icon name="chevron" size={18} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mx-4 mb-4 rounded-2xl bg-card p-4 ring-1 ring-line">
          <p className="text-[0.95rem]">{r.refusal ?? r.why}</p>
          {r.gates.length || r.contract ? (
            <ul className="mt-3 space-y-2">
              {r.gates.map((g, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[0.95rem]">
                  <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${GATE_MARK[g.outcome][1]}`}>
                    <Icon name={GATE_MARK[g.outcome][0]} size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <span className="font-semibold">{g.label}.</span> <span className="text-muted">{g.detail}</span>
                  </span>
                </li>
              ))}
              {r.contract ? (
                <li className="flex items-start gap-2.5 border-t border-dashed border-line pt-2 text-[0.95rem]">
                  <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${r.contract.verdict === "accepted" ? GATE_MARK.pass[1] : GATE_MARK.block[1]}`}>
                    <Icon name={r.contract.verdict === "accepted" ? "check" : "x"} size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <span className="font-semibold">The contract {r.contract.verdict} it.</span> <span className="text-muted">{r.contract.reason ?? "Every on-chain rule passed."}</span>
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
          {r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[0.95rem] font-semibold text-leaf underline">
              View the transaction
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const FILTERS: [string, string, (r: Receipt) => boolean][] = [
  ["all", "All", () => true],
  ["done", "Done", (r) => r.outcome === "done"],
  ["you", "Needs you or waiting", (r) => r.outcome === "sent to the owner" || r.outcome === "waiting out the delay"],
  ["stopped", "Stopped", (r) => STOPPED.includes(r.outcome)],
  ["abstained", "Did not act", (r) => r.outcome === "decided not to act"],
];

export function ActivityView({ state }: ViewProps) {
  const [filter, setFilter] = useState("all");
  const receipts = state.receipts;
  const shown = receipts.filter(FILTERS.find(([id]) => id === filter)?.[2] ?? (() => true));
  const onChain = receipts.filter((r) => r.url).length;
  const tiles: [IconName, string, string, string][] = [
    ["shieldCheck", String(receipts.filter((r) => STOPPED.includes(r.outcome)).length), "Moves stopped", "bg-mint text-leaf"],
    ["check", String(receipts.filter((r) => r.outcome === "done").length), "Moves made inside the mandate", "bg-sun-soft text-sun-ink"],
    ["activity", String(onChain), "With a transaction you can check", "bg-sky-soft text-sky"],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {tiles.map(([icon, n, label, tone]) => (
          <Card key={label} className="flex items-center gap-4 p-5!">
            <IconTile name={icon} tone={tone} />
            <div>
              <p className="num text-3xl font-bold">{n}</p>
              <p className="text-[0.95rem] font-semibold text-muted">{label}</p>
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-3!">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-cream p-1 sm:w-fit">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === id ? "bg-forest text-white" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <ul className="mt-2 divide-y divide-dashed divide-line">{shown.length ? shown.map((r) => <ReceiptRow key={r.ref + r.at} r={r} />) : <li className="px-4 py-6 text-lg text-muted">Nothing here yet.</li>}</ul>
      </Card>
    </div>
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
    <div className="space-y-5">
      <section className="card-shadow flex items-center gap-6 rounded-(--radius-card) bg-forest-deep p-6 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sun">Compromised-agent mode. Scripted attacker, not the AI model</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">Assume the AI has been taken over</h2>
          <p className="mt-2 max-w-3xl text-[1.05rem]">
            This replaces the AI&apos;s output with an attacker&apos;s list of actions, skips the risk checks, and signs every call with the real agent key. Each call is sent to the chain even when it is certain to fail, so every line below ends in a real transaction.
          </p>
          <Button kind="ghost" busy={running} onClick={attack} className="mt-4">
            <Icon name="bolt" size={18} />
            Run the attack
          </Button>
        </div>
        <Mascot mood={running || end ? "shield" : "watching"} variant="code" size={170} />
      </section>

      {steps.length || running ? (
        <Card className="p-0!">
          <ol className="divide-y divide-dashed divide-line">
            {steps.map((s, i) => (
              <li key={i} className={`slide-in flex items-center gap-4 px-6 py-4 ${s.result.ok ? "" : "bg-linear-to-r from-coral-soft/70 to-transparent"}`}>
                <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-cream font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.goal}</p>
                  <p className="text-[0.95rem] text-muted">{s.result.ok ? "Inside the mandate, so it went through." : (s.result.error?.explanation ?? s.result.message)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Chip tone={s.result.ok ? "info" : "bad"} icon={s.result.ok ? "check" : "x"}>
                    {s.result.ok ? "Went through, inside the mandate" : `Reverted: ${s.result.error?.name ?? "refused"}`}
                  </Chip>
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
            {running ? <li className="px-6 py-4 text-[1.05rem] text-muted">Sending the next call to the chain…</li> : null}
          </ol>
        </Card>
      ) : null}
      {error ? <p className="rounded-2xl bg-sun-soft p-4 text-lg text-sun-ink">{error}</p> : null}

      {end ? (
        <Card className="slide-in">
          <h3 className="font-display text-3xl font-semibold">
            {reverted} of {steps.length} attempts reverted. Sent out of the vault: {moneyText(0, settings.currency)}
          </h3>
          <p className="mt-2 text-[1.05rem] text-muted">
            {steps.length - reverted > 0
              ? `${steps.length - reverted} trade went through because it was inside the mandate. It cost ${moneyText(end.cost, settings.currency)} in fees.`
              : "Nothing went through this time: today's trading allowance was already used, or buying was paused."}{" "}
            The most the stolen key could still trade today is {moneyText(end.agentExposure.tradable, settings.currency)}, at a cost of at most {moneyText(end.agentExposure.maxCost, settings.currency)}. It can still make poor trades inside those limits. It cannot take the money.
          </p>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>Demo controls: the simulated market</Eyebrow>
        <p className="mt-1 text-[0.95rem] text-muted">Prices here come from this demo&apos;s own feed. The feed refuses any single move larger than its bound, so a big fall is pushed in steps. The Demo market switch at the top does the same with set prices.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[1.05rem]">Index fund price is {idx?.price}. Move it to</span>
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
