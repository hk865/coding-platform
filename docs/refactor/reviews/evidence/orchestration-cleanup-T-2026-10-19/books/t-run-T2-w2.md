# T run: wave 2, group T2 (lead, 2026-10-20)

- **Book:** `./.dsh-ref/t-book.md` (wave 2). **Items:** `./.dsh-ref/t-items-T2.md` (62 items). **Whitelist:** `./.dsh-ref/t-files-T2.txt` (103 files; book rule 1 for the one exception).
- **Base:** tag `w2-base` in this copy (= `d4c4cea`, wave 1 merged and reworked). Count lines and run the ledger against it. `git show w2-base:<path>` gives a file as it was before your work.
- **Other groups:** T1, T2 and T3 run at the same time in other copies. No file is on two whitelists. Items moved into your group because they edit the same files as yours: T1-002, T1-016, T1-017, T1-018, T1-021, T1-022, T1-023, T1-061, T1-067, T1-070, T3-028, T3-030, T3-031, T3-032, T3-033, T3-034, T3-044, T3-077, T3-078, T3-079, T3-080, T3-084, T3-102, T3-103, T3-105.
- **Book-check answers** (`./.dsh-ref/t-bk-T1.out.md`, `t-bk-T2.out.md`, `t-bk-T3.out.md`): read only the rows and the "together or in order" tables for your item ids (`grep -n "T1-016" ./.dsh-ref/t-bk-T1.out.md`). Do not read them whole.
- **Rule sheet:** `./.dsh-ref/test-rule-sheet-v2.md` (binding), `test-rule-sheet-v1.md` where v2 refers to it.
- **Coordinator mode:** `./.dsh-ref/coordinator-mode.md`. Where it and this run file differ, this run file wins (at most two subagents at once).

## Two segments

- This run is the first segment. The runner stops it at a fixed time and then asks you, in the same Session, for your reply with a HANDOFF section (book §4.6). Commit what is done and green before that; never leave a unit half done if you can avoid it.
- A new Session continues after 18:00 from your reply and HANDOFF. Write the HANDOFF for someone who has not seen this Session.

## Work units (no two units edit the same file)

Give each subagent whole units; never let two subagents work in the same unit at once. A unit larger than about 12 items may be split by test file inside it, one part at a time, when the parts share only helpers: then only you edit those shared helpers (rule below). Start with the largest units.

