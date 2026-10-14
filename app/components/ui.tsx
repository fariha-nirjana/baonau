"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CURRENCIES, type Currency } from "@/lib/money";
import { Icon, type IconName } from "./icons";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card-shadow rounded-(--radius-card) border border-line bg-card p-6 ${className}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{children}</p>;
}

const TONES = {
  good: "bg-mint text-leaf",
  warn: "bg-sun-soft text-sun-ink",
  bad: "bg-coral-soft text-coral",
  info: "bg-sky-soft text-sky",
  plain: "bg-cream text-muted",
} as const;

export type Tone = keyof typeof TONES;

export function Chip({ tone = "plain", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${TONES[tone]}`}>
      {icon ? <Icon name={icon} size={14} strokeWidth={2.4} /> : null}
      {children}
    </span>
  );
}

const BUTTONS = {
  primary: "bg-leaf text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.18)] hover:bg-forest-soft",
  dark: "bg-forest text-white hover:bg-forest-soft",
  alarm: "bg-alarm text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.2)] hover:brightness-110",
  ghost: "border border-line bg-card text-ink hover:bg-cream",
  danger: "border border-coral/40 bg-card text-coral hover:bg-coral-soft",
} as const;

export function Button({
  kind = "primary",
  busy,
  children,
  ...rest
}: { kind?: keyof typeof BUTTONS; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTONS[kind]} ${rest.className ?? ""}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

const trim = (n: number, decimals: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** The investor's currency as the main number, with the tUSD amount beside it. */
export function Money({ usd, currency, size = "base" }: { usd: string | number; currency: Currency; size?: "base" | "lg" | "xl" }) {
  const c = CURRENCIES[currency];
  const value = Number(usd);
  const main = { base: "text-lg font-semibold", lg: "text-3xl font-semibold", xl: "text-6xl font-bold" }[size];
  return (
    <span className="num inline-flex flex-wrap items-baseline gap-x-2">
      <span className={main}>
        {c.sign}
        {trim(value * c.perUsd, c.decimals)}
      </span>
      {currency !== "USD" || size !== "base" ? <span className="text-sm font-medium text-muted">≈ {trim(value, 2)} tUSD</span> : null}
    </span>
  );
}

export function moneyText(usd: string | number, currency: Currency) {
  const c = CURRENCIES[currency];
  return `${c.sign}${trim(Number(usd) * c.perUsd, c.decimals)}`;
}

/** A small area chart of the portfolio value as the app has read it. Draws nothing with fewer than two readings. */
export function Sparkline({ points, height = 120 }: { points: { at: string; value: number }[]; height?: number }) {
  if (points.length < 2) return null;
  const w = 600;
  const values = points.map((p) => p.value);
  // the vertical range is at least 3% of the value, so a small wobble looks small
  const mid = (Math.min(...values) + Math.max(...values)) / 2;
  const half = Math.max(((Math.max(...values) - Math.min(...values)) / 2) * 1.15, Math.abs(mid) * 0.015, 1e-9);
  const lo = mid - half;
  const hi = mid + half;
  const pad = 0;
  const t0 = new Date(points[0].at).getTime();
  const span = new Date(points[points.length - 1].at).getTime() - t0 || 1;
  const xy = points.map((p) => [((new Date(p.at).getTime() - t0) / span) * w, height - ((p.value - lo + pad) / (hi - lo + 2 * pad)) * height] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-leaf)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--color-leaf)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="var(--color-leaf)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** A bar with an optional marker for a cap and a tick for a target. All in percent of the track. */
export function Bar({ value, cap, target, tone = "leaf" }: { value: number; cap?: number; target?: number; tone?: "leaf" | "coral" | "sun" }) {
  const fill = { leaf: "bg-leaf", coral: "bg-coral", sun: "bg-sun" }[tone];
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  return (
    <div className="relative h-2.5 w-full rounded-full bg-cream">
      <div className={`h-2.5 rounded-full transition-[width] duration-700 ${fill}`} style={{ width: pct(value) }} />
      {target !== undefined ? <div className="absolute -top-1 h-5 w-0.5 bg-ink/40" style={{ left: pct(target) }} title="Plan target" /> : null}
      {cap !== undefined ? <div className="absolute -top-1.5 h-6 w-1 rounded bg-ink" style={{ left: pct(cap) }} title="Mandate cap" /> : null}
    </div>
  );
}

/**
 * Whole seconds left until `iso`, counted on the chain's clock, or null once it has passed.
 * @param skewMs this device's clock minus the chain's
 */
export function useSecondsLeft(iso: string | null | undefined, skewMs: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const left = Math.round((new Date(iso).getTime() - (now - skewMs)) / 1000);
  return left > 0 ? left : null;
}

/**
 * Time left until `iso` as "1 min 20 s", or null once it has passed.
 * @param skewMs this device's clock minus the chain's, so waits are counted on the chain's clock
 */
export function useCountdown(iso: string | null | undefined, skewMs: number): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const left = Math.round((new Date(iso).getTime() - (now - skewMs)) / 1000);
  if (left <= 0) return null;
  if (left < 90) return `${left} s`;
  if (left < 5400) return `${Math.floor(left / 60)} min ${left % 60} s`;
  if (left < 172800) return `${Math.floor(left / 3600)} h ${Math.floor((left % 3600) / 60)} min`;
  return `${Math.floor(left / 86400)} days`;
}

export const shortTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
