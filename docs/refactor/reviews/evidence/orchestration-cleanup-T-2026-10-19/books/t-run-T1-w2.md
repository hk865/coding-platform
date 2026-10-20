# T run: wave 2, group T1 (lead, 2026-10-20)

- **Book:** `./.dsh-ref/t-book.md` (wave 2). **Items:** `./.dsh-ref/t-items-T1.md` (69 items). **Whitelist:** `./.dsh-ref/t-files-T1.txt` (89 files; book rule 1 for the one exception).
- **Base:** tag `w2-base` in this copy (= `d4c4cea`, wave 1 merged and reworked). Count lines and run the ledger against it. `git show w2-base:<path>` gives a file as it was before your work.
- **Other groups:** T1, T2 and T3 run at the same time in other copies. No file is on two whitelists. Items moved into your group because they edit the same files as yours: T2-003, T2-021, T2-045, T2-049, T2-050, T2-051, T2-052, T2-059, T3-090, T3-095, T3-096, T3-106.
- **Book-check answers** (`./.dsh-ref/t-bk-T1.out.md`, `t-bk-T2.out.md`, `t-bk-T3.out.md`): read only the rows and the "together or in order" tables for your item ids (`grep -n "T1-016" ./.dsh-ref/t-bk-T1.out.md`). Do not read them whole.
- **Rule sheet:** `./.dsh-ref/test-rule-sheet-v2.md` (binding), `test-rule-sheet-v1.md` where v2 refers to it.
- **Coordinator mode:** `./.dsh-ref/coordinator-mode.md`. Where it and this run file differ, this run file wins (at most two subagents at once).

## Two segments

- This run is the first segment. The runner stops it at a fixed time and then asks you, in the same Session, for your reply with a HANDOFF section (book §4.6). Commit what is done and green before that; never leave a unit half done if you can avoid it.
- A new Session continues after 18:00 from your reply and HANDOFF. Write the HANDOFF for someone who has not seen this Session.

## Work units (no two units edit the same file)

Give each subagent whole units; never let two subagents work in the same unit at once. A unit larger than about 12 items may be split by test file inside it, one part at a time, when the parts share only helpers: then only you edit those shared helpers (rule below). Start with the largest units.

1. 14 items, about 469 lines: T1-003, T1-004, T1-005, T1-007, T1-013, T1-038, T1-062, T1-063, T1-064, T1-065, T1-066, T3-095, T3-096, T3-106.
   Files: `tests/app/A2-continuation-projection.test.ts`, `tests/helpers/B2-execution-fixture.ts`, `tests/helpers/W2-whiteboard-fixture.ts`, `tests/helpers/task-claim-fixture.ts`, `tests/scenarios/A7-control.test.ts`, `tests/work-graph/A2-control-service.test.ts`, `tests/work-graph/A2-disposition-change.test.ts`, `tests/work-graph/A2-gate-chain-facts.test.ts`, `tests/work-graph/B2-execution-result.test.ts`, `tests/work-graph/S2C-lines-failure.test.ts`, `tests/work-graph/W1-future-plan.test.ts`, `tests/work-graph/W2-agent-whiteboard.test.ts`.
2. 1 items, about 241 lines: T2-045.
   Files: `tests/scenarios/K3-19-missing-read-no-round.test.ts`, `tests/scenarios/K3-19-review-unavailable.test.ts`.
3. 2 items, about 235 lines: T2-051, T2-052.
   Files: `tests/scenarios/S3-context-and-inputs.test.ts`, `tests/scenarios/S3-query-graph.test.ts`, `tests/scenarios/support/S3-host.ts`.
4. 2 items, about 215 lines: T1-033, T1-034.
   Files: `tests/work-graph/S1-codecs-indexes.test.ts`.
5. 4 items, about 186 lines: T1-008, T1-009, T1-010, T1-011.
   Files: `tests/work-graph/B2-11-expansion-levels.test.ts`, `tests/work-graph/B2-11-script-expansion.test.ts`, `tests/work-graph/B2-17-disposition-reads.test.ts`.
