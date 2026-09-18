#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadLlmConfig, publicLlmConfig } from "./config/llm-config.js";
import { discoverCapability } from "./discovery/discovery-runner.js";
import {
  CapabilityArtifactSchema,
  DiscoveryRequestSchema,
} from "./domain/contracts.js";
import { checkProvider } from "./llm/provider-check.js";
import { OperatorConsoleHandoff } from "./handoff/operator-console.js";
import { replayCapability } from "./replay/replay-engine.js";
import { safeErrorMessage } from "./security/redact.js";

loadDotenv({ quiet: true });

function printUsage(): void {
  process.stdout.write(`Usage: pnpm cua <command> [options]\n\nCommands:\n  provider-check  Verify the configured OpenAI-compatible provider\n  discover        Use a model to discover and compile a capability\n  replay          Replay a saved capability without an LLM\n\nDiscover options:\n  --request <path>   Typed discovery request JSON\n  --output <path>    Generated capability artifact JSON\n  --headed           Show the browser window\n\nReplay options:\n  --artifact <path>  Capability artifact JSON\n  --inputs <path>    Invocation input JSON\n  --entry-url <url>  Optional same-origin entry URL override\n  --handoff          Start a local operator console when human action is needed\n  --headed           Show the browser window\n`);
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

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
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

  if (command === "discover") {
    const arguments_ = process.argv.slice(3);
    const requestPath = requireOption(arguments_, "--request");
    const outputPath = requireOption(arguments_, "--output");
    const request = DiscoveryRequestSchema.parse(await readJson(requestPath));
    const result = await discoverCapability({
      request,
      llmConfig: loadLlmConfig(),
      evidenceRoot: "evidence/discovery",
      headless: !arguments_.includes("--headed"),
    });
    await writeJsonAtomic(outputPath, result.artifact);
    process.stdout.write(
      `${JSON.stringify({
        event: "discovery_succeeded",
        artifactPath: outputPath,
        runId: result.runId,
        evidenceDirectory: result.evidenceDirectory,
        modelCalls: result.modelCalls,
        usage: {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        },
      })}\n`,
    );
    return;
  }

  if (command === "replay") {
    const arguments_ = process.argv.slice(3);
    const artifactPath = requireOption(arguments_, "--artifact");
    const inputsPath = requireOption(arguments_, "--inputs");
    const artifact = CapabilityArtifactSchema.parse(await readJson(artifactPath));
    const rawInputs = await readJson(inputsPath);
    const entryUrlOverride = getOption(arguments_, "--entry-url");
    const handoff = arguments_.includes("--handoff")
      ? new OperatorConsoleHandoff()
      : undefined;
    const result = await replayCapability({
      artifact,
      rawInputs,
      evidenceRoot: "evidence/runs",
      headless: !arguments_.includes("--headed"),
      ...(entryUrlOverride ? { entryUrlOverride } : {}),
      ...(handoff ? { handoff } : {}),
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
