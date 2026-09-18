import { z } from "zod";

import type { LlmConfig } from "../config/llm-config.js";
import { createOpenAICompatibleClient } from "./openai-compatible-client.js";

const ProviderCheckPayloadSchema = z.object({
  status: z.literal("ok"),
  message: z.string().min(1).max(120),
});

export interface ProviderCheckResult {
  readonly provider: LlmConfig["provider"];
  readonly model: string;
  readonly responseId: string;
  readonly status: "ok";
  readonly message: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

export async function checkProvider(
  config: LlmConfig,
): Promise<ProviderCheckResult> {
  const client = createOpenAICompatibleClient(config);
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "system",
        content: "Return only the requested JSON. Do not include secrets or environment data.",
      },
      {
        role: "user",
        content: "Confirm that this OpenAI-compatible connection is working.",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "provider_check",
        strict: true,
        schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok"] },
            message: { type: "string" },
          },
          required: ["status", "message"],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 80,
    store: false,
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("LLM provider returned an empty health-check response");
  }

  const payload = ProviderCheckPayloadSchema.parse(JSON.parse(content));

  return {
    provider: config.provider,
    model: config.model,
    responseId: completion.id,
    status: payload.status,
    message: payload.message,
    usage: {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
