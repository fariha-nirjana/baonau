import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { chainConfig, roleKeys } from "./config";

function chain() {
  const cfg = chainConfig();
  if (cfg.CHAIN_ID === baseSepolia.id) return baseSepolia;
  // any other EVM chain, so the same code runs against a local node or another testnet
  return defineChain({
    id: cfg.CHAIN_ID,
    name: `chain-${cfg.CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.RPC_URL] } },
  });
}

let clients: ReturnType<typeof build> | undefined;

function build() {
  const cfg = chainConfig();
  const transport = http(cfg.RPC_URL);
  const agentAccount = privateKeyToAccount(cfg.AGENT_PRIVATE_KEY);
  return {
    agentAccount,
    // a local node mines at once, so there is no reason to wait seconds between polls
    publicClient: createPublicClient({ chain: chain(), transport, pollingInterval: cfg.CHAIN_ID === baseSepolia.id ? undefined : 20 }),
    agentClient: createWalletClient({ account: agentAccount, chain: chain(), transport }),
  };
}

export function getClients() {
  return (clients ??= build());
}

export type DemoRole = "owner" | "guardian" | "updater";

/**
 * A signer for one of the other roles. Used by the demo scripts and the
 * demo's sign buttons only; nothing the agent runs imports this.
 */
export function roleClient(role: DemoRole) {
  const keys = roleKeys();
  const key = { owner: keys.OWNER_PRIVATE_KEY, guardian: keys.GUARDIAN_PRIVATE_KEY, updater: keys.ORACLE_UPDATER_PRIVATE_KEY }[role];
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: chain(), transport: http(chainConfig().RPC_URL) }) };
}

/** True when the chain has the multicall contract, which a fresh local node does not. */
export function hasMulticall() {
  return chainConfig().CHAIN_ID === baseSepolia.id;
}

export function txUrl(hash: string) {
  return `${chainConfig().EXPLORER_URL}/tx/${hash}`;
}
