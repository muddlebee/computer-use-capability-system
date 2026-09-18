import { randomUUID } from "node:crypto";

import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "playwright";

import type { LlmConfig } from "../config/llm-config.js";
import {
  CapabilityArtifactSchema,
  type ArtifactStep,
  type CapabilityArtifact,
  type DiscoveryRequest,
} from "../domain/contracts.js";
import { RunEvidence } from "../evidence/run-evidence.js";
import {
  OpenAICompatibleActionDecider,
  type DiscoveryHistoryEntry,
} from "./action-decider.js";
import {
  observeBrowser,
  targetDescriptorForElement,
  type BrowserObservation,
  type ElementCatalogEntry,
} from "./browser-observer.js";

export interface DiscoveryOptions {
  readonly request: DiscoveryRequest;
  readonly llmConfig: LlmConfig;
  readonly evidenceRoot: string;
  readonly headless?: boolean;
}

export interface DiscoveryResult {
  readonly artifact: CapabilityArtifact;
  readonly runId: string;
  readonly evidenceDirectory: string;
  readonly modelCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

function assertAllowedTarget(
  url: string,
  allowedOrigin: string,
  allowedPathPatterns: readonly string[],
): void {
  const observed = new URL(url);
  if (observed.origin !== allowedOrigin) {
    throw new Error(`Policy denied navigation to origin: ${observed.origin}`);
  }
  if (!allowedPathPatterns.some((pattern) => new RegExp(pattern).test(observed.pathname))) {
    throw new Error(`Policy denied navigation to path: ${observed.pathname}`);
  }
}

function findElement(
  observation: BrowserObservation,
  elementId: string,
): ElementCatalogEntry {
  const entry = observation.elements.find((element) => element.id === elementId);
  if (!entry) throw new Error(`Model selected unknown element: ${elementId}`);
  return entry;
}

function elementLocator(page: Page, entry: ElementCatalogEntry): Locator {
  return page.locator(`[data-cua-id="${entry.id}"]`);
}

function enforceElementPolicy(entry: ElementCatalogEntry): void {
  if (entry.risk === "irreversible" || entry.risk === "human-only") {
    throw new Error(`Policy denied ${entry.risk} control`);
  }
}

function currentInputValue(request: DiscoveryRequest, inputRef: string): string {
  const input = request.inputs.find((candidate) => candidate.name === inputRef);
  if (!input) throw new Error(`Model selected unknown input: ${inputRef}`);
  return input.currentValue;
}

function outputParser(
  request: DiscoveryRequest,
  outputName: string,
): "text" | "currency" | "boolean" | "last4" {
  const output = request.outputs.find((candidate) => candidate.name === outputName);
  if (!output) throw new Error(`Model selected unknown output: ${outputName}`);
  if (output.parser) return output.parser;
  if (output.type === "currency") return "currency";
  if (output.type === "boolean") return "boolean";
  return "text";
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
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

function artifactInputs(request: DiscoveryRequest): CapabilityArtifact["inputs"] {
  return request.inputs.map((input) => {
    if (input.type === "string") {
      return {
        name: input.name,
        type: input.type,
        sensitive: input.sensitive,
        ...(input.pattern ? { pattern: input.pattern } : {}),
      };
    }
    if (input.type === "enum") {
      return {
        name: input.name,
        type: input.type,
        sensitive: input.sensitive,
        values: input.values,
      };
    }
    return {
      name: input.name,
      type: input.type,
      sensitive: input.sensitive,
    };
  });
}

function compileArtifact(
  request: DiscoveryRequest,
  steps: readonly ArtifactStep[],
  checkpoint: CapabilityArtifact["checkpoint"],
): CapabilityArtifact {
  const origin = new URL(request.target.startUrl).origin;
  const targetForLabel = (label: string) => ({
    key: `${label
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((word, index) =>
        index === 0
          ? word.toLowerCase()
          : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`,
      )
      .join("")}Control`,
    strategies: [
      { kind: "role" as const, role: "button" as const, name: label, exact: true },
      { kind: "role" as const, role: "link" as const, name: label, exact: true },
      { kind: "text" as const, text: label, exact: true },
    ],
  });
  return CapabilityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    capability: {
      id: request.capabilityId,
      version: "0.1.0",
      summary: request.successDescription,
    },
    target: {
      appId: request.target.appId,
      surface: "browser",
      entryUrl: request.target.startUrl,
      allowedOrigins: [origin],
      allowedPathPatterns: request.target.allowedPathPatterns,
    },
    inputs: artifactInputs(request),
    outputs: request.outputs,
    steps,
    checkpoint,
    businessOutcomes: request.businessOutcomes,
    runtime: {
      recoveries: request.runtime.recoveries.map((recovery) => ({
        code: recovery.code,
        condition: recovery.condition,
        action: { kind: "click", target: targetForLabel(recovery.actionLabel) },
        maxAttempts: recovery.maxAttempts,
      })),
      hardFailures: request.runtime.hardFailures,
      interventions: request.runtime.interventions.map((intervention) => ({
        reason: intervention.reason,
        condition: intervention.condition,
        humanAction: {
          kind: "click",
          target: targetForLabel(intervention.actionLabel),
        },
      })),
    },
    policy: {
      allowedActions: ["click", "type", "select", "extract", "wait_for"],
      irreversibleActions: "deny",
    },
  });
}

export async function discoverCapability(
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const runId = randomUUID();
  const evidence = await RunEvidence.create(options.evidenceRoot, runId);
  const decider = new OpenAICompatibleActionDecider(options.llmConfig);
  const allowedOrigin = new URL(options.request.target.startUrl).origin;
  const sensitiveInputNames = options.request.inputs
    .filter((input) => input.sensitive)
    .map((input) => input.name);
  const steps: ArtifactStep[] = [];
  const extractedOutputs = new Set<string>();
  const history: DiscoveryHistoryEntry[] = [];
  const deadline = Date.now() + options.request.timeoutMs;
  let promptTokens = 0;
  let completionTokens = 0;
  let browser: Browser | undefined;
  let page: Page | undefined;

  await evidence.write({ event: "discovery_started" });

  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    await page.goto(options.request.target.startUrl, {
      waitUntil: "domcontentloaded",
    });

    for (let turn = 1; turn <= options.request.maxSteps; turn += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Discovery exceeded timeoutMs=${options.request.timeoutMs}`);
      }
      assertAllowedTarget(
        page.url(),
        allowedOrigin,
        options.request.target.allowedPathPatterns,
      );
      const observation = await observeBrowser(page, { sensitiveInputNames });
      const decision = await decider.decide(
        options.request,
        observation,
        history,
        AbortSignal.timeout(remainingMs),
      );
      promptTokens += decision.usage.promptTokens;
      completionTokens += decision.usage.completionTokens;
      const action = decision.action;

