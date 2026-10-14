"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, Chip, Eyebrow } from "./ui";

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
const SHORT_BRAIN: Record<string, string> = { plan: "Healthy plan follower", random: "Random agent", compromised: "Compromised agent", deepseek: "DeepSeek" };
const SHORT_USER: Record<string, string> = { calm: "calm owner", panicking: "panicking owner" };

/** A headline number with what it counts. Proportional figures: these stand alone, they are not a column. */
function Tile({ value, label, note }: { value: ReactNode; label: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-cream p-5">
      <p className="font-display text-4xl font-semibold">{value}</p>
      <p className="mt-1 text-base font-semibold">{label}</p>
      {note ? <p className="mt-0.5 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

/**
 * One cell of the matrix: how much of the starting money is left, guarded and
 * unguarded, as two thin bars on the same scale with their numbers beside
 * them. One hue for the guarded result, grey for the baseline.
 */
function Pair({ cell, start, scaleMax }: { cell: Cell; start: number; scaleMax: number }) {
  const g = cell.guarded.medianFinalValue;
  const u = cell.unguarded.medianFinalValue;
  const pct = (v: number) => `${Math.max((v / scaleMax) * 100, 0.5)}%`;
  const change = (v: number) => `${v >= start ? "+" : ""}${(((v - start) / start) * 100).toFixed(1)}%`;
  const guardCosts = g < u - start * 0.005;
  const title = `${SHORT_BRAIN[cell.brain] ?? cell.brain}, ${SHORT_USER[cell.user] ?? cell.user}. Guarded: ends at ${g.toFixed(0)} of ${start} (worst seed ${cell.guarded.worstFinalValue.toFixed(0)}), largest fall ${cell.guarded.medianMaxDrawdownPct}% (worst seed ${cell.guarded.worstMaxDrawdownPct}%). Unguarded: ends at ${u.toFixed(0)} (worst seed ${cell.unguarded.worstFinalValue.toFixed(0)}), largest fall ${cell.unguarded.medianMaxDrawdownPct}% (worst seed ${cell.unguarded.worstMaxDrawdownPct}%). ${cell.seeds} seeds.`;
  return (
    <td className="px-3 py-3 align-top" title={title}>
      <div className="space-y-[2px]">
        {[
          [g, "var(--color-chart-guarded)"],
          [u, "var(--color-chart-plain)"],
        ].map(([v, color], i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded-r bg-chart-track">
              <div className="h-2 rounded-r" style={{ width: pct(v as number), background: color as string }} />
            </div>
            <span className="num w-14 text-right text-sm">{change(v as number)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        fall {cell.guarded.medianMaxDrawdownPct}% vs {cell.unguarded.medianMaxDrawdownPct}%
      </p>
      {guardCosts ? <p className="mt-0.5 text-xs font-semibold text-sun-ink">▲ the mandate cost here</p> : null}
      {!cell.guarded.boundsHeld ? <p className="mt-0.5 text-xs font-semibold text-coral">✕ a bound was broken</p> : null}
    </td>
  );
}

export function ProofView() {
  const [data, setData] = useState<{ harness: Harness | null; outdated?: boolean; invariants: Invariants | null } | null>(null);
  useEffect(() => {
    fetch("/api/results", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ harness: null, invariants: null }));
  }, []);

  if (!data) return <Card>Loading the results…</Card>;
  const { harness: h, invariants: inv } = data;
  if (!h) {
    return (
      <Card>
        <h2 className="font-display text-2xl font-semibold">{data.outdated ? "The results file is from an older harness" : "No harness results yet"}</h2>
        <p className="mt-2 text-lg text-muted">
          Run <code>npm run harness</code> in the app folder. It replays six markets against the real contracts on a local chain and writes the results here.
        </p>
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

  return (
    <div className="space-y-6">
      <Card>
        <Eyebrow>Do the boundaries hold?</Eyebrow>
        <p className="mt-3 font-display text-6xl font-semibold">
          {held} of {runs} runs
        </p>
        <p className="mt-2 max-w-4xl text-xl">
          {held === runs
            ? "In every run, for every brain and every owner, nothing the mandate forbids happened: no money left the vault except to the owner, nothing outside the mandate was bought, no cap or daily allowance was passed, and no rise in risk took effect before its wait."
            : `A bound was broken in ${runs - held} runs: ${t.boundsBroken.join("; ")}.`}
        </p>
        <div className="mt-6 grid grid-cols-4 gap-4">
          <Tile value={n(t.violationsBlocked)} label="rule breaks stopped" note={`of ${n(t.attempts)} attempted actions; ${n(t.blockedByContract)} by the contract, ${n(t.blockedByRiskEngine + t.sentToOwner)} before signing`} />
          <Tile value={`${n(t.loosening.queued)} of ${n(t.loosening.attempts)}`} label="risk increases made to wait" note={`${n(t.loosening.appliedAtOnce)} took effect at once`} />
          <Tile value={n(t.loosening.vetoed)} label="vetoed by the guardian" note={`${n(t.loosening.appliedAfterTheWait)} applied after the full wait`} />
          <Tile value={`${n(t.revengeBuys.refused)} of ${n(t.revengeBuys.attempts)}`} label="revenge buys refused" note={`${n(t.revengeBuys.madeInsideTheMandate)} went through, inside every cap`} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Money left after three days, against the same agent with nothing in the way</Eyebrow>
            <p className="mt-1 text-base text-muted">
              Change from the starting {n(start)} tUSD: the middle result of {h.design.seedsPerCell} seeds. Hover a cell for the worst seed. &quot;fall&quot; is the largest drop from a peak.
            </p>
          </div>
          <div className="flex items-center gap-5 text-base">
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-r" style={{ background: "var(--color-chart-guarded)" }} />
              Guarded by the mandate
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-r" style={{ background: "var(--color-chart-plain)" }} />
              Unguarded
            </span>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-sm">
                <th className="py-2 pr-3 font-semibold">Market</th>
                {columns.map(({ b, u }) => (
                  <th key={b + u} className="px-3 py-2 font-semibold">
                    {SHORT_BRAIN[b] ?? b}
                    <span className="block font-normal text-muted">{SHORT_USER[u] ?? u}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.design.scenarios.map((s) => (
                <tr key={s.id} className="border-b border-line">
                  <th className="w-56 py-3 pr-3 align-top font-normal">
                    <span className="text-base font-semibold">{s.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{s.stress}</span>
                  </th>
                  {columns.map(({ b, u }) => {
                    const cell = h.cells.find((c) => c.scenario === s.id && c.brain === b && c.user === u);
                    return cell ? <Pair key={b + u} cell={cell} start={start} scaleMax={scaleMax} /> : <td key={b + u} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <Eyebrow>Where the mandate costs something</Eyebrow>
          <p className="mt-2 text-lg">
            {costly.length === 0
              ? "In this run the guarded portfolio ended at or above the unguarded one in every cell."
              : `In ${costly.length} of ${h.cells.length} cells the guarded portfolio ended lower than the unguarded one.`}
          </p>
          <ul className="mt-3 space-y-2 text-base text-muted">
            <li>
              <span className="font-semibold text-ink">A rising market.</span> Caps and the defensive minimum hold back some of the gain. That is the price of the limits.
            </li>
            <li>
              <span className="font-semibold text-ink">A manipulated price feed.</span> The vault trusts its feed. When the feed reports a fall that did not happen, the stop-loss sells at the false price. The feed&apos;s per-update bound and staleness check limit this; they do not remove it. It is on the known-risk list.
            </li>
            <li>
              <span className="font-semibold text-ink">A fall that recovers.</span> A stop-loss or a pause on buying can lock in a loss the unguarded account rides out.
            </li>
          </ul>
        </Card>
        <Card>
          <Eyebrow>Does it get in a healthy agent&apos;s way?</Eyebrow>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Tile value={`${n(tasks.done)} of ${n(tasks.due)}`} label="planned tasks completed" note="recurring buys and rebalances" />
            <Tile value={tasks.due ? `${((tasks.falsely / tasks.due) * 100).toFixed(1)}%` : "0%"} label="false-block rate" note={`${n(tasks.falsely)} tasks refused for no protective reason`} />
          </div>
          <p className="mt-3 text-base text-muted">
            {n(tasks.paused)} more were held back by protection (a loss trigger, a stop price or a risk signal), which is the mandate working, and {n(tasks.owner)} were sent to the owner. The mandate fired {n(t.stopLossesFired)} stop-losses across all runs, none of them through the agent.
          </p>
        </Card>
      </div>

      {inv ? (
        <Card>
          <Eyebrow>The contracts, tested separately</Eyebrow>
          <div className="mt-3 grid grid-cols-4 gap-4">
            <Tile value={n(inv.randomCalls)} label="random calls" note={`against ${inv.invariants} invariants, ${inv.compiler}`} />
            <Tile value={n(inv.violations)} label="violations" note="a compromised agent, a panicking owner and a moving market at once" />
            <Tile value={n(inv.tests)} label="tests passing" />
            <Tile value={`${inv.mutation.caughtByUnitTests} of ${inv.mutation.brokenChecks}`} label="deliberately broken checks caught" note={`${inv.mutation.caughtByInvariants} also caught by the invariants alone`} />
          </div>
          <p className="mt-3 text-base text-muted">We removed or broke each safety check in turn to see whether the tests notice. {inv.mutation.missed}</p>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>How this was measured</Eyebrow>
        <ul className="mt-2 space-y-1.5 text-base text-muted">
          <li>
            <span className="font-semibold text-ink">Guarded:</span> the real contracts on a local chain, with the risk engine, the keeper and a guardian who vetoes most of what waits. Mandate: {h.design.mandate}.
          </li>
          <li>
            <span className="font-semibold text-ink">Unguarded:</span> {h.design.unguarded}
          </li>
          {Object.entries(h.design.brains).map(([id, text]) => (
            <li key={id}>
              <span className="font-semibold text-ink">{SHORT_BRAIN[id] ?? id}:</span> {text}.
            </li>
          ))}
          <li>
            <span className="font-semibold text-ink">Panicking owner:</span> when their portfolio is down 3% on the day or the index has dropped 6% in half a day, they try to triple the loss limit, halt the stop-loss, move the withdrawal address and sign for a large revenge buy.
          </li>
          <li>
            <span className="font-semibold text-ink">Prices:</span> {h.design.prices} {h.design.steps} hourly steps per run. These are stress tests of the rules, not a forecast and not a claim about returns.
          </li>
          <li>
            Generated {new Date(h.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. <Chip tone="plain">{runs} runs</Chip>
          </li>
        </ul>
      </Card>
    </div>
  );
}
