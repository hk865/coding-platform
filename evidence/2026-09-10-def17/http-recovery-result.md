# DEF-17 HTTP integration evidence

New owned files: `tests/app/reviewer-recovery-fixture.ts`, `tests/app/reviewer-product-recovery.test.ts`.

The shared browser/HTTP fixture runs the existing application, SQLite ledger, Runtime, sandbox, Reviewer material tools, report validation and formal evidence chain. The only model substitute is the existing local HTTP protocol responder, which reads material actually delivered to it. The conflicting write lease is committed and released through `WorkspaceLeaseEngineImpl` against the application's real SQLite ledger using the producer's canonical permissions/Run/Attempt/RoleBinding. No SQL facts are manufactured. The helper dynamically loads the current compiled lease implementation so UI TypeScript does not transitively compile backend implementation files under UI-only unused-import rules; final build must precede final HTTP/browser verification.

Command, WSL Node 24 with the repository's normal bubblewrap preflight:

```sh
bash scripts/test-wsl.sh tests/app/reviewer-product-recovery.test.ts
```

- First run: exit 1, 2 failed / 4 passed (`http-recovery-first.log`). Real product defect D17-01: replacement Reviewer reached PASS/FAIL Result/Evidence but disappeared from `/api/state.liveRuns`. Both read models lacked `FailedReviewWorkReplaced` handling in the ActiveAgents initialization path. Original assertions and failure log are preserved. Main Agent fixed the two projections; this was not classified as environment failure.
- After projection fix: exit 0, 1 file / 6 passed / 0 skipped (`http-recovery-after-projection.log`). Assertions retain actual model tool execution, completed visible runtime, Result/Evidence and Task outcome; FAIL blocks completion. They additionally cover old Work/Run/Evidence preservation, request replay and altered-payload refusal, same/different-key concurrency, at most one replacement/ReviewResult, actual HTTP response loss through a forwarding proxy, receipt lookup and replay after restart, 403 without authentication, 400 for proof/actor/verdict or absent explicit authorization, and rejection of an injected ambiguous persisted runtime checkpoint after restart.

Unknown test boundary: the dedicated restart hook changes only the persisted runtime observation to `outcome_unknown`; original canonical crash facts remain unchanged. This verifies contradictory/unknown persistent evidence is refused. Canonical `outcome_unknown`, authorization-only restart and Control-commit/receipt-loss restart are separately covered by the core recovery tests. The HTTP loss test reopens after the actual Reviewer result has settled; it does not claim a mid-model process-kill test.

Backend type check passed during implementation (`http-types-progress.log`). An initial Windows attempt used a nonexistent `node_modules/typescript/bin/tsc` path (MODULE_NOT_FOUND); no compiler ran at that path. Verification used the already configured WSL `.local/linux-test-tools` compiler. Final whole-source type/build/test/browser and independent review remain the Main Agent's integration acceptance.
