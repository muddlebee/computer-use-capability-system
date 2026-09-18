# Design Report

## 1. Architecture

The system has two deliberately different execution paths. **Discovery** is adaptive and model-driven; **replay** is deterministic and model-free. This separation is the main architectural decision.

The caller supplies a typed discovery request containing a natural-language goal template, target, parameter definitions, output definitions, runtime-condition policy, and stopping limits. A Playwright observer captures a masked screenshot and builds a catalog of visible controls and output cells. The OpenAI-compatible decision component sends that observation to the configured model and requires exactly one function tool call. The runner validates the tool arguments, enforces policy, acts on the live page, and records a semantic step. On success, it compiles the recorded steps into a versioned artifact independent of the raw model transcript.

Replay loads the artifact, validates invocation inputs, resolves each target using ordered locator strategies, executes the declared action, parses typed outputs, and checks the final checkpoint. It never initializes an LLM client. Runtime conditions are checked after navigation and after every step so a legitimate exception is handled before the next locator fails.

The target is a local server-rendered credit-union application. It intentionally uses tables, redirects, generated routes, and no test IDs. It offers five scenarios: happy path, member not found, session warning, permission denial, and supervisor authorization. This gives the implementation a controlled but realistic surface without using real credentials or customer data.

The code is a single process for clarity. The seams—provider config, observation/decision, artifact contract, locator resolution, evidence writer, and handoff controller—could be split into services later, but doing so now would add operational complexity without improving the vertical slice.

## 2. Artifact schema

The JSON artifact is a capability contract, not a recording transcript. It contains:

- schema version plus capability ID, version, and human-readable summary;
- app/surface identity, entry URL, allowed origins, and allowed route patterns;
- typed invocation inputs without current values;
- typed outputs, parsers, descriptions, and sensitivity metadata;
- ordered parameterized steps;
- one explicit success checkpoint;
- declared business outcomes;
- recoveries, hard failures, and human-intervention conditions;
- allowed action classes and irreversible-action policy.

Each action target has an ordered list of locator strategies. The compiler prefers semantic roles and names, then stable form attributes or row labels, and keeps CSS as a last resort. Table outputs use `row_label` instead of their current value; this both survives changing values and prevents data from becoming a locator. Replay requires each strategy to resolve uniquely and visibly before using it, then falls through to the next strategy. Coordinate actions are allowed during discovery only when hit-testing maps them back to a catalog element; the saved artifact remains semantic.

Step values are either an input reference or an explicit literal. Discovery tools accept `inputRef`, never a literal typed value, so invocation data is not copied into the artifact or model action transcript. The schema is defined in Zod and TypeScript types are inferred from it, preventing runtime and compile-time contracts from drifting.

Runtime policy is data rather than hard-coded page logic. For example, the artifact declares that “No member found…” is `member_not_found`, a session warning is recoverable by clicking a named control once, a permission message is a hard failure, and supervisor authorization requires a human. A different application can supply different conditions without modifying the executor.

## 3. Determinism & error handling

Replay performs no model call and has no open-ended reasoning. Inputs are rejected if missing, extra, malformed, or outside an enum. Navigation is constrained by origin and path allowlists. Every step has a timeout, target-resolution rules, action type, and parameter source. Extraction uses declared parsers (`text`, `currency`, `boolean`, or `last4`), and every declared output must be present before success. The final checkpoint is independently verified rather than inferred from the last click.

The result is a discriminated union:

1. `success`, with typed outputs and any recovery codes;
2. `business_outcome`, for expected domain results such as `member_not_found`;
3. `failure`, with a stable error code, step ID, expected state, observed state, and retryability.

Runtime conditions are evaluated before blind continuation. A declared recovery is bounded by `maxAttempts` and becomes a hard failure if exhausted. Permission denial is detected immediately after opening the account rather than surfacing later as a misleading missing-target error. Target resolution, checkpoint failure, timeouts, policy denial, and unexpected states have separate failure codes. JSONL evidence records step boundaries and recovery events without invocation values, while a masked screenshot provides the richer failure signal.

The current locator approach assumes a browser accessibility/DOM surface, but it does not depend on test IDs. The most likely drift failure—one locator becoming ambiguous—falls through to the next strategy and otherwise stops clearly. A production extension would add page fingerprints, per-strategy success telemetry, and artifact approval after repeated replay stability.

