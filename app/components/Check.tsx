"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { fill, formatLeft, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { Avatar, MimoTile } from "./Mascot";
import { money } from "./Overview";
import type { AppState, Settings } from "./types";

/** The terms the questions are built from: the draft's own numbers, never the model's. */
export type CheckTerms = {
  maxTradePct: number;
  maxDailyVolumePct: number;
  dailyLossPct: number;
  waitSeconds: number;
  valueUsd: number;
  minDefensivePct?: number;
  maxLossStreak?: number;
  cooldownMinutes?: number;
  /** The index fund's stop price, if it has one. */
  indexStop?: number | null;
};

export type Question = {
  id: string;
  ask: string;
  options: string[];
  correct: number;
  explain: string;
};

/** The check's numbers from a mandate (signed or drafted) and the vault as it is now. */
export function checkTermsOf(
  m: AppState["portfolio"]["mandate"],
  state: AppState,
): CheckTerms {
  const idx = state.portfolio.positions.find((x) => x.symbol === "IDX");
  return {
    maxTradePct: m.maxTradePct,
    maxDailyVolumePct: m.maxDailyVolumePct,
    dailyLossPct: m.dailyLossPct,
    waitSeconds: state.portfolio.settings.loosenDelaySeconds,
    valueUsd: Number(state.portfolio.totalValue),
    minDefensivePct: m.minDefensivePct,
    maxLossStreak: m.maxLossStreak,
    cooldownMinutes: Math.round(m.cooldownSeconds / 60),
    indexStop: idx?.rule.stopPrice ? Number(idx.rule.stopPrice) : null,
  };
}

/** How many questions one round asks. */
export const ROUND = 4;

/**
 * Every question and its right answer, worked out here by fixed rules from
 * the mandate's own numbers. The AI never decides whether someone passed.
 * The right answer's position is fixed per question so it is not always first.
 */
export function questionsOf(
  terms: CheckTerms,
  settings: Settings,
  t: Strings,
): Question[] {
  const agent = BRAND.agent;
  const m = (usd: number) => money(usd, settings.currency);
  const value = m(terms.valueUsd);
  const perTrade = terms.valueUsd * (terms.maxTradePct / 100);
  const perDay = terms.valueUsd * (terms.maxDailyVolumePct / 100);
  // a wrong amount that is never equal to the right one
  const volume =
    terms.maxDailyVolumePct > terms.maxTradePct ? perDay : perTrade * 2;
  const wait = formatLeft(terms.waitSeconds, t);
  const min = terms.cooldownMinutes ?? 10;
  const q = (
    id: string,
    ask: string,
    right: string,
    wrong: string[],
    at: number,
    explain: string,
  ): Question => {
    const options = [...wrong];
    options.splice(at, 0, right);
    return { id, ask, options, correct: at, explain };
  };
  const bank: Question[] = [
    q(
      "trade",
      fill(t.check.q1, { value, agent }),
      m(perTrade),
      [m(volume), value],
      1,
      fill(t.check.e1, { pct: terms.maxTradePct, value, amount: m(perTrade) }),
    ),
    q(
      "loss",
      fill(t.check.q2, { loss: terms.dailyLossPct, agent }),
      fill(t.check.q2a, { agent }),
      [fill(t.check.q2b, { agent }), fill(t.check.q2c, { agent })],
      0,
      t.check.e2,
    ),
    q(
      "wait",
      t.check.q3,
      fill(t.check.q3a, { wait }),
      [fill(t.check.q3b, { agent }), fill(t.check.q3c, { agent })],
      2,
      t.check.e3,
    ),
    q(
      "out",
      fill(t.check.q4, { agent }),
      fill(t.check.q4a, { agent }),
      [fill(t.check.q4b, { agent }), fill(t.check.q4c, { agent })],
      1,
      fill(t.check.e4, { agent }),
    ),
    q(
      "day",
      fill(t.check.q5, { agent }),
      m(perDay > perTrade ? perDay : perTrade * 2),
      [m(perTrade), value],
      0,
      fill(t.check.e5, {
        pct: terms.maxDailyVolumePct,
        amount: m(perDay),
        agent,
      }),
    ),
    q(
      "contact",
      t.check.q10,
      fill(t.check.q10a, { agent }),
      [t.check.q10b, t.check.q10c],
      0,
      t.check.e10,
    ),
    q(
      "meme",
      fill(t.check.q9, { agent }),
      t.check.q9a,
      [t.check.q9b, t.check.q9c],
      2,
      fill(t.check.e9, { agent }),
    ),
    q(
      "bigger",
      fill(t.check.q11, { agent }),
      t.check.q11a,
      [t.check.q11b, t.check.q11c],
      1,
      t.check.e11,
    ),
    q(
      "pause",
      fill(t.check.q12, { agent }),
      t.check.q12a,
      [t.check.q12b, fill(t.check.q12c, { agent })],
      2,
      fill(t.check.e12, { agent }),
    ),
  ];
  if (terms.minDefensivePct) {
    bank.push(
      q(
        "floor",
        t.check.q6,
        fill(t.check.q6a, { pct: terms.minDefensivePct }),
        [t.check.q6b, t.check.q6c],
        1,
        fill(t.check.e6, { pct: terms.minDefensivePct }),
      ),
    );
  }
  if (terms.maxLossStreak) {
    bank.push(
      q(
        "streak",
        fill(t.check.q7, { agent, n: terms.maxLossStreak }),
        fill(t.check.q7a, { min }),
        [fill(t.check.q7b, { agent }), t.check.q7c],
        0,
        fill(t.check.e7, { min }),
      ),
    );
  }
  if (terms.indexStop) {
    bank.push(
      q(
        "stop",
        fill(t.check.q8, { stop: terms.indexStop }),
        fill(t.check.q8a, { agent }),
        [fill(t.check.q8b, { agent }), fill(t.check.q8c, { agent })],
        1,
        fill(t.check.e8, { agent }),
      ),
    );
  }
  return bank;
}

