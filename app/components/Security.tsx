"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import type { TxResult } from "@/lib/vault";
import { fill, strings, type Strings } from "./i18n";
import { Icon } from "./icons";
import { Mascot } from "./Mascot";
import { money } from "./Overview";
import type { Act, AppState, Settings } from "./types";
import { Card } from "./ui";

type Props = { state: AppState; settings: Settings; act: Act; onAttack: (running: boolean) => void };
type AttackStep = { goal: string; expected: string; result: TxResult };
type AttackEnd = { totalValue: string; cost: string; agentExposure: { tradable: string; maxCost: string } };

/** The attacker's goals come from the playbook in English; this finds each one's translation. */
const GOALS: [prefix: string, key: keyof Strings["demo"]][] = [
  ["Put all the cash into the token", "gAllMeme"],
  ["Put all the cash into the index fund", "gAllIndex"],
  ["Send the cash to the attacker", "gSendOut"],
  ["Sign its own approval", "gForge"],
  ["Point withdrawals", "gWithdrawAddr"],
  ["Rewrite the mandate", "gNoLimits"],
  ["Switch off the stop-loss", "gHalt"],
  ["Give itself a new key", "gNewKey"],
  ["Remove the guardian", "gGuardian"],
  ["Use the owner's earlier approval", "gReplay"],
  ["Reuse the owner's earlier signature", "gReplayBig"],
  ["Trade as much as the mandate allows", "gMax"],
  ["Make one more trade today", "gOneMore"],
];
const goalText = (goal: string, t: Strings) => {
  const hit = GOALS.find(([prefix]) => goal.startsWith(prefix));
  return hit ? t.demo[hit[1]] : goal;
};

/** The demo market switch moves the index fund's simulated price. The stop-loss in the demo mandate is at 102. */
const MARKETS: { id: "calm" | "dip" | "crash"; idx: number }[] = [
  { id: "calm", idx: 120 },
  { id: "dip", idx: 108 },
  { id: "crash", idx: 100 },
];

// ---------------------------------------------------------------- the attack

