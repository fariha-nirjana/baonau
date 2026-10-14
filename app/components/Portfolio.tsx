"use client";

import { Fragment, useEffect, useState } from "react";
import type { AssetSymbol } from "@/lib/assets";
import { BRAND } from "@/lib/brand";
import { fill, LOCALE, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { ASSET, ASSET_NAME, MIX_TONE, money } from "./Overview";
import type { AppState, Settings } from "./types";
import { Card } from "./ui";

type Row = { key: AssetSymbol | "USD"; name: string; usd: string; share: number; target: number | null };

/** Current mix next to the plan's targets. Cash is whatever the plan leaves over. */
function rowsOf(state: AppState, settings: Settings): Row[] {
  const p = state.portfolio;
  const t = strings(settings.language);
  const targets = state.plan.targets;
  const planned = Object.values(targets).reduce((a, v) => a + (v ?? 0), 0);
  return [
    { key: "USD", name: t.overview.cash, usd: p.cash, share: p.cashSharePct, target: Math.max(0, 100 - planned) },
    ...p.positions
      .filter((x) => x.rule.allowed || Number(x.amount) > 0)
      .map((x) => ({ key: x.symbol, name: ASSET_NAME[settings.language][x.symbol], usd: x.value, share: x.sharePct, target: targets[x.symbol] ?? null })),
  ];
}

// ---------------------------------------------------------------- donut

function Donut({ rows, total, t }: { rows: Row[]; total: string; t: Strings }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const gap = 1.5;
  const parts = rows.filter((x) => x.share > 0);
  // where each segment starts, as a running total of the ones before it
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((a, x) => a + (x.share / 100) * c, 0));
  return (
    <div className="relative mx-auto size-60">
      <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-hidden>
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-cream)" strokeWidth="16" />
        {parts.map((x, i) => {
            const len = (x.share / 100) * c;
            return (
              <circle
                key={x.key}
                cx="90"
                cy="90"
                r={r}
                fill="none"
                strokeWidth="16"
                stroke={`var(--color-${MIX_TONE[x.key].slice(3)})`}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-starts[i]}
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="eyebrow">{t.holdings.total}</p>
        <p className="num mt-1 font-display text-3xl font-semibold tracking-[-0.03em]">{total}</p>
      </div>
    </div>
  );
}

function MixCard({ state, settings, t }: { state: AppState; settings: Settings; t: Strings }) {
  const rows = rowsOf(state, settings);
  return (
    <Card className="p-7!">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{t.holdings.mix}</h3>
        <p className="text-sm text-faint">{t.holdings.nowVsPlan}</p>
      </div>
      <div className="mt-6 grid items-center gap-8 sm:grid-cols-[15rem_1fr]">
        <Donut rows={rows} total={money(state.portfolio.totalValue, settings.currency)} t={t} />
        <ul className="space-y-3.5">
          {rows.map((x) => {
            const off = x.target === null ? 0 : Math.round((x.share - x.target) * 10) / 10;
            const drifted = Math.abs(off) > state.plan.driftPct;
            return (
              <li key={x.key} className="flex items-center gap-3">
                <span className={`size-3 shrink-0 rounded-full ${MIX_TONE[x.key]}`} />
                <span className="min-w-0 flex-1 text-[0.95rem] font-semibold whitespace-nowrap">{x.name}</span>
                <span className="num text-[0.95rem] font-semibold">{Math.round(x.share)}%</span>
                <span className="num w-16 text-right text-sm text-faint">/ {x.target ?? 0}%</span>
                <span className={`w-32 text-right text-xs ${drifted ? "font-semibold text-sun-ink" : "text-muted"}`}>
                  {Math.abs(off) < 1 ? t.holdings.onPlan : fill(t.holdings.offPlan, { n: `${off > 0 ? "+" : "−"}${Math.abs(Math.round(off))}` })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- instructions

function InstructionsCard({ state, settings, t, onPreview }: { state: AppState; settings: Settings; t: Strings; onPreview: () => void }) {
  const p = state.portfolio;
  const plan = state.plan;
  const buy = plan.recurring[0];
  const headline = t.holdings.headline.split("\n");
  const next = buy?.lastRunAt ? new Date(new Date(buy.lastRunAt).getTime() + buy.everyHours * 3600_000) : null;
  const rows: [string, string][] = [
    [t.holdings.nextBuy, !buy ? t.plan.none : next ? next.toLocaleString(LOCALE[settings.language], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : t.holdings.nextBuySoon],
    [fill(t.holdings.authority, { agent: BRAND.agent }), t.holdings.authorityValue],
    [t.holdings.moneyOut, t.holdings.moneyOutValue],
  ];
  return (
    <Card className="flex flex-col p-7!">
      <p className="eyebrow">{t.holdings.inAction}</p>
      <h3 className="mt-4 font-serif text-[2rem] leading-[1.15]">
        {headline.map((l, i) => (
          <Fragment key={i}>
            {l}
            {i < headline.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </h3>
      <p className="mt-3 max-w-lg text-[0.95rem] leading-relaxed text-muted">
        {fill(buy ? t.holdings.body : t.holdings.bodyNoBuy, { agent: BRAND.agent, amount: buy ? money(buy.usd, settings.currency) : "", drift: plan.driftPct, loss: p.mandate.dailyLossPct })}
      </p>
      <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <button onClick={onPreview} className="mt-6 flex w-fit items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft">
        {t.holdings.preview}
        <Icon name="arrowUpRight" size={15} />
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------- holdings list

function HoldingsList({ state, settings, t }: { state: AppState; settings: Settings; t: Strings }) {
  const p = state.portfolio;
  const rows = rowsOf(state, settings);
  return (
    <Card className="p-7!">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{t.holdings.listTitle}</h3>
          <p className="mt-0.5 text-sm text-muted">{t.holdings.listSub}</p>
        </div>
        <p className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-1 rounded bg-ink" />
            {t.holdings.capKey}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-ink/40" />
            {t.holdings.targetKey}
          </span>
        </p>
      </div>
      <ul className="mt-5 divide-y divide-line">
        {rows.map((x) => {
          const pos = x.key === "USD" ? null : p.positions.find((y) => y.symbol === x.key);
          const cap = pos?.rule.allowed ? pos.rule.maxExposurePct : null;
          const scale = (n: number) => `${Math.min(100, n)}%`;
          return (
            <li key={x.key} className="grid items-center gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_15rem]">
              <div className="flex items-center gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${ASSET[x.key].tone}`}>
                  <Icon name={ASSET[x.key].icon} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold">
                    {x.name}
                    {pos?.rule.defensive || x.key === "USD" ? <span className="rounded-md bg-mint px-1.5 py-0.5 text-xs font-semibold text-leaf">{t.holdings.defensive}</span> : null}
                    {pos && !pos.rule.allowed ? <span className="rounded-md bg-coral-soft px-1.5 py-0.5 text-xs font-semibold text-coral">{t.holdings.notAllowed}</span> : null}
                  </p>
                  <p className="text-xs text-faint">
                    {ASSET[x.key].token} · {x.key === "USD" ? t.holdings.cashNote : t.holdings.testLabel}
                  </p>
                </div>
              </div>
              <div>
                <div className="relative h-2 rounded-full bg-cream">
                  <div className={`h-2 rounded-full ${MIX_TONE[x.key]}`} style={{ width: scale(x.share) }} />
                  {x.target !== null ? <div className="absolute -top-1 h-4 w-0.5 bg-ink/40" style={{ left: scale(x.target) }} /> : null}
                  {cap !== null ? <div className="absolute -top-1.5 h-5 w-1 rounded bg-ink" style={{ left: scale(cap) }} /> : null}
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {fill(t.holdings.ofPortfolio, { n: Math.round(x.share * 10) / 10 })}
                  {cap !== null ? ` · ${t.holdings.capKey} ${cap}%` : ""}
                  {x.target !== null ? ` · ${t.holdings.targetKey} ${x.target}%` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="num text-lg font-semibold">{money(x.usd, settings.currency)}</p>
                {pos ? (
                  <p className="text-xs text-muted">
                    {fill(t.holdings.price, { price: Number(pos.price).toLocaleString("en-US", { maximumFractionDigits: 2 }) })} ·{" "}
                    {pos.rule.stopPrice ? fill(t.holdings.stop, { stop: Number(pos.rule.stopPrice).toLocaleString("en-US", { maximumFractionDigits: 2 }) }) : t.holdings.noStop}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- rebalance preview

/** What a rebalance would do, worked out from the shares on screen. The agent still decides and the rules still apply. */
function PreviewDialog({ state, settings, t, onClose, onAsk }: { state: AppState; settings: Settings; t: Strings; onClose: () => void; onAsk: (prompt: string) => void }) {
  const drift = state.plan.driftPct;
  const off = rowsOf(state, settings).filter((x) => x.target !== null && Math.abs(x.share - (x.target ?? 0)) > drift);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t.holdings.previewEyebrow} className="slide-in w-full max-w-lg rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.holdings.previewEyebrow}</p>
          <button onClick={onClose} aria-label={t.holdings.close} className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
            <Icon name="close" size={18} />
          </button>
        </div>
        <h2 className="mt-2 font-serif text-[2rem] leading-tight">{off.length ? t.holdings.someTitle : t.holdings.noneTitle}</h2>
        <p className="mt-2 text-sm text-muted">{fill(off.length ? t.holdings.someBody : t.holdings.noneBody, { drift, agent: BRAND.agent })}</p>
        {off.length ? (
          <ul className="mt-5 divide-y divide-line border-y border-line text-sm">
            {off.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-4 py-3">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={`size-2.5 rounded-full ${MIX_TONE[x.key]}`} />
                  {x.name}
                </span>
                <span className="text-muted">{fill(x.share < (x.target ?? 0) ? t.holdings.buyMore : t.holdings.sellSome, { now: Math.round(x.share), plan: x.target ?? 0 })}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {off.length ? (
          <button onClick={() => onAsk(t.holdings.askPrompt)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 font-semibold text-white hover:bg-forest-soft">
            {fill(t.holdings.ask, { agent: BRAND.agent })}
            <Icon name="arrowUpRight" size={16} />
          </button>
        ) : (
          <button onClick={onClose} className="mt-6 w-full rounded-xl border border-line px-4 py-3 font-semibold hover:bg-paper">
            {t.holdings.close}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function PortfolioHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.holdings.title} <span className="accent">{t.holdings.titleAccent}</span>
      </h1>
      <p className="mt-1.5 text-[1.05rem] text-muted">{t.holdings.sub}</p>
    </div>
  );
}

export function PortfolioView({ state, settings, onAsk }: { state: AppState; settings: Settings; onAsk: (prompt: string) => void }) {
  const t = strings(settings.language);
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <MixCard state={state} settings={settings} t={t} />
        <InstructionsCard state={state} settings={settings} t={t} onPreview={() => setPreview(true)} />
      </div>
      <HoldingsList state={state} settings={settings} t={t} />
      {preview ? (
        <PreviewDialog
          state={state}
          settings={settings}
          t={t}
          onClose={() => setPreview(false)}
          onAsk={(prompt) => {
            setPreview(false);
            onAsk(prompt);
          }}
        />
      ) : null}
    </div>
  );
}
