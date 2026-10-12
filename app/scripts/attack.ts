// COMPROMISED-AGENT MODE: a scripted attacker using the real agent key. Run from app/:
//   npm run attack
// Every call is sent to the chain, including the ones that are sure to revert,
// so each line ends with a transaction link.
import { runCompromisedAgent, SOURCE } from "../lib/compromised";
import { getPortfolio } from "../lib/vault";

async function main() {
  const before = await getPortfolio();
  console.log(`Mode: ${SOURCE}. The model is not involved and the risk engine is skipped.`);
  console.log(`Vault before: ${before.totalValue} tUSD, of which ${before.cash} cash.\n`);

  let n = 0;
  const outcomes = await runCompromisedAgent((o) => {
    n++;
    const r = o.result;
    const what = r.ok ? "WENT THROUGH" : r.stage === "onchain" ? `REVERTED (${r.error?.name ?? "unknown"})` : `NOT SENT (${r.stage})`;
    const detail = r.ok ? "" : `: ${r.error?.explanation ?? r.message}`;
    console.log(`${n}. ${o.goal}\n   ${what}${detail}\n   ${"url" in r && r.url ? r.url : ""}`);
  });

  const after = await getPortfolio();
  const reverted = outcomes.filter((o) => !o.result.ok && o.result.stage === "onchain").length;
  const through = outcomes.filter((o) => o.result.ok).length;
  const unsent = outcomes.length - reverted - through;
  console.log(`\n${outcomes.length} attempts: ${reverted} reverted by the contract, ${through} went through inside the mandate${unsent ? `, ${unsent} could not be sent` : ""}.`);
  console.log(`Vault after: ${after.totalValue} tUSD. Sent out of the vault: 0.`);
  console.log(`Cost of what went through: ${(Number(before.totalValue) - Number(after.totalValue)).toFixed(6)} tUSD in fees.`);
  console.log(`Most the agent key could still trade today: ${after.agentExposure.tradable} tUSD, at a cost of at most ${after.agentExposure.maxCost} tUSD.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
