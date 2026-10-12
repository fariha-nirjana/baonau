// Checks the chain layer without the model: reads the vault, makes one small
// real trade and sends one call the contract must refuse.
// Run from app/:  npm run smoke
import { keccak256, toHex } from "viem";
import { assets } from "../lib/assets";
import { getPortfolio, sendAsAgent, toUsdUnits } from "../lib/vault";

const ref = (label: string) => keccak256(toHex(label));
const show = (label: string, value: unknown) => console.log(`\n== ${label}\n${JSON.stringify(value, null, 2)}`);

async function main() {
  const before = await getPortfolio();
  show("portfolio", before);
  if (before.positions.some((p) => p.priceIsStale)) {
    console.log("\nPrices are out of date. Run `npm run keeper -- --refresh` first, then run this again.");
    return;
  }
  const bond = assets().BOND.address;
  const small = toUsdUnits((Number(before.today.maxTrade) / 4).toFixed(6));
  const tooBig = toUsdUnits((Number(before.today.maxTrade) * 3).toFixed(6));

  show("agent buys a little of the bond fund (allowed)", await sendAsAgent({ functionName: "buy", args: [bond, small, ref("smoke-buy")] }));
  show("agent tries three times the trade limit (refused in simulation, nothing sent)", await sendAsAgent({ functionName: "buy", args: [bond, tooBig, ref("smoke-over")] }));
  show("same call forced on-chain (the contract reverts it)", await sendAsAgent({ functionName: "buy", args: [bond, tooBig, ref("smoke-over")] }, { force: true }));
  const after = await getPortfolio();
  show("after", { totalValue: after.totalValue, cash: after.cash, bond: after.positions.find((p) => p.symbol === "BOND")?.amount, agentExposure: after.agentExposure });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
