# Task: move 18 WorkGraph files to their target submodule directories (part 1 of 2: plan and dry run)

You are working in a copy of a TypeScript repository (the current directory). This is a large but fully specified, mechanical task: a pure file move with no change of behaviour. Follow it exactly. Do not make design decisions: if something is not specified here, do not invent behaviour; list it in your report instead.

The task comes in two parts in this same session. This message is part 1: read, run the checks once before any change, write your move script and its dry-run listing, and stop. Part 2, a later message, applies the listing and runs the checks again.

## What the whole task does

Move these 18 files (paths relative to `src/core/work-graph/`). The directory `model/` does not exist yet. The other target directories (`persistence/`, `sessions/`, `tasks/`) exist.

| # | from | to |
|---|---|---|
| M1 | `tasks/contracts.ts` | `model/task-contracts.ts` |
| M2 | `tasks/claim-contracts.ts` | `model/claim-contracts.ts` |
| M3 | `tasks/execution-entry-contracts.ts` | `model/execution-entry-contracts.ts` |
| M4 | `tasks/execution-read-contracts.ts` | `model/execution-read-contracts.ts` |
| M5 | `tasks/execution-history-contracts.ts` | `model/execution-history-contracts.ts` |
| M6 | `tasks/plan-contracts.ts` | `model/plan-contracts.ts` |
| M7 | `configuration/contracts.ts` | `model/configuration-contracts.ts` |
| M8 | `materials/contracts.ts` | `model/material-contracts.ts` |
| M9 | `sessions/contracts.ts` | `model/session-contracts.ts` |
| M10 | `communication/contracts.ts` | `model/communication-contracts.ts` |
| M11 | `evidence/contracts.ts` | `model/evidence-contracts.ts` |
| M12 | `tasks/task-index.ts` | `model/task-index.ts` |
| M13 | `tasks/plan-record-codecs.ts` | `persistence/plan-record-codecs.ts` |
| M14 | `evidence/evidence-record-codecs.ts` | `persistence/evidence-record-codecs.ts` |
| M15 | `persistence/model-request-codecs.ts` | `tasks/model-request-codecs.ts` |
| M16 | `evidence/coverage.ts` | `tasks/evidence-coverage.ts` |
| M17 | `communication/message-record-codecs.ts` | `sessions/message-record-codecs.ts` |
| M18 | `communication/message-body-envelope.ts` | `sessions/message-body-envelope.ts` |

Seven files change their name (M1, M7, M8, M9, M10, M11, M16). In part 2 each file is moved with `git mv <from> <to>`, so its content and history stay. No file is retyped or regenerated.

Every other file under `src/core/work-graph/` stays where it is. These are 83 files, among them all 13 files of `state/`, the two files directly in `src/core/work-graph/`, and these ten newer files: `materials/run-snapshot-decoder.ts`, `persistence/rework-codecs.ts`, `sessions/session-health.ts`, `tasks/entry-plan-reader.ts`, `tasks/goal-control.ts`, `tasks/reconcile-intents.ts`, `tasks/reconcile-reads.ts`, `tasks/requeue-service.ts`, `tasks/run-reconcile-contracts.ts`, `tasks/run-reconcile-service.ts`. Do not split any file, and do not move a declaration from one file to another.

Then every reference must resolve again:

1. **Module specifiers** in every `.ts` file under `src/` and `tests/`, by the rules (a), (b) and (c) below. At this commit the specifiers that must change occur in three forms: `import … from '…'`, `export … from '…'`, and `import('…')` in type positions, in single or double quotes. Dynamic `import(…)` calls and `vi.mock(…)` with relative paths also occur, but none of them names a moved file. `vitest.config.ts` names no moved file.
2. **Two test data locations** name moved files by path:
   - `tests/architecture/production-reach-allowlist.json`: every `"file"` value `src/core/work-graph/<from>` of a moved file becomes `src/core/work-graph/<to>`. Keep the JSON byte for byte otherwise; do not re-serialize the file.
   - `tests/architecture/state-writes.test.ts`: every string `'src/core/work-graph/<from>'` becomes `'src/core/work-graph/<to>'`, and in the list of allowed decoders every `file: '<from>'` (a path relative to `src/core/work-graph/`) becomes `file: '<to>'`.

