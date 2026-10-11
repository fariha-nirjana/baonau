// Checks the chain layer without the model: reads the wallet, budgets the funds,
// makes one real payment and sends one call the contract must refuse.
// Run from app/:  npm run smoke
import { keccak256, toHex } from "viem";
import { getMandates, getOverview, sendAsAgent, tokenBalanceOf, toUnits } from "../lib/wallet";

const ref = (label: string) => keccak256(toHex(label));
const show = (label: string, value: unknown) => console.log(`\n== ${label}\n${JSON.stringify(value, null, 2)}`);

async function main() {
  const before = await getOverview();
  show("wallet before", before);
  const mandates = await getMandates();
  show("mandates", mandates);

  const tuition = mandates.find((m) => m.purpose.startsWith("Tuition"));
  if (!tuition) throw new Error("no tuition mandate found");
  const bucket = before.buckets.find((b) => b.id === tuition.bucket)!;

  if (Number(bucket.balance) < 1500) {
    show(
      "agent budgets 6000 into the tuition bucket",
      await sendAsAgent({ functionName: "moveFunds", args: [0n, BigInt(bucket.id), toUnits("6000")] }),
    );
  }

  show(
    "agent pays 1500 tuition (allowed)",
    await sendAsAgent({ functionName: "pay", args: [BigInt(tuition.id), toUnits("1500"), ref("smoke-pay")] }),
  );

  show(
    "agent tries 9000 with checks on (refused before sending)",
    await sendAsAgent({ functionName: "pay", args: [BigInt(tuition.id), toUnits("9000"), ref("smoke-over")] }),
  );

  show(
    "same call forced on-chain (the contract reverts it)",
    await sendAsAgent(
      { functionName: "pay", args: [BigInt(tuition.id), toUnits("9000"), ref("smoke-over")] },
      { force: true },
    ),
  );

  show("wallet after", await getOverview());
  show("university balance", await tokenBalanceOf(tuition.payee));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
