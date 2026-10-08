I have completed part 1. Final reply follows.

## DRY RUN

392 lines = 380 specifier changes in 158 files (23 in 13 moved files + 357 in 145 other files) + 12 path strings (5 + 7)

By form: `import … from` 366, `export … from` 9, `import('…')` type positions 5, dynamic `import(…)` 0. Split: other files under `src/` 207 changes in 68 files; under `tests/` 150 in 77 files. Path strings: `production-reach-allowlist.json` 5, `state-writes.test.ts` 7. No-op lines: 0. Listing written to `.dsh-scratch/move-dry.txt` by `.dsh-scratch/move-tool.mjs`. Moved files with zero changes: M1, M7, M8, M9, M12 (matching the task).

## CHECKS

- `npm run typecheck` → exit 0
- `npm run check:architecture` → exit 0 (last line `next source boundaries: OK`)
- `npx vitest run tests/architecture tests/state tests/work-graph` → exit 1 (expected environment failures)
  - ` Test Files  3 failed | 68 passed (71)`
  - `      Tests  9 failed | 4202 passed | 29 skipped (4240)`

## UNSPECIFIED

- `tests/architecture/boundaries.test.ts:354` has relative specifier `../../scripts/check-boundaries.mjs` (`.mjs`, not `.js`); neither end moves, so rule (c) leaves it unchanged (noted, not changed).
- Step-6 searches also matched data, not comments/titles: the 7 `state-writes.test.ts` entries and all `production-reach-allowlist.json` entries; excluded from `stale.txt` because they are already the 12 dry-run path strings.
- The bare-basename search matched `src/contracts/architecture-catalog.ts:5` (`architecture/catalog-contracts.ts`); not a moved file, excluded.
- Bare `contracts.ts` is ambiguous (10 files); the 8 hits are all in `state/message-machine.ts`, whose line 58 says "structurally identical to communication/contracts.ts:36-145", so all 8 name M10.
- Listing order is unspecified: specifier lines sorted by post-move path then source position, then the 12 path strings.
- No comment/test-title hit found for: `tasks/contracts.ts`, `tasks/execution-read-contracts.ts`, `tasks/execution-history-contracts.ts`, `configuration/contracts.ts`, `materials/contracts.ts`, `evidence/contracts.ts`, `persistence/model-request-codecs.ts`, `communication/message-record-codecs.ts`, `communication/message-body-envelope.ts`; commands that found nothing: `grep -rnE 'tasks/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'tasks/execution-read-contracts\.ts' src tests --include=*.ts`, `grep -rnE 'tasks/execution-history-contracts\.ts' src tests --include=*.ts`, `grep -rnE 'configuration/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'materials/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'evidence/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'persistence/model-request-codecs\.ts' src tests --include=*.ts`, `grep -rnE 'communication/message-body-envelope\.ts' src tests --include=*.ts`; `grep -rnE 'communication/message-record-codecs\.ts' src tests --include=*.ts` matched only the non-comment data line `tests/architecture/state-writes.test.ts:170`.

Search commands used (also recorded in `.dsh-scratch/stale-search.log` and `.dsh-scratch/stale.txt`):

```
for f in tasks/contracts.ts tasks/claim-contracts.ts tasks/execution-entry-contracts.ts \
         tasks/execution-read-contracts.ts tasks/execution-history-contracts.ts tasks/plan-contracts.ts \
         configuration/contracts.ts materials/contracts.ts sessions/contracts.ts communication/contracts.ts \
         evidence/contracts.ts tasks/task-index.ts tasks/plan-record-codecs.ts \
         evidence/evidence-record-codecs.ts persistence/model-request-codecs.ts evidence/coverage.ts \
         communication/message-record-codecs.ts communication/message-body-envelope.ts; do
  grep -rnE "$f" src tests --include=*.ts
done

grep -rnE "\b(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs|evidence-record-codecs|model-request-codecs|coverage|message-record-codecs|message-body-envelope)\.ts" src tests --include=*.ts

grep -rnE "\b(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs|evidence-record-codecs|model-request-codecs|coverage|message-record-codecs|message-body-envelope)\.ts" src tests
```

Comment/test-title lines naming a moved file (38; written to `.dsh-scratch/stale.txt`):

```
src/contracts/core/task-claim.ts:6
src/contracts/core/session-message.ts:6
src/core/work-graph/state/attempt-machine.ts:32
src/core/work-graph/state/attempt-machine.ts:48
src/core/work-graph/state/attempt-machine.ts:58
src/core/work-graph/state/message-machine.ts:6
src/core/work-graph/state/message-machine.ts:43
src/core/work-graph/state/message-machine.ts:58
src/core/work-graph/state/message-machine.ts:61
src/core/work-graph/state/message-machine.ts:67
src/core/work-graph/state/message-machine.ts:76
src/core/work-graph/state/message-machine.ts:85
src/core/work-graph/state/message-machine.ts:95
src/core/work-graph/state/message-machine.ts:104
src/core/work-graph/state/message-machine.ts:112
src/core/work-graph/state/message-machine.ts:155
src/core/work-graph/state/run-machine.ts:342
src/core/work-graph/state/run-machine.ts:353
src/core/work-graph/state/verification-machine.ts:41
src/core/work-graph/state/verification-machine.ts:82
src/core/work-graph/state/verification-machine.ts:84
src/core/work-graph/state/verification-machine.ts:86
src/core/work-graph/state/verification-machine.ts:804
src/core/work-graph/state/plan-machine.ts:32
src/core/work-graph/state/plan-machine.ts:61
src/core/work-graph/state/plan-machine.ts:64
src/core/work-graph/state/plan-machine.ts:67
src/core/work-graph/state/plan-machine.ts:70
src/core/work-graph/state/plan-machine.ts:80
src/core/work-graph/state/plan-machine.ts:87
src/core/work-graph/state/session-availability.ts:32
src/core/work-graph/state/goal-machine.ts:815
src/core/work-graph/architecture/catalog-record-codecs.ts:13
src/core/work-graph/tasks/completion.ts:23
src/core/work-graph/tasks/completion.ts:24
tests/state/plan-machine.test.ts:298
tests/state/verification-machine.test.ts:948
tests/state/attempt-machine.test.ts:705
```

## NOTES

- All Exact-size checks tie out (23/13, 357/145, 207/68, 150/77, 366/9/5, 5+7) with zero no-op lines.
- `git status --short` shows only `?? .dsh-scratch/`; no file under `src/` or `tests/` was changed in part 1.
- `move-tool.mjs` is dry-run only (writes `move-dry.txt`); it will need an apply path in part 2.
- The M15 example line is present: `src/core/work-graph/tasks/model-request-codecs.ts	../tasks/model-call-contracts.js	./model-call-contracts.js`.