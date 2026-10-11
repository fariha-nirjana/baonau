import OpenAI from "openai";
import { llmConfig } from "./config";

let client: OpenAI | undefined;

/** One shared client for any OpenAI-compatible provider, set in .env. */
export function llm() {
  const cfg = llmConfig();
  return (client ??= new OpenAI({ apiKey: cfg.LLM_API_KEY, baseURL: cfg.LLM_BASE_URL }));
}
