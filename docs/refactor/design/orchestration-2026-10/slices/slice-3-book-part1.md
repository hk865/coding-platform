# Task: orchestration slice 3 (context and graph tools), part 1 of 2: types, stubs and tests, then stop

You are working in a copy of a TypeScript repository (the current directory). This is a fully specified task. Follow it exactly. Do not make design decisions: if something is not specified here or in the frozen spec, do not invent behaviour; list it in your report instead.

The task has two parts in this same session. This message is part 1: create the new types and signatures with stub bodies, write every test of the case tables, run the named checks, and stop. Part 2, a later message, writes the implementation. Do not implement behaviour in part 1.

## Where the rules are

The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md` in this copy (Chinese prose, English identifiers). Its §0 is the lead's freeze note and overrides the rest wherever they differ; text marked 【lead 改】 is already corrected, and choices marked 【lead 定】 are fixed. Read it in this order (line numbers of that file):

1. §0 freeze note: lines 5–70. In particular C1 (the two source pin files are already deleted; do not touch `src/contracts/material-access.ts`), C2 (`RuntimeExecutionDependencies.graphHistory` already exists and is required; do not add it), C4 (`PlatformDutyV1`), C5 (`views` is already declared).
2. §2 DTOs, ownership, old data, the five duty profiles: lines 111–249.
3. §3 guards CTX-01..03, pure functions, the input owner and its resolution table: lines 250–356.
4. §4 read model, assembler, the frozen section and byte rules, look/find, attention, routes: lines 357–611.
5. §5 test cases and the existing text assertions that must not change: lines 612–847.
6. §6 file list: lines 848–905.
7. §8.3 rules: lines 941–958.
8. `docs/refactor/design/orchestration-2026-10/slices/README.md`, section “共用文件” (the exact content of `src/contracts/platform-duty.ts`).

Then read the code templates under “Reading list” below. Everything else you need is in this copy.

## What part 1 produces

**A. New files.** Create exactly the 21 files marked `N` in the write scope below.
- In each new source file, write exactly the exported types, constants and function or method signatures that the spec gives for it (spec §2.2, §3.3, §3.4, §4.1, §4.2, §4.4, §4.5).
- Every function or method that has behaviour gets the body `throw new Error('not implemented: <name>')`. `<name>` is the exported function name, or `<Port>.<method>` for a method of an object that a factory returns (example: `throw new Error('not implemented: GraphContextReadPort.lookGraph')`). A factory such as `createGraphContextReader(deps)` returns an object whose methods throw like this; the factory itself does not throw.
- Pure data that the spec gives literally is written in full now: `GRAPH_TOOL_NAMES`, the five duty profiles of spec §2.5 (labels, purposes, responsibilities, skill ids, template ids `platform-executor` … `platform-reviewer` with `templateRevision: 's3.1'`), the section names and header strings of spec §4.3, the format version `'s3-context-v1'`, and `src/contracts/platform-duty.ts`.
- `src/contracts/platform-duty.ts` must be byte-identical to the six lines in the README section “共用文件”: ASCII only, LF line ends, one final newline, 318 bytes. Check with `sha256sum src/contracts/platform-duty.ts`; it must print `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`. `src/contracts/graph-context.ts` imports `PlatformDutyV1` from `./platform-duty.js` and re-exports it; it does not declare its own.
- `src/core/work-graph/views/graph-context-reader.ts` goes into the already declared `views` submodule (its directory exists and holds only a README). Do not edit `docs/refactor/module-target.json`.

**B. Modified source files.** In the 20 source files marked `C`, add only:
- (a) new type declarations, new optional fields on existing types (`PreparedTaskManifestV1.contextAssembly?`, `PreparedQueryManifestV1.contextAssembly?`, `RoleSpecContentV1.platformDuty?`, the optional configuration fields of spec §2.1, `GraphAttentionStamp.details?`, the attention `graph_delta.changes?`), new members of existing unions;
- (b) new exported functions, or new methods on existing ports and factory results, with stub bodies as in A (`graphChanges`, `renderAttentionChanges`, `readAttentionGraph?`, the second optional parameter of `createExecutionPreparation` and `createQueryPreparation`);
- (c) the two new optional dependency fields `graphContext?` and `taskInputs?` on `RuntimeExecutionDependencies` and `ExecutionPreparationDependencies` (spec §4.6; not `graphHistory`, which already exists);
- (d) the 2 new route suffixes `graph/look` and `graph/find` in `src/app/core-http-types.ts` (`CoreRouteSuffix`, the only declaration), their rows in `CORE_ROUTE_SPECS`, their binding types, their cases in `dispatchCoreRoute`, and their bindings in `createPlatformCoreRouteBindings`, which call the new stub methods (spec §4.6);
- (e) in `src/composition/create-platform.ts`, construct the new owners (`createTaskContextInputService`, `createGraphContextReader`) with their factories (which return stubs) and pass the same instances to the Runtime, the routes and the attention scanner, so that every new port is reachable from the composition root.

Do not change any existing function body. One exception: when a new union member makes an existing exhaustive `switch` or `never` check fail the typecheck, add one branch for that member whose body is `throw new Error('not implemented: <function> <member>')`. In `src/core/agent-runtime/session-discovery-tools.ts` and `src/core/agent-runtime/whiteboard-tools.ts` part 1 changes nothing (part 2 only adds a deprecation comment, spec §6 last paragraph and §0.2 T5).

**C. New tests.** Write the 11 new test files of spec §5, exactly the 116 case rows, one `it` per row:
- The `it` title starts with the case id (`ST01`, `IN01`, `GR01`, …), then a short description.
- Rows of the four files marked `× M/S` run on both backends: put them inside `describe.each(['memory', 'sqlite'] as const)` the way the service tests named in spec §5.1 do (`tests/work-graph/R4c-execution-history-index.test.ts`, `tests/helpers/task-claim-fixture.ts`, `tests/work-graph/R3g-role-spec.test.ts`).
- Use the fixture values of spec §5.1 exactly (scope `p/w`, Goal `g` with objective `Ship platform`, Plan `p1`, stage `s` titled `Main`, Tasks `tA`/`tB`, obligation `oB: Deliver B`, verification `vB/static: node check-b.js`, legacy artifact body `old-A` with digest `sha256Hex('old-A')`, Workspace revision 7, edge requirement `{kind:'artifact', label:'A.out'}`, second workspace `w2`, modules M1/M2 for GR05/GR06). `H(s)` is `sha256Hex(s)` and `B(s)` is `Buffer.byteLength(s, 'utf8')`: write them as these expressions in the assertions.
- A row reaches the code under test through the entry the row names: the pure function, the owner service, the assembler, the tool factory, the attention scanner or the HTTP route. Do not mock the code under test. The scenarios use `tests/scenarios/harness.ts` and `tests/scenarios/support/brief.ts` with the scripted provider, on SQLite.
- Expected `it` runs per file:

| file | cases | runs |
| --- | --- | --- |
| tests/state/context-input.test.ts | 15 (ST01–15) | 15 |
| tests/work-graph/S3-context-inputs.test.ts | 19 (IN01–19), M/S | 38 |
| tests/work-graph/S3-graph-context.test.ts | 19 (GR01–19), M/S | 38 |
| tests/runtime/S3-context-assembler.test.ts | 15 (CA01–15) | 15 |
| tests/work-graph/S3-prepared-context-admission.test.ts | 8 (AD01–08), M/S | 16 |
| tests/work-graph/S3-role-profiles.test.ts | 6 (RP01–06), M/S | 12 |
| tests/runtime/S3-graph-tools.test.ts | 14 (GT01–14) | 14 |
| tests/app/S3-attention-context.test.ts | 12 (AT01–12) | 12 |
| tests/app/S3-graph-routes.test.ts | 6 (RT01–06) | 6 |
| tests/scenarios/S3-context-and-inputs.test.ts | 1 (SC01) | 1 |
| tests/scenarios/S3-query-graph.test.ts | 1 (SC02) | 1 |
| **total** | **116** | **168** |

**D. Existing tests.** No existing test file changes in this slice. The text assertions listed in spec §5.12 must keep passing unchanged in part 2.

## Write scope (both parts)

Exactly these 42 files (`N` = create, `C` = modify):

```
N src/contracts/graph-context.ts
N src/contracts/platform-duty.ts
N src/core/agent-runtime/context-assembler.ts
N src/core/agent-runtime/graph-tools.ts
N src/core/agent-runtime/role-profiles.ts
N src/core/work-graph/model/context-input-contracts.ts
N src/core/work-graph/model/graph-context-contracts.ts
N src/core/work-graph/state/context-input.ts
N src/core/work-graph/tasks/context-input-service.ts
N src/core/work-graph/views/graph-context-reader.ts
N (the 11 test files of the table in C)
C src/app/attention-observer.ts
C src/app/core-http-types.ts
C src/app/core-routes.ts
C src/app/host.ts
C src/app/runtime-configuration.ts
C src/composition/create-platform.ts
C src/contracts/core/prepared-execution.ts
C src/contracts/role-spec.ts
C src/contracts/validation/role.ts
C src/core/agent-runtime/execution-contracts.ts
C src/core/agent-runtime/execution-driver.ts
C src/core/agent-runtime/execution-preparation.ts
C src/core/agent-runtime/ports.ts
C src/core/agent-runtime/query-execution.ts
C src/core/agent-runtime/query-preparation.ts
C src/core/agent-runtime/runtime.ts
C src/core/agent-runtime/session-discovery-tools.ts
C src/core/agent-runtime/whiteboard-tools.ts
C src/core/work-graph/queries/query-execution.ts
C src/core/work-graph/tasks/execution-entry-service.ts
C tests/architecture/production-reach-allowlist.json
```

That is 10 new source files + 11 new test files = 21 `N`, and 20 source files + 1 test data file = 21 `C`.

- Helper scripts, listings and logs go in `./.dsh-scratch/` (create it), never in `/tmp`. Part 2 deletes it.
- Do not create, edit, rename or delete any other file, also not in git-ignored places (`dist/`). Do not touch `package.json`, lock files, any config, `vendor/`, `node_modules/` or `docs/` (in particular not `docs/refactor/module-target.json`). `src/core/agent-runtime/continuation-brief-assembly.ts`, `src/core/work-graph/state/run-machine.ts` and `src/core/work-graph/state/query-run-recovery.ts` are not in the scope (spec §6 last paragraph).
- Stay inside the current directory. Do not install packages. Do not commit. Do not start any server or call any real model.
- Git commands allowed: `git status`, `git diff`, `git grep`, `git show`. Not allowed: `git add`, `git rm`, `git mv`, `git checkout`, `git restore`, `git stash`, `git reset`, `git commit`, `git push`.

## Rules (by case, with an example from this repository)

1. **History, not current.** (a) Every read of an upstream material in this slice is `usage: 'historical_explanation'` with the version fixed at selection (spec §2.8 of DESIGN, AMB-37). (b) No source pin, no material grant, no “still current” claim. Example of the existing Host historical read: `src/core/work-graph/materials/applicability.ts` (`hostAdmission`).
2. **Declaration first.** The input owner checks the declaration, scope and canonical owner before the internal Host reader opens any body; a cross-scope or undeclared reference opens nothing (IN03, IN04, IN10: `openArtifact` calls = 0). A `candidateKey` is `sha256Hex(canonicalJson(source))` of a candidate the owner returned, never an ArtifactRef chosen by the model.
3. **Exact artifact equality.** Comparing a declared legacy artifact with a stored one compares the whole canonical `ArtifactRef` including `source`. `sameArtifactRef` in `src/contracts/material-access.ts` compares only `contentType`, `digest` and `sizeBytes`, so it is not enough here.
4. **Bytes.** The assembled text has no clock, random id, locale-dependent order or CRLF that the platform adds; the same facts give the same bytes and the same body ref (CA02, CA03). A bound Run or Query is never re-assembled (CA04, AD02). Sorting uses code-unit `<` comparison, never `localeCompare`.
5. **Budget.** 4096 bytes is the shared budget of the four optional sections only (footprint, notes, reminders, inputs), in that order; role, goal, task and the continuation brief are never cut (CA05). Take the longest global prefix of rows that fits, count headers and the omission line, never cut a row in the middle, and write `另有 n 条，用‘看’读` for omitted rows (CA06–CA09, spec §4.3).
6. **The continuation brief is last and unchanged.** The work input ends with exactly `'\n\n' + renderContinuationBriefZh(brief, digest)` (`src/contracts/continuation-brief.ts:264`); nothing follows it (CA12, ST08).
7. **Not a gate.** `missing`, `ambiguous`, `unavailable`, an omitted row and `not_implemented` are read results; none of them blocks a claim, fails a Run or satisfies a Task (ST14, IN06, CA11, CA14).
8. **Query tools take three steps.** Register `look_graph` and `find_graph` through the existing coordination-tool seam (`src/core/agent-runtime/execution-driver.ts:377`), grant them, and let the Query owner re-check the grant; the read-only check of the observed model run stays as it is, and no mailbox or whiteboard write tool is injected into a Query (GT10, GT11, AD07).
9. **Host-only owners stay Host-only.** A Query reads Sessions only through the views bridge that verifies the canonical QueryRun and the original submission initiator (GR17, GR18); history goes through the driver's proxy (GT05, GT06). Do not widen `src/core/work-graph/sessions/session-directory.ts:1119` (`readContext`) or `src/core/work-graph/tasks/run-state-service.ts:198` (`ownCallContext`) to accept other principals.
10. **Attention.** Delivered and processed stay two separate watermarks; an unreadable graph is unknown, never an empty graph (AT11); the notification text is at most 16384 UTF-8 bytes and never contains half a JSON line (AT07, AT08).
11. **Old role content keeps its digest.** A RoleSpec without `platformDuty` reads as `executor` without writing the field (RP02); the duty never comes from skills, labels or instructions (RP06).
12. **Old tools stay.** `WHITEBOARD_TOOL_NAMES` and the old read adapters keep their exports and behaviour; only the new grant lists `look_graph` and `find_graph` instead of the three old read names (spec §4.6, §0.2 T5).
13. **Allowlist.** In `tests/architecture/production-reach-allowlist.json`, remove exactly the `kept-for` entries that `tests/architecture/production-reach.test.ts` reports as reached after your wiring (they name “slice 3”); add no entry. Edit the JSON as text; do not re-serialize the file.
14. **State purity and layers.** `src/core/work-graph/state/context-input.ts` imports only `src/contracts/`. The `views` file does not import `evidence/`, `communication/` or `notes/`. Pure DTOs live in `src/contracts/graph-context.ts`; ports and facts that need owner types live in `model/graph-context-contracts.ts`.

## Reading list (in this copy)

- `src/core/agent-runtime/execution-preparation.ts:1–60`, `:150–300` (`prepareContinuationBrief` 158, `sessionBasisOf` 203, `briefWorkspaceFacts` 252, `createExecutionPreparation` 287).
- `src/core/agent-runtime/query-preparation.ts:40–80`, `:250–300`.
- `src/core/agent-runtime/continuation-brief-assembly.ts:1–60` (reused, not changed).
- `src/core/agent-runtime/whiteboard-tools.ts:290–428`; `src/core/agent-runtime/graph-execution-history.ts:170–230`; `src/core/agent-runtime/execution-driver.ts:360–400`; `src/core/agent-runtime/runtime.ts:84–210`; `src/core/agent-runtime/execution-contracts.ts:155–200`.
- `src/core/work-graph/tasks/run-state-service.ts:190–230`, `:400–440`; `src/core/work-graph/sessions/session-directory.ts:1110–1140`.
- `src/core/work-graph/configuration/role-record-codecs.ts:150–190`; `src/core/work-graph/configuration/role-memory-service.ts:40–90`; `src/contracts/validation/role.ts:1–60`; `src/contracts/role-spec.ts:100–140`.
- `src/contracts/core/prepared-execution.ts:1–115`; `src/core/work-graph/tasks/execution-entry-service.ts:170–200`, `:340–380`; `src/core/work-graph/queries/query-execution.ts:370–400`, `:885–930`.
- `src/app/attention-observer.ts:40–60`, `:218–235`, `:436–543`; `src/app/host.ts:495–510`, `:1018–1089`.
- `src/app/core-http-types.ts:105–180`; `src/app/core-routes.ts:45–200`, `:204–330`, `:393–420`, `:530–632`.
- `tests/work-graph/R4c-execution-history-index.test.ts:1–60`; `tests/helpers/task-claim-fixture.ts:40–100`; `tests/scenarios/support/brief.ts:30–80`.

## Checks

Run exactly these commands. Do not run any other tests.

```
npm run typecheck
npm run check:architecture
npx vitest run tests/state/context-input.test.ts tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-role-profiles.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S3-graph-tools.test.ts tests/app/S3-attention-context.test.ts tests/app/S3-graph-routes.test.ts tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S3-query-graph.test.ts
npx vitest run tests/runtime/B1-kernel-assembly.test.ts tests/runtime/B2-runtime-execution.test.ts tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/W2-role-skills.test.ts tests/app/AG6-agent-assembly.test.ts tests/kernel/R4a-frozen-public.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/runtime/R5b-query-session-loop.test.ts tests/app/AG2-consultation.test.ts tests/app/AG2b-collaboration.test.ts tests/app/orchestration-mechanism.test.ts tests/runtime/orchestration-boundaries.test.ts tests/runtime/R4c-session-continuity.test.ts tests/runtime/R4-control-runtime.test.ts tests/runtime/R2e-git-source-loop.test.ts tests/runtime/source-text-loop-migration.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/runtime/C3-brief-timeline.test.ts tests/scenarios/A1-rework-same-session.test.ts tests/scenarios/C3-brief-idempotency.test.ts tests/scenarios/C3-not-entered-chain.test.ts tests/scenarios/C3-workspace-changed.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/C3-reply-other-session.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/composition/A2-requeue-platform.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/state/invariants.test.ts tests/state/invariants-fuzz.test.ts tests/architecture/boundaries.test.ts tests/architecture/state-writes.test.ts tests/architecture/production-reach.test.ts tests/work-graph/R3g-role-spec.test.ts tests/work-graph/B2-execution-entry.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/work-graph/R5b-query-execution.test.ts tests/runtime/R4c-graph-history.test.ts tests/runtime/R4c-execution-history.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/runtime/W2-whiteboard-tools.test.ts tests/composition/AG1-session-discovery.test.ts tests/state/run-machine.test.ts tests/state/query-run-recovery.test.ts tests/state/no-progress.test.ts tests/scenarios/A11-no-progress.test.ts
```

Expected at the end of part 1:
- `npm run typecheck` and `npm run check:architecture` exit 0.
- New tests: exactly 11 files and 168 tests run. A test may fail only because a stub threw `not implemented: …` or because an expected value is not produced yet; a compile error, a fixture error or a timeout is a defect of part 1 that you fix before stopping. List every new test that passes in part 1 by id.
- Regression command (50 files): the first run (before any change) equals the baseline below. At the end of part 1 every file still equals the baseline, except `tests/architecture/production-reach.test.ts`, which may report the new stubs or stale allowlist entries; list what it reports.

Baseline numbers for the regression command on the untouched copy (the lead fills this in before sending; tests that fail only because `/usr/bin/bwrap` is missing in this environment, for example in `tests/state/invariants.test.ts` and `tests/state/invariants-fuzz.test.ts`, are named here):

```
【lead 发送前填写：每个文件的 passed / failed / skipped，和 Test Files、Tests 两行】
```

## Part 1: step by step

1. Create `./.dsh-scratch/`.
2. Read the spec sections and the reading list above.
3. Run the regression command once before any change, and wait for it to finish. Keep its result for CHECKS.
4. Create `src/contracts/platform-duty.ts` and check its sha256.
5. Write the types and stubs in this order: `src/contracts/` → `model/` → `state/context-input.ts` → `tasks/context-input-service.ts` → `views/graph-context-reader.ts` → `agent-runtime/` (role profiles, assembler, graph tools, preparation, drivers, runtime) → `app/attention-observer.ts` → `composition/create-platform.ts` → `app/` routes and Host grant. Run `npm run typecheck` after each step and fix your own errors.
6. Write the 11 test files.
7. Run all the checks. Fix compile and fixture errors in your own files until the expected part-1 state holds.
8. Stop. Do not start part 2. Leave `./.dsh-scratch/` in place.

## Your reply to part 1

Reply with these four sections and nothing else:

- FILES CHANGED: each file of the write scope you created or modified, one per line, with `N` or `C`; then the sha256 of `src/contracts/platform-duty.ts`.
- CHECKS: each command with its result before and after (exit code; for vitest the `Test Files` and `Tests` lines and the per-file numbers). For the new tests: the number of runs per file (it must match the table in C), the ids of the tests that pass, and for every failing test the id and the first line of its failure message.
- UNSPECIFIED: each case this task and the spec do not describe that you met, one line each. Every sentence of the spec that disagrees with the code you read, with file:line. Every claim that something was not found names the command that found nothing.
- NOTES: at most ten lines, only if something blocked you or looked wrong.
