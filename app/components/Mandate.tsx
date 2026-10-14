"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { fill, formatLeft, LOCALE, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { ASSET, ASSET_NAME, money } from "./Overview";
import type { Act, AppState, Settings, View } from "./types";
import { Card, short, useSecondsLeft } from "./ui";

type Props = { state: AppState; settings: Settings; act: Act; skew: number; go: (v: View) => void; onAsk: (prompt: string) => void };

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const date = (iso: string, settings: Settings) => new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short", year: "numeric" });

// ---------------------------------------------------------------- waiting changes

export type Waiting = { key: string; label: string; appliesFrom: string };

/** Every change that raises the risk and is waiting out the delay, with a plain name. */
export function waitingChanges(state: AppState, t: Strings, settings: Settings): Waiting[] {
  const p = state.portfolio;
  const items: Waiting[] = [];
  if (p.pending.mandate) items.push({ key: "mandate", label: t.mandate.wMandate, appliesFrom: p.pending.mandate.appliesFrom });
  if (p.stopLoss.haltRequestAppliesFrom) items.push({ key: "halt", label: t.mandate.wHalt, appliesFrom: p.stopLoss.haltRequestAppliesFrom });
  if (p.pending.withdrawalAddress) items.push({ key: "wd", label: t.mandate.wWithdrawal, appliesFrom: p.pending.withdrawalAddress.appliesFrom });
  if (p.pending.agentKey) items.push({ key: "agent", label: t.mandate.wAgent, appliesFrom: p.pending.agentKey.appliesFrom });
  if (p.pending.unpause) items.push({ key: "unpause", label: t.mandate.wUnpause, appliesFrom: p.pending.unpause.appliesFrom });
  if (p.pending.waitingPeriod) items.push({ key: "delay", label: t.mandate.wDelay, appliesFrom: p.pending.waitingPeriod.appliesFrom });
  if (p.pending.guardian) {
    items.push({ key: "guardian", label: /^0x0+$/.test(p.pending.guardian.to) ? t.mandate.wGuardianRemove : t.mandate.wGuardianReplace, appliesFrom: p.pending.guardian.appliesFrom });
  }
  for (const x of p.positions) {
    if (x.pendingRule) items.push({ key: x.symbol, label: fill(t.mandate.wRule, { asset: ASSET_NAME[settings.language][x.symbol] }), appliesFrom: x.pendingRule.appliesFrom });
  }
  return items;
}

function WaitingRow({ item, skew, t }: { item: Waiting; skew: number; t: Strings }) {
  const secs = useSecondsLeft(item.appliesFrom, skew);
  const left = secs === null ? null : formatLeft(secs, t);
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 font-semibold">
        <Icon name="clock" size={15} className="text-sun-ink" />
        {item.label}
      </span>
      <span className={`num ${left ? "text-sun-ink" : "font-semibold text-leaf"}`}>{left ? fill(t.mandate.appliesIn, { time: left }) : t.mandate.ready}</span>
    </li>
  );
}

// ---------------------------------------------------------------- the document

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="flex items-baseline gap-3 font-display text-[1.05rem] font-semibold">
        <span className="num text-sm text-faint">0{n}</span>
        {title}
      </h3>
      <dl className="mt-3 divide-y divide-line/70">{children}</dl>
    </section>
  );
}

