import { readJson, writeJson } from "./store";

/** What the investor told the app about themselves. Only a first name, for greetings. */
export type Profile = { name: string };

const FILE = "profile.json";

export function readProfile(): Profile | null {
  const p = readJson<Profile | null>(FILE, null);
  return p?.name ? p : null;
}

export function writeProfile(name: string): Profile | null {
  const clean = name.trim().slice(0, 40);
  writeJson(FILE, clean ? { name: clean } : null);
  return readProfile();
}
