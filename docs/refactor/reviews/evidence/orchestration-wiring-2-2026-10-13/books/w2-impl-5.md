# Task: orchestration wiring package 2 — fifth session: the last test-evidence items

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Four earlier
sessions implemented wiring package 2 in this copy; their work is in the working tree (not committed). With real
bubblewrap the lead ran the full suite: everything passes (286 files, 6,071 tests). Codex's third review says the
production code is right (the only production change of round four, the DTO source check, is confirmed) and lists the
remaining test-evidence items. **This is a test-only round, and the last one.** Production code does not change.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 400`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

**Work with subagents.** You are the coordinator; keep your own context small. Give group C and group M (section 3)
each to its own subagent; they write disjoint files.

## 1. Material (inside this copy, excluded from `git status`)

- `./.dsh-ref/w2-impl.md` — the first brief; sections 1–5 still apply.
- `./.dsh-ref/r4/` — the fourth round's material (`codex-review-2.md`, `report-3.md`) and `./.dsh-ref/r4/brief-4.md`
  section 2 (its binding decisions still apply: expected values never come from the system under test, observation
  brackets, real histories, no successful internal mocks).
- `./.dsh-ref/r5/codex-review-3.md` — **the third review. The items marked "Must fix before merge" are this session's
  work, except the ones section 2 says to skip.**
- `./.dsh-ref/r5/report-4.md` — the fourth session's reply.
- `./.dsh-ref/tdd/` — the TDD skill.

## 2. Lead decisions for this round (binding)

- **No production change.** If an item cannot be tested without one, stop that item and report it under UNSPECIFIED
  with the spec line and the minimal counter-example.
- **F06** (`tests/composition/WP2-wiring.test.ts` around :458, :473, :509–519): assert the expected continuation content
  through its tail and the complete omitted-row outcome; build the expected reminder text from the creating commands'
  results (or literal text you wrote into the fixture), never from a queue readback.
- **F07**: around :550/:555/:566 take expected keys and text from creating commands or observed commits; in
  `tests/work-graph/WP2-context-extensions.test.ts` replace the fabricated successful queue pages (around :311/:320)
  with real pagination over real cards; in the "exactly 5,000" case also check the four seed-card identities and the
  four hint identities.
- **F11** (around :648, :720–722): pin the example and write the expected order as a literal list; do not compute it
  from ids.
- **F14**:
  - Query answer (around :1491, :1606/:1618): retrying `consumeConsultation` returns early (`consultation.ts:152`) and
    never reaches the writer. Reissue the request whose receipt the Query-answer writer replays, through a public
    entry, and compare complete first / retry / reopened values and cursors. If no public entry reaches that writer's
    replay, report it under UNSPECIFIED with the reason; do not add one.
  - For all three writers (Work, user answer, Query answer) assert the literal reply body through the public
    `readMessageBody`.
  - Work values (around :1118/:1146): complete equality, not recursive subset matching.
- **F10 Query recovery**: a positive case. Save a Work-origin reply on an ordinary idle Session, finish that Work, run
  a standalone semantic Query on the same Session (`query-execution.ts:910`: consultation is optional), make the Query's
  outcome unknown and recover it through the real recovery path, then assert the notice at the observed R on both
  backends. Keep the existing derived-Session case as the empty-set example. For memory, read the notices after the
  recovery too.
- **Query preparation bracket**: Query preparation commits its binding by design (`query-preparation.ts:390`). Bracket
  only its read/assembly stage with zero commits and zero model calls, or state in a comment that the bracket covers
  that stage; do not require zero commits around the whole Query operation.
- **M02** (`tests/work-graph/WP2-message-duties.test.ts` around :250, :264–268): restore an independently specified,
  complete guard set from the real resolver (Session guard plus every resolver guard, written as a literal expectation)
  and cover the identical-guard merge case.
- **Restore the Query mode and extensions checks** lost with the deleted runtime file, through the real E2 path,
  together with the F06 budget correction.
- **Skip (do not do):** the aggregate 5,000-item guard of the undelivered-reply source (review item 6, first part) and
  any other test of wiring 2's temporary 5,000/50-page guards beyond what exists: slice 2A removes those guards, and
  its frozen spec tests beyond them.

## 3. Groups

**C — platform-entry tests:** `tests/composition/WP2-wiring.test.ts`, `tests/helpers/WP2-platform-support.ts`,
`tests/scenarios/WP2-wiring-scenario.test.ts`. Items F06, F07 (composition part), F11, F14, F10, the Query bracket, the
restored Query mode/extensions checks.

**M — module-entry tests:** `tests/work-graph/WP2-context-extensions.test.ts`,
`tests/work-graph/WP2-message-duties.test.ts`, `tests/work-graph/WP2-undelivered-notices.test.ts`. Items F07 (module
part), M02.

## 4. Rules

For test rewrites keep a log (old test, what was wrong, new test, result). No git write commands; one vitest command at
a time; no real model calls; no network; do not touch ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`,
deleted at the end. No edits to production code, the refrozen old tests, the harness additions or any other existing
test file.

## 5. Checks

Run exactly the commands of the first brief section 8, plus the four refrozen files and `git diff --stat slice-base --
tests` as in round four. Expected (no bubblewrap here): typecheck, check:architecture and build exit 0; every `WP2-`
test passes; the regression run fails only in the 18 sandbox-kind cases; the four refrozen files pass; all ten sha256
values hold; `git diff --stat slice-base -- src` is identical to round four's.

## 6. Reply

The first brief's reply format, plus **REVIEW:** for each item of section 2: fixed / not fixed (why), with the test
name(s) and file:line.
