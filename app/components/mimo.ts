import type { Receipt } from "@/lib/receipts";
import type { AppState, Mood, Role, ShieldVariant } from "./types";

/**
 * Which state the mascot is in, and what it says, worked out from what the
 * vault and the receipts show. Alerts end on real events only: the condition
 * clears (a waiting change is applied or cancelled, protect mode lifts) or
 * the person presses "Got it". Never on a timer.
 */
export type MimoSay = {
  mood: Mood;
  variant: ShieldVariant;
  /** One short line for the speech bubble. */
  line: string;
  /** Two or three words for the status dot next to the name. */
  status: string;
  /** Set when "Got it" should be offered. Pressing it adds this key to the dismissed set. */
  dismissKey: string | null;
  /** Receipts this alert is about; "Got it" marks them as seen. */
  receiptRefs: string[];
};

/** Words that suggest the investor is stressed, in English, Bangla and Chinese. A cue for the mascot only, never for a decision. */
const STRESS = /scared|afraid|worried|worry|panic|anxious|stress|nervous|upset|terrified|lost (so much|money|everything)|losing money|help me|ভয়|চিন্তা|টেনশন|দুশ্চিন্তা|害怕|担心|焦虑|紧张|亏/i;

export function soundsStressed(message: string): boolean {
  return STRESS.test(message);
}

export type MimoInputs = {
  state: AppState;
  role: Role;
  /** The scripted attack is running on the security demo screen. */
  attacking: boolean;
  /** The agent is answering in the chat, or an action is on its way to the chain. */
  thinking: boolean;
  /** Receipts already acknowledged, or already there when the page opened. */
  seen: ReadonlySet<string>;
  /** Alerts the person has acknowledged with "Got it". */
  dismissed: ReadonlySet<string>;
  /** When the investor's latest chat message sounded stressed, an id for that message; null otherwise. */
  stressedAt?: number | null;
};

/** From the handoff: shield, then warning, holding, worried, thinking, watching, calm. */
export const PRIORITY: Record<Mood, number> = { calm: 0, watching: 1, thinking: 2, worried: 3, holding: 4, warning: 5, shield: 6 };

const STOPPED: Receipt["outcome"][] = ["reverted by the contract", "blocked by the risk engine"];

/** What hit the shield, for the three versions of the shield animation. */
export function variantOf(r: Receipt): ShieldVariant {
  if (r.actor.startsWith("COMPROMISED")) return "code";
  if (r.outcome === "blocked by the risk engine" || r.declined || r.actor.includes("outside item")) return "chat";
  return "card";
}

/** How many changes that raise the risk are waiting. The guardian is alerted to each. */
export function waitingCount(state: AppState): number {
  const p = state.portfolio;
  const pending = p.pending;
  return (
    [pending.mandate, pending.withdrawalAddress, pending.agentKey, pending.guardian, pending.waitingPeriod, pending.unpause, p.stopLoss.haltRequestAppliesFrom].filter(Boolean).length +
    p.positions.filter((x) => x.pendingRule).length
  );
}

/** A key that changes whenever the set of waiting changes changes, so a new request alerts again. */
function waitingKey(state: AppState): string {
  const p = state.portfolio;
  return [
    p.pending.mandate?.appliesFrom,
    p.pending.withdrawalAddress?.appliesFrom,
    p.pending.agentKey?.appliesFrom,
    p.pending.guardian?.appliesFrom,
    p.pending.waitingPeriod?.appliesFrom,
    p.pending.unpause?.appliesFrom,
    p.stopLoss.haltRequestAppliesFrom,
    ...p.positions.map((x) => x.pendingRule?.appliesFrom),
  ].join("|");
}

export function mimoOf({ state, role, attacking, thinking, seen, dismissed, stressedAt = null }: MimoInputs): MimoSay {
  const p = state.portfolio;
  const options: MimoSay[] = [];
  const add = (mood: Mood, line: string, status: string, dismissKey: string | null = null, extra: Partial<MimoSay> = {}) =>
    options.push({ mood, line, status, dismissKey, variant: "card", receiptRefs: [], ...extra });

  if (attacking) add("shield", "Under attack. The contract is refusing every move outside your rules.", "Shield up", null, { variant: "code" });
  // a block or revert, or the agent saying no to something the investor asked for in the chat
  const refused = (r: Receipt) => STOPPED.includes(r.outcome) || (r.declined && r.actor.startsWith("Agent, asked"));
  const fresh = state.receipts.filter((r) => refused(r) && !seen.has(r.ref + r.at));
  if (fresh.length) {
    const r = fresh[0];
    const line =
      r.outcome === "reverted by the contract"
        ? fresh.length > 1
          ? `${fresh.length} moves blocked. The contract refused them.`
          : "Blocked. The contract refused that move."
        : r.declined
          ? "I said no to that one. It would break your rules."
          : "I stopped that before it was signed. Here is why in Activity.";
    add("shield", line, "Shield up", "receipts", { variant: variantOf(r), receiptRefs: fresh.map((x) => x.ref + x.at) });
  }

  const stale = p.positions.some((x) => x.priceIsStale && (x.rule.allowed || Number(x.amount) > 0));
  if (p.protect.active) add("warning", "Buying is paused after a loss. Selling still works.", "Protect mode", `protect:${p.protect.cooldownUntil ?? "day"}`);
  if (stale) add("warning", "The price feed is out of date, so trades wait for fresh prices.", "Risk signal", "stale");
  if (p.stopLoss.haltedUntil) add("warning", "Your guardian has halted the stop-loss for now.", "Risk signal", `halt:${p.stopLoss.haltedUntil}`);

  const waiting = waitingCount(state);
  if (waiting && role === "guardian") {
    add("warning", `The owner asked to raise the risk (${waiting}). Nothing has changed. You can cancel it.`, "Needs you", `guardian:${waitingKey(state)}`);
  } else if (waiting) {
    add("holding", "Riskier rules wait their turn. Nothing changes until the wait is over.", "Holding the line", `waiting:${waitingKey(state)}`);
  }

  const worryAt = Math.max(1, p.mandate.dailyLossPct / 4);
  if (p.today.lossPct >= worryAt) add("worried", `Down ${p.today.lossPct}% today. Your limits are holding.`, "Rough day", `down:${Math.floor(p.today.lossPct)}`);

  if (stressedAt !== null) add("worried", "That sounds stressful. Take a breath, your rules are still holding.", "Here for you", `stressed:${stressedAt}`);

  if (thinking) add("thinking", "Let me check that against your mandate.", "Thinking");
  if (p.agent.paused) add("watching", "I'm paused. I won't trade until the pause is lifted.", "Paused");
  else if (p.today.lossPct >= 0.3) add("watching", "Prices are moving. I'm watching.", "Watching");

  add("calm", p.mandateSigned ? "All calm. Your limits are holding." : "Tell me your goal and I'll draft a mandate.", "All good");

  const open = options.filter((o) => !o.dismissKey || o.dismissKey === "receipts" || !dismissed.has(o.dismissKey));
  open.sort((a, b) => PRIORITY[b.mood] - PRIORITY[a.mood]);
  return open[0];
}
