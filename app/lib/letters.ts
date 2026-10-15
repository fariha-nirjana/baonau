import { readJson, writeJson } from "./store";

/**
 * A note the owner writes to their future self, shown back to them when they
 * later ask for more risk. It is kept by the app, not on-chain: it reminds,
 * it does not enforce. The delay and the trusted contact's veto do that.
 */
export type Letter = { text: string; writtenAt: string };

const FILE = "letters.json";
const MAX = 600;

/** Letters are kept per vault, so a fresh vault starts without one. */
export function readLetter(vault: string): Letter | null {
  return readJson<Record<string, Letter>>(FILE, {})[vault.toLowerCase()] ?? null;
}

export function writeLetter(vault: string, text: string): Letter | null {
  const all = readJson<Record<string, Letter>>(FILE, {});
  const clean = text.trim().slice(0, MAX);
  if (!clean) delete all[vault.toLowerCase()];
  else all[vault.toLowerCase()] = { text: clean, writtenAt: new Date().toISOString() };
  writeJson(FILE, all);
  return all[vault.toLowerCase()] ?? null;
}
