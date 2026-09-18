import { describe, expect, it } from "vitest";

import { redactSecrets, safeErrorMessage } from "../src/security/redact.js";

describe("redactSecrets", () => {
  it("removes raw and provider-masked API keys", () => {
    expect(redactSecrets("bad sk-proj-abc123_XYZ token")).toBe(
      "bad [REDACTED] token",
    );
    expect(redactSecrets("bad sk-proj-***************YKsA token")).toBe(
      "bad [REDACTED] token",
    );
  });

  it("removes bearer credentials", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("safely formats unknown errors", () => {
    expect(safeErrorMessage({ message: "not trusted" })).toBe("Unknown error");
  });
});
