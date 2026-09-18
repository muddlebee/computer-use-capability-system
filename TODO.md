# TODO

Last audited against `docs/assignment-brief.pdf` on 2026-09-19.

## Current status

The required end-to-end vertical slice is complete: a genuine LLM discovery run drives the live demo UI, emits a typed capability, and the capability replays without an LLM. The repository also demonstrates business outcomes, bounded recovery, hard failure, safety enforcement, evidence capture, and same-session human handoff.

## Before submission

- [ ] **Rotate the OpenRouter API key.** It is not in Git or evidence, but it was pasted into a chat and should be replaced before final submission.
- [ ] **Run a fresh-clone smoke test.** Clone the public repository into a new directory and follow `README.md` exactly: install dependencies and Chromium, configure a new key, start the demo app, run discovery, then replay the generated artifact.
- [ ] **Send the public repository URL from the application email address:** `https://github.com/muddlebee/computer-use-capability-system`.

## Recommended implementation hardening

- [ ] **Route discovery-time escalation through the human-handoff controller.** The model can currently choose `escalate_to_human`, but discovery records a failure rather than pausing the same session in the operator console. Replay-time supervisor handoff already works end to end.
- [ ] **Record operator identity and the exact approved target in handoff evidence.** The current evidence records control transfer and action completion; production audit evidence should also identify the authenticated operator and target key.
- [ ] **Add automated coverage for the full LLM-call trace writer.** The live example verifies all 13 trace records and screenshots, while the offline suite currently focuses on replay, policy, error handling, and handoff.

## Optional polish

- [ ] Record a short two-to-three-minute demo video showing discovery, generated artifact, deterministic replay, one exceptional state, and human handoff.
- [ ] Add a small GitHub Actions workflow for `pnpm typecheck`, `pnpm test`, and `pnpm build` without requiring an API key.
- [ ] Rehearse the interview walkthrough: problem, discover-once/replay-many decision, artifact schema, runtime taxonomy, safety boundary, and handoff seam.

## Assignment requirement audit

- [x] **3.1 Goal-driven agent loop:** typed goal and target, live observe/decide/act loop, maximum steps, timeout, and model escalation action.
- [x] **3.2 Structured artifact:** versioned JSON capability with typed inputs and outputs, ordered actions, locator fallbacks, policies, and checkpoint.
- [x] **3.3 Deterministic replay:** no model calls; typed outputs; business outcome, bounded recovery, and hard-failure result classes.
- [x] **3.4 Safety and policy:** origin, route, and action allowlists; irreversible and human-only controls; secret and sensitive-data redaction.
- [x] **3.5 Evidence and observability:** event logs, complete sanitized LLM call traces, model-call observation screenshots, per-step replay screenshots, results, and failure evidence.
- [x] **3.6 Human handoff:** intervention request, explicit control transfer, same Playwright session, operator action, resume, and audit events.
- [x] **3.7 Heterogeneity and scale:** browser implementation plus documented surface-adapter and multi-tenant specialization design.
- [x] **Public repository:** `https://github.com/muddlebee/computer-use-capability-system`.
- [x] **README:** setup, provider configuration, exact discovery/replay commands, exceptional-state demos, and offline replay path.
- [x] **REPORT:** all seven required headings; approximately 1,555 words.
- [x] **Evidence:** generated artifact, genuine OpenRouter discovery, happy replay, not-found outcome, session recovery, permission failure, and human handoff.
- [x] **Validation:** 31 tests, TypeScript typecheck, production build, Git secret scan, and persisted-evidence sensitive-value scan.
