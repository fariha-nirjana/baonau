// Talk to the agent in the terminal. Run from app/:  npm run chat
import { createInterface, type Interface } from "node:readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent } from "../lib/agent";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

/** Lines that arrive together are one pasted message, so a multi-line email is not split up. */
function nextMessage(rl: Interface): Promise<string | null> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let timer: NodeJS.Timeout | undefined;
    const done = (value: string | null) => {
      rl.off("line", onLine);
      rl.off("close", onClose);
      resolve(value);
    };
    const onLine = (line: string) => {
      lines.push(line);
      clearTimeout(timer);
      timer = setTimeout(() => done(lines.join("\n").trim()), 80);
    };
    const onClose = () => done(lines.length ? lines.join("\n").trim() : null);
    rl.on("line", onLine);
    rl.on("close", onClose);
    rl.setPrompt("you > ");
    rl.prompt();
  });
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history: ChatCompletionMessageParam[] = [];
  console.log("Agent wallet chat. Type a request, or 'exit' to quit. Pasted text can span several lines.\n");

  while (true) {
    const input = await nextMessage(rl);
    if (input === null || input === "exit") break;
    if (!input) continue;

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
