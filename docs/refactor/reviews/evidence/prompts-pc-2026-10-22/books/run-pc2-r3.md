# PC-2, run PC-2-R3: rework 3, the last (lead, 2026-10-23, night)

You are run **PC-2-R3**. Codex audited rework 2 (audit 3: no production problem, five test rows); the lead froze the
findings in `./.dsh-ref/pc2-r3-findings.md` and froze one more fixture patch (commit `8f8a2f0`, tag `pc2-r3-base`). Do
exactly the table's rows and its last paragraph, and nothing else. A new Session, headless: **when your turn ends, the
whole run ends.**

| | |
| --- | --- |
| Base | the current HEAD `8f8a2f0` (rework 2 `9e984e1` plus the lead's fixture commit) |
| Time limit | @MINUTES@ min |
| Commit | `PC-2 R3: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc2-r3-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc2-r3-findings.md`, whole; Codex's audit-3 report
  `./.dsh-ref/audit3/A.out.md` (each row's evidence and fix; §3 for J2-03, J-06 and J-08).
- Your reply `./.dsh-ref/pc2-r2-reply.md` only to remember what you built.
- You coordinate; subagents do the rows. Files stay disjoint while subagents run: **r-g** A3-02
  (`tests/state/PC2-G-query-bind-order.test.ts`); **r-j1** A3-03 and the J-09 mutation record
  (`tests/runtime/PC2-joint-tools.test.ts`); **r-j2** A3-04 (`tests/runtime/PC2-joint-query-history.test.ts`);
  **r-j3** A3-05 (`tests/runtime/PC2-joint-budget.test.ts`); **r-j4** A3-01 (a new
  `tests/runtime/PC2-joint-k3-history.test.ts`, or `PC2-joint-history.test.ts` if no other subagent holds it);
  **r-t** the T2-03 mutation record only (no file change unless the mutation must be redone).

## Rules

1. **Mutation proof per test row.** For each row, apply a mutation **to the production code** (never to the test or
   a fixture), run the new or changed case and see it fail, undo the mutation (`git diff` shows no production change
   left), run it again and see it pass. Record the file, line, mutation and both results in the reply. Never commit a
   mutation.
2. **Expected values** as the table says. Nothing from production code, the generated pack, `preparedTexts()`, a
   manifest or a captured request.
3. **Scope.** Only test files the rows name, and new test files under `tests/runtime/PC2-` or `tests/state/PC2-`. No
   production file changes in this run. The whitelist is `./.dsh-ref/pc2-r3-whitelist.txt`. The frozen fixtures
   (`tests/helpers/PC-platform-fixture.ts`, `PC-kernel-fixture.ts`, `PC2-pack-fixture.ts`, `PC2-host-fixture.ts`,
   `WP2-platform-support.ts`, `K3-35-continuation-fixture.ts`) do not change. No timeout is raised; no new limit above
   `60_000`.
4. **Memory.** `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck`, one at a time, never from a subagent
   while another runs one. Tests only as `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under
   `timeout 900`; at most two test commands at once. Never `npm test`, a `*.scale.test.ts` file, `npm run test:scale`
   or a bare `npx vitest run`. Put this rule in every subagent's prompt. Do not end your turn before every subagent
   has reported (`sleep 300`, then `list_agents`).
5. **No bubblewrap here.** A failure only on `ENOENT … bwrap` or a sandbox `unsupported` is an environment failure;
   list it with its text.
6. **A row that does not fit.** If a row's fix does not hold when you build it, do not bend it: leave the row, say why
   with the evidence in the reply, and go on with the rest.

## Checks before you finish

1. `flock … npm run typecheck` green; `npm run check:architecture` green.
2. Tests: every changed and new test file; every `tests/*/PC2-*` and `tests/*/PC-*` file; `tests/architecture`.
3. Commit with
   `git add -A -- tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`; a later fix is a
   new commit, never amend or reset. Then:
   - `git status --porcelain` prints nothing;
   - `git diff --name-only 8f8a2f0 HEAD | grep -vE -f ./.dsh-ref/pc2-r3-whitelist.txt` prints nothing;
   - `git diff --name-only 8f8a2f0 HEAD -- src scripts resources runtime-assets.json tests/helpers` prints nothing.

## Reply (plain Chinese): `./.dsh-ref/pc2-r3-reply.md`

Under 800 words: rows that did not fit, with the evidence; per row the test, the production mutation (file:line),
RED and GREEN; the J-09 and T2-03 mutation records; the checks and test runs with numbers; the commits and
`git diff --shortstat 8f8a2f0 HEAD`; a **HANDOFF** section only if you stop before the end.
