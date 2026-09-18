import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

import type { Page } from "playwright";

import {
  InterventionRequestSchema,
  type CapabilityArtifact,
  type ControlState,
} from "../domain/contracts.js";
import type { RunEvidence } from "../evidence/run-evidence.js";
import { resolveTarget } from "../replay/locator.js";
import { redactUrlForEvidence } from "../security/redact.js";

type InterventionRule = CapabilityArtifact["runtime"]["interventions"][number];

export interface HumanHandoffContext {
  readonly runId: string;
  readonly capabilityId: string;
  readonly stepId: string;
  readonly page: Page;
  readonly rule: InterventionRule;
  readonly evidence: RunEvidence;
  readonly maskSelectors: readonly string[];
}

export interface HumanHandoff {
  handle(context: HumanHandoffContext): Promise<void>;
}

export interface OperatorConsoleOptions {
  readonly timeoutMs?: number;
  readonly onReady?: (url: string) => void | Promise<void>;
}

function htmlPage(actionPath: string, reason: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Human intervention</title>
    <style>
      body { font: 16px system-ui; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #172033; }
      img { width: 100%; border: 1px solid #9aa5b5; margin: 1rem 0; }
      button { background: #1456a0; color: white; border: 0; padding: .8rem 1.2rem; font-weight: 700; cursor: pointer; }
      .notice { background: #fff4ce; border-left: 4px solid #9a6700; padding: 1rem; }
    </style>
  </head>
  <body>
    <h1>Automation paused</h1>
    <p class="notice">Reason: ${reason.replace(/[<>&"]/g, "")}</p>
    <p>This is the same live browser session. Review the redacted screenshot, then perform the approved manual action and return control.</p>
    <img src="${actionPath}/screenshot" alt="Redacted current browser state">
    <form method="post" action="${actionPath}/act">
      <button type="submit">Perform approved action and resume</button>
    </form>
  </body>
</html>`;
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export class OperatorConsoleHandoff implements HumanHandoff {
  constructor(private readonly options: OperatorConsoleOptions = {}) {}

  async handle(context: HumanHandoffContext): Promise<void> {
    let controlState: ControlState = "automation";
    controlState = "paused";
    const screenshotPath = await context.evidence.screenshot(
      context.page,
      `intervention-${context.stepId}`,
      { maskSelectors: context.maskSelectors },
    );
    const request = InterventionRequestSchema.parse({
      runId: context.runId,
      capabilityId: context.capabilityId,
      stepId: context.stepId,
      reason: context.rule.reason,
      screenshotPath,
      currentUrl: redactUrlForEvidence(context.page.url()),
      requestedAt: new Date().toISOString(),
      controller: "human",
    });
    await writeFile(
      `${context.evidence.directory}/intervention.json`,
      `${JSON.stringify(request, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await context.evidence.write({
      event: "control_transferred",
      stepId: context.stepId,
      detail: `${controlState}->human reason=${context.rule.reason}`,
    });

    const token = randomBytes(18).toString("hex");
    const actionPath = `/intervention/${token}`;
    let server: Server | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };

        server = createServer(async (request_, response) => {
          try {
            const requestUrl = new URL(
              request_.url ?? "/",
              "http://127.0.0.1",
            );
            if (requestUrl.pathname === `${actionPath}/screenshot`) {
              response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
              response.end(await readFile(screenshotPath));
              return;
            }
            if (request_.method === "GET" && requestUrl.pathname === actionPath) {
              response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Frame-Options": "DENY",
              });
              response.end(htmlPage(actionPath, context.rule.reason));
              return;
            }
            if (request_.method === "POST" && requestUrl.pathname === `${actionPath}/act`) {
              controlState = "human";
              await context.evidence.write({
                event: "human_action_started",
                stepId: context.stepId,
                detail: `controller=${controlState}`,
              });
              const locator = await resolveTarget(
                context.page,
                context.rule.humanAction.target,
                10_000,
              );
              await locator.click({ timeout: 10_000 });
              controlState = "automation";
              await context.evidence.write({
                event: "human_action_completed",
                stepId: context.stepId,
                detail: "approved action completed; control=automation",
              });
              response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              response.end("<h1>Control returned to automation</h1><p>You can close this tab.</p>");
              finish();
              return;
            }
            response.writeHead(404).end("Not found");
          } catch (error: unknown) {
            response.writeHead(500).end("Operator action failed");
            finish(error instanceof Error ? error : new Error("Operator action failed"));
          }
        });

        server.once("error", (error) => finish(error));
        server.listen(0, "127.0.0.1", () => {
          const address = server?.address();
          if (!address || typeof address === "string") {
            finish(new Error("Operator console did not receive a TCP address"));
            return;
          }
          const url = `http://127.0.0.1:${address.port}${actionPath}`;
          process.stdout.write(
            `${JSON.stringify({ event: "intervention_ready", url, reason: context.rule.reason })}\n`,
          );
          void Promise.resolve(this.options.onReady?.(url)).catch((error: unknown) =>
            finish(error instanceof Error ? error : new Error("Operator callback failed")),
          );
        });

        setTimeout(
          () => finish(new Error("Human intervention timed out")),
          this.options.timeoutMs ?? 300_000,
        ).unref();
      });
    } finally {
      await closeServer(server);
    }
  }
}
