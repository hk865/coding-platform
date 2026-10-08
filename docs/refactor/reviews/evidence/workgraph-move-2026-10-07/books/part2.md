# Part 2 of 2: apply the listing

The lead compared your listing with the expected changes: they match. Now apply it. Everything in part 1 still holds: the rules (a), (b) and (c), what must stay true, the write scope and the git rules, and the checks with their numbers.

## Part 2: step by step

1. `mkdir -p src/core/work-graph/model`
2. Run these 18 commands exactly:

   ```
   git mv src/core/work-graph/tasks/contracts.ts src/core/work-graph/model/task-contracts.ts
   git mv src/core/work-graph/tasks/claim-contracts.ts src/core/work-graph/model/claim-contracts.ts
   git mv src/core/work-graph/tasks/execution-entry-contracts.ts src/core/work-graph/model/execution-entry-contracts.ts
   git mv src/core/work-graph/tasks/execution-read-contracts.ts src/core/work-graph/model/execution-read-contracts.ts
   git mv src/core/work-graph/tasks/execution-history-contracts.ts src/core/work-graph/model/execution-history-contracts.ts
   git mv src/core/work-graph/tasks/plan-contracts.ts src/core/work-graph/model/plan-contracts.ts
   git mv src/core/work-graph/configuration/contracts.ts src/core/work-graph/model/configuration-contracts.ts
   git mv src/core/work-graph/materials/contracts.ts src/core/work-graph/model/material-contracts.ts
   git mv src/core/work-graph/sessions/contracts.ts src/core/work-graph/model/session-contracts.ts
   git mv src/core/work-graph/communication/contracts.ts src/core/work-graph/model/communication-contracts.ts
   git mv src/core/work-graph/evidence/contracts.ts src/core/work-graph/model/evidence-contracts.ts
   git mv src/core/work-graph/tasks/task-index.ts src/core/work-graph/model/task-index.ts
   git mv src/core/work-graph/tasks/plan-record-codecs.ts src/core/work-graph/persistence/plan-record-codecs.ts
   git mv src/core/work-graph/evidence/evidence-record-codecs.ts src/core/work-graph/persistence/evidence-record-codecs.ts
   git mv src/core/work-graph/persistence/model-request-codecs.ts src/core/work-graph/tasks/model-request-codecs.ts
   git mv src/core/work-graph/evidence/coverage.ts src/core/work-graph/tasks/evidence-coverage.ts
   git mv src/core/work-graph/communication/message-record-codecs.ts src/core/work-graph/sessions/message-record-codecs.ts
   git mv src/core/work-graph/communication/message-body-envelope.ts src/core/work-graph/sessions/message-body-envelope.ts
   ```

3. Apply the 380 specifier changes of `./.dsh-scratch/move-dry.txt`. Edit only the text between the quotes, and keep the quote character the file uses.
4. Apply the 12 path strings in the two data files with exact text edits. Do not re-serialize the JSON file.
5. Verify before the checks:

   ```
   git status --short           # 18 renames and 147 modified files (145 with specifier changes + the 2 data files); nothing else except ./.dsh-scratch/
   git diff -M HEAD --numstat   # 165 files; each has as many added as deleted lines; the 5 moved files without a specifier change show 0 0
   git diff -M HEAD             # every changed line differs only inside one specifier string or one path string
   ```

   Count the changed specifiers and path strings in the diff. They must be the 380 and the 12 of part 1.
6. Run the three checks. If one fails, read its first error (file and line), fix the cause in your edit, and run all three again. Repeat until all three pass and vitest shows the two lines of part 1.
7. Delete `./.dsh-scratch/` with everything in it, and any other helper or log file you created. `git status --short` then shows no untracked file.

## Final report

Reply with these four sections and nothing else:

- FILES CHANGED: the 18 moves (from → to), then the number of other files you edited, then their paths one per line.
- CHECKS: each command and its result after the change (exit code; for vitest the `Test Files` and `Tests` lines), next to the result before the change.
- UNSPECIFIED: each case this task does not describe that you met, one line each. Then every comment or test title under `src/` and `tests/` that names a moved file by its old directory path, or by its file name alone, with or without a line reference, as file:line (your list of part 1, checked again), with the search commands you used; confirm that you changed nothing for them. Every claim that something was not found names the command that found nothing.
- NOTES: at most five lines, only if something blocked you or looked wrong in this task.
