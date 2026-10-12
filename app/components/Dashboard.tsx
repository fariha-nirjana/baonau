"use client";

import { useCallback, useEffect, useState } from "react";
import type { Currency } from "@/lib/money";
import type { Language } from "@/lib/plan";
import { Chat } from "./Chat";
import { Mascot } from "./Mascot";
import type { Act, AppState, Mood, Settings, View } from "./types";
import { Button, Card, Chip, short } from "./ui";
import { ActivityView, ApprovalsView, DemoView, MandateView, PortfolioView } from "./views";

const NAV: { view: View; label: string }[] = [
  { view: "portfolio", label: "Portfolio" },
  { view: "mandate", label: "Mandate" },
  { view: "approvals", label: "Approvals" },
  { view: "activity", label: "Activity" },
];

const TITLES: Record<View, [string, string]> = {
  portfolio: ["Your money, inside your rules.", "The AI manages the portfolio. The mandate you signed governs the AI."],
  mandate: ["Your mandate", "What the AI may do, and how these rules can change."],
  approvals: ["Approvals", "Decisions that are yours to make."],
  activity: ["Activity", "A receipt for every attempt, including the ones that were refused."],
  demo: ["Security demo", "See what a stolen agent key can and cannot do."],
};

function moodOf(state: AppState, attacking: boolean): Mood {
  const p = state.portfolio;
  const last = state.receipts[0];
  const justBlocked = last && last.outcome === "reverted by the contract" && Date.now() - new Date(last.at).getTime() < 90_000;
  if (attacking || justBlocked) return "shield";
  const waiting = p.pending.mandate || p.pending.withdrawalAddress || p.stopLoss.haltRequestAppliesFrom || p.positions.some((x) => x.pendingRule);
  if (p.protect.active || waiting || p.stopLoss.haltedUntil || p.agent.paused) return "warning";
  if (p.today.lossPct >= 1) return "watching";
  return "calm";
}

