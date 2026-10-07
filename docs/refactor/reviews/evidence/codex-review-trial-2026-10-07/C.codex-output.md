No supported correctness defects found in commit `8f3bd227`.

Checked against the parent, the binding spec §6 and current HANDOFF decisions:

- Guard order, refusal codes and exact texts.
- Terminal records, keys, timestamps, payloads and reconciliation data.
- Effect order, ownership checks and history cursor handling.
- Unknown outcomes, late evidence, cancellation and paused interruption.
- Owner callers, fixture coverage, incomplete merges and newly dead code.

The removed `outcome_unknown` check was unreachable: `terminalOutcomeOf` returns only known outcomes.

Static review only; no tests run and no files modified.