**K3 G4 B2 — reply**

**FILES CHANGED.** Production **14 files, +547/−109 (net +438)**; soft budget 1,200. `contracts/continuation-brief.ts`, `contracts/core/prepared-execution.ts`, `contracts/review-admission.ts`; `agent-runtime/{context-assembler,execution-driver,execution-preparation,observed-model-run,unknown-call-review-tools}.ts`; `work-graph/{state/unknown-call-review,tasks/execution-entry-service,tasks/unknown-call-review-card,tasks/unknown-call-review-service,views/decision-read-model}.ts`; `business/workflow/workflow.ts` (comments only). Tests: 8 modified + 7 new tests + 2 helpers; +2,743 lines.

**Scope.**
0. **Done.** Both stale comments now say the failed-card set arrives as `advanceWork`’s internal third argument and leaves beside `next`; no behaviour.
1. **Done.** `awaiting_proposal` admits/prepares/starts a real proposal round (phase-specific tool set, control-only input). Its input lists each target’s alias/command, conclusions, disposition text and annotations, and the mixed platform line. Review input is byte-identical.
2. **Done.** `propose_safer_method` + `recordProposal` (L14 identity/replay/replacement; command 1–4,000 B, cwd null/1–512 B, rationale 1–2,000 units; 5,120 B budget; M3; `proposalId` = write identity). `approvedMethodLinesZh` moved once to the contract and used by state measurement and renderer.
3. **Done.** Normal → `awaiting_approval`; missing → `needs_decision` + `proposal_missing`; second unfinished → +`review_incomplete`; UCR-08c → `review_unavailable` + `proposal_missing`, zero model calls.
4. **Done.** Approval card projects `approve`/`decline` (`同意`/`不同意`, separate map), each original command, the exact approved-method block and the mixed line; option required; first/old card → `revision_conflict`.
5. **Done.** `applyDisposition` handles `approval` through the same identity/replay/proof path. Approve → `resolved` + `approvedMethods` (alias ascending) + `blockedCommands: []`; decline → `needs_decision`, `proposal_declined`, `choice` stays `safer_method`, approval recorded, four/three-option card returns.
6. **Done.** Mandatory approved-method block between targets and platform lines; safer-method disposition wording; platform line; over-budget → `ContinuationBriefCapacityError` → prepare `capacity`.

**Rows (RED → GREEN).**
- **K3-16**: owner RED `unsupported` → 7 GREEN; tool RED unregistered → 6; input RED review block → 3; real round RED wrong permissions → 2; approval e2e → 1; continuation → 1. Approve ends with `blockedCommands: []`.
- **K3-19 (二)**: 2 pass. No new RED: it exercises the existing UCR-08c path; the new coverage is zero model calls and exact reasons.
- **K3-35 (二)(三)**: RED `ContinuationBriefCapacityError` not thrown / prepare `ready`; GREEN 19/19. Hand totals: worst brief 15,758 B (mandatory 15,689 + 68-byte omission note + 1 join); method block exactly 5,120 (31×159 + 160 + 31 joins); T=600 → 16,393 B → capacity.
- **K3-46 (二)**: owner-level mixed card RED `not_available`; GREEN (card/approval + platform line). A real single-crash fixture yields one process item, so mixed is owner-level only (UNSPECIFIED 6).
- **K3-48 (二)** propose half: RED `capacity` mismatch under a probe; GREEN memory+SQLite.
- **K3-15 safer branch**: covered from the real card answer through proposal/approval (10 owner tests + 1 e2e).
- **K3-29 variant (c)**: RED permissions before `awaiting_approval`; GREEN 3/3, now ends at the approval card.
- **K3-18** stays green (four-label map untouched).

**Old flips.** `tests/contracts/review-admission.test.ts`: before `proposal_phase_unsupported`; after proposal+review set → `tool_set_mismatch`, proposal+proposal set → `null`, proposal+ordinary tools/bad facts → `tool_set_mismatch`. `tests/runtime/K3-19-review-admission.test.ts`: before `proposal_phase_unsupported`; after injected proposal with review-set manifest → `tool_set_mismatch`, 0 model calls. `production-reach-allowlist.json` `recordProposal` entry removed.

**B3 left.** Real `blockedCommands` (L19a) on approve and the 62-byte blocked sentence in the continuation + K3-35 (二) extension; `request_command_rerun`; the two-crash mixed-card e2e fixture; B3’s rulings 2–6.

**CHECKS** (all `--maxWorkers=2`): **285 files / 5,472 tests → 5,375 pass, 68 fail (all `DSH-BASELINE` §A; no new failure), 29 skipped.** Groups: K3/K 107/582 (567 pass); S5/S4C2 49/496 (495); business 20/185 (184); WP1/A8 7/44 (20); state+composition+app+arch 85/4,087 (4,036); brief 6/20 (15); session files 11/58 (all pass). `typecheck` 0; `check:architecture` 0; `build` 0.

**UNSPECIFIED** (smallest options):
1. Proposal input drops the review-only item list/two questions; options: drop both (chosen) or keep the list and drop the questions.
2. Added `platformTargets: number[]` to `UnknownCallReviewInputV1` (lead named only `annotations`) so entry re-render reproduces the mixed line; alternative: render it outside the structured copy (breaks re-render).
3. Tool accepts explicit `cwd: null` as well as absent (spec says optional string); alternative: reject null.
4. Approval card keeps B1’s “需要你决定” base line (lead: B1’s first line); no approval-specific wording invented.
5. Internal `b1Unavailable` name kept, now always false.
6. Mixed-card e2e uses an owner-level fixture; a real two-crash Host fixture is left to B3.

**Subagents.** A foundation (35m), B proposal round (35m), C card/application (30m + 10m follow-up), D continuation (30m), E close-out (20m); most at once **3** (B/C/D); follow-ups 2. No git writes, no model calls, no scratch left.

**Surprising.** Without B3’s 62-byte sentence, T=600 overflows by only **9** bytes (the spec’s 93 is with it). Alias order cannot change the joined byte total, so ascending measurement is observable only through stored/written order. `createK3NeedsDecisionRecord` cannot build a clean process-item `needs_decision`, so the approval owner test uses the real `settle_review` path.