## The rule for module specifiers

Visit every relative specifier (one that starts with `.`). Resolve it against the importing file's OLD directory (`.js` read as `.ts`). Decide by the file it names, never by its text:

- **(a)** It names one of the 18 moved files (by its OLD path). It becomes the path from the importing file's NEW directory to the target's NEW path, spelled exactly as `path.relative` gives it: `./` for the same directory, and the extension the specifier had (`.js`).
- **(b)** The importing file is one of the 18 moved files. Then every relative specifier in it is spelled as `path.relative` gives it from the file's NEW directory to the file it names, moved or not, even when the old spelling would still resolve. Example: `persistence/model-request-codecs.ts` (M15) imports `'../tasks/model-call-contracts.js'`; after the move to `tasks/` this specifier becomes `'./model-call-contracts.js'`, although the old spelling would still resolve. Exactly four specifiers in the moved files are of this kind (old spelling still resolves, new spelling differs); the example is one of them.
- **(c)** Everything else stays exactly as written, even if `path.relative` would spell it differently. Example: `src/core/agent-runtime/observed-model-run.ts:10` imports `'../../core/workspace/source-identity.js'`. It names `src/core/workspace/source-identity.ts`, a file that does not move, so it stays as it is, although `'../workspace/source-identity.js'` would also resolve.

Files with the same name as a moved file that do NOT move: `src/core/work-graph/queries/contracts.ts`, `src/core/work-graph/architecture/contracts.ts`, `src/core/agent-runtime/contracts.ts`, `src/business/workflow/contracts.ts`, `src/core/agent-runtime/execution-history-contracts.ts`. A specifier that names one of them stays (rule c), except inside a moved file (rule b).

## What must stay true

- No file outside the expected list changes. The expected list is: the 18 moved files, the other files with a specifier change, and the two data files.
- Every specifier you do not need to change stays byte-identical.
- No exported name changes. No re-export files ("shims") at the old paths. No edits to comments, test titles or `docs/`. A comment or a test title that names an old path stays as it is; list it in your report. `docs/refactor/module-target.json` stays unchanged; do not add submodule rules.
- Change only the text inside those specifier strings and those path strings, and keep the quote character the file uses. No reordering or merging of imports, no reformatting.

## Exact size

On this copy the rules give exactly:

- **380 specifier changes in 158 files** = **23 changes in 13 of the moved files** + **357 changes in 145 other files** (under `src/`: 207 changes in 68 files; under `tests/`: 150 changes in 77 files).
- By form: 366 in `import … from`, 9 in `export … from` (all in `src/app/core-http-types.ts`), 5 in `import('…')` types.
- The other 5 moved files (M1, M7, M8, M9, M12) have no specifier change; they only move.
- **12 path strings**: 5 `"file"` values in `production-reach-allowlist.json`, and 7 in `state-writes.test.ts` (4 full `'src/core/work-graph/<from>'` strings and 3 `file: '<from>'` decoder entries).
- So the dry-run listing has exactly **392 lines**.

The dry run must match these numbers before you write anything.

## Write scope and git (both parts)

- Your helper scripts, listings and logs go in `./.dsh-scratch/` (create it), never in `/tmp` or anywhere else. Part 2 deletes it at the end.
- In part 1 you change nothing outside `./.dsh-scratch/`.
- In the whole task: create only the directory `src/core/work-graph/model/` and the moved files (by `git mv`, in part 2), and edit only specifier strings in `.ts` files under `src/` and `tests/` and the 12 path strings above. Do not create, edit, rename or delete any other file, also not in git-ignored places (`dist/`, `.toolchain/`). Do not touch `package.json`, lock files, any config, `vendor/`, `node_modules/` or `docs/`.
- Stay inside the current directory: do not read, list or write any path outside it (no absolute paths outside it, no `..` above it). Everything you need is in this copy.
- Do not install packages. Do not commit.
- Git commands allowed: `git mv` (part 2 only), `git status`, `git diff`, `git grep`. Not allowed: `git add`, `git rm`, `git checkout`, `git restore`, `git stash`, `git reset`, `git commit`.

## Checks (both parts)

Run exactly these commands:

