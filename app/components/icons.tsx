/**
 * Line icons drawn on a 24 px grid (shapes in the style of the open Lucide set,
 * redrawn here so the app needs no icon package).
 */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  mandate: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  approvals: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.5l2.5 2.5 4.5-5",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  proof: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z",
  shieldCheck: "M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10zM8.5 12l2.5 2.5 4.5-5",
  pause: "M9 5v14M15 5v14",
  play: "M7 4v16l13-8z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  coins: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2",
  chart: "M3 17l6-6 4 4 8-8M15 7h6v6",
  chartDown: "M3 7l6 6 4-4 8 8M15 17h6v-6",
  gem: "M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z",
  bond: "M4 7h16v12H4zM4 11h16M8 3v4M16 3v4",
  gold: "M3 18h18l-3-7H6zM8 11l2-5h4l2 5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 3 2 20h20zM12 9v5M12 17.5v.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5",
  chevron: "M6 9l6 6 6-6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  arrowUpRight: "M7 17 17 7M8 7h9v9",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  wallet: "M4 6a2 2 0 0 1 2-2h12v4M4 6v12a2 2 0 0 0 2 2h14V8H6a2 2 0 0 1-2-2zM16 14h.01",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  close: "M6 6l12 12M18 6 6 18",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  sliders: "M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  sparkle: "M12 3c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c0 1 2.7 3 6 3s6-2 6-3v-5M22 9v6",
  heart: "M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.5-9 9-9 9z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}
