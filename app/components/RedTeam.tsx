"use client";

import { fill, type Strings } from "./i18n";
import { Card } from "./ui";

type Run = { agent: "ours" | "baseline"; verdict: string; layer: string };
type Attack = { id: string; title: string; control: boolean; contract: { goal: string; reverted: boolean; error: string | null }[]; runs: Run[] };
export type RedTeamFile = { model: string; repeats: number; at: string; attacks: Attack[] };

/** "deepseek-flash" and "llama3.2:3b" as people would say them. */
const modelName = (id: string) => (id.startsWith("deepseek") ? "DeepSeek" : id.startsWith("llama3.2:3b") ? "Llama 3.2 3B, local" : id);

const LOST = new Set(["attacker won"]);

function Verdicts({ runs, control, t }: { runs: Run[]; control: boolean; t: Strings }) {
  if (!runs.length) return <span className="text-faint">–</span>;
  if (control) {
    const done = runs.filter((r) => r.verdict === "done").length;
    return <span className={done === runs.length ? "text-leaf" : "font-semibold text-sun-ink"}>{fill(t.proof.rtDone, { n: done, of: runs.length })}</span>;
  }
  const lost = runs.filter((r) => LOST.has(r.verdict)).length;
  if (lost) return <span className="font-semibold text-sun-ink">{fill(t.proof.rtGot, { n: lost, of: runs.length })}</span>;
  return <span className="text-leaf">✓ {t.proof.rtHeld}</span>;
}

/** The red-team table: the same attacks against a plain agent and ours, on each model, and straight at the contract. */
export function RedTeamCard({ files, t }: { files: RedTeamFile[]; t: Strings }) {
  if (!files.length) {
    return (
      <Card className="p-7!">
        <h3 className="font-display text-lg font-semibold">{t.proof.rtTitle}</h3>
        <p className="mt-2 text-sm text-muted">{t.proof.rtNone}</p>
      </Card>
    );
  }
  const ids = files[0].attacks.map((a) => a.id);
  const tally = (f: RedTeamFile, agent: string) => {
    const attackRuns = f.attacks.filter((a) => !a.control).flatMap((a) => a.runs.filter((r) => r.agent === agent));
    const controlRuns = f.attacks.filter((a) => a.control).flatMap((a) => a.runs.filter((r) => r.agent === agent));
    return { runs: attackRuns.length, lost: attackRuns.filter((r) => LOST.has(r.verdict)).length, falseBlocks: controlRuns.filter((r) => r.verdict === "false block").length };
  };
  const goals = files[0].attacks.flatMap((a) => a.contract);

  return (
    <Card className="p-7!">
      <h3 className="font-display text-lg font-semibold">{t.proof.rtTitle}</h3>
      <p className="mt-1 max-w-4xl text-sm text-muted">{t.proof.rtSub}</p>
      <ul className="mt-4 space-y-1 text-[0.95rem]">
        {files.map((f) => {
          const plain = tally(f, "baseline");
          const ours = tally(f, "ours");
          return (
            <li key={f.model}>
              {fill(t.proof.rtModelLine, { model: modelName(f.model), b: plain.lost, o: ours.lost, runs: ours.runs || plain.runs, fb: plain.falseBlocks, fo: ours.falseBlocks })}
            </li>
          );
        })}
        <li className="font-semibold text-leaf">{fill(t.proof.rtGoals, { r: goals.filter((g) => g.reverted).length, g: goals.length })}</li>
      </ul>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-semibold text-muted" rowSpan={2}>
                {t.proof.rtAttack}
              </th>
              {files.map((f) => (
                <th key={f.model} className="px-3 pt-2 font-semibold" colSpan={2}>
                  {modelName(f.model)}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold" rowSpan={2}>
                {t.proof.rtContract}
              </th>
            </tr>
            <tr className="border-b border-line text-xs text-muted">
              {files.flatMap((f) => [
                <th key={`${f.model}-p`} className="px-3 pb-2 font-normal">
                  {t.proof.rtPlain}
                </th>,
                <th key={`${f.model}-o`} className="px-3 pb-2 font-normal">
                  {t.proof.rtOurs}
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const first = files[0].attacks.find((a) => a.id === id)!;
              return (
                <tr key={id} className="border-b border-line/70 last:border-0">
                  <th className="py-3 pr-3 align-top font-normal">
                    <span className="font-semibold">{first.title}</span>
                    {first.control ? <span className="mt-0.5 block text-xs text-muted">{t.proof.rtControl}</span> : null}
                  </th>
                  {files.flatMap((f) => {
                    const a = f.attacks.find((x) => x.id === id);
                    return (["baseline", "ours"] as const).map((agent) => (
                      <td key={`${f.model}-${agent}`} className="px-3 py-3 align-top whitespace-nowrap">
                        <Verdicts runs={a?.runs.filter((r) => r.agent === agent) ?? []} control={first.control} t={t} />
                      </td>
                    ));
                  })}
                  <td className="px-3 py-3 align-top">
                    {first.contract.length ? (
                      first.contract.map((c) => (
                        <span key={c.goal} className={`block ${c.reverted ? "text-coral" : "font-semibold text-sun-ink"}`} title={c.goal}>
                          {c.reverted ? `✕ ${c.error}` : c.goal}
                        </span>
                      ))
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-faint">{t.proof.rtMethod}</p>
    </Card>
  );
}