1. 33 items, about 2409 lines: T1-002, T1-016, T1-017, T1-018, T1-021, T1-022, T1-023, T1-061, T1-067, T1-070, T2-018, T2-019, T2-040, T2-041, T2-042, T2-043, T2-044, T2-046, T3-028, T3-030, T3-031, T3-032, T3-033, T3-034, T3-044, T3-077, T3-078, T3-079, T3-080, T3-084, T3-102, T3-103, T3-105.
   Files: `tests/business/K3-15-ur3h.test.ts`, `tests/business/K3-17-goal-guard.test.ts`, `tests/business/K3-46-review-advance-failures.test.ts`, `tests/business/K3-UR7-crr-failed-set.test.ts`, `tests/business/K3-review-workflow-rows.test.ts`, `tests/composition/WP2-wiring.test.ts`, `tests/helpers/B2-401-world.ts`, `tests/helpers/B2-crr-world.ts`, `tests/helpers/K3-35-continuation-fixture.ts`, `tests/helpers/K3-blocked-command-fixture.ts`, `tests/helpers/K3-proposal-round.ts`, `tests/helpers/K3-review-card-fixture.ts`, `tests/helpers/S2A-window-fixture.ts`, `tests/helpers/S5-application-support.ts`, `tests/helpers/S5-decision-fixture.ts`, `tests/helpers/S5-goal-settings-support.ts`, `tests/helpers/S5R2-b-support.ts`, `tests/helpers/S5R2-c-support.ts`, `tests/helpers/S5R2-d-support.ts`, `tests/helpers/WP2-platform-support.ts`, `tests/helpers/executed-files-stub.ts`, `tests/runtime/B2-04-allowance.test.ts`, `tests/runtime/B2-09-allowance-crash.test.ts`, `tests/runtime/K3-B3-cancellation-cancelled.test.ts`, `tests/runtime/S5-user-message-tools.test.ts`, `tests/scenarios/B2-09b-allowance-crash.test.ts`, `tests/scenarios/K3-05-review-round.test.ts`, `tests/scenarios/K3-06-mixed-batch.test.ts`, `tests/scenarios/K3-08-wait-reply.test.ts`, `tests/scenarios/K3-09-restart-between-calls.test.ts`, `tests/scenarios/K3-10-review-round-cells.test.ts`, `tests/scenarios/K3-11-review-reasons-r2.test.ts`, `tests/scenarios/K3-13-two-commands.test.ts`, `tests/scenarios/K3-15-card-hold.test.ts`, `tests/scenarios/K3-16-approval-round.test.ts`, `tests/scenarios/K3-16-proposal-round.test.ts`, `tests/scenarios/K3-17-review-answer-shape.test.ts`, `tests/scenarios/K3-18-one-card.test.ts`, `tests/scenarios/K3-20-review-card-paging.test.ts`, `tests/scenarios/K3-26-inventory-scenarios.test.ts`, `tests/scenarios/K3-27-review-claim-close.test.ts`, `tests/scenarios/K3-28-attested-continuation.test.ts`, `tests/scenarios/K3-29-disposition-recovery.test.ts`, `tests/scenarios/K3-29-maintenance-review-run.test.ts`, `tests/scenarios/K3-29-recovery-continuation.test.ts`, `tests/scenarios/K3-29-recovery-round.test.ts`, `tests/scenarios/K3-29-startup-variants.test.ts`, `tests/scenarios/K3-37-stopped-review-round.test.ts`, `tests/scenarios/K3-42-truncated-command.test.ts`, `tests/scenarios/K3-42-unexpanded-r2.test.ts`, `tests/scenarios/K3-44-hold-restart.test.ts`, `tests/scenarios/K3-44-recovery-answers.test.ts`, `tests/scenarios/K3-45-review-incomplete-r2.test.ts`, `tests/scenarios/K3-R1-second-cleanup.test.ts`, `tests/scenarios/support/process-sandbox-standin.ts`, `tests/scenarios/support/review-card-round.ts`, `tests/scenarios/support/review-work-root.ts`, `tests/state/K3-14-conclusion-pure.test.ts`, `tests/work-graph/K3-11-review-reasons.test.ts`, `tests/work-graph/K3-13-two-items-owner.test.ts`, `tests/work-graph/K3-14-unknown-call-review-tool.test.ts`, `tests/work-graph/K3-18-review-card-queue.test.ts`, `tests/work-graph/K3-26-unknown-call-review-storage.test.ts`, `tests/work-graph/K3-45-review-incomplete.test.ts`, `tests/work-graph/K3-47-reader-facts.test.ts`, `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts`, `tests/work-graph/S5-decision-queue.test.ts`, `tests/work-graph/S5-goal-settings.test.ts`, `tests/work-graph/S5-notices.test.ts`, `tests/work-graph/UCR-settle-review.test.ts`, `tests/work-graph/WP2-context-extensions.test.ts`, `tests/work-graph/unknown-call-review-list.test.ts`.
2. 3 items, about 114 lines: T2-004, T2-012, T2-013.
   Files: `tests/helpers/S4B-text-search-support.ts`, `tests/record-store/S2A-ordered-lookup.test.ts`, `tests/record-store/S2C-count-lookup.test.ts`.
3. 1 items, about 98 lines: T2-047.
   Files: `tests/scenarios/K3-R1-file-change.test.ts`.
