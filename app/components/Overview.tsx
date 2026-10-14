"use client";

import { Fragment, type ReactNode } from "react";
import type { AssetSymbol } from "@/lib/assets";
import { BRAND } from "@/lib/brand";
import { CURRENCIES, type Currency } from "@/lib/money";
import type { Receipt } from "@/lib/receipts";
import type { ValuePoint } from "@/lib/values";
import { clock, fill, LOCALE, strings, type Strings } from "./i18n";
import { Icon, type IconName } from "./icons";
import { Mascot } from "./Mascot";
import type { MimoSay } from "./mimo";
import type { AppState, Settings, View } from "./types";
import { Card, short } from "./ui";
import { Change } from "./views";

type Props = { state: AppState; settings: Settings; mimo: MimoSay; onAck: () => void; go: (v: View) => void; openChat: () => void };

const trim = (n: number, decimals: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** The big number: whole part large, decimals small, tUSD beside it. */
function BigMoney({ usd, currency }: { usd: string; currency: Currency }) {
  const c = CURRENCIES[currency];
  const value = Number(usd) * c.perUsd;
  const [whole, frac] = trim(value, Math.max(c.decimals, 2)).split(".");
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <p className="num font-display text-[3.6rem] leading-none font-semibold tracking-[-0.04em]">
        <span className="mr-1 text-[2.4rem] font-medium text-muted">{c.sign}</span>
        {whole}
        {c.decimals > 0 && frac ? <span className="text-[2rem] font-medium text-faint">.{frac.padEnd(2, "0")}</span> : null}
      </p>
      <p className="num text-base font-medium text-muted">≈ {trim(Number(usd), 2)} tUSD</p>
    </div>
  );
}

function money(usd: string | number, currency: Currency) {
  const c = CURRENCIES[currency];
  return `${c.sign}${trim(Number(usd) * c.perUsd, c.decimals)}`;
}

// ---------------------------------------------------------------- value chart

