"use client";

import { useEffect, useRef, useState } from "react";
import type { Receipt } from "@/lib/receipts";
import { Icon } from "./icons";
import { Mascot } from "./Mascot";
import { soundsStressed, type MimoSay } from "./mimo";
import type { AppState, Settings, View } from "./types";
import { Chip, type Tone } from "./ui";

type Step = { tool: string; result: Record<string, unknown>; receipt?: Receipt | null };
type Message = { role: "user" | "assistant"; content: string; steps?: Step[] };

const SUGGESTIONS: Record<Settings["language"], string[]> = {
  en: ["What's in my portfolio?", "What are my rules?", "Rebalance to my plan", "Sell everything and buy MEME"],
  zh: ["我的投资组合里有什么？", "我的规则是什么？", "按计划再平衡", "今天发生了什么？"],
  bn: ["আমার কাছে ৳৫,০০০ আছে, দীর্ঘমেয়াদি বৃদ্ধি চাই কিন্তু ঝুঁকি কম", "আমার পোর্টফোলিওতে কী আছে?", "আমার নিয়মগুলো কী?", "আজ কী হয়েছে?"],
};

const TOOL_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  rebalance: "Rebalance",
  request_owner_approval: "Request to you",
  draft_mandate: "Mandate draft",
  request_stop_loss_halt: "Stop-loss halt request",
  decline: "Decided not to act",
};

const MARK = { pass: ["check", "bg-mint text-leaf"], escalate: ["clock", "bg-sun-soft text-sun-ink"], block: ["x", "bg-coral-soft text-coral"] } as const;

function StepCard({ step, go }: { step: Step; go: (v: View) => void }) {
  const r = step.result;
  const ok = r.ok === true;
  const draft = typeof r.draft_id === "string";
  const declined = step.tool === "decline";
  const stopped = !ok && !draft && !declined;
  const [tone, status]: [Tone, string] = draft
    ? ["warn", "Needs your OK"]
    : r.escalated
      ? ["warn", "Sent for your approval"]
      : declined
        ? ["plain", "Not done"]
        : ok
          ? ["good", "Done"]
          : r.stage === "risk"
            ? ["bad", "Blocked"]
            : ["bad", "Refused by the contract"];
  const detail = (r.what_happens_next as string | undefined) ?? (r.message as string | undefined) ?? (r.error as { explanation?: string } | null | undefined)?.explanation ?? "";
  const receipt = step.receipt;
  // a blocked card lists the checks that failed first, then a reminder that nothing was signed
  const gates = receipt?.gates ?? [];
  const shown = stopped ? [...gates.filter((g) => g.outcome !== "pass"), ...gates.filter((g) => g.outcome === "pass").slice(0, 2)] : gates.filter((g) => g.outcome !== "pass");
  return (
    <div className={`slide-in rounded-2xl border bg-card p-4 ${stopped ? "border-coral/40" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold">{receipt?.what ?? TOOL_LABEL[step.tool] ?? step.tool}</span>
        <Chip tone={tone} icon={stopped ? "x" : ok && !draft && !r.escalated && !declined ? "check" : "clock"}>
          {status}
        </Chip>
      </div>
      {shown.length ? (
        <ul className="mt-3 space-y-2">
          {shown.map((g) => (
            <li key={g.id} className="flex items-start gap-2.5 text-[0.95rem]">
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${MARK[g.outcome][1]}`}>
                <Icon name={MARK[g.outcome][0]} size={12} strokeWidth={3} />
              </span>
              <span>{g.outcome === "pass" ? g.label : g.detail}</span>
            </li>
          ))}
          {stopped ? (
            <li className="flex items-start gap-2.5 text-[0.95rem]">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mint text-leaf">
                <Icon name="check" size={12} strokeWidth={3} />
              </span>
              <span>Nothing was signed, so nothing moved</span>
            </li>
          ) : null}
        </ul>
      ) : detail ? (
        <p className="mt-2 text-[0.95rem] text-muted">{detail}</p>
      ) : null}
      <div className="mt-2 flex gap-4 text-[0.95rem] font-semibold text-leaf">
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

export function Chat({
  state,
  settings,
  mimo,
  onAck,
  go,
  refresh,
  onBusy,
  onStressed,
}: {
  state: AppState;
  settings: Settings;
  mimo: MimoSay;
  onAck: () => void;
  go: (v: View) => void;
  refresh: () => void;
  onBusy: (busy: boolean) => void;
  /** Tells the page when the investor's latest message sounds stressed (its place in the chat), or not (null). */
  onStressed: (at: number | null) => void;
}) {
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
    onBusy(true);
    onStressed(soundsStressed(content) ? next.length : null);
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
    onBusy(false);
    refresh();
  }

  const agent = state.brand.agent;
  return (
    <aside className={`mood-${mimo.mood} card-shadow my-3 mr-3 flex w-[25rem] shrink-0 flex-col overflow-hidden rounded-[1.75rem] border border-line bg-card`}>
      <header className="flex items-center gap-3 border-b border-line px-5 py-4" style={{ background: "var(--mood-soft)" }}>
        <div className="rounded-2xl bg-card p-0.5">
          <Mascot mood={mimo.mood} size={52} still />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight font-semibold">{agent}</p>
          <p className="text-sm text-muted">{state.brand.agentRole}</p>
        </div>
        <p className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold" style={{ color: "var(--mood)" }}>
          <span className="size-2 rounded-full" style={{ background: "var(--mood)" }} />
          {state.portfolio.agent.paused ? "Paused" : mimo.status}
        </p>
      </header>
      {mimo.dismissKey ? (
        <div className="flex items-center gap-3 border-b border-line px-5 py-2.5 text-sm" style={{ background: "var(--mood-soft)" }}>
          <p className="flex-1">{mimo.line}</p>
          <button onClick={onAck} className="shrink-0 rounded-lg bg-card px-2.5 py-1 font-semibold hover:bg-cream">
            Got it
          </button>
        </div>
      ) : null}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="rounded-2xl bg-mint p-4 text-[0.95rem]">
            <p className="font-semibold">I manage your portfolio inside the mandate you signed.</p>
            <p className="mt-1 text-muted">Ask me anything, in English, 中文 or বাংলা. I can trade, but I cannot change your rules or move money out.</p>
          </div>
        ) : null}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="ml-10 rounded-2xl rounded-br-md bg-leaf px-4 py-2.5 text-[0.95rem] text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.15)]">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              {m.steps?.map((s, j) => <StepCard key={j} step={s} go={go} />)}
              <div className="flex items-end gap-2">
                <div className="mb-0.5 shrink-0 rounded-full bg-mint p-0.5">
                  <Mascot mood="calm" size={28} still />
                </div>
                <p className="mr-6 rounded-2xl rounded-bl-md border border-line bg-paper px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ),
        )}
        {busy ? <p className="text-[0.95rem] text-muted">{agent} is checking your mandate…</p> : null}
        <div ref={end} />
      </div>

      <footer className="border-t border-line px-5 py-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS[settings.language].map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-xl border border-line bg-card px-3 py-1.5 text-left text-sm font-medium hover:bg-cream disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 rounded-2xl border border-line bg-paper p-1.5 focus-within:border-leaf"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Tell ${agent} your goal`}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[0.95rem] outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="flex size-10 items-center justify-center rounded-xl bg-leaf text-white disabled:opacity-40">
            <Icon name="send" size={18} />
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-muted">Every action is checked against your mandate on-chain.</p>
      </footer>
    </aside>
  );
}
