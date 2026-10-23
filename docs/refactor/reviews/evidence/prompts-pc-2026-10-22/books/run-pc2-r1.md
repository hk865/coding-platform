# PC-2, run PC-2-R1: rework 1 (lead, 2026-10-23, night)

You are run **PC-2-R1**. Codex audited PC-2 in seven parts and the lead ran the full suite with bubblewrap; the lead
froze the findings in `./.dsh-ref/pc2-findings.md`. Do exactly its §1 rulings F1–F3 and the rows whose ruling is
**fix** (or **fix, narrowed**, or the fix half of **split**), as the audit row's "唯一改法" says plus the lead's note,
and nothing else. Rows **rejected** and **deferred** stay as they are; **same as** rows are done once, under the row
they name. A new Session, headless: **when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Base | the current HEAD `af84802` (PC-2: A, W, T, H, G, Q, joint) |
| Time limit | @MINUTES@ min |
| Commit | `PC-2 R1: <rows>`; several commits are fine |
| Reply | `./.dsh-ref/pc2-r1-reply.md`, plain Chinese |

## Read first, and only this

- `./.dsh-ref/coordinator-mode.md`; the table `./.dsh-ref/pc2-findings.md`, whole; Codex's reports
  `./.dsh-ref/audit/<P>.out.md` for each row's evidence, input, fix and mutation; the lead's full-suite summary
  `./.dsh-ref/checks/full-pc2.txt` (the failing tests by name).
- The book `./.dsh-ref/pc2-book.md` only where a row cites it; your own reply `./.dsh-ref/pc2-reply.md` only to
  remember what you built.
- You coordinate; subagents do the rows. Files stay disjoint while subagents run:
  - **r-f1 first, alone on its files:** F1 — `context-history-facts.ts`, `context-types.ts` (the history input and
    `AssembledContextV1`), `context-work-recipe.ts`, `context-query-recipe.ts`, `execution-preparation.ts`,
    `query-preparation.ts`, `execution-driver.ts`, the Runtime `query-execution.ts`, `PC2-history-decision-pure`,
    `PC2-joint-history` (only to follow the seam). Commit, typecheck green, then report.
  - **From the start, beside r-f1:** **r-a** (A rows: `src/contracts/prompts/**` except the generated module, A's
    tests); **r-h** (H rows: `src/app/**`, `PC2-H-*`); **r-w** (W rows: `PC2-W-*` only); **r-g** (G rows:
    `state/context-input.ts`, `execution-entry-service.ts`, the WorkGraph `queries/query-execution.ts`,
    `tests/state/**`, G's tests).
  - **After r-f1 has reported:** **r-t** (T rows and F3: `context-rendering.ts`, `context-types.ts` (T-03 only),
    the recipes (T-11 comments), `continuation-brief.ts`, `prepared-execution.ts`, `prompt-set-texts.ts` (T-03's
    cast only), T's and F3's tests) and **r-q** (Q rows and F2: `tool-group-assembly.ts`, the two preparations, the
    two executions, `prompt-set-texts.ts` (Q-04), `runtime.ts`, Q's tests). r-t and r-q agree on `prompt-set-texts.ts`
    through you: r-q edits it, r-t asks r-q for T-03's line.
  - **r-j last, after every other subagent has reported and the typecheck is green:** the J rows (`PC2-joint-*`,
    `tests/app/PC2-joint-*`), which also carry H-09, T-09, G-09, Q-06, Q-07's fix half, Q-08, Q-09.

## Rules

1. **Mutation proof per test row.** For each test row, apply the named mutation to the production code, run the new
   or changed case and see it fail, undo the mutation (`git diff` shows no production change left), run it again and
   see it pass. Record the mutation and both results in the reply. Never commit a mutation.
2. **Expected values** are literals or hand-computed: hand-written JSON and texts, `sha256` of literal strings,
   `Buffer.byteLength` of hand-written JSON. Nothing from production code, the generated pack, `preparedTexts()`, a
   manifest or a captured request.
3. **Scope.** Only the files the rows and F1–F3 name, and new test files under `tests/<dir>/PC2-`. The whitelist is
   `./.dsh-ref/pc2-r1-whitelist.txt`. The four frozen fixtures (`tests/helpers/PC-platform-fixture.ts`,
   `PC-kernel-fixture.ts`, `PC2-pack-fixture.ts`, `PC2-host-fixture.ts`) do not change. Old tests change only where
   §1 or a row says so, and only as it says. No timeout is raised; no new limit above `60_000`.
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
2. Tests: every changed and new test file; `tests/app`; `tests/architecture`; the ten `tests/runtime/PC2-W-*`; then
   the full-suite failures outside `tests/scenarios` (F1, F2, F3): `tests/work-graph/S2A-queue-derived-cards`,
   `S2B-30-track-bars`, every `tests/work-graph/S2C-lines-*` except `*.scale.test.ts`,
   `tests/work-graph/A2-requeue-service`, `R3e-reverify`, `S5-notices`, `tests/state/invariants-fuzz`,
   `tests/runtime/C2-runtime-platform-tools`, `K3-15-blocked-omission`, `K3-35-T-by-hand`,
   `K3-35-approved-methods-brief`, `tests/app/AG6-agent-assembly`; then `tests/business/S1-archive-flow.test.ts` and
   `tests/business/S1-session-maintenance.test.ts`; then the importers of the production files you changed outside
   `tests/scenarios`, in batches. List the `tests/scenarios` importers you did not run.
3. Commit with
   `git add -A -- src scripts resources runtime-assets.json tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<message>"`;
   a later fix is a new commit, never amend or reset. Then:
   - `git status --porcelain` prints nothing;
   - `git diff --name-only pc2-base HEAD | grep -vE -f ./.dsh-ref/pc2-r1-whitelist.txt` prints nothing;
   - `git diff --name-only pc2-base HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts tests/helpers/PC2-pack-fixture.ts tests/helpers/PC2-host-fixture.ts`
     prints nothing.

## Reply (plain Chinese): `./.dsh-ref/pc2-r1-reply.md`

Under 1,200 words, in this order:
1. Questions and rows that did not fit (rule 6), with the evidence.
2. F1, F2, F3: what changed, and F3's numbers re-derived by hand.
3. Per row: done or not, the test name, the mutation, RED and GREEN.
4. The checks with numbers; the test runs (files, passed, failed, environment failures with their text, the scenario
   importers not run).
5. The commits and `git diff --shortstat af84802 HEAD`.
6. A **HANDOFF** section, only if you stop before the end: the rows done, the files half done, the rows not started,
   and the shortest path to finish.
