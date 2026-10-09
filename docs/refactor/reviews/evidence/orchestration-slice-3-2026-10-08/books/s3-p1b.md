# Part 1 correction (same task, same session): fix the tests, then stop again

The lead reviewed your part 1 against `docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md` §5 (each row: given/action, exact expected) and §5.1 (shared fixture). The case ids and counts are right (116 cases, 168 runs). But many cases cannot pass for the right reason once part 2 is written: some fixtures miss facts the row needs, some pairs of cases contradict each other, and some assertions check a fake, a constant or the test's own input instead of the code the row names. Fix the tests listed below. This is still part 1: do not start part 2.

## Scope of this round

- Change only the 11 new test files. Do not change any `src/` file in this round.
- Fix only what is listed. For each fix, reread the named spec row and section and make the test assert exactly the row's "exact expected" column through the entry the row names (book part 1, section C: "A row reaches the code under test through the entry the row names ... Do not mock the code under test"; spec §5.1: "读取场景不能只mock成功"). A fake is fine only for a dependency the row does not test, and it must not decide the result the row asserts.
- Keep one `it` per row, the ids, the titles' id prefixes and the M/S doubling. The counts stay 116 cases and 168 runs.
- Do not create any file outside the write scope and `./.dsh-scratch/`, not even for a moment (in part 1 you created and deleted `tests/architecture/zz-reach-probe.test.ts`; do not do that again).

## Lead decisions (apply them; do not re-decide them)

1. `src/ui/api/routes.ts`: your two labels are accepted as a type-forced change (the table is total over `CoreRouteSuffix`). Keep exactly those two lines; nothing else in that file.
2. Your early changes to existing bodies in `src/contracts/validation/role.ts` (the `platformDuty` enum check), `src/app/host.ts` (the grant list and the configuration revision of spec §4.6) and the lookup in `src/core/agent-runtime/role-profiles.ts` stay as they are. Do not add more behaviour in this round.
3. Scenarios SC01/SC02: `tests/scenarios/harness.ts` and `tests/helpers/*` stay unchanged. The AG2b Host there has a fixed scope, a fixed plan and fixed tool grants without `look_graph`/`find_graph`. The two scenario test files may therefore build their own Host or Platform set-up inside the test file, using the same exported building blocks and the same pattern (SQLite, real owners, scripted provider, real `claim`/`prepare`/`start` through the Workflow), with the §5.1 identities and with `look_graph`/`find_graph` granted explicitly in the Work and Query bindings. If something you need is not exported, say so in UNSPECIFIED with file:line instead of weakening the case.
4. IN01/IN09: `TaskInputPageV1.selectedTaskInputs` is the projection of spec §2.1 for the consumer (all of its `selected` artifact selections, sorted by requirementId), not only the paged declaration. Give each of the two cases a fixture whose declarations match its row.
5. RP03: the issue `['content.platformDuty', 'bad_enum']` stays (it is the existing enum convention of `src/contracts/validation/role.ts`).
6. IN08: `InputSelectionV1` has no field for upstream Run facts; keep asserting `declaration.upstream = tA`, `source = null`, `candidates = []` and the reason. Do not invent a field.

## What to fix

### tests/state/context-input.test.ts
- `:119` ST04, `:128` ST05, `:168` ST08 (§3.2 G-CTX, §4.3 table "callKind"): each negative fixture must be otherwise valid and break only the rule its row names. ST04 duplicates a section whose interval also overlaps; ST05 adds an interval at byte 0 that also overlaps; ST08 adds a continuation section under `callKind: 'work'`, which the §4.3 table does not allow. As written they can be rejected for another reason.
- `:261` ST14: `task_phase` is not an effect kind the run machine has. Assert what the row says (Run Authorized, Task phase unchanged) with the effect kinds that really exist.