6. 4 items, about 143 lines: T2-003, T2-049, T2-050, T2-059.
   Files: `tests/helpers/S2C-K-scenario-support.ts`, `tests/scenarios/S2C-K-retired.test.ts`, `tests/scenarios/S2C-K-unknown-outcome.test.ts`, `tests/state/S2C-line-status.test.ts`.
7. 1 items, about 120 lines: T2-021.
   Files: `tests/runtime/K3-12-review-round-tools.test.ts`, `tests/runtime/K3-review-preparation.test.ts`.
8. 2 items, about 110 lines: T1-001, T1-039.
   Files: `tests/helpers/S2C-X-scale-fixture.ts`, `tests/work-graph/S2C-lines-scale.test.ts`.
9. 1 items, about 80 lines: T1-025.
   Files: `tests/work-graph/R3a-goal-replay-boundaries.test.ts`, `tests/work-graph/R3c-plan-adoption.test.ts`, `tests/work-graph/R3c-plan-entry.test.ts`, `tests/work-graph/R3c-task-relations.test.ts`, `tests/work-graph/R3d-fixture.ts`.
10. 1 items, about 80 lines: T1-026.
   Files: `tests/composition/R3e-completion-platform.test.ts`, `tests/work-graph/R3e-completion.test.ts`.
11. 1 items, about 80 lines: T1-069.
   Files: `tests/helpers/S4B-note-multi-scope-fixture.ts`, `tests/work-graph/material-readers.test.ts`.
12. 2 items, about 75 lines: T1-029, T1-030.
   Files: `tests/work-graph/R4b-session-boundaries.test.ts`.
13. 2 items, about 74 lines: T1-047, T1-053.
   Files: `tests/helpers/S4A-note-scope-fixture.ts`, `tests/work-graph/S4B-note-anchor-status.test.ts`, `tests/work-graph/S4B-note-symbol-recheck.test.ts`, `tests/work-graph/S4C2-U3.test.ts`.
14. 1 items, about 69 lines: T1-028.
   Files: `tests/work-graph/R3g-role-spec.test.ts`.
15. 1 items, about 61 lines: T1-032.
   Files: `tests/work-graph/R4c-execution-history-index.test.ts`.
16. 2 items, about 51 lines: T1-042, T1-043.
   Files: `tests/work-graph/S4A-note-history.test.ts`, `tests/work-graph/S4A-note-write.test.ts`.
17. 3 items, about 46 lines: T1-049, T1-050, T1-052.
   Files: `tests/work-graph/S4C-note-protection.test.ts`, `tests/work-graph/S4C-resolution-order.test.ts`, `tests/work-graph/S4C2-D-rows.test.ts`, `tests/work-graph/S4C2-D17.test.ts`.
18. 1 items, about 45 lines: T1-020.
   Files: `tests/work-graph/K3-16-proposal-round-fixture.test.ts`, `tests/work-graph/K3-16-second-unfinished-proposal.test.ts`.
19. 1 items, about 39 lines: T1-031.
   Files: `tests/work-graph/R4b-session-directory.test.ts`.
20. 1 items, about 38 lines: T1-057.
   Files: `tests/work-graph/S8A-L8-reminders-public.test.ts`, `tests/work-graph/S8A-L8-reminders-pure.test.ts`.
21. 2 items, about 35 lines: T1-014, T1-015.
   Files: `tests/work-graph/C1-session-mailbox.test.ts`.
22. 2 items, about 35 lines: T1-045, T1-046.
   Files: `tests/work-graph/S4B-memory-version-lists.test.ts`, `tests/work-graph/S8A-catalog-version-time.test.ts`.
23. 2 items, about 33 lines: T1-040, T3-090.
   Files: `tests/helpers/S2C-D-node-support.ts`, `tests/helpers/S2C-L-runs-support.ts`, `tests/work-graph/S2C-node-detail-anomalies.test.ts`, `tests/work-graph/S2C-node-detail-next-kinds.test.ts`.