/** What the mascot says: the reason for its mood, in one short line. */
function speechOf(state: AppState, mood: Mood): string {
  const p = state.portfolio;
  if (mood === "shield") return "Blocked. The contract refused that.";
  if (p.agent.paused) return "I'm paused. I won't trade until you say so.";
  if (p.protect.active) return "Buying is paused after a loss. Selling still works.";
  if (p.stopLoss.haltedUntil) return "Your guardian has halted the stop-loss for now.";
  if (mood === "warning") return "A riskier rule is waiting. Nothing has changed yet.";
  if (mood === "watching") return "Prices are moving. I'm watching.";
  return "All calm. Your limits are holding.";
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-cream p-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-lg px-3.5 py-1.5 text-base font-semibold ${v === value ? "bg-card shadow-sm" : "text-muted"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [view, setView] = useState<View>("portfolio");
  const [settings, setSettings] = useState<Settings>({ currency: "BDT", language: "en", role: "owner" });
  const [attacking, setAttacking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?currency=${settings.currency}`, { cache: "no-store" });
      const data = (await res.json()) as AppState & { error?: string };
      if (data.error) throw new Error(data.error);
      setState(data);
      setSkew(Date.now() - new Date(data.portfolio.at).getTime());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [settings.currency]);

  useEffect(() => {
    // the first read and the polling both go through the timer, so nothing sets state during render
    const first = setTimeout(() => {
      // ?view=mandate&role=guardian opens a screen directly, for links and screenshots
      const query = new URLSearchParams(window.location.search);
      const wanted = query.get("view");
      if (wanted && wanted in TITLES) setView(wanted as View);
      if (query.get("role") === "guardian") setSettings((s) => ({ ...s, role: "guardian" }));
      refresh();
    }, 0);
    const id = setInterval(refresh, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const act: Act = useCallback(
    async (role, action, arg) => {
      let data: unknown = null;
      if (action !== "noop") {
        const res = await fetch("/api/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, action, arg }) });
        data = await res.json();
        const failure = failureOf(data);
        setNotice(failure);
        if (failure) setTimeout(() => setNotice(null), 9000);
      }
      await refresh();
      return data;
    },
    [refresh],
  );

  if (!state) {
    return (
      <main className="flex h-full items-center justify-center">
        <Card className="max-w-xl text-center">
          <div className="mx-auto w-fit">
            <Mascot mood={error ? "warning" : "calm"} />
          </div>
          <p className="mt-3 text-xl font-semibold">{error ? "Could not read the vault" : "Reading the vault…"}</p>
          {error ? <p className="mt-2 text-base text-muted">{error}</p> : null}
        </Card>
      </main>
    );
  }

  const p = state.portfolio;
  const mood = moodOf(state, attacking);
  const pending = state.drafts.length + state.requests.length;
  const [title, subtitle] = TITLES[view];
  const stale = p.positions.some((x) => x.priceIsStale && (x.rule.allowed || Number(x.amount) > 0));

  return (
    <div className="flex h-full">
      <nav className="flex w-72 shrink-0 flex-col bg-forest px-5 py-7 text-white">
        <div className="flex items-center gap-3 px-2">
          <div className="rounded-2xl bg-sun p-1">
            <Mascot mood="calm" size={46} />
          </div>
          <div>
            <p className="font-display text-2xl font-semibold">{state.brand.product}</p>
            <p className="text-sm text-white/70">{state.brand.tagline}</p>
          </div>
        </div>

        <ul className="mt-9 space-y-1.5">
          {NAV.map((item) => (
            <li key={item.view}>
              <button
                onClick={() => setView(item.view)}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left text-xl font-semibold ${view === item.view ? "bg-mint text-forest" : "text-white/85 hover:bg-forest-soft"}`}
              >
                {item.label}
                {item.view === "approvals" && pending ? <span className="rounded-full bg-sun px-2.5 text-base text-ink">{pending}</span> : null}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-3">
          <div className="rounded-2xl bg-forest-deep p-4">
            <p className="text-lg font-semibold">Mandate enforced on-chain</p>
            <a href={`${state.explorer}/address/${state.vault}`} target="_blank" rel="noreferrer" className="text-sm text-white/70 underline">
              Vault {short(state.vault)}
            </a>
          </div>
          <p className="px-2 text-sm text-white/60">Owner {short(p.keys.owner)}</p>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-2 bg-sun-soft px-8 py-2 text-base text-sun-ink">
          <span className="size-2.5 rounded-full bg-sun" />
          <span className="font-semibold">Base Sepolia testnet.</span> Test money and simulated tokenized assets. No real value.
        </p>
        <header className="flex items-center border-b border-line bg-card px-8 py-3.5">
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <Segmented<Currency> value={settings.currency} options={[["BDT", "৳ BDT"], ["CNY", "¥ CNY"], ["USD", "$ USD"]]} onChange={(currency) => setSettings((s) => ({ ...s, currency }))} />
            <Segmented<Language> value={settings.language} options={[["en", "EN"], ["zh", "中文"], ["bn", "বাংলা"]]} onChange={(language) => setSettings((s) => ({ ...s, language }))} />
            <Segmented<Settings["role"]> value={settings.role} options={[["owner", "Owner"], ["guardian", "Guardian"]]} onChange={(role) => setSettings((s) => ({ ...s, role }))} />
            <Button kind={view === "demo" ? "primary" : "ghost"} onClick={() => setView("demo")}>
              Security demo
            </Button>
            {p.agent.paused ? (
              settings.role === "owner" ? (
                <Button onClick={() => act("owner", "unpause")}>Unpause the AI</Button>
              ) : (
                <Chip tone="warn">AI paused</Chip>
              )
            ) : (
              <Button kind="danger" onClick={() => act(settings.role, "pause")}>
                Pause the AI
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-6xl">
            <h1 className="font-display text-4xl font-semibold">{title}</h1>
            <p className="mt-1.5 text-lg text-muted">{subtitle}</p>

            {notice ? <p className="slide-in mt-4 rounded-2xl bg-coral-soft p-4 text-lg text-coral">{notice}</p> : null}
            {error ? <p className="mt-4 rounded-2xl bg-coral-soft p-4 text-base text-coral">Could not refresh: {error}</p> : null}
            {stale ? (
              <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">
                The price feed is out of date, so the vault will refuse trades until it is refreshed. Use &quot;Refresh prices&quot; in the security demo.
              </p>
            ) : null}
            {settings.role === "guardian" ? (
              <p className="mt-4 rounded-2xl bg-sky-soft p-4 text-lg text-sky">
                Guardian view. You can pause the AI, cancel a change that is waiting, reject a request and halt the stop-loss in an emergency. You cannot move money or approve anything.
              </p>
            ) : null}

            <div className="mt-6">
              {view === "portfolio" ? <PortfolioView state={state} settings={settings} act={act} skew={skew} mood={mood} speech={speechOf(state, mood)} /> : null}
              {view === "mandate" ? <MandateView state={state} settings={settings} act={act} skew={skew} /> : null}
              {view === "approvals" ? <ApprovalsView state={state} settings={settings} act={act} skew={skew} /> : null}
              {view === "activity" ? <ActivityView state={state} settings={settings} act={act} skew={skew} /> : null}
              {view === "demo" ? <DemoView state={state} settings={settings} act={act} skew={skew} onAttack={setAttacking} /> : null}
            </div>
          </div>
        </main>
      </div>

      {settings.role === "owner" ? <Chat state={state} settings={settings} mood={mood} go={setView} refresh={refresh} /> : null}
    </div>
  );
}

/** Finds a refusal in whatever an action returned, as one sentence to show, or null if it went through. */
function failureOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  const results = Array.isArray(d.results) ? d.results : "ok" in d ? [d] : [];
  for (const r of results as { ok?: boolean; message?: string; error?: { explanation?: string } | null }[]) {
    if (r.ok === false) return r.error?.explanation ?? r.message ?? "That was refused.";
  }
  return null;
}
