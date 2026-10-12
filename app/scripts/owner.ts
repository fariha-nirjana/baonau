// What the owner and the guardian do with their own keys, for the demo. Run from app/:
//   npm run owner -- drafts                 list what the agent has prepared for signing
//   npm run owner -- sign d1                sign a draft (anything that raises risk is only queued)
//   npm run owner -- apply                  apply waiting changes whose delay has passed
//   npm run owner -- approve 3 | reject 3   answer a trade request
//   npm run owner -- pause | unpause | resume-stop-loss
//   npm run owner -- guardian veto mandate|stop-loss-halt|withdrawal-address|IDX|BOND|GOLD
//   npm run owner -- guardian pause | halt-stop-loss | resume-stop-loss | reject 3
import { listDrafts } from "../lib/drafts";
import { applyReady, guardianActions, ownerActions, signDraft, type Vetoable } from "../lib/owner-actions";
import type { TxResult } from "../lib/vault";

const brief = (r: TxResult) =>
  r.ok ? { ok: true, url: r.url, events: r.events.map((e) => e.name) } : { ok: false, stage: r.stage, error: r.error?.name, message: r.error?.explanation ?? r.message };
const out = (label: string, r: TxResult) => console.log(`${label} ${JSON.stringify(brief(r))}`);

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case "drafts":
      for (const d of listDrafts()) {
        console.log(`\n${d.id} [${d.status}] ${d.kind}, risk: ${d.risk}\n  why: ${d.reason}\n${d.summary.map((s) => `  - ${s}`).join("\n")}`);
      }
      return;
    case "sign": {
      const { draft, results } = await signDraft(a);
      console.log(`Signed ${draft.id} (${draft.kind}, risk: ${draft.risk})`);
      results.forEach((r, i) => out(`  tx ${i + 1}:`, r));
      return;
    }
    case "apply": {
      const { applied, waiting } = await applyReady();
      applied.forEach((x) => out(`applied ${x.what}:`, x.result));
      waiting.forEach((x) => console.log(`still waiting: ${x.what}, from ${x.appliesFrom}`));
      if (!applied.length && !waiting.length) console.log("Nothing is waiting.");
      return;
    }
    case "approve":
      return out("approve:", await ownerActions.approveRequest(Number(a)));
    case "reject":
      return out("reject:", await ownerActions.rejectRequest(Number(a)));
    case "pause":
      return out("pause:", await ownerActions.pause());
    case "unpause":
      return out("unpause:", await ownerActions.unpause());
    case "resume-stop-loss":
      return out("resume:", await ownerActions.resumeStopLoss());
    case "guardian":
      switch (a) {
        case "veto":
          return out("veto:", await guardianActions.veto(b as Vetoable));
        case "pause":
          return out("pause:", await guardianActions.pause());
        case "halt-stop-loss":
          return out("halt:", await guardianActions.haltStopLoss());
        case "resume-stop-loss":
          return out("resume:", await guardianActions.resumeStopLoss());
        case "reject":
          return out("reject:", await guardianActions.rejectRequest(Number(b)));
      }
  }
  throw new Error("Unknown command. See the top of scripts/owner.ts for the list.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
