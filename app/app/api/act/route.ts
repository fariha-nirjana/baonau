import type { AssetSymbol } from "@/lib/assets";
import { SYMBOLS } from "@/lib/assets";
import { runAutopilot } from "@/lib/autopilot";
import { updateDraft } from "@/lib/drafts";
import { keeperTick, movePrices } from "@/lib/keeper";
import { applyReady, approveRequest, guardianActions, ownerActions, rejectRequest, signDraft, type Vetoable } from "@/lib/owner-actions";

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
