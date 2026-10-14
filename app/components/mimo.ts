import type { Language } from "@/lib/plan";
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
  /** The language of the line and status. English when not given. */
  language?: Language;
};

type N = { n?: number | string };
/** What the mascot says, in each language. Chinese falls back to English where it has no line. */
export const SAY: Record<string, Partial<Record<Language, (v: N) => [line: string, status: string]>>> = {
  attack: {
    en: () => ["Under attack. The contract is refusing every move outside your rules.", "Shield up"],
    bn: () => ["আক্রমণ চলছে। আপনার নিয়মের বাইরের প্রতিটি পদক্ষেপ চুক্তি ফিরিয়ে দিচ্ছে।", "ঢাল তোলা"],
    zh: () => ["正在遭受攻击。合约正在拒绝所有超出你规则的操作。", "防护中"],
  },
  revertedMany: {
    en: ({ n }) => [`${n} moves blocked. The contract refused them.`, "Shield up"],
    bn: ({ n }) => [`${n}টি পদক্ষেপ আটকানো হয়েছে। চুক্তি সেগুলো ফিরিয়ে দিয়েছে।`, "ঢাল তোলা"],
    zh: ({ n }) => [`已拦截 ${n} 个操作，合约拒绝了它们。`, "防护中"],
  },
  reverted: {
    en: () => ["Blocked. The contract refused that move.", "Shield up"],
    bn: () => ["আটকানো হয়েছে। চুক্তি পদক্ষেপটি ফিরিয়ে দিয়েছে।", "ঢাল তোলা"],
    zh: () => ["已拦截，合约拒绝了这个操作。", "防护中"],
  },
  declined: {
    en: () => ["I said no to that one. It would break your rules.", "Shield up"],
    bn: () => ["ওটাতে আমি না বলেছি। এতে আপনার নিয়ম ভাঙত।", "ঢাল তোলা"],
    zh: () => ["这个我拒绝了，它会违反你的规则。", "防护中"],
  },
  blocked: {
    en: () => ["I stopped that before it was signed. Here is why in Activity.", "Shield up"],
    bn: () => ["সই হওয়ার আগেই আমি ওটা থামিয়েছি। কারণটা কার্যকলাপে আছে।", "ঢাল তোলা"],
    zh: () => ["签名之前我就拦下了，原因见操作记录。", "防护中"],
  },
  protect: {
    en: () => ["Buying is paused after a loss. Selling still works.", "Protect mode"],
    bn: () => ["ক্ষতির পর কেনা বন্ধ আছে। বিক্রি এখনো চলে।", "সুরক্ষা মোড"],
    zh: () => ["亏损后已暂停买入，卖出仍然可以。", "保护模式"],
  },
  stale: {
    en: () => ["The price feed is out of date, so trades wait for fresh prices.", "Risk signal"],
    bn: () => ["দামের তথ্য পুরোনো, তাই নতুন দাম না আসা পর্যন্ত ট্রেড অপেক্ষায়।", "ঝুঁকির সংকেত"],
    zh: () => ["价格数据已过期，交易将等待最新价格。", "风险信号"],
  },
  halt: {
    en: () => ["Your guardian has halted the stop-loss for now.", "Risk signal"],
    bn: () => ["আপনার অভিভাবক আপাতত স্টপ-লস স্থগিত করেছেন।", "ঝুঁকির সংকেত"],
    zh: () => ["你的监护人暂时停用了止损。", "风险信号"],
  },
  guardianWaiting: {
    en: ({ n }) => [`The owner asked to raise the risk (${n}). Nothing has changed. You can cancel it.`, "Needs you"],
    bn: ({ n }) => [`মালিক ঝুঁকি বাড়াতে চেয়েছেন (${n})। কিছুই বদলায়নি। আপনি বাতিল করতে পারেন।`, "আপনাকে দরকার"],
    zh: ({ n }) => [`所有者申请提高风险（${n} 项），尚未生效，你可以取消。`, "需要你处理"],
  },
  holding: {
    en: () => ["Riskier rules wait their turn. Nothing changes until the wait is over.", "Holding the line"],
    bn: () => ["ঝুঁকির নিয়ম অপেক্ষায় থাকে। অপেক্ষা শেষ না হওয়া পর্যন্ত কিছুই বদলায় না।", "সীমা ধরে আছি"],
    zh: () => ["更高风险的规则需要等待，等待结束前不会改变。", "坚守底线"],
  },
  down: {
    en: ({ n }) => [`Down ${n}% today. Your limits are holding.`, "Rough day"],
    bn: ({ n }) => [`আজ ${n}% কমেছে। আপনার সীমা অটুট আছে।`, "কঠিন দিন"],
    zh: ({ n }) => [`今日下跌 ${n}%，你的限额依然有效。`, "艰难的一天"],
  },
  stressed: {
    en: () => ["That sounds stressful. Take a breath, your rules are still holding.", "Here for you"],
    bn: () => ["শুনে চাপের মনে হচ্ছে। একটু শ্বাস নিন, আপনার নিয়ম এখনো অটুট।", "পাশে আছি"],
    zh: () => ["听起来压力很大。深呼吸，你的规则依然有效。", "陪着你"],
  },
  thinking: {
    en: () => ["Let me check that against your mandate.", "Thinking"],
    bn: () => ["আপনার ম্যান্ডেটের সাথে মিলিয়ে দেখি।", "ভাবছি"],
    zh: () => ["我来对照你的投资授权检查一下。", "思考中"],
  },
  paused: {
    en: () => ["I'm paused. I won't trade until the pause is lifted.", "Paused"],
    bn: () => ["আমি থেমে আছি। বিরতি না ওঠা পর্যন্ত ট্রেড করব না।", "থেমে আছি"],
    zh: () => ["我已暂停，解除暂停前不会交易。", "已暂停"],
  },
  moving: {
    en: () => ["Prices are moving. I'm watching.", "Watching"],
    bn: () => ["দাম ওঠানামা করছে। আমি নজর রাখছি।", "নজর রাখছি"],
    zh: () => ["价格在波动，我在关注。", "关注中"],
  },
  calm: {
    en: () => ["All calm. Your limits are holding.", "All good"],
    bn: () => ["সব শান্ত। আপনার সীমা অটুট আছে।", "সব ঠিক আছে"],
    zh: () => ["一切平稳，你的限额正常生效。", "一切正常"],
  },
  noMandate: {
    en: () => ["Tell me your goal and I'll draft a mandate.", "All good"],
    bn: () => ["আপনার লক্ষ্যটা বলুন, আমি একটি ম্যান্ডেটের খসড়া বানাব।", "সব ঠিক আছে"],
    zh: () => ["告诉我你的目标，我来起草投资授权。", "一切正常"],
  },
};

