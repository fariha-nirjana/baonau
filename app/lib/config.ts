import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address") as z.ZodType<`0x${string}`>;
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x private key") as z.ZodType<`0x${string}`>;

const chainSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int(),
  EXPLORER_URL: z.string().url(),
  VAULT_ADDRESS: address,
  USD_ADDRESS: address,
  ORACLE_ADDRESS: address,
  EXCHANGE_ADDRESS: address,
  IDX_ADDRESS: address,
  BOND_ADDRESS: address,
  GOLD_ADDRESS: address,
  MEME_ADDRESS: address,
  // The agent holds only its own session key. The other keys never reach the agent's code path.
  AGENT_PRIVATE_KEY: privateKey,
});

/**
 * Keys for the other roles. Only the demo scripts and the demo's "sign" buttons
 * load these. In a real deployment the owner and guardian sign in their own
 * wallets and these would not exist on the server.
 */
const roleSchema = z.object({
  OWNER_PRIVATE_KEY: privateKey,
  GUARDIAN_PRIVATE_KEY: privateKey,
  ORACLE_UPDATER_PRIVATE_KEY: privateKey,
});

const llmSchema = z.object({
  LLM_API_KEY: z.string().min(1, "set LLM_API_KEY in .env"),
  LLM_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  LLM_MODEL: z.string().default("deepseek-flash"),
});

function parse<T>(schema: z.ZodType<T>, what: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Bad ${what} config in .env (${problems})`);
  }
  return result.data;
}

let chain: z.infer<typeof chainSchema> | undefined;
let roles: z.infer<typeof roleSchema> | undefined;
let llm: z.infer<typeof llmSchema> | undefined;

export function chainConfig() {
  return (chain ??= parse(chainSchema, "chain"));
}

export function roleKeys() {
  return (roles ??= parse(roleSchema, "demo role key"));
}

export function llmConfig() {
  return (llm ??= parse(llmSchema, "model"));
}

/** The chain's name for the top bar. Anything unknown is shown by its id. */
export function networkName(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 31337) return "Local test chain";
  if (chainId === 20200) return "FISCO BCOS (local)";
  return `Chain ${chainId}`;
}

export const USD_DECIMALS = 6;
export const USD_SYMBOL = "tUSD";
export const PRICE_DECIMALS = 8;
