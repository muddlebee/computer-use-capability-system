# Assignment requirements - working notes

Source: `docs/assignment-brief.pdf`

## One-sentence objective

Build a thin but complete computer-use automation system in which an LLM discovers how to complete a task on a real UI, the system saves that successful run as a typed capability, and later invocations replay the capability deterministically without an LLM deciding each step.

## Required end-to-end thread

1. Accept a natural-language goal and target application.
2. Run a genuine LLM-driven observe -> decide -> act loop against a live UI.
3. Save the successful flow as a typed, versioned, reviewable artifact.
4. Replay the artifact with input parameters and no LLM in the decision loop.
5. Return typed outputs or a clearly classified non-success result.
6. Pause and transfer the same live session to a human when automation cannot safely continue.
7. Preserve structured logs and richer evidence for discovery and replay.

## Must-have requirement areas

- Goal-driven agent loop with stopping conditions.
- Structured artifact with typed inputs, typed outputs, ordered actions, robust target descriptions, and a success checkpoint.
- Deterministic replay with explicit handling for business outcomes, recoverable conditions, and hard failures.
- Configurable allowlists, conservative handling of risky actions, and redaction of secrets and sensitive data.
- Structured observability plus a screenshot, trace, or similar rich failure signal.
- Real pause/control-transfer/resume mechanism for human intervention on the same session.
- A credible design for other UI surfaces and reuse across tenant-specific variants.

## Required repository deliverables

- `/README.md`: setup, configuration, offline/no-live-service mode if applicable, and exact discovery/replay demo commands.
- `/REPORT.md`: approximately 1-3 pages using these exact headings:
  1. Architecture
  2. Artifact schema
  3. Determinism & error handling
  4. Heterogeneity & multi-tenant
  5. Escalation & handoff
  6. Safety
  7. Cuts
- `/evidence/`: an example artifact and logs from discovery and replay. Preferably include one replay with a business outcome or failure.
- Public Git repository for submission.

## Important distinctions

- Discovery is model-driven; replay is not.
- The artifact is a durable capability contract, not a raw model transcript.
- A business outcome such as "member not found" is not an infrastructure failure.
- The same browser/session must survive human handoff.
- A local demo application counts as a real UI surface, but at least one discovery run must genuinely use an LLM.

## Explicitly not required

- A real banking system.
- Production-scale queues, clusters, or tenant infrastructure.
- Full desktop support.
- A polished real-time co-browsing console.
- Many optional features; at most one or two stretch goals should be considered after the core is solid.

## Evaluation priority

1. System design and artifact/replay contracts.
2. Correct end-to-end behavior.
3. Runtime error handling and robustness.
4. Human escalation and same-session handoff.
5. Generalization to heterogeneous and multi-tenant environments.
6. Safety and data handling.
7. Code quality and communication.

## Initial implementation direction to validate together

- TypeScript on Node.js for strong shared types across the CLI, artifact schema, and replay engine.
- Playwright for a real browser session, screenshots/traces, deterministic actions, and manual headed-browser takeover.
- A deliberately awkward local "legacy banking" demo UI so the project can safely exercise search, business outcomes, confirmation, timeouts, and permissions without real credentials or PII.
- Zod plus JSON for a versioned, runtime-validated artifact contract.
- An LLM provider adapter for discovery only; deterministic replay must not depend on it.
- A small control-lease state machine (`AUTOMATION`, `HUMAN`, `PAUSED`) for explicit handoff ownership.

This direction is intentionally small: one coherent vertical slice is more valuable than broad infrastructure.
