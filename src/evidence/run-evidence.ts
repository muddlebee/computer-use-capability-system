import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import { redactSecrets } from "../security/redact.js";

export interface EvidenceEvent {
  readonly event: string;
  readonly stepId?: string;
  readonly detail?: string;
}

export interface ScreenshotOptions {
  readonly maskSelectors?: readonly string[];
}

export class RunEvidence {
  readonly directory: string;

  private constructor(directory: string) {
    this.directory = directory;
  }

  static async create(root: string, runId: string): Promise<RunEvidence> {
    const directory = path.join(root, runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return new RunEvidence(directory);
  }

  async write(event: EvidenceEvent): Promise<void> {
    const safeEvent = {
      timestamp: new Date().toISOString(),
      event: event.event,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      ...(event.detail ? { detail: redactSecrets(event.detail) } : {}),
    };
    await appendFile(
      path.join(this.directory, "events.jsonl"),
      `${JSON.stringify(safeEvent)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async screenshot(
    page: Page,
    name: string,
    options: ScreenshotOptions = {},
  ): Promise<string> {
    const screenshotPath = path.join(this.directory, `${name}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      mask: (options.maskSelectors ?? []).map((selector) => page.locator(selector)),
      maskColor: "#202020",
    });
    return screenshotPath;
  }
}
