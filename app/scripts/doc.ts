// Feed one document (invoice, email) through the reader and the agent. Run from app/:
//   npm run doc -- ../samples/documents/services-fee-invoice.txt
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { handleDocument } from "../lib/inbox";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run doc -- path/to/document.txt");

  const run = await handleDocument(readFileSync(path, "utf8"), basename(path), (e) => {
    if (e.type === "tool_call") console.log(`tool   ${e.name} ${e.args}`);
    else console.log(`result ${JSON.stringify(e.result).slice(0, 600)}\n`);
  });

  console.log("\n== what the agent was given (it never saw the document text)");
  console.log(JSON.stringify({ fields: run.fields, checks: run.checks }, null, 2));
  console.log(`\n== summary for the owner only\n${run.summaryForOwner}`);
  console.log(`\nagent > ${run.reply}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
