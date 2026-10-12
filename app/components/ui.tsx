"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CURRENCIES, type Currency } from "@/lib/money";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-(--radius-card) border border-line bg-card p-7 ${className}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">{children}</p>;
}

const TONES = {
  good: "bg-mint text-leaf",
  warn: "bg-sun-soft text-sun-ink",
  bad: "bg-coral-soft text-coral",
  info: "bg-sky-soft text-sky",
  plain: "bg-cream text-muted",
} as const;

export function Chip({ tone = "plain", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${TONES[tone]}`}>{children}</span>;
}

const BUTTONS = {
  primary: "bg-forest text-white hover:bg-forest-soft",
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
      className={`rounded-xl px-4 py-2.5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTONS[kind]} ${rest.className ?? ""}`}
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
  const main = { base: "text-lg font-semibold", lg: "text-3xl font-semibold", xl: "text-6xl font-semibold" }[size];
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

/** A bar with an optional marker for a cap and a tick for a target. All in percent of the track. */
export function Bar({ value, cap, target, tone = "leaf" }: { value: number; cap?: number; target?: number; tone?: "leaf" | "coral" | "sun" }) {
  const fill = { leaf: "bg-leaf", coral: "bg-coral", sun: "bg-sun" }[tone];
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  return (
    <div className="relative h-3 w-full rounded-full bg-cream">
      <div className={`h-3 rounded-full transition-[width] duration-700 ${fill}`} style={{ width: pct(value) }} />
      {target !== undefined ? <div className="absolute -top-1 h-5 w-0.5 bg-ink/40" style={{ left: pct(target) }} title="Plan target" /> : null}
      {cap !== undefined ? <div className="absolute -top-1.5 h-6 w-1 rounded bg-ink" style={{ left: pct(cap) }} title="Mandate cap" /> : null}
    </div>
  );
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
