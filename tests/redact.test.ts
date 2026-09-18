import { describe, expect, it } from "vitest";

import {
  redactSecrets,
  redactUrlForEvidence,
  safeErrorMessage,
} from "../src/security/redact.js";

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

  it("parameterizes record identifiers and strips incidental query data", () => {
    expect(
      redactUrlForEvidence(
        "http://127.0.0.1:3000/servicing/members/M-1001/accounts/A-4401?scenario=supervisor&authorized=1",
      ),
    ).toBe(
      "http://127.0.0.1:3000/servicing/members/:memberId/accounts/:accountId?scenario=supervisor",
    );
  });
});
