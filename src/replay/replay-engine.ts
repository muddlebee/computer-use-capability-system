import { randomUUID } from "node:crypto";

import { chromium, type Browser, type Locator, type Page } from "playwright";

import type {
  ArtifactStep,
  CapabilityArtifact,
  RunResult,
} from "../domain/contracts.js";
import { RunEvidence } from "../evidence/run-evidence.js";
import { validateReplayInputs, type ReplayInputs } from "./inputs.js";
import { resolveTarget } from "./locator.js";

export interface ReplayOptions {
  readonly artifact: CapabilityArtifact;
  readonly rawInputs: unknown;
  readonly evidenceRoot: string;
  readonly headless?: boolean;
  readonly entryUrlOverride?: string;
}

function assertAllowedOrigin(url: string, artifact: CapabilityArtifact): void {
  const origin = new URL(url).origin;
  if (!artifact.target.allowedOrigins.includes(origin)) {
    throw new Error(`Policy denied navigation to origin: ${origin}`);
  }
}

function resolveValue(
  step: Extract<ArtifactStep, { kind: "type" | "select" }>,
  inputs: ReplayInputs,
): string {
  if (step.value.kind === "literal") return step.value.value;
  const value = inputs[step.value.inputRef];
  if (value === undefined) {
    throw new Error(`Missing input reference: ${step.value.inputRef}`);
  }
  return value;
}

async function enforceTargetPolicy(locator: Locator): Promise<void> {
  const risk = await locator.getAttribute("data-risk");
  if (risk === "irreversible" || risk === "human-only") {
    throw new Error(`Policy denied ${risk} control`);
  }
}

function parseExtractedValue(
  rawValue: string,
  parser: Extract<ArtifactStep, { kind: "extract" }>["parser"],
): string | boolean {
  const value = rawValue.trim();
  switch (parser) {
    case "text":
      return value;
    case "currency": {
      const normalized = value.replaceAll(",", "").replace(/^\$/, "");
      if (!/^\d+\.\d{2}$/.test(normalized)) {
        throw new Error(`Could not parse currency output: ${value}`);
      }
      return normalized;
    }
    case "boolean":
      if (/^(true|yes)$/i.test(value)) return true;
      if (/^(false|no)$/i.test(value)) return false;
      throw new Error(`Could not parse boolean output: ${value}`);
    case "last4": {
      const match = value.match(/([A-Za-z0-9]{4})$/);
      if (!match?.[1]) throw new Error(`Could not parse last four characters: ${value}`);
      return match[1];
    }
    default: {
      const exhaustive: never = parser;
      return exhaustive;
    }
  }
}

async function conditionMatches(
  page: Page,
  condition: CapabilityArtifact["checkpoint"],
): Promise<boolean> {
  switch (condition.kind) {
    case "text_present":
      return (await page.getByText(condition.text, { exact: false }).count()) > 0;
    case "url_matches":
      return new RegExp(condition.pattern).test(page.url());
    case "element_state":
      throw new Error(
        `Condition target ${condition.targetKey} requires a target registry`,
      );
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

async function findBusinessOutcome(
  page: Page,
  artifact: CapabilityArtifact,
): Promise<string | undefined> {
  for (const outcome of artifact.businessOutcomes) {
    if (await conditionMatches(page, outcome.condition)) return outcome.code;
  }
  return undefined;
}

async function executeStep(
  page: Page,
  step: ArtifactStep,
  inputs: ReplayInputs,
  outputs: Record<string, unknown>,
): Promise<void> {
  if (step.kind === "wait_for") {
    const deadline = Date.now() + step.timeoutMs;
    while (Date.now() < deadline) {
      if (await conditionMatches(page, step.condition)) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Wait condition was not met for ${step.id}`);
  }

  const locator = await resolveTarget(page, step.target, step.timeoutMs);
  await enforceTargetPolicy(locator);

  switch (step.kind) {
    case "click":
      await locator.click({ timeout: step.timeoutMs });
      return;
    case "type":
      await locator.fill(resolveValue(step, inputs), { timeout: step.timeoutMs });
      return;
    case "select":
      await locator.selectOption(resolveValue(step, inputs), {
        timeout: step.timeoutMs,
      });
      return;
    case "extract": {
      const rawValue = await locator.innerText({ timeout: step.timeoutMs });
      outputs[step.outputName] = parseExtractedValue(rawValue, step.parser);
      return;
    }
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

async function closeBrowser(browser: Browser | undefined): Promise<void> {
  if (browser) await browser.close();
}

export async function replayCapability(
  options: ReplayOptions,
): Promise<RunResult> {
  const runId = randomUUID();
  const evidence = await RunEvidence.create(options.evidenceRoot, runId);
  const inputs = validateReplayInputs(options.artifact, options.rawInputs);
  const entryUrl = options.entryUrlOverride ?? options.artifact.target.entryUrl;
  assertAllowedOrigin(entryUrl, options.artifact);

  let browser: Browser | undefined;
  let page: Page | undefined;
  let currentStepId: string | undefined;
  const outputs: Record<string, unknown> = {};

  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();

    await evidence.write({ event: "replay_started" });
    await page.goto(entryUrl, { waitUntil: "domcontentloaded" });

    for (const step of options.artifact.steps) {
      currentStepId = step.id;
      if (!options.artifact.policy.allowedActions.includes(step.kind)) {
        throw new Error(`Policy denied undeclared action: ${step.kind}`);
      }

      await evidence.write({
        event: "step_started",
        stepId: step.id,
        detail: step.kind,
      });
      await executeStep(page, step, inputs, outputs);
      assertAllowedOrigin(page.url(), options.artifact);
      await evidence.write({ event: "step_completed", stepId: step.id });

      const businessOutcome = await findBusinessOutcome(page, options.artifact);
      if (businessOutcome) {
        await evidence.screenshot(page, "business-outcome");
        await context.tracing.stop({ path: evidence.tracePath });
        return {
          status: "business_outcome",
          runId,
          evidenceDirectory: evidence.directory,
          recoveries: [],
          code: businessOutcome,
          details: {},
        };
      }
    }

    if (!(await conditionMatches(page, options.artifact.checkpoint))) {
      throw new Error("Capability success checkpoint was not satisfied");
    }

    for (const output of options.artifact.outputs) {
      if (!(output.name in outputs)) {
        throw new Error(`Declared output was not extracted: ${output.name}`);
      }
    }

    await evidence.screenshot(page, "success");
    await context.tracing.stop({ path: evidence.tracePath });
    await evidence.write({ event: "replay_succeeded" });

    return {
      status: "success",
      runId,
      evidenceDirectory: evidence.directory,
      recoveries: [],
      outputs,
    };
  } catch (error: unknown) {
    if (page) await evidence.screenshot(page, "failure");
    await evidence.write({
      event: "replay_failed",
      ...(currentStepId ? { stepId: currentStepId } : {}),
      detail: error instanceof Error ? error.message : "Unknown replay error",
    });
    return {
      status: "failure",
      runId,
      evidenceDirectory: evidence.directory,
      recoveries: [],
      code:
        error instanceof Error && error.message.startsWith("Policy denied")
          ? "policy_denied"
          : "unexpected_state",
      ...(currentStepId ? { stepId: currentStepId } : {}),
      expected: "The deterministic step and final checkpoint should succeed.",
      observed: error instanceof Error ? error.message : "Unknown replay error",
      retryable: false,
    };
  } finally {
    await closeBrowser(browser);
  }
}
