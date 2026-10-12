import type { Mood } from "./types";

/**
 * The mascot slot. The real art (four moods, a shield and a lock animation)
 * is being made; until it arrives this draws a stand-in. To use the real
 * files, put them in public/mascot/ and list them here. Nothing else changes.
 */
const ART: Record<Mood, string | null> = { calm: null, watching: null, warning: null, shield: null };

export function Mascot({ mood, size = 150 }: { mood: Mood; size?: number }) {
  const art = ART[mood];
  if (art) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={art} alt="" width={size} height={size} className={mood === "shield" ? "shield-slam" : ""} />;
  }
  const eyes = mood === "watching" ? 3.2 : mood === "shield" ? 1.4 : 2.6;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden className={`mood-${mood} ${mood === "shield" ? "shield-slam" : ""}`}>
      <ellipse cx="60" cy="104" rx="38" ry="9" fill="var(--color-sun)" />
      <path d="M18 78 C18 38 36 16 60 16 C84 16 102 38 102 78 C102 96 84 104 60 104 C36 104 18 96 18 78 Z" fill="var(--color-forest)" />
      <circle cx="33" cy="26" r="9" fill="var(--color-forest)" />
      <circle cx="87" cy="26" r="9" fill="var(--color-forest)" />
      <ellipse cx="60" cy="62" rx="31" ry="27" fill="#fbf7ee" />
      <ellipse cx="48" cy="58" rx={2.6} ry={eyes} fill="var(--color-ink)" />
      <ellipse cx="72" cy="58" rx={2.6} ry={eyes} fill="var(--color-ink)" />
      <ellipse cx="41" cy="67" rx="4.5" ry="2.6" fill="var(--color-coral)" opacity="0.45" />
      <ellipse cx="79" cy="67" rx="4.5" ry="2.6" fill="var(--color-coral)" opacity="0.45" />
      {mood === "warning" || mood === "shield" ? (
        <path d="M53 71 H67" stroke="var(--color-ink)" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M54 69 Q60 74 66 69" stroke="var(--color-ink)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      )}
      {/* the lock on the belly; it turns into a shield when an attack is blocked */}
      {mood === "shield" ? (
        <path d="M60 80 L73 85 V93 C73 100 67 104 60 107 C53 104 47 100 47 93 V85 Z" fill="var(--mood)" stroke="#fff" strokeWidth="2.5" />
      ) : (
        <g>
          <rect x="50" y="88" width="20" height="16" rx="4" fill="var(--mood)" stroke="#fff" strokeWidth="2.5" />
          <path d="M55 88 V84 a5 5 0 0 1 10 0 V88" stroke="#fff" strokeWidth="2.5" fill="none" />
        </g>
      )}
    </svg>
  );
}
