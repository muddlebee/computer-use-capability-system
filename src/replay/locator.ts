import type { Locator, Page } from "playwright";

import type { z } from "zod";

import type { TargetDescriptorSchema } from "../domain/contracts.js";

type TargetDescriptor = z.infer<typeof TargetDescriptorSchema>;

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function locatorForStrategy(
  page: Page,
  strategy: TargetDescriptor["strategies"][number],
): Locator {
  switch (strategy.kind) {
    case "role":
      return page.getByRole(strategy.role, {
        name: strategy.name,
        exact: strategy.exact,
      });
    case "label":
      return page.getByLabel(strategy.label, { exact: true });
    case "text":
      return page.getByText(strategy.text, { exact: strategy.exact });
    case "attribute":
      return page.locator(
        `[${strategy.name}="${escapeCssString(strategy.value)}"]`,
      );
    case "row_label":
      return page
        .getByRole("row")
        .filter({
          has: page.getByRole("rowheader", {
            name: strategy.label,
            exact: true,
          }),
        })
        .getByRole("cell");
    case "css":
      return page.locator(strategy.selector);
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

export async function resolveTarget(
  page: Page,
  target: TargetDescriptor,
  timeoutMs: number,
): Promise<Locator> {
  const failures: string[] = [];

  for (const strategy of target.strategies) {
    const locator = locatorForStrategy(page, strategy);
    const count = await locator.count();
    if (count !== 1) {
      failures.push(`${strategy.kind}: matched ${count} elements`);
      continue;
    }

    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      failures.push(`${strategy.kind}: unique element was not visible`);
    }
  }

  throw new Error(
    `Target ${target.key} could not be resolved (${failures.join("; ")})`,
  );
}
