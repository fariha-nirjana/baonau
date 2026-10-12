import { USD_SYMBOL } from "./config";

/**
 * Display currencies. The vault only ever holds tUSD; these are fixed demo
 * rates for showing amounts in the investor's own currency, not market rates.
 */
export const CURRENCIES = {
  BDT: { sign: "৳", perUsd: 122, decimals: 0 },
  CNY: { sign: "¥", perUsd: 7.1, decimals: 2 },
  USD: { sign: "$", perUsd: 1, decimals: 2 },
} as const;

export type Currency = keyof typeof CURRENCIES;
export const DEFAULT_CURRENCY: Currency = "BDT";

export function isCurrency(value: string): value is Currency {
  return value in CURRENCIES;
}

export function rateNote(currency: Currency): string {
  const c = CURRENCIES[currency];
  return currency === "USD" ? "1 tUSD shown as $1" : `demo rate ${c.sign}${c.perUsd} = 1 ${USD_SYMBOL}`;
}

/** Converts an amount typed in a display currency into tUSD, rounded down to the token's six decimals. */
export function toUsd(amount: number, currency: Currency | typeof USD_SYMBOL): string {
  const usd = currency === USD_SYMBOL ? amount : amount / CURRENCIES[currency].perUsd;
  return (Math.floor(usd * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "");
}

const trim = (n: number, decimals: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** "৳5,000 (≈ 40.98 tUSD)": the investor's currency first, the token amount next to it. */
export function display(usd: string | number, currency: Currency = DEFAULT_CURRENCY): string {
  const value = Number(usd);
  const c = CURRENCIES[currency];
  return `${c.sign}${trim(value * c.perUsd, c.decimals)} (≈ ${trim(value, 2)} ${USD_SYMBOL})`;
}
