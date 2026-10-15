"use client";

import { statusOf } from "@/lib/commitment-status";
import { Fragment, useEffect, type ReactNode } from "react";
import type { AssetSymbol } from "@/lib/assets";
import { BRAND } from "@/lib/brand";
import { CURRENCIES, type Currency } from "@/lib/money";
import type { Receipt } from "@/lib/receipts";
import type { ValuePoint } from "@/lib/values";
import { clock, fill, LOCALE, strings, type Strings, ownerName } from "./i18n";
import { Icon, type IconName } from "./icons";
import { Mascot } from "./Mascot";
import type { MimoSay } from "./mimo";
import type { AppState, Settings, View } from "./types";
import { Card, short, smoothPath } from "./ui";
import { OUTCOME_ICON, OUTCOME_TEXT } from "./Activity";

type Props = {
  state: AppState;
  settings: Settings;
  mimo: MimoSay;
  onAck: () => void;
  go: (v: View) => void;
  openChat: () => void;
  onOpen: (r: Receipt) => void;
  /** Reopens the first-time setup while the mandate is unsigned. */
  onSetup?: () => void;
};

const trim = (n: number, decimals: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });

/** The big number: whole part large, decimals small, tUSD beside it. */
function BigMoney({ usd, currency }: { usd: string; currency: Currency }) {
  const c = CURRENCIES[currency];
  const value = Number(usd) * c.perUsd;
  const [whole, frac] = trim(value, Math.max(c.decimals, 2)).split(".");
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <p className="num font-display text-[3.6rem] leading-none font-semibold tracking-[-0.04em]">
        <span className="mr-1 text-[2.4rem] font-medium text-muted">
          {c.sign}
        </span>
        {whole}
        {c.decimals > 0 && frac ? (
          <span className="text-[2rem] font-medium text-faint">
            .{frac.padEnd(2, "0")}
          </span>
        ) : null}
      </p>
      <p className="num text-base font-medium text-muted">
        ≈ {trim(Number(usd), 2)} tUSD
      </p>
    </div>
  );
}

export function money(usd: string | number, currency: Currency) {
  const c = CURRENCIES[currency];
  return `${c.sign}${trim(Number(usd) * c.perUsd, c.decimals)}`;
}

/** A change shown without red or green: neutral ink with an arrow and a sign (in China red means up). */
export function Change({
  pct,
  suffix = "today",
}: {
  pct: number;
  suffix?: string;
}) {
  const flat = Math.abs(pct) < 0.005;
  const mark = flat ? "" : pct > 0 ? "▲ +" : "▼ −";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1 text-sm font-semibold text-ink">
      {mark}
      {Math.abs(pct).toFixed(2)}% {suffix}
    </span>
  );
}

// ---------------------------------------------------------------- value chart

