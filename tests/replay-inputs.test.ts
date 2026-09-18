import { describe, expect, it } from "vitest";

import { CapabilityArtifactSchema } from "../src/domain/contracts.js";
import { validateReplayInputs } from "../src/replay/inputs.js";

const artifact = CapabilityArtifactSchema.parse({
  schemaVersion: "1.0.0",
  capability: { id: "example", version: "1.0.0", summary: "Example" },
  target: {
    appId: "example-app",
    surface: "browser",
    entryUrl: "http://127.0.0.1:3000",
    allowedOrigins: ["http://127.0.0.1:3000"],
  },
  inputs: [
    { name: "memberId", type: "string", sensitive: true, pattern: "^M-[0-9]{4}$" },
    { name: "amount", type: "decimal", sensitive: false },
    {
      name: "reason",
      type: "enum",
      sensitive: false,
      values: ["duplicate_fee", "other"],
    },
  ],
  outputs: [
    { name: "result", type: "string", description: "Result", sensitive: false },
  ],
  steps: [
    {
      id: "step-1",
      kind: "wait_for",
      condition: { kind: "text_present", text: "Ready" },
      timeoutMs: 1000,
    },
  ],
  checkpoint: { kind: "text_present", text: "Ready" },
  businessOutcomes: [],
  policy: { allowedActions: ["wait_for"], irreversibleActions: "deny" },
});

describe("validateReplayInputs", () => {
  it("accepts inputs matching the artifact contract", () => {
    expect(
      validateReplayInputs(artifact, {
        memberId: "M-1001",
        amount: "12.50",
        reason: "duplicate_fee",
      }),
    ).toEqual({
      memberId: "M-1001",
      amount: "12.50",
      reason: "duplicate_fee",
    });
  });

  it("rejects missing, extra, and malformed inputs", () => {
    expect(() =>
      validateReplayInputs(artifact, {
        memberId: "bad",
        amount: "12.5",
        reason: "unknown",
        extra: "value",
      }),
    ).toThrow("Unexpected capability input: extra");
    expect(() =>
      validateReplayInputs(artifact, {
        memberId: "M-1001",
        amount: "12.50",
      }),
    ).toThrow("Missing capability input: reason");
  });
});
