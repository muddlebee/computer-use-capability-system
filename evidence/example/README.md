# Curated evidence

All data is synthetic. Screenshots mask member, account, balance, reference, and amount fields. Sensitive outputs in persisted `result.json` files are replaced with `[REDACTED]`; the live replay caller still receives the typed values.

| Directory | What it proves |
| --- | --- |
| `discovery/` | Genuine OpenRouter-driven observe/decide/act run completed against the live UI. |
| `capability-artifact.json` | Typed artifact produced by that discovery run. |
| `replay-happy/` | Model-free replay reached and verified the review checkpoint. |
| `replay-not-found/` | Missing member was returned as a business outcome. |
| `replay-recovery/` | A session warning was recovered once and replay continued. |
| `replay-permission-denied/` | Permission denial stopped with a structured hard failure. |
| `replay-human-handoff/` | Automation paused, emitted an intervention, ceded the same session, and resumed after the operator action. |

Each run directory contains JSONL events, a structured result, and at least one redacted screenshot. The handoff directory also contains the typed intervention request and the screenshot presented to the operator.
