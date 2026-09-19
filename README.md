# Computer-Use Capability System

A reference implementation of a computer-use capability system. An LLM discovers a workflow against a live, intentionally legacy-style servicing UI; the system compiles that run into a typed JSON capability; subsequent invocations replay the capability deterministically without an LLM.

The included workflow prepares a fee reversal and stops at the review screen. It deliberately never submits the reversal.

## What is implemented

- Real OpenRouter/OpenAI-compatible observe → decide → act discovery loop
- Screenshot plus visible-control catalog, with coordinate-click fallback
- Typed, versioned, parameterized capability artifact
- Deterministic Playwright replay with no model calls
- Stable locator fallbacks and typed output parsing
- Business outcome, recovery, and hard-failure handling
- Origin, route, action-type, and risky-control guardrails
- Redacted JSONL logs and masked screenshots
- Same-session human handoff through a minimal local operator console
- A server-rendered, table-heavy demo application with no test IDs

## Requirements

- Node.js 22+
- pnpm 10+
- An OpenRouter or OpenAI API key for discovery only

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

For OpenRouter, edit `.env`:

```dotenv
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=openai/gpt-5.6-luna
```

For direct OpenAI:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5.6-luna
```

Both providers use the official `openai` JavaScript SDK. OpenRouter is configured by changing the SDK base URL to its OpenAI-compatible endpoint. `.env` files are ignored by Git.

Verify provider connectivity:

```bash
pnpm provider:check
```

## Demo path

### 1. Start the target application

In terminal one:

```bash
pnpm demo:app
```

The app listens at `http://127.0.0.1:3000` and uses only synthetic training data.

### 2. Run real LLM discovery

In terminal two:

```bash
pnpm cua discover \
  --request demo/requests/prepare-fee-reversal.json \
  --output artifacts/prepare-fee-reversal.generated.json
```

Discovery uses the configured model to inspect the live page, choose one structured action at a time, and compile the successful run. Sensitive input values are referenced by name rather than emitted by the model. The generated artifact contains no invocation values.

### 3. Replay without an LLM

```bash
pnpm cua replay \
  --artifact artifacts/prepare-fee-reversal.generated.json \
  --inputs demo/inputs/happy.json
```

Expected result:

```json
{
  "status": "success",
  "recoveries": [],
  "outputs": {
    "reviewReference": "[REDACTED]",
    "accountLast4": "[REDACTED]",
    "amount": "12.50",
    "reviewStatus": "Ready for review"
  }
}
```

Run IDs and evidence-directory paths are omitted above for readability. Replay does not load provider configuration and makes no LLM request.

Every discovery and replay run stores:

- `result.json` with the structured final result (sensitive outputs are redacted on disk),
- `events.jsonl` with the step timeline,
- `index.html`, an easy-to-open gallery linking the result and every screenshot,
- `step-00-start.png`, followed by one masked screenshot for every completed step,
- `success.png`, `failure.png`, or `business-outcome.png` for the final state.

Discovery runs additionally store:

- `llm-call-trace.jsonl`: one complete, sanitized trace record per model call, including the exact system and user text sent, complete tool schemas, a hash and file reference for the masked screenshot, model configuration, timing, provider response, finish reason, tool calls, and usage;
- `model-tool-calls.jsonl`: a compact view containing the selected tool, validated arguments, operational rationale, redacted URL, response ID, and usage.

Neither file contains authorization headers, invocation values, or hidden chain-of-thought.

The CLI still returns full typed outputs to its caller; only persisted sensitive evidence is redacted.

The screenshot sequence plus `events.jsonl` is the full execution trace around those model calls. Playwright trace archives are intentionally not persisted because their DOM snapshots can silently retain input values even when screenshots are masked.

## Runtime-condition demos

### Known business outcome

```bash
pnpm cua replay \
  --artifact artifacts/prepare-fee-reversal.generated.json \
  --inputs demo/inputs/not-found.json \
  --entry-url 'http://127.0.0.1:3000/servicing/search?scenario=not-found'
```

Returns `business_outcome / member_not_found`, not a crash.

### Recoverable session warning

```bash
pnpm cua replay \
  --artifact artifacts/prepare-fee-reversal.generated.json \
  --inputs demo/inputs/happy.json \
  --entry-url 'http://127.0.0.1:3000/servicing/search?scenario=session-warning'
```

The replay clicks the declared `Continue session` recovery action once, resumes, and returns success with `recoveries: ["session_extended"]`.

### Hard permission failure

```bash
pnpm cua replay \
  --artifact artifacts/prepare-fee-reversal.generated.json \
  --inputs demo/inputs/happy.json \
  --entry-url 'http://127.0.0.1:3000/servicing/search?scenario=permission-denied'
```

Returns a structured `permission_denied` failure at `step-3` with expected and observed details.

### Same-session human handoff

```bash
pnpm cua replay \
  --artifact artifacts/prepare-fee-reversal.generated.json \
  --inputs demo/inputs/happy.json \
  --entry-url 'http://127.0.0.1:3000/servicing/search?scenario=supervisor' \
  --handoff
```

Replay pauses and prints an `intervention_ready` URL. Open it locally, inspect the redacted screenshot, and select **Perform approved action and resume**. The operator action is executed in the exact Playwright page that automation paused on; control then returns to replay at the next step.

## Evidence

Curated, redacted evidence is under [`evidence/example`](evidence/example):

- genuine OpenRouter discovery log and screenshot
- a masked screenshot for every discovery and replay step
- generated capability artifact
- successful deterministic replay
- member-not-found business outcome
- recovered session warning
- permission-denied hard failure
- same-session supervisor handoff

Raw local run directories are intentionally Git-ignored. See [`evidence/example/README.md`](evidence/example/README.md) for the evidence map.

## Development commands

```bash
pnpm typecheck
pnpm test
pnpm build
```

The integration tests exercise success, business outcome, recovery, permission failure, route policy, and automated use of the same operator-console seam.

## Project map

```text
src/config/       provider configuration
src/discovery/    observation, model decision, execution, compilation
src/domain/       Zod contracts and inferred TypeScript types
src/replay/       deterministic executor, locators, input validation
src/handoff/      same-session operator console and control transfer
src/evidence/     redacted evidence writer
src/demo-app/     hostile/legacy-style target application
artifacts/        reviewable capability JSON
evidence/example/ curated end-to-end evidence
```

See [`REPORT.md`](REPORT.md) for design decisions and trade-offs.
