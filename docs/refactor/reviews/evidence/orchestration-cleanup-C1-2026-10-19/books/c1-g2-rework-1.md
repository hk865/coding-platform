# C1 G2 rework 1 (lead, 2026-10-19)

Do not end your turn until every subagent you start has reported back. **This run is headless: when your turn ends, the whole run ends.** Finish within 45 minutes (the run stops at 55). Coordinator mode (`./.dsh-ref/coordinator-mode.md`); split by FILE so running subagents never edit the same file.

- **Memory (binding):** an earlier C1 run was killed at 8 GB because five subagents ran `tsc --noEmit` at the same time (about 1.8 GB each). Only you, the coordinator, run `npm run typecheck`, never two at once, and not while a subagent is running tests. Subagents only run their own dependent test files with `npx vitest run --maxWorkers=2`. Start at most three subagents at once.
- **Working root:** this copy at tag `c1-g2-r1` (G2's first run). Count lines against `c1-g2-r1`, and also report the total against `c1-g1`.
- **What you are fixing:** Codex reviewed G2 (`./.dsh-ref/c1-g2-review.out.md`). The book (`./.dsh-ref/c1-book.md`), G2's run file (`./.dsh-ref/c1-run-g2.md`) and G1's frozen interfaces (`./.dsh-ref/c1-g1-interfaces.md`) still apply; rule 1 (byte-identical behaviour) is the bar. Touch only G2's files.
- **Not to do:** the review's last row suggests reverting the pure call-site renames. The lead decided to **keep** them; do not revert renames.

## Items

1. **Read the Workspace pin once** (the review's 会出错 row): `configuration/line-settings-service.ts:62` reads `expected[0]` a second time after the shared check; the old code (`c1-g1` :89) used the pin it had already captured. Make the shared check in `configuration/workspace-settings-reads.ts` return the pin it captured; the decision service still wraps it as `null`, the line service as `{ pin }`; no second index read anywhere.
2. **Comments** (rule 5, SE-4):
   - `sessions/session-directory.ts:13` and `:939` still say a Module has no canonical provider and must be `unsupported`; `sessions/session-targets.ts:138` now checks a Module against the adopted architecture directory. Say what is true now (Task checked against the current Plan, Module against the current directory, WorkContext still unsupported) and keep the reason not to invent a link.
   - Remove group, round, rework and lead-date tags, including the ones this run added: `G1's map` / `never a G1 shared map` and the like in `sessions/session-links.ts:20`, `communication/decision-source-facts.ts:212`, `sessions/session-lifecycle.ts:784`, `sessions/session-directory.ts:114`, `sessions/session-lifecycle.ts:96`, `sessions/session-responsibility-service.ts:68`; `Lead decision L-a`; the lead date in `sessions/session-health.ts:14`. Keep the rules and reasons they carry (claim slots, a separate failure map, cancellation facts).
   - `sessions/session-directory.ts:338`: the long state-machine comment changed only in wording and line breaks. Restore it byte for byte from `c1-g1` (HANDOFF :125 keeps these comments as they are).
3. **The interface table, complete** (book §5): for each export of `sessions/trusted-context.ts`, `sessions/session-links.ts`, `configuration/workspace-settings-reads.ts` — full parameter types, return type, the types it defines, the original implementation (file:line at `c1-g1`), consumers. `identityKeyOf` returns the prefix plus a SHA, not a bare SHA.

## Checks before you finish

`npm run typecheck` (coordinator, once, at the end); `npm run check:architecture`; `npx vitest run --maxWorkers=2` on the test files that depend on the files you changed (the settings services and the Session services; not the whole closure) and `tests/architecture`. Production reach may still fail only for `okFalse`, `edgeDeclarationId`, `legacyDeclarationId`, `executionStoreFailureToRejection`, `ownerWriteStoreFailureToRejection`, `ownerReadStoreFailureToRejection` (other groups' consumers; this copy does not have them). No bubblewrap here: failures that only say `/usr/bin/bwrap` is missing are environmental; say so.

## Reply

A summary under 150 words, then: a per-item table (done / partly / left, why), the complete interface table, the tests run with results, and the changed lines (added + deleted against `c1-g2-r1`, net; and the total against `c1-g1`).
