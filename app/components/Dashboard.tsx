"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/money";
import type { Language } from "@/lib/plan";
import type { Receipt } from "@/lib/receipts";
import { BRAND } from "@/lib/brand";
import { Chat } from "./Chat";
import { fill, strings, type Strings } from "./i18n";
import { Icon, type IconName } from "./icons";
import { Avatar, faceOf, Mascot, MimoTile } from "./Mascot";
import { mimoOf, waitingCount } from "./mimo";
import type { Act, AppState, Settings, View } from "./types";
import { OverviewHeader, OverviewView, PlanDialog } from "./Overview";
import { Button, Card, short } from "./ui";
import { ProofHeader, ProofView } from "./Proof";
import { PortfolioHeader, PortfolioView } from "./Portfolio";
import { MandateHeader, MandateView } from "./Mandate";
import { ApprovalsHeader, ApprovalsView } from "./Approvals";
import { ActivityHeader, ActivityView, ReceiptDialog } from "./Activity";
import { RoleAvatar, RoleDialog, RolePicker } from "./Roles";
import { SecurityHeader, SecurityView } from "./Security";

type NavItem = { view: View; key: keyof Strings["nav"]; icon: IconName };

const NAV: NavItem[] = [
  { view: "portfolio", key: "overview", icon: "grid" },
  { view: "holdings", key: "holdings", icon: "wallet" },
  { view: "mandate", key: "mandate", icon: "mandate" },
  { view: "approvals", key: "approvals", icon: "approvals" },
  { view: "activity", key: "activity", icon: "activity" },
];
/** Proof and the security demo get their own group, so judges find them without a menu. */
const NAV_TEST: NavItem[] = [
  { view: "proof", key: "proof", icon: "proof" },
  { view: "demo", key: "demo", icon: "shield" },
];

/** Headings for the screens that have not been redone yet. The overview draws its own. */
const TITLES: Record<View, [string, string]> = {
  portfolio: ["", ""],
  holdings: ["Portfolio", "What you hold, against the caps in your mandate and the targets in your plan."],
  mandate: ["Your mandate", "What the AI may do, and how these rules can change."],
  approvals: ["Approvals", "Decisions that are yours to make, and riskier changes waiting their turn."],
  activity: ["Activity", "A plain receipt for every move, including the ones that were stopped."],
  proof: ["Proof", "Six markets, three kinds of agent, a calm owner and a panicking one. Did the boundaries hold?"],
  demo: ["Security demo", "See what a stolen agent key can and cannot do."],
};

