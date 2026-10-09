# Slice 5 round 2 — review of one fix area (read-only)

## What this checkout is
- `git log`: the branch base (74f059b4) plus ONE local commit "frozen s5r": the complete slice 5, the round-2 test
  table `docs/refactor/design/orchestration-2026-10/slices/slice-5-round2-TESTS.md` and 9 new frozen round-2 test files.
  On that commit the whole suite passes except exactly the RED rows of the table.
- On top, uncommitted (`git diff`, also `.codex-inputs/delta.patch`): ONE fix area written by another agent (DSH) from
  the brief `.codex-inputs/brief.md`. Its reply is `.codex-inputs/reply.md`. The lead ran the checks: see
  `.codex-inputs/checks.md`.
- Other areas are fixed in other copies at the same time; their RED rows still fail here, which is expected.

## Your job
Review ONLY the uncommitted change (`git diff`) against:
1. the brief's section 6 (items, write scope, interfaces that must not change) and sections 4–5 (rules);
2. the table's §0, §1 (T-R2-1..3 binding) and the rows the area names;
3. `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md`: §0 (overrides the rest), the lines the brief
   cites, and §8.2 (error-prone rules 1350–1370);
4. regressions ELSEWHERE: callers of every changed function (grep), other owners/readers that share the changed
   helpers, old (pre-slice) paths whose behaviour or public shapes must stay unchanged, module edges of
   `docs/refactor/module-target.json`, and state writes only through `src/core/work-graph/state/` constructors.

Look especially for: a read failure turned into absence (empty / `not_found` / no card); a business read before the
replay lookup of a retry; a pin taken from current state where a captured one is required; identity or fingerprint
that differs between a replay entry and the real write; a changed public DTO/receipt/event shape; a Workspace check
after a foreign read; behaviour that only satisfies the test's literal values (hard-coded ids, test-shaped branches);
two entrances that should share one rule but diverge.

You cannot run node or tests here. Do not change any file. Do not run git commands that change the index or HEAD.

## Answer (your final message)
1. VERDICT: `accept` / `accept with small fixes` / `reject` (a substantive defect).
2. FINDINGS, most severe first. Each: severity (blocker / major / minor), file:line, the spec line or table row or
   brief item it breaks, a concrete failure scenario (inputs/state → wrong output), and the direction of a fix in one
   sentence (no code).
3. ITEMS: per item id of the brief's section 6: done / not done / done differently, with file:line.
4. Anything the spec, table and brief do not determine that the change decided (UNSPECIFIED).
