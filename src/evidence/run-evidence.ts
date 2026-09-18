import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
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

export interface EvidenceIndexLink {
  readonly href: string;
  readonly label: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

export class RunEvidence {
  readonly directory: string;
  private readonly screenshots: string[] = [];

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

  async writeJson(name: string, value: unknown): Promise<string> {
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) {
      throw new Error(`Invalid evidence JSON filename: ${name}`);
    }
    const filePath = path.join(this.directory, name);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const serialized = redactSecrets(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
    return filePath;
  }

  async appendJsonLine(name: string, value: unknown): Promise<string> {
    if (!/^[a-z0-9][a-z0-9-]*\.jsonl$/.test(name)) {
      throw new Error(`Invalid evidence JSONL filename: ${name}`);
    }
    const filePath = path.join(this.directory, name);
    const serialized = redactSecrets(`${JSON.stringify(value)}\n`);
    await appendFile(filePath, serialized, { encoding: "utf8", mode: 0o600 });
    return filePath;
  }

  async screenshot(
    page: Page,
    name: string,
    options: ScreenshotOptions = {},
  ): Promise<string> {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid evidence screenshot name: ${name}`);
    }
    const screenshotPath = path.join(this.directory, `${name}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      mask: (options.maskSelectors ?? []).map((selector) => page.locator(selector)),
      maskColor: "#202020",
    });
    this.screenshots.push(`${name}.png`);
    return screenshotPath;
  }

  async writeIndex(
    title: string,
    extraLinks: readonly EvidenceIndexLink[] = [],
  ): Promise<string> {
    const filePath = path.join(this.directory, "index.html");
    const figures = this.screenshots
      .map(
        (filename) => `<figure>
  <figcaption>${escapeHtml(filename)}</figcaption>
  <a href="${encodeURIComponent(filename)}"><img src="${encodeURIComponent(filename)}" alt="${escapeHtml(filename)}"></a>
</figure>`,
      )
      .join("\n");
    const navigation = [
      { href: "result.json", label: "Result JSON" },
      { href: "events.jsonl", label: "Event log" },
      ...extraLinks,
    ]
      .map(
        (link) =>
          `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
      )
      .join("");
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 16px system-ui; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #172033; }
    nav { display: flex; gap: 1rem; margin-bottom: 2rem; }
    figure { margin: 0 0 2rem; }
    figcaption { font-weight: 700; margin-bottom: .5rem; }
    img { max-width: 100%; border: 1px solid #9aa5b5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <nav>${navigation}</nav>
  ${figures}
</body>
</html>\n`;
    await writeFile(filePath, html, { encoding: "utf8", mode: 0o600 });
    return filePath;
  }
}