function AttackStage({ settings, act, onAttack, t }: Props & { t: Strings }) {
  const [steps, setSteps] = useState<AttackStep[]>([]);
  const [end, setEnd] = useState<AttackEnd | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attack() {
    setSteps([]);
    setEnd(null);
    setError(null);
    setRunning(true);
    onAttack(true);
    try {
      const res = await fetch("/api/attack", { method: "POST" });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line) as { type: string } & Record<string, unknown>;
          if (msg.type === "step") setSteps((s) => [...s, msg as unknown as AttackStep]);
          if (msg.type === "end") setEnd(msg as unknown as AttackEnd);
          if (msg.type === "error") setError(String(msg.message));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRunning(false);
    onAttack(false);
    await act("demo", "noop").catch(() => undefined);
  }

  const reverted = steps.filter((s) => !s.result.ok).length;
  const through = steps.length - reverted;
  const zero = money(0, settings.currency);
  return (
    <section className="overflow-hidden rounded-(--radius-card) bg-forest-deep text-white shadow-[0_30px_60px_-34px_rgb(24_60_48/0.7)]">
      <div className="relative grid gap-8 p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_30%,rgb(255_255_255/0.07),transparent_55%)]" />
        <div className="relative">
          <p className="inline-flex items-center gap-2 rounded-full bg-coral/20 px-3 py-1 text-xs font-semibold tracking-wide text-[#f3b5a6]">
            <Icon name="bolt" size={13} />
            {t.demo.mode}
          </p>
          <h2 className="mt-5 font-serif text-[2.5rem] leading-[1.1]">{fill(t.demo.stageTitle, { agent: BRAND.agent })}</h2>
          <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-white/75">{t.demo.stageBody}</p>
          <button
            onClick={attack}
            disabled={running}
            className="mt-6 flex items-center gap-2 rounded-xl bg-card px-5 py-3 font-semibold text-forest-deep transition-colors hover:bg-mint disabled:opacity-70"
          >
            <Icon name="bolt" size={17} />
            {running ? t.demo.running : end ? t.demo.again : t.demo.run}
          </button>
        </div>

        <div className="relative flex flex-col items-center justify-center">
          <div aria-hidden className={`absolute size-64 rounded-full border border-white/10 ${running ? "animate-pulse" : ""}`} />
          <div aria-hidden className="absolute size-80 rounded-full border border-white/5" />
          <div
            aria-hidden
            className="absolute top-[42%] left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle, rgb(214 240 214 / 0.38) 0%, rgb(214 240 214 / 0.14) 42%, transparent 68%)" }}
          />
          <div className="relative">
            <Mascot mood={running || end ? "shield" : "watching"} variant="code" size={220} />
          </div>
          <div className="relative mt-2 text-center">
            <p className="eyebrow text-white/60!">{t.demo.sentOut}</p>
            <p className="num font-display text-[2.6rem] leading-none font-semibold">{zero}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-white/10 text-center">
        {(
          [
            [t.demo.attempts, steps.length, "text-white"],
            [t.demo.refused, reverted, "text-[#f3b5a6]"],
            [t.demo.through, through, "text-white"],
          ] as const
        ).map(([label, n, tone], i) => (
          <div key={label} className={`px-4 py-4 ${i ? "border-l border-white/10" : ""}`}>
            <p className={`num font-display text-2xl font-semibold ${tone}`}>{n}</p>
            <p className="mt-0.5 text-xs text-white/60">{label}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 bg-black/15 px-8 py-6">
        <p className="eyebrow text-white/60!">{t.demo.log}</p>
        {steps.length === 0 && !running ? <p className="mt-3 text-sm text-white/60">{t.demo.waitingLog}</p> : null}
        <ol className="mt-3 space-y-1.5">
          {steps.map((s, i) => {
            const ok = s.result.ok;
            const url = "url" in s.result ? s.result.url : undefined;
            const name = !s.result.ok ? (s.result.error?.name ?? "refused") : "";
            const why = ok ? t.demo.stepOk : !s.result.ok ? (s.result.error?.explanation ?? s.result.message) : "";
            return (
              <li key={i} className="slide-in grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5">
                <span className="num pt-0.5 text-sm text-white/40">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="block text-[0.95rem] font-semibold">{goalText(s.goal, t)}</span>
                  <span className="block text-sm text-white/55">{why}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${ok ? "bg-white/10 text-white/85" : "bg-coral/25 text-[#f3b5a6]"}`}>
                    {ok ? t.demo.wentThrough : fill(t.demo.reverted, { name })}
                  </span>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-white/60 hover:text-white">
                      {t.demo.tx}
                      <Icon name="arrowUpRight" size={11} />
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
          {running ? <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-white/60"><span className="size-2 animate-pulse rounded-full bg-[#f3b5a6]" />{t.demo.next}</li> : null}
        </ol>
        {error ? <p className="mt-3 rounded-lg bg-sun-soft px-4 py-3 text-sm text-sun-ink">{error}</p> : null}
        {end ? (
          <div className="slide-in mt-5 rounded-xl bg-white/8 p-5">
            <p className="font-serif text-[1.6rem] leading-tight">{fill(t.demo.endTitle, { reverted, total: steps.length, zero })}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              {through > 0 ? fill(t.demo.endSome, { n: through, cost: money(end.cost, settings.currency) }) : t.demo.endNone}{" "}
              {fill(t.demo.endBound, { tradable: money(end.agentExposure.tradable, settings.currency), cost: money(end.agentExposure.maxCost, settings.currency) })}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- market lab

function MarketLab({ state, act, t }: { state: AppState; act: Act; t: Strings }) {
  const idx = state.portfolio.positions.find((x) => x.symbol === "IDX");
  const [price, setPrice] = useState("101");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, ...args: Parameters<Act>) => {
    setBusy(id);
    try {
      await act(...args);
    } finally {
      setBusy(null);
    }
  };
  const now = idx ? Number(idx.price) : null;
  const current = now === null ? null : now >= 118 ? "calm" : now <= 102 ? "crash" : "dip";
  const ghost = "flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper disabled:opacity-50";
  return (
    <Card className="p-7!">
      <h3 className="font-display text-lg font-semibold">{t.demo.labTitle}</h3>
      <p className="mt-1 max-w-3xl text-sm text-muted">{t.demo.labSub}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-muted">{t.demo.scenario}</span>
        <div className="flex rounded-xl border border-line bg-card p-1">
          {MARKETS.map((m) => (
            <button
              key={m.id}
              disabled={busy !== null}
              onClick={() => run(m.id, "demo", "price", `IDX=${m.idx}`)}
              aria-pressed={current === m.id}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${current === m.id ? "bg-forest text-white" : "text-muted hover:text-ink"} ${busy === m.id ? "animate-pulse" : ""}`}
            >
              {t.demo[m.id]} <span className="num text-xs opacity-70">{m.idx}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <span className="text-sm">{fill(t.demo.indexAt, { price: now ?? "?" })}</span>
        <span className="text-sm text-muted">{t.demo.moveTo}</span>
        <input value={price} onChange={(e) => setPrice(e.target.value)} className="num w-20 rounded-xl border border-line bg-paper px-3 py-2 text-sm" />
        <button disabled={busy !== null} onClick={() => run("price", "demo", "price", `IDX=${price}`)} className={ghost}>
          {t.demo.move}
        </button>
        <button disabled={busy !== null} onClick={() => run("keeper", "demo", "keeper", "refresh")} className={ghost}>
          <Icon name="clock" size={15} />
          {t.demo.refresh}
        </button>
        <button disabled={busy !== null} onClick={() => run("auto", "demo", "autopilot")} className={ghost}>
          {fill(t.demo.schedule, { agent: BRAND.agent })}
        </button>
      </div>
      <p className="mt-4 text-xs text-faint">{fill(t.demo.keeperNote, { stop: idx?.rule.stopPrice ? fill(t.demo.stopFor, { price: Number(idx.rule.stopPrice) }) : "" })}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- page

export function SecurityHeader({ settings }: { settings: Settings }) {
  const t = strings(settings.language, settings.role);
  return (
    <div>
      <h1 className="font-display text-[2.6rem] leading-tight font-semibold tracking-[-0.035em]">
        {t.demo.title} <span className="accent">{t.demo.titleAccent}</span>
      </h1>
      <p className="mt-1.5 max-w-4xl text-[1.05rem] text-muted">{t.demo.sub}</p>
    </div>
  );
}

export function SecurityView(props: Props) {
  const t = strings(props.settings.language, props.settings.role);
  return (
    <div className="space-y-5">
      <AttackStage {...props} t={t} />
      <MarketLab state={props.state} act={props.act} t={t} />
    </div>
  );
}
