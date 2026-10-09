# Slice 5 round 2 — Stage Docs (lead notes)

Started 2026-10-09 23:01:44 (Git Bash clock). Real worktree, branch feat/reliability-and-structure, HEAD a7cafccc (slice 5 merged), clean.

## 0. Facts checked before writing
- Remote feat/orchestration-slices = 5ba99cc7 (run 4 push); local next-main checkout at 5ba99cc7. a7cafccc not pushed.
- Run 4 Docs (5ba99cc7) already wrote the decision-47 section of the slice-5 evidence fully (d47/), so only round 2 is new.
- Frozen sha256 vs HEAD blobs: 33/34 equal; tests/helpers/S5R2-c-support.ts differs by exactly one byte (CR at byte 627, T-I-1). frozen-tests 8/9.
- check:architecture on HEAD (main-s5r2-full-1.log): WorkGraph 135 files; submodule edges 49/53 used; unused: tasks->architecture, views->communication, views->configuration, views->evidence. New vs 6180adfc (47): configuration->state, views->state. +20 WorkGraph files (model 1, state 3, persistence 1, configuration 2, tasks 5, communication 3, views 5).
- tests.md "Final: 39 pass, 22 fail" is a slip: 61 tests = 41 pass / 20 fail (s5r-new2 A/C/D 56: 39/17; b2 run B 5: 2/3); whole suite frozen run s5r-full2: 20 failed = the 20 RED runs.
- Final Codex review (rvfinal) verdict was reject (major: notices truncation; minor: candidate overflow incomplete/unavailable); LR4/LR5 applied after it, not re-reviewed by Codex and not covered by a test. LR1 exact-5000 boundary is not covered by a test either (R2A08 covers exactly 200 Goals only).
- R2D03 / T-R2-1c: runtime tool still pre-reads first (frozen R2D03 counts it); on a read failure it replays. SPEC §8.2:1366 says replay before reads; outcome is the original receipt either way. Recorded as lead choice.

## 1. Plan
Evidence README (title, top update, new round-2 section, r2/ artefacts); STATE-MACHINES-SPEC §17.4; IMPLEMENTED-CAPABILITIES (top paragraph, WG38-WG44, RT17, §7 bullet); DESIGN §8.2 (bullet + slice 6 row item); slices/README (dated section); DSH-WORKFLOW §6.10 (round-3 measurements, notes outside Temp); module-dag §6 (slice-5 note: configuration->state now used); STATUS (rewrite), HANDOFF (one appended block), AGENTS.md (批次状态 sentence). Codex review (high, read-only) on a new clone. Commit.

## 2. Written (23:02–23:20)
- Evidence README: title, top update, "结果" marked as 10-09 morning; new section "2026-10-09 夜：决定 48 的一轮（先补测试），验收、合入" (steps 0–5, lead decisions, leftovers, DSH/Codex/lead tables, checks, Temp line); r2/ listing. r2/ = 58 files (books 4, codex/tests 11, codex/review 8, dsh 4x4 + usage, notes 3, checks 12, fixes 4), ~416 KB. Added r2/checks/frozen-full-failed.txt (extracted from s5r-full2-full.json: 279/5974, 5954 pass, 20 failed = the RED runs) and head-architecture.txt (lines 8-32 of main-s5r2-full-1.log).
- STATE-MACHINES-SPEC §17 intro note + new §17.4 (23 rows -> state file -> service file -> main cases incl. R2). S5-MSG-06 has no direct answer-refusal test (only DQ07 read side) — written as such.
- IMPLEMENTED-CAPABILITIES: top paragraph; table WG38–WG44; RT17; §7 Workflow bullet. Workflow gates only system_requeue/auto_reverify (removed "refine" claim after grep).
- DESIGN §8.2 bullet + slice 6 row item; slices/README dated section; DSH-WORKFLOW §6.10 round-3 measurements + Temp lesson; module-dag §6 note (49 edges, 135 files); STATUS rewritten parts; HANDOFF appended block; AGENTS.md 批次状态 sentence; wiring-1 evidence one dated note (6 overlap files, context-assembler/context-input not touched by slice 5).
- Link check script (scripts/linkcheck.py): all new links/anchors resolve; 23 pre-existing misses (HTML anchors, historical paths) untouched.
- docs-v1.patch (68 paths at that time; wiring note added after) sha256 e5bf5671…; backup ~/dsh-work/lead-backup/docs-v1.patch.
- Codex docs review s5r2-docs-rv1 (high, read-only, clone D:/cxt/s5r2-docs-rv1 = a7cafccc + docs commit 5c242648) started 23:21.

## 3. Codex docs review s5r2-docs-rv1 (23:21:11–23:24:46, 3.6 min; high, read-only, newest codex.exe 9691020b…; input 1,324,207 (cached 1,223,936) / output 5,159)
- Verdict "fix needed", 2 minor findings, both verified TRUE and fixed:
  1. evidence README said every Codex group wrote one test file; group D wrote two (agent-application + driver-safe-point) -> now "A、B、C 各一个，D 两个，共 5 个测试文件、4 个辅助文件".
  2. evidence README referenced r2/notes/docs.md which was not in the tree -> this file is copied into r2/notes/docs.md before the commit; listing updated.
- It checked: numbers vs notes/checks/run.json/usage/commit body; all 23 §17.4 rows, cited test ids, WG38–WG44/RT17 files, symbols, routes, tools; cross-doc consistency; stale current-state statements (none); added links/anchors.
- Added to the evidence Codex table (row "审本次文档（high）"); totals now 11 Codex runs, input 35.18M (cached 33.39M), output 162.9K. Review instructions/result copied to r2/codex/review/DOCS-REVIEW.md, out-s5r2-docs-rv1.md. Not re-reviewed after the two one-line fixes.
- Also added after the patch for review: wiring-1 evidence dated note (no other change).

## 4. Measurement (this stage)
- Lead: 23:01:44 → ~23:30 (~29 min wall), ~135 tool calls; waiting: Codex 3.6 min (overlapped with self-review: STATUS diff read, line-ending check, wiring evidence note, code-claim greps). Working ~25 min. Commit right after this note.
- DSH 0 runs. Codex 1 run (docs review, above). No product model; ports 3080/3099/44797 untouched; no test runs (docs only).
