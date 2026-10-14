// Collects every sentence the app shows to a person into one Markdown file for
// a copy review. Run from app/:  npm run copy
// Output: ../docs/working/copy/copy-review.md (not committed).
//
// Screen text comes from components/i18n.ts with English and Bangla side by
// side. Text that only appears after an event (receipts, rule checks, contract
// refusals, chat cards) is read out of the source files, with {braces} where
// the app fills in a value.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strings } from "../components/i18n";
import { SAY } from "../components/mimo";
import { GATE_LABELS } from "../lib/risk";

const OUT = join(process.cwd(), "..", "docs", "working", "copy", "copy-review.md");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

const lines: string[] = [];
const out = (s = "") => lines.push(s);

out("# Paws for Thought: all the words in the app");
out();
out("How to review: change the text right here, in place (English and Bangla). Add a line starting with `NOTE:` anywhere for a comment or a question. When you're done, the changes are compared with the original and applied in one go.");
out();
out("`{name}`, `{agent}`, `{n}` and other braces are filled in by the app. `<br>` is a line break.");
out();

// ---------------------------------------------------------------- screens
type Tree = { [k: string]: string | Tree };
const en = strings("en") as unknown as Tree;
const bn = strings("bn") as unknown as Tree;
const zh = strings("zh") as unknown as Tree;

const SECTIONS: Record<string, [string, string]> = {
  nav: ["Sidebar menu", "Always visible on the left."],
  shell: ["Sidebar, top bar and banners", "Banners show only when the situation applies (guardian view, stale prices, no agent key)."],
  overview: ["Overview screen", "The first screen."],
  holdings: ["Portfolio screen", "The Portfolio page and its rebalance preview."],
  mandate: ["Mandate screen", "The signed mandate, how changes work, the three roles, stop-loss and protect mode."],
  approvals: ["Approvals screen", "Drafts and trade requests to sign, riskier changes waiting with a countdown, and the explainer."],
  time: ["Countdowns", "How time left is written everywhere."],
  activity: ["Activity screen and receipts", "The decision journal and the receipt that opens from any move."],
  actors: ["Who acted (on receipts)", "Shown on every receipt."],
  gates: ["Rule check names (on receipts)", "The list of checks on every receipt. Replaces the English-only list in Part 4."],
  proof: ["Proof screen", "The harness results and the contract test numbers."],
  chat: ["Chat with Mimo", "The floating chat and its full-window mode."],
  launcher: ["Chat button in the corner", "The line under \"Talk to Mimo\", one per mood."],
  plan: ["Your investment plan card", "Opens from the Overview's top right button."],
  outcome: ["Receipt outcome labels", "The short status on every receipt."],
  mood: ["Mimo's card on the Overview", "\"chip\" is the label under Mimo, \"headline\" the big serif text. One per mood."],
};

function walk(prefix: string, a: Tree, b: Tree, c: Tree, rows: string[][]) {
  for (const [k, v] of Object.entries(a)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      const zhText = (c?.[k] as string | undefined) ?? "";
      rows.push([key, v, (b?.[k] as string) ?? "", zhText === v ? "" : zhText]);
    } else walk(key, v, (b?.[k] as Tree) ?? {}, (c?.[k] as Tree) ?? {}, rows);
  }
}

out("## Part 1: screen text");
out();
out("The Chinese column only lists what is translated so far (key labels); empty means it shows the English.");
out();
for (const [section, [title, where]] of Object.entries(SECTIONS)) {
  out(`### ${title}`);
  out();
  out(`_${where}_`);
  out();
  out("| Key | English | Bangla | Chinese |");
  out("|---|---|---|---|");
  const rows: string[][] = [];
  walk("", en[section] as Tree, bn[section] as Tree, zh[section] as Tree, rows);
  for (const r of rows) out(`| \`${r[0]}\` | ${cell(r[1])} | ${cell(r[2])} | ${cell(r[3])} |`);
  out();
}

