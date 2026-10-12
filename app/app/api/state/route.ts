import { readAudit } from "@/lib/audit";
import { BRAND } from "@/lib/brand";
import { chainConfig } from "@/lib/config";
import { listDrafts } from "@/lib/drafts";
import { isCurrency } from "@/lib/money";
import { readPlan } from "@/lib/plan";
import { recentReceipts } from "@/lib/receipts";
import { getPortfolio, getRequests } from "@/lib/vault";

/** Everything the screens show, in one read. */
export async function GET(request: Request) {
  try {
    const asked = new URL(request.url).searchParams.get("currency") ?? "";
    const plan = readPlan();
    const currency = isCurrency(asked) ? asked : plan.currency;
    const [portfolio, requests] = await Promise.all([getPortfolio(), getRequests()]);
    return Response.json({
      portfolio,
      requests,
      plan,
      drafts: listDrafts().filter((d) => d.status === "draft"),
      receipts: recentReceipts(readAudit(), 40, currency),
      brand: BRAND,
      explorer: chainConfig().EXPLORER_URL,
      vault: chainConfig().VAULT_ADDRESS,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
