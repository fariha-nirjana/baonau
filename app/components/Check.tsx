"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { fill, formatLeft, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { Avatar, MimoTile } from "./Mascot";
import { money } from "./Overview";
import type { Settings } from "./types";

/** The terms the questions are built from: the draft's own numbers, never the model's. */
export type CheckTerms = { maxTradePct: number; maxDailyVolumePct: number; dailyLossPct: number; waitSeconds: number; valueUsd: number };

type Question = { ask: string; options: string[]; correct: number; explain: string };

/**
 * The questions and their right answers are worked out here, by fixed rules,
 * from the mandate about to be signed. The AI never decides whether someone
 * passed. The right answer's position is fixed per question so it is not
 * always the first.
 */
export function questionsOf(terms: CheckTerms, settings: Settings, t: Strings): Question[] {
  const agent = BRAND.agent;
  const m = (usd: number) => money(usd, settings.currency);
  const value = m(terms.valueUsd);
  const perTrade = terms.valueUsd * (terms.maxTradePct / 100);
  // a wrong amount that is never equal to the right one
  const volume = terms.maxDailyVolumePct > terms.maxTradePct ? terms.valueUsd * (terms.maxDailyVolumePct / 100) : perTrade * 2;
  const wait = formatLeft(terms.waitSeconds, t);
  const place = <T,>(right: T, wrong: T[], at: number): [T[], number] => {
    const list = [...wrong];
    list.splice(at, 0, right);
    return [list, at];
  };
  const [o1, c1] = place(m(perTrade), [m(volume), value], 1);
  const [o2, c2] = place(fill(t.check.q2a, { agent }), [fill(t.check.q2b, { agent }), fill(t.check.q2c, { agent })], 0);
  const [o3, c3] = place(fill(t.check.q3a, { wait }), [fill(t.check.q3b, { agent }), fill(t.check.q3c, { agent })], 2);
  const [o4, c4] = place(fill(t.check.q4a, { agent }), [fill(t.check.q4b, { agent }), fill(t.check.q4c, { agent })], 1);
  return [
    { ask: fill(t.check.q1, { value, agent }), options: o1, correct: c1, explain: fill(t.check.e1, { pct: terms.maxTradePct, value, amount: m(perTrade) }) },
    { ask: fill(t.check.q2, { loss: terms.dailyLossPct, agent }), options: o2, correct: c2, explain: t.check.e2 },
    { ask: t.check.q3, options: o3, correct: c3, explain: t.check.e3 },
    { ask: fill(t.check.q4, { agent }), options: o4, correct: c4, explain: fill(t.check.e4, { agent }) },
  ];
}

export function UnderstandingCheck({ terms, settings, onPass, onClose }: { terms: CheckTerms; settings: Settings; onPass: () => void; onClose: () => void }) {
  const t = strings(settings.language, settings.role);
  const questions = questionsOf(terms, settings, t);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const done = at >= questions.length;
  const q = questions[Math.min(at, questions.length - 1)];
  const right = picked !== null && picked === q.correct;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t.check.eyebrow} className="slide-in w-full max-w-xl rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.check.eyebrow}</p>
          <button onClick={onClose} aria-label={t.check.close} className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
            <Icon name="close" size={18} />
          </button>
        </div>

        {done ? (
          <div className="mt-4 text-center">
            <div className="mx-auto w-fit">
              <MimoTile size={84}>
                <Avatar face="happy" size={78} />
              </MimoTile>
            </div>
            <h2 className="mt-4 font-serif text-[1.8rem] leading-tight">{t.check.done}</h2>
            <p className="mx-auto mt-2 max-w-sm text-xs text-muted">{t.check.doneNote}</p>
            <button onClick={onClose} className="mt-6 rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft">
              {t.check.finish}
            </button>
          </div>
        ) : (
          <>
            {at === 0 && picked === null ? (
              <>
                <h2 className="mt-2 font-serif text-[1.7rem] leading-tight">{t.check.title}</h2>
                <p className="mt-1 text-sm text-muted">{fill(t.check.sub, { agent: BRAND.agent })}</p>
              </>
            ) : null}
            <div className="mt-5 flex items-center gap-2">
              {questions.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i < at ? "bg-leaf" : i === at ? "bg-sage" : "bg-cream"}`} />
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-faint">{fill(t.check.progress, { n: at + 1, total: questions.length })}</p>
            <p className="mt-1 text-[1.1rem] font-semibold">{q.ask}</p>
            <div className="mt-4 space-y-2">
              {q.options.map((o, i) => {
                const chosen = picked === i;
                const tone = !chosen ? "border-line hover:border-sage" : right ? "border-leaf bg-mint/60" : "border-sun bg-sun-soft/70";
                return (
                  <button key={o} disabled={right} onClick={() => setPicked(i)} className={`num flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[0.95rem] transition-colors ${tone}`}>
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${chosen ? (right ? "border-leaf bg-leaf text-white" : "border-sun-ink text-sun-ink") : "border-line"}`}>
                      {chosen ? <Icon name={right ? "check" : "x"} size={11} strokeWidth={3} /> : null}
                    </span>
                    {o}
                  </button>
                );
              })}
            </div>
            {picked !== null ? (
              <div className="slide-in mt-4 flex items-start gap-3 rounded-xl bg-paper p-4">
                <MimoTile size={36}>
                  <Avatar face={right ? "happy" : "calm"} size={32} />
                </MimoTile>
                <p className="text-sm">
                  <span className="font-semibold">{right ? t.check.right : t.check.wrong}</span> {q.explain}
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end">
              {right ? (
                <button
                  onClick={() => {
                    setPicked(null);
                    if (at + 1 >= questions.length) onPass();
                    setAt(at + 1);
                  }}
                  className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft"
                >
                  {at + 1 >= questions.length ? t.check.finish : t.check.next}
                </button>
              ) : picked !== null ? (
                <button onClick={() => setPicked(null)} className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper">
                  {t.check.tryAgain}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
