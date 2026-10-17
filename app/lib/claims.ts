// Catches a model reply that says something was done when no tool did it.

// tools that only read; every other tool does something the owner should see a receipt for
export const READ_ONLY = new Set(["get_portfolio", "get_mandate", "get_market", "get_activity", "get_commitments"]);
// a reply that says something was done; checked against the tools that actually ran
const CLAIMS_ACTION = /\b(I['’]ve|I have|I just)\s+(put|prepared|filed|sent|drafted|set up|queued|submitted|placed|made|bought|sold|paid|requested)\b/i;

/** True when a reply claims an action although no tool that acts ran in this turn. */
export function claimsUnbackedAction(text: string, acted: boolean): boolean {
  return !acted && CLAIMS_ACTION.test(text);
}
