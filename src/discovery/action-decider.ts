import { createHash } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import type { LlmConfig } from "../config/llm-config.js";
import {
  DiscoveryActionSchema,
  type DiscoveryAction,
  type DiscoveryRequest,
} from "../domain/contracts.js";
import { createOpenAICompatibleClient } from "../llm/openai-compatible-client.js";
import { redactUrlForEvidence } from "../security/redact.js";
import type { BrowserObservation } from "./browser-observer.js";
import { renderGoal } from "./browser-observer.js";

const RationaleProperty = {
  type: "string",
  description: "A short operational reason for this action, without hidden reasoning.",
} as const;

const SYSTEM_PROMPT =
  "You are the discovery controller for a regulated UI automation harness. Operate only the supplied page and visible catalog. Never submit, commit, delete, approve, or use a human-only/irreversible control. Prefer catalog element IDs over coordinates. For typing and selection, reference declared inputs instead of returning literal data. Extract every declared output before completing. If safe progress is impossible, escalate.";

const ACTION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click one visible catalog element.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          rationale: RationaleProperty,
        },
        required: ["elementId", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_input",
      description:
        "Fill a visible input with a declared capability input. Never provide the literal value.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          inputRef: { type: "string" },
          rationale: RationaleProperty,
        },
        required: ["elementId", "inputRef", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_input",
      description: "Select a declared capability input in a visible select control.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          inputRef: { type: "string" },
          rationale: RationaleProperty,
        },
        required: ["elementId", "inputRef", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_output",
      description: "Extract one declared output from a visible catalog element.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          outputName: { type: "string" },
          rationale: RationaleProperty,
        },
        required: ["elementId", "outputName", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_for_text",
      description: "Wait for a specific visible text state when the UI is still loading.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          rationale: RationaleProperty,
        },
        required: ["text", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "coordinate_click",
      description:
        "Fallback click for a visible control absent from the element catalog. Prefer click_element.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", minimum: 0 },
          y: { type: "integer", minimum: 0 },
          rationale: RationaleProperty,
        },
        required: ["x", "y", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description:
        "Declare success only after all outputs are extracted and the requested review state is visible.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          checkpointText: {
            type: "string",
            description: "Visible text that proves the requested final state.",
          },
          rationale: RationaleProperty,
        },
        required: ["checkpointText", "rationale"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description: "Stop because safe autonomous progress is not possible.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: ["stuck", "unsafe_action", "human_only_control"],
          },
          rationale: RationaleProperty,
        },
        required: ["reason", "rationale"],
        additionalProperties: false,
      },
    },
  },
];

const ElementActionArgumentsSchema = z.object({
  elementId: z.string().min(1),
  rationale: z.string().min(1).max(240),
});
const InputActionArgumentsSchema = ElementActionArgumentsSchema.extend({
  inputRef: z.string().min(1),
});
const ExtractActionArgumentsSchema = ElementActionArgumentsSchema.extend({
  outputName: z.string().min(1),
});
const WaitArgumentsSchema = z.object({
  text: z.string().min(1),
  rationale: z.string().min(1).max(240),
});
const CoordinateArgumentsSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  rationale: z.string().min(1).max(240),
});
const CompleteArgumentsSchema = z.object({
  checkpointText: z.string().min(1),
  rationale: z.string().min(1).max(240),
});
const EscalateArgumentsSchema = z.object({
  reason: z.enum(["stuck", "unsafe_action", "human_only_control"]),
  rationale: z.string().min(1).max(240),
});

export interface DiscoveryHistoryEntry {
  readonly turn: number;
  readonly action: DiscoveryAction["kind"];
  readonly result: string;
  readonly url: string;
}

export interface ActionDecision {
  readonly action: DiscoveryAction;
  readonly toolName: string;
  readonly responseId: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
  readonly trace: {
    readonly durationMs: number;
    readonly request: {
      readonly model: string;
      readonly systemPrompt: string;
      readonly userPrompt: string;
      readonly screenshotSha256: string;
      readonly screenshotDetail: "low";
      readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[];
      readonly toolChoice: "required";
      readonly maxCompletionTokens: number;
    };
    readonly response: {
      readonly id: string;
      readonly created: number;
      readonly model: string;
      readonly finishReason: string | null;
      readonly content: string | null;
      readonly toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
      readonly usage: OpenAI.CompletionUsage | undefined;
    };
  };
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    throw new Error("Model returned invalid JSON tool arguments");
  }
}

function actionFromToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): DiscoveryAction {
  if (toolCall.type !== "function") {
    throw new Error(`Unsupported model tool call type: ${toolCall.type}`);
  }

  const arguments_ = parseToolArguments(toolCall.function.arguments);
  switch (toolCall.function.name) {
    case "click_element": {
      const parsed = ElementActionArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "click", ...parsed });
    }
    case "type_input": {
      const parsed = InputActionArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "type", ...parsed });
    }
    case "select_input": {
      const parsed = InputActionArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "select", ...parsed });
    }
    case "extract_output": {
      const parsed = ExtractActionArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "extract", ...parsed });
    }
    case "wait_for_text": {
      const parsed = WaitArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({
        kind: "wait_for",
        condition: { kind: "text_present", text: parsed.text },
        rationale: parsed.rationale,
      });
    }
    case "coordinate_click": {
      const parsed = CoordinateArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "coordinate_click", ...parsed });
    }
    case "complete_task": {
      const parsed = CompleteArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({
        kind: "complete",
        checkpoint: { kind: "text_present", text: parsed.checkpointText },
        rationale: parsed.rationale,
      });
    }
    case "escalate_to_human": {
      const parsed = EscalateArgumentsSchema.parse(arguments_);
      return DiscoveryActionSchema.parse({ kind: "escalate", ...parsed });
    }
    default:
      throw new Error(`Model requested unknown discovery tool: ${toolCall.function.name}`);
  }
}

function buildObservationText(
  request: DiscoveryRequest,
  observation: BrowserObservation,
  history: readonly DiscoveryHistoryEntry[],
): string {
  const inputContract = request.inputs.map((input) => ({
    name: input.name,
    type: input.type,
    sensitive: input.sensitive,
    ...(input.type === "enum" ? { values: input.values } : {}),
  }));
  const outputs = request.outputs.map((output) => ({
    name: output.name,
    type: output.type,
    description: output.description,
  }));

  return [
    `Goal: ${renderGoal(request)}`,
    `Success: ${request.successDescription}`,
    `Current URL: ${redactUrlForEvidence(observation.url)}`,
    `Page title: ${observation.title}`,
    `Capability inputs: ${JSON.stringify(inputContract)}`,
    `Required outputs: ${JSON.stringify(outputs)}`,
    `Prior actions: ${JSON.stringify(
      history.map((entry) => ({
        ...entry,
        url: redactUrlForEvidence(entry.url),
      })),
    )}`,
    `Visible element catalog: ${JSON.stringify(observation.elements)}`,
    "Choose exactly one safe next action. Use inputRef/outputName exactly as declared.",
  ].join("\n\n");
}

export class OpenAICompatibleActionDecider {
  private readonly client: OpenAI;

  constructor(private readonly config: LlmConfig) {
    this.client = createOpenAICompatibleClient(config);
  }

  async decide(
    request: DiscoveryRequest,
    observation: BrowserObservation,
    history: readonly DiscoveryHistoryEntry[],
    signal?: AbortSignal,
  ): Promise<ActionDecision> {
    const userPrompt = buildObservationText(request, observation, history);
    const startedAt = performance.now();
    const completion = await this.client.chat.completions.create(
      {
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt,
              },
              {
                type: "image_url",
                image_url: { url: observation.screenshotDataUrl, detail: "low" },
              },
            ],
          },
        ],
        tools: ACTION_TOOLS,
        tool_choice: "required",
        max_completion_tokens: 400,
        store: false,
      },
      signal ? { signal } : undefined,
    );

    const toolCalls = completion.choices[0]?.message.tool_calls ?? [];
    if (toolCalls.length !== 1 || !toolCalls[0]) {
      throw new Error(`Model must return exactly one action; received ${toolCalls.length}`);
    }
    const toolCall = toolCalls[0];
    if (toolCall.type !== "function") {
      throw new Error(`Unsupported model tool call type: ${toolCall.type}`);
    }

    return {
      action: actionFromToolCall(toolCall),
      toolName: toolCall.function.name,
      responseId: completion.id,
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      },
      trace: {
        durationMs: Math.round(performance.now() - startedAt),
        request: {
          model: this.config.model,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          screenshotSha256: createHash("sha256")
            .update(observation.screenshotDataUrl)
            .digest("hex"),
          screenshotDetail: "low",
          tools: ACTION_TOOLS,
          toolChoice: "required",
          maxCompletionTokens: 400,
        },
        response: {
          id: completion.id,
          created: completion.created,
          model: completion.model,
          finishReason: completion.choices[0]?.finish_reason ?? null,
          content: completion.choices[0]?.message.content ?? null,
          toolCalls,
          usage: completion.usage,
        },
      },
    };
  }
}
