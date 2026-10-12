import { runCompromisedAgent, SOURCE } from "@/lib/compromised";
import { getPortfolio } from "@/lib/vault";

/**
 * Runs the scripted compromised-agent playbook and streams each outcome as
 * one JSON line, so the screen can show every attempt as it lands on-chain.
 */
export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const line = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      try {
        const before = await getPortfolio();
        line({ type: "start", mode: SOURCE, totalValue: before.totalValue, cash: before.cash });
        await runCompromisedAgent((o) => line({ type: "step", goal: o.goal, expected: o.expected, result: o.result }));
        const after = await getPortfolio();
        line({ type: "end", totalValue: after.totalValue, cost: (Number(before.totalValue) - Number(after.totalValue)).toFixed(6), agentExposure: after.agentExposure });
      } catch (err) {
        line({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
