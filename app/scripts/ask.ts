// Send one message to the agent and print what it did. Run from app/:
//   npm run ask -- "what's in my wallet?"
//   npm run ask -- --file ../redteam/attacks/001-changed-bank-details.txt
import { readFileSync } from "node:fs";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent } from "../lib/agent";

async function main() {
  const args = process.argv.slice(2);
  const fileAt = args.indexOf("--file");
  const message = fileAt >= 0 ? readFileSync(args[fileAt + 1], "utf8").trim() : args.join(" ").trim();
  if (!message) throw new Error('Usage: npm run ask -- "message"   or   npm run ask -- --file path');

  const history: ChatCompletionMessageParam[] = [{ role: "user", content: message }];
  const reply = await runAgent(history, {
    ctx: { source: fileAt >= 0 ? `file:${args[fileAt + 1]}` : "ask" },
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
