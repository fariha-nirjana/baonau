import type { Draft } from "@/lib/drafts";
import type { Currency } from "@/lib/money";
import type { Language, Plan } from "@/lib/plan";
import type { Receipt } from "@/lib/receipts";
import type { ApprovalRequest } from "@/lib/approvals";
import type { ValuePoint } from "@/lib/values";
import type { Portfolio } from "@/lib/vault";

export type AppState = {
  portfolio: Portfolio;
  /** Portfolio value as read by the app over time. */
  history: ValuePoint[];
  requests: ApprovalRequest[];
  plan: Plan;
  drafts: Draft[];
  receipts: Receipt[];
  brand: { product: string; tagline: string; agent: string; agentRole: string };
  explorer: string;
  vault: string;
  mandate: string;
};

export type Role = "owner" | "guardian";
export type View = "portfolio" | "mandate" | "approvals" | "activity" | "proof" | "demo";
/** The mascot's states, from MIMO_ANIMATIONS.md. Higher in the priority list wins: shield, warning, holding, worried, thinking, watching, calm. */
export type Mood = "calm" | "thinking" | "watching" | "worried" | "warning" | "shield" | "holding";
/** What hit the shield: a failed transaction, a blocked instruction, or a blocked malicious action. */
export type ShieldVariant = "card" | "chat" | "code";

export type Settings = { currency: Currency; language: Language; role: Role };

/** Does something in the page, then refreshes what is shown. Returns the server's answer. */
export type Act = (role: "owner" | "guardian" | "demo", action: string, arg?: string) => Promise<unknown>;
