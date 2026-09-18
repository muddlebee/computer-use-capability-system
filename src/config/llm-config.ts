import { z } from "zod";

const ProviderSchema = z.enum(["openrouter", "openai"]);

export type LlmProvider = z.infer<typeof ProviderSchema>;

export interface LlmConfig {
  readonly provider: LlmProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly baseURL?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export interface PublicLlmConfig {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly baseURL: string;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function requireSecret(name: string, value: string | undefined): string {
  const secret = nonEmpty(value);
  if (!secret) {
    throw new Error(`${name} is required for the selected LLM provider`);
  }
  return secret;
}

function inferProvider(environment: NodeJS.ProcessEnv): LlmProvider {
  const configured = nonEmpty(environment.LLM_PROVIDER);
  if (configured) {
    return ProviderSchema.parse(configured);
  }

  return nonEmpty(environment.OPENROUTER_API_KEY) ? "openrouter" : "openai";
}

function buildOpenRouterHeaders(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> | undefined {
  const headers: Record<string, string> = {};
  const referer = nonEmpty(environment.OPENROUTER_HTTP_REFERER);
  const title = nonEmpty(environment.OPENROUTER_APP_TITLE);

  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-OpenRouter-Title"] = title;

  return Object.keys(headers).length === 0 ? undefined : headers;
}

export function loadLlmConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  const provider = inferProvider(environment);
  const baseURLOverride = nonEmpty(environment.LLM_BASE_URL);

  if (provider === "openrouter") {
    const defaultHeaders = buildOpenRouterHeaders(environment);
    return {
      provider,
      apiKey: requireSecret("OPENROUTER_API_KEY", environment.OPENROUTER_API_KEY),
      model: nonEmpty(environment.OPENROUTER_MODEL) ?? "openai/gpt-5.6-luna",
      baseURL: baseURLOverride ?? OPENROUTER_BASE_URL,
      ...(defaultHeaders ? { defaultHeaders } : {}),
    };
  }

  return {
    provider,
    apiKey: requireSecret("OPENAI_API_KEY", environment.OPENAI_API_KEY),
    model: nonEmpty(environment.OPENAI_MODEL) ?? "gpt-5.6-luna",
    ...(baseURLOverride ? { baseURL: baseURLOverride } : {}),
  };
}

export function publicLlmConfig(config: LlmConfig): PublicLlmConfig {
  return {
    provider: config.provider,
    model: config.model,
    baseURL:
      config.baseURL ??
      (config.provider === "openrouter" ? OPENROUTER_BASE_URL : OPENAI_BASE_URL),
  };
}
