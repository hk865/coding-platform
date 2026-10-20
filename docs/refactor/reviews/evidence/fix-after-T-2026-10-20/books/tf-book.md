# Task: the fix round after T (lead, 2026-10-20 night)

You are working in a copy of the repository (the current directory): the lead branch with T merged, tagged
`tf-base`. This is a NEW session. Read this book first, in full. Report anything you cannot understand before you
start (decision 56). **Finish within 450 minutes** (the run stops at 480). **This run is headless: when your turn
ends, the whole run ends. Do not end your turn while a subagent has not reported back** (wait with `sleep 300`, then
`list_agents`).

Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`): subagents change the code; you split, brief, check the
reports, run the final checks and write the reply.

## 1. What this is

T (HANDOFF decision 79-4) cleaned up the tests and the old-data code. After T a coverage run listed the code no test
executes; Codex and Claude classified it, DSH judged the disagreements. On 2026-10-20 the user decided to do five
things now, each its own group and its own commit:

| group | what | input |
|---|---|---|
| **TF1** | delete what the triage found can be deleted, the old null-provenance chain T missed, and fix one stale comment | `./.dsh-ref/tf-rows.tsv` (375 rows) |
| **TF2** | restore seven tests T deleted for a wrong reason | `./.dsh-ref/tw/tw-01.json` … `tw-07.json` |
| **TF3** | AD08: make production do what the frozen spec says, test first | §4 below |
| **TF4** | remove the old browser workbench (`src/ui`) and what only it uses | §5 below |
| **TF5** | remove the unused local names that `tsc --noUnusedLocals` reports | §6 below |

Binding background: decision 79 (no old-data compatibility: code reads only the current format); root `AGENTS.md`
rule 4 (no defensive checks or tests that only tampering with the database can trigger); the test rule sheet v2
(`./.dsh-ref/test-rule-sheet-v2.md`, deny-by-default: only the forms it lists are allowed). Do not edit `docs/`
(the lead writes the docs), `vendor/coding-agent/dist`, or the lock files.

## 2. Order and splitting

1. **Phase 1, in parallel, disjoint files:**
   - TF1 split by file into four or five subagents (for example: `src/core/work-graph/tasks`; `src/core/work-graph/views`
     with `state`, `persistence`; the other `src/core/work-graph` folders; `src/core/agent-runtime`, `workspace`,
     `record-store`, `src/business`, `src/contracts`; `src/composition` and `src/app`). Give each its row ids and its
     file list.
   - TF2: one or two subagents (the seven test files are disjoint from TF1's `src` files).
   - TF3: one subagent (`graph-context-reader.ts` has no TF1 row; give TF3 that file and the AD08 test file).
   - TF4 part 1 (§5, steps 1–4): one subagent.
   - **At most three subagents run tests at the same time** (another measurement run shares this machine). Others may
     read and edit meanwhile.
   - **The allowlist** `tests/architecture/production-reach-allowlist.json` is edited by nobody in phase 1. Subagents
     list the declarations they delete.
2. **Phase 2, after phase 1 has reported:**
   - one subagent: the allowlist (remove the entries of declarations phase 1 deleted; `production-reach.test.ts`
     green), then TF4 part 2 (§5, step 5);
   - commit each group separately (§7).
3. **Phase 3:** TF5 alone (§6), then its commit.
4. **Close-out** (§7).

When a subagent needs a file another running subagent owns, it reports; you serialize. Files a deletion forces you to
touch outside a group's list (an import of a deleted symbol, a test that no longer compiles) are allowed only as far
as compiling needs, and are listed in the reply.

## 3. TF1: deletions (`./.dsh-ref/tf-rows.tsv`)

Columns: `row`, `where` (`path:line` in this copy), `kind` and `what` (a branch arm or a function), `class`,
`reason`, `proposal`. Rows `NP-1`…`NP-6` are the null-provenance chain, `CP-1` the stale comment. The `proposal` is
the judged change; apply it unless a rule below says keep. **Every row gets exactly one result** in
`./.dsh-ref/out/tf1-rows.tsv`: `row`, `result` (`deleted`, `simplified`, `kept`, `BLOCKED`), `files`, `note`
(for `kept` and `BLOCKED`: why, with `file:line`).

- **D1 (no production caller reaches it), D2 (callers exist, the state cannot arise):** delete or simplify as the
  proposal says. **Keep** (result `kept`) when:
  - the proposal itself says keep, or says a spec reserves the code for a later slice (for example `A3-021`, slice-9
    Reviewer groundwork);
  - deleting would narrow a frozen interface: a type in `src/contracts` or an HTTP route's request or response
    (for example `A2-032`, the slice-5 port's result type), or an entry the allowlist marks `wire-format`;
  - the proposal offers two ways and does not pick one.
- **U (only a tampered or old-format stored record reaches it):** no test is added either way (rule 4).
  - **Delete** when the guard tolerates an **old shape**: a field the current writer always writes being absent, a
    version or legacy branch, a "written by earlier versions" fallback (decision 79). The read then refuses such a
    record the way the codec refuses any malformed record.
  - **Keep** when the guard rejects a **damaged or foreign** record (a schema, consistency or corruption check on what
    the store returns). Result `kept`, note "integrity guard".
  - When the proposal says which, follow it.
- **Behaviour on current-format data does not change.** Error codes, messages and check order for inputs the
  platform produces stay the same. An exhaustive `switch` that loses a case keeps its exhaustiveness (`never`).
- **No test executes these lines** (that is how they were found). If a deletion turns a test red, the row was wrong:
  undo that row, result `BLOCKED`, with the test and the error.
- **NP-1…NP-6:** delete `legacyPending` and every branch for `provenance === null` across the listed readers, and the
  `provenance_unchecked` line marker (`line-status.ts`) and its member in `src/contracts/work-line.ts`. Tests that
  hand-build a null-provenance Session are T leftovers: if one turns red, report it (do not convert it yourself).
- **CP-1:** make the comment true or delete it.

## 4. TF3: AD08, test first (`mattpocock/skills` TDD: one failing test, then the least production code)

- **Spec.** `docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:743` row AD08: after assembly the
  Workspace moves from @7 to @8 while the write guard still pins @7 → `rejected` / `revision_conflict`; no Run, Query
  or Session binding is added; a body already stored without an owner may stay. Read the §5 rules on which records a
  context binding names (`grep -n` for "binding" and "sources" in that spec) before you change anything.
- **Today.** `tests/work-graph/S3-prepared-context-admission.test.ts` keeps AD08 on a hand-built preparation
  (`basePrepare`, about `:503-560`) whose binding carries a Workspace source added by hand, because the real
  preparation's binding has no Workspace source: `baseSources` in
  `src/core/work-graph/views/graph-context-reader.ts:1006-1025` names the Goal, the Plan, the architecture baseline
  and the focus Tasks' Runs only. (Lead finding L-1 and ruling W1-26 in T's evidence.)
- **Do:**
  1. Change AD08 to the real path: the real `prepare`, then the real public Session-pin change the fixture already
     uses (`changePins`, which moves the Workspace @7 → @8), then the real entry. Assert `rejected` /
     `revision_conflict`, no new binding, as the row says. Run it: it must be **red** for the expected reason (entry
     succeeds or fails differently). Paste the red output in the reply.
  2. The least production change: the context binding names the Workspace record (its ref and revision), so the
     entry guard compares it. Run AD08 green.
  3. Remove `basePrepare`'s AD08 use; keep what AD06 still needs (`AD06 only builds its one refused input here`).
  4. Run every test file that prepares and enters a Task Run (`grep -rln "prepareExecution\|enterTaskExecution\|
     prepareTaskForReal" tests`), in batches. A file that now fails because a Workspace revision changes between
     prepare and entry is the new behaviour: list each with the step that moves the Workspace; do not change those
     tests, the lead rules.
