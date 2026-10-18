All work is complete; both item subagents and the close-out agent reported, and I re-verified the focused tests and the three commands myself.

**Files changed**

Production (net **+61**): `src/business/workflow/contracts.ts` +8 (optional `failedReviewRefs?: UnknownCallReviewRef[]` on the advance input); `src/business/workflow/workflow.ts` +87/−34 (internal set, parse/validate, merge on every ② failure incl. UR7b, carry on `select_work`/`apply_review_disposition` successors only). `collaboration-driver.ts`: no change (it forwards `next` verbatim).

Tests: `tests/business/K3-46-review-advance-failures.test.ts` +179/−1; new `tests/scenarios/support/process-sandbox-standin.ts` +69; `K3-29-disposition-recovery.test.ts` +2/−55; `K3-44-recovery-answers.test.ts` +2/−55.

**Items**

1. RED: continuous Host-driver test — C never claimed (`expected [] to have a length of 1`), 9 calls, A/B applied repeatedly. GREEN: drive = select → apply A → apply B → claim C → prepare refusal; C's `claim_task` committed, exactly one apply each, both per-card failure texts reported. 6/6 pass.
2. Pure dedup (no behavioural RED): the duplicated `KProcessSandbox` body moved to one factory taking `(actual, hoistedState)`; both files keep their own hoisted state and mock target. Before 3/3 + 2/2; after 5/5 together. No assertion or test-name change.

**Checks** (`--maxWorkers=2`) — 189 files: 173 passed / 16 failed; 4,589 passed / 47 failed / 29 skipped. All 48 failure entries (47 tests + one suite) are DSH-BASELINE §A; no non-baseline failure; `A8-3n` timeout as expected. Focused: 3 files, 11/11. `npm run typecheck`, `npm run check:architecture` (`next source boundaries: OK`), `npm run build` pass. No git writes; scratch removed.

**UNSPECIFIED** (smallest options taken): field name `failedReviewRefs`; empty set omitted from `next`; refs de-duplicated by `canonicalJson`; foreign-project ref → `forbidden`; multiple UR7b failures merge all refs while keeping the first-failure text. Note: the A8-3n "closing unsupported" title in this tree (`K L7, decisions 42 item 2 and 43`) differs from the baseline text (`K L8`); it is the second expected `A8-3n` entry and failed with the expected timeout.