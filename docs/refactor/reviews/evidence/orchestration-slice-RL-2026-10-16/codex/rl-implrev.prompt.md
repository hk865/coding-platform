Implementation review of the resource-limit slice (RL) before merge. Read-only: do not edit files, do not run tests,
do not call any model. You may read any file in this repository and in D:/cc-lead-notes.

Repository: the current directory. HEAD dfe3cc9a (slice 2C merged). The index holds slice RL as it will be merged
(`git diff --cached HEAD`, 59 files, including `vendor/coding-agent/patches/**`, `scripts/build-kernel-patch.mjs` and
11 regenerated `vendor/coding-agent/dist/**` files). The lead re-ran `build-kernel-patch.mjs --write` on this tree: the
regenerated dist is byte-identical to the builder's, and `--check` matches all 60 artifacts. Typecheck, boundary check
and build pass. The RE1 tests (real bubblewrap + systemd user session) have NOT run yet; the lead runs them in WSL.

Frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-RL-SPEC.md` (L1–L16, §2 contracts, §5 rows
RL-01…RL-44 with entries RE0–RE3, §6 files, §7). Task book with the lead's amendments A1–A6 and answers P1–P11:
`D:/cc-lead-notes/impl/rl/rl-impl.md`. Builder's report: `D:/cc-lead-notes/impl/rl/final-1.md` (read its UNSPECIFIED
list). Pre-read: `D:/cc-lead-notes/impl/rl/rl-preread-final.md`. This is also the place where L16 (the rework notice
reads `cap_hit` from the round's check snapshot `resourceCapHit`, written by `recordCheckResult` in the same commit; the
requeue notice reads its `afterRoundRef` round, the reverify notice the round it continues from; read-only, at most one
extra round read per notice) gets its first review: Codex's spec passes for RL were used up.

Review, citing file:line:
1. The kernel patch (`process-sandbox.ts`, `shell-tool.ts`, `public-api.ts`): the capped execute path (systemd-run
   scope, keeper, gate fds, observation, quiescence, recheck, settlement), attribution of OOM / pids events, the stop
   and escalation paths, the probe and its caching, the L10 tail notes — against L1–L10 and P3–P5; races, leaked
   processes or scopes, fds, and any path where a failed observation becomes a definite "no cap hit".
2. Runtime / Host / composition (L11–L15): settings parsing, defaults and the effective caps, the probe at start, the
   private snapshot (no leak into manifests), check execution, the read-only command tool, the workbench tools, Query.
3. L16 end to end (evidence codecs, `evidence-service`, `verification-machine`, `automatic-rework-notices`): same
   commit, legacy decode, both notice branches, read failures.
4. Tests: business behaviour through public interfaces, literal expectations, no database reads, no product functions
   as oracles; RE1 tests have no skip guards (A3) and would really fail if the behaviour broke; fake `systemd-run`
   fixtures cannot pass vacuously.
5. The builder's open points, each with your recommendation: (a) `tests/app/A2-settings-automation.test.ts:65,:129`
   use exact whole-snapshot `toEqual` and fail with the always-present `resourceCaps` (spec §5.3 assumed
   `toMatchObject`); (b) `NoticeItemV1` has no `actions` field — add it (scope expansion) or not; (c) UNSPECIFIED 2,
   3, 5–8.

Reply under 1,800 words: numbered must-fix items (each with the concrete change), then should-fix, then your answers to
5(a)–(c), then a one-line verdict ("merge", "merge after listed fixes" or "not ready").
