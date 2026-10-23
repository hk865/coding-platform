# PC-1, run PC-1a-R1: rework 1 (lead, 2026-10-22, noon)

You are run **PC-1a-R1**. Codex audited PC-1a; the lead froze the findings in `./.dsh-ref/pc1a-findings.md`. Do
exactly the rows whose ruling is **fix** (16 rows), as the table's last column says, and nothing else. Row A2-01 is
rejected: leave it. A new Session, headless: **when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Base | the current HEAD `afff716` (PC-1a: k1, c1, K, C) |
| Time limit | @MINUTES@ min |
| Commit | `PC-1a R1: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc1a-r1-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc1a-findings.md`; Codex's three reports
  `./.dsh-ref/audit/A1.out.md`, `A2.out.md`, `A3.out.md` for each row's evidence; the book `./.dsh-ref/pc1-book.md`
  only where a row cites it.
- You coordinate; subagents do the rows. Suggested split, files disjoint: **r-a** the A1 rows (the policy and
  PC-11, PC-12, PC-14, PC-17, plus a new PE4 test file for A1-04); **r-b** the A2 rows (PC-16, `PC-inputs-public`);
  **r-c** the A3 rows (`host.ts`, `PC-host-prompt-selection`, `PC-prompt-set-v1`, `PC-platform-pack-v2`, the
  allowlist). r-a regenerates `dist` with `node scripts/build-kernel-patch.mjs --write` once, after its policy edits.

## Rules

1. **Mutation proof per test row.** For each test row, apply the named mutation to the production code, run the new
   case and see it fail, undo the mutation (`git diff` shows no production change left), run it again and see it
   pass. Record the mutation and both results in the reply. Never commit a mutation.
2. **Scope.** Only the files the rows name, new test files under `tests/kernel/PC-` for A1-04, and the regenerated
   `dist`. `tests/helpers/PC-kernel-fixture.ts` stays frozen. Old tests are not edited.
3. **Memory.** `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` (and the same for `npm run build`),
   one at a time. Tests only as `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under
   `timeout 900`; at most two test commands at once. Never `npm test`, a scale test or a bare `npx vitest run`.
   Put this rule in every subagent's prompt. Do not end your turn before every subagent has reported.
4. **No bubblewrap here.** A failure only on `ENOENT … bwrap` is an environment failure; list it with its text.

## Checks before you finish

`node scripts/build-kernel-patch.mjs --check`; `node scripts/build-platform-prompts.mjs --check`; typecheck;
`npm run check:architecture`; build. Tests: every changed and new test file, then `tests/kernel`, `tests/app`,
`tests/contracts`, `tests/architecture` in batches. Commit with
`git add -A -- src scripts resources runtime-assets.json vendor/coding-agent tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`;
`git status --porcelain` prints nothing; `git diff --name-only pc1a-base HEAD | grep -vE -f ./.dsh-ref/pc1a-whitelist.txt`
prints nothing.

## Reply (plain Chinese)

Per row: done or not, the test name, the mutation, RED and GREEN; the checks with numbers; the test runs (files,
passed, failed, environment failures); the commits; anything a row did not fit.
