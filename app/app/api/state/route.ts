import { listApprovals } from "@/lib/approvals";
import { readAudit } from "@/lib/audit";
import { BRAND } from "@/lib/brand";
import { chainConfig } from "@/lib/config";
import { listDrafts } from "@/lib/drafts";
import { readLetter } from "@/lib/letters";
import { readProfile } from "@/lib/profile";
import { isCurrency } from "@/lib/money";
import { readPlan } from "@/lib/plan";
import { recentReceipts } from "@/lib/receipts";
import { recordValue } from "@/lib/values";
import { getPortfolio } from "@/lib/vault";

/** Everything the screens show, in one read. */
export async function GET(request: Request) {
  try {
    const asked = new URL(request.url).searchParams.get("currency") ?? "";
    const plan = readPlan();
    const currency = isCurrency(asked) ? asked : plan.currency;
    const portfolio = await getPortfolio();
    const history = recordValue({ at: portfolio.at, value: Number(portfolio.totalValue) });
    return Response.json({
      portfolio,
      history,
      requests: listApprovals().filter((r) => r.status === "waiting" || r.status === "signed"),
      plan,
      drafts: listDrafts().filter((d) => d.status === "draft"),
      receipts: recentReceipts(readAudit(), 40, currency),
      brand: BRAND,
      explorer: chainConfig().EXPLORER_URL,
      vault: portfolio.vaultAddress,
      mandate: portfolio.mandateAddress,
      letter: readLetter(portfolio.vaultAddress),
      profile: readProfile(),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
