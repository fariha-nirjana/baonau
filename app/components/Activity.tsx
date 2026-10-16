"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { Receipt } from "@/lib/receipts";
import { clock, fill, LOCALE, strings, type Strings } from "./i18n";
import { Icon, type IconName } from "./icons";
import type { AppState, Settings } from "./types";
import { Card } from "./ui";

const STOPPED: Receipt["outcome"][] = [
  "blocked by the risk engine",
  "reverted by the contract",
];

export const OUTCOME_ICON: Record<Receipt["outcome"], [IconName, string]> = {
  done: ["check", "bg-mint text-leaf"],
  "blocked by the risk engine": ["shield", "bg-coral-soft text-coral"],
  "reverted by the contract": ["shield", "bg-coral-soft text-coral"],
  "sent to the owner": ["clock", "bg-sun-soft text-sun-ink"],
  "waiting out the delay": ["clock", "bg-sun-soft text-sun-ink"],
  cancelled: ["x", "bg-cream text-muted"],
  "applied after the wait": ["check", "bg-mint text-leaf"],
  "decided not to act": ["x", "bg-cream text-muted"],
  failed: ["alert", "bg-sun-soft text-sun-ink"],
};

export const OUTCOME_TEXT: Record<Receipt["outcome"], string> = {
  done: "text-muted",
  "blocked by the risk engine": "text-coral",
  "reverted by the contract": "text-coral",
  "sent to the owner": "text-sun-ink",
  "waiting out the delay": "text-sun-ink",
  cancelled: "text-muted",
  "applied after the wait": "text-muted",
  "decided not to act": "text-muted",
  failed: "text-sun-ink",
};

/** Who acted, in the screen's language. The receipt carries an English label; this maps it back to its kind. */
export function actorText(actor: string, t: Strings): string {
  const kind = actor.startsWith("COMPROMISED")
    ? "compromised"
    : actor.includes("outside item")
      ? "item"
      : actor.includes("signed approval")
        ? "approved"
        : actor.includes("asked by the investor")
          ? "asked"
          : actor.includes("under the plan")
            ? "plan"
            : actor.startsWith("Keeper")
              ? "keeper"
              : actor === "Owner"
                ? "owner"
                : actor === "Guardian"
                  ? "guardian"
                  : "other";
  return fill(t.actors[kind], { agent: BRAND.agent });
}

const GATE_MARK = {
  pass: ["check", "bg-mint text-leaf"],
  escalate: ["clock", "bg-sun-soft text-sun-ink"],
  block: ["x", "bg-coral-soft text-coral"],
} as const;

// ---------------------------------------------------------------- receipt dialog

