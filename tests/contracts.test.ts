import { describe, expect, it } from "vitest";

import {
  CapabilityArtifactSchema,
  DiscoveryActionSchema,
  DiscoveryRequestSchema,
  RunResultSchema,
} from "../src/domain/contracts.js";

const discoveryRequest = {
  capabilityId: "prepare-fee-reversal",
  target: {
    appId: "legacy-credit-union",
    startUrl: "http://127.0.0.1:3000/servicing/search",
  },
  goalTemplate:
    "Prepare a fee reversal of {{amount}} for member {{memberId}} using {{reason}}.",
  inputs: [
    {
      name: "memberId",
      type: "string",
      currentValue: "M-1001",
      sensitive: true,
      pattern: "^M-[0-9]{4}$",
    },
    {
      name: "amount",
      type: "decimal",
      currentValue: "12.50",
      sensitive: false,
    },
    {
      name: "reason",
      type: "enum",
      currentValue: "duplicate_fee",
      sensitive: false,
      values: ["duplicate_fee", "incorrect_fee", "other"],
    },
  ],
  outputs: [
    {
      name: "reviewReference",
      type: "string",
      description: "Reference displayed on the review screen",
      sensitive: false,
    },
  ],
  successDescription: "The review screen is visible and no reversal was submitted.",
  maxSteps: 15,
} satisfies unknown;

describe("DiscoveryRequestSchema", () => {
  it("accepts the fee-reversal request", () => {
    expect(DiscoveryRequestSchema.parse(discoveryRequest).maxSteps).toBe(15);
  });

  it("requires every declared input in the goal template", () => {
    const invalid = { ...discoveryRequest, goalTemplate: "Prepare a fee reversal." };
    expect(() => DiscoveryRequestSchema.parse(invalid)).toThrow(
      "goal template must reference input",
    );
  });

  it("rejects enum values outside the declared set", () => {
    const invalid = {
      ...discoveryRequest,
      inputs: discoveryRequest.inputs.map((input) =>
        input.name === "reason" ? { ...input, currentValue: "unapproved" } : input,
      ),
    };
    expect(() => DiscoveryRequestSchema.parse(invalid)).toThrow(
      "currentValue must be one of its declared values",
    );
  });
});

describe("DiscoveryActionSchema", () => {
  it("accepts parameterized typing instead of literal data", () => {
    expect(
      DiscoveryActionSchema.parse({
        kind: "type",
        elementId: "e-member-id",
        inputRef: "memberId",
        rationale: "Enter the requested member identifier.",
      }),
    ).toMatchObject({ inputRef: "memberId" });
  });

  it("does not allow literal text in a type action", () => {
    expect(() =>
      DiscoveryActionSchema.parse({
        kind: "type",
        elementId: "e-member-id",
        text: "M-1001",
        rationale: "Enter the member identifier.",
      }),
    ).toThrow();
  });

  it("accepts a parameterized select action", () => {
    expect(
      DiscoveryActionSchema.parse({
        kind: "select",
        elementId: "e-reason",
        inputRef: "reason",
        rationale: "Select the requested reason code.",
      }),
    ).toMatchObject({ kind: "select", inputRef: "reason" });
  });
});

describe("CapabilityArtifactSchema", () => {
  it("accepts a minimal replayable artifact", () => {
    const artifact = CapabilityArtifactSchema.parse({
      schemaVersion: "1.0.0",
      capability: {
        id: "prepare-fee-reversal",
        version: "0.1.0",
        summary: "Prepare a fee reversal and stop at review.",
      },
      target: {
        appId: "legacy-credit-union",
        surface: "browser",
        entryUrl: "http://127.0.0.1:3000/servicing/search",
        allowedOrigins: ["http://127.0.0.1:3000"],
      },
      inputs: [
        {
          name: "memberId",
          type: "string",
          sensitive: true,
          pattern: "^M-[0-9]{4}$",
        },
      ],
      outputs: [
        {
          name: "reviewReference",
          type: "string",
          description: "Review reference",
          sensitive: false,
        },
      ],
      steps: [
        {
          id: "step-1",
          kind: "type",
          target: {
            key: "memberIdField",
            strategies: [{ kind: "label", label: "Member number" }],
          },
          value: { kind: "input", inputRef: "memberId" },
          timeoutMs: 5_000,
        },
      ],
      checkpoint: {
        kind: "text_present",
        text: "Fee Reversal Review",
      },
      businessOutcomes: [
        {
          code: "member_not_found",
          condition: { kind: "text_present", text: "No member found" },
        },
      ],
      policy: {
        allowedActions: ["click", "type", "extract", "wait_for"],
        irreversibleActions: "deny",
      },
    });

    expect(artifact.steps[0]?.kind).toBe("type");
  });
});

describe("RunResultSchema", () => {
  it("keeps a business outcome separate from failure", () => {
    const result = RunResultSchema.parse({
      status: "business_outcome",
      runId: "0ebef8db-7268-4e65-b9d8-349eff83141c",
      evidenceDirectory: "evidence/runs/example",
      recoveries: [],
      code: "member_not_found",
      details: {},
    });
    expect(result.status).toBe("business_outcome");
  });
});
