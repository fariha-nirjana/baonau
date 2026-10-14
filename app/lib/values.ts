import { readJson, writeJson } from "./store";

/**
 * Portfolio value as the app has read it from the vault, for the chart on
 * the first screen. Only real readings go in: nothing is back-filled or
 * recomputed from today's holdings.
 */
export type ValuePoint = { at: string; value: number };

const FILE = "values.json";
const KEEP = 500;
/** Readings closer together than this are not stored, so polling does not flood the file. */
const SPACING_MS = 60_000;

export function recordValue(point: ValuePoint): ValuePoint[] {
  const points = readJson<ValuePoint[]>(FILE, []);
  const last = points[points.length - 1];
  const changed = !last || Math.abs(last.value - point.value) > 1e-9;
  const due = !last || new Date(point.at).getTime() - new Date(last.at).getTime() >= SPACING_MS;
  // a changed value is stored at once, so a trade shows on the chart straight away
  if (changed || due) {
    points.push(point);
    writeJson(FILE, points.slice(-KEEP));
  }
  return points.slice(-KEEP);
}
