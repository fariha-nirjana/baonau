import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runAgent } from "@/lib/agent";
import { readAudit } from "@/lib/audit";
import { refreshIfStale } from "@/lib/keeper";
import { recentReceipts } from "@/lib/receipts";
import { isCurrency } from "@/lib/money";
import type { Language } from "@/lib/plan";

type Body = { messages?: { role: "user" | "assistant"; content: string }[]; language?: string; currency?: string; name?: string };

/** One turn of the conversation with the agent. The reply comes back with what each tool did. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const messages = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return Response.json({ error: "Send at least one user message." }, { status: 400 });
    }
    const language = (["en", "zh", "bn"].includes(body.language ?? "") ? body.language : "en") as Language;
    const currency = isCurrency(body.currency ?? "") ? (body.currency as "BDT" | "CNY" | "USD") : "BDT";

    const history: ChatCompletionMessageParam[] = messages.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    const steps: { tool: string; result: unknown }[] = [];
    await refreshIfStale();
    const reply = await runAgent(history, {
      ctx: { source: "chat", language, currency, name: typeof body.name === "string" ? body.name.trim().slice(0, 40) : undefined },
      onEvent: (e) => {
        // only actions are shown as cards; plain reads would be noise
        if (e.type === "tool_result" && !e.name.startsWith("get_")) steps.push({ tool: e.name, result: e.result });
      },
    });
    // each card carries the receipt of its action, so the chat can show the same checks as the activity screen
    const receipts = recentReceipts(readAudit(), 40, currency);
    const withReceipts = steps.map((s) => {
      const ref = (s.result as { audit_ref?: string } | null)?.audit_ref;
      return { ...s, receipt: ref ? (receipts.find((r) => r.ref === ref) ?? null) : null };
    });
    return Response.json({ reply, steps: withReceipts });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