- If the spec's binding rules do not name the Workspace, or the change needs more than the binding sources, stop:
  BLOCKED with the evidence.

## 5. TF4: remove the old browser workbench

The user decided on 2026-10-20 to remove the old workbench now; the new one (E3) is built later from the frozen
prototype. **Keep** what the new one needs: every HTTP route and its request and response types (`src/app/core-routes.ts`,
`src/app/core-http-types.ts`; the allowlist's `wire-format` entries), the Host's static shell in `src/app/server.ts`
(it already answers `unavailable` when the built page is missing), and the dependencies (`esbuild`, `marked`) and lock
files unchanged.

1. Delete `src/ui/` (all of it), `scripts/build-workbench.mjs` and `tsconfig.ui.json`.
2. `package.json`: only two script lines change: `build` loses `&& node scripts/build-workbench.mjs`; `typecheck`
   loses `&& tsc --noEmit -p tsconfig.ui.json`. Nothing else in it.
3. `scripts/check-boundaries.mjs` and `tests/architecture/*`: drop what exists only for `src/ui` (the `src/ui/` prefix,
   the `tsconfig.ui.json` requirement, the UI directory handling in `production-reach.ts`). Keep every other rule.
4. Tests: 35 files under `tests/` and `scripts/` name `src/ui` (`grep -rln "src/ui" tests scripts`).
   - A test file whose subject is the old workbench (rendering, its store, its live wiring, its settings page, its
     build) is deleted whole.
   - A test of backend behaviour that only borrows something from `src/ui` keeps its backend assertions; remove the
     borrowed part. If its assertions need the UI, it is BLOCKED.
   - The deleted and changed test files go in the reply, each with one line: what it tested.
5. **Phase 2.** Run `npx vitest run --maxWorkers=2 tests/architecture/production-reach.test.ts`. Declarations that
   only `src/ui` reached are now reported as unreachable: delete them, unless they are an HTTP route, its types, a
   `wire-format` entry or the static shell (then add nothing; report each as `kept for E3`). Repeat until green.

## 6. TF5: unused local names

1. `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198" > ./.dsh-ref/out/tf5-before.txt`.
2. Remove each reported name: an unused import, a local variable, a local function, a private member, a type no one
   uses. **Do not** remove an exported declaration, a parameter, or a name prefixed `_`. When removing an unused
   local drops a call with a side effect, keep the call and drop only the binding.
3. Run the command again into `tf5-after.txt`; it should be empty or each line explained in the reply.
4. Run the tests of every changed test file and the typecheck.

## 7. Rules, checks, commits, reply

**Memory (binding).** The typecheck only as `flock ./.typecheck.lock npm run typecheck`, only by you, never while a
subagent runs tests. Subagents run only their own test files: **`npx vitest run --maxWorkers=2 <files>`, never more
workers**, batches of at most 10 files, each under `timeout 900`. Put this line in every subagent's brief. At most
three subagents run tests at once.

**Never get green by weakening:** no `skip`, `todo` or `only`, no raised timeouts, no weakened assertion. Expected
values in new or restored tests come from the spec or a hand calculation, written as literals with the working in a
comment (rule sheet v2).

**TF2 (restorations).** Each `tw-NN.json` has `restore` (the public steps, helpers with `file:line`, the target test
file, the assertions) and `spec_basis`. Follow it under rule sheet v2. **Prove each restored test reaches its lines:**
temporarily break the guarded line (flip the condition), run the test red, restore the line, run it green; paste both
summaries. A restoration the current code cannot reach with allowed forms is BLOCKED with the evidence.

**This environment.** No `rg` (use `grep -rn`); `python3 -I` for scripts. There is no bubblewrap in your sandbox: a
test failing only with `ENOENT … bwrap` or "sandbox unavailable" is an environment failure; list it, the lead runs
it.

**Close-out** (one subagent, nobody else running tests):
1. `flock ./.typecheck.lock npm run typecheck`, `npm run check:architecture`, `npm run build`: all 0.
2. The tests of every changed or deleted-from file's importers (`grep -rln`), in batches.
3. `python3 -I ./.dsh-ref/d1-ledger.py . tf-base HEAD > ./.dsh-ref/out/ledger.txt`: every REMOVED or LOOSENED test
   line maps to a TF1 row, a TF3 step, a TF4 file or a TF5 name.

**Commits** in this copy, in this order, one per group: stage only that group's files by path
(`git add -A -- <its files and folders>`; deletions too), check `git diff --cached --stat`, then
`git -c user.name=dsh -c user.email=dsh@localhost commit -qm "<msg>"`. Never stage `.dsh-ref/`, `.dsh-scratch/` or
`.typecheck.lock` (they are excluded). A file two groups changed (the allowlist, for example) goes into the later
group's commit; name it in the reply. Messages:
`TF1 triage deletions`, `TF2 restored tests`, `TF3 AD08`, `TF4 old workbench removed`, `TF5 unused names`. (If phase
order makes a later group's change land first, commit it under its own message anyway.) Then
`git diff --shortstat tf-base HEAD`.

**Reply** (plain Chinese) in `./.dsh-ref/out/tf-reply.md`:
1. per group: what was done, the files, the line counts, the commit;
2. TF1: counts per result (`deleted`, `simplified`, `kept`, `BLOCKED`) and every `kept` and `BLOCKED` row with its
   reason (the full table is `tf1-rows.tsv`);
3. TF2: per restoration the test name, the red-then-green proof, or BLOCKED;
4. TF3: the red output, the production change, the green output, and the list of other tests that now fail (if any);
5. TF4: the deleted and changed files with one line each; the declarations deleted in phase 2; `kept for E3`;
6. TF5: before and after counts;
7. checks: commands and pass/fail counts; environment failures; the ledger mapping; anything unmapped;
8. suspected book errors; HANDOFF if you stop early (done, half done, not started).

Before you end, delete `./.dsh-scratch/` (the directory too).
