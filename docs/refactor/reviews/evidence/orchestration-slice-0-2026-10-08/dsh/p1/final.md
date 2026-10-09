- FILES CHANGED: `tests/app/S0-attention-edge-label.test.ts` (created; the only file changed).

- CHECKS:
  - `npm run typecheck` — exit 0.
  - `npm run check:architecture` — exit 0 (last line `next source boundaries: OK`).
  - `npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts` — exit 1. `Test Files  2 failed (2)`; `Tests  4 failed | 14 passed (18)`.
    - `tests/app/S0-attention-edge-label.test.ts`: 3 failed, 0 passed.
      - `S0-01` — `AssertionError: expected [ 'depends:t1->t2:[object Object]' ] to deeply equal [ Array(1) ]`
      - `S0-02` — `AssertionError: expected { Object (changedElements, nodes, ...) } to deeply equal { changedElements: 2, nodes: +0, …(2) }`
      - `S0-03` — `AssertionError: expected { Object (changedElements, nodes, ...) } to deeply equal { changedElements: 2, nodes: +0, …(2) }`
    - `tests/app/orchestration-mechanism.test.ts`: 1 failed, 14 passed. The single failure is the baseline-listed bwrap test (`runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls`, `ENOENT ... '/usr/bin/bwrap'`), matching its row in `DSH-BASELINE.md`.
  - `git status --short` — exactly `?? .dsh-scratch/` and `?? tests/app/S0-attention-edge-label.test.ts`; `git diff --stat` is empty.

- UNSPECIFIED:
  - The prescribed import list did not name a contract type; I added `import type { DependencyRequirement } from '../../src/contracts/plan.js';` to type the helper parameter.
  - The helper function name, its `scan(requires)` signature shape, the `describe` text and the three `it` titles are not specified; I chose them.
  - Log handling is not specified beyond the scratch rule; I created `.dsh-scratch/` and wrote `typecheck.log`, `architecture.log`, `vitest.log` there.
  - No pre-existing S0 test file was found (`git status --short` and `ls tests/app` show none), so the new path was free.

- NOTES:
  - `deps.messages.readInbox` (src/app/attention-observer.ts:440) is never called by `scan` (src/app/attention-observer.ts:466–543); likewise `readWorkspace` cannot fire because `paths` is empty, so those two specified fakes are inert.
  - I found no sentence of the task that disagrees with the code I read.