4. 2 items, about 79 lines: T2-035, T2-036.
   Files: `tests/runtime/S3-graph-tools.test.ts`.
5. 1 items, about 70 lines: T2-016.
   Files: `tests/helpers/SP-record-store-support.ts`, `tests/record-store/SP-literal-type.test.ts`, `tests/record-store/SP-lookup-index-migration.test.ts`.
6. 1 items, about 53 lines: T2-034.
   Files: `tests/runtime/S3-context-assembler.test.ts`.
7. 1 items, about 49 lines: T2-038.
   Files: `tests/runtime/S4C-note-tools.test.ts`.
8. 2 items, about 48 lines: T2-014, T2-015.
   Files: `tests/record-store/S4B-text-search.test.ts`.
9. 2 items, about 45 lines: T2-010, T2-011.
   Files: `tests/record-store/R3a-transaction-boundaries.test.ts`.
10. 1 items, about 45 lines: T2-039.
   Files: `tests/scenarios/C6-unrelated-adoption.test.ts`.
11. 1 items, about 38 lines: T2-023.
   Files: `tests/runtime/K3-15-blocked-sentence-pure.test.ts`, `tests/runtime/K3-continuation-review-note.test.ts`.
12. 2 items, about 31 lines: T2-026, T2-027.
   Files: `tests/runtime/R4b-session-operations.test.ts`.
13. 1 items, about 28 lines: T2-062.
   Files: `tests/state/control-intent-machine.test.ts`.
14. 1 items, about 26 lines: T2-048.
   Files: `tests/scenarios/K3-r1-seams.test.ts`.
15. 1 items, about 22 lines: T2-053.
   Files: `tests/scenarios/harness.test.ts`.
16. 1 items, about 19 lines: T2-037.
   Files: `tests/runtime/S4C-note-run-task-resolver.test.ts`.
17. 1 items, about 17 lines: T2-020.
   Files: `tests/runtime/C1-communication-tools.test.ts`.
18. 2 items, about 17 lines: T2-060, T2-061.
   Files: `tests/state/K3-B3-shared-rules-pure.test.ts`, `tests/state/command-rerun-request-pure.test.ts`, `tests/state/command-rerun-request.test.ts`.
19. 2 items, about 12 lines: T2-054, T2-055.
   Files: `tests/scenarios/harness.ts`.
20. 1 items, about 8 lines: T2-017.
   Files: `tests/record-store/lookup.test.ts`.
21. 1 items, about 8 lines: T2-056.
   Files: `tests/state/S1-anomaly.test.ts`.
22. 1 items, about 7 lines: T2-063.
   Files: `tests/state/k3-review-claim.test.ts`.

## Rules for this run

1. **Shared helpers inside a unit** (a `tests/helpers/*` file that more than one subagent needs): subagents use them but do not edit them. A subagent that needs a change there reports the exact addition. You add it (a new optional option whose default path stays as it is) and run its importers' tests.
2. **Memory (book rule 10):** `flock ./.typecheck.lock npm run typecheck`, by you only, never while a subagent runs tests. Subagents: **`npx vitest run --maxWorkers=2 <files>`, never more workers** (put this line in every subagent prompt). **At most two subagents at once.** Do not end your turn before every subagent has reported back.
3. **Subagent reports** are at most 40 lines: each item's result (`done`, `partial`, `BLOCKED`); the files changed; test pass/fail counts and failing test names (no logs); BLOCKED evidence as `file:line` plus one sentence (tamper-only, unreachable or missing entry point); any shared-helper addition it needs.
4. **Lean context.** Do not read the book-check answers or other groups' items whole; `grep -n` the lines you need. There is no `rg` here.

## Finish

- Checks, commit (`T T2 wave 2`), ledger (`./.dsh-ref/ledger-T2.txt` against `w2-base`) and shortstat: book §3.
- Reply: `./.dsh-ref/t-reply-T2.md` (book §4), plain Chinese.