/** The value as the app has read it from the vault, with a few axis labels. Draws only real readings. */
function ValueChart({ points, settings, t }: { points: ValuePoint[]; settings: Settings; t: Strings }) {
  if (points.length < 2) return <p className="flex h-full items-center justify-center text-sm text-muted">{t.overview.chartEmpty}</p>;
  const w = 600;
  const h = 200;
  const values = points.map((p) => p.value);
  // the vertical range is at least 3% of the value, so a small wobble looks small
  const mid = (Math.min(...values) + Math.max(...values)) / 2;
  const half = Math.max(((Math.max(...values) - Math.min(...values)) / 2) * 1.25, Math.abs(mid) * 0.015, 1e-9);
  const lo = mid - half;
  const hi = mid + half;
  const t0 = new Date(points[0].at).getTime();
  const span = new Date(points[points.length - 1].at).getTime() - t0 || 1;
  const xy = points.map((p) => [((new Date(p.at).getTime() - t0) / span) * w, h - ((p.value - lo) / (hi - lo)) * h] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  const day = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short" });
  const first = points[0].at;
  const middle = points[Math.floor(points.length / 2)].at;
  const sameDay = day(first) === day(points[points.length - 1].at);
  const label = (iso: string) => (sameDay ? clock(iso) : day(iso));
  return (
    <div className="grid h-full grid-cols-[1fr_auto] grid-rows-[1fr_auto] gap-x-3 gap-y-2">
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-leaf)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--color-leaf)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1="0" x2={w} y1={f * h} y2={f * h} stroke="var(--color-line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#value-fill)" />
          <path d={line} fill="none" stroke="var(--color-leaf)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-leaf shadow" style={{ left: `${(lx / w) * 100}%`, top: `${(ly / h) * 100}%` }} />
        <span
          className="num card-shadow absolute -translate-x-full -translate-y-[160%] rounded-lg border border-line bg-card px-2.5 py-1 text-sm font-semibold whitespace-nowrap"
          style={{ left: `${(lx / w) * 100}%`, top: `${(ly / h) * 100}%` }}
        >
          {money(values[values.length - 1], settings.currency)}
        </span>
      </div>
      <div className="num flex flex-col justify-between text-xs text-faint">
        <span>{money(hi, settings.currency)}</span>
        <span>{money(lo, settings.currency)}</span>
      </div>
      <div className="num flex justify-between text-xs tracking-wide text-faint uppercase">
        <span>{label(first)}</span>
        <span>{label(middle)}</span>
        <span>{t.overview.now}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- value card

const ASSET: Record<AssetSymbol | "USD", { icon: IconName; tone: string; token: string }> = {
  USD: { icon: "coins", tone: "bg-mint text-leaf", token: "tUSD" },
  IDX: { icon: "chart", tone: "bg-sky-soft text-sky", token: "tIDX" },
  BOND: { icon: "bond", tone: "bg-mint text-leaf", token: "tBOND" },
  GOLD: { icon: "gold", tone: "bg-sun-soft text-sun-ink", token: "tGOLD" },
  MEME: { icon: "bolt", tone: "bg-coral-soft text-coral", token: "MEME" },
};

const ASSET_NAME: Record<Settings["language"], Record<AssetSymbol, string>> = {
  en: { IDX: "Index fund", BOND: "Bond fund", GOLD: "Gold", MEME: "Moon Meme Coin" },
  bn: { IDX: "ইনডেক্স ফান্ড", BOND: "বন্ড ফান্ড", GOLD: "সোনা", MEME: "মুন মিম কয়েন" },
  zh: { IDX: "指数基金", BOND: "债券基金", GOLD: "黄金", MEME: "Moon Meme 币" },
};

function ValueCard({ state, settings, t }: { state: AppState; settings: Settings; t: Strings }) {
  const p = state.portfolio;
  const start = Number(p.today.startValue);
  const change = start > 0 ? ((Number(p.totalValue) - start) / start) * 100 : 0;
  const rows: { key: string; icon: (typeof ASSET)["USD"]; name: string; usd: string; share: number }[] = [
    { key: "USD", icon: ASSET.USD, name: t.overview.cash, usd: p.cash, share: p.cashSharePct },
    ...p.positions
      .filter((x) => x.rule.allowed || Number(x.amount) > 0)
      .map((x) => ({ key: x.symbol, icon: ASSET[x.symbol], name: ASSET_NAME[settings.language][x.symbol], usd: x.value, share: x.sharePct })),
  ];
  return (
    <Card className="flex flex-col overflow-hidden p-0!">
      <div className="px-7 pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">{t.overview.value}</p>
          <p className="text-sm text-faint">{t.overview.testAssets}</p>
        </div>
        <div className="mt-4">
          <BigMoney usd={p.totalValue} currency={settings.currency} />
        </div>
        <div className="mt-3">
          <Change pct={change} suffix={t.overview.today} />
        </div>
        <div className="mt-8 mb-6 h-56">
          <ValueChart points={state.history.slice(-240)} settings={settings} t={t} />
        </div>
      </div>
      <ul className="mt-auto grid border-t border-line bg-paper/60" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r, i) => (
          <li key={r.key} className={`px-5 py-4 ${i ? "border-l border-line" : ""}`}>
            <span className="flex items-center gap-2.5">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${r.icon.tone}`}>
                <Icon name={r.icon.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block text-xs text-faint">{r.icon.token}</span>
              </span>
            </span>
            <span className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="num text-base font-semibold">{money(r.usd, settings.currency)}</span>
              <span className="num text-xs text-faint">{r.share}%</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- mascot card

/** The dark card with the mascot. Its words and colour follow the mascot's state. */
function MimoCard({ state, mimo, onAck, openChat, t }: { state: AppState; mimo: MimoSay; onAck: () => void; openChat: () => void; t: Strings }) {
  const headline = t.mood.headline[mimo.mood].split("\n");
  const status = state.portfolio.agent.paused ? t.mood.chip.watching : mimo.status;
  return (
    <section className={`mood-${mimo.mood} relative flex flex-col overflow-hidden rounded-(--radius-card) bg-forest text-white shadow-[0_24px_48px_-28px_rgb(24_60_48/0.6)]`}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgb(255_255_255/0.08),transparent_60%)]" />
      <Icon name="sparkle" size={16} strokeWidth={1.4} className="absolute top-20 left-14 text-white/35" />
      <Icon name="sparkle" size={22} strokeWidth={1.2} className="absolute top-24 right-16 text-sun/70" />
      <Icon name="sparkle" size={12} strokeWidth={1.4} className="absolute top-52 left-24 text-white/30" />

      <div className="relative flex items-center justify-between px-6 pt-5">
        <p className="eyebrow flex items-center gap-2 text-white/75!">
          <span className="size-2 rounded-full" style={{ background: mimo.mood === "calm" ? "#9fd3a8" : "var(--mood-line)" }} />
          {fill(t.overview.onWatch, { agent: BRAND.agent, status })}
        </p>
        <Icon name="shieldCheck" size={20} className="text-white/60" />
      </div>

      <div className="relative mx-auto mt-1 flex flex-col items-center">
        <div aria-hidden className="absolute top-1/2 left-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-2xl transition-colors duration-500" style={{ background: "var(--mood-line)" }} />
        <div className="relative">
          <Mascot mood={mimo.mood} variant={mimo.variant} size={230} />
        </div>
        <span className="relative -mt-5 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm font-semibold text-ink shadow">
          <span className="size-2 rounded-full" style={{ background: "var(--mood)" }} />
          {t.mood.chip[mimo.mood]}
          {mimo.dismissKey ? (
            <button onClick={onAck} title={t.overview.gotIt} aria-label={t.overview.gotIt} className="-mr-1 ml-0.5 rounded-full p-0.5 text-muted hover:bg-cream hover:text-ink">
              <Icon name="close" size={13} strokeWidth={2.4} />
            </button>
          ) : null}
        </span>
      </div>

      <div className="relative mt-5 mb-7 px-8 text-center">
        <h2 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.01em]">
          {headline.map((l, i) => (
            <Fragment key={i}>
              {l}
              {i < headline.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-[0.92rem] leading-relaxed text-white/70">{mimo.line}</p>
      </div>

      <button onClick={openChat} className="relative mt-auto flex items-center justify-between border-t border-white/12 px-6 py-4 text-left text-[0.95rem] font-semibold hover:bg-white/5">
        {fill(t.overview.talk, { agent: BRAND.agent })}
        <Icon name="arrowUpRight" size={18} />
      </button>
      <p className="relative flex justify-center gap-4 bg-forest-deep/60 px-6 py-2.5 text-xs text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-white/50" />
          {t.overview.cardFoot1}
        </span>
        <span>{t.overview.cardFoot2}</span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- boundaries

/** What a stolen agent key could still do today, next to the daily loss limit. */
function BoundariesCard({ state, settings, go, t }: { state: AppState; settings: Settings; go: (v: View) => void; t: Strings }) {
  const p = state.portfolio;
  const m = p.mandate;
  const lossFill = m.dailyLossPct > 0 ? Math.min(1, p.today.lossPct / m.dailyLossPct) : 0;
  const left = Math.max(0, m.dailyLossPct - p.today.lossPct);
  const allowed = p.positions.filter((x) => x.rule.allowed).length;
  const delayMin = Math.round(p.settings.loosenDelaySeconds / 60);
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.overview.boundaries}</h3>
        <button onClick={() => go("mandate")} className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
          {t.overview.viewMandate}
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="eyebrow">{t.overview.hacked}</p>
          <p className="num mt-3 font-display text-[2.6rem] leading-none font-semibold tracking-[-0.03em]">{money(p.agentExposure.maxCost, settings.currency)}</p>
          <p className="mt-2 text-sm text-muted">
            {t.overview.hackedLead} <span className="font-semibold text-leaf">{money(0, settings.currency)}</span> {t.overview.sendOutShort}
          </p>
        </div>
        <div>
          <p className="eyebrow">{t.overview.lossLimit}</p>
          <p className="mt-3 flex items-baseline gap-1">
            <span className="num font-display text-[2.6rem] leading-none font-semibold tracking-[-0.03em]">{p.today.lossPct.toFixed(1)}</span>
            <span className="num text-lg text-faint">/ {m.dailyLossPct}%</span>
          </p>
          {/* four segments, filled up to today's loss; amber once protect mode is on, never red or green for a loss */}
          <div className="mt-3 grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => {
              const part = Math.max(0, Math.min(1, lossFill * 4 - i));
              return (
                <div key={i} className="h-1.5 overflow-hidden rounded-full bg-cream">
                  <div className={`h-full rounded-full ${p.protect.active ? "bg-sun" : "bg-sage"}`} style={{ width: `${part * 100}%` }} />
                </div>
              );
            })}
          </div>
          <p className={`mt-2 text-sm ${p.protect.active ? "font-semibold text-sun-ink" : "text-muted"}`}>
            {p.protect.active ? t.overview.protectOn : fill(t.overview.beforeProtect, { n: left.toFixed(1) })}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {[
          [`${m.maxTradePct}%`, t.overview.perTrade],
          [String(allowed), t.overview.approvedAssets],
          [delayMin >= 1 ? fill(t.overview.minutes, { n: delayMin }) : fill(t.overview.seconds, { n: p.settings.loosenDelaySeconds }), t.overview.toLoosen],
        ].map(([v, l]) => (
          <span key={l} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted">
            <span className="num font-semibold text-ink">{v}</span> {l}
          </span>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-faint">
        <Icon name="shieldCheck" size={14} className="text-leaf" />
        {fill(t.overview.atLimit, { agent: BRAND.agent })}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- recent moves

const OUTCOME_ICON: Record<Receipt["outcome"], [IconName, string]> = {
  done: ["check", "bg-mint text-leaf"],
  "blocked by the risk engine": ["shield", "bg-coral-soft text-coral"],
  "reverted by the contract": ["shield", "bg-coral-soft text-coral"],
  "sent to the owner": ["clock", "bg-sun-soft text-sun-ink"],
  "waiting out the delay": ["clock", "bg-sun-soft text-sun-ink"],
  "decided not to act": ["x", "bg-cream text-muted"],
  failed: ["alert", "bg-sun-soft text-sun-ink"],
};

const OUTCOME_TEXT: Record<Receipt["outcome"], string> = {
  done: "text-muted",
  "blocked by the risk engine": "text-coral",
  "reverted by the contract": "text-coral",
  "sent to the owner": "text-sun-ink",
  "waiting out the delay": "text-sun-ink",
  "decided not to act": "text-muted",
  failed: "text-sun-ink",
};

function RecentCard({ state, go, t }: { state: AppState; go: (v: View) => void; t: Strings }) {
  const recent = state.receipts.slice(0, 3);
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.overview.recent}</h3>
        <button onClick={() => go("activity")} className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
          {t.overview.allActivity}
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="mt-5 text-[0.95rem] text-muted">{fill(t.overview.nothingYet, { agent: BRAND.agent })}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {recent.map((r) => {
            const [icon, tone] = OUTCOME_ICON[r.outcome];
            return (
              <li key={r.ref + r.at}>
                <button onClick={() => go("activity")} className="flex w-full items-center gap-3.5 py-4 text-left">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon name={icon} size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.95rem] font-semibold">{r.what}</span>
                    <span className={`mt-0.5 block text-sm ${OUTCOME_TEXT[r.outcome]}`}>{t.outcome[r.outcome]}</span>
                  </span>
                  <span className="num shrink-0 pt-0.5 text-xs text-faint">{clock(r.at)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page

function greetingKey(date: Date): "morning" | "afternoon" | "evening" {
  const h = date.getHours();
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening";
}

export function OverviewHeader({ settings, go }: { settings: Settings; go: (v: View) => void }) {
  const t = strings(settings.language);
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <Icon name="sparkle" size={16} strokeWidth={1.6} className="text-sun" />
          {fill(t.overview[greetingKey(new Date())], { name })}
        </p>
        <h1 className="mt-3 font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
          {t.overview.title} <span className="accent">{t.overview.titleAccent}</span>
        </h1>
        <p className="mt-1.5 text-[1.05rem] text-muted">{fill(t.overview.subtitle, { agent: BRAND.agent })}</p>
      </div>
      <button onClick={() => go("mandate")} className="card-shadow flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] font-semibold hover:bg-paper">
        <Icon name="mandate" size={18} />
        {t.overview.mandateButton}
        <Icon name="arrowUpRight" size={16} className="text-muted" />
      </button>
    </div>
  );
}

function ProofBar({ state, settings, go, t }: { state: AppState; settings: Settings; go: (v: View) => void; t: Strings }) {
  const p = state.portfolio;
  const items: ReactNode[] = [
    <a key="chain" href={`${state.explorer}/address/${state.mandate}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
      {t.overview.onChain} {short(state.mandate)}
      <Icon name="arrowUpRight" size={12} />
    </a>,
    <span key="key">
      {p.agent.keyExpires ? fill(t.overview.keyUntil, { date: new Date(p.agent.keyExpires).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short", year: "numeric" }) }) : t.overview.noKeyShort}
    </span>,
    <button key="proof" onClick={() => go("proof")} className="flex items-center gap-1 font-semibold text-leaf hover:underline">
      {t.overview.inspect}
      <Icon name="arrowUpRight" size={12} />
    </button>,
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p className="flex items-center gap-2">
        <Icon name="shieldCheck" size={16} className="text-leaf" />
        <span className="font-semibold text-ink">{t.overview.trust}</span> {t.overview.verify}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">{items}</div>
    </div>
  );
}

export function OverviewView({ state, settings, mimo, onAck, go, openChat }: Props) {
  const t = strings(settings.language);
  const p = state.portfolio;
  if (!p.mandateSigned) {
    return (
      <Card className="flex flex-wrap items-center gap-8 p-8!">
        <Mascot mood={mimo.mood} variant={mimo.variant} size={200} />
        <div className="max-w-xl">
          <h2 className="font-display text-3xl font-semibold">{t.overview.noMandate}</h2>
          <p className="mt-2 text-lg text-muted">{fill(t.overview.noMandateBody, { agent: BRAND.agent })}</p>
          {p.signableFrom ? (
            <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">
              {fill(t.overview.signableFrom, { time: new Date(p.signableFrom).toLocaleString(LOCALE[settings.language], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
            </p>
          ) : null}
          <button onClick={openChat} className="mt-5 rounded-xl bg-forest px-5 py-3 font-semibold text-white hover:bg-forest-soft">
            {fill(t.overview.talk, { agent: BRAND.agent })}
          </button>
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
        <ValueCard state={state} settings={settings} t={t} />
        <MimoCard state={state} mimo={mimo} onAck={onAck} openChat={openChat} t={t} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
        <BoundariesCard state={state} settings={settings} go={go} t={t} />
        <RecentCard state={state} go={go} t={t} />
      </div>
      <div className="border-t border-line pt-4">
        <ProofBar state={state} settings={settings} go={go} t={t} />
      </div>
    </div>
  );
}
