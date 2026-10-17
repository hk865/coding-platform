# Task: slice 4C-2 session A rework — the review's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once — strictly**, every vitest command `--maxWorkers=2`.
**Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items.

## 1. What this copy is

- Tag `s4c2-a` (HEAD) = your session-A build (`./.dsh-ref/s4c2a-impl.md`, your reply `./.dsh-ref/s4c2a-final.md`).
- Codex reviewed it read-only (`./.dsh-ref/s4c2a-review.out.md`, Chinese, 9 must-fix). A Claude subagent verified every
  item in the code (`./.dsh-ref/verify-s4c2a.md`: verdicts, file:line, minimal examples, a recommended fix and the
  tests per item, plus four things Codex missed). **The verifier's fixes and tests are binding, with the lead's rulings
  in section 2 on top; where section 2 differs, section 2 wins.**

## 2. Lead rulings (binding)

1. **Item 1 (stage row; rows without an understanding):** the verifier's fix. The wording of a row with no current
   understanding: `目标 <goalId>：还没有当前理解` and `阶段 <stageId>：还没有当前理解`. The reminder line stays
   derived from `status.updateDue === true`.
2. **Items 2 and 3, and the verifier's "missed 1":** the verifier's fixes. The conclusion/warning rule of L20 applies to
   the Goal card's understanding rows too, the project row included: an understanding that is not `currentEligible`
   renders one warning line with the existing general warning wording and no body.
3. **Item 4:** the verifier's fix. Every rendered note line carries the note id and version:
   `<label>（<noteId> v<version>）`; an understanding row `目标 <goalId> 当前理解（<noteId> v<version>）：<conclusion>`
   (stage and project likewise). One `noteSourcesOf` for Work and Query. Never use a pointer revision as a version.
4. **Item 5:** the verifier's fix (`foldInputOf`, UTF-8 byte order with `Buffer.compare`), with both literal tests.
5. **Item 6:** the verifier's fix (the ledger cursor read on `NoteScribeTodoPort`, the per-workspace memory, the
   reminder's own period on the injected clock, `pendingSend` retried). **The input-consumer throttle stays on the wall
   clock** (`host.ts` ~1258–1259): NE6 does not observe it and the AG2b fixtures stamp records with a fixed clock; the
   lead post-notes §11.5's "时间" bullet to name only the attention timestamp and the reminder gate.
6. **Item 7:** the verifier's fix (the last sent reminder's ref per recipient, checked with `readMessage` +
   `inputCompleted`; when that memory is empty, page the recipient's whole inbox once; any read failure = unknown, send
   nothing this pass and leave `computedAtCursor` unset). The body marker stays, limited to Host notify messages.
7. **Items 8 and 10:** the verifier's fixes (one plan window per goal per call, the resolver that takes the read plan,
   one batched pointer read and one batched head read seeded into the check; one shared internal reader
   `readGoalUnderstandingAnchors` in `note-update-due.ts` used by the to-dos and the view; `eligibleNorms`; the
   exported `stageIdOf`, no copy). **`NoteUpdateDuePort` and `readUpdateDue` are deleted** — they have no production
   caller (the assembly gets update-due through the check, U-3; the Host through `NoteScribeTodoPort`, U-4); the lead
   post-notes §11.5. Report the production line count before and after.
8. **Missed 2 (`immediate` ignores the baseline):** `immediate` = an unclaimed `archive:` trigger whose `at` is after
   the goal anchor's baseline. Test: archive at T, unclaimed, a goal understanding written after T → no message.
9. **Missed 3 (Query assembly reads the general set):** skip the related scope and the general part when
   `includeInputs === false`; Query gets understanding and norms only (C-04).
10. **Item 9, tests:** the verifier's list (NE5 through `prepareExecution` on memory and SQLite; M-12 over the public
    note service and real plan/run records, no `vi.mock` of the readers; D-03 on a real Host with the real sender and
    persisted messages, the literal request id, the restart case, the immediate send and its claimed counterpart, the
    real recipient resolver; the cursor/period/retry counts of item 6; the counting wrapper for item 8's read counts).
    Keep the existing unit tests that still hold; replace the bypassing ones.
11. **`WP2-wiring.test.ts` ~537:** after item 1, recompute F06's expected reminder count by hand (the goal row with
    `updateDue: true`, and a stage row if the task has a stage in the plan), change the literal to that number, and
    write the computation in your reply.

## 3. Checks (close-out subagent)

The checks of `s4c2a-impl.md` section 5 with `--maxWorkers=2`, plus `tests/app/` reminder tests and the AG2b tests
(`tests/**/AG2b-*.test.ts`); then `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed
in `DSH-BASELINE.md` are expected in your sandbox. No real model calls, no git writes, never ports 3080/3099/44797;
probes under `./.dsh-scratch/`, deleted. Any existing assertion that fails beyond what section 2 changes: do not edit
it; report it.

## 4. Reply

Under 800 words: files changed (production net, before and after the deletions), each item RED → GREEN, the F06
computation, checks with numbers, UNSPECIFIED, subagents (most at once).