// ---------------------------------------------------------------- mascot lines
out("## Part 2: what Mimo says on its card and in the chat button");
out();
out("_The line under the headline on Mimo's card, and the status next to its name. The app picks one by what is happening. `{n}` is a number._");
out();
out("| When | English line | English status | Bangla line | Bangla status |");
out("|---|---|---|---|---|");
const WHEN: Record<string, string> = {
  attack: "The security demo attack is running",
  revertedMany: "Several moves were refused by the contract",
  reverted: "One move was refused by the contract",
  declined: "Mimo said no to something you asked in the chat",
  blocked: "The risk check stopped a move before signing",
  protect: "Protect mode is on (buying paused after a loss)",
  stale: "The price feed is out of date",
  halt: "The guardian halted the stop-loss",
  guardianWaiting: "Guardian view, the owner asked to raise risk",
  holding: "Owner view, a riskier change is waiting",
  down: "The portfolio is down a fair bit today",
  stressed: "Your last chat message sounded stressed",
  thinking: "Mimo is answering or an action is running",
  paused: "The AI is paused",
  moving: "Prices are moving a little",
  calm: "Nothing going on",
  noMandate: "No mandate signed yet",
};
for (const [id, langs] of Object.entries(SAY)) {
  const [el, es] = langs.en!({ n: "{n}" });
  const [bl, bs] = (langs.bn ?? langs.en!)({ n: "{n}" });
  out(`| ${WHEN[id] ?? id} | ${cell(el)} | ${cell(es)} | ${cell(bl)} | ${cell(bs)} |`);
}
out();

// ---------------------------------------------------------------- agent voice
out("## Part 3: how Mimo talks in the chat");
out();
out("_This is the instruction the AI model gets, not text shown on screen. The examples set its tone. Edit the rules or the examples; the model's real replies will vary but follow them._");
out();
const agentSrc = readFileSync(join(process.cwd(), "lib", "agent.ts"), "utf8");
const voice = agentSrc.slice(agentSrc.indexOf("How you talk."), agentSrc.indexOf("Language and money:")).trim();
out("```text");
out(voice);
out("```");
out();

// ---------------------------------------------------------------- event text
out("## Part 4: text that appears after something happens");
out();
out("_Read straight from the code. `{...}` is a value the app fills in, such as an amount, an asset name or a time. Many of these are English only for now; Bangla and Chinese come with the Activity screen._");
out();

out("### Rule check names (the list of checks on every receipt)");
out();
out("| Check | Label |");
out("|---|---|");
for (const [id, label] of Object.entries(GATE_LABELS)) out(`| \`${id}\` | ${cell(label)} |`);
out();

/** Sentences inside quotes or backticks in a source file, with their line numbers. */
function sentences(file: string, from?: string, to?: string): [number, string][] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const start = from ? src.indexOf(from) : 0;
  const end = to ? src.indexOf(to, start) : src.length;
  const found: [number, string][] = [];
  const re = /"((?:[^"\\\n]|\\.){12,})"|`((?:[^`\\]|\\.){12,})`/g;
  for (const m of src.slice(start, end).matchAll(re)) {
    const text = (m[1] ?? m[2]).replace(/\$\{([^}]*)\}/g, (_, inner: string) => `{${inner.trim().replace(/^.*\.(\w+)\)?$/, "$1").slice(0, 24)}}`);
    // keep text a person reads: starts with a capital or a placeholder, has a space, is not code
    if (!/^[A-Z{]/.test(text) || !/\s/.test(text) || /^(import|export)\b/.test(text) || /[;=]{1}\s*$/.test(text)) continue;
    const line = src.slice(0, start + (m.index ?? 0)).split("\n").length;
    found.push([line, text]);
  }
  return found;
}

const EVENT_FILES: [string, string, string, string?, string?][] = [
  ["Rule check results (pass and fail sentences)", "On receipts and chat cards, under each check.", "lib/risk.ts", "function checkLeg", undefined],
  ["Contract refusals", "When the smart contract refuses a move, on receipts and as a red notice.", "lib/errors.ts", "const explain", "const knownErrors"],
  ["Receipts", "Who acted, what happened, and the events the contract recorded.", "lib/receipts.ts"],
  ["Agent tool answers", "What the agent's actions report back; parts show on chat cards.", "lib/tools.ts"],
  ["Owner and guardian buttons", "Results of approve, sign, pause, veto and similar.", "lib/owner-actions.ts"],
  ["Stop-loss keeper", "When the automatic stop-loss runs.", "lib/keeper.ts"],
  ["Scheduled checks", "The recurring buy and rebalance.", "lib/autopilot.ts"],
  ["Compromised agent demo", "The scripted attacker's steps in the security demo.", "lib/compromised.ts"],
  ["Chat action cards", "The card above Mimo's reply when it acted.", "components/Chat.tsx", "const TOOL_LABEL", "export function Chat("],
];
for (const [title, where, file, from, to] of EVENT_FILES) {
  const found = sentences(file, from, to);
  if (!found.length) continue;
  out(`### ${title}`);
  out();
  out(`_${where} Source: \`${file}\`._`);
  out();
  out("| Line | Text |");
  out("|---|---|");
  for (const [line, text] of found) out(`| ${line} | ${cell(text)} |`);
  out();
}

out("## Not in this file yet");
out();
out("Security demo still have their old text. Each one is added here when it is redone.");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT} (${lines.length} lines)`);
