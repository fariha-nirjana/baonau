import type { Draft } from "@/lib/drafts";
import type { Currency } from "@/lib/money";
import type { Language, Plan } from "@/lib/plan";
import type { Receipt } from "@/lib/receipts";
import type { ApprovalRequest } from "@/lib/approvals";
import type { Portfolio } from "@/lib/vault";

export type AppState = {
  portfolio: Portfolio;
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
export type View = "portfolio" | "mandate" | "approvals" | "activity" | "demo";
export type Mood = "calm" | "watching" | "warning" | "shield";

export type Settings = { currency: Currency; language: Language; role: Role };

/** Does something in the page, then refreshes what is shown. Returns the server's answer. */
export type Act = (role: "owner" | "guardian" | "demo", action: string, arg?: string) => Promise<unknown>;
