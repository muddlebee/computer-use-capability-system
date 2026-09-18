import { z } from "zod";

const IdentifierSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, "must be a lower-camel-case identifier");
const StepIdSchema = z.string().regex(/^step-[1-9][0-9]*$/);
const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

const StringInputDefinitionSchema = z.object({
    name: IdentifierSchema,
    type: z.literal("string"),
    currentValue: z.string().min(1),
    sensitive: z.boolean(),
    pattern: z.string().optional(),
  });

const DecimalInputDefinitionSchema = z.object({
    name: IdentifierSchema,
    type: z.literal("decimal"),
    currentValue: z.string().regex(/^\d+\.\d{2}$/),
    sensitive: z.boolean(),
  });

const EnumInputDefinitionSchema = z.object({
    name: IdentifierSchema,
    type: z.literal("enum"),
    currentValue: z.string().min(1),
    sensitive: z.boolean(),
    values: z.array(z.string().min(1)).min(1),
  });

export const InputDefinitionSchema = z.discriminatedUnion("type", [
  StringInputDefinitionSchema,
  DecimalInputDefinitionSchema,
  EnumInputDefinitionSchema,
]);

const ArtifactInputDefinitionSchema = z.discriminatedUnion("type", [
  StringInputDefinitionSchema.omit({ currentValue: true }),
  DecimalInputDefinitionSchema.omit({ currentValue: true }),
  EnumInputDefinitionSchema.omit({ currentValue: true }),
]);

export const OutputDefinitionSchema = z.object({
  name: IdentifierSchema,
  type: z.enum(["string", "currency", "boolean"]),
  description: z.string().min(1),
  sensitive: z.boolean(),
  parser: z.enum(["text", "currency", "boolean", "last4"]).optional(),
});

const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url_matches"),
    pattern: z.string().min(1),
  }),
  z.object({
    kind: z.literal("text_present"),
    text: z.string().min(1),
  }),
]);

const RuntimeRequestSchema = z
  .object({
    recoveries: z
      .array(
        z.object({
          code: z.string().regex(/^[a-z][a-z0-9_]*$/),
          condition: ConditionSchema,
          actionLabel: z.string().min(1),
          maxAttempts: z.number().int().min(1).max(3).default(1),
        }),
      )
      .default([]),
    hardFailures: z
      .array(
        z.object({
          code: z.enum(["permission_denied", "unexpected_state"]),
          condition: ConditionSchema,
        }),
      )
      .default([]),
    interventions: z
      .array(
        z.object({
          reason: z.enum(["stuck", "unsafe_action", "supervisor_authorization"]),
          condition: ConditionSchema,
          actionLabel: z.string().min(1),
        }),
      )
      .default([]),
  })
  .default({ recoveries: [], hardFailures: [], interventions: [] });

export const DiscoveryRequestSchema = z
  .object({
    capabilityId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    target: z.object({
      appId: z.string().regex(/^[a-z][a-z0-9-]*$/),
      startUrl: z.string().url(),
      allowedPathPatterns: z.array(z.string().min(1)).min(1).default(["^/"]),
    }),
    goalTemplate: z.string().min(1),
    inputs: z.array(InputDefinitionSchema).min(1),
    outputs: z.array(OutputDefinitionSchema).min(1),
    businessOutcomes: z
      .array(
        z.object({
          code: z.string().regex(/^[a-z][a-z0-9_]*$/),
          condition: ConditionSchema,
        }),
      )
      .default([]),
    runtime: RuntimeRequestSchema,
    successDescription: z.string().min(1),
    maxSteps: z.number().int().min(1).max(30).default(15),
    timeoutMs: z.number().int().min(10_000).max(600_000).default(120_000),
  })
  .superRefine((request, context) => {
    const inputNames = new Set<string>();
    for (const input of request.inputs) {
      if (inputNames.has(input.name)) {
        context.addIssue({
          code: "custom",
          path: ["inputs"],
          message: `duplicate input name: ${input.name}`,
        });
      }
      inputNames.add(input.name);

      if (!request.goalTemplate.includes(`{{${input.name}}}`)) {
        context.addIssue({
          code: "custom",
          path: ["goalTemplate"],
          message: `goal template must reference input: ${input.name}`,
        });
      }

      if (input.type === "enum" && !input.values.includes(input.currentValue)) {
        context.addIssue({
          code: "custom",
          path: ["inputs"],
          message: `${input.name} currentValue must be one of its declared values`,
        });
      }
    }

    const outputNames = new Set<string>();
    for (const output of request.outputs) {
      if (outputNames.has(output.name)) {
        context.addIssue({
          code: "custom",
          path: ["outputs"],
          message: `duplicate output name: ${output.name}`,
        });
      }
      outputNames.add(output.name);
    }
  });

const ActionBaseSchema = z.object({
  rationale: z.string().min(1).max(240),
});