/** The value as the app has read it from the vault, with a few axis labels. Draws only real readings. */
function ValueChart({
  points,
  settings,
  t,
}: {
  points: ValuePoint[];
  settings: Settings;
  t: Strings;
}) {
  if (points.length < 2)
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted">
        {t.overview.chartEmpty}
      </p>
    );
  const w = 600;
  const h = 200;
  const values = points.map((p) => p.value);
  // the vertical range is at least 3% of the value, so a small wobble looks small
  const mid = (Math.min(...values) + Math.max(...values)) / 2;
  const half = Math.max(
    ((Math.max(...values) - Math.min(...values)) / 2) * 1.25,
    Math.abs(mid) * 0.015,
    1e-9,
  );
  const lo = mid - half;
  const hi = mid + half;
  const t0 = new Date(points[0].at).getTime();
  const span = new Date(points[points.length - 1].at).getTime() - t0 || 1;
  const xy = points.map(
    (p) =>
      [
        ((new Date(p.at).getTime() - t0) / span) * w,
        h - ((p.value - lo) / (hi - lo)) * h,
      ] as const,
  );
  const line = smoothPath(xy);
  const [lx, ly] = xy[xy.length - 1];
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(LOCALE[settings.language], {
      day: "numeric",
      month: "short",
    });
  const first = points[0].at;
  const middle = points[Math.floor(points.length / 2)].at;
  const sameDay = day(first) === day(points[points.length - 1].at);
  const label = (iso: string) => (sameDay ? clock(iso) : day(iso));
  return (
    <div className="grid h-full grid-cols-[1fr_auto] grid-rows-[1fr_auto] gap-x-3 gap-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0"
                stopColor="var(--color-leaf)"
                stopOpacity="0.32"
              />
              <stop
                offset="0.6"
                stopColor="var(--color-leaf)"
                stopOpacity="0.1"
              />
              <stop offset="1" stopColor="var(--color-leaf)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2={w}
              y1={f * h}
              y2={f * h}
              stroke="var(--color-line)"
              strokeDasharray="3 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#value-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--color-leaf)"
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-leaf/20 motion-safe:animate-ping"
          style={{ left: `${(lx / w) * 100}%`, top: `${(ly / h) * 100}%` }}
        />
        <span
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-leaf shadow"
          style={{ left: `${(lx / w) * 100}%`, top: `${(ly / h) * 100}%` }}
        />
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

export const ASSET: Record<
  AssetSymbol | "USD",
  { icon: IconName; tone: string; token: string }
> = {
  USD: { icon: "coins", tone: "bg-mint text-leaf", token: "tUSD" },
  IDX: { icon: "chart", tone: "bg-sky-soft text-sky", token: "tIDX" },
  BOND: { icon: "bond", tone: "bg-mint text-leaf", token: "tBOND" },
  GOLD: { icon: "gold", tone: "bg-sun-soft text-sun-ink", token: "tGOLD" },
  MEME: { icon: "bolt", tone: "bg-coral-soft text-coral", token: "MEME" },
};

export const ASSET_NAME: Record<
  Settings["language"],
  Record<AssetSymbol, string>
> = {
  en: {
    IDX: "Index fund",
    BOND: "Bond fund",
    GOLD: "Gold",
    MEME: "Moon Meme Coin",
  },
  bn: {
    IDX: "ইনডেক্স ফান্ড",
    BOND: "বন্ড ফান্ড",
    GOLD: "সোনা",
    MEME: "মুন মিম কয়েন",
  },
  zh: { IDX: "指数基金", BOND: "债券基金", GOLD: "黄金", MEME: "Moon Meme 币" },
};

function ValueCard({
  state,
  settings,
  t,
}: {
  state: AppState;
  settings: Settings;
  t: Strings;
}) {
  const p = state.portfolio;
  const start = Number(p.today.startValue);
  const change = start > 0 ? ((Number(p.totalValue) - start) / start) * 100 : 0;
  // everything the investor owns here, counted once: the portfolio plus what is set aside for commitments
  const aside = Number(p.setAside);
  const whole = Number(p.totalValue) + aside;
  const shareOf = (usd: string | number) => (whole > 0 ? Math.round((Number(usd) / whole) * 1000) / 10 : 0);
  const rows: {
    key: string;
    icon: (typeof ASSET)["USD"];
    name: string;
    usd: string;
    share: number;
  }[] = [
    {
      key: "USD",
      icon: ASSET.USD,
      name: t.overview.cash,
      usd: p.cash,
      share: shareOf(p.cash),
    },
    ...p.positions
      .filter((x) => x.rule.allowed || Number(x.amount) > 0)
      .map((x) => ({
        key: x.symbol,
        icon: ASSET[x.symbol],
        name: ASSET_NAME[settings.language][x.symbol],
        usd: x.value,
        share: shareOf(x.value),
      })),
    ...(aside > 0
      ? [{ key: "SET", icon: { icon: "lock" as const, tone: "bg-cream text-forest", token: t.nav.commitments }, name: t.commitments.sSetAside, usd: p.setAside, share: shareOf(aside) }]
      : []),
  ];
  return (
    <Card className="flex flex-col overflow-hidden p-0!">
      <div className="px-7 pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">{aside > 0 ? t.overview.valueAll : t.overview.value}</p>
          <p className="text-sm text-faint">{t.overview.testAssets}</p>
        </div>
        <div className="mt-4">
          <BigMoney usd={String(whole)} currency={settings.currency} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Change pct={change} suffix={t.overview.today} />
          {aside > 0 ? (
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <Icon name="lock" size={14} />
              {t.overview.setAsideLine}: <span className="num font-semibold text-ink">{money(p.setAside, settings.currency)}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-8 mb-6 h-56">
          <ValueChart
            points={state.history.slice(-240)}
            settings={settings}
            t={t}
          />
        </div>
      </div>
      <ul
        className="mt-auto grid border-t border-line bg-paper/60"
        style={{
          gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
        }}
      >
        {rows.map((r, i) => (
          <li
            key={r.key}
            className={`${rows.length > 4 ? "px-3.5" : "px-5"} py-4 ${i ? "border-l border-line" : ""}`}
          >
            <span className="flex items-center gap-2.5">
              <span
                className={`${rows.length > 4 ? "hidden 2xl:flex" : "flex"} size-8 shrink-0 items-center justify-center rounded-full ${r.icon.tone}`}
              >
                <Icon name={r.icon.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {r.name}
                </span>
                <span className="block text-xs text-faint">{r.icon.token}</span>
              </span>
            </span>
            <span className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="num text-base font-semibold">
                {money(r.usd, settings.currency)}
              </span>
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
function MimoCard({
  state,
  mimo,
  onAck,
  openChat,
  t,
  canChat,
}: {
  canChat: boolean;
  state: AppState;
  mimo: MimoSay;
  onAck: () => void;
  openChat: () => void;
  t: Strings;
}) {
  const headline = t.mood.headline[mimo.mood].split("\n");
  const status = state.portfolio.agent.paused
    ? t.mood.chip.watching
    : mimo.status;
  return (
    <section
      className={`mood-${mimo.mood} relative flex flex-col overflow-hidden rounded-(--radius-card) bg-forest text-white shadow-[0_24px_48px_-28px_rgb(24_60_48/0.6)]`}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgb(255_255_255/0.08),transparent_60%)]"
      />
      <Icon
        name="sparkle"
        size={16}
        strokeWidth={1.4}
        className="absolute top-20 left-14 text-white/35"
      />
      <Icon
        name="sparkle"
        size={22}
        strokeWidth={1.2}
        className="absolute top-24 right-16 text-sun/70"
      />
      <Icon
        name="sparkle"
        size={12}
        strokeWidth={1.4}
        className="absolute top-52 left-24 text-white/30"
      />

      <div className="relative flex items-center justify-between px-6 pt-5">
        <p className="eyebrow flex items-center gap-2 text-white/75!">
          <span
            className="size-2 rounded-full"
            style={{
              background: mimo.mood === "calm" ? "#9fd3a8" : "var(--mood-line)",
            }}
          />
          {fill(t.overview.onWatch, { agent: BRAND.agent, status })}
        </p>
        <Icon name="shieldCheck" size={20} className="text-white/60" />
      </div>

      <div className="relative mx-auto mt-1 flex flex-col items-center">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-2xl transition-colors duration-500"
          style={{ background: "var(--mood-line)" }}
        />
        {/* a soft mint spotlight, so the green mascot stands off the forest-green card */}
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgb(214 240 214 / 0.42) 0%, rgb(214 240 214 / 0.16) 42%, transparent 68%)" }}
        />
        <div className="relative">
          <Mascot mood={mimo.mood} variant={mimo.variant} size={230} />
        </div>
        <span className="relative -mt-5 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm font-semibold text-ink shadow">
          <span
            className="size-2 rounded-full"
            style={{ background: "var(--mood)" }}
          />
          {t.mood.chip[mimo.mood]}
          {mimo.dismissKey ? (
            <button
              onClick={onAck}
              title={t.overview.gotIt}
              aria-label={t.overview.gotIt}
              className="-mr-1 ml-0.5 rounded-full p-0.5 text-muted hover:bg-cream hover:text-ink"
            >
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
        <p className="mx-auto mt-3 max-w-xs text-[0.92rem] leading-relaxed text-white/70">
          {mimo.line}
        </p>
      </div>

      {canChat ? (
        <button
          onClick={openChat}
          className="relative mt-auto flex items-center justify-between border-t border-white/12 px-6 py-4 text-left text-[0.95rem] font-semibold hover:bg-white/5"
        >
          {fill(t.overview.talk, { agent: BRAND.agent })}
          <Icon name="arrowUpRight" size={18} />
        </button>
      ) : (
        <span className="mt-auto" />
      )}
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
function BoundariesCard({
  state,
  settings,
  go,
  t,
}: {
  state: AppState;
  settings: Settings;
  go: (v: View) => void;
  t: Strings;
}) {
  const p = state.portfolio;
  const m = p.mandate;
  const lossFill =
    m.dailyLossPct > 0 ? Math.min(1, p.today.lossPct / m.dailyLossPct) : 0;
  const left = Math.max(0, m.dailyLossPct - p.today.lossPct);
  const allowed = p.positions.filter((x) => x.rule.allowed).length;
  const delayMin = Math.round(p.settings.loosenDelaySeconds / 60);
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">
          {t.overview.boundaries}
        </h3>
        <button
          onClick={() => go("mandate")}
          className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline"
        >
          {t.overview.viewMandate}
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="eyebrow">{t.overview.hacked}</p>
          <p className="num mt-3 font-display text-[2.6rem] leading-none font-semibold tracking-[-0.03em]">
            {money(p.agentExposure.maxCost, settings.currency)}
          </p>
          <p className="mt-2 text-sm text-muted">
            {t.overview.hackedLead}{" "}
            <span className="font-semibold text-leaf">
              {money(0, settings.currency)}
            </span>{" "}
            {t.overview.sendOutShort}
          </p>
        </div>
        <div>
          <p className="eyebrow">{t.overview.lossLimit}</p>
          <p className="mt-3 flex items-baseline gap-1">
            <span className="num font-display text-[2.6rem] leading-none font-semibold tracking-[-0.03em]">
              {p.today.lossPct.toFixed(1)}
            </span>
            <span className="num text-lg text-faint">/ {m.dailyLossPct}%</span>
          </p>
          {/* four segments, filled up to today's loss; amber once protect mode is on, never red or green for a loss */}
          <div className="mt-3 grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => {
              const part = Math.max(0, Math.min(1, lossFill * 4 - i));
              return (
                <div
                  key={i}
                  className="h-1.5 overflow-hidden rounded-full bg-cream"
                >
                  <div
                    className={`h-full rounded-full ${p.protect.active ? "bg-sun" : "bg-sage"}`}
                    style={{ width: `${part * 100}%` }}
                  />
                </div>
              );
            })}
          </div>
          <p
            className={`mt-2 text-sm ${p.protect.active ? "font-semibold text-sun-ink" : "text-muted"}`}
          >
            {p.protect.active
              ? t.overview.protectOn
              : fill(t.overview.beforeProtect, { n: left.toFixed(1) })}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {[
          [`${m.maxTradePct}%`, t.overview.perTrade],
          [String(allowed), t.overview.approvedAssets],
          [
            delayMin >= 1
              ? fill(t.overview.minutes, { n: delayMin })
              : fill(t.overview.seconds, { n: p.settings.loosenDelaySeconds }),
            t.overview.toLoosen,
          ],
        ].map(([v, l]) => (
          <span
            key={l}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted"
          >
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

/** The next commitments due, so investing sits next to what the money is already for. */
function ComingUpCard({ state, settings, go, t }: { state: AppState; settings: Settings; go: (v: View) => void; t: Strings }) {
  const now = new Date(state.portfolio.at);
  const next = state.portfolio.commitments
    .filter((c) => c.active && c.payee && c.nextDue)
    .sort((a, b) => new Date(a.nextDue!).getTime() - new Date(b.nextDue!).getTime())
    .slice(0, 3);
  return (
    <Card className="p-6!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.overview.comingUp}</h3>
        <button onClick={() => go("commitments")} className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
          {t.overview.comingUpAll}
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>
      {next.length ? (
        <ul className="mt-3 divide-y divide-line">
          {next.map((c) => {
            const meta = state.commitmentMeta[String(c.id)];
            const status = statusOf(c, now);
            const short = status.kind === "needs_funding";
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[0.95rem] font-semibold">{meta?.name ?? `#${c.id}`}</span>
                  <span className="num block text-xs text-muted">
                    {new Date(c.nextDue!).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short" })}
                  </span>
                </span>
                <span className="text-right">
                  <span className="num block font-semibold">{money(c.maxAmount, settings.currency)}</span>
                  <span className={`block text-xs font-semibold ${short ? "text-sun-ink" : "text-leaf"}`}>
                    {short ? fill(t.commitments.stShort, { amount: money(status.shortBy, settings.currency) }) : t.commitments.stReady}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{t.overview.comingUpNone}</p>
      )}
    </Card>
  );
}

function RecentCard({
  state,
  go,
  onOpen,
  t,
}: {
  state: AppState;
  go: (v: View) => void;
  onOpen: (r: Receipt) => void;
  t: Strings;
}) {
  const recent = state.receipts.slice(0, 3);
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">
          {t.overview.recent}
        </h3>
        <button
          onClick={() => go("activity")}
          className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline"
        >
          {t.overview.allActivity}
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="mt-5 text-[0.95rem] text-muted">
          {fill(t.overview.nothingYet, { agent: BRAND.agent })}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {recent.map((r) => {
            const [icon, tone] = OUTCOME_ICON[r.outcome];
            return (
              <li key={r.ref + r.at}>
                <button
                  onClick={() => onOpen(r)}
                  className="flex w-full items-center gap-3.5 py-4 text-left"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}
                  >
                    <Icon name={icon} size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.95rem] font-semibold">
                      {r.what}
                    </span>
                    <span
                      className={`mt-0.5 block text-sm ${OUTCOME_TEXT[r.outcome]}`}
                    >
                      {t.outcome[r.outcome]}
                    </span>
                  </span>
                  <span className="num shrink-0 pt-0.5 text-xs text-faint">
                    {clock(r.at)}
                  </span>
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
  return h >= 5 && h < 12
    ? "morning"
    : h >= 12 && h < 17
      ? "afternoon"
      : "evening";
}

export function OverviewHeader({
  settings,
  openPlan,
}: {
  settings: Settings;
  openPlan: () => void;
}) {
  const t = strings(settings.language, settings.role);
  const name = ownerName(settings.language);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <Icon
            name="sparkle"
            size={16}
            strokeWidth={1.6}
            className="text-sun"
          />
          {fill(t.overview[greetingKey(new Date())], { name })}
        </p>
        <h1 className="mt-3 font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
          {t.overview.title}{" "}
          <span className="accent">{t.overview.titleAccent}</span>
        </h1>
        <p className="mt-1.5 text-[1.05rem] text-muted">
          {fill(t.overview.subtitle, { agent: BRAND.agent })}
        </p>
      </div>
      <button
        onClick={openPlan}
        className="card-shadow flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] font-semibold hover:bg-paper"
      >
        <Icon name="sliders" size={18} />
        {t.plan.button}
        <Icon name="arrowUpRight" size={16} className="text-muted" />
      </button>
    </div>
  );
}

function ProofBar({
  state,
  settings,
  go,
  t,
}: {
  state: AppState;
  settings: Settings;
  go: (v: View) => void;
  t: Strings;
}) {
  const p = state.portfolio;
  const items: ReactNode[] = [
    <a
      key="chain"
      href={`${state.explorer}/address/${state.mandate}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 hover:text-ink"
    >
      {t.overview.onChain} {short(state.mandate)}
      <Icon name="arrowUpRight" size={12} />
    </a>,
    <span key="key">
      {p.agent.keyExpires
        ? fill(t.overview.keyUntil, {
            date: new Date(p.agent.keyExpires).toLocaleDateString(
              LOCALE[settings.language],
              { day: "numeric", month: "short", year: "numeric" },
            ),
          })
        : t.overview.noKeyShort}
    </span>,
    <button
      key="proof"
      onClick={() => go("proof")}
      className="flex items-center gap-1 font-semibold text-leaf hover:underline"
    >
      {t.overview.inspect}
      <Icon name="arrowUpRight" size={12} />
    </button>,
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p className="flex items-center gap-2">
        <Icon name="shieldCheck" size={16} className="text-leaf" />
        <span className="font-semibold text-ink">{t.overview.trust}</span>{" "}
        {t.overview.verify}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">{items}</div>
    </div>
  );
}

export function OverviewView({
  state,
  settings,
  mimo,
  onAck,
  go,
  openChat,
  onOpen, onSetup }: Props) {
  const t = strings(settings.language, settings.role);
  const p = state.portfolio;
  if (!p.mandateSigned) {
    return (
      <Card className="flex flex-wrap items-center gap-8 p-8!">
        <Mascot mood={mimo.mood} variant={mimo.variant} size={200} />
        <div className="max-w-xl">
          <h2 className="font-display text-3xl font-semibold">
            {t.overview.noMandate}
          </h2>
          <p className="mt-2 text-lg text-muted">
            {fill(t.overview.noMandateBody, { agent: BRAND.agent })}
          </p>
          {p.signableFrom ? (
            <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">
              {fill(t.overview.signableFrom, {
                time: new Date(p.signableFrom).toLocaleString(
                  LOCALE[settings.language],
                  {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                ),
              })}
            </p>
          ) : null}
          {settings.role === "owner" ? (
            <button
              onClick={onSetup ?? openChat}
              className="mt-5 rounded-xl bg-forest px-5 py-3 font-semibold text-white hover:bg-forest-soft"
            >
              {onSetup ? t.onboard.resume : fill(t.overview.talk, { agent: BRAND.agent })}
            </button>
          ) : null}
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
        <ValueCard state={state} settings={settings} t={t} />
        <MimoCard
          canChat={settings.role === "owner"}
          state={state}
          mimo={mimo}
          onAck={onAck}
          openChat={openChat}
          t={t}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
        <BoundariesCard state={state} settings={settings} go={go} t={t} />
        <div className="space-y-5">
          <ComingUpCard state={state} settings={settings} go={go} t={t} />
          <RecentCard state={state} go={go} onOpen={onOpen} t={t} />
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <ProofBar state={state} settings={settings} go={go} t={t} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- plan dialog

export const MIX_TONE: Record<AssetSymbol | "USD", string> = {
  USD: "bg-forest",
  IDX: "bg-sage",
  BOND: "bg-moss",
  GOLD: "bg-sun",
  MEME: "bg-coral",
};

/** The strategy the agent works toward, inside the mandate. Changing it goes through the chat. */
export function PlanDialog({
  state,
  settings,
  onClose,
  onChange,
}: {
  state: AppState;
  settings: Settings;
  onClose: () => void;
  onChange: (prompt: string) => void;
}) {
  const t = strings(settings.language, settings.role);
  const plan = state.plan;
  const names = ASSET_NAME[settings.language];
  const targets = (
    Object.entries(plan.targets) as [AssetSymbol, number][]
  ).filter(([, v]) => v > 0);
  const cash = Math.max(0, 100 - targets.reduce((a, [, v]) => a + v, 0));
  const mix: [AssetSymbol | "USD", string, number][] = [
    ...targets.map(
      ([k, v]) => [k, names[k], v] as [AssetSymbol, string, number],
    ),
    ["USD", t.plan.cashRest, cash],
  ];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.plan.eyebrow}
        className="slide-in w-full max-w-lg rounded-(--radius-card) bg-card p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.plan.eyebrow}</p>
          <button
            onClick={onClose}
            aria-label={t.plan.close}
            className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <h2 className="mt-2 font-serif text-[2rem] leading-tight">
          {fill(t.plan.title, { agent: BRAND.agent })}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {fill(t.plan.sub, { agent: BRAND.agent })}
        </p>

        <p className="mt-6 text-sm font-semibold">{t.plan.targets}</p>
        <div className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full">
          {mix.map(([k, , v]) => (
            <div key={k} className={MIX_TONE[k]} style={{ width: `${v}%` }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {mix.map(([k, label, v]) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${MIX_TONE[k]}`} />
              {label} <span className="num font-semibold">{v}%</span>
            </li>
          ))}
        </ul>

        <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">{t.plan.recurring}</dt>
            <dd className="text-right font-semibold">
              {plan.recurring.length
                ? plan.recurring.map((r) => (
                    <span key={r.symbol} className="block">
                      {fill(
                        r.everyHours === 24 ? t.plan.everyDay : t.plan.every,
                        {
                          amount: money(r.usd, settings.currency),
                          asset: names[r.symbol],
                          hours: r.everyHours,
                        },
                      )}
                    </span>
                  ))
                : t.plan.none}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">{t.plan.drift}</dt>
            <dd className="font-semibold">
              {fill(t.plan.driftValue, { n: plan.driftPct })}
            </dd>
          </div>
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <Icon
            name="shieldCheck"
            size={14}
            className="mt-0.5 shrink-0 text-leaf"
          />
          {t.plan.note}
        </p>
        {settings.role === "owner" ? (
          <button
            onClick={() => onChange(t.plan.changePrompt)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 font-semibold text-white hover:bg-forest-soft"
          >
            {fill(t.plan.change, { agent: BRAND.agent })}
            <Icon name="arrowUpRight" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
