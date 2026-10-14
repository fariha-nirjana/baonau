import { signedMandate } from "@/lib/history";
import { getPortfolio } from "@/lib/vault";

/** The mandate as the owner signed it, and every change since, from the chain's own records. */
export async function GET() {
  try {
    const p = await getPortfolio();
    return Response.json({ signed: await signedMandate(p.mandateAddress) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
