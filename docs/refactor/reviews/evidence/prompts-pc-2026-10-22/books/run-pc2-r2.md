# PC-2, run PC-2-R2: rework 2 (lead, 2026-10-23, night)

You are run **PC-2-R2**. Codex audited rework 1 in seven parts; the lead froze the findings in
`./.dsh-ref/pc2-r2-findings.md` and froze four fixture patches for the rows rework 1 deferred (commit `197b4ad`, tag
`pc2-r2-base`). Do exactly its §1 rulings and the rows whose ruling is **fix**, as the audit row's "唯一改法" says
plus the lead's note, and nothing else. Rows **rejected** stay as they are; **same as** rows are done once, under the
row they name. A new Session, headless: **when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Base | the current HEAD `197b4ad` (rework 1 `2dae25f` plus the lead's fixture commit) |
| Time limit | @MINUTES@ min |
| Commit | `PC-2 R2: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc2-r2-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc2-r2-findings.md`, whole; Codex's audit-2 reports
  `./.dsh-ref/audit2/<P>.out.md` for each row's evidence, input, fix and mutation; `./.dsh-ref/audit2/FX.out.md` for
  the four fixture options and how each deferred row is tested.
- For the deferred rows J-04, J-06, J-08, J-09: `./.dsh-ref/pc2-findings.md` and `./.dsh-ref/audit/J.out.md` (audit 1).
- The book `./.dsh-ref/pc2-book.md` only where a row cites it; your replies `./.dsh-ref/pc2-reply.md` and
  `pc2-r1-reply.md` only to remember what you built.
- You coordinate; subagents do the rows. Files stay disjoint while subagents run:
  - **From the start:** **r-a** (A2 rows: `src/contracts/prompts/**`, `PC2-resolve-pack`); **r-h** (H2 rows:
    `src/app/**`, `PC2-H-*`); **r-t** (T2 rows: `continuation-brief.ts`, `PC2-T-render`, the three F3 tests' comments);
    **r-g** (G2 rows: `state/context-input.ts`, `execution-entry-service.ts`, the WorkGraph `queries/query-execution.ts`,
    `tests/state/**`, `PC2-G-*`); **r-q** (Q2-02, Q2-05, F4: `context-history-facts.ts`, `PC2-declaration-prepare`, `RL-31-readonly-resource-caps`,
    `K-readonly-command`).
  - **r-j last, after every other subagent has reported and the typecheck is green:** J2-01 … J2-04 (carrying H2-04,
    Q2-03, Q2-04) and the deferred J-04, J-06, J-08, J-09 (`PC2-joint-*`, `tests/app/PC2-joint-*`, new `PC2-` files).

## Rules

1. **Mutation proof per test row.** For each test row, apply a mutation **to the production code** (never to the
   test), run the new or changed case and see it fail, undo the mutation (`git diff` shows no production change left),
   run it again and see it pass. Record the mutation and both results in the reply. Never commit a mutation.
2. **Expected values** are literals or hand-computed: hand-written JSON and texts, `sha256` of literal strings,
   `Buffer.byteLength` of hand-written JSON. Nothing from production code (no production function called to build an
   expected value, not even a digest helper), the generated pack, `preparedTexts()`, a manifest or a captured request.
3. **Scope.** Only the files the rows and §1 name, and new test files under `tests/<dir>/PC2-`. The whitelist is
   `./.dsh-ref/pc2-r2-whitelist.txt`. The four frozen fixtures and `tests/helpers/WP2-platform-support.ts` do not
   change in this run. Old tests change only where §1 or a row says so, and only as it says. No timeout is raised; no
   new limit above `60_000`.
4. **Memory.** `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck` (and the same for `npm run build`),
   one at a time, never from a subagent while another runs one. Tests only as
   `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under `timeout 900`; at most two test
   commands at once. Never `npm test`, a `*.scale.test.ts` file, `npm run test:scale` or a bare `npx vitest run`. Put
   this rule in every subagent's prompt. Do not end your turn before every subagent has reported (`sleep 300`, then
   `list_agents`).
5. **No bubblewrap here.** A failure only on `ENOENT … bwrap` or a sandbox `unsupported` is an environment failure;
   list it with its text. The lead reruns `tests/scenarios`.
6. **A row that does not fit.** If a row's fix or number does not hold when you build it, do not bend it: leave the
   row, say why with the evidence in the reply, and go on with the rest.

## Checks before you finish

1. One at a time: `node scripts/build-kernel-patch.mjs --check`; `node scripts/build-platform-prompts.mjs --check`;
   typecheck; `npm run check:architecture`; build. All green.
2. Tests: every changed and new test file; `tests/app`; `tests/architecture`; `tests/runtime/K-readonly-command`, `RL-31-readonly-resource-caps`;
   the ten `tests/runtime/PC2-W-*`; every `tests/*/PC2-*` and `tests/*/PC-*` file; then the importers of the production
   files you changed outside `tests/scenarios`, in batches. List the `tests/scenarios` importers you did not run.
3. Commit with
   `git add -A -- src scripts resources runtime-assets.json tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`;
   a later fix is a new commit, never amend or reset. Then:
   - `git status --porcelain` prints nothing;
   - `git diff --name-only pc2-base HEAD | grep -vE -f ./.dsh-ref/pc2-r2-whitelist.txt` prints nothing;
   - `git diff --name-only pc2-r2-base HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts tests/helpers/PC2-pack-fixture.ts tests/helpers/PC2-host-fixture.ts tests/helpers/WP2-platform-support.ts`
     prints nothing.

## Reply (plain Chinese): `./.dsh-ref/pc2-r2-reply.md`

Under 1,000 words, in this order:
1. Questions and rows that did not fit (rule 6), with the evidence.
2. Per row: done or not, the test name, the production mutation, RED and GREEN.
3. The checks with numbers; the test runs (files, passed, failed, environment failures with their text, the scenario
   importers not run).
4. The commits and `git diff --shortstat 197b4ad HEAD`.
5. A **HANDOFF** section, only if you stop before the end.