/** One round: the per-trade question first (it is the one that matters most), then three others at random. */
export function roundOf(
  bank: Question[],
  random: () => number = Math.random,
): Question[] {
  const [first, ...rest] = bank;
  const shuffled = rest
    .map((x) => ({ x, k: random() }))
    .sort((a, b) => a.k - b.k)
    .map(({ x }) => x);
  return [first, ...shuffled.slice(0, ROUND - 1)];
}

/**
 * One round of questions, without a frame, so it can sit in a dialog or in the
 * first-time setup. `onFinish` is the last button; `finishLabel` names it.
 */
export function CheckRound({
  terms,
  settings,
  onPass,
  onFinish,
  finishLabel,
}: {
  terms: CheckTerms;
  settings: Settings;
  onPass: () => void;
  onFinish: () => void;
  finishLabel?: string;
}) {
  const t = strings(settings.language, settings.role);
  // a new round each time it opens; the order is kept while it is open
  const [ids] = useState(() =>
    roundOf(questionsOf(terms, settings, t)).map((x) => x.id),
  );
  const bank = questionsOf(terms, settings, t);
  const questions = ids
    .map((id) => bank.find((x) => x.id === id))
    .filter((x): x is Question => Boolean(x));
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const done = at >= questions.length;
  const q = questions[Math.min(at, questions.length - 1)];
  const right = picked !== null && picked === q.correct;
  return (
    <div>
      {done ? (
        <div className="mt-4 text-center">
          <div className="mx-auto w-fit">
            <MimoTile size={84}>
              <Avatar face="happy" size={78} />
            </MimoTile>
          </div>
          <h2 className="mt-4 font-serif text-[1.8rem] leading-tight">
            {t.check.done}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs text-muted">
            {t.check.doneNote}
          </p>
          <button
            onClick={onFinish}
            className="mt-6 rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft"
          >
            {finishLabel ?? t.check.finish}
          </button>
        </div>
      ) : (
        <>
          {at === 0 && picked === null ? (
            <>
              <h2 className="mt-2 font-serif text-[1.7rem] leading-tight">
                {t.check.title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {fill(t.check.sub, { agent: BRAND.agent })}
              </p>
            </>
          ) : null}
          <div className="mt-5 flex items-center gap-2">
            {questions.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < at ? "bg-leaf" : i === at ? "bg-sage" : "bg-cream"}`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-faint">
            {fill(t.check.progress, { n: at + 1, total: questions.length })}
          </p>
          <p className="mt-1 text-[1.1rem] font-semibold">{q.ask}</p>
          <div className="mt-4 space-y-2">
            {q.options.map((o, i) => {
              const chosen = picked === i;
              const tone = !chosen
                ? "border-line hover:border-sage"
                : right
                  ? "border-leaf bg-mint/60"
                  : "border-sun bg-sun-soft/70";
              return (
                <button
                  key={o}
                  data-correct={i === q.correct ? "yes" : undefined}
                  disabled={right}
                  onClick={() => setPicked(i)}
                  className={`num flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[0.95rem] transition-colors ${tone}`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${chosen ? (right ? "border-leaf bg-leaf text-white" : "border-sun-ink text-sun-ink") : "border-line"}`}
                  >
                    {chosen ? (
                      <Icon
                        name={right ? "check" : "x"}
                        size={11}
                        strokeWidth={3}
                      />
                    ) : null}
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
                <span className="font-semibold">
                  {right ? t.check.right : t.check.wrong}
                </span>{" "}
                {q.explain}
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
              <button
                onClick={() => setPicked(null)}
                className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper"
              >
                {t.check.tryAgain}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export function UnderstandingCheck({
  terms,
  settings,
  onPass,
  onClose,
}: {
  terms: CheckTerms;
  settings: Settings;
  onPass: () => void;
  onClose: () => void;
}) {
  const t = strings(settings.language, settings.role);
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
        aria-label={t.check.eyebrow}
        className="slide-in w-full max-w-xl rounded-(--radius-card) bg-card p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">{t.check.eyebrow}</p>
          <button
            onClick={onClose}
            aria-label={t.check.close}
            className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <CheckRound
          terms={terms}
          settings={settings}
          onPass={onPass}
          onFinish={onClose}
        />
      </div>
    </div>
  );
}
