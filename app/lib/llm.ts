import OpenAI from "openai";
import { llmConfig } from "./config";

let client: OpenAI | undefined;

/** One shared client for any OpenAI-compatible provider, set in .env. */
export function llm() {
  const cfg = llmConfig();
  // a slow or failing model must never leave a decision hanging: the agent gives up and does nothing
  return (client ??= new OpenAI({ apiKey: cfg.LLM_API_KEY, baseURL: cfg.LLM_BASE_URL, timeout: 45_000, maxRetries: 1 }));
}
