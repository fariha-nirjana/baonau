"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/money";
import type { Language } from "@/lib/plan";
import { Chat } from "./Chat";
import { Icon, type IconName } from "./icons";
import { Mascot } from "./Mascot";
import { mimoOf, waitingCount } from "./mimo";
import type { Act, AppState, Settings, View } from "./types";
import { Button, Card, Chip, short } from "./ui";
import { ProofView } from "./Proof";
import { ActivityView, ApprovalsView, DemoView, MandateView, PortfolioView } from "./views";

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: "portfolio", label: "Dashboard", icon: "home" },
  { view: "mandate", label: "Mandate", icon: "mandate" },
  { view: "approvals", label: "Approvals", icon: "approvals" },
  { view: "activity", label: "Activity", icon: "activity" },
  { view: "proof", label: "Proof", icon: "proof" },
];

const TITLES: Record<View, [string, string]> = {
  portfolio: ["", "The AI manages the portfolio. The mandate you signed governs the AI."],
  mandate: ["Your mandate", "What the AI may do, and how these rules can change."],
  approvals: ["Approvals", "Decisions that are yours to make, and riskier changes waiting their turn."],
  activity: ["Activity", "A plain receipt for every move, including the ones that were stopped."],
  proof: ["Proof", "Six markets, three kinds of agent, a calm owner and a panicking one. Did the boundaries hold?"],
  demo: ["Security demo", "See what a stolen agent key can and cannot do."],
};

/** The demo market switch moves the index fund's simulated price. The stop-loss in the demo mandate is at 102. */
const MARKETS: { id: string; label: string; idx: number }[] = [
  { id: "calm", label: "Calm", idx: 120 },
  { id: "dip", label: "Dip", idx: 108 },
  { id: "crash", label: "Crash", idx: 100 },
];

