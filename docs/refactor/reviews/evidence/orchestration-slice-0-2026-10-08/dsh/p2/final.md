- FILES CHANGED:
  - `tests/app/S0-attention-edge-label.test.ts` (created in part 1; byte-identical in part 2)
  - `src/app/attention-observer.ts` (modified in part 2, line 504 only)

- CHECKS:
  - `npm run typecheck` — part 1: exit 0; part 2: exit 0.
  - `npm run check:architecture` — part 1: exit 0 (`next source boundaries: OK`); part 2: exit 0 (`next source boundaries: OK`).
  - `npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts` — part 1: exit 1, `Test Files  2 failed (2)`, `Tests  4 failed | 14 passed (18)`; part 2: exit 1, `Test Files  1 failed | 1 passed (2)`, `Tests  1 failed | 17 passed (18)`.
    - `tests/app/orchestration-mechanism.test.ts` — part 1: 1 failed, 14 passed; part 2: 1 failed, 14 passed (same single bwrap failure, matching `DSH-BASELINE.md`).
    - `tests/app/S0-attention-edge-label.test.ts` — part 1: 3 failed, 0 passed; part 2: 3 passed, 0 failed.
  - `sha256sum tests/app/S0-attention-edge-label.test.ts` — `c25de89de95ae78ddede1bacd8c28a47ae844550159e757777227d83b7b11899` (equals the frozen value).
  - `git status --short` — ` M src/app/attention-observer.ts` and `?? tests/app/S0-attention-edge-label.test.ts`; `git diff --numstat` — `1  1  src/app/attention-observer.ts`.

- UNSPECIFIED:
  - The retained part-2 vitest output is tail-only, so the per-file line `tests/app/S0-attention-edge-label.test.ts (3 tests | 3 passed)` is inferred from `Tests 1 failed | 17 passed (18)` plus the orchestration file's `1 failed | 14 passed`; no other test file ran in that command.
  - Nothing else was met beyond the items listed in the part-1 report.

- NOTES:
  - No sentence of this task disagrees with the code I read; the `depends:` edge is on line 504, and the four other edge strings (lines 505, 507, 525, 526) are untouched.
  - The one orchestration-mechanism failure is the pre-listed missing `/usr/bin/bwrap` environment failure, not caused by this change.