      await evidence.write({
        event: "discovery_action",
        detail: `turn=${turn} kind=${action.kind}`,
      });

      if (action.kind === "complete") {
        if (!(await conditionMatches(page, action.checkpoint))) {
          history.push({
            turn,
            action: action.kind,
            result:
              "checkpoint rejected because that exact text is not visible; choose literal visible heading text from the catalog",
            url: page.url(),
          });
          continue;
        }
        const missingOutputs = options.request.outputs
          .map((output) => output.name)
          .filter((name) => !extractedOutputs.has(name));
        if (missingOutputs.length > 0) {
          history.push({
            turn,
            action: action.kind,
            result: `completion rejected; first extract: ${missingOutputs.join(", ")}`,
            url: page.url(),
          });
          continue;
        }
        const artifact = compileArtifact(options.request, steps, action.checkpoint);
        await evidence.screenshot(page, "success", {
          maskSelectors: [
            "[data-sensitive='true']",
            ...sensitiveInputNames.map((name) => `[name=${JSON.stringify(name)}]`),
          ],
        });
        await evidence.write({ event: "discovery_succeeded" });
        return {
          artifact,
          runId,
          evidenceDirectory: evidence.directory,
          modelCalls: turn,
          promptTokens,
          completionTokens,
        };
      }

