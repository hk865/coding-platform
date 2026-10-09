# DSH-BASELINE.md

Written by the lead on the untouched copy, before part 1. Each command ran in this copy, at its baseline commit, in the same sandbox your commands run in.

- `npm run typecheck`: exit 0.
- `npm run check:architecture`: exit 0 (last line `next source boundaries: OK`).
- `npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts` (the first file does not exist yet, so only the second one ran): exit 1.
  - `Test Files  1 failed (1)`
  - `Tests  1 failed | 14 passed (15)`

## Per-file result

| file | tests | passed | failed |
| --- | --- | --- | --- |
| `tests/app/orchestration-mechanism.test.ts` | 15 | 14 | 1 |

## Tests that fail here only because the check sandbox `/usr/bin/bwrap` is missing in this environment

- `tests/app/orchestration-mechanism.test.ts` > `runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls`. Its error: `Task parallel-left stopped: ... "reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"` (thrown at `tests/app/orchestration-mechanism.test.ts:317`).

This is the only failing test of that file here. It is not caused by your change and it is not yours to fix.
