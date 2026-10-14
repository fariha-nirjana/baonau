import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

/**
 * A private chain on this machine, running the same contracts that are
 * deployed on the testnet. The harness needs thousands of transactions and
 * days of simulated time, which a public testnet cannot give.
 */

const PORT = 8547;
export const RPC = `http://127.0.0.1:${PORT}`;
// The well-known keys every local test node starts with. They hold nothing real.
const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  guardian: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agent: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  updater: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
// derived from the keys, never typed by hand
const ADDRESSES = Object.fromEntries(Object.entries(KEYS).map(([role, key]) => [role, privateKeyToAccount(key).address])) as Record<keyof typeof KEYS, `0x${string}`>;
/** The start of a UTC day, so every run sees the same day boundaries. */
export const T0 = 20_900 * 86_400;
export const STEP_SECONDS = 3_600;
export const START_CASH = 1_000;

let node: ChildProcess | undefined;
let snapshot = "";

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** Starts the node, deploys everything with the same script used for the testnet, and remembers that state. */
export async function startWorld(dataDir: string) {
  node = spawn("anvil", ["--port", String(PORT), "--chain-id", "31337", "--timestamp", String(T0), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      await rpc("eth_chainId");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const env = {
    ...process.env,
    OWNER_PRIVATE_KEY: KEYS.owner,
    GUARDIAN_ADDRESS: ADDRESSES.guardian,
    AGENT_ADDRESS: ADDRESSES.agent,
    ORACLE_UPDATER_ADDRESS: ADDRESSES.updater,
    // production-like waits: a day before any rise in risk takes effect
    LOOSEN_DELAY: "86400",
    MAX_PRICE_AGE: "7200",
    ORACLE_MIN_INTERVAL: "60",
    DEPOSIT_USD_UNITS: String(START_CASH * 1e6),
    GAS_GIFT_WEI: "0",
    SIGN_MANDATE: "true",
  };
  const out = execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: join(process.cwd(), "..", "contracts"), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const found = Object.fromEntries([...out.matchAll(/([A-Z]+_ADDRESS)=(0x[0-9a-fA-F]{40})/g)].map((m) => [m[1], m[2]]));
  if (!found.VAULT_ADDRESS) throw new Error(`Deployment did not print the addresses:\n${out.slice(-2000)}`);

  // point the app's own code at this chain, before any of it is loaded
  Object.assign(process.env, found, {
    RPC_URL: RPC,
    CHAIN_ID: "31337",
    EXPLORER_URL: "http://localhost",
    AGENT_PRIVATE_KEY: KEYS.agent,
    OWNER_PRIVATE_KEY: KEYS.owner,
    GUARDIAN_PRIVATE_KEY: KEYS.guardian,
    ORACLE_UPDATER_PRIVATE_KEY: KEYS.updater,
    DATA_DIR: dataDir,
  });
  mkdirSync(dataDir, { recursive: true });
  snapshot = (await rpc("evm_snapshot")) as string;
  return { addresses: found as Record<string, `0x${string}`>, keys: KEYS, accounts: ADDRESSES };
}

/** Back to the freshly deployed state, with an empty record folder. */
export async function resetWorld(dataDir: string) {
  await rpc("evm_revert", [snapshot]);
  snapshot = (await rpc("evm_snapshot")) as string;
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
}

/** Moves the chain to the start of step `n` (one hour each). */
export async function goToStep(n: number): Promise<number> {
  const t = T0 + 600 + (n + 1) * STEP_SECONDS;
  await rpc("evm_setNextBlockTimestamp", [t]);
  await rpc("evm_mine");
  return t;
}

export function stopWorld() {
  node?.kill();
}
