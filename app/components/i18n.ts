import type { Language } from "@/lib/plan";
import type { Receipt } from "@/lib/receipts";
import type { Mood } from "./types";

/**
 * Screen text in English, Bangla and Chinese. English and Bangla are complete;
 * Chinese covers the key labels and receipts (team decision, Oct 13), and any
 * line it leaves out falls back to English. Screens are moved in here one at
 * a time as they are redone. Bangla is reviewed by Fariha, Chinese by a
 * Chinese-reading teammate.
 *
 * `{agent}`, `{name}` and other braces are filled in by `fill`.
 */
const en = {
  nav: {
    overview: "Overview",
    holdings: "Portfolio",
    mandate: "Mandate",
    approvals: "Approvals",
    activity: "Activity",
    testIt: "See it hold",
    proof: "Proof",
    demo: "Security demo",
  },
  shell: {
    inCharge: "You stay in charge",
    circle: "Your safety circle",
    circleOwner: "Viewing as owner",
    circleGuardian: "Viewing as guardian",
    switchTo: "Switch view",
    manifesto1: "A little autonomy.",
    manifesto2: "A lot of peace of mind.",
    manifestoNote: "Built to earn your trust.",
    pause: "Pause the AI",
    unpause: "Unpause the AI",
    liftPause: "Lift the pause",
    askUnpause: "Ask to unpause (waits)",
    unpauseWaiting: "Paused by guardian, unpause waiting",
    owner: "Owner",
    guardian: "Guardian",
    testnet: "Testnet",
    synced: "Read from the chain {ago}",
    justNow: "just now",
    secondsAgo: "{s} s ago",
    loading: "Reading the vault…",
    loadFailed: "Could not read the vault",
    refreshFailed: "Could not refresh: {error}",
    stale: "The price feed is out of date, so the vault will refuse trades until it is refreshed. Use \"Refresh prices\" in the security demo.",
    staleShort: "Prices out of date",
    guardianNote: "Guardian view. You can pause the AI, cancel a change that is waiting and halt the stop-loss in an emergency. You cannot move money, sign for trades or change the mandate.",
    guardianAlert: "Alert: the owner has asked for {n} change(s) that would raise the risk.",
    guardianAlertMore: "Nothing has taken effect yet. Open the queue to see the countdown and cancel if it looks like a decision made in a bad moment.",
    noKey: "The AI has no key right now, so it cannot trade. A new key waits out the delay like any other rise in risk.",
    talk: "Talk to {agent}",
    hereForYou: "I'm here for you",
  },
  overview: {
    morning: "Good morning, {name}",
    afternoon: "Good afternoon, {name}",
    evening: "Good evening, {name}",
    title: "Your money.",
    titleAccent: "Safely minded.",
    subtitle: "You signed the mandate. {agent} works inside it.",
    mandateButton: "Your mandate",
    value: "Portfolio value",
    testAssets: "Simulated test assets (testnet)",
    today: "today",
    chartTitle: "As read from the vault",
    chartEmpty: "The chart fills in as the app reads the vault.",
    now: "Now",
    cash: "Cash",
    onWatch: "{agent} · {status}",
    talk: "Talk to {agent}",
    gotIt: "Got it",
    cardFoot1: "Bounded agent key",
    cardFoot2: "Owner stays in control",
    boundaries: "Your safety boundaries",
    viewMandate: "View mandate",
    hacked: "If the AI were hacked today",
    hackedLead: "The most its trades could cost you.",
    sendOutShort: "could leave the vault.",
    sendOut: "Could send out of the vault",
    tradeLeft: "Could still trade today",
    lossLimit: "Daily loss limit",
    downToday: "Down today, from the day-start value",
    beforeProtect: "{n}% left before protect mode",
    protectOn: "Protect mode is on",
    perTrade: "max per trade",
    approvedAssets: "approved assets",
    toLoosen: "to loosen a rule (demo)",
    minutes: "{n} min",
    seconds: "{n} s",
    atLimit: "At the limit, {agent} stops buying. Selling into cash stays open. Market prices can still fall.",
    notMarket: "A limit on the AI, not on the market: prices can still fall.",
    recent: "Small moves. Clear reasons.",
    allActivity: "All activity",
    nothingYet: "Nothing yet. Every move {agent} makes, or is stopped from making, shows up here.",
    trust: "Trust the boundaries.",
    verify: "Verify the decisions.",
    onChain: "Mandate on-chain",
    keyUntil: "Agent key valid to {date}",
    noKeyShort: "No agent key",
    inspect: "Inspect the proof",
    noMandate: "No mandate yet",
    noMandateBody: "Tell {agent} your goal in your own words. It will draft a mandate for you to read and sign. Until you sign, it cannot trade.",
    signableFrom: "This is not your first vault, so its mandate can be signed from {time}. Opening a new vault is not a way around the waiting period.",
  },
  outcome: {
    done: "Done",
    "blocked by the risk engine": "Blocked",
    "reverted by the contract": "Refused by the contract",
    "sent to the owner": "Sent to you",
    "waiting out the delay": "Waiting",
    "decided not to act": "Not done",
    failed: "Failed",
  } satisfies Record<Receipt["outcome"], string>,
  mood: {
    chip: {
      calm: "Within your mandate",
      thinking: "Checking",
      watching: "Watching",
      worried: "Limits holding",
      warning: "Needs a look",
      shield: "Stopped at the boundary",
      holding: "Change waiting",
    },
    headline: {
      calm: "A steady hand.\nA watchful friend.",
      thinking: "Checking it against\nyour mandate.",
      watching: "Eyes open.\nHands still.",
      worried: "A rough day.\nYour rules hold.",
      warning: "Something needs\na closer look.",
      shield: "Stopped at\nthe boundary.",
      holding: "Riskier rules\nwait their turn.",
    },
  } satisfies { chip: Record<Mood, string>; headline: Record<Mood, string> },
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Strings = Shape<typeof en>;
type Partial2<T> = { [K in keyof T]?: T[K] extends string ? string : Partial2<T[K]> };

const bn: Strings = {
  nav: {
    overview: "এক নজরে",
    holdings: "পোর্টফোলিও",
    mandate: "ম্যান্ডেট",
    approvals: "অনুমোদন",
    activity: "কার্যকলাপ",
    testIt: "যাচাই করে দেখুন",
    proof: "প্রমাণ",
    demo: "নিরাপত্তা ডেমো",
  },
  shell: {
    inCharge: "নিয়ন্ত্রণ মানুষের হাতে",
    circle: "আপনার নিরাপত্তা বলয়",
    circleOwner: "মালিক হিসেবে দেখছেন",
    circleGuardian: "অভিভাবক হিসেবে দেখছেন",
    switchTo: "ভিউ বদলান",
    manifesto1: "একটু স্বাধীনতা।",
    manifesto2: "অনেকখানি নিশ্চিন্ত।",
    manifestoNote: "আপনার আস্থা অর্জনের জন্য তৈরি।",
    pause: "AI থামান",
    unpause: "AI আবার চালু করুন",
    liftPause: "বিরতি তুলে নিন",
    askUnpause: "চালুর অনুরোধ (অপেক্ষা লাগবে)",
    unpauseWaiting: "অভিভাবক থামিয়েছেন, চালুর অপেক্ষায়",
    owner: "মালিক",
    guardian: "অভিভাবক",
    testnet: "টেস্টনেট",
    synced: "চেইন থেকে পড়া হয়েছে {ago}",
    justNow: "এইমাত্র",
    secondsAgo: "{s} সেকেন্ড আগে",
    loading: "ভল্ট পড়া হচ্ছে…",
    loadFailed: "ভল্ট পড়া যায়নি",
    refreshFailed: "হালনাগাদ করা যায়নি: {error}",
    staleShort: "দাম পুরোনো",
    stale: "দামের তথ্য পুরোনো হয়ে গেছে, তাই হালনাগাদ না হওয়া পর্যন্ত ভল্ট কোনো ট্রেড নেবে না। নিরাপত্তা ডেমো থেকে \"দাম হালনাগাদ\" চাপুন।",
    guardianNote: "অভিভাবকের ভিউ। আপনি AI থামাতে পারেন, অপেক্ষায় থাকা কোনো পরিবর্তন বাতিল করতে পারেন, আর জরুরি অবস্থায় স্টপ-লস স্থগিত করতে পারেন। টাকা সরানো, ট্রেডে সই করা বা ম্যান্ডেট বদলানো আপনার পক্ষে সম্ভব নয়।",
    guardianAlert: "সতর্কতা: মালিক ঝুঁকি বাড়ানোর {n}টি পরিবর্তন চেয়েছেন।",
    guardianAlertMore: "এখনো কিছুই কার্যকর হয়নি। কাউন্টডাউন দেখতে তালিকাটি খুলুন, আর খারাপ মুহূর্তের সিদ্ধান্ত মনে হলে বাতিল করুন।",
    noKey: "AI-এর এখন কোনো কী নেই, তাই সে ট্রেড করতে পারবে না। নতুন কী পেতে হলে ঝুঁকি বাড়ানোর অন্য যেকোনো পরিবর্তনের মতোই অপেক্ষা করতে হবে।",
    talk: "{agent}-এর সাথে কথা বলুন",
    hereForYou: "আমি আছি আপনার পাশে",
  },
  overview: {
    morning: "শুভ সকাল, {name}",
    afternoon: "শুভ অপরাহ্ন, {name}",
    evening: "শুভ সন্ধ্যা, {name}",
    title: "আপনার টাকা,",
    titleAccent: "নিশ্চিন্ত মনে।",
    subtitle: "ম্যান্ডেটে সই করেছেন আপনি। {agent} কাজ করে তার ভেতরেই।",
    mandateButton: "আপনার ম্যান্ডেট",
    value: "পোর্টফোলিওর মূল্য",
    testAssets: "সিমুলেটেড টেস্ট সম্পদ (টেস্টনেট)",
    today: "আজ",
    chartTitle: "ভল্ট থেকে যেমন পড়া হয়েছে",
    chartEmpty: "অ্যাপ ভল্ট পড়তে থাকলে চার্টটি ভরে উঠবে।",
    now: "এখন",
    cash: "নগদ",
    onWatch: "{agent} · {status}",
    talk: "{agent}-এর সাথে কথা বলুন",
    gotIt: "বুঝেছি",
    cardFoot1: "সীমিত এজেন্ট কী",
    cardFoot2: "নিয়ন্ত্রণ মালিকের হাতে",
    boundaries: "আপনার নিরাপত্তার সীমা",
    viewMandate: "ম্যান্ডেট দেখুন",
    hacked: "আজ যদি AI হ্যাক হতো",
    hackedLead: "তার ট্রেডে আপনার সর্বোচ্চ যত ক্ষতি হতে পারত।",
    sendOutShort: "ভল্টের বাইরে যেতে পারত।",
    sendOut: "ভল্টের বাইরে পাঠাতে পারত",
    tradeLeft: "আজ আরও ট্রেড করতে পারত",
    lossLimit: "দৈনিক ক্ষতির সীমা",
    downToday: "আজ দিনের শুরুর মূল্য থেকে কমেছে",
    beforeProtect: "সুরক্ষা মোড চালু হতে আর {n}% বাকি",
    protectOn: "সুরক্ষা মোড চালু আছে",
    perTrade: "প্রতি ট্রেডে সর্বোচ্চ",
    approvedAssets: "অনুমোদিত সম্পদ",
    toLoosen: "নিয়ম শিথিল করতে (ডেমো)",
    minutes: "{n} মিনিট",
    seconds: "{n} সেকেন্ড",
    atLimit: "সীমায় পৌঁছালে {agent} কেনা বন্ধ করে। নগদে বিক্রি খোলা থাকে। বাজারে দাম তবুও কমতে পারে।",
    notMarket: "এটি AI-এর ওপর সীমা, বাজারের ওপর নয়: দাম তবুও কমতে পারে।",
    recent: "ছোট পদক্ষেপ। স্পষ্ট কারণ।",
    allActivity: "সব কার্যকলাপ",
    nothingYet: "এখনো কিছু নেই। {agent} যা করে, বা যা করতে বাধা পায়, সবই এখানে দেখা যাবে।",
    trust: "সীমায় ভরসা রাখুন।",
    verify: "সিদ্ধান্ত যাচাই করুন।",
    onChain: "অন-চেইন ম্যান্ডেট",
    keyUntil: "এজেন্ট কী-র মেয়াদ {date} পর্যন্ত",
    noKeyShort: "এজেন্টের কোনো কী নেই",
    inspect: "প্রমাণ দেখুন",
    noMandate: "এখনো কোনো ম্যান্ডেট নেই",
    noMandateBody: "নিজের ভাষায় {agent}-কে আপনার লক্ষ্য বলুন। সে আপনার জন্য একটি ম্যান্ডেটের খসড়া বানাবে, আপনি পড়ে সই করবেন। সই না করা পর্যন্ত সে ট্রেড করতে পারবে না।",
    signableFrom: "এটি আপনার প্রথম ভল্ট নয়, তাই এর ম্যান্ডেটে {time} থেকে সই করা যাবে। নতুন ভল্ট খুলে অপেক্ষার সময় এড়ানো যায় না।",
  },
  outcome: {
    done: "সম্পন্ন",
    "blocked by the risk engine": "আটকানো হয়েছে",
    "reverted by the contract": "চুক্তি প্রত্যাখ্যান করেছে",
    "sent to the owner": "আপনার কাছে পাঠানো হয়েছে",
    "waiting out the delay": "অপেক্ষায়",
    "decided not to act": "করা হয়নি",
    failed: "ব্যর্থ",
  },
  mood: {
    chip: {
      calm: "আপনার ম্যান্ডেটের ভেতরে",
      thinking: "যাচাই করছি",
      watching: "নজর রাখছি",
      worried: "সীমা অটুট",
      warning: "একবার দেখা দরকার",
      shield: "সীমানাতেই থামানো হয়েছে",
      holding: "পরিবর্তন অপেক্ষায়",
    },
    headline: {
      calm: "স্থির হাত।\nসজাগ বন্ধু।",
      thinking: "আপনার ম্যান্ডেটের সাথে\nমিলিয়ে দেখছি।",
      watching: "চোখ খোলা।\nহাত স্থির।",
      worried: "কঠিন দিন।\nনিয়ম অটুট।",
      warning: "একটু ভালো করে\nদেখা দরকার।",
      shield: "সীমানাতেই\nথামানো হয়েছে।",
      holding: "ঝুঁকির নিয়ম\nঅপেক্ষায় থাকে।",
    },
  },
};

const zh: Partial2<Strings> = {
  nav: {
    overview: "总览",
    holdings: "投资组合",
    mandate: "投资授权",
    approvals: "审批",
    activity: "操作记录",
    testIt: "验证",
    proof: "测试结果",
    demo: "安全演示",
  },
  shell: {
    inCharge: "决定权在人手中",
    circle: "你的安全圈",
    circleOwner: "以所有者身份查看",
    circleGuardian: "以监护人身份查看",
    pause: "暂停 AI",
    unpause: "恢复 AI",
    liftPause: "解除暂停",
    askUnpause: "申请恢复（需等待）",
    owner: "所有者",
    guardian: "监护人",
    testnet: "测试网",
    staleShort: "价格已过期",
    talk: "和 {agent} 聊聊",
  },
  overview: {
    morning: "早上好，{name}",
    afternoon: "下午好，{name}",
    evening: "晚上好，{name}",
    title: "你的钱，",
    titleAccent: "安心托管。",
    mandateButton: "你的投资授权",
    value: "投资组合价值",
    testAssets: "模拟测试资产（测试网）",
    today: "今日",
    cash: "现金",
    boundaries: "你的安全边界",
    hacked: "如果 AI 今天被入侵",
    sendOut: "可转出金库的金额",
    hackedLead: "这是其交易最多可能造成的损失。",
    sendOutShort: "可被转出金库。",
    tradeLeft: "今日剩余可交易额",
    lossLimit: "每日亏损上限",
    perTrade: "单笔上限",
    approvedAssets: "允许的资产",
    toLoosen: "放宽规则需等待（演示）",
    minutes: "{n} 分钟",
    seconds: "{n} 秒",
    recent: "每一步，都有理由。",
    allActivity: "全部记录",
    onChain: "链上授权",
    inspect: "查看测试结果",
  },
  outcome: {
    done: "已完成",
    "blocked by the risk engine": "已拦截",
    "reverted by the contract": "被合约拒绝",
    "sent to the owner": "已提交给你",
    "waiting out the delay": "等待中",
    "decided not to act": "未执行",
    failed: "失败",
  },
  mood: {
    chip: {
      calm: "在授权范围内",
      shield: "已在边界拦截",
      holding: "变更等待中",
      warning: "需要留意",
    },
  },
};

function merge<T>(base: T, over: Partial2<T> | undefined): T {
  if (!over) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v : merge((base as Record<string, unknown>)[k], v as never);
  }
  return out as T;
}

const TABLE: Record<Language, Strings> = { en, bn, zh: merge<Strings>(en, zh) };

export function strings(language: Language): Strings {
  return TABLE[language];
}

/** Fills `{key}` placeholders. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** The locale used for dates and times in each language. */
export const LOCALE: Record<Language, string> = { en: "en-GB", bn: "bn-BD-u-nu-latn", zh: "zh-CN" };

/** Clock times are 24-hour with Latin digits in every language, so amounts and times read the same everywhere. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
