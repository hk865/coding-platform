# PC-1, run PC-1b-R2: rework 2 (lead, 2026-10-22, night)

You are run **PC-1b-R2**. Codex audited your rework 1 in four parts and one question, and the lead ran the full suite
on it; the lead froze the findings in `./.dsh-ref/pc1b-r2-findings.md`. Do exactly the rows whose ruling is **fix**, as
the table's last column says, plus rule T, and nothing else. Rows marked **rejected** or **accepted as built** stay as
they are. A new Session, headless: **when your turn ends, the whole run ends.** This is rework 2 of at most three.

| | |
| --- | --- |
| Base | the current HEAD `1b5183a` (your rework 1) |
| Time limit | @MINUTES@ min |
| Commit | `PC-1b R2: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc1b-r2-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc1b-r2-findings.md`, whole; Codex's reports
  `./.dsh-ref/audit2/P.out.md`, `S.out.md`, `R.out.md`, `J.out.md`, `X.out.md` for each row's evidence, line and
  mutation.
- Your rework 1 reply `./.dsh-ref/pc1b-r1-reply.md` only to remember what you built; the rework 1 table
  `./.dsh-ref/pc1b-findings.md` only where a row cites it.
- You coordinate; subagents do the rows. Suggested split, files disjoint while they run:
  - **r-x** X-01: `tests/scenarios/harness.ts`, `tests/scenarios/support/common.ts`,
    `tests/scenarios/support/review-work-root.ts`.
  - **r-p** P2-02, P2-04, P2-05 and rule T in the P files (`PC-entry-frozen-*`, `PC-prepare-*`).
  - **r-s** S2-02 … S2-09, R2-01, R2-02 and rule T in those files (`PC-model-budget-preview`, `PC-send-*`,
    `PC-read-record-work-query`, `runtime.ts`).
  - **r-j** J2-01, J2-02, J2-04, J2-05 and rule T in the `PC-joint-*` files (`PC-joint-*`, the allowlist,
    `context-rendering.ts`, `context-assembler.ts`, `S3-context-assembler`, `S4C2-assembly`, `S3-role-profiles`).

## Rules

1. **Mutation proof per test row.** For each test row, apply the named mutation to the production code, run the
   changed case and see it fail, undo the mutation (`git diff` shows no production change left), run it again and see
   it pass. Record the mutation and both results in the reply. Never commit a mutation.
2. **Expected values** are literals or hand-computed: hand-written JSON and texts, `sha256` of literal strings,
   `Buffer.byteLength` of hand-written JSON. Nothing from production code, the generated pack, `preparedTexts()` or a
   captured request; the only exceptions are the two public identifiers J2-01 names.
3. **Scope.** Only the files the rows name. The whitelist is `./.dsh-ref/pc1b-r2-whitelist.txt`. The frozen fixtures
   `tests/helpers/PC-platform-fixture.ts` and `tests/helpers/PC-kernel-fixture.ts` do not change. Old tests change
   only where a row says so, and then only as it says. No timeout is raised; rule T only lowers or removes.
4. **Memory.** `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` (and the same for `npm run build`),
   one at a time. Tests only as `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under
   `timeout 900`; at most two test commands at once. Never `npm test`, a scale test or a bare `npx vitest run`. Put
   this rule in every subagent's prompt. Do not end your turn before every subagent has reported.
5. **No bubblewrap here.** A failure only on `ENOENT … bwrap`, or a scenario that also fails on `1b5183a` in your
   copy, is an environment failure; list it with its text. The lead reruns the scenarios with bubblewrap.
6. **A row that does not fit.** If a row's fix or number does not hold when you build it, do not bend it: leave the
   row, say why with the evidence in the reply, and go on with the rest.

## Checks before you finish

`node scripts/build-kernel-patch.mjs --check`; `node scripts/build-platform-prompts.mjs --check`; typecheck;
`npm run check:architecture`; build. Tests: every changed test file; then `tests/architecture`; then the 16 files of
row X (the list is in `./.dsh-ref/audit2/X.out.md` §2) in two batches, reporting each file's result (rule 5 applies).
Commit with
`git add -A -- src tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`;
`git status --porcelain` prints nothing; `git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-r2-whitelist.txt`
prints nothing; `git diff --name-only 1b5183a HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts`
prints nothing.

## Reply (plain Chinese)

Per row: done or not, the test name, the mutation, RED and GREEN; for S2-02 the hand-computed numbers; for rule T
the list of limits changed (file, case, old, new); the checks with numbers; the test runs (files, passed, failed,
environment failures); the commits; any row that did not fit (rule 6), with the evidence.
