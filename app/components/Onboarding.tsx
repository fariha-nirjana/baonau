"use client";

import { useState, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import type { Draft } from "@/lib/drafts";
import type { Language } from "@/lib/plan";
import { checkTermsOf, CheckRound } from "./Check";
import { fill, formatLeft, strings } from "./i18n";
import { Icon } from "./icons";
import { LetterField } from "./Letter";
import { Avatar, HappyMascot, Mascot, MimoTile } from "./Mascot";
import { plainTerms } from "./terms";
import type { Act, AppState, Mood, Settings } from "./types";
import { useSecondsLeft } from "./ui";

type Step = "welcome" | "t1" | "t2" | "t3" | "t4" | "goal" | "review" | "check" | "note" | "sign" | "done";
const SETUP: Step[] = ["welcome", "t1", "t2", "t3", "t4", "goal", "review", "check", "note", "sign", "done"];
const TOUR: Step[] = ["t1", "t2", "t3", "t4"];
const TOUR_ART: Record<"t1" | "t2" | "t3", Mood> = { t1: "calm", t2: "holding", t3: "shield" };

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  state: AppState;
  settings: Settings;
  setLanguage: (l: Language) => void;
  act: Act;
  refresh: () => Promise<void>;
  skew: number;
  /** setup: the whole first-time flow for an unsigned vault. tour: the four tour cards only. */
  mode: "setup" | "tour";
  onClose: () => void;
};