### tests/work-graph/S3-context-inputs.test.ts
- `:458` IN01 and `:531` IN09: contradiction with one shared fixture (one-entry vs two-entry projection), and IN09's unfiltered read also returns the four edge declarations. See lead decision 4.
- `:488` IN05 (§3.4 check order, §3.5 legacy row): `ownerRun: 'runA2'` makes the body's origin and the canonical owner record agree, so it is a valid owner. The row asks for an owner ref that loads a different Run.
- `:552` IN11 and `:561` IN12 (§3.5 `gate-result` row, §8.3 "上游PASS选择必须沿适用链头"): same fixture, opposite expectations, and no Round chain exists. IN11 needs an applicable finalized PASS chain head and must assert the whole selected source (ref, revision, checkId, reportRef); IN12 needs a PASS followed by a finalized FAIL and must show no old PASS is selected.
- `:579` IN14 (§3.4 `decisionApplications?`, §3.5 `decision` row): no Message, no reply and no `decisionApplications` dependency exist; without that dependency §3.5 gives `unavailable/unsupported`, not `decision_not_applied`. Seed a replied formal Message, provide the dependency answering "not applied", and assert the Message status is unchanged.
- `:626` IN19 (§3.4 "query_run 的 canonical QueryJob/Run/Goal/workspace"): the QueryRunRef is only a constant; no QueryJob/QueryRun exists. Create the canonical Query through the real owners, then assert the row (old-A, complete versions, zero ledger commits).
- `:466` IN02, `:573` IN13, `:613` IN17, `:621` IN18: IN02 checks the fixture constant, not what was consumed; IN13 should match the exact environment source; IN17 the full stored provenance and `historical_explanation`; IN18 that no body is returned.
- `:592` IN15: "store/material IO=0" means every injected boundary (lookup, lookupCommit, commit, eventAt, raw body read, openArtifact), not only `readMany`.
- `:602` IN16: the bridged read must also run under the consumer Run's context (the row: "以consumer Run材料reader读runA，然后按声明桥接读"), and assert `selected`, not only `ready`.

### tests/work-graph/S3-graph-context.test.ts
- `:340`/`:430` GR04, GR06, GR19 (§4.1 "复用 createRunStateReader"): the real execution reader needs the claim-linked records (TaskAttempt, outbox, Session) and returns `incomplete` for bare Run records (`src/core/work-graph/tasks/run-state-service.ts:505-520`). Build the Runs through the real claim path (`tests/helpers/task-claim-fixture.ts`), not as bare records.
- `:82`/`:84`/`:86` §5.1: old-A, w2 and the Rounds ra/rb are declared but never stored; GR06's rule "Round名ra/rb" is then not exercised.
- `:600` GR07 (§4.1 find rule: name, paths, summary): the default fixture has lowercase `b` in M1's path `src/b`, in Session `sb` and in the role JSON (`builder`). The row says "仅有B": give GR07 a fixture with uppercase B only.
- `:367`, `:688`, `:706` GR17/GR18 (§4.1 the `resolveGraphSessionReadContext` order): there is no canonical QueryJob/QueryRun, no submission commit/event and no Session binding, so GR18 can be rejected because records are missing. Create one valid submission by human/u through the real owners; GR18 changes only `ctx.initiator`.
- `:695` GR17: the scopeKey check compares an expression with itself. Decode a real outer cursor returned by the reader (you need more than one page for that) and compare its scopeKey with the row's expression. Observe the Session port's calls to check the Host context it receives (p/w, actor human/u); check Kernel/material/ledger increments 0.
- `:711` GR18: count calls of `sessions.findSessions`/`readSession` (the row), not RecordStore lookups.
- `:724` GR19: the assertions read the test's own `workCtx`. Observe the execution reader's received context (p/w, `deps.hostActor`, the same `materialReader.actor`), the Session reader's context (original work_run), and compare Run/Session/lease revisions before and after.
- `:624` GR10: `if (... nextCursor === null) return` lets a non-paginating implementation pass. Require the first cursor.
- `:515` GR09: use a cursor really returned by a read of another Goal.
- `:557` GR03: assert the exact neighbour set the row gives, not only `toContainEqual`. `:608`, `:673`, `:681` GR08/15/16: "记录读取次数0" covers every record read, not only `readMany`. `:636` GR11: observe the file and raw-body boundary too. `:663` GR14: the row says the catalog codec is damaged; store a damaged catalog record instead of a port that answers `unavailable`.

