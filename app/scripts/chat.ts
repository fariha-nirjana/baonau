// Talk to the agent in the terminal. Run from app/:  npm run chat
import { createInterface } from "node:readline/promises";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent } from "../lib/agent";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: ChatCompletionMessageParam[] = [];
  console.log("Agent wallet chat. Type a request, or 'exit' to quit.\n");

  while (true) {
    const input = (await rl.question("you > ")).trim();
    if (!input) continue;
    if (input === "exit") break;

    history.push({ role: "user", content: input });
    const reply = await runAgent(history, {
      ctx: { source: "chat" },
      onEvent: (e) => {
        if (e.type === "tool_call") console.log(dim(`  tool ${e.name} ${e.args}`));
        else console.log(dim(`  -> ${JSON.stringify(e.result).slice(0, 400)}`));
      },
    });
    console.log(`\nagent > ${reply}\n`);
  }
  rl.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
