#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";

import { loadLlmConfig, publicLlmConfig } from "./config/llm-config.js";
import { CapabilityArtifactSchema } from "./domain/contracts.js";
import { checkProvider } from "./llm/provider-check.js";
import { replayCapability } from "./replay/replay-engine.js";
import { safeErrorMessage } from "./security/redact.js";

loadDotenv({ quiet: true });

function printUsage(): void {
  process.stdout.write(`Usage: pnpm cua <command> [options]\n\nCommands:\n  provider-check  Verify the configured OpenAI-compatible provider\n  replay          Replay a saved capability without an LLM\n\nReplay options:\n  --artifact <path>  Capability artifact JSON\n  --inputs <path>    Invocation input JSON\n  --entry-url <url>  Optional same-origin entry URL override\n  --headed           Show the browser window\n`);
}

function getOption(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function requireOption(arguments_: readonly string[], name: string): string {
  const value = getOption(arguments_, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "provider-check") {
    const config = loadLlmConfig();
    process.stdout.write(
      `${JSON.stringify({ event: "provider_check_started", ...publicLlmConfig(config) })}\n`,
    );
    const result = await checkProvider(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "replay") {
    const arguments_ = process.argv.slice(3);
    const artifactPath = requireOption(arguments_, "--artifact");
    const inputsPath = requireOption(arguments_, "--inputs");
    const artifact = CapabilityArtifactSchema.parse(await readJson(artifactPath));
    const rawInputs = await readJson(inputsPath);
    const entryUrlOverride = getOption(arguments_, "--entry-url");
    const result = await replayCapability({
      artifact,
      rawInputs,
      evidenceRoot: "evidence/runs",
      headless: !arguments_.includes("--headed"),
      ...(entryUrlOverride ? { entryUrlOverride } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "failure") process.exitCode = 2;
    return;
  }

  printUsage();
  if (command) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "command_failed", message: safeErrorMessage(error) })}\n`,
  );
  process.exitCode = 1;
});