function Term({ label, note, value, tone = "ink" }: { label: ReactNode; note?: ReactNode; value: ReactNode; tone?: "ink" | "leaf" | "coral" }) {
  const color = { ink: "text-ink", leaf: "text-leaf", coral: "text-coral" }[tone];
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <dt className="min-w-0">
        <span className="block text-[0.95rem] font-semibold">{label}</span>
        {note ? <span className="mt-0.5 block text-sm text-muted">{note}</span> : null}
      </dt>
      <dd className={`num shrink-0 text-right text-[1.05rem] font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

function MandateDocument({ state, settings, t, onSigned }: { state: AppState; settings: Settings; t: Strings; onSigned: () => void }) {
  const p = state.portfolio;
  const m = p.mandate;
  const names = ASSET_NAME[settings.language];
  return (
    <Card className="p-8!">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t.mandate.docEyebrow}</p>
          <p className="mt-2 flex items-center gap-2 font-serif text-[1.7rem] leading-tight">
            <Icon name="shieldCheck" size={22} className="text-leaf" />
            {t.mandate.docSigned}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button onClick={onSigned} className="flex items-center gap-1.5 rounded-lg bg-forest px-3.5 py-2 text-sm font-semibold text-white hover:bg-forest-soft">
            <Icon name="mandate" size={15} />
            {t.signed.open}
          </button>
          <a href={`${state.explorer}/address/${state.mandate}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-leaf hover:underline">
            {t.mandate.contract} {short(state.mandate)}
            <Icon name="arrowUpRight" size={12} />
          </a>
        </div>
      </div>

      <div className="mt-7 space-y-6">
        <Section n={1} title={fill(t.mandate.sHold, { agent: BRAND.agent })}>
          <Term
            label={
              <span className="flex items-center gap-2.5">
                <span className={`flex size-7 items-center justify-center rounded-full ${ASSET.USD.tone}`}>
                  <Icon name={ASSET.USD.icon} size={14} />
                </span>
                {t.mandate.cash} <span className="text-xs font-normal text-faint">tUSD</span>
              </span>
            }
            note={t.mandate.cashRule}
            value={t.mandate.allowed}
            tone="leaf"
          />
          {p.positions.map((x) => {
            const rule = x.rule.allowed
              ? [fill(t.mandate.upTo, { n: x.rule.maxExposurePct }), x.rule.stopPrice ? fill(t.mandate.stopAt, { price: Number(x.rule.stopPrice) }) : null, x.rule.defensive ? t.mandate.defensiveNote : null].filter(Boolean).join(", ")
              : t.mandate.notAllowedRule;
            return (
              <Term
                key={x.symbol}
                label={
                  <span className="flex items-center gap-2.5">
                    <span className={`flex size-7 items-center justify-center rounded-full ${ASSET[x.symbol].tone}`}>
                      <Icon name={ASSET[x.symbol].icon} size={14} />
                    </span>
                    {names[x.symbol]} <span className="text-xs font-normal text-faint">{ASSET[x.symbol].token}</span>
                  </span>
                }
                note={rule}
                value={x.rule.allowed ? `≤ ${x.rule.maxExposurePct}%` : t.mandate.notAllowed}
                tone={x.rule.allowed ? "ink" : "coral"}
              />
            );
          })}
        </Section>

        <Section n={2} title={t.mandate.sTrade}>
          <Term label={t.mandate.perTrade} note={fill(t.mandate.perTradeNote, { amount: money(p.today.maxTrade, settings.currency) })} value={pct(m.maxTradePct)} />
          <Term label={t.mandate.perDay} note={fill(t.mandate.perDayNote, { amount: money(p.today.volumeLeft, settings.currency) })} value={pct(m.maxDailyVolumePct)} />
          <Term label={t.mandate.slippage} note={fill(t.mandate.slippageNote, { n: m.maxSlippagePct })} value={pct(m.maxSlippagePct)} />
        </Section>

        <Section n={3} title={t.mandate.sStop}>
          <Term label={t.mandate.loss} note={t.mandate.lossNote} value={pct(m.dailyLossPct)} />
          <Term
            label={t.mandate.streak}
            note={m.maxLossStreak ? fill(t.mandate.streakNote, { min: Math.round(m.cooldownSeconds / 60) }) : undefined}
            value={m.maxLossStreak ? fill(t.mandate.streakValue, { n: m.maxLossStreak }) : t.mandate.off}
          />
          <Term label={t.mandate.floor} note={fill(t.mandate.floorNote, { n: Math.round(p.defensiveSharePct * 10) / 10 })} value={pct(m.minDefensivePct)} />
        </Section>

        <Section n={4} title={t.mandate.sNever}>
          <Term label={t.mandate.borrow} note={t.mandate.borrowNote} value={t.mandate.never} tone="leaf" />
          <Term label={t.mandate.sendOut} note={fill(t.mandate.sendOutNote, { address: short(p.keys.withdrawalAddress) })} value={t.mandate.never} tone="leaf" />
          <Term label={t.mandate.ownRules} note={t.mandate.ownRulesNote} value={t.mandate.never} tone="leaf" />
        </Section>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs text-faint">
        <Icon name="info" size={14} className="mt-px shrink-0" />
        {t.mandate.footnote}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- side cards

function ChangesCard({ state, settings, skew, go, onAsk, t }: Omit<Props, "act"> & { t: Strings }) {
  const p = state.portfolio;
  const waiting = waitingChanges(state, t, settings);
  const minutes = Math.round(p.settings.loosenDelaySeconds / 60);
  const wait = minutes >= 1 ? fill(t.mandate.minutesDemo, { n: minutes }) : `${p.settings.loosenDelaySeconds} s`;
  return (
    <Card className="p-7!">
      <h3 className="font-display text-lg font-semibold">{t.mandate.changes}</h3>
      <div className="mt-4 space-y-2.5">
        <div className="rounded-xl bg-mint/70 p-4">
          <p className="flex items-center gap-2 font-semibold text-leaf">
            <Icon name="chartDown" size={17} />
            {t.mandate.lessRisk}
          </p>
          <p className="mt-1 text-sm text-muted">{t.mandate.lessRiskNote}</p>
        </div>
        <div className="rounded-xl bg-sun-soft/80 p-4">
          <p className="flex items-center gap-2 font-semibold text-sun-ink">
            <Icon name="clock" size={17} />
            {fill(t.mandate.moreRisk, { wait })}
          </p>
          <p className="mt-1 text-sm text-muted">{t.mandate.moreRiskNote}</p>
        </div>
      </div>

      <p className="eyebrow mt-6">{t.mandate.waitingNow}</p>
      {waiting.length ? (
        <>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {waiting.map((w) => (
              <WaitingRow key={w.key} item={w} skew={skew} t={t} />
            ))}
          </ul>
          <button onClick={() => go("approvals")} className="mt-3 flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
            {t.mandate.seeApprovals}
            <Icon name="arrowUpRight" size={13} />
          </button>
        </>
      ) : (
        <p className="mt-2 rounded-xl bg-paper px-4 py-3 text-sm text-muted">{t.mandate.nothingWaiting}</p>
      )}

      {settings.role === "owner" ? (
        <button onClick={() => onAsk(t.mandate.proposePrompt)} className="mt-6 flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft">
          {t.mandate.propose}
          <Icon name="arrowUpRight" size={15} />
        </button>
      ) : null}
    </Card>
  );
}

function RolesCard({ state, settings, t }: { state: AppState; settings: Settings; t: Strings }) {
  const p = state.portfolio;
  const hasGuardian = !/^0x0+$/.test(p.keys.guardian);
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  const roles: { n: string; who: string; what: string; status: string; tone: string; avatar: string }[] = [
    { n: name.slice(0, 1), who: t.mandate.you, what: t.mandate.youNote, status: t.mandate.active, tone: "bg-mint text-leaf", avatar: "bg-mint text-forest" },
    {
      n: "G",
      who: t.mandate.guardian,
      what: hasGuardian ? t.mandate.guardianNote : t.mandate.noGuardian,
      status: hasGuardian ? t.mandate.active : t.mandate.none,
      tone: hasGuardian ? "bg-mint text-leaf" : "bg-cream text-muted",
      avatar: "bg-sun-soft text-sun-ink",
    },
    {
      n: BRAND.agent.slice(0, 1),
      who: fill(t.mandate.agentRole, { agent: BRAND.agent }),
      what: p.agent.keyExpires ? fill(t.mandate.agentNote, { date: date(p.agent.keyExpires, settings) }) : t.mandate.agentNoKey,
      status: !p.agent.keyExpires ? t.mandate.none : p.agent.paused ? t.mandate.paused : t.mandate.bounded,
      tone: !p.agent.keyExpires || p.agent.paused ? "bg-sun-soft text-sun-ink" : "bg-sky-soft text-sky",
      avatar: "bg-forest text-mint",
    },
  ];
  return (
    <Card className="p-7!">
      <h3 className="font-display text-lg font-semibold">{t.mandate.roles}</h3>
      <ul className="mt-3 divide-y divide-line">
        {roles.map((r) => (
          <li key={r.who} className="flex items-start gap-3.5 py-3.5">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${r.avatar}`}>{r.n}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between gap-2 text-[0.95rem] font-semibold">
                {r.who}
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${r.tone}`}>{r.status}</span>
              </p>
              <p className="mt-0.5 text-sm text-muted">{r.what}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SafetyNetsCard({ state, settings, act, skew, t }: { state: AppState; settings: Settings; act: Act; skew: number; t: Strings }) {
  const p = state.portfolio;
  const haltSecs = useSecondsLeft(p.stopLoss.haltedUntil, skew);
  const haltLeft = haltSecs === null ? null : formatLeft(haltSecs, t);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, role: "owner" | "guardian", action: string) => {
    setBusy(id);
    try {
      await act(role, action);
    } finally {
      setBusy(null);
    }
  };
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.mandate.stopLoss}</h3>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${haltLeft ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"}`}>{haltLeft ? t.mandate.stopHalted : t.mandate.stopOn}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{haltLeft ? fill(t.mandate.stopHaltedNote, { time: haltLeft }) : t.mandate.stopNote}</p>
      <div className="mt-3">
        {haltLeft ? (
          <button disabled={busy !== null} onClick={() => run("resume", settings.role, "resume-stop-loss")} className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-soft disabled:opacity-50">
            {t.mandate.resume}
          </button>
        ) : settings.role === "guardian" ? (
          <button disabled={busy !== null} onClick={() => run("halt", "guardian", "halt-stop-loss")} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-50">
            {t.mandate.halt}
          </button>
        ) : (
          <p className="text-xs text-faint">{t.mandate.haltOwner}</p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-5">
        <h3 className="font-display text-lg font-semibold">{t.mandate.protect}</h3>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${p.protect.active ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"}`}>
          {p.protect.active ? (p.protect.cooldownUntil ? fill(t.mandate.protectUntil, { time: clock(p.protect.cooldownUntil) }) : t.mandate.protectDay) : t.mandate.protectOff}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{t.mandate.protectNote}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- page

export function MandateHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language, settings.role);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.mandate.title} <span className="accent">{t.mandate.titleAccent}</span>
      </h1>
      <p className="mt-1.5 text-[1.05rem] text-muted">{fill(t.mandate.sub, { agent: BRAND.agent })}</p>
    </div>
  );
}

export function MandateView(props: Props) {
  const { state, settings, act, skew } = props;
  const t = strings(settings.language, settings.role);
  // ?signed=open opens it straight away, for links and screenshots (this screen only renders in the browser)
  const [signedOpen, setSignedOpen] = useState(() => new URLSearchParams(window.location.search).get("signed") === "open");
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      {signedOpen ? <SignedDialog state={state} settings={settings} onClose={() => setSignedOpen(false)} /> : null}
      <MandateDocument state={state} settings={settings} t={t} onSigned={() => setSignedOpen(true)} />
      <div className="space-y-5">
        <ChangesCard {...props} t={t} />
        <RolesCard state={state} settings={settings} t={t} />
        <SafetyNetsCard state={state} settings={settings} act={act} skew={skew} t={t} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- what was signed

type Terms = { maxTradePct: number; maxDailyVolumePct: number; dailyLossPct: number; maxSlippagePct: number; minDefensivePct: number; maxLossStreak: number; cooldownMinutes: number };
type SignedRule = { symbol: string; allowed: boolean; defensive: boolean; maxExposurePct: number; stopPrice: string | null };
type SignedChange = { kind: string; at: string; tx: string; url: string; terms?: Terms; rule?: SignedRule; address?: string; seconds?: number };
type Signed = { at: string; tx: string; url: string; terms: Terms | null; rules: SignedRule[]; agent: { address: string; expires: string } | null; changes: SignedChange[]; proposed: number; cancelled: number };

/** Each term, how to show it, and which way is tighter. */
function termRows(t: Strings): [keyof Terms, string, (v: number) => string, "lower" | "higher"][] {
  const p = (v: number) => `${v}%`;
  return [
    ["maxTradePct", t.signed.fMaxTrade, p, "lower"],
    ["maxDailyVolumePct", t.signed.fPerDay, p, "lower"],
    ["dailyLossPct", t.signed.fLoss, p, "lower"],
    ["maxSlippagePct", t.signed.fSlippage, p, "lower"],
    ["minDefensivePct", t.signed.fFloor, p, "higher"],
    ["maxLossStreak", t.signed.fStreak, (v) => String(v), "lower"],
    ["cooldownMinutes", t.signed.fCooldown, (v) => fill(t.signed.minutes, { n: v }), "higher"],
  ];
}

const ruleText = (r: SignedRule, t: Strings) =>
  r.allowed ? [fill(t.signed.allowedCap, { n: r.maxExposurePct }), r.stopPrice ? fill(t.signed.stop, { price: Number(r.stopPrice) }) : null, r.defensive ? t.signed.defensive : null].filter(Boolean).join(", ") : t.signed.notAllowed;

/** One line per change since signing, with whether it lowered or raised the risk. */
function describeChanges(signed: Signed, t: Strings): { at: string; url: string; lines: string[]; tone: "less" | "more" | "neutral" }[] {
  let terms = signed.terms;
  const rules = new Map(signed.rules.map((r) => [r.symbol, r]));
  const out: { at: string; url: string; lines: string[]; tone: "less" | "more" | "neutral" }[] = [];
  for (const c of signed.changes) {
    if (c.kind === "PolicyChanged" && c.terms && terms) {
      let looser = false;
      let tighter = false;
      const lines: string[] = [];
      for (const [key, label, show, tight] of termRows(t)) {
        const a = terms[key];
        const b = c.terms[key];
        if (a === b) continue;
        lines.push(`${label}: ${show(a)} → ${show(b)}`);
        if ((tight === "lower") === b < a) tighter = true;
        else looser = true;
      }
      terms = c.terms;
      if (lines.length) out.push({ at: c.at, url: c.url, lines, tone: looser ? "more" : tighter ? "less" : "neutral" });
    } else if (c.kind === "AssetRuleChanged" && c.rule) {
      const before = rules.get(c.rule.symbol);
      rules.set(c.rule.symbol, c.rule);
      const looser = !before || (c.rule.allowed && !before.allowed) || c.rule.maxExposurePct > before.maxExposurePct || (before.stopPrice !== null && (c.rule.stopPrice === null || Number(c.rule.stopPrice) < Number(before.stopPrice)));
      out.push({ at: c.at, url: c.url, lines: [`${c.rule.symbol}: ${before ? ruleText(before, t) : "—"} → ${ruleText(c.rule, t)}`], tone: looser ? "more" : "less" });
    } else if (c.kind === "GuardianChanged") {
      const removed = !c.address || /^0x0+$/.test(c.address);
      out.push({ at: c.at, url: c.url, lines: [removed ? t.signed.cGuardianRemoved : fill(t.signed.cGuardian, { address: short(c.address ?? "") })], tone: removed ? "more" : "neutral" });
    } else if (c.kind === "WithdrawalAddressChanged") {
      out.push({ at: c.at, url: c.url, lines: [fill(t.signed.cWithdrawal, { address: short(c.address ?? "") })], tone: "more" });
    } else if (c.kind === "LoosenDelayChanged") {
      out.push({ at: c.at, url: c.url, lines: [fill(t.signed.cDelay, { n: fill(t.signed.minutes, { n: Math.round((c.seconds ?? 0) / 60) }) })], tone: "neutral" });
    } else if (c.kind === "AgentSet") {
      out.push({ at: c.at, url: c.url, lines: [fill(t.signed.cAgent, { agent: BRAND.agent })], tone: "neutral" });
    } else if (c.kind === "AgentRevoked") {
      out.push({ at: c.at, url: c.url, lines: [fill(t.signed.cRevoked, { agent: BRAND.agent })], tone: "less" });
    }
  }
  return out;
}

export function SignedDialog({ state, settings, onClose }: { state: AppState; settings: Settings; onClose: () => void }) {
  const t = strings(settings.language, settings.role);
  const [data, setData] = useState<{ signed?: Signed | null; error?: string } | null>(null);
  useEffect(() => {
    fetch("/api/mandate", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch((err) => setData({ error: String(err) }));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const s = data?.signed;
  const current = state.portfolio.mandate;
  const nowTerms: Terms = {
    maxTradePct: current.maxTradePct,
    maxDailyVolumePct: current.maxDailyVolumePct,
    dailyLossPct: current.dailyLossPct,
    maxSlippagePct: current.maxSlippagePct,
    minDefensivePct: current.minDefensivePct,
    maxLossStreak: current.maxLossStreak,
    cooldownMinutes: Math.round(current.cooldownSeconds / 60),
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "long", year: "numeric" });
  const stamp = (iso: string) => `${new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const toneClass = { less: "bg-mint text-leaf", more: "bg-sun-soft text-sun-ink", neutral: "bg-cream text-muted" } as const;
  const toneText = { less: t.signed.lessRisk, more: t.signed.moreRisk, neutral: t.signed.mixed } as const;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t.signed.eyebrow} className="slide-in max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.signed.eyebrow}</p>
          <button onClick={onClose} aria-label={t.signed.close} className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
            <Icon name="close" size={18} />
          </button>
        </div>
        {!data ? <p className="mt-4 text-sm text-muted">{t.signed.loading}</p> : null}
        {data?.error ? <p className="mt-4 rounded-xl bg-sun-soft px-4 py-3 text-sm text-sun-ink">{fill(t.signed.failed, { error: data.error })}</p> : null}
        {s ? (
          <>
            <h2 className="mt-2 font-serif text-[1.9rem] leading-tight">{fill(t.signed.title, { date: day(s.at) })}</h2>
            <p className="mt-2 text-sm text-muted">{fill(t.signed.by, { who: settings.role === "owner" ? t.signed.you : settings.language === "bn" ? BRAND.ownerBn : BRAND.owner })}</p>
            <a href={s.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-leaf hover:bg-paper">
              <span className="num">{t.signed.viewTx} {short(s.tx)}</span>
              <Icon name="arrowUpRight" size={13} />
            </a>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="eyebrow">{t.signed.terms}</p>
                <dl className="mt-2 divide-y divide-line border-y border-line text-sm">
                  {s.terms
                    ? termRows(t).map(([key, label, show]) => {
                        const was = s.terms![key];
                        const now = nowTerms[key];
                        return (
                          <div key={key} className="flex items-baseline justify-between gap-3 py-2">
                            <dt className="text-muted">{label}</dt>
                            <dd className="num text-right font-semibold">
                              {show(was)}
                              {was !== now ? <span className="ml-1.5 text-xs font-normal text-sun-ink">({fill(t.signed.now, { value: show(now) })})</span> : null}
                            </dd>
                          </div>
                        );
                      })
                    : null}
                </dl>
              </div>
              <div>
                <p className="eyebrow">{t.signed.assets}</p>
                <dl className="mt-2 divide-y divide-line border-y border-line text-sm">
                  {s.rules.map((r) => (
                    <div key={r.symbol} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="font-semibold">{r.symbol}</dt>
                      <dd className="text-right text-muted">{ruleText(r, t)}</dd>
                    </div>
                  ))}
                </dl>
                {s.agent ? <p className="mt-3 text-xs text-muted">{fill(t.signed.agentKey, { agent: BRAND.agent, date: day(s.agent.expires) })}</p> : null}
              </div>
            </div>

            <p className="eyebrow mt-7">{t.signed.changes}</p>
            {(() => {
              const list = describeChanges(s, t);
              return list.length ? (
                <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
                  {list.map((c, i) => (
                    <li key={i} className="relative">
                      <span className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-card bg-sage" />
                      <p className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="num text-faint">{stamp(c.at)}</span>
                        <span className={`rounded-md px-1.5 py-0.5 font-semibold ${toneClass[c.tone]}`}>{toneText[c.tone]}</span>
                        <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-leaf hover:underline">
                          tx
                          <Icon name="arrowUpRight" size={11} />
                        </a>
                      </p>
                      {c.lines.map((l) => (
                        <p key={l} className="num mt-1 text-sm font-semibold">
                          {l}
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-muted">{t.signed.noChanges}</p>
              );
            })()}
            {s.proposed ? <p className="mt-5 text-xs text-muted">{fill(t.signed.asked, { proposed: s.proposed, cancelled: s.cancelled })}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
