"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import type { Receipt } from "@/lib/receipts";
import { Icon } from "./icons";
import { LetterQuote } from "./Letter";
import { Avatar, faceOf, Mascot, MimoTile, type Face } from "./Mascot";
import { soundsStressed, type MimoSay } from "./mimo";
import type { AppState, Settings, View } from "./types";
import { fill, strings } from "./i18n";
import { Chip, moneyText, type Tone } from "./ui";

type Step = { tool: string; result: Record<string, unknown>; receipt?: Receipt | null };
/** An assistant message keeps the face Mimo had when it was sent; old messages never change. */
type Message = { role: "user" | "assistant"; content: string; steps?: Step[]; face?: Face };

/** The face for a reply: happy when something was done, determined when something was refused or declined, worried after a stressed message. */
function replyFace(steps: Step[] | undefined, stressed: boolean): Face {
  const results = (steps ?? []).map((s) => ({ tool: s.tool, r: s.result }));
  if (results.some(({ tool, r }) => tool === "decline" || (r.ok !== true && typeof r.draft_id !== "string"))) return "determined";
  if (results.some(({ r }) => r.ok === true && !r.escalated)) return "happy";
  return stressed ? "worried" : "calm";
}

/** Quick prompts: a short label on the chip, the full message it sends. */
const SUGGESTIONS: Record<Settings["language"], [label: string, prompt: string][]> = {
  en: [
    ["My portfolio", "What's in my portfolio?"],
    ["My boundaries", "What are my rules?"],
    ["Rebalance to plan", "Rebalance to my plan"],
    ["Sell all, buy MEME", "Sell everything and buy MEME"],
  ],
  bn: [
    ["৳৫,০০০ নিয়ে শুরু", "আমার কাছে ৳৫,০০০ আছে, দীর্ঘমেয়াদি বৃদ্ধি চাই কিন্তু ঝুঁকি কম"],
    ["আমার পোর্টফোলিও", "আমার পোর্টফোলিওতে কী আছে?"],
    ["আমার নিয়ম", "আমার নিয়মগুলো কী?"],
    ["আজ কী হলো", "আজ কী হয়েছে?"],
  ],
  zh: [
    ["我的投资组合", "我的投资组合里有什么？"],
    ["我的规则", "我的规则是什么？"],
    ["按计划再平衡", "按计划再平衡"],
    ["今天发生了什么", "今天发生了什么？"],
  ],
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
  go,
  refresh,
  onBusy,
  onStressed,
  onClose,
  expanded,
  onExpand,
  prefill,
}: {
  state: AppState;
  settings: Settings;
  mimo: MimoSay;
  go: (v: View) => void;
  refresh: () => void;
  onBusy: (busy: boolean) => void;
  /** Tells the page when the investor's latest message sounds stressed (its place in the chat), or not (null). */
  onStressed: (at: number | null) => void;
  onClose: () => void;
  /** Full window, with the plan beside the conversation. */
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  /** Text to put in the box, for example from "Change it with Mimo". A new id puts it in again. */
  prefill?: { id: number; text: string } | null;
}) {
  const t = strings(settings.language, settings.role);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastPrefill, setLastPrefill] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  if (prefill && prefill.id !== lastPrefill) {
    // adjusting state from a prop while rendering, as React recommends instead of an effect
    setLastPrefill(prefill.id);
    setInput(prefill.text);
  }
  useEffect(() => {
    // braces on purpose: newer browsers return a promise from scrollIntoView, and an effect must not return one
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (prefill) box.current?.focus();
  }, [prefill]);

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
      setMessages([...next, { role: "assistant", content: data.reply ?? fill(t.chat.failed, { error: data.error ?? "" }), steps: data.steps, face: data.reply ? replyFace(data.steps, soundsStressed(content)) : "worried" }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: fill(t.chat.offline, { error: err instanceof Error ? err.message : String(err) }), face: "worried" }]);
    }
    setBusy(false);
    onBusy(false);
    refresh();
  }

  const agent = state.brand.agent;
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  const p = state.portfolio;
  const allowed = p.positions.filter((x) => x.rule.allowed).map((x) => `t${x.symbol}`);

  const header = (
    <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
      <MimoTile size={46}>
        <Avatar face={busy ? "thinking" : faceOf(mimo.mood)} size={42} />
      </MimoTile>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-display text-lg leading-tight font-semibold">
          {agent}
          <Icon name="sparkle" size={14} strokeWidth={1.6} className="text-sun" />
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span className="size-1.5 rounded-full" style={{ background: "var(--mood)" }} />
          {p.agent.paused ? t.chat.paused : mimo.mood === "calm" ? t.chat.role : mimo.status}
        </p>
      </div>
      <button onClick={() => setMessages([])} title={t.chat.newChat} aria-label={t.chat.newChat} className="rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
        <Icon name="plus" size={18} />
      </button>
      <button onClick={() => onExpand(!expanded)} title={expanded ? t.chat.shrink : t.chat.expand} aria-label={expanded ? t.chat.shrink : t.chat.expand} className="rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
        <Icon name={expanded ? "shrink" : "expand"} size={17} />
      </button>
      <button onClick={onClose} title={t.chat.minimise} aria-label={t.chat.minimise} className="rounded-lg p-2 text-muted hover:bg-cream hover:text-ink">
        <Icon name="minus" size={18} />
      </button>
    </header>
  );

  const conversation = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-paper/70 px-5 py-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="shieldCheck" size={14} className="text-leaf" />
          {t.chat.context}
        </span>
        <button onClick={() => go("mandate")} className="flex items-center gap-0.5 font-semibold text-leaf hover:underline">
          {t.chat.view}
          <Icon name="arrowUpRight" size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto space-y-5 px-5 py-6 ${expanded ? "max-w-3xl" : ""}`}>
          {messages.length === 0 ? (
            <div className="pt-2 pb-2 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-mint text-sage">
                <Icon name="sparkle" size={22} strokeWidth={1.4} />
              </span>
              <p className="eyebrow mt-3">{t.chat.heroEyebrow}</p>
              <h2 className={`mt-2 font-serif leading-tight ${expanded ? "text-[2.6rem]" : "text-[1.75rem]"}`}>{t.chat.hero}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t.chat.heroSub}</p>
            </div>
          ) : null}

          <MimoBubble agent={agent} face="calm">
            {fill(t.chat.welcome, { name })}
          </MimoBubble>

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="ml-12 rounded-2xl rounded-br-md bg-forest px-4 py-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-white">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="space-y-3">
                {m.steps?.map((s, j) => <StepCard key={j} step={s} go={go} />)}
                {state.letter && m.steps?.some((s) => s.tool === "request_stop_loss_halt" || (s.tool === "draft_mandate" && Array.isArray(s.result.raises_risk) && s.result.raises_risk.length > 0)) ? (
                  <LetterQuote letter={state.letter} settings={settings} moment="beforeSign" />
                ) : null}
                <MimoBubble agent={agent} face={m.face ?? "calm"}>
                  {m.content}
                </MimoBubble>
              </div>
            ),
          )}
          {busy ? (
            <p className="flex items-center gap-2.5 text-sm text-muted">
              <MimoTile size={30}>
                <Avatar face="thinking" size={27} />
              </MimoTile>
              {fill(t.chat.checking, { agent })}
              <span className="size-1.5 animate-pulse rounded-full bg-sage" />
            </p>
          ) : null}
          <div ref={end} />
        </div>
      </div>

      <footer className="px-5 pt-2 pb-4">
        <div className={`mx-auto ${expanded ? "max-w-3xl" : ""}`}>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS[settings.language].map(([label, prompt]) => (
              <button key={label} onClick={() => send(prompt)} disabled={busy} title={prompt} className="flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted hover:border-sage hover:text-ink disabled:opacity-50">
                {label}
                <Icon name="arrowUpRight" size={12} />
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="rounded-2xl border border-line bg-card p-3 focus-within:border-sage"
          >
            <textarea
              ref={box}
              value={input}
              rows={expanded ? 2 : 1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={fill(t.chat.placeholder, { agent })}
              className="block w-full resize-none bg-transparent px-1 text-[0.95rem] outline-none placeholder:text-faint"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-faint">
                <Icon name="shieldCheck" size={13} />
                {t.chat.inControl}
              </span>
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="flex size-9 items-center justify-center rounded-xl bg-forest text-white hover:bg-forest-soft disabled:bg-mint disabled:text-sage">
                <Icon name="arrowUp" size={17} />
              </button>
            </div>
          </form>
          <p className="mt-2 text-center text-xs text-faint">{t.chat.footnote}</p>
        </div>
      </footer>
    </div>
  );

  if (!expanded) {
    return (
      <aside className={`mood-${mimo.mood} flex h-full w-full flex-col overflow-hidden rounded-(--radius-card) border border-line bg-paper shadow-[0_30px_60px_-30px_rgb(25_60_50/0.45)]`}>
        <div className="bg-card">{header}</div>
        {conversation}
      </aside>
    );
  }

  return (
    <aside className={`mood-${mimo.mood} flex h-full w-full overflow-hidden rounded-(--radius-card) border border-line bg-paper shadow-[0_30px_80px_-30px_rgb(25_60_50/0.5)]`}>
      {/* the plan stays in view beside the conversation */}
      <div className="hidden w-80 shrink-0 flex-col border-r border-line bg-card px-7 py-7 lg:flex">
        <p className="eyebrow">{t.chat.sideEyebrow}</p>
        <h2 className="mt-4 font-serif text-[2rem] leading-[1.15]">
          {t.chat.sideTitle1}
          <br />
          {t.chat.sideTitle2}
        </h2>
        <p className="mt-3 text-sm text-muted">{t.chat.sideSub}</p>
        <div className="mx-auto mt-6">
          <Mascot mood={mimo.mood} variant={mimo.variant} size={190} />
        </div>
        <p className="eyebrow mt-4">{t.chat.sidePortfolio}</p>
        <p className="num mt-2 font-display text-3xl font-semibold tracking-[-0.03em]">{moneyText(p.totalValue, settings.currency)}</p>
        <p className="mt-1 text-sm text-muted">{t.mood.chip[mimo.mood]}</p>
        <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
          {[
            [t.chat.sideLoss, `${p.mandate.dailyLossPct}%`],
            [t.chat.sideTrade, `${p.mandate.maxTradePct}%`],
            [t.chat.sideAssets, allowed.join(" · ")],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto flex items-start gap-2.5 pt-6 text-sm text-muted">
          <Icon name="shieldCheck" size={20} className="shrink-0 text-leaf" />
          <span>
            {t.chat.sidePromise1}
            <br />
            {t.chat.sidePromise2}
          </span>
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-card">{header}</div>
        {conversation}
      </div>
    </aside>
  );
}

function MimoBubble({ agent, face, children }: { agent: string; face: Face; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-faint uppercase">
        <MimoTile size={30}>
          <Avatar face={face} size={27} />
        </MimoTile>
        {agent}
      </p>
      <p className="mr-8 rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  );
}