## 4. Heterogeneity & multi-tenant

The boundary to generalize is the surface adapter: observe current state, identify controls, execute a small action vocabulary, capture evidence, and resolve artifact targets. The current adapter uses Playwright, but the artifact describes intent (`click`, `type`, `select`, `extract`, `wait_for`) and ordered target descriptors rather than Playwright code. A legacy frameset adapter could add frame-path strategies; a desktop adapter could resolve accessibility roles, window identity, OCR anchors, or bounded coordinates while keeping the capability, input/output, checkpoint, result, and policy contracts.

For multi-tenant reuse, I would store a base artifact against a vendor-product family and version range, then layer tenant-specific target overrides rather than fork the entire flow. Routes and record IDs should be canonicalized into parameters. An app-instance profile would hold allowed origins, branding aliases, locale, and locator overrides. Before replay, a lightweight fingerprint—title, landmark controls, version string, and selected accessibility signatures—would choose the compatible variant. Unknown fingerprints would block unattended replay and request review rather than silently applying a near match.

Replay telemetry should be aggregated by artifact version, vendor version, tenant override, and locator strategy. That makes drift visible and supports promoting a successful override back into the shared base. Artifacts should be immutable once approved; changes produce a new semantic version with a reviewable diff and canary replays.

## 5. Escalation & handoff

An intervention rule identifies a visible blocking condition and the one human-only action it permits. When replay reaches supervisor authorization, it creates a typed intervention request containing capability, step, reason, redacted route, timestamp, and masked screenshot. Control changes from `automation` to `paused`, then to `human`.

The local operator console binds only to `127.0.0.1` at a random port and uses an unguessable per-intervention path. Its page shows the redacted state and one approved action. Selecting that action resolves the declared target and clicks it in the **same Playwright `Page` object**; no browser or session is recreated. Evidence records `control_transferred`, `human_action_started`, and `human_action_completed`. Control then returns to `automation`, the blocking condition is rechecked, and deterministic replay continues at the next step.

This is intentionally a minimal operator UI, but the control-transfer mechanism is real. In production the `HumanHandoff` interface would be backed by an authenticated queue and WebSocket/co-browsing service, with operator identity, RBAC, signed leases, audit retention, disconnect handling, and explicit cancel/resume outcomes. The single-owner state machine would remain the same and prevents automation and a human from acting concurrently.

## 6. Safety

Safety is enforced at several layers. The discovery prompt forbids submit, approve, delete, and other irreversible behavior, but prompt text is not treated as the boundary. Tool calls are schema-validated; element IDs and input/output references must exist; origins and route patterns are checked after every action; action types must be declared; and controls marked `irreversible` or `human-only` are blocked from autonomous execution. The final submit button is visible to the model yet cannot be clicked by discovery or replay. Human-only controls can be used only inside the handoff controller.

Secrets are loaded from ignored environment files and never included in public provider configuration. Error formatting redacts API-key and bearer-token patterns. Sensitive input values are replaced by references in the model prompt, sensitive fields and cells are masked in screenshots, catalog names for sensitive elements are replaced with a redaction marker, and record identifiers in evidence URLs are parameterized. Artifacts contain contracts and input references, not invocation values. Curated result evidence redacts sensitive outputs even though the live caller receives them.

The local demo uses synthetic data. The current redaction rules are defense in depth, not a complete DLP system; production would classify data at ingestion, encrypt evidence with tenant-scoped keys, apply retention limits, scan artifacts/logs before persistence, and prevent provider transmission for fields disallowed by policy.

## 7. Cuts

I prioritized a complete thin slice over platform breadth. I did not build desktop automation, distributed workers, a persistent artifact registry, SSO/RBAC, a production co-browsing console, or cross-tenant override storage. The operator console is local and single-intervention. Recovery rules are supplied as typed app knowledge rather than learned automatically from many failures. Discovery uses one model at a time and does not perform self-healing replay. The artifact has no approval lifecycle or replay-confidence score.

Next, I would add an explicit `SurfaceAdapter` package with a second mock desktop implementation, artifact draft/approved states, version fingerprints, and a small capability catalog API. After that I would run the artifact repeatedly across two branded variants, collect locator telemetry, and demonstrate a base artifact plus tenant override. I would not add unbounded LLM fallback to production replay; any assisted recovery would be single-step, policy-checked, separately approved, and captured as a proposed artifact revision.
