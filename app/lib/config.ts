import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address") as z.ZodType<`0x${string}`>;
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x private key") as z.ZodType<`0x${string}`>;

const chainSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int(),
  EXPLORER_URL: z.string().url(),
  TOKEN_ADDRESS: address,
  WALLET_ADDRESS: address,
  // The agent holds only its own session key. The owner and guardian keys never reach this code path.
  AGENT_PRIVATE_KEY: privateKey,
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
let llm: z.infer<typeof llmSchema> | undefined;

export function chainConfig() {
  return (chain ??= parse(chainSchema, "chain"));
}

export function llmConfig() {
  return (llm ??= parse(llmSchema, "model"));
}

export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "tUSD";
