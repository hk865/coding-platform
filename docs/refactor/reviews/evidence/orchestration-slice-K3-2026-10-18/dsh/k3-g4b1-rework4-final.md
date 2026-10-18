All work is complete; both item subagents and the close-out agent reported, and I re-verified the focused file, the final broad run, and the RED probe against exported HEAD.

**Files changed**

Production net **+81**: `contracts.ts` +9 (field leaves the public input; new `WorkflowAdvanceInternal`; result `failedReviewRefs` beside `next`); `ports.ts` 0 (optional third arg); `workflow.ts` +51 (public key → `invalid` naming it, internal parse/merge, `readyValue` moves the set out of `next`); `collaboration-driver.ts` +21 (handle carry, third arg, drop on end/non-continuation/stop). `core-routes.ts` untouched (still two args).

Tests net **+137**: `K3-46-review-advance-failures.test.ts` +133 (new input/route cases; driver wrapper only forwards the internal arg, assertions unchanged); `A2-startup-redrive-select.test.ts` +4 (pre-existing non-baseline fixture gap fixed with an empty `reviews.listReviews` stub).

**Item RED → GREEN**

RED against exported HEAD (r3): 3 failed / 5 passed — forged same-project answered ref accepted (`ready`, not `invalid`), old `next` still owned `failedReviewRefs`, old foreign ref answered `forbidden`. GREEN: 8/8 — real answered card ref through the real route/direct call → `invalid` naming the key; the card still applies on a following keyless advance; a failing apply returns the set beside a continuing `next`, never inside it; continuous driver still 5 calls, A/B once each, C claimed, both reasons.

**Checks** (`--maxWorkers=2`): 256 files, 232 passed / 24 failed; 5,017 passed / 57 failed / 29 skipped. All 57 tests plus the `invariants` suite are DSH-BASELINE §A (no bwrap, AG2b timeouts, A8-3n timeout, downstream assertions); `A8-3n` title drift K L7 as before. `typecheck`, `check:architecture` (`next source boundaries: OK`), `build`: exit 0. `.dsh-scratch` empty; no git writes.

**UNSPECIFIED** (smallest, consistent with rework-3): result field name `failedReviewRefs`; empty set omitted; internal extra keys accepted; internal `{failedReviewRefs: undefined}` treated as empty; foreign internal ref still `forbidden`.