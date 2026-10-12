import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Small JSON files under data/ (not committed). Enough for a single-user demo; a product would use a database. */
export function dataPath(name: string) {
  return join(process.cwd(), "data", name);
}

export function readJson<T>(name: string, fallback: T): T {
  const path = dataPath(name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown) {
  const path = dataPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
