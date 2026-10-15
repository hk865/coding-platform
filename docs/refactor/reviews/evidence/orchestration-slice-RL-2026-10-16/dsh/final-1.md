All section 8 checks are done and the tree is clean of scratch. Here is the final report.

# Slice RL — final reply

## FILES CHANGED (all within L-scope; `git status --short` shows only these)

**Kernel patch sources** (`vendor/coding-agent/patches/`, `dist` only via `--write`)
- `sandbox/process/process-sandbox.ts` — §2 types, `RESOURCE_CAP_NONE_TEXT`, `parse/merge/attribute/settleExecution`, cached `probeResourceCaps`/`resourceCapStatus`, capped `execute` path (systemd-run + keeper + gate fd4/5 + observation/quiescence/recheck + settlement).
- `tools/builtin/shell/shell-tool.ts` — L10: JSON `resourceCaps`, tail notes on `shell 退出码 N` / `shell 执行超时`.
- `public-api.ts` — the three value exports.
- `scripts/build-kernel-patch.mjs` — `relativeSources` + `tools/builtin/shell/shell-tool.ts`.
- `dist/**` — 11 files regenerated through `--write` only.

**Contracts** — new `src/contracts/resource-caps.ts`; type-only additions in `src/contracts/verification.ts`.

**Runtime** — `execution-contracts.ts`, `observed-model-run.ts`, `execution-driver.ts`, `query-execution.ts`, `readonly-command-tool.ts`, `check-execution.ts`.

**Host / composition** — `src/app/host.ts`, `host-settings.ts`, `host-settings-types.ts`, `workbench-tools.ts`, `main.ts`; `src/composition/create-platform.ts`.

**WorkGraph (L16)** — `persistence/evidence-record-codecs.ts`, `evidence/evidence-service.ts`, `state/verification-machine.ts`, `views/automatic-rework-notices.ts`.

**Tests** — A2 edit `tests/kernel/B2-history-public-export.test.ts` (only existing test changed); new `RL-*` tests under `tests/{kernel,contracts,runtime,app,work-graph}/`; new fixtures `tests/helpers/RL-{resource-caps-support.ts,fake-systemd-run.sh,memory.py,fork.py,thread.py,child-node.mjs,kernel-sandbox-double.ts,re2-support.ts,query-fixture.ts}`. No allowlist entries were needed.