/** The newest first-mandate draft the agent prepared, if any. */
function latestFirstDraft(state: AppState): Draft | null {
  const drafts = state.drafts.filter((d) => d.kind === "sign_mandate" && d.payload);
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function MimoSays({ children, face = "calm" }: { children: ReactNode; face?: "calm" | "happy" | "thinking" }) {
  return (
    <div className="flex items-start gap-3">
      <MimoTile size={40}>
        <Avatar face={face} size={36} />
      </MimoTile>
      <p className="rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  );
}

/**
 * The first-time experience: a welcome, a short tour, then the goal in the
 * investor's own words, the mandate the agent drafts from it, an
 * understanding check, a note to their future self, and the signature.
 * Everything that reaches the chain goes through the same routes as the rest
 * of the app; nothing is simulated here.
 */
export function Onboarding({ state, settings, setLanguage, act, refresh, skew, mode, onClose }: Props) {
  const t = strings(settings.language, settings.role);
  const steps = mode === "tour" ? TOUR : SETUP;
  // ?step=review opens a given step, for screenshots and rehearsals
  const [at, setAt] = useState(() => Math.max(0, steps.indexOf(new URLSearchParams(window.location.search).get("step") as Step)));
  const step = steps[at];
  const go = (s: Step) => setAt(steps.indexOf(s));
  const next = () => setAt((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setAt((i) => Math.max(i - 1, 0));

  // the conversation with the agent about the goal, kept across the goal and review steps
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(state.letter?.text ?? "");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);
  const draft = latestFirstDraft(state);
  // a new draft from the agent moves the flow on to the review (adjusting state while rendering, as React recommends)
  const [lastDraft, setLastDraft] = useState<string | null>(() => draft?.id ?? null);
  if (draft && draft.id !== lastDraft) {
    setLastDraft(draft.id);
    if (step === "goal") setAt(steps.indexOf("review"));
  }
  const waitSecs = useSecondsLeft(state.portfolio.signableFrom, skew);


  async function ask(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, language: settings.language, currency: settings.currency }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages([...history, { role: "assistant", content: data.reply ?? fill(t.onboard.failed, { error: data.error ?? "" }) }]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function sign() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (note.trim()) await act("owner", "letter", note);
      // earlier drafts from the same conversation are put away, so only the signed one remains
      for (const d of state.drafts) if (d.kind === "sign_mandate" && d.id !== draft.id) await act("owner", "dismiss", d.id);
      const data = (await act("owner", "sign", draft.id)) as { results?: { ok: boolean; url?: string; error?: { explanation?: string } | null; message?: string }[]; error?: string };
      const failed = data?.error ?? data?.results?.find((r) => !r.ok);
      if (failed) {
        setError(typeof failed === "string" ? failed : (failed.error?.explanation ?? failed.message ?? "refused"));
      } else {
        setSignedUrl(data?.results?.find((r) => r.url)?.url ?? null);
        go("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  const lastReply = [...messages].reverse().find((m) => m.role === "assistant");
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  const agent = BRAND.agent;
  const progressSteps: Step[] = steps.filter((s) => s !== "welcome" && s !== "done");
  const progressAt = progressSteps.indexOf(step);

  const primary = "flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-white hover:bg-forest-soft disabled:opacity-50";
  const ghost = "rounded-xl border border-line px-5 py-3 font-semibold hover:bg-cream";

  const tourCard = (s: "t1" | "t2" | "t3" | "t4", title: string, body: string) => (
    <div className="grid items-center gap-8 sm:grid-cols-[13rem_1fr]">
      <div className="mx-auto">{s === "t4" ? <HappyMascot size={200} /> : <Mascot mood={TOUR_ART[s]} size={200} still />}</div>
      <div>
        <h2 className="font-serif text-[2.2rem] leading-[1.12]">{title}</h2>
        <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">{fill(body, { agent })}</p>
      </div>
    </div>
  );

  const body = (() => {
    switch (step) {
      case "welcome":
        return (
          <div className="text-center">
            <div className="mx-auto w-fit">
              <HappyMascot size={190} />
            </div>
            <h1 className="mt-4 font-serif text-[2.6rem] leading-tight">{fill(t.onboard.hello, { name, agent })}</h1>
            <p className="mx-auto mt-3 max-w-lg text-[1.05rem] text-muted">{fill(t.onboard.helloSub, { agent })}</p>
            <p className="mt-8 text-sm font-semibold text-muted">{t.onboard.language}</p>
            <div className="mt-3 flex justify-center gap-2">
              {(
                [
                  ["en", "English"],
                  ["bn", "বাংলা"],
                  ["zh", "中文"],
                ] as [Language, string][]
              ).map(([l, label]) => (
                <button
                  key={l}
                  onClick={() => setLanguage(l)}
                  aria-pressed={settings.language === l}
                  className={`rounded-xl border px-5 py-2.5 font-semibold transition-colors ${settings.language === l ? "border-forest bg-forest text-white" : "border-line hover:bg-cream"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-10 flex flex-col items-center gap-3">
              <button onClick={next} className={`${primary} min-w-56`}>
                {t.onboard.start}
                <Icon name="arrow" size={17} />
              </button>
              <button onClick={() => go("goal")} className="text-sm font-semibold text-muted hover:text-ink">
                {t.onboard.skipTour}
              </button>
            </div>
          </div>
        );
      case "t1":
        return tourCard("t1", t.onboard.t1Title, t.onboard.t1Body);
      case "t2":
        return tourCard("t2", t.onboard.t2Title, t.onboard.t2Body);
      case "t3":
        return tourCard("t3", t.onboard.t3Title, t.onboard.t3Body);
      case "t4":
        return tourCard("t4", t.onboard.t4Title, t.onboard.t4Body);
      case "goal":
        return (
          <div>
            <h2 className="font-serif text-[2.2rem] leading-tight">{t.onboard.goalTitle}</h2>
            <p className="mt-2 text-[1.02rem] text-muted">{t.onboard.goalSub}</p>
            <div className="mt-6 space-y-4">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-forest px-4 py-3 text-[0.95rem] text-white">
                    {m.content}
                  </p>
                ) : (
                  <MimoSays key={i}>{m.content}</MimoSays>
                ),
              )}
              {busy ? <MimoSays face="thinking">{fill(t.onboard.thinking, { agent })}</MimoSays> : null}
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              placeholder={t.onboard.goalPlaceholder}
              className="mt-6 block w-full resize-none rounded-xl border border-line bg-card px-4 py-3 text-[1.02rem] outline-none placeholder:text-faint focus:border-sage"
            />
            {messages.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {t.onboard.goalIdeas.split("\n").map((idea) => (
                  <button key={idea} onClick={() => setInput(idea)} className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-sm text-muted hover:border-sage hover:text-ink">
                    {idea}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      case "review":
        return draft?.payload ? (
          <div>
            <h2 className="font-serif text-[2.1rem] leading-tight">{t.onboard.reviewTitle}</h2>
            <p className="mt-2 text-[1.02rem] text-muted">{t.onboard.reviewSub}</p>
            {lastReply ? (
              <div className="mt-5">
                <MimoSays>{lastReply.content}</MimoSays>
              </div>
            ) : null}
            <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-card px-5">
              {plainTerms(draft.payload, state, settings, t).map((line) => (
                <li key={line} className="flex items-start gap-2.5 py-3 text-[0.95rem]">
                  <Icon name="check" size={16} strokeWidth={2.4} className="mt-0.5 shrink-0 text-leaf" />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(input)}
                placeholder={t.onboard.changePlaceholder}
                className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] outline-none placeholder:text-faint focus:border-sage"
              />
              <button onClick={() => ask(input)} disabled={busy || !input.trim()} className={ghost}>
                {busy ? "…" : fill(t.onboard.send, { agent })}
              </button>
            </div>
          </div>
        ) : null;
      case "check":
        return draft?.payload ? (
          <div>
            <h2 className="font-serif text-[2.1rem] leading-tight">{t.onboard.checkTitle}</h2>
            <div className="mt-4">
              <CheckRound
                terms={{ ...checkTermsOf(draft.payload.mandate, state), indexStop: draft.payload.rules.IDX?.stopPrice ? Number(draft.payload.rules.IDX.stopPrice) : null }}
                settings={settings}
                onPass={() => setPassed(true)}
                onFinish={next}
                finishLabel={t.onboard.next}
              />
            </div>
          </div>
        ) : null;
      case "note":
        return (
          <div>
            <h2 className="font-serif text-[2.1rem] leading-tight">{t.onboard.noteTitle}</h2>
            <p className="mt-2 text-[1.02rem] text-muted">{t.onboard.noteSub}</p>
            <div className="mt-5">
              <LetterField value={note} onChange={setNote} settings={settings} rows={4} />
            </div>
            <p className="mt-2 text-xs text-faint">{t.letter.example}</p>
          </div>
        );
      case "sign":
        return (
          <div className="text-center">
            <div className="mx-auto w-fit">
              <Mascot mood="calm" size={170} still />
            </div>
            <h2 className="mt-3 font-serif text-[2.3rem] leading-tight">{t.onboard.signTitle}</h2>
            <p className="mx-auto mt-3 max-w-md text-[1.02rem] text-muted">{fill(t.onboard.signSub, { agent })}</p>
            {waitSecs !== null ? <p className="mx-auto mt-4 w-fit rounded-xl bg-sun-soft px-4 py-2.5 text-sm text-sun-ink">{fill(t.onboard.signWait, { time: formatLeft(waitSecs, t) })}</p> : null}
            <button onClick={sign} disabled={busy || waitSecs !== null || !draft || !passed} className={`${primary} mx-auto mt-6 min-w-60`}>
              <Icon name="check" size={17} />
              {busy ? t.onboard.signing : t.onboard.sign}
            </button>
          </div>
        );
      case "done":
        return (
          <div className="text-center">
            <div className="mx-auto w-fit">
              <HappyMascot size={190} />
            </div>
            <h2 className="mt-3 font-serif text-[2.6rem] leading-tight">{t.onboard.doneTitle}</h2>
            <p className="mx-auto mt-3 max-w-md text-[1.02rem] text-muted">{fill(t.onboard.doneBody, { agent })}</p>
            {signedUrl ? (
              <a href={signedUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
                {t.onboard.viewTx}
                <Icon name="arrowUpRight" size={13} />
              </a>
            ) : null}
            <div className="mt-8">
              <button onClick={onClose} className={`${primary} mx-auto min-w-60`}>
                {t.onboard.toDashboard}
              </button>
            </div>
          </div>
        );
    }
  })();

  // what the bottom bar offers on each step
  const footer = (() => {
    if (step === "welcome" || step === "done") return null;
    const canNext =
      step === "goal" ? false : step === "review" ? Boolean(draft) && !busy : step === "check" ? false : step === "sign" ? false : true;
    const lastTour = mode === "tour" && step === "t4";
    return (
      <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-5">
        <button onClick={back} disabled={at === 0} className="text-sm font-semibold text-muted hover:text-ink disabled:opacity-0">
          ← {t.onboard.back}
        </button>
        <div className="flex gap-2.5">
          {step === "goal" ? (
            <button onClick={() => ask(input)} disabled={busy || !input.trim()} className={primary}>
              {busy ? "…" : fill(t.onboard.send, { agent })}
            </button>
          ) : null}
          {step === "note" ? (
            <>
              <button onClick={() => { setNote(""); next(); }} className={ghost}>
                {t.onboard.skip}
              </button>
              <button onClick={next} disabled={!note.trim()} className={primary}>
                {t.onboard.saveContinue}
              </button>
            </>
          ) : canNext ? (
            <button onClick={lastTour ? onClose : step === "review" ? () => go("check") : next} className={primary}>
              {lastTour ? t.onboard.endTour : step === "review" ? t.onboard.looksGood : t.onboard.next}
              <Icon name="arrow" size={16} />
            </button>
          ) : null}
        </div>
      </div>
    );
  })();

  return (
    <div lang={settings.language} className="fixed inset-0 z-[60] overflow-y-auto bg-paper">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2.5 font-display text-lg font-bold tracking-[-0.03em]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-forest text-mint">
              <Icon name="shieldCheck" size={18} />
            </span>
            <span>
              {state.brand.product}
              <span className="text-sage">.</span>
            </span>
          </p>
          {step !== "done" ? (
            <button onClick={onClose} className="text-sm font-semibold text-muted hover:text-ink">
              {mode === "tour" ? t.onboard.endTour : t.onboard.later}
            </button>
          ) : null}
        </header>
        {progressAt >= 0 ? (
          <div className="mt-8">
            <div className="flex gap-1.5">
              {progressSteps.map((s, i) => (
                <span key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i < progressAt ? "bg-leaf" : i === progressAt ? "bg-sage" : "bg-cream"}`} />
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-faint">{fill(t.onboard.step, { n: progressAt + 1, total: progressSteps.length })}</p>
          </div>
        ) : null}
        <main className="slide-in my-auto py-10" key={step}>
          {body}
          {error ? <p className="mt-5 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral">{fill(t.onboard.failed, { error })}</p> : null}
          {footer}
        </main>
      </div>
    </div>
  );
}

