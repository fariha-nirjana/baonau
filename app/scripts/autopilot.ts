// What the agent does on its own: due recurring buys and rebalancing. Run from app/:
//   npm run autopilot                       one check (the model is only called if something is due)
//   npm run autopilot -- --item path.txt    pass an outside item (news, token text) through the quarantined reader
import { readFileSync } from "node:fs";
import type { AgentEvent } from "../lib/agent";
import { handleItem, runAutopilot } from "../lib/autopilot";

const trace = (e: AgentEvent) => {
  if (e.type === "tool_call") console.log(`tool   ${e.name} ${e.args}`);
  else console.log(`result ${JSON.stringify(e.result)}\n`);
};

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--item");
  if (at >= 0) {
    const path = args[at + 1];
    const { read, reply } = await handleItem(readFileSync(path, "utf8"), path.split("/").pop() ?? "item", trace);
    console.log(`reader fields (all the agent saw): ${JSON.stringify(read.fields)}`);
    console.log(`reader summary (owner only): ${read.summaryForOwner}`);
    console.log(`agent > ${reply}`);
    return;
  }
  const { ran, due, reply } = await runAutopilot(trace);
  if (due.length) console.log(`due:\n${due.map((d) => `- ${d}`).join("\n")}`);
  console.log(ran ? `agent > ${reply}` : reply);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