24. 1 items, about 33 lines: T1-055.
   Files: `tests/work-graph/S4C2-project-set-shared.test.ts`.
25. 1 items, about 30 lines: T1-024.
   Files: `tests/work-graph/R3b-material-applicability.test.ts`.
26. 1 items, about 28 lines: T1-012.
   Files: `tests/helpers/B2-12-recognition-fixture.ts`, `tests/work-graph/B2-12-recognition-pure.test.ts`, `tests/work-graph/B2-12-recognition.test.ts`.
27. 1 items, about 23 lines: T1-051.
   Files: `tests/work-graph/S4C-project-understanding.test.ts`.
28. 1 items, about 21 lines: T1-054.
   Files: `tests/work-graph/S4C2-goal-triggers.test.ts`.
29. 1 items, about 20 lines: T1-037.
   Files: `tests/work-graph/S2C-lines-attention.test.ts`, `tests/work-graph/S2C-lines-tiers.test.ts`.
30. 1 items, about 18 lines: T1-044.
   Files: `tests/work-graph/S4B-memory-anchor-not-found.test.ts`, `tests/work-graph/S4B-memory-not-found.test.ts`.
31. 1 items, about 17 lines: T1-036.
   Files: `src/core/work-graph/views/activity-read-helpers.ts`, `tests/work-graph/S2B-r2-keyed-cap.test.ts`.
32. 1 items, about 17 lines: T1-048.
   Files: `tests/work-graph/S4B-note-budget-check.test.ts`, `tests/work-graph/S4B-note-freshness.test.ts`.
33. 1 items, about 12 lines: T1-058.
   Files: `tests/work-graph/S8A-file-layer.test.ts`.
34. 1 items, about 11 lines: T1-059.
   Files: `tests/work-graph/S4C-note-path-ownership.test.ts`, `tests/work-graph/S8A-path-ownership-dedupe.test.ts`.
35. 1 items, about 11 lines: T1-068.
   Files: `tests/work-graph/goal-independent.test.ts`.
36. 1 items, about 10 lines: T1-060.
   Files: `tests/work-graph/SP-memory-history-confirm.test.ts`.
37. 1 items, about 9 lines: T1-019.
   Files: `tests/work-graph/K3-15-disposition-effects.test.ts`.
38. 1 items, about 9 lines: T1-056.
   Files: `tests/work-graph/S5R2-queue-history.test.ts`.
39. 1 items, about 3 lines: T1-041.
   Files: `tests/work-graph/S2C-node-detail-executions.test.ts`, `tests/work-graph/S4C-node-notes.test.ts`.

## Rules for this run

1. **Shared helpers inside a unit** (a `tests/helpers/*` file that more than one subagent needs): subagents use them but do not edit them. A subagent that needs a change there reports the exact addition. You add it (a new optional option whose default path stays as it is) and run its importers' tests.
2. **Memory (book rule 10):** `flock ./.typecheck.lock npm run typecheck`, by you only, never while a subagent runs tests. Subagents: **`npx vitest run --maxWorkers=2 <files>`, never more workers** (put this line in every subagent prompt). **At most two subagents at once.** Do not end your turn before every subagent has reported back.
3. **Subagent reports** are at most 40 lines: each item's result (`done`, `partial`, `BLOCKED`); the files changed; test pass/fail counts and failing test names (no logs); BLOCKED evidence as `file:line` plus one sentence (tamper-only, unreachable or missing entry point); any shared-helper addition it needs.
4. **Lean context.** Do not read the book-check answers or other groups' items whole; `grep -n` the lines you need. There is no `rg` here.

## Finish

- Checks, commit (`T T1 wave 2`), ledger (`./.dsh-ref/ledger-T1.txt` against `w2-base`) and shortstat: book §3.
- Reply: `./.dsh-ref/t-reply-T1.md` (book §4), plain Chinese.
