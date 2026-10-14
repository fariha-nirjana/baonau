"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnimationItem, LottiePlayer } from "lottie-web";
import { PRIORITY } from "./mimo";
import type { Mood, ShieldVariant } from "./types";

/**
 * The mascot, played from the graphics team's Lottie files in public/mascot/
 * by the rules in their handoff (MIMO_ANIMATIONS.md):
 * - calm, thinking, watching and worried loop;
 * - warning, shield and holding play an intro once, then loop a hold segment
 *   until the page stops asking for them. Shield and holding then play their
 *   outro, which ends on the calm pose. Nothing here ends an alert on a timer:
 *   the page decides when the situation is resolved;
 * - a higher-priority state interrupts at once; a lower one waits for a
 *   running intro to finish;
 * - loops are crossfaded (200 ms) because they do not share start poses;
 * - with reduced motion, each state is a still frame.
 * Small sizes use the static SVGs, so the sidebar and chat header do not run extra players.
 */

type Segments = { intro: [number, number]; hold: [number, number]; outro?: [number, number] };

const ALERTS: Partial<Record<Mood, Segments>> = {
  warning: { intro: [0, 40], hold: [40, 150] },
  shield: { intro: [0, 60], hold: [60, 150], outro: [150, 180] },
  holding: { intro: [0, 52], hold: [52, 142], outro: [142, 170] },
};

/** Static art per state, one SVG for each animation. */
const STILL: Record<Mood, string> = {
  calm: "calm",
  thinking: "thinking",
  watching: "watching",
  worried: "worried",
  warning: "warning",
  shield: "shield",
  holding: "holding",
};

const FADE_MS = 200;

type LottieFile = { layers: { nm: string; hd?: boolean }[] };

let player: Promise<LottiePlayer> | null = null;
const loadPlayer = () => (player ??= import("lottie-web/build/player/lottie_light").then((m) => m.default));

const files = new Map<Mood, Promise<LottieFile>>();
function loadFile(mood: Mood): Promise<LottieFile> {
  let file = files.get(mood);
  if (!file) {
    file = fetch(`/mascot/${mood}.json`).then((r) => {
      if (!r.ok) throw new Error(`mascot ${mood}: ${r.status}`);
      return r.json() as Promise<LottieFile>;
    });
    file.catch(() => files.delete(mood));
    files.set(mood, file);
  }
  return file;
}

/** The shield file holds three projectiles; only the one for this cause is shown. */
function withVariant(data: LottieFile, variant: ShieldVariant): LottieFile {
  const copy = structuredClone(data);
  for (const layer of copy.layers) {
    if (layer.nm.startsWith("projectile_")) layer.hd = layer.nm !== `projectile_${variant}`;
  }
  return copy;
}

type Shown = { mood: Mood; variant: ShieldVariant; anim: AnimationItem; layer: HTMLDivElement; phase: "loop" | "intro" | "hold" | "outro" | "done" };

function createMachine(container: HTMLDivElement, onFail: () => void) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let shown: Shown | null = null;
  let wanted: { mood: Mood; variant: ShieldVariant } | null = null;
  let loading = false;
  let dead = false;

  async function show(mood: Mood, variant: ShieldVariant) {
    loading = true;
    try {
      const [lottie, raw] = await Promise.all([loadPlayer(), loadFile(mood)]);
      if (dead) return;
      // the player changes the data it is given, so every animation gets its own copy
      const data = mood === "shield" ? withVariant(raw, variant) : structuredClone(raw);
      const layer = document.createElement("div");
      layer.style.cssText = `position:absolute;inset:0;opacity:0;transition:opacity ${FADE_MS}ms ease`;
      container.appendChild(layer);
      const seg = ALERTS[mood];
      const anim = lottie.loadAnimation({ container: layer, renderer: "svg", loop: !seg && !still, autoplay: false, animationData: data });
      const next: Shown = { mood, variant, anim, layer, phase: seg ? "intro" : "loop" };
      if (still) {
        anim.goToAndStop(seg ? seg.hold[0] : 0, true);
        next.phase = seg ? "hold" : "loop";
      } else if (seg) {
        anim.playSegments(seg.intro, true);
      } else {
        anim.play();
      }
      anim.addEventListener("complete", () => onComplete(next));
      const old = shown;
      shown = next;
      requestAnimationFrame(() => {
        layer.style.opacity = "1";
        if (old) old.layer.style.opacity = "0";
      });
      if (old) {
        setTimeout(() => {
          old.anim.destroy();
          old.layer.remove();
        }, FADE_MS + 40);
      }
    } catch {
      dead = true;
      onFail();
      return;
    } finally {
      loading = false;
    }
    decide();
  }

  function onComplete(item: Shown) {
    if (item !== shown || dead) return;
    const seg = ALERTS[item.mood];
    if (!seg) return;
    if (item.phase === "intro" || item.phase === "hold") {
      item.phase = "hold";
      item.anim.playSegments(seg.hold, true);
      decide();
    } else if (item.phase === "outro") {
      // the outro rests on the calm pose, so the next state starts without a jump
      item.phase = "done";
      decide();
    }
  }

  function decide() {
    if (dead || loading || !wanted) return;
    if (!shown || shown.phase === "done") return void show(wanted.mood, wanted.variant);
    if (shown.phase === "outro") return;
    if (shown.mood === wanted.mood && (shown.mood !== "shield" || shown.variant === wanted.variant)) return;
    const rank = PRIORITY[wanted.mood] - PRIORITY[shown.mood];
    if (rank >= 0 || still) return void show(wanted.mood, wanted.variant);
    // a lower state waits for a running intro to finish
    if (shown.phase === "intro") return;
    const outro = ALERTS[shown.mood]?.outro;
    if (outro) {
      shown.phase = "outro";
      shown.anim.playSegments(outro, true);
      return;
    }
    show(wanted.mood, wanted.variant);
  }

  return {
    want(mood: Mood, variant: ShieldVariant) {
      wanted = { mood, variant };
      decide();
    },
    destroy() {
      dead = true;
      shown?.anim.destroy();
      container.replaceChildren();
    },
  };
}

