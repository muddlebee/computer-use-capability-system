#!/usr/bin/env node

import { loadLlmConfig, publicLlmConfig } from "./config/llm-config.js";
import { checkProvider } from "./llm/provider-check.js";
import { safeErrorMessage } from "./security/redact.js";

function printUsage(): void {
  process.stdout.write(`Usage: pnpm cua <command>\n\nCommands:\n  provider-check  Verify the configured OpenAI-compatible provider\n`);
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

  printUsage();
  if (command) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: "command_failed", message: safeErrorMessage(error) })}\n`,
  );
  process.exitCode = 1;
});
