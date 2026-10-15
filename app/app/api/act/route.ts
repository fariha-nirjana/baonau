import type { AssetSymbol } from "@/lib/assets";
import { SYMBOLS } from "@/lib/assets";
import { runAutopilot } from "@/lib/autopilot";
import { updateDraft } from "@/lib/drafts";
import { writeLetter } from "@/lib/letters";
import { writeProfile } from "@/lib/profile";
import { getPortfolio } from "@/lib/vault";
import { keeperTick, movePrices } from "@/lib/keeper";
import { COMMITMENT_KINDS, parseDue, periodOf, testnetPayee, windowFor, type CommitmentKind } from "@/lib/commitments";
import { isCurrency, toUsd } from "@/lib/money";
import {
  addCommitment,
  applyReady,
  approveRequest,
  commitmentActions,
  guardianActions,
  ownerActions,
  rejectRequest,
  signDraft,
  type Vetoable,
} from "@/lib/owner-actions";

type Body = { role?: "owner" | "guardian" | "demo"; action?: string; arg?: string };

/**
 * The buttons. Owner and guardian actions are signed here with the demo's
 * owner and guardian keys; in a real product each would sign in their own
 * wallet. The agent has no route to any of this.
 */
export async function POST(request: Request) {
  try {
    const { role, action, arg = "" } = (await request.json()) as Body;
    const key = `${role}:${action}`;
    switch (key) {
      case "owner:sign":
        return Response.json(await signDraft(arg));
      case "owner:letter": {
        // only the owner writes their own note; the agent has no route here
        const p = await getPortfolio();
        return Response.json({ ok: true, letter: writeLetter(p.vaultAddress, arg) });
      }
      case "owner:name":
        return Response.json({ ok: true, profile: writeProfile(arg) });
      case "owner:dismiss":
        updateDraft(arg, { status: "dismissed" });
        return Response.json({ ok: true });
      case "owner:apply":
        return Response.json(await applyReady());
      case "owner:approve":
        return Response.json(await approveRequest(arg));
      case "owner:reject":
        return Response.json(await rejectRequest(arg, "owner"));
      case "owner:cancel":
        return Response.json(await ownerActions.cancel(arg as Vetoable | "guardian"));
      case "owner:remove-guardian":
        return Response.json(await ownerActions.removeGuardian());
      case "owner:pause":
        return Response.json(await ownerActions.pause());
      case "owner:unpause":
        return Response.json(await ownerActions.unpause());
      case "owner:resume-stop-loss":
        return Response.json(await ownerActions.resumeStopLoss());
      // ---- commitments: arg is JSON
      case "owner:commitment-add": {
        const a = JSON.parse(arg) as {
          name: string;
          kind: string;
          payeeName: string | null;
          amount: number;
          currency: string;
          every: "month" | "week" | "once" | "days";
          everyDays?: number;
          firstDue: string;
          setAside: number;
          autopay: boolean;
        };
        if (!a.name?.trim() || !COMMITMENT_KINDS.includes(a.kind as CommitmentKind) || !isCurrency(a.currency)) {
          return Response.json({ error: "A commitment needs a name, a kind and a currency." }, { status: 400 });
        }
        const p = await getPortfolio();
        const payee = a.payeeName?.trim() ? testnetPayee(a.payeeName) : null;
        const period = payee ? periodOf(a.every, a.everyDays) : 0;
        const due = payee ? parseDue(a.firstDue, new Date(p.at)) : null;
        if (payee && (!due || due.getTime() <= new Date(p.at).getTime())) return Response.json({ error: "The first due date must be in the future." }, { status: 400 });
        return Response.json(
          await addCommitment(
            {
              id: null,
              terms: payee
                ? { payee, maxAmountUsd: toUsd(a.amount, a.currency), periodSeconds: period, windowSeconds: windowFor(period), nextDue: due!.toISOString() }
                : { payee: null, maxAmountUsd: "0", periodSeconds: 0, windowSeconds: 0, nextDue: null },
              meta: { name: a.name.trim(), kind: a.kind as CommitmentKind, payeeName: a.payeeName?.trim() || null, autopay: Boolean(a.autopay) },
              amountUsd: toUsd(a.setAside || 0, a.currency),
            },
            "Owner added a commitment",
          ),
        );
      }
      case "owner:commitment-set-aside":
      case "owner:commitment-release":
      case "owner:commitment-pay": {
        const a = JSON.parse(arg) as { id: number; amount: number; currency: string; request?: string };
        if (!isCurrency(a.currency) && a.currency !== "tUSD") return Response.json({ error: "Unknown currency." }, { status: 400 });
        const usd = a.currency === "tUSD" ? String(a.amount) : toUsd(a.amount, a.currency);
        if (action === "commitment-set-aside") return Response.json(await commitmentActions.setAside(a.id, usd));
        if (action === "commitment-release") return Response.json(await commitmentActions.release(a.id, usd));
        return Response.json(await commitmentActions.payNow(a.id, usd, a.request));
      }
      case "owner:commitment-remove":
        return Response.json(await commitmentActions.remove(Number(arg)));
      case "owner:commitment-autopay": {
        const a = JSON.parse(arg) as { id: number; on: boolean };
        return Response.json(commitmentActions.setAutopay(a.id, a.on));
      }
      case "owner:payment-dismiss":
        return Response.json(commitmentActions.dismissRequest(arg));
      case "guardian:veto":
        return Response.json(await guardianActions.veto(arg as Vetoable));
      case "guardian:pause":
        return Response.json(await guardianActions.pause());
      case "guardian:halt-stop-loss":
        return Response.json(await guardianActions.haltStopLoss());
      case "guardian:resume-stop-loss":
        return Response.json(await guardianActions.resumeStopLoss());
      case "guardian:unpause":
        return Response.json(await guardianActions.unpause());
      case "guardian:veto-own-removal":
        return Response.json(await guardianActions.vetoOwnRemoval());
      case "demo:keeper":
        return Response.json(await keeperTick({ refresh: arg === "refresh" }));
      case "demo:price": {
        const [symbol, price] = arg.split("=");
        if (!SYMBOLS.includes(symbol as AssetSymbol) || !(Number(price) > 0)) {
          return Response.json({ error: "Use SYMBOL=price." }, { status: 400 });
        }
        const moved = await movePrices({ [symbol]: Number(price) });
        return Response.json({ prices: moved.prices, keeper: await keeperTick() });
      }
      case "demo:autopilot":
        return Response.json(await runAutopilot());
    }
    return Response.json({ error: `Unknown action ${key}.` }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