### tests/runtime/S3-context-assembler.test.ts
- `:36` CA03, CA04, CA10, CA11, CA13, CA14, CA15 (§4.2 dependencies and `assembleTask`/`assembleQuery` inputs, §5.1): `CTX = {}`, `TASK_INPUT = {}` and `{}` dependencies give the assembler nothing to assemble; with a real implementation these cannot pass. Build valid inputs from the §5.1 facts (execution record, role resolution, configuration, permissions, the real `graphContext`/`taskInputs` owners or narrow ports for what the row does not test).
- `:65` CA02: "source/row输入数组置乱" needs multi-item arrays shuffled, and the complete input and binding compared.
- `:88` CA03 and `:97` CA04 (§3.6 last paragraph, §2.4.1): CA03 is "two unbound prepares", so go through the preparation service and compare inputDigest, the manifest ArtifactRef and the number of new bodies. CA04 must prepare and bind first, then change Goal/notes, then show the bound prepare returns the original value with 0 graph/input/brief reads (it currently asks the first assembly to read nothing).
- `:138` CA06, `:168` CA08: compare the complete expected strings (CA06 all rows kept; CA08 the four omission lines at the end of the task section and no optional header or body).
- `:192` CA09 (§4.3 "精确输入一项过长整项省略"): go through the assembler with a legal selected input of 5000 bytes and assert the omission plus kept selection/ref versions in the binding.
- `:214` CA11: supply a legal missing declaration and tA's current facts, and check where they appear (the reminders section) and that preparation is ready.
- `:222` CA12 (§4.3 "接续兼容硬规则"): use a legal existing C3 brief rendered by the real `renderContinuationBriefZh`, and an injected formal anomalies projection that the assembler consumes.
- `:235` CA13: check the real prepared Query request: question and guide verbatim in the user input, dynamic facts not in the systemPrompt.
- `:247` CA14: check the specific not-connected wording of §4.3 last paragraph (notes, anomalies), not just `未接入`.
- `:257` CA15: make only the extensions reader throw (valid surrounding facts) and assert `unavailable` with no new manifest/body.

### tests/runtime/S3-graph-tools.test.ts
- `:234` GT02: the zero-call check must cover every lower port call you record.
- `:298` GT05 and `:312` GT06 (§4.4 "GraphToolsConfig.history 是 driver 内部的窄代理"): the row is about what RT8 receives through the driver's proxy (Host context with actor human/u for both principal and materialReader, this tool's signal, the full RT8 page). A recording fake in `history` skips the proxy. Reach RT8 through the driver with a canonical Query and an archived/busy Session (GT05) and a canonical w2 Run (GT06, rejected before RT8, no body).
- `:325` GT07: a legacy exact declaration cannot change source. Use a declaration whose formal source can change, prepare first, then look, and show the look reports its fixed source while the original manifest keeps old.
- `:339` GT08, `:376` GT09, `:423` GT13 (§4.4 input paragraph): paging, cursor binding and `capacity` are the input owner's behaviour; with a fake that answers by cursor the cases test the fake. Use the real input owner with a body `A中B` that matches its declaration, real cursors, and for GT13 assert the domain `rejected/capacity` and the resume with the original cursor and maxBytes 3.
- `:386` GT10, `:402` GT11, `:411` GT12: these rows are about the real Query Kernel round trip (next provider request carries two real tool results; `changedPaths=[]`; no writable tools), the real grant filtering into `manifest.permissions` and the request tools, and observed ack/acceptedInputs/commit/Workflow counts after a real look/read. Follow an existing Query runtime test with the scripted provider (for example `tests/runtime/R5b-query-session-loop.test.ts`).
- `:448` GT14: the complete ToolResult JSON must be the row's 80 KiB, not only the summary.

### tests/work-graph/S3-prepared-context-admission.test.ts
- `:450` AD02: `expect(prepared.inputBinding).toEqual(prepared.inputBinding)` is always true. Compare the persisted Run binding before and after the replay, and count resolver calls at the resolver boundary.
- `:516`, `:571`, `:633` AD07: the expected intersection is the same hard-coded array the manifest was built from. Derive it from distinct Host, Role and Query ceilings.
- `:534` AD08: a CAS-rejected commit attempt may count in `commitCount()`. Check the persisted Run/Query/Session bindings are unchanged instead of attempted commits.
- `:314` AD and `tests/work-graph/S3-role-profiles.test.ts:55`: use the §5.1 identities and Workspace revision 7 where the real helpers allow it (the Run id runB, Workspace@7). If a helper cannot produce one of them, keep its value and list it in UNSPECIFIED.

