"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fill, LOCALE, strings, type Strings } from "./i18n";
import type { Settings } from "./types";
import { Icon } from "./icons";
import { RedTeamCard, type RedTeamFile } from "./RedTeam";
import { Card } from "./ui";

type Side = { medianFinalValue: number; worstFinalValue: number; medianMaxDrawdownPct: number; worstMaxDrawdownPct: number };
type Guarded = Side & {
  attempts: number;
  executed: number;
  violationsBlocked: number;
  blockedByRiskEngine: number;
  blockedByContract: number;
  sentToOwner: number;
  loosening: { attempts: number; queued: number; appliedAtOnce: number; vetoed: number; appliedAfterTheWait: number };
  revengeBuys: { attempts: number; refused: number; madeInsideTheMandate: number };
  stopLossesFired: number;
  hoursBuyingPaused: number;
  tasks: { due: number; done: number; pausedByProtection: number; sentToOwner: number; falselyBlocked: number };
  boundsHeld: boolean;
  boundsBroken: string[];
};
type Summary = { seeds: number; guarded: Guarded; unguarded: Side & { stolen: number } };
type Cell = Summary & { scenario: string; brain: string; user: string };
type Harness = {
  generatedAt: string;
  design: {
    steps: number;
    startingCash: number;
    seedsPerCell: number;
    mandate: string;
    scenarios: { id: string; name: string; stress: string }[];
    brains: Record<string, string>;
    users: Record<string, string>;
    unguarded: string;
    prices: string;
  };
  totals: Summary;
  cells: Cell[];
};
type Invariants = {
  date: string;
  compiler: string;
  tests: number;
  invariants: number;
  randomCalls: number;
  violations: number;
  mutation: { brokenChecks: number; caughtByUnitTests: number; caughtByInvariants: number; missed: string };
};

const n = (x: number) => x.toLocaleString("en-US");

const BRAIN_KEY: Record<string, ["bPlan" | "bRandom" | "bCompromised" | "bDeepseek", "bPlanText" | "bRandomText" | "bCompromisedText" | "bDeepseekText"]> = {
  plan: ["bPlan", "bPlanText"],
  random: ["bRandom", "bRandomText"],
  compromised: ["bCompromised", "bCompromisedText"],
  deepseek: ["bDeepseek", "bDeepseekText"],
};
const SCENARIO_KEY: Record<string, [keyof Strings["proof"], keyof Strings["proof"]]> = {
  bull: ["scBull", "scBullText"],
  bear: ["scBear", "scBearText"],
  crash: ["scCrash", "scCrashText"],
  choppy: ["scChoppy", "scChoppyText"],
  flash: ["scFlash", "scFlashText"],
  oracle: ["scOracle", "scOracleText"],
};
const brainName = (id: string, t: Strings) => (BRAIN_KEY[id] ? t.proof[BRAIN_KEY[id][0]] : id);
const userName = (id: string, t: Strings) => (id === "calm" ? t.proof.uCalm : id === "panicking" ? t.proof.uPanicking : id);

