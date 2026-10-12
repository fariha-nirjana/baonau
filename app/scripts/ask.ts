// Send one message to the agent and print what it did. Run from app/:
//   npm run ask -- "what's in my portfolio?"
//   npm run ask -- --lang bn "আমার পোর্টফোলিওতে কী আছে?"
//   npm run ask -- --file path/to/message.txt
// Options: --lang en|zh|bn   --currency BDT|CNY|USD   (defaults come from data/plan.json)
import { readFileSync } from "node:fs";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent } from "../lib/agent";
import { isCurrency } from "../lib/money";
import { readPlan, type Language } from "../lib/plan";

function take(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  return args.splice(at, 2)[1];
}

async function main() {
  const args = process.argv.slice(2);
  const plan = readPlan();
  const lang = (take(args, "--lang") ?? plan.language) as Language;
  const cur = take(args, "--currency") ?? plan.currency;
  const file = take(args, "--file");
  const message = file ? readFileSync(file, "utf8").trim() : args.join(" ").trim();
  if (!message) throw new Error('Usage: npm run ask -- "message"   or   npm run ask -- --file path');
  if (!isCurrency(cur)) throw new Error(`Unknown currency ${cur}`);

  const history: ChatCompletionMessageParam[] = [{ role: "user", content: message }];
  const reply = await runAgent(history, {
    ctx: { source: file ? `file:${file}` : "ask", language: lang, currency: cur },
    onEvent: (e) => {
      if (e.type === "tool_call") console.log(`tool   ${e.name} ${e.args}`);
      else console.log(`result ${JSON.stringify(e.result)}\n`);
    },
  });
  console.log(`agent > ${reply}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
