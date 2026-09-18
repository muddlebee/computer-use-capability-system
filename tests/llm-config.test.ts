import { describe, expect, it } from "vitest";

import { loadLlmConfig, publicLlmConfig } from "../src/config/llm-config.js";

describe("loadLlmConfig", () => {
  it("configures OpenRouter through its OpenAI-compatible endpoint", () => {
    const config = loadLlmConfig({
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-openrouter-key",
      OPENROUTER_HTTP_REFERER: "http://localhost:3000",
      OPENROUTER_APP_TITLE: "Assignment",
    });

    expect(config).toEqual({
      provider: "openrouter",
      apiKey: "test-openrouter-key",
      model: "openai/gpt-5.6-luna",
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-OpenRouter-Title": "Assignment",
      },
    });
  });

  it("configures the direct OpenAI API without overriding its base URL", () => {
    const config = loadLlmConfig({
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
    });

    expect(config).toEqual({
      provider: "openai",
      apiKey: "test-openai-key",
      model: "gpt-5.6-luna",
    });
    expect(publicLlmConfig(config)).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("infers OpenRouter when its key is present", () => {
    const config = loadLlmConfig({ OPENROUTER_API_KEY: "test-key" });
    expect(config.provider).toBe("openrouter");
  });

  it("does not expose the API key through the public configuration", () => {
    const config = loadLlmConfig({
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "super-secret",
    });

    expect(JSON.stringify(publicLlmConfig(config))).not.toContain("super-secret");
  });

  it("fails clearly when the selected provider key is missing", () => {
    expect(() => loadLlmConfig({ LLM_PROVIDER: "openrouter" })).toThrow(
      "OPENROUTER_API_KEY is required",
    );
  });
});
