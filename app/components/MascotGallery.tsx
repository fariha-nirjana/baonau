"use client";

import { useState } from "react";
import { Mascot } from "./Mascot";
import type { Mood, ShieldVariant } from "./types";
import { Card } from "./ui";

const STATES: [Mood, string][] = [
  ["calm", "Calm: the default"],
  ["thinking", "Thinking: the agent is working"],
  ["watching", "Watching: prices are moving"],
  ["worried", "Worried: a loss today"],
  ["warning", "Warning: protect mode or a stale price"],
  ["shield", "Shield up: a move was blocked"],
  ["holding", "Holding the line: a riskier rule is waiting"],
];

/**
 * One live player that can be pushed between states, so the intro, hold and
 * outro rules can be watched, plus a still of every state below it.
 */
export function MascotGallery() {
  const [mood, setMood] = useState<Mood>("calm");
  const [variant, setVariant] = useState<ShieldVariant>("code");
  return (
    <main className="dot-grid min-h-full p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="font-display text-4xl font-semibold">Mascot states</h1>
        <Card className="flex items-center gap-8">
          <Mascot mood={mood} variant={variant} size={260} />
          <div className="space-y-3">
            <p className="text-muted">Switch state. Alerts play their intro, hold until you switch away, then play the outro if they have one.</p>
            <div className="flex flex-wrap gap-2">
              {STATES.map(([m]) => (
                <button key={m} onClick={() => setMood(m)} className={`rounded-xl border px-3 py-1.5 font-semibold ${m === mood ? "border-forest bg-forest text-white" : "border-line bg-card"}`}>
                  {m}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["card", "chat", "code"] as ShieldVariant[]).map((v) => (
                <button key={v} onClick={() => setVariant(v)} className={`rounded-xl border px-3 py-1.5 text-sm font-semibold ${v === variant ? "border-coral bg-coral-soft text-coral" : "border-line bg-card"}`}>
                  shield hit by: {v}
                </button>
              ))}
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-4 gap-4">
          {STATES.map(([m, label]) => (
            <Card key={m} className="flex flex-col items-center p-4! text-center">
              <Mascot mood={m} size={150} />
              <p className="mt-2 text-sm font-semibold">{label}</p>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
