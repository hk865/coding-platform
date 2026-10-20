# T run: wave 2, group T3 (lead, 2026-10-20)

- **Book:** `./.dsh-ref/t-book.md` (wave 2). **Items:** `./.dsh-ref/t-items-T3.md` (99 items). **Whitelist:** `./.dsh-ref/t-files-T3.txt` (91 files; book rule 1 for the one exception).
- **Base:** tag `w2-base` in this copy (= `d4c4cea`, wave 1 merged and reworked). Count lines and run the ledger against it. `git show w2-base:<path>` gives a file as it was before your work.
- **Other groups:** T1, T2 and T3 run at the same time in other copies. No file is on two whitelists. Items moved into your group because they edit the same files as yours: T2-001, T2-002, T2-005, T2-006, T2-007, T2-008, T2-009, T2-022, T2-024, T2-025, T2-028, T2-029, T2-030, T2-031, T2-032, T2-033.
- **Book-check answers** (`./.dsh-ref/t-bk-T1.out.md`, `t-bk-T2.out.md`, `t-bk-T3.out.md`): read only the rows and the "together or in order" tables for your item ids (`grep -n "T1-016" ./.dsh-ref/t-bk-T1.out.md`). Do not read them whole.
- **Rule sheet:** `./.dsh-ref/test-rule-sheet-v2.md` (binding), `test-rule-sheet-v1.md` where v2 refers to it.
- **Coordinator mode:** `./.dsh-ref/coordinator-mode.md`. Where it and this run file differ, this run file wins (at most two subagents at once).

## Two segments

- This run is the first segment. The runner stops it at a fixed time and then asks you, in the same Session, for your reply with a HANDOFF section (book §4.6). Commit what is done and green before that; never leave a unit half done if you can avoid it.
- A new Session continues after 18:00 from your reply and HANDOFF. Write the HANDOFF for someone who has not seen this Session.

## Work units (no two units edit the same file)

Give each subagent whole units; never let two subagents work in the same unit at once. A unit larger than about 12 items may be split by test file inside it, one part at a time, when the parts share only helpers: then only you edit those shared helpers (rule below). Start with the largest units.

1. 29 items, about 859 lines: T3-047, T3-048, T3-049, T3-050, T3-051, T3-052, T3-053, T3-054, T3-055, T3-056, T3-057, T3-058, T3-059, T3-060, T3-061, T3-062, T3-063, T3-064, T3-065, T3-067, T3-068, T3-069, T3-070, T3-071, T3-072, T3-073, T3-074, T3-075, T3-076.
   Files: `tests/data/S8A-file-graph.test.ts`, `tests/data/S8D-A20-python-imports.test.ts`, `tests/data/S8D-A21-python-config.test.ts`, `tests/data/S8D-A22-cpp-imports.test.ts`, `tests/data/S8D-A23-cpp-config.test.ts`, `tests/data/S8D-cpp-import-graph-script.test.ts`, `tests/data/S8D-exploration-regressions.test.ts`, `tests/data/S8D-formal-unresolved-reason.test.ts`, `tests/data/S8D-language-providers.test.ts`, `tests/data/S8D-observation-inventory.test.ts`, `tests/data/S8D-platform-fixture.test.ts`, `tests/data/S8D-python-import-graph-script.test.ts`, `tests/data/S8E-A07-git-inventory.test.ts`, `tests/data/S8E-A08-skip-list.test.ts`, `tests/data/S8E-A23-ignored-databases.test.ts`, `tests/data/S8E-A25-strict-capture.test.ts`, `tests/data/S8E-A26-git-classification.test.ts`, `tests/helpers/observation-source-fixture.ts`, `tests/helpers/workspace-tools-fixture.ts`.
2. 8 items, about 323 lines: T2-009, T2-024, T2-025, T2-028, T2-029, T2-030, T2-031, T2-032.
   Files: `tests/helpers/R4-history-turn-support.ts`, `tests/kernel/R4a-legacy-fixtures.ts`, `tests/runtime/R4b-session-input-boundaries.test.ts`, `tests/runtime/R4b-session-recovery.test.ts`, `tests/runtime/R4c-execution-history.test.ts`.