export function ReceiptDialog({
  receipt: r,
  settings,
  onClose,
}: {
  receipt: Receipt;
  settings: Settings;
  onClose: () => void;
}) {
  const t = strings(settings.language, settings.role);
  const [icon, tone] = OUTCOME_ICON[r.outcome];
  const gateLabel = (id: string, fallback: string) =>
    (t.gates as Record<string, string>)[id] ?? fallback;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const at = new Date(r.at);
  // the checks that did not pass come first; the passed ones fold away
  const flagged = r.gates.filter((g) => g.outcome !== "pass");
  const passed = r.gates.filter((g) => g.outcome === "pass");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.activity.receipt}
        className="slide-in max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-(--radius-card) bg-card p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">
            {t.activity.receipt} ·{" "}
            {at.toLocaleDateString(LOCALE[settings.language], {
              day: "numeric",
              month: "short",
            })}{" "}
            {clock(r.at)}
          </p>
          <button
            onClick={onClose}
            aria-label={t.activity.close}
            className="-mt-2 -mr-2 rounded-lg p-2 text-muted hover:bg-cream hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <h2
          className={`mt-2 font-serif leading-tight ${r.what.length > 70 ? "text-[1.35rem]" : "text-[1.8rem]"}`}
        >
          {r.what}
        </h2>
        <p
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tone}`}
        >
          <Icon name={icon} size={14} />
          {t.outcome[r.outcome]}
        </p>

        <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-muted">{t.activity.who}</dt>
            <dd
              className={`text-right font-semibold ${r.actor.startsWith("COMPROMISED") ? "text-coral" : ""}`}
            >
              {actorText(r.actor, t)}
            </dd>
          </div>
          {r.why ? (
            <div className="py-3">
              <dt className="text-muted">{t.activity.why}</dt>
              <dd className="mt-1">{r.why}</dd>
            </div>
          ) : null}
          {r.refusal ? (
            <div className="py-3">
              <dt className="text-coral">{t.activity.refused}</dt>
              <dd className="mt-1">{r.refusal}</dd>
            </div>
          ) : null}
        </dl>

        <p className="eyebrow mt-6">{t.activity.checks}</p>
        {r.gates.length ? (
          <>
            <ul className="mt-3 space-y-2.5">
              {flagged.map((g, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${GATE_MARK[g.outcome][1]}`}
                    title={t.activity[g.outcome]}
                  >
                    <Icon
                      name={GATE_MARK[g.outcome][0]}
                      size={12}
                      strokeWidth={3}
                    />
                  </span>
                  <span>
                    <span className="font-semibold">
                      {gateLabel(g.id, g.label)}
                    </span>
                    {g.detail ? (
                      <span className="block text-muted">{g.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {passed.length ? (
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-leaf">
                  <Icon
                    name="chevron"
                    size={15}
                    className="transition-transform group-open:rotate-180"
                  />
                  {fill(
                    flagged.length
                      ? t.activity.showPassed
                      : t.activity.allPassed,
                    { n: passed.length },
                  )}
                </summary>
                <ul className="mt-3 space-y-2.5">
                  {passed.map((g, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${GATE_MARK.pass[1]}`}
                      >
                        <Icon name="check" size={12} strokeWidth={3} />
                      </span>
                      <span>
                        <span className="font-semibold">
                          {gateLabel(g.id, g.label)}
                        </span>
                        {g.detail ? (
                          <span className="block text-muted">{g.detail}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {r.contract ? t.activity.noChecks : t.activity.noAttempt}
          </p>
        )}

        {r.contract ? (
          <div
            className={`mt-5 flex items-start gap-2.5 rounded-xl p-4 text-sm ${r.contract.verdict === "accepted" ? "bg-mint/70" : "bg-coral-soft"}`}
          >
            <Icon
              name={
                r.contract.verdict === "accepted" ? "shieldCheck" : "shield"
              }
              size={18}
              className={
                r.contract.verdict === "accepted" ? "text-leaf" : "text-coral"
              }
            />
            <span>
              <span className="font-semibold">
                {t.activity.contract}:{" "}
                {r.contract.verdict === "accepted"
                  ? t.activity.contractAccepted
                  : t.activity.contractReverted}
              </span>
              {r.contract.reason ? (
                <span className="block text-muted">{r.contract.reason}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="num text-xs text-faint">
            {fill(t.activity.ref, { ref: r.ref.slice(0, 10) })}
          </p>
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-soft"
            >
              {t.activity.viewTx}
              <Icon name="arrowUpRight" size={15} />
            </a>
          ) : null}
        </div>
        {t.activity.englishNote ? (
          <p className="mt-4 text-xs text-faint">{t.activity.englishNote}</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

const FILTERS: [
  key: "fAll" | "fDone" | "fYou" | "fStopped" | "fDeclined",
  test: (r: Receipt) => boolean,
][] = [
  ["fAll", () => true],
  ["fDone", (r) => r.outcome === "done"],
  [
    "fYou",
    (r) =>
      r.outcome === "sent to the owner" ||
      r.outcome === "waiting out the delay",
  ],
  ["fStopped", (r) => STOPPED.includes(r.outcome)],
  ["fDeclined", (r) => r.outcome === "decided not to act"],
];

function dayLabel(iso: string, settings: Settings, t: Strings) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t.activity.today;
  if (d.toDateString() === yesterday.toDateString())
    return t.activity.yesterday;
  return d.toLocaleDateString(LOCALE[settings.language], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function ActivityHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language, settings.role);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.activity.title}{" "}
        <span className="accent">{t.activity.titleAccent}</span>
      </h1>
      <p className="mt-1.5 text-[1.05rem] text-muted">{t.activity.sub}</p>
    </div>
  );
}

export function ActivityView({
  state,
  settings,
  onOpen,
}: {
  state: AppState;
  settings: Settings;
  onOpen: (r: Receipt) => void;
}) {
  const t = strings(settings.language, settings.role);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("fAll");
  const receipts = state.receipts;
  const shown = receipts.filter(
    FILTERS.find(([k]) => k === filter)?.[1] ?? (() => true),
  );
  const count = (o: Receipt["outcome"]) =>
    receipts.filter((r) => r.outcome === o).length;
  const stats: [string, number, string][] = [
    [t.activity.statDone, count("done"), "text-ink"],
    [t.activity.statBlocked, count("blocked by the risk engine"), "text-coral"],
    [t.activity.statReverted, count("reverted by the contract"), "text-coral"],
    [t.activity.statDeclined, count("decided not to act"), "text-ink"],
    [t.activity.statOnChain, receipts.filter((r) => r.url).length, "text-leaf"],
  ];

  // group by day, newest first, as they arrive
  const groups: { day: string; items: Receipt[] }[] = [];
  for (const r of shown) {
    const day = dayLabel(r.at, settings, t);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-y-5 p-6! sm:grid-cols-5">
        {stats.map(([label, n, tone], i) => (
          <div
            key={label}
            className={`px-4 ${i ? "sm:border-l sm:border-line" : ""}`}
          >
            <p
              className={`num font-display text-[2rem] leading-none font-semibold ${tone}`}
            >
              {n}
            </p>
            <p className="mt-2 text-sm text-muted">{label}</p>
          </div>
        ))}
      </Card>

      <Card className="p-7!">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">
              {t.activity.journal}
            </h3>
            <p className="text-sm text-faint">{t.activity.journalNote}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${filter === k ? "border-forest bg-forest text-white" : "border-line text-muted hover:border-sage hover:text-ink"}`}
              >
                {t.activity[k]}
              </button>
            ))}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="mt-6 text-[0.95rem] text-muted">{t.activity.empty}</p>
        ) : null}
        {groups.map((g) => (
          <section key={g.day} className="mt-6">
            <p className="eyebrow mb-1">{g.day}</p>
            <ul className="divide-y divide-line">
              {g.items.map((r) => {
                const [icon, tone] = OUTCOME_ICON[r.outcome];
                const attack = r.actor.startsWith("COMPROMISED");
                return (
                  <li key={r.ref + r.at}>
                    <button
                      onClick={() => onOpen(r)}
                      className="group flex w-full items-center gap-4 py-3.5 text-left"
                    >
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}
                      >
                        <Icon name={icon} size={16} strokeWidth={2.2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.95rem] font-semibold group-hover:text-leaf">
                          {r.what}
                        </span>
                        <span
                          className={`block truncate text-sm ${attack ? "text-coral" : "text-muted"}`}
                        >
                          {actorText(r.actor, t)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-xs text-faint">
                          {clock(r.at)}
                        </span>
                        <span
                          className={`mt-0.5 flex items-center justify-end gap-1 text-xs font-semibold ${OUTCOME_TEXT[r.outcome]}`}
                        >
                          {t.outcome[r.outcome]}
                          {r.url ? (
                            <Icon name="arrowUpRight" size={11} />
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Card>
    </div>
  );
}
