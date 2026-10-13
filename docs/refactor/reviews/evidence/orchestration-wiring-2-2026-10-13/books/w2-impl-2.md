# Task: orchestration wiring package 2 — second session: finish row F15, self-check, final checks

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. An earlier
session worked in this same copy and was stopped by its time limit before it finished. Its work is in the working tree
(not committed). Everything you need is in this message and in files of this copy.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 4 and the reply of section 5.

**Work with subagents.** You are the coordinator; keep your own context small. Do not read the spec, the code or the
test files yourself.

## 1. The original brief still applies

The full brief of the first session is in `./.dsh-ref/w2-impl.md` (not committed, excluded from `git status`).
Its sections 1–9 still apply: the frozen spec, the frozen files and their sha256, the lead decisions L-scope, L-tdd,
L-reach, L-interfaces, L-SES13, L-bwrap, the rules of section 5, the groups of section 6, the self-check of section 7,
the checks of section 8 and the reply format of section 9. This message overrides it only where it says so.

Every subagent you start must read, in order:
1. `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
2. `./.dsh-ref/w2-impl.md` sections 1–5 and the group block it works on;
3. the spec sections that block names.

## 2. Where the first session stopped (measured by the lead)

- The working tree changes 18 production files and adds 10 files (8 new `WP2-` test files, one helper, one new view).
- `npm run typecheck`: 0 errors. The frozen files are unchanged.
- `npx vitest run WP2-`: 8 files, 71 tests, all pass.
- The 50-file regression run (brief section 8): only failures of the bwrap kind, in the five scenario files the brief
  lists. The 7 intended-RED tests now pass.
- **Every row of spec §5.2 has a test whose name starts with its id, except F15.**
- The first session did not run the self-check (brief section 7) and did not write its reply. Its row logs are lost.

## 3. What to do

1. **Row F15 (group D, entry E3).** One subagent, test-first:
   - Spec row F15: a failed health commit or a failed reply commit leaves no half-finished business state; a reply
     that was committed but whose receipt was lost is recovered exactly once.
   - Write the F15 test(s) in `tests/composition/WP2-wiring.test.ts` through `createTargetPlatform`, on memory and
     sqlite, with an injected fault at a system boundary (the store commit or the clock), never by mocking internal
     modules.
   - First run the new test. If it already passes against the current code, keep it. It must still assert the row,
     not something trivially true. Report it as "GREEN on first run" with the reason.
   - If production code must change, the subagent may change only the files of groups B or D (brief section 6) that
     the row needs, and must say which.
2. **Self-check (brief section 7).** After F15, start one read-only review subagent per group: E, A, C, B (B-state,
   B-writers and B-source together), D. Each has a fresh context and answers the four questions of brief section 7.
   Because the row logs are lost, each reviewer also lists, per row of its group: the test name, and the file:symbol
   of the implementation.
3. **Fix** what the reviewers report as not done, a TDD anti-pattern, or a defect. Use a new subagent per owning
   group. Each fix that changes behaviour gets a failing test first. A test that is tautological or implementation-coupled
   is rewritten at its row's entry point, not deleted without replacement.
4. Then run the checks once (section 4).

## 4. Checks

Run exactly the commands of brief section 8. The expected results are as in brief section 8, with one addition:
every row of spec §5.2, including F15, has a test whose name starts with its id.

## 5. Reply

Use the reply format of brief section 9, with these changes:
- **ROWS:** for rows done by the first session, write `first session` in the "RED message first seen" column. For F15
  and every fix, give the real RED message.
- **NOTES** also lists: each reviewer's findings in one line each, and what was fixed.
