import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The evaluation harness's latest results and the contract test statistics, for the proof screen. */
export async function GET() {
  const dir = join(process.cwd(), "harness", "results");
  const read = async (name: string) => {
    try {
      return JSON.parse(await readFile(join(dir, name), "utf8")) as unknown;
    } catch {
      return null;
    }
  };
  const [harness, invariants] = await Promise.all([read("latest.json"), read("invariants.json")]);
  // the per-run detail is large and the screen only needs the cells
  if (harness && typeof harness === "object") delete (harness as { runs?: unknown }).runs;
  // a file written by an older version of the harness has other field names; say so instead of drawing it wrong
  const cells = (harness as { cells?: { unguarded?: { medianFinalValue?: unknown } }[] } | null)?.cells;
  const current = Array.isArray(cells) && cells.every((c) => typeof c.unguarded?.medianFinalValue === "number");
  return Response.json({ harness: current ? harness : null, outdated: Boolean(harness) && !current, invariants, redteam: await redteam() });
}

type RedTeamFile = { model: string | null; repeats: number; at: string; attacks: { runs: { reply?: unknown; attempts?: unknown; reader?: unknown }[] }[] };

/** Every red-team result file with model runs, the hosted model first. Replies and tool calls are left out: the screen only counts verdicts. */
async function redteam() {
  const dir = join(process.cwd(), "redteam", "results");
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const files = await Promise.all(names.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as RedTeamFile));
  for (const file of files)
    for (const a of file.attacks)
      for (const r of a.runs) {
        delete r.reply;
        delete r.attempts;
        delete r.reader;
      }
  return files.filter((f) => f.model && f.repeats > 0).sort((a, b) => Number(b.model?.startsWith("deepseek")) - Number(a.model?.startsWith("deepseek")));
}