function say(id: keyof typeof SAY, language: Language, v: N = {}): [string, string] {
  const entry = SAY[id];
  return (entry[language] ?? entry.en!)(v);
}

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

export function mimoOf({ state, role, attacking, thinking, seen, dismissed, stressedAt = null, language = "en" }: MimoInputs): MimoSay {
  const p = state.portfolio;
  const options: MimoSay[] = [];
  const add = (mood: Mood, [line, status]: [string, string], dismissKey: string | null = null, extra: Partial<MimoSay> = {}) =>
    options.push({ mood, line, status, dismissKey, variant: "card", receiptRefs: [], ...extra });

  if (attacking) add("shield", say("attack", language), null, { variant: "code" });
  // a block or revert, or the agent saying no to something the investor asked for in the chat
  const refused = (r: Receipt) => STOPPED.includes(r.outcome) || (r.declined && r.actor.startsWith("Agent, asked"));
  const fresh = state.receipts.filter((r) => refused(r) && !seen.has(r.ref + r.at));
  if (fresh.length) {
    const r = fresh[0];
    const said =
      r.outcome === "reverted by the contract"
        ? fresh.length > 1
          ? say("revertedMany", language, { n: fresh.length })
          : say("reverted", language)
        : r.declined
          ? say("declined", language)
          : say("blocked", language);
    add("shield", said, "receipts", { variant: variantOf(r), receiptRefs: fresh.map((x) => x.ref + x.at) });
  }

  const stale = p.positions.some((x) => x.priceIsStale && (x.rule.allowed || Number(x.amount) > 0));
  if (p.protect.active) add("warning", say("protect", language), `protect:${p.protect.cooldownUntil ?? "day"}`);
  if (stale) add("warning", say("stale", language), "stale");
  if (p.stopLoss.haltedUntil) add("warning", say("halt", language), `halt:${p.stopLoss.haltedUntil}`);

  const waiting = waitingCount(state);
  if (waiting && role === "guardian") {
    add("warning", say("guardianWaiting", language, { n: waiting }), `guardian:${waitingKey(state)}`);
  } else if (waiting) {
    add("holding", say("holding", language), `waiting:${waitingKey(state)}`);
  }

  const worryAt = Math.max(1, p.mandate.dailyLossPct / 4);
  if (p.today.lossPct >= worryAt) add("worried", say("down", language, { n: p.today.lossPct }), `down:${Math.floor(p.today.lossPct)}`);

  if (stressedAt !== null) add("worried", say("stressed", language), `stressed:${stressedAt}`);

  if (thinking) add("thinking", say("thinking", language));
  if (p.agent.paused) add("watching", say("paused", language));
  else if (p.today.lossPct >= 0.3) add("watching", say("moving", language));

  add("calm", say(p.mandateSigned ? "calm" : "noMandate", language));

  const open = options.filter((o) => !o.dismissKey || o.dismissKey === "receipts" || !dismissed.has(o.dismissKey));
  open.sort((a, b) => PRIORITY[b.mood] - PRIORITY[a.mood]);
  return open[0];
}
