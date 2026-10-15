"use client";

import { useState, type ReactNode } from "react";
import type { ApprovalRequest } from "@/lib/approvals";
import { BRAND } from "@/lib/brand";
import type { Draft } from "@/lib/drafts";
import { clock, fill, formatLeft, LOCALE, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { LetterField, LetterQuote } from "./Letter";
import { HappyMascot } from "./Mascot";
import { ASSET, ASSET_NAME, money } from "./Overview";
import type { Act, AppState, Settings } from "./types";
import { Card, short, useSecondsLeft } from "./ui";

type Props = { state: AppState; settings: Settings; act: Act; skew: number };

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

function Btn({
  kind = "primary",
  busy,
  children,
  onClick,
}: {
  kind?: "primary" | "ghost";
  busy?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  const style =
    kind === "primary"
      ? "bg-forest text-white hover:bg-forest-soft"
      : "border border-line text-ink hover:bg-paper";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${style}`}
    >
      {busy ? "…" : children}
    </button>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? clock(iso)
    : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(iso)}`;
};

// ---------------------------------------------------------------- what changes

type Mandate = AppState["portfolio"]["mandate"];
type Change = [
  label: string,
  from: number | string,
  to: number | string,
  unit: string,
];

/** The mandate terms that differ between two versions, with plain labels. */
function policyChanges(m: Mandate, next: Mandate, t: Strings): Change[] {
  return (
    [
      [t.approvals.fMaxTrade, m.maxTradePct, next.maxTradePct, "%"],
      [t.approvals.fPerDay, m.maxDailyVolumePct, next.maxDailyVolumePct, "%"],
      [t.approvals.fLoss, m.dailyLossPct, next.dailyLossPct, "%"],
      [t.approvals.fFloor, m.minDefensivePct, next.minDefensivePct, "%"],
      [t.approvals.fStreak, m.maxLossStreak, next.maxLossStreak, ""],
      [
        t.approvals.fPause,
        m.cooldownSeconds / 60,
        next.cooldownSeconds / 60,
        "",
      ],
    ] as Change[]
  ).filter(([, a, b]) => a !== b);
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      {changes.map(([label, a, b, unit]) => (
        <div key={label}>
          <p className="text-xs font-semibold text-muted">{label}</p>
          <p className="num mt-1 flex items-center gap-2.5 font-display text-[1.9rem] leading-none font-semibold">
            <span className="text-faint">
              {a}
              {unit}
            </span>
            <Icon name="arrow" size={18} className="text-sun-ink" />
            {b}
            {unit}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- needs your signature

function DraftCard({
  draft,
  state,
  settings,
  act,
  t,
}: {
  draft: Draft;
  state: AppState;
  settings: Settings;
  act: Act;
  t: Strings;
}) {
  const { busy, run } = useBusy(act);
  const [note, setNote] = useState("");
  const title = {
    sign_mandate: t.approvals.draftFirst,
    change_mandate: t.approvals.draftChange,
    halt_stop_loss: t.approvals.draftHalt,
  }[draft.kind];
  const raises = draft.risk === "raises";
  const chip = {
    first_mandate: t.approvals.riskFirst,
    lowers: t.approvals.riskLowers,
    raises: t.approvals.riskRaises,
  }[draft.risk];
  const changes =
    draft.kind === "change_mandate" && draft.payload
      ? policyChanges(state.portfolio.mandate, draft.payload.mandate, t)
      : [];
  const terms = (
    <ul className="mt-4 divide-y divide-line border-y border-line">
      {draft.summary.map((line) => (
        <li
          key={line}
          className="flex items-start gap-2.5 py-2.5 text-[0.95rem]"
        >
          <Icon
            name="check"
            size={16}
            strokeWidth={2.4}
            className="mt-0.5 shrink-0 text-leaf"
          />
          {line}
        </li>
      ))}
    </ul>
  );
  return (
    <Card className="slide-in p-7!">
      <div className="flex items-start gap-4">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${raises ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"}`}
        >
          <Icon name="mandate" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          <p className="text-sm text-muted">
            {fill(t.approvals.preparedBy, {
              agent: BRAND.agent,
              time: when(draft.createdAt),
            })}
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${raises ? "bg-sun-soft text-sun-ink" : "bg-mint text-leaf"}`}
        >
          <Icon name={raises ? "clock" : "check"} size={13} />
          {chip}
        </span>
      </div>
      <blockquote className="mt-5 border-l-2 border-sage pl-4">
        <p className="text-xs font-semibold tracking-wide text-faint uppercase">
          {fill(t.approvals.reason, { agent: BRAND.agent })}
        </p>
        <p className="mt-1 text-[0.95rem]">{draft.reason}</p>
      </blockquote>
      {changes.length ? (
        <div className="mt-5 rounded-xl bg-paper p-5">
          <p className="eyebrow mb-3">{t.approvals.whatChanges}</p>
          <ChangeList changes={changes} />
        </div>
      ) : null}
      {changes.length ? (
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-leaf">
            <Icon
              name="chevron"
              size={15}
              className="transition-transform group-open:rotate-180"
            />
            {fill(t.approvals.restSame, { n: draft.summary.length })}
          </summary>
          {terms}
        </details>
      ) : (
        terms
      )}
      {raises && state.letter && settings.role === "owner" ? (
        <div className="mt-5">
          <LetterQuote letter={state.letter} settings={settings} moment="beforeSign" />
        </div>
      ) : null}
      {raises ? (
        <p className="mt-4 rounded-xl bg-sun-soft/80 px-4 py-3 text-sm text-sun-ink">
          {t.approvals.raisesNote}
        </p>
      ) : null}
      {draft.kind === "sign_mandate" && settings.role === "owner" ? (
        <div className="mt-5">
          <p className="text-sm font-semibold">{t.letter.firstField}</p>
          <p className="mb-2 text-xs text-muted">{t.letter.firstHint}</p>
          <LetterField value={note} onChange={setNote} settings={settings} rows={2} />
        </div>
      ) : null}
      {settings.role === "owner" ? (
        <div className="mt-5 flex justify-end gap-2.5">
          <Btn
            kind="ghost"
            busy={busy === "dismiss"}
            onClick={() => run("dismiss", "owner", "dismiss", draft.id)}
          >
            {t.approvals.notNow}
          </Btn>
          <Btn
            busy={busy === "sign"}
            onClick={async () => {
              // the note is saved with the first signature, so it is there from day one
              if (draft.kind === "sign_mandate" && note.trim()) await act("owner", "letter", note);
              await run("sign", "owner", "sign", draft.id);
            }}
          >
            <Icon name="check" size={16} />
            {t.approvals.sign}
          </Btn>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t.approvals.ownerOnly}</p>
      )}
    </Card>
  );
}

function RequestCard({
  request: r,
  settings,
  act,
  t,
}: {
  request: ApprovalRequest;
  settings: Settings;
  act: Act;
  t: Strings;
}) {
  const { busy, run } = useBusy(act);
  return (
    <Card className="slide-in p-7!">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
          <Icon name="coins" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-semibold">
            {t.approvals.tradeRequest}
          </h3>
          <p className="text-sm text-muted">
            {fill(t.approvals.from, {
              agent: BRAND.agent,
              time: when(r.createdAt),
            })}
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-sun-soft px-3 py-1 text-xs font-semibold text-sun-ink">
          <Icon name="clock" size={13} />
          {r.status === "signed"
            ? t.approvals.signedTrading
            : t.approvals.needsSig}
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-lg text-muted">
          {r.side === "buy" ? t.approvals.buy : t.approvals.sell}
        </span>
        <span className="num font-display text-[2.4rem] leading-none font-semibold tracking-[-0.03em]">
          {money(r.usd, settings.currency)}
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${ASSET[r.symbol].tone}`}
        >
          <Icon name={ASSET[r.symbol].icon} size={15} />
          {ASSET_NAME[settings.language][r.symbol]}
        </span>
      </div>
      <blockquote className="mt-5 border-l-2 border-sage pl-4">
        <p className="text-xs font-semibold tracking-wide text-faint uppercase">
          {fill(t.approvals.reason, { agent: BRAND.agent })}
        </p>
        <p className="mt-1 text-[0.95rem]">{r.reason}</p>
      </blockquote>
      <p className="mt-4 text-sm text-muted">
        {fill(t.approvals.tradeNote, { agent: BRAND.agent })}
      </p>
      {settings.role === "owner" ? (
        <div className="mt-5 flex justify-end gap-2.5">
          <Btn
            kind="ghost"
            busy={busy === "reject"}
            onClick={() => run("reject", "owner", "reject", r.id)}
          >
            {t.approvals.decline}
          </Btn>
          <Btn
            busy={busy === "approve"}
            onClick={() => run("approve", "owner", "approve", r.id)}
          >
            <Icon name="check" size={16} />
            {t.approvals.signTrade}
          </Btn>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t.approvals.ownerOnly}</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- waiting their turn

type Queued = {
  key: string;
  label: string;
  detail: ReactNode;
  appliesFrom: string;
  vetoKey: string | null;
};

/** Changes that raise the risk and are waiting out the delay, each with what changes and who can stop it. */
function queueOf(state: AppState, settings: Settings, t: Strings): Queued[] {
  const p = state.portfolio;
  const m = p.mandate;
  const pm = p.pending.mandate;
  const names = ASSET_NAME[settings.language];
  const items: Queued[] = [];
  if (pm) {
    items.push({
      key: "mandate",
      label: t.mandate.wMandate,
      detail: <ChangeList changes={policyChanges(m, pm, t)} />,
      appliesFrom: pm.appliesFrom,
      vetoKey: "mandate",
    });
  }
  if (p.stopLoss.haltRequestAppliesFrom)
    items.push({
      key: "halt",
      label: t.mandate.wHalt,
      detail: t.approvals.dHalt,
      appliesFrom: p.stopLoss.haltRequestAppliesFrom,
      vetoKey: "stop-loss-halt",
    });
  if (p.pending.withdrawalAddress) {
    items.push({
      key: "wd",
      label: t.mandate.wWithdrawal,
      detail: fill(t.approvals.dWithdrawal, {
        to: short(p.pending.withdrawalAddress.to),
        current: short(p.keys.withdrawalAddress),
      }),
      appliesFrom: p.pending.withdrawalAddress.appliesFrom,
      vetoKey: "withdrawal-address",
    });
  }
  if (p.pending.agentKey) {
    items.push({
      key: "agent",
      label: t.mandate.wAgent,
      detail: fill(t.approvals.dAgent, {
        address: short(p.pending.agentKey.address),
        date: new Date(p.pending.agentKey.expires).toLocaleDateString(
          LOCALE[settings.language],
          { day: "numeric", month: "short", year: "numeric" },
        ),
      }),
      appliesFrom: p.pending.agentKey.appliesFrom,
      vetoKey: "agent-key",
    });
  }
  if (p.pending.unpause)
    items.push({
      key: "unpause",
      label: t.mandate.wUnpause,
      detail: t.approvals.dUnpause,
      appliesFrom: p.pending.unpause.appliesFrom,
      vetoKey: "unpause",
    });
  if (p.pending.waitingPeriod) {
    items.push({
      key: "delay",
      label: t.mandate.wDelay,
      detail: fill(t.approvals.dDelay, {
        from: Math.round(p.settings.loosenDelaySeconds / 60),
        to: Math.round(p.pending.waitingPeriod.seconds / 60),
      }),
      appliesFrom: p.pending.waitingPeriod.appliesFrom,
      vetoKey: "waiting-period",
    });
  }
  if (p.pending.guardian) {
    items.push({
      key: "guardian",
      label: /^0x0+$/.test(p.pending.guardian.to)
        ? t.mandate.wGuardianRemove
        : t.mandate.wGuardianReplace,
      detail: t.approvals.dGuardian,
      appliesFrom: p.pending.guardian.appliesFrom,
      vetoKey: null,
    });
  }
  for (const x of p.positions) {
    if (!x.pendingRule) continue;
    items.push({
      key: x.symbol,
      label: fill(t.mandate.wRule, { asset: names[x.symbol] }),
      detail:
        fill(t.approvals.dRule, {
          fromCap: x.rule.maxExposurePct,
          toCap: x.pendingRule.maxExposurePct,
          fromStop: x.rule.stopPrice ?? t.approvals.noStop,
          toStop: x.pendingRule.stopPrice ?? t.approvals.noStop,
        }) +
        (x.pendingRule.allowed && !x.rule.allowed ? t.approvals.dAdded : "") +
        ".",
      appliesFrom: x.pendingRule.appliesFrom,
      vetoKey: x.symbol,
    });
  }
  return items;
}

function QueuedCard({
  item,
  state,
  settings,
  act,
  skew,
  t,
}: { item: Queued } & Props & { t: Strings }) {
  const secs = useSecondsLeft(item.appliesFrom, skew);
  const { busy, run } = useBusy(act);
  const total = state.portfolio.settings.loosenDelaySeconds;
  const done = secs === null ? 1 : Math.max(0, Math.min(1, 1 - secs / total));
  const guardian = settings.role === "guardian";
  return (
    <section className="slide-in overflow-hidden rounded-(--radius-card) border border-sun/60 bg-card shadow-[0_10px_30px_-20px_rgb(138_90_18/0.35)]">
      <div className="h-1 bg-sun-soft">
        <div
          className="h-full bg-sun transition-[width] duration-1000"
          style={{ width: `${done * 100}%` }}
        />
      </div>
      <div className="p-7">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
            <Icon name="clock" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl font-semibold">{item.label}</h3>
            <p className="text-sm text-sun-ink">{t.approvals.raisesRisk}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-muted">
              {secs !== null ? t.approvals.canApplyIn : t.approvals.waitOver}
            </p>
            <p className="num mt-0.5 font-display text-[1.9rem] leading-none font-semibold text-sun-ink">
              {secs !== null ? formatLeft(secs, t) : t.approvals.readyShort}
            </p>
          </div>
        </div>
        <div className="mt-5 text-[0.95rem]">{item.detail}</div>
        {state.letter && !guardian ? (
          <div className="mt-5">
            <LetterQuote letter={state.letter} settings={settings} moment="whileWaiting" />
          </div>
        ) : null}
        <p className="mt-5 flex items-center gap-2 text-sm text-muted">
          <Icon name="shieldCheck" size={15} className="text-leaf" />
          {guardian
            ? t.approvals.guardianCan
            : `${t.approvals.tighterNote} ${t.approvals.guardianTold}`}
        </p>
        <div className="mt-5 flex justify-end gap-2.5">
          {guardian ? (
            item.vetoKey ? (
              <Btn
                busy={busy === "veto"}
                onClick={() =>
                  run("veto", "guardian", "veto", item.vetoKey as string)
                }
              >
                <Icon name="close" size={15} />
                {t.approvals.veto}
              </Btn>
            ) : (
              <Btn
                kind="ghost"
                busy={busy === "own"}
                onClick={() => run("own", "guardian", "veto-own-removal")}
              >
                {t.approvals.tryVeto}
              </Btn>
            )
          ) : (
            <>
              <Btn
                kind="ghost"
                busy={busy === "cancel"}
                onClick={() =>
                  run("cancel", "owner", "cancel", item.vetoKey ?? "guardian")
                }
              >
                {t.approvals.cancelChange}
              </Btn>
              {secs === null ? (
                <Btn
                  busy={busy === "apply"}
                  onClick={() => run("apply", "owner", "apply")}
                >
                  {t.approvals.applyNow}
                </Btn>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- page

function HowCard({ state, t }: { state: AppState; t: Strings }) {
  const minutes = Math.round(state.portfolio.settings.loosenDelaySeconds / 60);
  const wait = fill(t.mandate.minutesDemo, { n: minutes });
  const steps: [string, string][] = [
    [fill(t.approvals.step1, { agent: BRAND.agent }), t.approvals.step1Note],
    [t.approvals.step2, t.approvals.step2Note],
    [t.approvals.step3, fill(t.approvals.step3Note, { wait })],
  ];
  return (
    <Card className="p-7!">
      <h3 className="font-display text-lg font-semibold">
        {t.approvals.howTitle}
      </h3>
      <ol className="mt-4 space-y-4">
        {steps.map(([title, note], i) => (
          <li key={title} className="flex gap-3.5">
            <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-mint text-sm font-semibold text-forest">
              {i + 1}
            </span>
            <div>
              <p className="text-[0.95rem] font-semibold">{title}</p>
              <p className="mt-0.5 text-sm text-muted">{note}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <p className="eyebrow mb-3 flex items-center gap-2">
        {title}
        <span className="num rounded-md bg-sun-soft px-1.5 py-0.5 text-xs text-sun-ink">
          {count}
        </span>
      </p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function ApprovalsHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language, settings.role);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.approvals.title}{" "}
        <span className="accent">{t.approvals.titleAccent}</span>
      </h1>
      <p className="mt-1.5 text-[1.05rem] text-muted">
        {fill(t.approvals.sub, { agent: BRAND.agent })}
      </p>
    </div>
  );
}

export function ApprovalsView(props: Props) {
  const { state, settings, act } = props;
  const t = strings(settings.language, settings.role);
  const queue = queueOf(state, settings, t);
  const toSign = state.drafts.length + state.requests.length;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-8">
        {toSign === 0 && queue.length === 0 ? (
          <Card className="flex flex-wrap items-center gap-6 p-8!">
            <HappyMascot size={140} />
            <div className="max-w-md">
              <h2 className="font-serif text-[1.9rem] leading-tight">
                {t.approvals.emptyTitle}
              </h2>
              <p className="mt-2 text-[0.95rem] text-muted">
                {fill(t.approvals.emptyBody, { agent: BRAND.agent })}
              </p>
            </div>
          </Card>
        ) : null}
        {/* the guardian acts on the queue, so it comes first for them */}
        {settings.role === "guardian" ? (
          <>
            {queue.length ? (
              <Group title={t.approvals.waitingTurn} count={queue.length}>
                {queue.map((item) => (
                  <QueuedCard key={item.key} item={item} {...props} t={t} />
                ))}
              </Group>
            ) : null}
            {toSign ? (
              <Group title={t.approvals.needsYou} count={toSign}>
                {state.drafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    state={state}
                    settings={settings}
                    act={act}
                    t={t}
                  />
                ))}
                {state.requests.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    settings={settings}
                    act={act}
                    t={t}
                  />
                ))}
              </Group>
            ) : null}
          </>
        ) : (
          <>
            {toSign ? (
              <Group title={t.approvals.needsYou} count={toSign}>
                {state.drafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    state={state}
                    settings={settings}
                    act={act}
                    t={t}
                  />
                ))}
                {state.requests.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    settings={settings}
                    act={act}
                    t={t}
                  />
                ))}
              </Group>
            ) : null}
            {queue.length ? (
              <Group title={t.approvals.waitingTurn} count={queue.length}>
                {queue.map((item) => (
                  <QueuedCard key={item.key} item={item} {...props} t={t} />
                ))}
              </Group>
            ) : null}
          </>
        )}
      </div>
      <HowCard state={state} t={t} />
    </div>
  );
}