export const DiscoveryActionSchema = z.discriminatedUnion("kind", [
  ActionBaseSchema.extend({
    kind: z.literal("click"),
    elementId: z.string().min(1),
  }),
  ActionBaseSchema.extend({
    kind: z.literal("type"),
    elementId: z.string().min(1),
    inputRef: IdentifierSchema,
  }),
  ActionBaseSchema.extend({
    kind: z.literal("select"),
    elementId: z.string().min(1),
    inputRef: IdentifierSchema,
  }),
  ActionBaseSchema.extend({
    kind: z.literal("extract"),
    elementId: z.string().min(1),
    outputName: IdentifierSchema,
  }),
  ActionBaseSchema.extend({
    kind: z.literal("wait_for"),
    condition: ConditionSchema,
  }),
  ActionBaseSchema.extend({
    kind: z.literal("coordinate_click"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  ActionBaseSchema.extend({
    kind: z.literal("complete"),
    checkpoint: ConditionSchema,
  }),
  ActionBaseSchema.extend({
    kind: z.literal("escalate"),
    reason: z.enum(["stuck", "unsafe_action", "human_only_control"]),
  }),
]);

export const LocatorStrategySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role"),
    role: z.enum([
      "alert",
      "button",
      "cell",
      "combobox",
      "dialog",
      "heading",
      "link",
      "row",
      "rowheader",
      "textbox",
    ]),
    name: z.string().min(1),
    exact: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("label"), label: z.string().min(1) }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1),
    exact: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("attribute"),
    name: z.string().regex(/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/),
    value: z.string().min(1),
  }),
  z.object({
    kind: z.literal("row_label"),
    label: z.string().min(1),
  }),
  z.object({ kind: z.literal("css"), selector: z.string().min(1) }),
]);

export const TargetDescriptorSchema = z.object({
  key: IdentifierSchema,
  strategies: z.array(LocatorStrategySchema).min(1),
});

const ValueSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), inputRef: IdentifierSchema }),
  z.object({ kind: z.literal("literal"), value: z.string() }),
]);

export const ArtifactStepSchema = z.discriminatedUnion("kind", [
  z.object({
    id: StepIdSchema,
    kind: z.literal("click"),
    target: TargetDescriptorSchema,
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
  z.object({
    id: StepIdSchema,
    kind: z.literal("type"),
    target: TargetDescriptorSchema,
    value: ValueSourceSchema,
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
  z.object({
    id: StepIdSchema,
    kind: z.literal("select"),
    target: TargetDescriptorSchema,
    value: ValueSourceSchema,
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
  z.object({
    id: StepIdSchema,
    kind: z.literal("extract"),
    target: TargetDescriptorSchema,
    outputName: IdentifierSchema,
    parser: z.enum(["text", "currency", "boolean", "last4"]),
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
  z.object({
    id: StepIdSchema,
    kind: z.literal("wait_for"),
    condition: ConditionSchema,
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
]);

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  capability: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: SemverSchema,
    summary: z.string().min(1),
  }),
  target: z.object({
    appId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    surface: z.literal("browser"),
    entryUrl: z.string().url(),
    allowedOrigins: z.array(z.string().url()).min(1),
    allowedPathPatterns: z.array(z.string().min(1)).min(1).default(["^/"]),
  }),
  inputs: z.array(ArtifactInputDefinitionSchema).min(1),
  outputs: z.array(OutputDefinitionSchema).min(1),
  steps: z.array(ArtifactStepSchema).min(1),
  checkpoint: ConditionSchema,
  businessOutcomes: z.array(
    z.object({
      code: z.string().regex(/^[a-z][a-z0-9_]*$/),
      condition: ConditionSchema,
    }),
  ),
  runtime: z
    .object({
      recoveries: z.array(
        z.object({
          code: z.string().regex(/^[a-z][a-z0-9_]*$/),
          condition: ConditionSchema,
          action: z.object({
            kind: z.literal("click"),
            target: TargetDescriptorSchema,
          }),
          maxAttempts: z.number().int().min(1).max(3),
        }),
      ),
      hardFailures: z.array(
        z.object({
          code: z.enum(["permission_denied", "unexpected_state"]),
          condition: ConditionSchema,
        }),
      ),
      interventions: z.array(
        z.object({
          reason: z.enum(["stuck", "unsafe_action", "supervisor_authorization"]),
          condition: ConditionSchema,
          humanAction: z.object({
            kind: z.literal("click"),
            target: TargetDescriptorSchema,
          }),
        }),
      ),
    })
    .default({ recoveries: [], hardFailures: [], interventions: [] }),
  policy: z.object({
    allowedActions: z
      .array(z.enum(["click", "type", "select", "extract", "wait_for"]))
      .min(1),
    irreversibleActions: z.literal("deny"),
  }),
});

const RunMetadataSchema = z.object({
  runId: z.string().uuid(),
  evidenceDirectory: z.string().min(1),
  recoveries: z.array(z.string()),
});

export const RunResultSchema = z.discriminatedUnion("status", [
  RunMetadataSchema.extend({
    status: z.literal("success"),
    outputs: z.record(z.string(), z.unknown()),
  }),
  RunMetadataSchema.extend({
    status: z.literal("business_outcome"),
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    details: z.record(z.string(), z.unknown()),
  }),
  RunMetadataSchema.extend({
    status: z.literal("failure"),
    code: z.enum([
      "target_not_found",
      "checkpoint_failed",
      "permission_denied",
      "human_intervention_required",
      "timeout",
      "policy_denied",
      "unexpected_state",
    ]),
    stepId: StepIdSchema.optional(),
    expected: z.string().min(1),
    observed: z.string().min(1),
    retryable: z.boolean(),
  }),
]);

export const InterventionRequestSchema = z.object({
  runId: z.string().uuid(),
  capabilityId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  stepId: StepIdSchema,
  reason: z.enum(["stuck", "unsafe_action", "supervisor_authorization"]),
  screenshotPath: z.string().min(1),
  currentUrl: z.string().url(),
  requestedAt: z.string().datetime(),
  controller: z.literal("human"),
});

export const ControlStateSchema = z.enum([
  "automation",
  "paused",
  "human",
]);

export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;
export type DiscoveryAction = z.infer<typeof DiscoveryActionSchema>;
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
export type ArtifactStep = z.infer<typeof ArtifactStepSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
export type InterventionRequest = z.infer<typeof InterventionRequestSchema>;
export type ControlState = z.infer<typeof ControlStateSchema>;