function AnimatedMascot({ mood, variant, size }: { mood: Mood; variant: ShieldVariant; size: number }) {
  const box = useRef<HTMLDivElement>(null);
  const machine = useRef<ReturnType<typeof createMachine> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = createMachine(box.current, () => setFailed(true));
    machine.current = m;
    return () => {
      m.destroy();
      machine.current = null;
    };
  }, []);

  useEffect(() => {
    machine.current?.want(mood, variant);
  }, [mood, variant]);

  if (failed) return <StillMascot mood={mood} size={size} />;
  return <div ref={box} aria-hidden style={{ width: size, height: size, position: "relative" }} />;
}

function StillMascot({ mood, size }: { mood: Mood; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/mascot/${STILL[mood]}.svg`} alt="" width={size} height={size} />;
}

export function Mascot({ mood, variant = "code", size = 150, still = false }: { mood: Mood; variant?: ShieldVariant; size?: number; still?: boolean }) {
  if (still || size < 80) return <StillMascot mood={mood} size={size} />;
  return <AnimatedMascot mood={mood} variant={variant} size={size} />;
}

/** The full-body Mimo waving, for good news and empty states. Same 512 x 512 canvas as the other stills. */
export function HappyMascot({ size = 150 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/mascot/happy.svg" alt="" width={size} height={size} />;
}

// ---------------------------------------------------------------- head-only avatars

/** The head-only faces from the graphics team, readable down to 32 px. */
export type Face = "calm" | "happy" | "thinking" | "worried" | "alert" | "determined";

/** Which face goes with which state, from the graphics handoff. */
export function faceOf(mood: Mood): Face {
  switch (mood) {
    case "thinking":
      return "thinking";
    case "worried":
      return "worried";
    case "warning":
      return "alert";
    case "shield":
    case "holding":
      return "determined";
    default:
      return "calm";
  }
}

const FACE_FADE_MS = 150;

/**
 * Mimo's head, cross-faded (150 ms) when the face changes. The square art keeps the
 * head inside a circle, so it sits in any round or rounded frame.
 */
export function Avatar({ face, size }: { face: Face; size: number }) {
  const [shown, setShown] = useState(face);
  const [leaving, setLeaving] = useState<Face | null>(null);
  if (face !== shown) {
    // adjusting state from a prop while rendering, as React recommends instead of an effect
    setLeaving(shown);
    setShown(face);
  }
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setLeaving(null), FACE_FADE_MS);
    return () => clearTimeout(id);
  }, [leaving]);
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size }}>
      {leaving ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`out-${leaving}`} src={`/mascot/avatar-${leaving}.svg`} alt="" width={size} height={size} className="face-out absolute inset-0" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={`in-${shown}`} src={`/mascot/avatar-${shown}.svg`} alt="" width={size} height={size} className={`absolute inset-0 ${leaving ? "face-in" : ""}`} />
    </span>
  );
}

/** The soft green rounded tile the prototype puts Mimo in. */
export function MimoTile({ size, children, className = "" }: { size: number; children: ReactNode; className?: string }) {
  return (
    <span className={`mimo-tile relative grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.34) }}>
      {children}
    </span>
  );
}