```
npm run typecheck
npm run check:architecture
npx vitest run tests/architecture tests/state tests/work-graph
```

Before the change, the first two exit 0, and the vitest command reports exactly these two lines:

```
 Test Files  3 failed | 68 passed (71)
      Tests  9 failed | 4202 passed | 29 skipped (4240)
```

The failures come from this environment: the check sandbox (`/usr/bin/bwrap`) is not available here. They are exactly: 8 tests in `tests/work-graph/A2-verification-chain.test.ts`; 1 test in `tests/state/invariants-fuzz.test.ts` (`coverage: every kind of operation the row lists actually ran`); and `tests/state/invariants.test.ts`, which fails as a whole suite (`Error: requeue 1: … finalize_first …`) before its 29 tests run, so they are reported as skipped. They are not part of this task; do not touch them. After the change, the three commands must give the same results: the first two exit 0, and vitest shows the same two lines. Do not run any other tests.

## Part 1: step by step

1. Create `./.dsh-scratch/`.
2. Read only this:
   - the import and export lines of the 18 files to move:
     `grep -nE "from ['\"]|import\(['\"]" <each "from" path of the table, under src/core/work-graph/>`
   - the lines of the two data files that name a moved file (12 lines):
     `grep -nE "(tasks/(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs)|configuration/contracts|materials/contracts|sessions/contracts|communication/(contracts|message-record-codecs|message-body-envelope)|evidence/(contracts|evidence-record-codecs|coverage)|persistence/model-request-codecs)\.ts['\"]" tests/architecture/production-reach-allowlist.json tests/architecture/state-writes.test.ts`

   Everything else you need is in this task.
3. Run the three checks once, before any change, and wait for them to finish. Keep their results for CHECKS.
4. Write `./.dsh-scratch/move-tool.mjs` (Node; use the `typescript` package in `node_modules` to find the specifiers). It visits every `.ts` file under `src/` and `tests/` and applies the rules (a), (b) and (c). In part 1 it only plans: it writes the listing and changes no other file.
5. Dry run. Write `./.dsh-scratch/move-dry.txt`, one line per change, tab-separated:

   ```
   <path of the file after the move>	<old text>	<new text>
   ```

   - The path is relative to the repository root, after the move: a moved file under its new path, any other file under its own path.
   - The texts are the specifier or the path string without the quotes.
   - One line per occurrence, also when the same text occurs several times in one file.
   - The 12 path strings use the same format: the path is the data file, and the texts are the strings between the quotes. For example, for `file: 'tasks/plan-record-codecs.ts'` the old text is `tasks/plan-record-codecs.ts`.

   Count the lines by kind: changes and files inside moved files, changes and files in other files, path strings per data file, and the three forms. They must be exactly the numbers of "Exact size". If a count differs, find the wrong or missing lines in the listing and fix the script; do not write any source file.
6. For the report, search the comments and test titles under `src/` and `tests/` for every moved file:
   - by its old directory path, for example `tasks/plan-contracts.ts` or `communication/contracts.ts:95`, with or without `src/core/work-graph/` in front;
   - by its file name alone with `.ts` and without a directory, with or without a line reference, for example `plan-contracts.ts:28-50`, `contracts.ts:36-39` or `claim-contracts.ts`.

   Read each hit and keep the ones that name a moved file. Write them to `./.dsh-scratch/stale.txt` as file:line, together with the search commands you used.
7. Stop after the dry run. Do not run `git mv` and do not change any file under `src/` or `tests/`. Leave `./.dsh-scratch/` with `move-tool.mjs`, `move-dry.txt` and `stale.txt` in place for part 2.

## Your reply to part 1

Reply with these four sections and nothing else:

- DRY RUN: the count line, in this form: `<lines> lines = <n> specifier changes in <n> files (<n> in <n> moved files + <n> in <n> other files) + <n> path strings (<n> + <n>)`; then the counts by form.
- CHECKS: each command and its result before any change (exit code; for vitest the `Test Files` and `Tests` lines).
- UNSPECIFIED: each case this task does not describe that you met, one line each. Then the comment and test-title lines of step 6 as file:line, and the search commands you used. Every claim that something was not found names the command that found nothing.
- NOTES: at most five lines, only if something blocked you or looked wrong in this task.