      if (action.kind === "escalate") {
        throw new Error(`Discovery escalated: ${action.reason}`);
      }

      let historyResult = "action completed";
      const stepId = `step-${steps.length + 1}`;

      if (action.kind === "wait_for") {
        if (action.condition.kind !== "text_present") {
          throw new Error("Only visible-text waits are supported during discovery");
        }
        await page.getByText(action.condition.text, { exact: false }).first().waitFor({
          state: "visible",
          timeout: 5_000,
        });
        steps.push({
          id: stepId,
          kind: "wait_for",
          condition: action.condition,
          timeoutMs: 5_000,
        });
      } else {
        let entry: ElementCatalogEntry;
        if (action.kind === "coordinate_click") {
          const hitId = await page.evaluate(
            ({ x, y }) =>
              document
                .elementFromPoint(x, y)
                ?.closest("[data-cua-id]")
                ?.getAttribute("data-cua-id"),
            { x: action.x, y: action.y },
          );
          if (!hitId) {
            throw new Error("Coordinate click did not resolve to a catalog element");
          }
          entry = findElement(observation, hitId);
        } else {
          entry = findElement(observation, action.elementId);
        }
        enforceElementPolicy(entry);
        const locator = elementLocator(page, entry);
        if ((await locator.count()) !== 1) {
          throw new Error(`Catalog element ${entry.id} is no longer unique`);
        }

        if (action.kind === "click" || action.kind === "coordinate_click") {
          await locator.click({ timeout: 5_000 });
          steps.push({
            id: stepId,
            kind: "click",
            target: targetDescriptorForElement(entry),
            timeoutMs: 5_000,
          });
        } else if (action.kind === "type") {
          await locator.fill(currentInputValue(options.request, action.inputRef), {
            timeout: 5_000,
          });
          steps.push({
            id: stepId,
            kind: "type",
            target: targetDescriptorForElement(entry),
            value: { kind: "input", inputRef: action.inputRef },
            timeoutMs: 5_000,
          });
        } else if (action.kind === "select") {
          await locator.selectOption(
            currentInputValue(options.request, action.inputRef),
            { timeout: 5_000 },
          );
          steps.push({
            id: stepId,
            kind: "select",
            target: targetDescriptorForElement(entry),
            value: { kind: "input", inputRef: action.inputRef },
            timeoutMs: 5_000,
          });
        } else {
          const parser = outputParser(options.request, action.outputName);
          await locator.innerText({ timeout: 5_000 });
          extractedOutputs.add(action.outputName);
          historyResult = `captured declared output ${action.outputName}`;
          steps.push({
            id: stepId,
            kind: "extract",
            target: targetDescriptorForElement(entry),
            outputName: action.outputName,
            parser,
            timeoutMs: 5_000,
          });
        }
      }

      assertAllowedTarget(
        page.url(),
        allowedOrigin,
        options.request.target.allowedPathPatterns,
      );
      history.push({
        turn,
        action: action.kind,
        result: historyResult,
        url: page.url(),
      });
    }

    throw new Error(`Discovery exceeded maxSteps=${options.request.maxSteps}`);
  } catch (error: unknown) {
    if (page) {
      await evidence.screenshot(page, "failure", {
        maskSelectors: [
          "[data-sensitive='true']",
          ...sensitiveInputNames.map((name) => `[name=${JSON.stringify(name)}]`),
        ],
      });
    }
    await evidence.write({
      event: "discovery_failed",
      detail: error instanceof Error ? error.message : "Unknown discovery error",
    });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}
