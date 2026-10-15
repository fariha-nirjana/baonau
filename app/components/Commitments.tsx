"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { statusOf, type CommitmentKind, type CommitmentMeta, type CommitmentStatus, type CommitmentView } from "@/lib/commitment-status";
import { CURRENCIES } from "@/lib/money";
import { fill, formatLeft, LOCALE, strings, type Strings } from "./i18n";
import { Icon, type IconName } from "./icons";
import { HappyMascot, Mascot } from "./Mascot";
import { money } from "./Overview";
import type { Act, AppState, Mood, Settings } from "./types";
import { Card, Chip, useSecondsLeft, type Tone } from "./ui";

type Props = { state: AppState; settings: Settings; act: Act; skew: number; onAsk: (text: string, send?: boolean) => void; adding: boolean; setAdding: (open: boolean) => void };
type Row = { c: CommitmentView; m: CommitmentMeta; status: CommitmentStatus };

const KIND: Record<CommitmentKind, { icon: IconName; tone: string }> = {
  rent: { icon: "home", tone: "bg-mint text-leaf" },
  bill: { icon: "bolt", tone: "bg-sun-soft text-sun-ink" },
  tuition: { icon: "cap", tone: "bg-sky-soft text-sky" },
  family: { icon: "heart", tone: "bg-cream text-forest" },
  savings: { icon: "lock", tone: "bg-mint text-forest" },
  other: { icon: "wallet", tone: "bg-cream text-muted" },
};

const KIND_LABEL = (t: Strings): Record<CommitmentKind, string> => ({
  rent: t.commitments.kRent,
  bill: t.commitments.kBill,
  tuition: t.commitments.kTuition,
  family: t.commitments.kFamily,
  savings: t.commitments.kSavings,
  other: t.commitments.kOther,
});

const DAY = 86_400;
const day = (iso: string | null, settings: Settings) =>
  iso ? new Date(iso).toLocaleDateString(LOCALE[settings.language], { day: "numeric", month: "short" }) : "";

function everyText(c: Pick<CommitmentView, "periodSeconds">, t: Strings) {
  if (c.periodSeconds === 0) return t.commitments.once;
  if (c.periodSeconds === 30 * DAY) return t.commitments.monthly;
  if (c.periodSeconds === 7 * DAY) return t.commitments.weekly;
  return fill(t.commitments.everyDays, { n: Math.round(c.periodSeconds / DAY) });
}

function rowsOf(state: AppState): Row[] {
  const now = new Date(state.portfolio.at);
  return state.portfolio.commitments.map((c) => ({
    c,
    m: state.commitmentMeta[String(c.id)] ?? { name: `#${c.id}`, kind: c.payee ? "other" : "savings", payeeName: null, autopay: false },
    status: statusOf(c, now),
  }));
}

