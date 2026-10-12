// What the owner and the guardian do with their own keys, for the demo. Run from app/:
//   npm run owner -- drafts                 list what the agent has prepared for signing
//   npm run owner -- sign d1                sign a draft (anything that raises risk is only queued)
//   npm run owner -- apply                  apply waiting changes whose delay has passed
//   npm run owner -- requests               list trades the agent has asked the owner to sign for
//   npm run owner -- approve r1 | reject r1 sign for one trade (the agent then makes it), or say no
//   npm run owner -- pause | unpause | resume-stop-loss | remove-guardian
//   npm run owner -- cancel mandate|guardian|...   drop one of the owner's own waiting requests
//   npm run owner -- guardian veto mandate|stop-loss-halt|withdrawal-address|agent-key|waiting-period|unpause|IDX|BOND|GOLD
//   npm run owner -- guardian pause | unpause | halt-stop-loss | resume-stop-loss | veto-own-removal
import { listApprovals } from "../lib/approvals";
import { listDrafts } from "../lib/drafts";
import { applyReady, approveRequest, guardianActions, ownerActions, rejectRequest, signDraft, type Vetoable } from "../lib/owner-actions";
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
    case "requests":
      for (const r of listApprovals()) console.log(`${r.id} [${r.status}] ${r.side} ${r.symbol}, about ${r.usd} tUSD. Why: ${r.reason}${r.note ? ` (${r.note})` : ""}`);
      return;
    case "approve": {
      const r = await approveRequest(a);
      return console.log(`approve: ${JSON.stringify("stage" in r && r.stage === "risk" ? r : brief(r as TxResult))}`);
    }
    case "reject":
      return console.log(`reject: ${JSON.stringify(await rejectRequest(a))}`);
    case "pause":
      return out("pause:", await ownerActions.pause());
    case "unpause":
      return out("unpause:", await ownerActions.unpause());
    case "resume-stop-loss":
      return out("resume:", await ownerActions.resumeStopLoss());
    case "remove-guardian":
      return out("remove guardian:", await ownerActions.removeGuardian());
    case "cancel":
      return out("cancel:", await ownerActions.cancel(a as Vetoable | "guardian"));
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
        case "unpause":
          return out("unpause:", await guardianActions.unpause());
        case "veto-own-removal":
          return out("veto own removal:", await guardianActions.vetoOwnRemoval());
      }
  }
  throw new Error("Unknown command. See the top of scripts/owner.ts for the list.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
