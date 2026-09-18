import { z } from "zod";

import type { CapabilityArtifact } from "../domain/contracts.js";

const StringInputsSchema = z.record(z.string(), z.string());

export type ReplayInputs = Readonly<Record<string, string>>;

export function validateReplayInputs(
  artifact: CapabilityArtifact,
  rawInputs: unknown,
): ReplayInputs {
  const inputs = StringInputsSchema.parse(rawInputs);
  const expectedNames = new Set(artifact.inputs.map((input) => input.name));

  for (const suppliedName of Object.keys(inputs)) {
    if (!expectedNames.has(suppliedName)) {
      throw new Error(`Unexpected capability input: ${suppliedName}`);
    }
  }

  for (const definition of artifact.inputs) {
    const value = inputs[definition.name];
    if (value === undefined) {
      throw new Error(`Missing capability input: ${definition.name}`);
    }

    if (definition.type === "string" && definition.pattern) {
      if (!new RegExp(definition.pattern).test(value)) {
        throw new Error(`Input ${definition.name} does not match its declared pattern`);
      }
    } else if (definition.type === "decimal" && !/^\d+\.\d{2}$/.test(value)) {
      throw new Error(`Input ${definition.name} must be a decimal with two places`);
    } else if (definition.type === "enum" && !definition.values.includes(value)) {
      throw new Error(`Input ${definition.name} must be one of its declared values`);
    }
  }

  return inputs;
}
