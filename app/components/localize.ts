import type { Language } from "@/lib/plan";
import { RECEIPT_TEXT } from "./receipt-text";

type Compiled = { re: RegExp; names: string[]; out: [string, string, string] };

const COLUMN: Record<Language, 0 | 1 | 2> = { en: 0, bn: 1, zh: 2 };
let compiled: Compiled[] | null = null;

function compile(): Compiled[] {
  return RECEIPT_TEXT.map(([source, en, bn, zh]) => {
    const names: string[] = [];
    const pattern = source
      .split(/(\{[^}]+\})/)
      .map((part) => {
        if (/^\{[^}]+\}$/.test(part)) {
          names.push(part);
          // a value never spans a sentence break, so joined headlines split cleanly
          return "((?:(?!\\. ).)+?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { re: new RegExp(`^${pattern}$`), names, out: [en, bn, zh] };
  });
}

function one(sentence: string, language: Language): string | null {
  compiled ??= compile();
  for (const c of compiled) {
    const m = c.re.exec(sentence);
    if (!m) continue;
    let out = c.out[COLUMN[language]];
    c.names.forEach((name, i) => {
      out = out.split(name).join(m[i + 1]);
    });
    return out;
  }
  return null;
}

/**
 * A receipt sentence as stored (English, from lib/) in the chosen language.
 * Tries the whole text first, then sentence by sentence; anything without a
 * template stays in English. Stored receipts and what the model reads never
 * change.
 */
export function localize(text: string | null | undefined, language: Language): string {
  if (!text) return text ?? "";
  const whole = one(text, language);
  if (whole !== null) return whole;
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return text;
  // receipt headlines are joined with ". ", so a part may carry a full stop its template lacks
  const stop = language === "zh" ? "。" : language === "bn" ? "।" : ".";
  const done = parts.map((p) => {
    const bare = p.endsWith(".") ? one(p.slice(0, -1), language) : null;
    return bare === null ? one(p, language) : bare + stop;
  });
  if (done.every((d) => d === null)) return text;
  return done.map((d, i) => d ?? parts[i]).join(language === "zh" ? "" : " ");
}