function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-line bg-card p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={v === value}
          className={`rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${v === value ? "bg-mint text-forest" : "text-muted hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function SyncedAgo({ at, t }: { at: number; t: Strings }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="flex items-center gap-2 text-sm text-muted" title={fill(t.shell.synced, { ago: s < 5 ? t.shell.justNow : fill(t.shell.secondsAgo, { s }) })}>
      <span className={`size-2 rounded-full ${s < 15 ? "bg-leaf" : "bg-sun"}`} />
      <span className="font-semibold text-ink">Base Sepolia</span>
      <span className="text-faint">· {t.shell.testnet}</span>
    </span>
  );
}

function NavButton({ item, active, count, onClick, t, contact }: { item: NavItem; active: boolean; count: number; onClick: () => void; t: Strings; contact: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[0.92rem] transition-colors ${active ? (contact ? "bg-sky-soft font-semibold text-sky" : "bg-mint font-semibold text-forest") : "text-muted hover:bg-cream hover:text-ink"}`}
    >
      <Icon name={item.icon} size={19} strokeWidth={1.7} />
      <span className="flex-1">{t.nav[item.key]}</span>
      {count ? <span className="num rounded-md bg-sun-soft px-1.5 py-0.5 text-xs font-semibold text-sun-ink">{count}</span> : active ? <span className={`size-1.5 rounded-full ${contact ? "bg-sky" : "bg-leaf"}`} /> : null}
    </button>
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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [prefill, setPrefill] = useState<{ id: number; text: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [switchTo, setSwitchTo] = useState<Settings["role"] | null>(null);
  const [stressedAt, setStressedAt] = useState<number | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // what the mascot has already been acknowledged for; receipts already there when the page opened count as seen
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const firstRead = useRef(true);
  // ?receipt=2 opens that receipt once the first reading arrives, for screenshots
  const openReceiptAt = useRef<number | null>(null);
  const t = strings(settings.language, settings.role);

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
      if (openReceiptAt.current !== null) {
        setReceipt(data.receipts[openReceiptAt.current] ?? null);
        openReceiptAt.current = null;
      }
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
      // ?view=mandate&role=guardian&lang=bn opens a screen directly, for links and screenshots
      const query = new URLSearchParams(window.location.search);
      const wanted = query.get("view");
      if (wanted && wanted in TITLES) setView(wanted as View);
      if (query.get("role") === "guardian") setSettings((s) => ({ ...s, role: "guardian" }));
      const lang = query.get("lang");
      if (lang === "bn" || lang === "zh" || lang === "en") setSettings((s) => ({ ...s, language: lang }));
      if (query.get("chat") === "open" || query.get("chat") === "full") setChatOpen(true);
      if (query.get("chat") === "full") setChatExpanded(true);
      if (query.get("plan") === "open") setPlanOpen(true);
      const sw = query.get("switch");
      if (sw === "guardian" || sw === "owner") setSwitchTo(sw);
      openReceiptAt.current = query.get("receipt") ? Number(query.get("receipt")) : null;
      refresh();
    }, 0);
    const id = setInterval(refresh, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!chatExpanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setChatExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatExpanded]);

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
      <main className="flex h-full items-center justify-center bg-paper">
        <Card className="max-w-xl text-center">
          <div className="mx-auto w-fit">
            <Mascot mood={error ? "worried" : "thinking"} size={140} />
          </div>
          <p className="mt-3 text-xl font-semibold">{error ? t.shell.loadFailed : t.shell.loading}</p>
          {error ? <p className="mt-2 text-base text-muted">{error}</p> : null}
        </Card>
      </main>
    );
  }

  const p = state.portfolio;
  const waiting = waitingCount(state);
  const mimo = mimoOf({ state, role: settings.role, attacking, thinking: chatBusy || inFlight > 0, seen, dismissed, stressedAt, language: settings.language });
  const ack = () => {
    if (mimo.receiptRefs.length) setSeen((s) => new Set([...s, ...mimo.receiptRefs]));
    if (mimo.dismissKey && mimo.dismissKey !== "receipts") setDismissed((d) => new Set([...d, mimo.dismissKey as string]));
  };
  const toSign = state.drafts.length + state.requests.length;
  const [title, subtitle] = TITLES[view];
  const stale = p.positions.some((x) => x.priceIsStale && (x.rule.allowed || Number(x.amount) > 0));
  const guardian = settings.role === "guardian";
  const name = settings.language === "bn" ? BRAND.ownerBn : BRAND.owner;
  const crumb = [...NAV, ...NAV_TEST].find((n) => n.view === view);

  const askMimo = (text: string) => {
    setPrefill({ id: Date.now(), text });
    setChatOpen(true);
  };

  const pauseControl = !p.agent.paused ? (
    <button onClick={() => act(settings.role, "pause")} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft">
      <Icon name="pause" size={16} />
      {t.shell.pause}
    </button>
  ) : guardian ? (
    <Button onClick={() => act("guardian", "unpause")} className="w-full py-2! text-sm!">
      <Icon name="play" size={14} />
      {t.shell.liftPause}
    </Button>
  ) : p.agent.pausedBy === "owner" ? (
    <Button onClick={() => act("owner", "unpause")} className="w-full py-2! text-sm!">
      <Icon name="play" size={14} />
      {t.shell.unpause}
    </Button>
  ) : p.pending.unpause ? (
    <p className="rounded-xl bg-sun-soft px-3 py-2.5 text-center text-sm font-semibold text-sun-ink">{t.shell.unpauseWaiting}</p>
  ) : (
    <Button kind="ghost" onClick={() => act("owner", "unpause")} className="w-full py-2! text-sm!">
      {t.shell.askUnpause}
    </Button>
  );

  return (
    <div lang={settings.language} className="flex h-full bg-paper">
      <nav className="flex w-64 shrink-0 flex-col border-r border-line bg-card px-4 pt-6 pb-4">
        <div className="flex items-center gap-2.5 px-2">
          <span className="flex size-10 items-center justify-center rounded-xl bg-forest text-mint shadow-[0_4px_10px_rgb(24_60_48/0.18)]">
            <Icon name="shieldCheck" size={20} strokeWidth={1.8} />
          </span>
          <p className="font-display text-lg leading-tight font-bold tracking-[-0.03em] whitespace-nowrap">
            {state.brand.product}
            <span className="text-sage">.</span>
          </p>
        </div>
        <div className="mt-9 space-y-1">
          {NAV.map((item) => (
            <NavButton
              key={item.view}
              item={item}
              t={t}
              contact={guardian}
              active={view === item.view}
              count={item.view === "approvals" ? toSign + (guardian ? 0 : waiting) : 0}
              onClick={() => setView(item.view)}
            />
          ))}
        </div>
        <p className="eyebrow mt-6 mb-2 px-3.5 text-[0.68rem]! text-faint!">{t.nav.testIt}</p>
        <div className="space-y-1">
          {NAV_TEST.map((item) => (
            <NavButton key={item.view} item={item} t={t} contact={guardian} active={view === item.view} count={0} onClick={() => setView(item.view)} />
          ))}
        </div>

        <p className="eyebrow mt-6 mb-2 px-3.5 text-[0.68rem]! text-faint!">{t.roles.viewingAs}</p>
        <RolePicker settings={settings} onPick={setSwitchTo} />

        <div className="mt-auto space-y-3 pt-5">
          <button onClick={() => (guardian ? undefined : setChatOpen(true))} className={`mood-${mimo.mood} flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${guardian ? "cursor-default" : "hover:bg-cream"}`}>
            <MimoTile size={40}>
              <Avatar face={chatBusy ? "thinking" : faceOf(mimo.mood)} size={36} />
            </MimoTile>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{BRAND.agent}</span>
              <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--mood)" }} />
                {p.agent.paused ? t.chat.paused : t.launcher[mimo.mood]}
              </span>
            </span>
          </button>
          <div className="rounded-2xl border border-line bg-[radial-gradient(ellipse_at_90%_0%,var(--color-mint),transparent_70%)] p-4">
            <Icon name="sparkle" size={18} strokeWidth={1.4} className="text-sage" />
            <p className="mt-2 text-[0.95rem] leading-snug font-semibold">
              {t.shell.manifesto1}
              <br />
              {t.shell.manifesto2}
            </p>
            <p className="mt-2 text-xs text-muted">{t.shell.manifestoNote}</p>
          </div>
          {pauseControl}
          <div className="flex items-center gap-2.5 border-t border-line px-1 pt-3">
            <RoleAvatar role={settings.role} settings={settings} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{guardian ? t.roles.contact : name}</span>
              <span className="block truncate text-xs text-muted">
                {guardian ? short(p.keys.guardian) : `${t.shell.owner} · ${short(p.keys.owner)}`}
              </span>
            </span>
            <span className={`size-2 rounded-full ${guardian ? "bg-sky" : "bg-leaf"}`} />
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex h-16 shrink-0 items-center gap-4 border-b px-8 ${guardian ? "border-sky/20 bg-sky-soft/70" : "border-line bg-card/70"}`}>
          <p className="text-sm text-faint">
            {state.brand.product}
            <span className="px-3 text-line">/</span>
            <span className="font-semibold text-ink">{crumb ? t.nav[crumb.key] : ""}</span>
          </p>
          <button
            onClick={() => setSwitchTo(guardian ? "owner" : "guardian")}
            title={t.roles.switchEyebrow}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${guardian ? "bg-sky text-white" : "bg-mint text-forest"}`}
          >
            <Icon name={guardian ? "shieldCheck" : "user"} size={13} />
            {guardian ? t.roles.contactView : t.roles.ownerView}
            <Icon name="swap" size={12} className="opacity-70" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            {stale ? (
              <button onClick={() => setView("demo")} title={t.shell.stale} className="flex items-center gap-1.5 rounded-full bg-sun-soft px-3 py-1 text-sm font-semibold text-sun-ink">
                <Icon name="alert" size={14} />
                {t.shell.staleShort}
              </button>
            ) : null}
            <SyncedAgo at={syncedAt} t={t} />
            <Segmented<Currency> label="Currency" value={settings.currency} options={[["BDT", "৳"], ["CNY", "¥"], ["USD", "$"]]} onChange={(currency) => setSettings((s) => ({ ...s, currency }))} />
            <Segmented<Language> label="Language" value={settings.language} options={[["en", "EN"], ["bn", "বাংলা"], ["zh", "中文"]]} onChange={(language) => setSettings((s) => ({ ...s, language }))} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[88rem] px-8 pt-8 pb-28">
            {view === "portfolio" ? (
              <OverviewHeader settings={settings} openPlan={() => setPlanOpen(true)} />
            ) : view === "holdings" ? (
              <PortfolioHeader settings={settings} />
            ) : view === "mandate" ? (
              <MandateHeader settings={settings} />
            ) : view === "approvals" ? (
              <ApprovalsHeader settings={settings} />
            ) : view === "activity" ? (
              <ActivityHeader settings={settings} />
            ) : view === "proof" ? (
              <ProofHeader settings={settings} />
            ) : view === "demo" ? (
              <SecurityHeader settings={settings} />
            ) : (
              <div>
                <h1 className="font-display text-[2.2rem] font-semibold tracking-[-0.03em]">{title}</h1>
                <p className="mt-1 text-[1.05rem] text-muted">{subtitle}</p>
              </div>
            )}

            {notice ? <p className="slide-in mt-5 rounded-2xl bg-coral-soft p-4 text-lg text-coral">{notice}</p> : null}
            {error ? <p className="mt-5 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">{fill(t.shell.refreshFailed, { error })}</p> : null}
            {stale && view === "demo" ? <p className="mt-5 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">{t.shell.staleHere}</p> : null}
            {guardian ? (
              <p className="mt-5 flex items-start gap-3 rounded-2xl border border-sky/30 bg-sky-soft px-5 py-4 text-[0.95rem] text-sky">
                <Icon name="shieldCheck" size={20} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">{t.roles.contactView}.</span> {t.shell.guardianNote}
                </span>
              </p>
            ) : null}
            {guardian && waiting > 0 ? (
              <button onClick={() => setView("approvals")} className="slide-in mt-4 block w-full rounded-2xl border border-sun bg-sun-soft p-4 text-left text-base text-sun-ink">
                <span className="font-semibold">{fill(t.shell.guardianAlert, { n: waiting })}</span> {t.shell.guardianAlertMore}
              </button>
            ) : null}
            {!/^0x0+$/.test(p.agent.address) || !p.mandateSigned ? null : <p className="mt-5 rounded-2xl bg-sun-soft p-4 text-base text-sun-ink">{t.shell.noKey}</p>}

            <div className="mt-7">
              {view === "portfolio" ? <OverviewView state={state} settings={settings} mimo={mimo} onAck={ack} go={setView} openChat={() => setChatOpen(true)} onOpen={setReceipt} /> : null}
              {view === "holdings" ? <PortfolioView state={state} settings={settings} onAsk={askMimo} /> : null}
              {view === "mandate" ? <MandateView state={state} settings={settings} act={act} skew={skew} go={setView} onAsk={askMimo} /> : null}
              {view === "approvals" ? <ApprovalsView state={state} settings={settings} act={act} skew={skew} /> : null}
              {view === "activity" ? <ActivityView state={state} settings={settings} onOpen={setReceipt} /> : null}
              {view === "proof" ? <ProofView settings={settings} /> : null}
              {view === "demo" ? <SecurityView state={state} settings={settings} act={act} onAttack={setAttacking} /> : null}
            </div>
          </div>
        </main>
      </div>

      {/* the chat floats over the page; it stays mounted while minimised so the conversation is kept */}
      {!guardian ? (
        <>
          {chatOpen && chatExpanded ? <div className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-sm" onClick={() => setChatExpanded(false)} /> : null}
          <div className={`fixed z-50 ${chatExpanded ? "inset-4" : "right-6 bottom-6 h-[min(46rem,calc(100vh-3rem))] w-[27rem]"} ${chatOpen ? "slide-in" : "hidden"}`}>
            <Chat
              state={state}
              settings={settings}
              mimo={mimo}
              go={(v) => {
                setChatExpanded(false);
                setView(v);
              }}
              refresh={refresh}
              onBusy={setChatBusy}
              onStressed={setStressedAt}
              onClose={() => {
                setChatOpen(false);
                setChatExpanded(false);
              }}
              expanded={chatExpanded}
              onExpand={setChatExpanded}
              prefill={prefill}
            />
          </div>
          {!chatOpen ? (
            <button onClick={() => setChatOpen(true)} className={`mood-${mimo.mood} group fixed right-6 bottom-6 z-40 flex items-center gap-3`}>
              <span className="card-shadow rounded-xl border border-line bg-card px-4 py-2.5 text-left">
                <span className="block text-sm font-semibold">{fill(t.shell.talk, { agent: BRAND.agent })}</span>
                <span className="block text-xs text-muted">{p.agent.paused ? t.chat.paused : t.launcher[mimo.mood]}</span>
              </span>
              <span className="relative transition-transform group-hover:-translate-y-0.5">
                <MimoTile size={76} className="shadow-[0_8px_25px_rgb(23_63_50/0.16),0_2px_3px_rgb(23_63_50/0.06)]">
                  <Mascot mood={mimo.mood} size={68} still />
                </MimoTile>
                <span className="absolute right-1 bottom-1 size-3.5 rounded-full border-2 border-[#f8fbf1]" style={{ background: "var(--mood)" }} />
              </span>
            </button>
          ) : null}
        </>
      ) : null}

      {switchTo ? (
        <RoleDialog
          to={switchTo}
          settings={settings}
          onCancel={() => setSwitchTo(null)}
          onConfirm={() => {
            setSettings((x) => ({ ...x, role: switchTo }));
            setSwitchTo(null);
            setChatOpen(false);
          }}
        />
      ) : null}

      {receipt ? <ReceiptDialog receipt={receipt} settings={settings} onClose={() => setReceipt(null)} /> : null}

      {planOpen ? (
        <PlanDialog
          state={state}
          settings={settings}
          onClose={() => setPlanOpen(false)}
          onChange={(text) => {
            setPlanOpen(false);
            askMimo(text);
          }}
        />
      ) : null}
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
