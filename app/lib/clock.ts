/**
 * The time the app stamps on its records. It is the real clock, except in the
 * evaluation harness, which runs days of market in minutes on a local chain
 * and sets this to the chain's time so that history-based checks still work.
 */
let source: () => number = () => Date.now();

export function setClock(fn: () => number) {
  source = fn;
}

export const now = () => new Date(source());
export const nowIso = () => now().toISOString();