/** A headline number with what it counts. */
function Stat({ value, label, note, tone = "text-ink" }: { value: ReactNode; label: string; note?: string; tone?: string }) {
  return (
    <div>
      <p className={`num font-display text-[2rem] leading-none font-semibold tracking-[-0.02em] ${tone}`}>{value}</p>
      <p className="mt-2 text-sm font-semibold">{label}</p>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

/**
 * One cell of the matrix: how much of the starting money is left, guarded and
 * unguarded, as two thin bars on the same scale with their numbers beside
 * them. One hue for the guarded result, a grey that steps back for the
 * baseline; every bar carries its number, so the grey's low contrast is relieved.
 */
function Pair({ cell, start, scaleMax, t }: { cell: Cell; start: number; scaleMax: number; t: Strings }) {
  const g = cell.guarded.medianFinalValue;
  const u = cell.unguarded.medianFinalValue;
  const pct = (v: number) => `${Math.max((v / scaleMax) * 100, 0.5)}%`;
  const change = (v: number) => `${v >= start ? "+" : "−"}${Math.abs(((v - start) / start) * 100).toFixed(1)}%`;
  const guardCosts = g < u - start * 0.005;
  const title = `${brainName(cell.brain, t)}, ${userName(cell.user, t)}. ${t.proof.guarded}: ${g.toFixed(0)} / ${start} (worst ${cell.guarded.worstFinalValue.toFixed(0)}), fall ${cell.guarded.medianMaxDrawdownPct}% (worst ${cell.guarded.worstMaxDrawdownPct}%). ${t.proof.unguarded}: ${u.toFixed(0)} (worst ${cell.unguarded.worstFinalValue.toFixed(0)}), fall ${cell.unguarded.medianMaxDrawdownPct}% (worst ${cell.unguarded.worstMaxDrawdownPct}%). ${cell.seeds} seeds.`;
  return (
    <td className="px-3 py-3.5 align-top" title={title}>
      <div className="space-y-[3px]">
        {[
          [g, "var(--color-chart-guarded)"],
          [u, "var(--color-chart-plain)"],
        ].map(([v, color], i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded-r-[4px] bg-chart-track">
              <div className="h-2 rounded-r-[4px]" style={{ width: pct(v as number), background: color as string }} />
            </div>
            <span className={`num w-14 text-right text-xs ${i ? "text-muted" : "font-semibold text-ink"}`}>{change(v as number)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-faint">{fill(t.proof.fall, { g: cell.guarded.medianMaxDrawdownPct, u: cell.unguarded.medianMaxDrawdownPct })}</p>
      {guardCosts ? <p className="mt-0.5 text-xs font-semibold text-sun-ink">{t.proof.costHere}</p> : null}
      {!cell.guarded.boundsHeld ? <p className="mt-0.5 text-xs font-semibold text-coral">{t.proof.broken}</p> : null}
    </td>
  );
}

export function ProofHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language, settings.role);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.proof.title} <span className="accent">{t.proof.titleAccent}</span>
      </h1>
      <p className="mt-1.5 max-w-4xl text-[1.05rem] text-muted">{t.proof.sub}</p>
    </div>
  );
}

export function ProofView({ settings }: { settings: Settings }) {
  const tr = strings(settings.language, settings.role);
  const [data, setData] = useState<{ harness: Harness | null; outdated?: boolean; invariants: Invariants | null; redteam?: RedTeamFile[] } | null>(null);
  useEffect(() => {
    fetch("/api/results", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ harness: null, invariants: null }));
  }, []);

  if (!data) return <Card className="p-7!">{tr.proof.loading}</Card>;
  const { harness: h, invariants: inv } = data;
  if (!h) {
    return (
      <Card className="p-7!">
        <h2 className="font-display text-xl font-semibold">{data.outdated ? tr.proof.outdated : tr.proof.none}</h2>
        <p className="mt-2 text-[0.95rem] text-muted">{tr.proof.noneBody}</p>
      </Card>
    );
  }

  const t = h.totals.guarded;
  const runs = h.cells.reduce((sum, c) => sum + c.seeds, 0);
  const held = h.cells.filter((c) => c.guarded.boundsHeld).reduce((sum, c) => sum + c.seeds, 0);
  const brains = Object.keys(h.design.brains);
  const users = Object.keys(h.design.users);
  const columns = brains.flatMap((b) => users.map((u) => ({ b, u })));
  const start = h.design.startingCash;
  const scaleMax = Math.max(start * 1.1, ...h.cells.flatMap((c) => [c.guarded.medianFinalValue, c.unguarded.medianFinalValue]));
  const costly = h.cells.filter((c) => c.guarded.medianFinalValue < c.unguarded.medianFinalValue - start * 0.005);
  const healthy = h.cells.filter((c) => c.brain === "plan" || c.brain === "deepseek");
  const tasks = healthy.reduce(
    (a, c) => ({
      due: a.due + c.guarded.tasks.due,
      done: a.done + c.guarded.tasks.done,
      paused: a.paused + c.guarded.tasks.pausedByProtection,
      owner: a.owner + c.guarded.tasks.sentToOwner,
      falsely: a.falsely + c.guarded.tasks.falselyBlocked,
    }),
    { due: 0, done: 0, paused: 0, owner: 0, falsely: 0 },
  );
  const scenarioText = (id: string, name: string, stress: string): [string, string] => (SCENARIO_KEY[id] ? [tr.proof[SCENARIO_KEY[id][0]], tr.proof[SCENARIO_KEY[id][1]]] : [name, stress]);

  return (
    <div className="space-y-5">
      {/* the headline: did anything the mandate forbids happen? */}
      <section className="relative overflow-hidden rounded-(--radius-card) bg-forest p-8 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgb(255_255_255/0.09),transparent_55%)]" />
        <p className="eyebrow relative text-white/70!">{tr.proof.eyebrow}</p>
        <p className="relative mt-4 font-serif text-[3.2rem] leading-none">
          {fill(tr.proof.runs, { held: n(held), runs: n(runs) })}
        </p>
        <p className="relative mt-4 max-w-4xl text-[1.02rem] leading-relaxed text-white/80">
          {held === runs ? tr.proof.heldAll : fill(tr.proof.heldSome, { n: runs - held, what: t.boundsBroken.join("; ") })}
        </p>
      </section>

      <Card className="grid grid-cols-2 gap-6 p-7! lg:grid-cols-4">
        <Stat value={n(t.violationsBlocked)} label={tr.proof.sBreaks} note={fill(tr.proof.sBreaksNote, { attempts: n(t.attempts) })} />
        <Stat value={`${n(t.loosening.queued)}/${n(t.loosening.attempts)}`} label={tr.proof.sWait} note={fill(tr.proof.sWaitNote, { n: n(t.loosening.appliedAtOnce) })} />
        <Stat value={n(t.loosening.vetoed)} label={tr.proof.sVeto} note={fill(tr.proof.sVetoNote, { n: n(t.loosening.appliedAfterTheWait) })} />
        <Stat value={`${n(t.revengeBuys.refused)}/${n(t.revengeBuys.attempts)}`} label={tr.proof.sRevenge} note={fill(tr.proof.sRevengeNote, { n: n(t.revengeBuys.madeInsideTheMandate) })} />
      </Card>

      <Card className="p-7!">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <h3 className="font-display text-lg font-semibold">{tr.proof.matrix}</h3>
            <p className="mt-1 text-sm text-muted">{fill(tr.proof.matrixSub, { start: n(start), seeds: h.design.seedsPerCell })}</p>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-r-[4px]" style={{ background: "var(--color-chart-guarded)" }} />
              {tr.proof.guarded}
            </span>
            <span className="flex items-center gap-2 text-muted">
              <span className="h-2 w-6 rounded-r-[4px]" style={{ background: "var(--color-chart-plain)" }} />
              {tr.proof.unguarded}
            </span>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-sm">
                <th className="py-2 pr-3 font-semibold text-muted">{tr.proof.market}</th>
                {columns.map(({ b, u }) => (
                  <th key={b + u} className="px-3 py-2 font-semibold">
                    <span className={b === "compromised" ? "text-coral" : ""}>{brainName(b, tr)}</span>
                    <span className="block text-xs font-normal text-muted">{userName(u, tr)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.design.scenarios.map((sc) => {
                const [name, stress] = scenarioText(sc.id, sc.name, sc.stress);
                return (
                  <tr key={sc.id} className="border-b border-line/70 last:border-0">
                    <th className="w-56 py-3.5 pr-3 align-top font-normal">
                      <span className="text-[0.95rem] font-semibold">{name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{stress}</span>
                    </th>
                    {columns.map(({ b, u }) => {
                      const cell = h.cells.find((c) => c.scenario === sc.id && c.brain === b && c.user === u);
                      return cell ? <Pair key={b + u} cell={cell} start={start} scaleMax={scaleMax} t={tr} /> : <td key={b + u} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-7!">
          <h3 className="font-display text-lg font-semibold">{tr.proof.costTitle}</h3>
          <p className="mt-2 text-[0.95rem]">{costly.length === 0 ? tr.proof.costNone : fill(tr.proof.costSome, { n: costly.length, total: h.cells.length })}</p>
          <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
            {(
              [
                [tr.proof.cost1, tr.proof.cost1Note],
                [tr.proof.cost2, tr.proof.cost2Note],
                [tr.proof.cost3, tr.proof.cost3Note],
              ] as const
            ).map(([k, v]) => (
              <li key={k} className="py-3">
                <span className="font-semibold">{k}</span> <span className="text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-7!">
          <h3 className="font-display text-lg font-semibold">{tr.proof.healthyTitle}</h3>
          <div className="mt-5 grid grid-cols-2 gap-6">
            <Stat value={`${n(tasks.done)}/${n(tasks.due)}`} label={tr.proof.tasksDone} note={tr.proof.tasksNote} />
            <Stat value={tasks.due ? `${((tasks.falsely / tasks.due) * 100).toFixed(1)}%` : "0%"} label={tr.proof.falseBlock} note={fill(tr.proof.falseBlockNote, { n: n(tasks.falsely) })} />
          </div>
          <p className="mt-5 text-sm text-muted">{fill(tr.proof.healthyNote, { paused: n(tasks.paused), owner: n(tasks.owner), stops: n(t.stopLossesFired) })}</p>
        </Card>
      </div>

      {inv ? (
        <Card className="p-7!">
          <h3 className="font-display text-lg font-semibold">{tr.proof.contracts}</h3>
          <div className="mt-5 grid grid-cols-2 gap-6 lg:grid-cols-4">
            <Stat value={n(inv.randomCalls)} label={tr.proof.randomCalls} note={fill(tr.proof.randomCallsNote, { n: inv.invariants, compiler: inv.compiler })} />
            <Stat value={n(inv.violations)} label={tr.proof.violations} note={tr.proof.violationsNote} tone="text-leaf" />
            <Stat value={n(inv.tests)} label={tr.proof.tests} />
            <Stat value={`${inv.mutation.caughtByUnitTests}/${inv.mutation.brokenChecks}`} label={tr.proof.mutants} note={fill(tr.proof.mutantsNote, { n: inv.mutation.caughtByInvariants })} />
          </div>
          <p className="mt-5 text-sm text-muted">
            {tr.proof.mutationNote} {inv.mutation.missed}
          </p>
        </Card>
      ) : null}

      <RedTeamCard files={data.redteam ?? []} t={tr} />

      <Card className="p-7!">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">{tr.proof.method}</h3>
            <Icon name="chevron" size={18} className="text-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>
              <span className="font-semibold text-ink">{tr.proof.mGuarded}</span> {fill(tr.proof.mGuardedText, { mandate: h.design.mandate })}
            </li>
            <li>
              <span className="font-semibold text-ink">{tr.proof.mUnguarded}</span> {tr.proof.mUnguardedText}
            </li>
            {brains.map((id) => (
              <li key={id}>
                <span className="font-semibold text-ink">{brainName(id, tr)}:</span> {BRAIN_KEY[id] ? tr.proof[BRAIN_KEY[id][1]] : h.design.brains[id]}.
              </li>
            ))}
            <li>
              <span className="font-semibold text-ink">{tr.proof.mPanic}</span> {tr.proof.mPanicText}
            </li>
            <li>
              <span className="font-semibold text-ink">{tr.proof.mPrices}</span> {fill(tr.proof.mPricesText, { steps: h.design.steps })}
            </li>
            <li className="text-xs text-faint">{fill(tr.proof.generated, { date: new Date(h.generatedAt).toLocaleString(LOCALE[settings.language], { dateStyle: "medium", timeStyle: "short" }) })}</li>
          </ul>
        </details>
      </Card>
    </div>
  );
}
