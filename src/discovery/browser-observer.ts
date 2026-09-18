import type { Page } from "playwright";
import { z } from "zod";

import {
  TargetDescriptorSchema,
  type DiscoveryRequest,
} from "../domain/contracts.js";

const ElementCatalogEntrySchema = z.object({
  id: z.string().regex(/^e[1-9][0-9]*$/),
  tag: z.string().min(1),
  role: z.string().min(1),
  name: z.string(),
  nearbyLabel: z.string(),
  nameAttribute: z.string(),
  typeAttribute: z.string(),
  risk: z.string(),
  cssPath: z.string().min(1),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

export type ElementCatalogEntry = z.infer<typeof ElementCatalogEntrySchema>;

export interface BrowserObservation {
  readonly url: string;
  readonly title: string;
  readonly screenshotDataUrl: string;
  readonly elements: readonly ElementCatalogEntry[];
}

export interface BrowserObservationOptions {
  readonly sensitiveInputNames?: readonly string[];
}

function toIdentifier(value: string, fallback: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length === 0) return fallback;
  const [first, ...rest] = words;
  if (!first) return fallback;
  const candidate = `${first.toLowerCase()}${rest
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join("")}`;
  return /^[a-z][A-Za-z0-9]*$/.test(candidate) ? candidate : fallback;
}

function roleForTarget(entry: ElementCatalogEntry):
  | "alert"
  | "button"
  | "cell"
  | "combobox"
  | "heading"
  | "link"
  | "textbox"
  | undefined {
  if (
    entry.role === "alert" ||
    entry.role === "button" ||
    entry.role === "cell" ||
    entry.role === "combobox" ||
    entry.role === "heading" ||
    entry.role === "link" ||
    entry.role === "textbox"
  ) {
    return entry.role;
  }
  return undefined;
}

export function targetDescriptorForElement(entry: ElementCatalogEntry) {
  const strategies: z.input<typeof TargetDescriptorSchema>["strategies"] = [];
  if (entry.role === "cell" && entry.nearbyLabel) {
    strategies.push({ kind: "row_label", label: entry.nearbyLabel });
  }
  const semanticRole = roleForTarget(entry);
  if (semanticRole && entry.name && !(entry.role === "cell" && entry.nearbyLabel)) {
    strategies.push({
      kind: "role",
      role: semanticRole,
      name: entry.name,
      exact: true,
    });
  }
  if (entry.nameAttribute) {
    strategies.push({
      kind: "attribute",
      name: "name",
      value: entry.nameAttribute,
    });
  }
  if ((entry.role === "button" || entry.role === "link") && entry.name) {
    strategies.push({ kind: "text", text: entry.name, exact: true });
  }
  strategies.push({ kind: "css", selector: entry.cssPath });

  const baseName =
    entry.nameAttribute || entry.nearbyLabel || entry.name || `${entry.tag}Target`;
  const suffix =
    entry.role === "textbox" || entry.role === "combobox"
      ? "Field"
      : entry.role === "button"
        ? "Button"
        : entry.role === "link"
          ? "Link"
          : "Target";

  return TargetDescriptorSchema.parse({
    key: toIdentifier(`${baseName} ${suffix}`, `element${entry.id.slice(1)}`),
    strategies,
  });
}

export function renderGoal(request: DiscoveryRequest): string {
  let goal = request.goalTemplate;
  for (const input of request.inputs) {
    const replacement = input.sensitive
      ? `[sensitive input: ${input.name}]`
      : input.currentValue;
    goal = goal.replaceAll(`{{${input.name}}}`, replacement);
  }
  return goal;
}

export async function observeBrowser(
  page: Page,
  options: BrowserObservationOptions = {},
): Promise<BrowserObservation> {
  const rawElements: unknown = await page
    .locator(
      'a, button, input:not([type="hidden"]), select, textarea, td, h1, h2, [role="alert"], [role="button"], [role="link"]',
    )
    .evaluateAll((elements) => {
      return elements.flatMap((element, index) => {
        const htmlElement = element instanceof HTMLElement ? element : undefined;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (
          !htmlElement ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.visibility === "hidden" ||
          style.display === "none"
        ) {
          return [];
        }

        const id = `e${index + 1}`;
        element.setAttribute("data-cua-id", id);
        const row = element.closest("tr");
        const nearbyLabel =
          row?.querySelector("th[scope='row'], th, .field-label")?.textContent?.trim() ??
          "";
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
        const title = element.getAttribute("title")?.trim() ?? "";
        const nameAttribute = element.getAttribute("name")?.trim() ?? "";
        const isSensitive =
          element.matches("[data-sensitive='true']") ||
          element.closest("[data-sensitive='true']") !== null;
        const tag = element.tagName.toLowerCase();
        const inputType = element.getAttribute("type") ?? "text";
        const role =
          element.getAttribute("role") ??
          (tag === "a"
            ? "link"
            : tag === "button" ||
                (tag === "input" &&
                  ["submit", "button", "reset"].includes(inputType))
              ? "button"
              : tag === "select"
                ? "combobox"
                : tag === "h1" || tag === "h2"
                  ? "heading"
                : tag === "textarea" || tag === "input"
                  ? "textbox"
                  : tag === "td"
                    ? "cell"
                    : "generic");
        const segments: string[] = [];
        let current: Element | null = element;
        while (
          !nameAttribute &&
          current &&
          current.tagName.toLowerCase() !== "html"
        ) {
          const currentTag = current.tagName.toLowerCase();
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter(
                (sibling) => sibling.tagName === current?.tagName,
              )
            : [];
          const position = siblings.indexOf(current) + 1;
          segments.unshift(`${currentTag}:nth-of-type(${position})`);
          current = current.parentElement;
        }
        const cssPath = nameAttribute
          ? `${tag}[name="${CSS.escape(nameAttribute)}"]`
          : segments.join(" > ");

        return [
          {
            id,
            tag,
            role,
            name: isSensitive
              ? "[sensitive value redacted]"
              : ariaLabel || text || title || nearbyLabel || nameAttribute,
            nearbyLabel,
            nameAttribute,
            typeAttribute: element.getAttribute("type") ?? "",
            risk: element.getAttribute("data-risk") ?? "",
            cssPath,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          },
        ];
      });
    });

  const elements = z.array(ElementCatalogEntrySchema).parse(rawElements);
  const sensitiveSelectors = [
    "[data-sensitive='true']",
    ...(options.sensitiveInputNames ?? []).map(
      (name) => `[name=${JSON.stringify(name)}]`,
    ),
  ];
  const screenshot = await page.screenshot({
    type: "png",
    mask: sensitiveSelectors.map((selector) => page.locator(selector)),
    maskColor: "#202020",
  });

  return {
    url: page.url(),
    title: await page.title(),
    screenshotDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
    elements,
  };
}
