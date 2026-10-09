# Group CE — Goal content check at entry (G) and the anomaly reminder through the real graph reader (AN07)

Checkout: `D:/cxt/impl-w1-fxCE`. Read `D:/cxt/impl-w1-fx-msg/RULES.md` first.

## Your files (only these two)

- `tests/helpers/WP1-entry-fixture.ts` (new)
- `tests/wp1-smoke/entry.smoke.test.ts` (new, temporary)

## Rows (spec §5.2)

- GE01–GE07, file `tests/work-graph/WP1-goal-content-entry.test.ts`, every row on memory AND SQLite
  (`describe.each(['memory','sqlite'])`, `createTaskClaimFixture(kind, …)` style).
- AN07, file `tests/work-graph/WP1-context-anomalies.test.ts`, memory AND SQLite.

Read the spec: §0 L1–L4, L7–L9, §2.1, §2.2, §2.5, §3 rows W1-CTX-01 and W1-ANOM-01, §4.2, §4.3, §5.1, rows GE01–GE07
and AN07, §7 rules 6, 7, 9, 10. Code: `src/core/work-graph/tasks/execution-entry-service.ts` (`contextConsumptionProblem`
1100, `contextConsumptionGuards` 1175, `authorizeAdmission` 1206, `authorizeRuntimeEntry` 1451/1504),
`src/core/agent-runtime/context-assembler.ts` (`assembleTask` 922 binding), `execution-preparation.ts`
(`prepareExecution`, `rehydratePreparedExecution`), `src/core/work-graph/views/graph-context-reader.ts`
(`GraphContextReaderDependencies` 66–75, `readIndexes` 390, Goal source `digest: null` 973/995), how production wires
them (`src/composition/create-platform.ts` around 636–650 and the Runtime there), and the existing tests
`tests/work-graph/S3-prepared-context-admission.test.ts` (fixture `open`, `authorize`, `makeBinding`, CTX rows),
`tests/work-graph/S3-graph-context.test.ts` (how the real reader is built: line ~701), `tests/scenarios/C6-unrelated-adoption.test.ts`
(the unrelated plan adoption), `tests/work-graph/S1-anomaly-owner.test.ts` and `tests/business/S1-archive-flow.test.ts`
(how a real `SessionAnomalyAnchor` is written by archiving a line while its Run is in progress).

## What the helper must provide

1. **GE fixture `openGoalContentEntry(kind)`** (memory/SQLite): a claimed Task T of Goal G whose execution is prepared
   by the REAL preparation path with the REAL context assembler reading the REAL graph context reader
   (`createGraphContextReader`) and task-input owner, so the prepared manifest carries a context binding
   (`ContextAssemblyBindingV1`) whose `sources` contain the Goal `record` source of G (today with `digest: null`).
   Return: the prepared execution (manifest + binding), the claim, the current Goal snapshot (read through the owner),
   a function `authorize(prepared, requestId)` that calls the same entry authorization the existing CTX rows call
   (`S3-prepared-context-admission.test.ts:authorize`), read helpers (Run snapshot/revision; list
   `ExecutionEntryAuthorized` events of the Run; the audit event's `activePlanRef`; `entryGeneration`), and the ctx.
2. **GE02 / GE03 / GE06 — hand-made binding on an UNBOUND Run** (the only allowed hand-made state, following
   `makeBinding`): a builder that returns a prepared execution for an unbound Run whose binding is legal except for the
   parameters: `goalDigest: string | null` (the `digest` of G's `record` source; the test passes
   `goalContextDigestV1({...goal, objective:'other'})` in GE02 and `null` in GE03 — you cannot import that function, so
   take the string as a parameter) and `workspaceRevision?: number` (GE06: a wrong Workspace source revision). The rest
   (sections, input text, selections, other sources) must pass today's `contextAssemblyProblem` / admission checks, so
   that today GE02 is COMMITTED (the new check is missing) and GE06 is refused by the existing Workspace check.
3. **GE04:** `adoptUnrelatedPlan(fixture)`: after the real preparation, adopt a new Plan revision P2 that only adds an
   unrelated FUTURE intent (as `tests/scenarios/C6-unrelated-adoption.test.ts` / the plan owner allow), through the real
   plan owner; return P2's ref.
4. **GE05:** `revokeUnentered(fixture, authorized)`: after a committed authorization, prove through the REAL reconcile
   owner that the Run never entered and revoke the authorization (RUN-16; see how `S3-prepared-context-admission.test.ts`
   CTX-02 or the A8 entry tests do it), so the same fixed binding and envelope can be authorized again
   (`entryGeneration` 2). Return what the re-authorization needs.
5. **AN07 fixture `openAnomalyReaderFixture(kind)`**: the REAL anchor owner (`createSessionAnomalyService`) wrote one
   anchor A in Goal G (produce it the real way: archive a line while its Run is in progress, operator "drop", as the S1
   archive tests do); a second Task T2 of the same Goal has a Run (claimed) so a `work_run` ctx for it exists. Return:
   the real anomaly service (so the test can build `createContextExtensionsReader({ anomalies, hostActor })`), the
   `hostActor` to use, a function `graphReader(extensions)` that builds the REAL `createGraphContextReader` with all its
   real dependencies plus the given `extensions` (type `GraphContextReaderDependencies['extensions']`), the Host ctx, the
   `work_run` ctx of T2's Run, `goalRef`, A (anchor snapshot incl. `ref`, `task`, `runRef`, `planRef`), and A's task
   (the focus for `readContextFacts(goalRef, focus=[A's task])`; read the request type `ContextReadRequestV1`).

## Lead notes for this group

- G is not triggerable in production today (L1): never change a Goal record to make "the Goal changed"; GE uses only
  the hand-made unbound manifest.
- Keep the entry ctx and the Run permissions the existing S3 admission fixture uses.
- Both backends must build every given; a SQLite fixture uses a temp directory cleaned up by a returned `close()`.
