# Task: slice 4A round 3 — the last four fixes; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec is
frozen; do not make design decisions. Where the spec and the books do not determine something, list it under
UNSPECIFIED in your reply instead of inventing behaviour.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
After starting a subagent, stay in your turn until it has finished and reported (wait with `sleep 120`, then
`list_agents`). The work is small: you may do it yourself, or with ONE subagent at a time. End your turn only after
section 4's checks and section 5's reply.

## 1. What this copy is

- **HEAD** = local commit "lead: 4A round 2 …" on top of round 1 (`9e91653`), `slice-base` and `slice-setup` (e8b3edae).
  `git diff HEAD` shows your work of this round.
- The books `./.dsh-ref/s4a-impl.md` (round 1: sections 3–5, P1–P14) and `./.dsh-ref/s4a-impl-2.md` (round 2:
  sections 3–5, R1–R13, and the items of its section 6) still bind, including the L-scope, the test rules (literal
  expectations, public interfaces only, no database reads, both backends) and the two permitted doubles (the commit gate
  and the read-fault double). Round 2's report: `./.dsh-ref/final-2.md`.
- A second model's quick check of round 2 (`./.dsh-ref/s4a-quick.out.md`) found everything fixed except the four points
  below. The TDD skill is in `./.dsh-ref/tdd/`. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`.

## 2. The four fixes (binding)

1. **`overQuota` in the write result = the committed population** (quick check must-fix 1; spec L7; round-2 R6). Keep
   R6's replacement projection for ADMISSION (which quota gates, which `reasons`). Compute the RETURNED `overQuota` — and
   the one stored with `NoteWritten` for replay (R4) — from the population as it is after THIS commit: add the new item
   if it is counted, subtract only the targets this commit actually supersedes (a note that ends `pending_review` or
   `staged` supersedes nothing yet). Rule: the write result's `overQuota` always equals `readNote(noteId).overQuota` read
   right after the commit. Code: `notes/note-service.ts` (~839 projection, ~883 result), compare
   `notes/note-read-model.ts` (~269).
   Tests (both backends, literal, in `S4A-note-write.test.ts` under `N-07`): at an exactly-full goal (goal quota reached
   by accepted items), (a) a structural replacement of one accepted item → `pending_review` with the same reasons as
   today, and its `overQuota` equals what `readNote` returns right after (compute the literal by hand from L7);
   (b) the same for an agent `repair` that ends `staged`; (c) a plain accepted replacement (supersedes now) → result and
   `readNote` agree. Each must be RED before the fix where it differs today.
2. **L2a's order** (quick check must-fix 2; spec §0.3 L2a, about line 79). Class 1: the complete input shape, including
   duplicate anchors; then class 2: existence of EVERY anchor (main and extra); then class 3: understanding
   compatibility, own-goal (`anchor_out_of_goal`) and scribe scope. Round 2's temporary exception (own-goal before class
   2, item 12a) no longer applies: the narrow reader `notes/note-anchor-facts.ts` exists. Code: `notes/note-service.ts`
   (~633). Test (`N-20`): an executor names a task that does not exist, in another goal → `{ status: 'rejected', code:
   'invalid', reason: 'anchor_not_found' }` with the draft (today `forbidden`/`anchor_out_of_goal`); and the reverse
   control — an existing task in another goal → `forbidden`/`anchor_out_of_goal`.
3. **Duty read failure in the scope facts → `unavailable`** (quick check should-fix 1; spec §4, "a read failure is never
   a definite answer"). `notes/scribe-scope.ts` (~195) must not drop a Session whose duty resolution is rejected or
   throws: the whole scope computation returns `unavailable`. A READY `'unknown'` duty stays as it is (R12). No test: the
   production resolver always answers ready, and injecting a resolver is not allowed (round-2 section 4); say in the reply
   where the change is.
4. **Malformed-anchor feedback keeps the field** (quick check should-fix 2; spec L2a "指出字段"). A class-1 anchor
   shape failure returns `{ code: 'invalid', reason: 'anchor_invalid: <field path>' }` (for example
   `anchor_invalid: extraAnchors[1].path`), distinct from class 2's `anchor_not_found`. Code: `notes/note-service.ts`
   (~341) and `notes/note-anchors.ts:anchorFormatProblem`. Test: extend `N-01 %s malformed shapes are refused invalid
   with the draft, never thrown` with literal reasons for two malformed anchors (main anchor and an extra anchor). Update
   only the assertions of round 1/2 tests that asserted `anchor_not_found` for a SHAPE failure; list each in the reply.

## 3. Rules

Test-first, one fix at a time (RED for the right reason, then the fix). No other behaviour changes. No real model calls,
no network, no git write commands, do not touch ports 3080, 3099, 44797. One vitest command at a time, `--maxWorkers=4`.
Throw-away probes under `./.dsh-scratch/`, deleted at the end.

## 4. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; all
`tests/work-graph/S4A-*.test.ts`, `tests/architecture/`, `tests/composition/platform.test.ts`. No full suite this round
(the lead runs it). `git status --short` only round 1/2 scope files.

## 5. Reply

FILES CHANGED (`git diff HEAD --stat`); per fix 1–4: the test name(s), the implementation file:symbol, RED→GREEN in
one line; the round 1/2 assertions you changed for fix 4; CHECKS with numbers; UNSPECIFIED (short).

Finish within 75 minutes.
