# MC-A1 bounded closeout — 2026-09-09

The user requested closeout. MC-A1 stops here; this is a partial module implementation, not completion of stage A or the full product. No commit, reset, cleanup of the user's worktree, app wiring, or shared-document update was performed by this lane.

HEAD: `65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d`. Exact final observed hashes for 15 implementation/test files are in `a1-closeout-sha256.json`, captured at 2026-09-09T15:33:22+08:00. Shared-file hashes include retained pre-existing and other authorized module edits; they do not claim exclusive A1 ownership.

## Implemented within the ticket

- `MaterialBasisV1.sourcePin` binds Project, Workspace, explicit file/subtree selection, host workspace identity, HEAD commit and a content manifest. The existing producer-defined `sourceDigest` keeps its meaning and cannot alone establish currentness.
- `WorkspaceSourceApplicability.capture` reads a complete permission-filtered inventory and file contents twice; unchanged selected source remains valid, observable edits/additions/deletions/renames and Git identity changes invalidate the pin. Incorrect scope, missing capabilities, unsafe paths, unavailable inputs or incomplete inventory fail closed.
- Both harnesses accept optional `sourceApplicability`; persistent reopen preserves the injected capability. The resolver performs source I/O before final canonical Plan/Workspace/grant checks, including revocation committed during the source read. It does not infer authority from a stale projection.
- Vault `usage:'current'` requires an applicable non-history grant, a source pin and trusted source validation. Legacy non-history grants containing only `sourceDigest` now return stale, even if a caller repeats the old digest. Explicit history stays readable only as historical explanation and preserves the original owner; the result marks `record.applicability:'historical_explanation'`.
- Shape/scope validation applies through Control and both Ledger adapters. Null Plan/Workspace dimensions retain their prior semantics; this lane did not broaden them.

Public host seam:

```ts
const capability = new WorkspaceSourceApplicability(scope => permissionCheckedSourceAccessOrNull);
const captured = await capability.capture({
  projectId, workspaceId,
  sourceSet: { kind: 'workspace_paths', paths: ['src'] },
});
// Persist captured.pin in the exact grant's basis.sourcePin.
// Pass capability as harness option sourceApplicability.
// Current-use callers explicitly request usage: 'current'.
```

## Actual verification

All shell calls below ran from `D:\1.project\Software\agent_platform`, through WSL Ubuntu-24.04 and the configured Linux test runner. Model calls: none. No browser or benchmark acceptance was run by A1.

1. `a1-tests-1.log`: 22 pass / 1 fail. New SQLite test setup omitted its state directory; fixed the fixture by creating that directory.
2. `a1-tests-2.log`: 5 files / 23 pass, 14.43s. Included an independent Node PID reopening persisted SQLite state and re-reading actual source files.
3. `a1-tests-3.log`: 10 files / 39 pass, 21.05s, before the final racing-revocation assertion.
4. `a1-tests-4.log`: 38 pass / 1 timeout. The newly added SQLite race fixture waited for a source-capture barrier after the read had already returned stale. On reopen the default deterministic event ID sequence reset; the next grant reused a seen event ID, so the projection did not expose the new candidate. This was not fixed by increasing timeout.
5. `a1-closeout-diagnosis-1.log`: 1 pass / 1 explicit failure in 15.50s. Monitoring the read's early completion exposed the previously hidden barrier path.
6. `a1-closeout-local-1.log`: 2 pass, 14.48s, SQLite test body 4.85s. Test dependency injection now keeps event IDs unique across reopen, asserts the actual projected candidate before the race, and fails if the read finishes before entering capture. The original 60s outer timeout is unchanged.
7. **Final `a1-closeout-tests.log`: 10 files / 39 pass, 18.55s; exit 0.** Source changes without Workspace counter updates, same-source validity, source-scope mismatch, unavailable capability, legacy digest rejection, history/current separation, original owner, both adapters, projection lag, revocation during source capture, idempotency, >256 candidates, projection rebuild and an independent Node reopen were exercised.
8. **Final `a1-closeout-types.log`: TypeScript check exit 0, empty error log.** Earlier `a1-types-1.log` and `a1-types-2.log` contained then-current failures in other concurrently edited test files; A1 did not alter those files.

Final test command:

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /mnt/d/1.project/Software/agent_platform && bash scripts/test-wsl.sh tests/data/source-applicability.test.ts tests/restart/material-source-applicability.test.ts tests/restart/material-access-restart.test.ts tests/restart/material-revocation.test.ts tests/vault/material-access-grant.test.ts tests/contracts/material-access.test.ts tests/control/material-access.test.ts tests/read-model/material-access-lookup.test.ts tests/read-model/material-access-projection.test.ts tests/sqlite-read-model/material-access-projection.test.ts > evidence/2026-09-09-module-completion/a1-closeout-tests.log 2>&1'
```

Final typecheck command:

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /mnt/d/1.project/Software/agent_platform && node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > evidence/2026-09-09-module-completion/a1-closeout-types.log 2>&1'
```

The existing authorization/restart suite now uses a source-unbound basis for its original candidate-lookup/authorization assertions. Actual source-current assertions, including old-digest rejection, are in the new source-applicability tests; the old synthetic digest is not presented as a trusted source.

## Remaining architecture/integration work

1. **App injection and current-consumer migration remain undone.** `src/app/service.ts` does not yet inject this source capability. Existing exploration current-use grants/readers must capture and persist the exact pin and use `usage:'current'`. Their old digest-only grants now fail closed; do not silently relabel them current or copy bodies to change owner. Root owns this integration; this lane stops without touching it.
2. The provider supports permission-checked text sources: at most 60000 inventoried files, 2 MiB per file, 128 MiB per selected snapshot. Binary/oversize/incomplete selections explicitly return unavailable. A generic binary source identity path and wider production project acceptance are unimplemented; arbitrary whole-workspace coverage is not claimed.
3. Two observations are not a multi-file atomic snapshot. Consumers still need their existing version/lease checks when applying results after reading them. Authorization does not establish the semantic truth of a report.
4. The default deterministic harness event sequence resets on reopen; write-after-reopen fixtures must inject stable unique IDs. The observed event-ID reuse/projection-deduplication behavior should be audited separately at the Ledger/host contract boundary. This lane corrected its test injection only and did not change Ledger event identity policy.
5. The independent process test performs a graceful parent close, fresh child read, and projection rebuild. It is not OS-kill or crash-in-the-middle acceptance. Real model input consumption, browser behavior, production workspace sandbox injection and full A–G acceptance remain unverified.

All remaining items are handed back for the architecture repair list. A1 performed no further work after this closeout.