### tests/work-graph/S3-role-profiles.test.ts
- `:157` RP01: the row also says the production assembler consumes the same table; check it through the assembler's role section.
- `:256` RP06: configure two skills (platform-secretary, platform-scribe) on a role pinned to one duty and show the effective duty and the Session role stay the one of the pin.

### tests/app/S3-attention-context.test.ts
- `:108` AT02, `:146` AT04, `:175` AT06 (§4.5 row table): the rows are about the notification text. Check the rendered text lines, not only `delta.changes` (AT06: exactly one `revision_change` line and no node lines). `:126` AT03: also check the old detail's node locator. AT04: start from formal plan edges through the scanner (the `depends:` signature of slice 0), not from pre-encoded edge strings.
- `:163` AT05 (§4.5 second paragraph "否则 AT05 永远不通知"): calling only `graphChanges` lets an observer that ignores details pass. Prime and observe the digest-only change and assert a delivery with one changed element and its node line.
- `:186` AT07, `:203` AT08: assert the scope line, the exact `omitted` object (count and hint), and that the kept rows are the longest prefix that fits (one more row would exceed 16384 bytes).
- `:84` AT01, `:216` AT09, `:230` AT10, `:277` AT12: these rows are about the Host send/consume path (send count, requestId and text of a retry, `markDelivered`/`markProcessed` counts, file lines in the text, unchanged target Session). Follow the Host attention path of `tests/app/orchestration-mechanism.test.ts`.
- `:241` AT11: make the legacy `plans`/`architecture` reads fail the test if called, and let only `readAttentionGraph` fail.

### tests/app/S3-graph-routes.test.ts
- `:123` RT03, `:133` RT04: connect the rejected envelope to the real route dispatch so the port/receipt counters are observed, not a spy that nothing calls.
- `:143` RT05, `:175` RT06: `modelStarts = 0` is a constant. RT06 hand-builds bindings; use the real binding factory (`createPlatformCoreRouteBindings`) with observed owners.

### tests/scenarios/S3-context-and-inputs.test.ts and S3-query-graph.test.ts
- `:37` and `:38`: see lead decision 3. Seed the §5.1 graph (stage Main, tA, tB, oB/vB, edge A.out, the legacy declaration of old-A with canonical owner runA completed) and grant look/find.
- SC01 `:30`, `:46`, `:65` (§5.11 row): follow the row's order: claim and prepare tB while A.out has no output; the scripted model finds, looks at tA and tA's history, then reads the declared old-A; then the second prepare of the same Run. Assert every item of the row (oB/vB/input missing in the first input; source digest `H('old-A')`; no new Session for query/history reads; the recorded Run keeps its binding; the second prepare returns the original manifest; tB not satisfied by tA's completed Run).
- SC02 `:54`, `:67` (§5.11 row): read the saved Answer body and compare its text; check the tool results carry tB's status, obligations and the history versions; and add the second half of the row in the same `it`: graph expansion and history paging add 0 model requests; after a large graph change the Host sends one notification of at most 16384 bytes, it is consumed once, and a second scan sends 0.

## Checks for this round

Run only these, after all fixes:

```
npm run typecheck
npm run check:architecture
npx vitest run tests/state/context-input.test.ts tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-role-profiles.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S3-graph-tools.test.ts tests/app/S3-attention-context.test.ts tests/app/S3-graph-routes.test.ts tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S3-query-graph.test.ts
```

Do not run the 50-file regression command; no `src/` file changes in this round. The expected state is the same as in part 1: 11 files, 168 runs; a test fails only because a stub threw `not implemented: …` or an expected value is not produced yet; no compile, import, fixture or setup error and no timeout. Check your own numbers against the table in section C of part 1.

Keep your context small: give each test file to a subagent with the rows, the §5.1 fixture and the items above for that file, and read only short outputs yourself.

## Your reply

The same four sections as part 1 (FILES CHANGED, CHECKS, UNSPECIFIED, NOTES), covering this round: the files you changed; the check results with per-file numbers, the ids that pass and, for each failing id, the first line of its failure message; and, under UNSPECIFIED, every fix above you could not make as asked, with file:line and the reason.
