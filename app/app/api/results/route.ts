import { readFile } from "node:fs/promises";
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
  return Response.json({ harness: current ? harness : null, outdated: Boolean(harness) && !current, invariants });
}