function greeting(date: Date) {
  const h = date.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Segmented<T extends string>({ value, options, onChange, size = "base" }: { value: T | null; options: [T, string][]; onChange: (v: T) => void; size?: "sm" | "base" }) {
  return (
    <div className="flex rounded-xl border border-line bg-card p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-lg font-semibold transition-colors ${size === "sm" ? "px-2.5 py-1 text-sm" : "px-3 py-1.5 text-[0.95rem]"} ${v === value ? "bg-forest text-white" : "text-muted hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SyncedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
      <span className={`size-2 rounded-full ${s < 15 ? "bg-leaf" : "bg-sun"}`} />
      Read from the chain {s < 5 ? "just now" : `${s} s ago`}
    </span>
  );
}

export function Dashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [syncedAt, setSyncedAt] = useState(0);
  const [view, setView] = useState<View>("portfolio");
  const [settings, setSettings] = useState<Settings>({ currency: "BDT", language: "en", role: "owner" });
  const [attacking, setAttacking] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [market, setMarket] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // what the mascot has already been acknowledged for; receipts already there when the page opened count as seen
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const firstRead = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?currency=${settings.currency}`, { cache: "no-store" });
      const data = (await res.json()) as AppState & { error?: string };
      if (data.error) throw new Error(data.error);
      if (firstRead.current) {
        firstRead.current = false;
        setSeen(new Set(data.receipts.map((r) => r.ref + r.at)));
      }
      setState(data);
      setSkew(Date.now() - new Date(data.portfolio.at).getTime());
      setSyncedAt(Date.now());
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
        setInFlight((n) => n + 1);
        try {
          const res = await fetch("/api/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, action, arg }) });
          data = await res.json();
        } finally {
          setInFlight((n) => n - 1);
        }
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
      <main className="dot-grid flex h-full items-center justify-center">
        <Card className="max-w-xl text-center">
          <div className="mx-auto w-fit">
            <Mascot mood={error ? "worried" : "thinking"} size={140} />
          </div>
          <p className="mt-3 text-xl font-semibold">{error ? "Could not read the vault" : "Reading the vault…"}</p>
          {error ? <p className="mt-2 text-base text-muted">{error}</p> : null}
        </Card>
      </main>
    );
  }

  const p = state.portfolio;
  const waiting = waitingCount(state);
  const mimo = mimoOf({ state, role: settings.role, attacking, thinking: chatBusy || inFlight > 0, seen, dismissed });
  const ack = () => {
    if (mimo.receiptRefs.length) setSeen((s) => new Set([...s, ...mimo.receiptRefs]));
    if (mimo.dismissKey && mimo.dismissKey !== "receipts") setDismissed((d) => new Set([...d, mimo.dismissKey as string]));
  };
  const toSign = state.drafts.length + state.requests.length;
  const [title, subtitle] = TITLES[view];
  const stale = p.positions.some((x) => x.priceIsStale && (x.rule.allowed || Number(x.amount) > 0));
  const idx = p.positions.find((x) => x.symbol === "IDX");
  const marketNow = market ?? (idx ? (Number(idx.price) >= 118 ? "calm" : Number(idx.price) <= 102 ? "crash" : "dip") : null);

  async function moveMarket(id: string) {
    const target = MARKETS.find((m) => m.id === id);
    if (!target) return;
    setMarket(id);
    try {
      await act("demo", "price", `IDX=${target.idx}`);
    } finally {
      setMarket(null);
    }
  }

  return (
    <div className="dot-grid flex h-full">
      <nav className="m-3 mr-0 flex w-64 shrink-0 flex-col rounded-[1.75rem] bg-forest px-4 py-6 text-white">
        <div className="flex items-center gap-3 px-2">
          <div className="rounded-2xl bg-mint p-0.5">
            <Mascot mood="calm" size={48} still />
          </div>
          <div className="min-w-0">
            <p className="font-display text-xl leading-tight font-semibold">{state.brand.product}</p>
            <p className="text-sm text-white/65">{state.brand.tagline}</p>
          </div>
        </div>

        <ul className="mt-8 space-y-1">
          {NAV.map((item) => {
            const count = item.view === "approvals" ? toSign + (settings.role === "owner" ? waiting : 0) : 0;
            const active = view === item.view;
            return (
              <li key={item.view}>
                <button
                  onClick={() => setView(item.view)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[1.05rem] font-semibold transition-colors ${active ? "bg-mint text-forest" : "text-white/85 hover:bg-forest-soft"}`}
                >
                  <Icon name={item.icon} size={20} />
                  <span className="flex-1">{item.label}</span>
                  {count ? <span className="flex size-6 items-center justify-center rounded-full bg-sun text-sm text-ink">{count}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto space-y-3">
          <a href={`${state.explorer}/address/${state.vault}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-forest-deep p-3.5 hover:bg-forest-soft">
            <Icon name="shieldCheck" size={22} className="text-mint" />
            <span className="min-w-0">
              <span className="block font-semibold">Mandate enforced on-chain</span>
              <span className="block text-sm text-white/65">Vault {short(state.vault)}</span>
            </span>
          </a>
          <div className="flex items-center gap-3 px-2">
            <span className="flex size-10 items-center justify-center rounded-full bg-sun font-semibold text-ink">{settings.role === "owner" ? "O" : "G"}</span>
            <span className="min-w-0 text-sm">
              <span className="block font-semibold">{settings.role === "owner" ? "Owner" : "Guardian"}</span>
              <span className="block text-white/65">{short(settings.role === "owner" ? p.keys.owner : p.keys.guardian)}</span>
            </span>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-3">
          <p className="flex items-center gap-2 text-[0.95rem]">
            <span className="size-2.5 rounded-full bg-sun" />
            <span className="font-semibold">Base Sepolia testnet</span>
            <span className="text-muted">· Test money, simulated test assets, no real value</span>
          </p>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
            {idx ? (
              <div className="flex items-center gap-2" title="Moves the simulated index fund price on the demo feed">
                <span className="text-sm font-semibold text-muted">Demo market</span>
                <Segmented value={marketNow} options={MARKETS.map((m) => [m.id, m.label] as [string, string])} onChange={moveMarket} size="sm" />
              </div>
            ) : null}
            <Segmented<Currency> value={settings.currency} options={[["BDT", "৳"], ["CNY", "¥"], ["USD", "$"]]} onChange={(currency) => setSettings((s) => ({ ...s, currency }))} size="sm" />
            <Segmented<Language> value={settings.language} options={[["en", "EN"], ["zh", "中文"], ["bn", "বাংলা"]]} onChange={(language) => setSettings((s) => ({ ...s, language }))} size="sm" />
            <Segmented<Settings["role"]>
              value={settings.role}
              options={[["owner", "Owner"], ["guardian", waiting ? `Guardian (${waiting})` : "Guardian"]]}
              onChange={(role) => setSettings((s) => ({ ...s, role }))}
              size="sm"
            />
            <Button kind={view === "demo" ? "dark" : "ghost"} onClick={() => setView("demo")} className="py-2!">
              <Icon name="shield" size={18} />
              Security demo
            </Button>
            {!p.agent.paused ? (
              <Button kind="alarm" onClick={() => act(settings.role, "pause")} className="py-2!">
                <Icon name="pause" size={18} />
                Pause the AI
              </Button>
            ) : settings.role === "guardian" ? (
              <Button onClick={() => act("guardian", "unpause")} className="py-2!">
                <Icon name="play" size={16} />
                Lift the pause
              </Button>
            ) : p.agent.pausedBy === "owner" ? (
              <Button onClick={() => act("owner", "unpause")} className="py-2!">
                <Icon name="play" size={16} />
                Unpause the AI
              </Button>
            ) : p.pending.unpause ? (
              <Chip tone="warn" icon="clock">
                Paused by guardian, unpause waiting
              </Chip>
            ) : (
              <Button kind="ghost" onClick={() => act("owner", "unpause")} className="py-2!">
                Ask to unpause (waits)
              </Button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
            <div className="mx-auto max-w-5xl">
              <div className="flex items-end justify-between gap-4">
                <div>
                  {view === "portfolio" ? (
                    <>
                      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">
                        {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                      </p>
                      <h1 className="mt-1 flex items-center gap-2 font-display text-4xl font-semibold">
                        {greeting(new Date())}.<Icon name="sparkle" size={26} className="text-coral" strokeWidth={1.6} />
                      </h1>
                    </>
                  ) : (
                    <h1 className="font-display text-4xl font-semibold">{title}</h1>
                  )}
                  <p className="mt-1.5 text-lg text-muted">{subtitle}</p>
                </div>
                <SyncedAgo at={syncedAt} />
              </div>

              {notice ? <p className="slide-in mt-4 rounded-2xl bg-coral-soft p-4 text-lg text-coral">{notice}</p> : null}
              {error ? <p className="mt-4 rounded-2xl bg-coral-soft p-4 text-base text-coral">Could not refresh: {error}</p> : null}
              {stale ? (
                <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">
                  The price feed is out of date, so the vault will refuse trades until it is refreshed. Use &quot;Refresh prices&quot; in the security demo.
                </p>
              ) : null}
              {settings.role === "guardian" ? (
                <p className="mt-4 rounded-2xl bg-sky-soft p-4 text-lg text-sky">
                  Guardian view. You can pause the AI, cancel a change that is waiting and halt the stop-loss in an emergency. You cannot move money, sign for trades or change the mandate.
                </p>
              ) : null}
              {settings.role === "guardian" && waiting > 0 ? (
                <button onClick={() => setView("approvals")} className="slide-in mt-4 block w-full rounded-2xl border border-sun bg-sun-soft p-4 text-left text-lg text-sun-ink">
                  <span className="font-semibold">
                    Alert: the owner has asked for {waiting} {waiting === 1 ? "change" : "changes"} that would raise the risk.
                  </span>{" "}
                  Nothing has taken effect yet. Open the queue to see the countdown and cancel if it looks like a decision made in a bad moment.
                </button>
              ) : null}
              {!/^0x0+$/.test(p.agent.address) || !p.mandateSigned ? null : (
                <p className="mt-4 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">The AI has no key right now, so it cannot trade. A new key waits out the delay like any other rise in risk.</p>
              )}

              <div className="mt-6">
                {view === "portfolio" ? <PortfolioView state={state} settings={settings} act={act} skew={skew} mimo={mimo} onAck={ack} /> : null}
                {view === "mandate" ? <MandateView state={state} settings={settings} act={act} skew={skew} /> : null}
                {view === "approvals" ? <ApprovalsView state={state} settings={settings} act={act} skew={skew} /> : null}
                {view === "activity" ? <ActivityView state={state} settings={settings} act={act} skew={skew} /> : null}
                {view === "proof" ? <ProofView /> : null}
                {view === "demo" ? <DemoView state={state} settings={settings} act={act} skew={skew} onAttack={setAttacking} /> : null}
              </div>
            </div>
          </main>

          {settings.role === "owner" ? <Chat state={state} settings={settings} mimo={mimo} onAck={ack} go={setView} refresh={refresh} onBusy={setChatBusy} /> : null}
        </div>
      </div>
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