3. 3 items, about 185 lines: T2-001, T2-002, T2-022.
   Files: `tests/contracts/review-admission.test.ts`, `tests/runtime/K3-19-review-admission-pure.test.ts`.
4. 1 items, about 180 lines: T2-033.
   Files: `tests/runtime/R4c-kernel-history-range.test.ts`.
5. 1 items, about 164 lines: T3-101.
   Files: `tests/helpers/WP2-duties-fixture.ts`.
6. 1 items, about 135 lines: T3-089.
   Files: `tests/helpers/S2B-r3-r4-support.ts`, `tests/work-graph/S2B-r4-session-workspace.test.ts`.
7. 4 items, about 118 lines: T2-005, T2-006, T2-007, T2-008.
   Files: `tests/kernel/R4a-frozen-public.test.ts`, `tests/kernel/README.md`.
8. 3 items, about 99 lines: T3-037, T3-041, T3-042.
   Files: `tests/composition/R3c-R4b-platform.test.ts`, `tests/composition/W1-future-plan-platform.test.ts`.
9. 5 items, about 90 lines: T3-002, T3-003, T3-007, T3-008, T3-085.
   Files: `tests/app/A2-runtime-capabilities.test.ts`, `tests/app/K-R-runtime-capabilities.test.ts`, `tests/app/RL-34-wiring-resource-caps.test.ts`, `tests/app/RL-44-host-restart-resource-caps.test.ts`, `tests/helpers/RL-query-fixture.ts`, `tests/helpers/runtime-capabilities-fixture.ts`.
10. 3 items, about 82 lines: T3-018, T3-019, T3-020.
   Files: `tests/app/S8A-L8-capture-start.test.ts`, `tests/work-graph/S8A-L8-observation-state.test.ts`.
11. 1 items, about 62 lines: T3-021.
   Files: `tests/app/host-settings.test.ts`.
12. 3 items, about 57 lines: T3-045, T3-046, T3-066.
   Files: `tests/data/S8D-compact-snapshot.test.ts`, `tests/data/S8D-observed-v2-codecs.test.ts`.
13. 3 items, about 51 lines: T3-011, T3-012, T3-087.
   Files: `tests/app/S2B-41-decision54-backfill-bound.test.ts`, `tests/helpers/S2B-be2-reconcile-support.ts`.
14. 1 items, about 48 lines: T3-029.
   Files: `tests/business/K3-41-release-hold.test.ts`.
15. 1 items, about 42 lines: T3-043.
   Files: `tests/composition/W2-future-intent-platform.test.ts`.
16. 1 items, about 40 lines: T3-006.
   Files: `tests/app/R6-workbench.test.ts`, `tests/app/session-rendering.test.ts`.
17. 2 items, about 29 lines: T3-081, T3-082.
   Files: `tests/helpers/K3-35-required-review-block.ts`, `tests/helpers/K3-continuation-pure-fixture.ts`, `tests/runtime/K3-35-T-by-hand.test.ts`, `tests/runtime/K3-35-approved-methods-brief.test.ts`.
18. 1 items, about 27 lines: T3-016.
   Files: `tests/app/S8A-L8-auto-capture-gate.test.ts`, `tests/app/S8A-L8-host-close-restart.test.ts`.
19. 1 items, about 24 lines: T3-040.
   Files: `tests/composition/S8A-L8-pass-capture.test.ts`.
20. 1 items, about 23 lines: T3-017.
   Files: `tests/app/S8A-L8-auto-capture-host.test.ts`, `tests/app/S8A-L8-http-watermark.test.ts`.
21. 1 items, about 19 lines: T3-027.
   Files: `tests/business/A2-workflow-auto-rework.test.ts`, `tests/scenarios/C8-human-stop-respected.test.ts`.
22. 1 items, about 18 lines: T3-025.
   Files: `tests/app/ui-live.test.ts`, `tests/app/ui-refresh.test.ts`.
23. 1 items, about 17 lines: T3-035.
   Files: `tests/composition/A1-graph-session-platform.test.ts`.
