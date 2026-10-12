"use client";

import { useEffect, useRef, useState } from "react";
import { Mascot } from "./Mascot";
import type { AppState, Mood, Settings, View } from "./types";
import { Chip } from "./ui";

type Step = { tool: string; result: Record<string, unknown> };
type Message = { role: "user" | "assistant"; content: string; steps?: Step[] };

const SUGGESTIONS: Record<Settings["language"], string[]> = {
  en: ["What's in my portfolio?", "What are my rules?", "Rebalance to my plan", "What happened today?"],
  zh: ["我的投资组合里有什么？", "我的规则是什么？", "按计划再平衡", "今天发生了什么？"],
  bn: ["আমার পোর্টফোলিওতে কী আছে?", "আমার নিয়মগুলো কী?", "পরিকল্পনা অনুযায়ী সাজাও", "আজ কী হয়েছে?"],
};

const TOOL_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  rebalance: "Rebalance",
  request_owner_approval: "Request to you",
  draft_mandate: "Mandate draft",
  request_stop_loss_halt: "Stop-loss halt request",
};

function StepCard({ step, go }: { step: Step; go: (v: View) => void }) {
  const r = step.result;
  const ok = r.ok === true;
  const draft = typeof r.draft_id === "string";
  const tone = draft || r.escalated ? "warn" : ok ? "good" : r.stage === "risk" ? "warn" : "bad";
  const status = draft
    ? "Ready for you to sign"
    : r.escalated
      ? "Sent for your approval"
      : ok
        ? "Done"
        : r.stage === "risk"
          ? "Stopped by the risk check"
          : "Refused by the contract";
  const detail =
    (r.what_happens_next as string | undefined) ??
    (r.message as string | undefined) ??
    ((r.error as { explanation?: string } | null | undefined)?.explanation ?? "");
  return (
    <div className="slide-in rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{TOOL_LABEL[step.tool] ?? step.tool}</span>
        <Chip tone={tone}>{status}</Chip>
      </div>
      {detail ? <p className="mt-2 text-base text-muted">{detail}</p> : null}
      <div className="mt-2 flex gap-4 text-base font-semibold text-leaf">
        {typeof r.url === "string" ? (
          <a href={r.url} target="_blank" rel="noreferrer" className="underline">
            View transaction
          </a>
        ) : null}
        {draft || r.escalated ? (
          <button onClick={() => go("approvals")} className="underline">
            Open approvals
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Chat({ state, settings, mood, go, refresh }: { state: AppState; settings: Settings; mood: Mood; go: (v: View) => void; refresh: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces on purpose: newer browsers return a promise from scrollIntoView, and an effect must not return one
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), language: settings.language, currency: settings.currency }),
      });
      const data = (await res.json()) as { reply?: string; steps?: Step[]; error?: string };
      setMessages([...next, { role: "assistant", content: data.reply ?? `Something went wrong: ${data.error}`, steps: data.steps }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `I could not reach the server: ${err instanceof Error ? err.message : err}` }]);
    }
    setBusy(false);
    refresh();
  }

  return (
    <aside className="flex h-full w-[27rem] shrink-0 flex-col border-l border-line bg-card">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <div className="rounded-2xl bg-sun p-1">
          <Mascot mood={mood} size={44} />
        </div>
        <div className="flex-1">
          <p className="font-display text-xl font-semibold">{state.brand.agent}</p>
          <p className="text-sm text-muted">{state.brand.agentRole}</p>
        </div>
        <Chip tone={state.portfolio.agent.paused ? "warn" : "good"}>{state.portfolio.agent.paused ? "Paused" : "Online"}</Chip>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {messages.length === 0 ? (
          <div className="rounded-2xl bg-mint p-4 text-base">
            <p className="font-semibold">I manage your portfolio inside the mandate you signed.</p>
            <p className="mt-1 text-muted">Ask me anything, in English, 中文 or বাংলা. I can trade, but I cannot change your rules or move money out.</p>
          </div>
        ) : null}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-10 rounded-2xl rounded-br-md bg-forest px-4 py-3 text-base text-white">
              {m.content}
            </div>
          ) : (
            <div key={i} className="space-y-3">
              {m.steps?.map((s, j) => <StepCard key={j} step={s} go={go} />)}
              <div className="mr-6 whitespace-pre-wrap rounded-2xl rounded-bl-md bg-cream px-4 py-3 text-base leading-relaxed">{m.content}</div>
            </div>
          ),
        )}
        {busy ? <p className="text-base text-muted">{state.brand.agent} is checking your mandate…</p> : null}
        <div ref={end} />
      </div>

      <footer className="border-t border-line px-6 py-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS[settings.language].map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-cream disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${state.brand.agent} about your money`}
            className="min-w-0 flex-1 rounded-xl border border-line bg-cream px-4 py-3 text-base outline-none focus:border-leaf"
          />
          <button type="submit" disabled={busy || !input.trim()} className="rounded-xl bg-forest px-5 text-base font-semibold text-white disabled:opacity-40">
            Send
          </button>
        </form>
        <p className="mt-2 text-center text-sm text-muted">Every action is checked against your mandate on-chain.</p>
      </footer>
    </aside>
  );
}
