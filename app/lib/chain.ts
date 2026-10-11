import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { chainConfig } from "./config";

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
    publicClient: createPublicClient({ chain: chain(), transport }),
    agentClient: createWalletClient({ account: agentAccount, chain: chain(), transport }),
  };
}

export function getClients() {
  return (clients ??= build());
}

export function txUrl(hash: string) {
  return `${chainConfig().EXPLORER_URL}/tx/${hash}`;
}
