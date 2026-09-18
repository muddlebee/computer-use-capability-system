export type OutputParser = "text" | "currency" | "boolean" | "last4";

export function parseOutputValue(
  rawValue: string,
  parser: OutputParser,
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
      if (!match?.[1]) {
        throw new Error(`Could not parse last four characters: ${value}`);
      }
      return match[1];
    }
    default: {
      const exhaustive: never = parser;
      return exhaustive;
    }
  }
}
