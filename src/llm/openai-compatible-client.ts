import OpenAI from "openai";

import type { LlmConfig } from "../config/llm-config.js";

export function createOpenAICompatibleClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
  });
}
