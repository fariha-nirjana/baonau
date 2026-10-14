/**
 * Names that are not final. Everything that shows the product or the mascot
 * by name reads it from here, so a rename is one edit.
 */
export const BRAND = {
  product: "Paws for Thought",
  tagline: "Money, safely minded",
  /** The agent's persona. The mascot is being renamed; the new name goes here. */
  agent: "Mimo",
  agentRole: "Your money guardian",
} as const;