## A4 extraction step
Extracted `tools/builtin/shell/shell-tool.ts` verbatim from `dist/tools/builtin/shell/shell-tool.js.map` `sourcesContent[0]`; **SHA-256 `181b360030614bdba8ddfb6000de10f7febb9f43568e1ca7ac864d13112ae35f`** (matches the lead's `181b3600…ae35f`). Added to `relativeSources`, ran `--write` then `--check` (exit 0); at that point `git diff --stat -- vendor/coding-agent/dist` was **empty** (all four shell-tool artifacts byte-identical). Only afterwards were the two L10 edits made.

## Per row (test → implementation → RED/GREEN)
RE0 (pass here)
- **RL-20** `tests/kernel/RL-20-resource-cap-attribution.test.ts` (17) → `process-sandbox.ts:attributeResourceCapEvents/parseResourceCapCounters/mergeResourceCapCounters` — RED `parseResourceCapCounters is not a function` / GREEN 17.
- **RL-21** `tests/contracts/RL-21-default-resource-cap-settings.test.ts` (8) → `src/contracts/resource-caps.ts:defaultResourceCapSettings` — RED unresolved import / GREEN 8.
- **RL-22** `tests/kernel/RL-22-settlement.test.ts` (20) → `process-sandbox.ts:settleExecution` — RED `settleExecution is not a function` / GREEN 20.

RE1 (written, not run here — A3)
- **RL-01/02/02b/02c** `tests/kernel/RL-01-02-caps-effect.test.ts` → `ProcessSandbox.execute/#runCapped` — failure: `Error: RL RE1 environment unavailable (no bubblewrap / systemd user session): ENOENT … access '/usr/bin/bwrap'` (RL-02/02b: `ProcessSandboxError: 隔离进程能力不可用`).
- **RL-03/03b/03c/04/05** `tests/kernel/RL-03-05-oom-pids.test.ts` → `#runCapped`/`attributeResourceCapEvents` — `ProcessSandboxError: 隔离进程能力不可用`.
- **RL-06/07/07b/08/08b/09/09b/10(a–d)/10b/10c/11** `tests/kernel/RL-06-11-stop.test.ts` → `settleExecution/#runCapped` + `RL-child-node.mjs` — `RL RE1 environment unavailable … /usr/bin/bwrap`.
- **RL-12/13/13b/14(KB-01/03/04/05)/15** `tests/kernel/RL-12-15-conditions.test.ts` → `execute`/`probeResourceCaps`/`#runCapped` — RL-12/14 `RL RE1 environment unavailable … /usr/bin/bwrap`; RL-13 `AssertionError: fail-bus: expected 'no_cgroup_v2' to be 'no_user_session'` (this sandbox cannot read `/sys/fs/cgroup/cgroup.controllers`); RL-13b `隔离进程能力不可用`; RL-15 `expected { status: 'unavailable' } to deeply equal { status: 'available' }`.

RE2 (pass here)
- **RL-30** `tests/runtime/RL-30-shell-resource-caps.test.ts` (8) → `shell-tool.ts:resourceCapTail` + `observed-model-run.ts:308` — RED (g) test timeout line 112 / GREEN.
- **RL-31** `tests/runtime/RL-31-readonly-resource-caps.test.ts` (16) → `readonly-command-tool.ts:90/253/283` — RED :218/:247 / GREEN.
- **RL-32** `tests/runtime/RL-32-check-resource-caps.test.ts` (3) → `check-execution.ts:55/233` — RED :79 / GREEN.
- **RL-33** `tests/app/RL-33-workbench-resource-caps.test.ts` (2) → `workbench-tools.ts:60/128/523` — RED :68/:90 / GREEN.
- **RL-34** `tests/app/RL-34-wiring-resource-caps.test.ts` (7) → `create-platform.ts`/`execution-contracts.ts`/`observed-model-run.ts`/`execution-driver.ts`/`query-execution.ts`/`host-settings.ts`/`host.ts` — RED :71 / GREEN.
- **RL-35/36** `tests/runtime/RL-35-36-sandbox-and-retry.test.ts` (9) → existing refusal wiring + `check-execution`/`workbench-tools` — GREEN.
- **RL-32b** `tests/work-graph/RL-32b-rework-notice-memory-cap.test.ts` (4) → `evidence-service.ts:resourceCapHitOf`, `verification-machine.ts:transitionCheck`, `evidence-record-codecs.ts:checkSnapshotProblem`, `automatic-rework-notices.ts:withResourceCapHit` — RED :100/:105 / GREEN.

RE3 (pass here)
- **RL-40/41/42/43** `tests/app/RL-40-43-resource-cap-settings.test.ts` (20) → `host-settings.ts:parseStoredResourceCaps/effectiveResourceCaps/privateSnapshot/snapshotOf/saveResourceCapsRoute` + `host-settings-types.ts` — GREEN.
- **RL-44** `tests/app/RL-44-host-restart-resource-caps.test.ts` (2) → `host.ts:368-372/674/933` + `main.ts` probe — GREEN.

## Rows/cases not built
- None of the rows were dropped. Not covered: RL-22(m)'s three production `keeper_not_identified` distinguishers (not expressible at the `settleExecution` seam or deterministically in RE1); RL-32b's **requeue** branch (implemented per A5 and statically reviewed, but the dataset exercises the reverify branch); RL-34's "real Host" arm uses a composition-level holder plus a live-save case through the real Host (the real Host exposes no platform/check owner to a test).

## Review subagents' findings and what was fixed
- **G1 review 1** — blocker: `#runCapped` never applied `spawned` (kill_group unreachable); majors: `host_oom_kill` during escalation dead, L5 step 5 not using `ProcessSandbox.probe`, L5 step 6 missing the scope-dir-disappearance check; test gaps (literal L10 texts, RL-07b `deadline_before_start`, RL-10b/10c, RL-14 KB coverage) and minors 9/10/12/13/14 — **all fixed**, dist rebuilt.
- **G1 re-review** — blocker A: fake `systemd-run` was env-driven but production spawns with only `PATH`+`XDG_RUNTIME_DIR`; high B: `fail-bus` broke `--version`; high C: `readFinal` completeness flag `ok = memoryOk && pidsOk`; medium D: RL-10(d) launch count; vacuous `timedOut` assertion — **all fixed** (fixture now file-driven via `$0` sibling `.mode/.real/.log/...`, `--version` forwarded, rebuild/re-run).
- **G3 review** — major: RL-34 did not assert the configuration revision is unchanged (fixed with a public-manifest equality case + leak check); minors: RL-31 Work arm (c)/(d) and one-line consts (fixed); live-save path (added RL-44 live-save case through the real Host). Blocker A2-settings conflict — reported below.
- **G2 review** — A5 same-commit write, both round reads, codec round-trip and legacy decode confirmed; findings: `NoticeItemV1` lacks `actions` (out of L-scope) and requeue-branch coverage — reported below.

## CHECKS
- `npm run typecheck` → exit 0.
- `npm run check:architecture` → exit 0 (`next source boundaries: OK`).
- `npm run build` → exit 0.
- `node scripts/build-kernel-patch.mjs --check` → exit 0, 60/60 artifacts `matches:true`.
- RL RE0/RE2/RE3 → 12 files / **116 tests passed**.
- RL RE1 → 31 tests fail here only for the environment (the lines above).
- Full suite `npx vitest run --maxWorkers=4` → **387 files: 54 failed / 333 passed; 6680 tests: 186 failed / 6465 passed / 29 skipped**. Against `DSH-BASELINE.md §A` (154 tests + 1 suite):
  - **Failures outside baseline: 33** = 31 **RE1** (environment only, listed above) + 2 `tests/app/A2-settings-automation.test.ts` (spec/test conflict, below).
  - One baseline entry now passes: `tests/composition/S2B-be1s-shell.test.ts > 2B-09 a cancelled command that changed nothing is tool.cancelled with zero edits`.
- `git status --short` → only L-scope files; existing test files changed: only `tests/kernel/B2-history-public-export.test.ts` (A2); no `docs/`, lock files or RecordStore files; `vendor/coding-agent/dist` 11 files via `--write`.

## UNSPECIFIED
1. **Spec vs existing test (needs a lead decision).** `tests/app/A2-settings-automation.test.ts:65` and `:129` use exact whole-snapshot `toEqual`; the always-present `resourceCaps` required by L13/RL-40 breaks them. Counter-example = the received diff: `"resourceCaps": { memoryMaxMiB:null, tasksMax:null, defaults:{6144,512}, effective:{6144,512}, machine:{status:'unknown'} }`. §5.3:792 claims this file uses `toMatchObject`; it does not, and no spec-faithful implementation can satisfy both it and RL-40. Per §3 the test was left unchanged and is reported here (2 failures).
2. Pre-release `host_oom_kill` (unreachable by construction) maps to `startup_failed: deadline_before_start`; L4 names only timeout for that reason.
3. RL-22(m)'s three production keeper shapes cannot be distinguished at the `settleExecution` seam and cannot be produced deterministically in RE1.
4. `NoticeItemV1` (`src/core/work-graph/model/decision-contracts.ts`, outside spec §6) has no `actions` declaration; L16's `{ kind: 'raise_memory_cap' }` is present at runtime and observable through `queryDecisionQueue`, but the typed public read/HTTP consumer must cast. Adding the field is a scope expansion the lead must authorize.
5. RL-32b's requeue branch is only statically verified (no cap-hit requeue dataset).
6. L16's summary separator is unspecified; implemented as plain concatenation.
7. RL-34's config-revision equality uses the fixture's test-defined revision; no product-derived real-Host revision is publicly readable (manifest `resourceCaps`-absence is the leak check).
8. `resourceCapHitOf` adds `report.status === 'applied'` beyond L16's literal condition (equivalent today); `Math.floor(memoryMaxBytes/MIB)` truncates a non-MiB-multiple cap (all writers are MiB multiples).

## NOTES
- **Regrouping:** followed P11's cut and order G1 → G3 → G2, one building subagent at a time, with each group's read-only review running alongside the next build. Depth-2 subagents are rejected in this harness, so reviewers were dispatched as my direct children.
- **Environment setup (untracked, `.gitignore`d):** `vendor/coding-agent/node_modules` had neither `zod` nor `openai`; the vendor build/tests cannot run without them. I copied `zod@4.4.3` (exact lock version) and `openai@6.26.0` (lock wants `^7.5.0`; only the default export is used, no real model calls) into it, physical directories, which also satisfies `check:architecture`. `.dsh-scratch/` was deleted; `.dsh-ref/` remains as set up.
- **Size/time:** ~3 h wall clock including three build groups, four read-only reviews, and two fix rounds; the final full suite took ~12.4 min. No git write commands were issued.