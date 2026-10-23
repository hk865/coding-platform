# PC-1, run PC-1b-R1: rework 1 (lead, 2026-10-22, night)

You are run **PC-1b-R1**. Codex audited PC-1b in four parts and the lead ran the full suite; the lead froze the
findings in `./.dsh-ref/pc1b-findings.md`. Do exactly the rows whose ruling is **fix**, as the table's last column
says, plus PC-15 as its section says, and nothing else. Rows marked **rejected** stay as they are; rows marked
**same as** are done once, under the row they name. A new Session, headless: **when your turn ends, the whole run
ends.**

| | |
| --- | --- |
| Base | the current HEAD `c1c7af4` (PC-1b: P, S, R, joint) |
| Time limit | @MINUTES@ min |
| Commit | `PC-1b R1: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc1b-r1-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc1b-findings.md`, whole; Codex's reports
  `./.dsh-ref/audit/P.out.md`, `S.out.md`, `R.out.md`, `J.out.md` for each row's evidence and mutation, and
  `./.dsh-ref/audit/pc15.out.md` for PC-15; the subagent's probe `./.dsh-ref/pc1b-l-probe.diff` for L-02 and L-03.
- The book `./.dsh-ref/pc1-book.md` only where a row cites it; your own reply `./.dsh-ref/pc1b-reply.md` only to
  remember what you built.
- You coordinate; subagents do the rows. Suggested split, files disjoint while they run:
  - **r-p** the P rows and L-03: preparation, `prompt-set-texts.ts`, `architecture-reminders.ts`, the entry service,
    P's tests (`PC-prepare-*`, `PC-prompt-texts*`, `PC-entry-frozen-*`, `W2-role-skills`).
  - **r-s** the S rows, L-01, L-02, L-04: `model-budget.ts`, `observed-model-run.ts`, `execution-driver.ts`, the
    Runtime `query-execution.ts`, `PC-send-*`, `PC-model-budget-preview`, `B1-kernel-assembly`,
    `S3-prepared-context-admission`, `PC-host-prompt-selection`, `S1-workflow-archive-fixture.ts`.
  - **r-r** the R rows except their parts in the joint files: the WorkGraph model-call and Query files, `runtime.ts`,
    `PC-record-*`, `PC-query-record-*`, `PC-read-record-work-query`, `A2-step1-codecs`.
  - **r-j last, after r-p, r-s and r-r have reported and the typecheck is green:** the joint files
    (`PC-joint-prepare-freeze`: J-01, J-02; `PC-joint-freeze-and-pin`: S-10, J-04; `PC-joint-record-and-failure`:
    S-09, R-12, R-14 and R-13's joint part), PC-15 (a) and (b) in the new `PC-joint-budget-removal.test.ts`, then
    J-07 and J-08 (the exports in `continuation-brief.ts`, `context-rendering.ts`, `context-assembler.ts`,
    `query-preparation.ts`, the four old tests J-07 names, and the allowlist).

## Rules

1. **Mutation proof per test row.** For each test row, apply the named mutation to the production code, run the new
   or changed case and see it fail, undo the mutation (`git diff` shows no production change left), run it again and
   see it pass. Record the mutation and both results in the reply. Never commit a mutation. PC-15 (a) has its base
   proof as a mutation, (b) its own.
2. **Expected values** are literals or hand-computed: hand-written JSON and texts, `sha256` of literal strings,
   `Buffer.byteLength` of hand-written JSON. Nothing from production code, the generated pack, `preparedTexts()` or a
   captured request.
3. **Scope.** Only the files the rows name, new test files under `tests/runtime/PC-`, `tests/work-graph/PC-` and
   `tests/contracts/PC-`. The whitelist is `./.dsh-ref/pc1b-r1-whitelist.txt`. The frozen fixtures
   `tests/helpers/PC-platform-fixture.ts` and `tests/helpers/PC-kernel-fixture.ts` do not change in this run. Old
   tests change only where a row says so, and then only as it says. No timeout is raised.
4. **Memory.** `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` (and the same for `npm run build`),
   one at a time. Tests only as `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under
   `timeout 900`; at most two test commands at once. Never `npm test`, a scale test or a bare `npx vitest run`. Put
   this rule in every subagent's prompt. Do not end your turn before every subagent has reported.
5. **No bubblewrap here.** A failure only on `ENOENT … bwrap` is an environment failure; list it with its text.
6. **A row that does not fit.** If a row's fix or number does not hold when you build it, do not bend it: leave the
   row, say why with the evidence in the reply, and go on with the rest.

## Checks before you finish

`node scripts/build-kernel-patch.mjs --check`; `node scripts/build-platform-prompts.mjs --check`; typecheck;
`npm run check:architecture`; build. Tests: every changed and new test file; then `tests/architecture`;
`tests/business/S1-archive-flow.test.ts`, `tests/business/S1-session-maintenance.test.ts`,
`tests/work-graph/R3c-plan-adoption.test.ts`, `tests/app/PC-host-prompt-selection.test.ts`; then the 31 files PC-1b
changed (your reply §5) in batches. Commit with
`git add -A -- src scripts resources runtime-assets.json vendor/coding-agent tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`;
`git status --porcelain` prints nothing; `git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-r1-whitelist.txt`
prints nothing; `git diff --name-only c1c7af4 HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts`
prints nothing.

## Reply (plain Chinese)

Per row: done or not, the test name, the mutation, RED and GREEN; for PC-15 the hand-computed numbers and what the
run showed; the checks with numbers; the test runs (files, passed, failed, environment failures); the commits; any
row that did not fit (rule 6), with the evidence.