function useBusy(act: Act) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, ...args: Parameters<Act>) => {
    setBusy(id);
    try {
      return await act(...args);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- header and summary

export function CommitmentsHeader({ settings, onAdd }: { settings: Settings; onAdd: () => void }) {
  const t = strings(settings.language, settings.role);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow flex items-center gap-2">
          <Icon name="sparkle" size={14} className="text-sun" />
          {t.commitments.eyebrow}
        </p>
        <h1 className="mt-2 font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
          {t.commitments.title} <span className="accent">{t.commitments.titleAccent}</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-[1.05rem] text-muted">{fill(t.commitments.sub, { agent: BRAND.agent })}</p>
      </div>
      {settings.role === "owner" ? (
        <button onClick={onAdd} className="flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-base font-semibold text-white shadow-[0_8px_20px_-10px_rgb(24_60_48/0.6)] hover:bg-forest-soft">
          <Icon name="plus" size={17} />
          {t.commitments.add}
        </button>
      ) : null}
    </div>
  );
}

function Summary({ rows, state, settings, t }: { rows: Row[]; state: AppState; settings: Settings; t: Strings }) {
  const now = new Date(state.portfolio.at).getTime();
  const payable = rows.filter((r) => r.c.active && r.c.payee && r.c.nextDue);
  const soon = payable.filter((r) => new Date(r.c.nextDue!).getTime() - now <= 30 * DAY * 1000);
  const dueSum = soon.reduce((a, r) => a + Number(r.c.maxAmount), 0);
  const next = [...payable].sort((a, b) => new Date(a.c.nextDue!).getTime() - new Date(b.c.nextDue!).getTime())[0];
  const cell = "px-7 py-6";
  return (
    <Card className="grid overflow-hidden p-0! md:grid-cols-[1fr_1fr_1.1fr]">
      <div className={`${cell} border-b border-line md:border-r md:border-b-0`}>
        <p className="eyebrow">{t.commitments.sSetAside}</p>
        <p className="num mt-3 font-display text-[2.4rem] leading-none font-semibold tracking-[-0.03em]">{money(state.portfolio.setAside, settings.currency)}</p>
        <p className="mt-1 text-xs text-faint">≈ {Number(state.portfolio.setAside).toFixed(2)} tUSD</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          <Icon name="shieldCheck" size={15} />
          {t.commitments.sSetAsideNote}
        </p>
      </div>
      <div className={`${cell} border-b border-line md:border-r md:border-b-0`}>
        <p className="eyebrow">{t.commitments.sDue}</p>
        <p className="num mt-3 font-display text-[2.4rem] leading-none font-semibold tracking-[-0.03em]">{money(dueSum, settings.currency)}</p>
        <p className="mt-1 text-xs text-faint">≈ {dueSum.toFixed(2)} tUSD</p>
        <p className="mt-3 text-sm text-muted">{fill(t.commitments.sDueNote, { n: soon.length })}</p>
      </div>
      <div className={`${cell} bg-[color-mix(in_oklab,var(--color-mint)_75%,var(--color-card))]`}>
        <p className="eyebrow">{t.commitments.sNext}</p>
        {next ? (
          <>
            <p className="mt-3 flex items-baseline gap-3">
              <span className="font-serif text-[2.1rem] leading-none text-forest">{next.m.name}</span>
              <span className="num text-sm text-muted">{day(next.c.nextDue, settings)}</span>
            </p>
            <p className="mt-3 text-sm text-muted">{statusText(next.status, settings, t)}</p>
          </>
        ) : (
          <p className="mt-3 text-[0.95rem] text-muted">{t.commitments.sNextNone}</p>
        )}
      </div>
    </Card>
  );
}

function statusText(s: CommitmentStatus, settings: Settings, t: Strings) {
  switch (s.kind) {
    case "ready":
      return t.commitments.stReady;
    case "due":
      return t.commitments.stDue;
    case "needs_funding":
      return fill(t.commitments.stShort, { amount: money(s.shortBy, settings.currency) });
    case "waiting":
      return t.commitments.stWaiting;
    case "closed":
      return t.commitments.stClosed;
    case "reserved":
      return t.commitments.stReserved;
  }
}

const STATUS_TONE: Record<CommitmentStatus["kind"], Tone> = {
  ready: "good",
  due: "good",
  needs_funding: "warn",
  waiting: "info",
  closed: "plain",
  reserved: "plain",
};

// ---------------------------------------------------------------- one commitment

/** Puts a live element where `slot` appears in a translated sentence, so word order stays right in every language. */
function Around({ text, slot, children }: { text: string; slot: string; children: ReactNode }) {
  const [before, after = ""] = text.split(slot);
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}

function Countdown({ iso, skew, t }: { iso: string; skew: number; t: Strings }) {
  const secs = useSecondsLeft(iso, skew);
  return <>{secs === null ? "0 s" : formatLeft(secs, t)}</>;
}

function CommitmentCard({
  row,
  settings,
  t,
  skew,
  open,
  lastPaid,
}: {
  row: Row;
  settings: Settings;
  t: Strings;
  skew: number;
  open: (d: DialogState) => void;
  lastPaid: string | null;
}) {
  const { c, m, status } = row;
  const kind = KIND[m.kind] ?? KIND.other;
  const owner = settings.role === "owner";
  const [menu, setMenu] = useState(false);
  // a payee still waiting is measured against the terms it will have
  const need = c.payee ? Number(c.maxAmount) : c.pending?.payee ? Number(c.pending.maxAmount) : Number(c.reserved);
  const pct = need > 0 ? Math.min(100, Math.round((Number(c.reserved) / need) * 100)) : 100;
  const short = status.kind === "needs_funding";
  const terms = c.active ? c : c.pending;
  return (
    <Card className="overflow-hidden p-0!">
      <div className="px-7 pt-6 pb-5">
        <div className="flex items-start gap-4">
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${kind.tone}`}>
            <Icon name={kind.icon} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl font-semibold">{m.name}</h3>
            <p className="mt-0.5 text-sm text-muted">{c.payee || c.pending?.payee ? `${m.payeeName ?? "?"} · ${t.commitments.testnetPayee}` : t.commitments.nobody}</p>
          </div>
          {terms?.payee ? (
            <div className="text-right">
              <p className="num font-display text-[1.7rem] leading-none font-semibold">{money(terms.maxAmount, settings.currency)}</p>
              <p className="num mt-1 text-xs text-faint">{Number(terms.maxAmount).toFixed(2)} tUSD</p>
              <p className="mt-1 text-sm text-muted">
                {everyText(terms, t)} · {day(terms.nextDue, settings)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between text-sm text-muted">
          <span>
            {fill(t.commitments.setAsideOf, {
              have: money(c.reserved, settings.currency),
              need: money(need, settings.currency),
            })}
          </span>
          <span className="num">{pct}%</span>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-cream">
          <div className={`h-2.5 rounded-full transition-[width] duration-700 ${short ? "bg-sun" : "bg-sage"}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Chip tone={STATUS_TONE[status.kind]}>{statusText(status, settings, t)}</Chip>
          {status.kind === "waiting" ? (
            <span className="text-sm text-muted">
              <Around text={t.commitments.waitingNote} slot="{time}">
                <span className="num font-semibold text-sky">
                  <Countdown iso={status.appliesFrom} skew={skew} t={t} />
                </span>
              </Around>
            </span>
          ) : c.payee ? (
            <span className="text-sm text-muted">{m.autopay ? t.commitments.autopayOn : t.commitments.autopayOff}</span>
          ) : null}
          {c.pendingRelease ? (
            <span className="text-sm text-sun-ink">
              <Around text={fill(t.commitments.releasing, { amount: money(c.pendingRelease.amount, settings.currency) })} slot="{time}">
                <span className="num font-semibold">
                  <Countdown iso={c.pendingRelease.appliesFrom} skew={skew} t={t} />
                </span>
              </Around>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper/60 px-7 py-4">
        <p className="text-sm text-muted">{lastPaid ? fill(t.commitments.lastPaid, { date: day(lastPaid, settings) }) : t.commitments.noPayments}</p>
        {owner ? (
          <div className="relative flex items-center gap-2">
            <button
              disabled={!c.active || !c.payee || Number(c.reserved) <= 0}
              onClick={() => open({ kind: "pay", row })}
              className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.commitments.payNow}
            </button>
            <button onClick={() => open({ kind: "topup", row })} className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold hover:bg-cream">
              {t.commitments.topUp}
            </button>
            <button aria-label={t.commitments.more} onClick={() => setMenu((v) => !v)} className="rounded-xl border border-line bg-card px-3 py-2 hover:bg-cream">
              <Icon name="dots" size={18} strokeWidth={3} />
            </button>
            {menu ? (
              <div className="slide-in absolute right-0 bottom-12 z-20 w-64 rounded-2xl border border-line bg-card p-1.5 shadow-xl" onMouseLeave={() => setMenu(false)}>
                {Number(c.reserved) > 0 ? (
                  <MenuItem
                    icon="arrowUpRight"
                    onClick={() => {
                      setMenu(false);
                      open({ kind: "release", row });
                    }}
                  >
                    {t.commitments.menuRelease}
                  </MenuItem>
                ) : null}
                {c.payee || c.pending?.payee ? (
                  <MenuItem
                    icon={m.autopay ? "user" : "bolt"}
                    onClick={() => {
                      setMenu(false);
                      open({ kind: "autopay", row });
                    }}
                  >
                    {m.autopay ? t.commitments.menuAsk : t.commitments.menuAuto}
                  </MenuItem>
                ) : null}
                {c.active || c.pending ? (
                  <MenuItem
                    icon="x"
                    onClick={() => {
                      setMenu(false);
                      open({ kind: "remove", row });
                    }}
                  >
                    {t.commitments.menuRemove}
                  </MenuItem>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function MenuItem({ icon, onClick, children }: { icon: IconName; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-cream">
      <Icon name={icon} size={15} className="text-muted" />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- side column

function TakeCard({ rows, settings, t, onAsk, skew }: { rows: Row[]; settings: Settings; t: Strings; onAsk: (text: string, send?: boolean) => void; skew: number }) {
  const short = rows.find((r) => r.status.kind === "needs_funding");
  const waiting = rows.find((r) => r.status.kind === "waiting");
  const any = rows.some((r) => r.status.kind !== "closed");
  const next = rows.find((r) => r.status.kind === "ready" || r.status.kind === "due");
  // Bunbun's face follows the situation: worried about a shortfall, holding the line while a payee waits, happy when all is set aside
  const mood: Mood | "happy" = short ? "worried" : waiting ? "holding" : any ? "happy" : "watching";
  const line = short
    ? fill(t.commitments.takeShort, { name: short.m.name, amount: money(short.status.kind === "needs_funding" ? short.status.shortBy : 0, settings.currency) })
    : waiting && waiting.status.kind === "waiting"
      ? fill(t.commitments.takeWaiting, { name: waiting.m.name, time: day(waiting.status.appliesFrom, settings) })
      : next
        ? fill(t.commitments.takeAllSet, { name: next.m.name })
        : t.commitments.takeEmpty;
  return (
    <Card className="overflow-hidden border-sage/25 bg-[color-mix(in_oklab,var(--color-mint)_70%,var(--color-card))] p-0!">
      <div className="px-7 pt-6 pb-5 text-center">
        <p className="eyebrow">{fill(t.commitments.takeEyebrow, { agent: BRAND.agent })}</p>
        <div className="mt-2 flex justify-center">{mood === "happy" ? <HappyMascot size={170} /> : <Mascot mood={mood} size={170} />}</div>
        <h3 className="mt-1 font-serif text-[1.75rem] leading-tight whitespace-pre-line text-forest">{t.commitments.takeTitle}</h3>
        <p className="mt-3 text-[0.95rem] text-muted">{line}</p>
        {waiting && waiting.status.kind === "waiting" ? (
          <p className="num mt-1 text-sm font-semibold text-sky">
            <Countdown iso={waiting.status.appliesFrom} skew={skew} t={t} />
          </p>
        ) : null}
      </div>
      {settings.role === "owner" ? (
        <button onClick={() => onAsk(t.commitments.talkPrompt, true)} className="flex w-full items-center justify-between border-t border-sage/25 px-7 py-4 text-left text-[0.95rem] font-semibold text-forest hover:bg-mint">
          {t.commitments.takeTalk}
          <Icon name="arrowUpRight" size={17} />
        </button>
      ) : null}
    </Card>
  );
}

function PendingNotice({ row, settings, t, act, skew }: { row: Row; settings: Settings; t: Strings; act: Act; skew: number }) {
  const { busy, run } = useBusy(act);
  const p = row.c.pending!;
  const guardian = settings.role === "guardian";
  return (
    <Card className="border-sun/40 bg-sun-soft/50 p-6!">
      <h4 className="font-display text-[1.05rem] font-semibold text-sun-ink">{fill(t.commitments.newPayee, { name: row.m.payeeName ?? row.m.name })}</h4>
      <p className="mt-2 text-sm text-sun-ink/90">
        {fill(t.commitments.newPayeeBody, {
          time: day(p.appliesFrom, settings),
          amount: money(p.maxAmount, settings.currency),
          every: everyText(p, t).toLowerCase(),
        })}{" "}
        <span className="num font-semibold">
          (<Countdown iso={p.appliesFrom} skew={skew} t={t} />)
        </span>
      </p>
      <p className="mt-1 text-sm text-sun-ink/90">{t.commitments.newPayeeVeto}</p>
      <button
        disabled={busy !== null}
        onClick={() => run("cancel", guardian ? "guardian" : "owner", guardian ? "veto" : "cancel", `commitment-${row.c.id}`)}
        className="mt-4 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-soft disabled:opacity-50"
      >
        {busy ? "…" : guardian ? strings(settings.language, "guardian").approvals.veto : t.commitments.cancel}
      </button>
    </Card>
  );
}

function ReleaseNotice({ row, settings, t, act, skew }: { row: Row; settings: Settings; t: Strings; act: Act; skew: number }) {
  const { busy, run } = useBusy(act);
  const r = row.c.pendingRelease!;
  const guardian = settings.role === "guardian";
  return (
    <Card className="border-sun/40 bg-sun-soft/50 p-6!">
      <h4 className="font-display text-[1.05rem] font-semibold text-sun-ink">{fill(t.approvals.wRelease, { name: row.m.name })}</h4>
      <p className="mt-2 text-sm text-sun-ink/90">
        {fill(t.approvals.dRelease, { amount: money(r.amount, settings.currency) })}{" "}
        <span className="num font-semibold">
          (<Countdown iso={r.appliesFrom} skew={skew} t={t} />)
        </span>
      </p>
      <button
        disabled={busy !== null}
        onClick={() => run("cancel", guardian ? "guardian" : "owner", guardian ? "veto" : "cancel", `release-${row.c.id}`)}
        className="mt-4 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white hover:bg-forest-soft disabled:opacity-50"
      >
        {busy ? "…" : guardian ? strings(settings.language, "guardian").approvals.veto : t.commitments.cancel}
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------- dialogs

type DialogState = { kind: "pay" | "topup" | "release" | "remove" | "autopay"; row: Row } | null;

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="slide-in max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-(--radius-card) bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-[1.8rem] leading-tight">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Actions({ onCancel, onConfirm, busy, label, t, disabled }: { onCancel: () => void; onConfirm: () => void; busy: boolean; label: string; t: Strings; disabled?: boolean }) {
  return (
    <div className="mt-6 flex justify-end gap-2.5">
      <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper">
        {t.commitments.cancel}
      </button>
      <button disabled={busy || disabled} onClick={onConfirm} className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft disabled:opacity-50">
        {busy ? "…" : label}
      </button>
    </div>
  );
}

const inputClass = "mt-1.5 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-base outline-none focus:border-sage";

/** An amount in the screen's currency. Left as suggested, the exact tUSD figure is sent, so nothing is lost to rounding. */
function AmountDialog({ d, state, settings, t, act, onClose }: { d: NonNullable<DialogState>; state: AppState; settings: Settings; t: Strings; act: Act; onClose: () => void }) {
  const { c, m } = d.row;
  const [busy, setBusy] = useState(false);
  const rate = CURRENCIES[settings.currency].perUsd;
  const suggestedUsd =
    d.kind === "pay"
      ? Math.min(Number(c.maxAmount), Number(c.reserved))
      : d.kind === "release"
        ? Number(c.reserved)
        : Math.max(0, Math.min(Number(state.portfolio.cash), d.row.status.kind === "needs_funding" ? d.row.status.shortBy : Number(c.maxAmount) || 0));
  const suggested = (suggestedUsd * rate).toFixed(CURRENCIES[settings.currency].decimals);
  const [value, setValue] = useState(suggested);
  const title =
    d.kind === "pay" ? fill(t.commitments.payTitle, { name: m.name }) : d.kind === "release" ? fill(t.commitments.releaseTitle, { name: m.name }) : fill(t.commitments.topUpTitle, { name: m.name });
  const wait = formatLeft(state.portfolio.settings.loosenDelaySeconds, t);
  const note =
    d.kind === "pay"
      ? fill(t.commitments.payNote, { payee: m.payeeName ?? "?", date: day(c.nextDue, settings) })
      : d.kind === "release"
        ? fill(t.commitments.releaseNote, { wait })
        : t.commitments.topUpNote;
  const action = { pay: "commitment-pay", release: "commitment-release", topup: "commitment-set-aside" }[d.kind as "pay" | "release" | "topup"];
  const submit = async () => {
    setBusy(true);
    const exact = value === suggested;
    await act("owner", action, JSON.stringify({ id: c.id, amount: exact ? suggestedUsd : Number(value), currency: exact ? "tUSD" : settings.currency }));
    setBusy(false);
    onClose();
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mt-2 text-[0.95rem] text-muted">{note}</p>
      <label className="mt-5 block text-sm font-semibold">
        {t.commitments.amount} ({CURRENCIES[settings.currency].sign})
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className={`${inputClass} num`} />
      </label>
      <p className="num mt-1.5 text-xs text-faint">≈ {(Number(value || 0) / rate).toFixed(2)} tUSD</p>
      <Actions onCancel={onClose} onConfirm={submit} busy={busy} label={d.kind === "pay" ? t.commitments.payNow : t.commitments.confirm} t={t} disabled={!(Number(value) > 0)} />
    </Dialog>
  );
}

function RemoveDialog({ d, t, act, onClose }: { d: NonNullable<DialogState>; t: Strings; act: Act; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={fill(t.commitments.removeTitle, { name: d.row.m.name })} onClose={onClose}>
      <p className="mt-2 text-[0.95rem] text-muted">{t.commitments.removeNote}</p>
      <Actions
        onCancel={onClose}
        onConfirm={async () => {
          setBusy(true);
          await act("owner", "commitment-remove", String(d.row.c.id));
          setBusy(false);
          onClose();
        }}
        busy={busy}
        label={t.commitments.confirm}
        t={t}
      />
    </Dialog>
  );
}

function AddDialog({ state, settings, t, act, onClose }: { state: AppState; settings: Settings; t: Strings; act: Act; onClose: () => void }) {
  const labels = KIND_LABEL(t);
  const [kind, setKind] = useState<CommitmentKind>("rent");
  const [name, setName] = useState("");
  const [payee, setPayee] = useState("");
  const [nobody, setNobody] = useState(false);
  const [amount, setAmount] = useState("");
  const [every, setEvery] = useState<"month" | "week" | "once">("month");
  const [first, setFirst] = useState(() => new Date(new Date(state.portfolio.at).getTime() + 7 * DAY * 1000).toISOString().slice(0, 10));
  const [setAside, setSetAside] = useState("");
  const [autopay, setAutopay] = useState(true);
  const [busy, setBusy] = useState(false);
  const sign = CURRENCIES[settings.currency].sign;
  const wait = formatLeft(state.portfolio.settings.loosenDelaySeconds, t);
  const ok = name.trim() && Number(amount) > 0 && (nobody || payee.trim());
  const submit = async () => {
    setBusy(true);
    await act(
      "owner",
      "commitment-add",
      JSON.stringify({
        name: name.trim(),
        kind,
        payeeName: nobody ? null : payee.trim(),
        amount: Number(amount),
        currency: settings.currency,
        every,
        firstDue: first,
        setAside: nobody ? Number(amount) : Number(setAside || amount),
        autopay,
      }),
    );
    setBusy(false);
    onClose();
  };
  return (
    <Dialog title={t.commitments.fTitle} onClose={onClose}>
      <div className="mt-5 grid gap-4">
        <div>
          <p className="text-sm font-semibold">{t.commitments.fKind}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(Object.keys(KIND) as CommitmentKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold ${k === kind ? "border-sage bg-mint text-forest" : "border-line hover:bg-cream"}`}
              >
                <Icon name={KIND[k].icon} size={14} />
                {labels[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm font-semibold">
          {t.commitments.fName}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.commitments.fNameHint} className={inputClass} />
        </label>
        <div>
          <label className="block text-sm font-semibold">
            {t.commitments.fPayee}
            <input value={payee} disabled={nobody} onChange={(e) => setPayee(e.target.value)} className={`${inputClass} disabled:opacity-50`} />
          </label>
          <p className="mt-1 text-xs text-faint">{t.commitments.fPayeeHint}</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={nobody} onChange={(e) => setNobody(e.target.checked)} />
            {t.commitments.fNoPayee}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            {nobody ? t.commitments.fKeep : t.commitments.fAmount} ({sign})
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={`${inputClass} num`} />
          </label>
          {!nobody ? (
            <label className="block text-sm font-semibold">
              {t.commitments.fSetAside} ({sign})
              <input inputMode="decimal" value={setAside} placeholder={amount} onChange={(e) => setSetAside(e.target.value.replace(/[^\d.]/g, ""))} className={`${inputClass} num`} />
            </label>
          ) : null}
        </div>
        {!nobody ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold">
              {t.commitments.fEvery}
              <select value={every} onChange={(e) => setEvery(e.target.value as "month" | "week" | "once")} className={inputClass}>
                <option value="month">{t.commitments.monthly}</option>
                <option value="week">{t.commitments.weekly}</option>
                <option value="once">{t.commitments.once}</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              {t.commitments.fFirst}
              <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={`${inputClass} num`} />
            </label>
          </div>
        ) : null}
        {!nobody ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
            {t.commitments.fAutopay}
          </label>
        ) : null}
        <p className="rounded-xl bg-paper px-4 py-3 text-xs text-muted">{fill(t.commitments.fNote, { wait })}</p>
      </div>
      <Actions onCancel={onClose} onConfirm={submit} busy={busy} label={t.commitments.fSave} t={t} disabled={!ok} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- the page

export function CommitmentsView({ state, settings, act, skew, onAsk, adding, setAdding }: Props) {
  const t = strings(settings.language, settings.role);
  const rows = rowsOf(state);
  const live = rows.filter((r) => r.status.kind !== "closed");
  const paid = state.receipts.filter((r) => r.paid !== null);
  const [tab, setTab] = useState<"upcoming" | "paid">("upcoming");
  const [dialog, setDialog] = useState<DialogState>(null);
  const lastPaidOf = (id: number) => paid.find((r) => r.commitment === id)?.at ?? null;

  useEffect(() => {
    if (dialog?.kind !== "autopay") return;
    const { c, m } = dialog.row;
    void act("owner", "commitment-autopay", JSON.stringify({ id: c.id, on: !m.autopay })).finally(() => setDialog(null));
  }, [dialog, act]);

  return (
    <div className="space-y-6">
      <Summary rows={rows} state={state} settings={settings} t={t} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div>
          <div className="flex items-end justify-between border-b border-line">
            <div className="flex gap-6">
              {(
                [
                  ["upcoming", t.commitments.tabUpcoming, live.length],
                  ["paid", t.commitments.tabPaid, paid.length],
                ] as const
              ).map(([id, label, n]) => (
                <button key={id} onClick={() => setTab(id)} className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-[0.95rem] font-semibold ${tab === id ? "border-forest text-forest" : "border-transparent text-muted hover:text-ink"}`}>
                  {label}
                  <span className="num rounded-md bg-cream px-1.5 py-0.5 text-xs text-muted">{n}</span>
                </button>
              ))}
            </div>
            <p className="pb-3 text-xs text-faint">{t.commitments.testnet}</p>
          </div>

          <div className="mt-5 space-y-4">
            {tab === "upcoming" ? (
              live.length ? (
                live.map((row) => <CommitmentCard key={row.c.id} row={row} settings={settings} t={t} skew={skew} open={setDialog} lastPaid={lastPaidOf(row.c.id)} />)
              ) : (
                <Card className="p-8!">
                  <h3 className="font-serif text-[1.7rem]">{t.commitments.emptyTitle}</h3>
                  <p className="mt-2 max-w-lg text-[0.95rem] text-muted">{fill(t.commitments.emptyBody, { agent: BRAND.agent })}</p>
                </Card>
              )
            ) : paid.length ? (
              <Card className="p-0!">
                <ul className="divide-y divide-line">
                  {paid.map((r) => (
                    <li key={r.ref} className="flex items-center justify-between gap-4 px-6 py-4">
                      <span className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-mint text-leaf">
                          <Icon name="check" size={16} strokeWidth={2.6} />
                        </span>
                        <span>
                          <span className="block text-[0.95rem] font-semibold">{r.what}</span>
                          <span className="block text-xs text-muted">{new Date(r.at).toLocaleString(LOCALE[settings.language], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </span>
                      </span>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-semibold text-leaf hover:underline">
                          tx <Icon name="arrowUpRight" size={14} />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Card className="p-8! text-[0.95rem] text-muted">{t.commitments.noPayments}</Card>
            )}
          </div>

          <p className="mt-6 flex items-start gap-2.5 text-sm text-muted">
            <Icon name="shieldCheck" size={17} className="mt-0.5 shrink-0" />
            {t.commitments.footer}
          </p>
        </div>

        <div className="space-y-4">
          <TakeCard rows={rows} settings={settings} t={t} onAsk={onAsk} skew={skew} />
          <Card className="p-7!">
            <p className="eyebrow">{t.commitments.availEyebrow}</p>
            <p className="num mt-3 font-display text-[2.2rem] leading-none font-semibold tracking-[-0.03em]">{money(state.portfolio.cash, settings.currency)}</p>
            <p className="mt-1 text-xs text-faint">≈ {Number(state.portfolio.cash).toFixed(2)} tUSD</p>
            <p className="mt-3 text-sm text-muted">{t.commitments.availNote}</p>
          </Card>
          {settings.role === "guardian" ? <p className="rounded-2xl border border-sky/30 bg-sky-soft px-5 py-4 text-sm text-sky">{t.commitments.contactNote}</p> : null}
          {rows.filter((r) => r.c.pending).map((r) => (
            <PendingNotice key={`p${r.c.id}`} row={r} settings={settings} t={t} act={act} skew={skew} />
          ))}
          {rows.filter((r) => r.c.pendingRelease).map((r) => (
            <ReleaseNotice key={`r${r.c.id}`} row={r} settings={settings} t={t} act={act} skew={skew} />
          ))}
        </div>
      </div>

      {dialog && (dialog.kind === "pay" || dialog.kind === "topup" || dialog.kind === "release") ? (
        <AmountDialog d={dialog} state={state} settings={settings} t={t} act={act} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "remove" ? <RemoveDialog d={dialog} t={t} act={act} onClose={() => setDialog(null)} /> : null}
      {adding ? <AddDialog state={state} settings={settings} t={t} act={act} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