24. 1 items, about 13 lines: T3-093.
   Files: `tests/helpers/S8A-L8-reminder-world.ts`.
25. 1 items, about 12 lines: T3-004.
   Files: `tests/app/A2-settings-automation.test.ts`.
26. 1 items, about 12 lines: T3-014.
   Files: `tests/app/S4C2-scribe-reminders.test.ts`.
27. 1 items, about 12 lines: T3-038.
   Files: `tests/composition/R3d-R3g-platform.test.ts`.
28. 1 items, about 12 lines: T3-039.
   Files: `tests/composition/S8A-L8-adoption-capture.test.ts`.
29. 1 items, about 12 lines: T3-083.
   Files: `tests/helpers/K3-padded-review-record.ts`.
30. 1 items, about 9 lines: T3-086.
   Files: `tests/helpers/RL-resource-caps-support.ts`.
31. 1 items, about 8 lines: T3-036.
   Files: `tests/composition/K-R-previous-turn-bounds.test.ts`.
32. 1 items, about 8 lines: T3-098.
   Files: `tests/helpers/WP1-handover-fixture.ts`.
33. 1 items, about 7 lines: T3-023.
   Files: `tests/app/orchestration-mechanism.test.ts`.
34. 1 items, about 7 lines: T3-099.
   Files: `tests/helpers/WP1-scenario-fixture.ts`.
35. 1 items, about 6 lines: T3-001.
   Files: `tests/app/A2-host-instance-lease.test.ts`.
36. 1 items, about 6 lines: T3-097.
   Files: `tests/helpers/WP1-entry-fixture.ts`.
37. 1 items, about 5 lines: T3-010.
   Files: `tests/app/S2B-35-activity-routes.test.ts`.
38. 1 items, about 5 lines: T3-013.
   Files: `tests/app/S2B-backfill-host.test.ts`.
39. 1 items, about 5 lines: T3-026.
   Files: `tests/app/ui-store.test.ts`.
40. 1 items, about 4 lines: T3-024.
   Files: `tests/app/support/S8A-L8-host.ts`.
41. 1 items, about 4 lines: T3-091.
   Files: `tests/helpers/S2C-K2-scenario-support.ts`.
42. 1 items, about 4 lines: T3-094.
   Files: `tests/helpers/S8D-platform-fixture.ts`.
43. 1 items, about 4 lines: T3-100.
   Files: `tests/helpers/WP1-units-fixture.ts`.
44. 1 items, about 4 lines: T3-104.
   Files: `tests/helpers/orchestration-fixture.ts`.
45. 1 items, about 3 lines: T3-088.
   Files: `tests/helpers/S2B-r2-calendar-reverify-support.ts`.
46. 1 items, about 2 lines: T3-092.
   Files: `tests/helpers/S4C2-note-card-fixture.ts`.

## Rules for this run

1. **Shared helpers inside a unit** (a `tests/helpers/*` file that more than one subagent needs): subagents use them but do not edit them. A subagent that needs a change there reports the exact addition. You add it (a new optional option whose default path stays as it is) and run its importers' tests.
2. **Memory (book rule 10):** `flock ./.typecheck.lock npm run typecheck`, by you only, never while a subagent runs tests. Subagents: **`npx vitest run --maxWorkers=2 <files>`, never more workers** (put this line in every subagent prompt). **At most two subagents at once.** Do not end your turn before every subagent has reported back.
3. **Subagent reports** are at most 40 lines: each item's result (`done`, `partial`, `BLOCKED`); the files changed; test pass/fail counts and failing test names (no logs); BLOCKED evidence as `file:line` plus one sentence (tamper-only, unreachable or missing entry point); any shared-helper addition it needs.
4. **Lean context.** Do not read the book-check answers or other groups' items whole; `grep -n` the lines you need. There is no `rg` here.

## Finish

- Checks, commit (`T T3 wave 2`), ledger (`./.dsh-ref/ledger-T3.txt` against `w2-base`) and shortstat: book §3.
- Reply: `./.dsh-ref/t-reply-T3.md` (book §4), plain Chinese.
