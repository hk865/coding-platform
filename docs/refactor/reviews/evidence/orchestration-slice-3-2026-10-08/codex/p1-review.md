Reviewed all **116 case rows** read-only. No missing or extra IDs; backend doubling matches **168 runs**. The tests need correction before freezing part 1. I did not run tests or modify files.

1. **Must-fix — `tests/state/context-input.test.ts:119`, `:128`, `:168` — ST04/ST05/ST08; §3.2, §4.3.** These negative fixtures contain independent invalid conditions. ST04 appends an overlapping, out-of-order interval; ST05 appends `startByte: 0`; ST08 retains `callKind: 'work'` while adding a continuation section. They can reject without detecting duplicate names, unknown names or appended text. **Direction:** make each fixture otherwise valid and isolate its specified violation.

2. **Should-fix — `tests/state/context-input.test.ts:261` — ST14.** `not.toContain('task_phase')` checks an invented effect-kind string, not the Task’s phase. The Run task-reference equality also does not establish phase preservation. **Direction:** assert the actual permitted effects or unchanged Task state; avoid a sentinel no production effect uses.

3. **Must-fix — `tests/work-graph/S3-context-inputs.test.ts:458`, `:531`, `:536` — IN01/IN09; §2.1, §2.4.** The same default fixture and `readPage(f, f.legacyDeclarationId)` must return a one-entry projection in IN01 and a two-entry projection in IN09. Additionally, IN09 calls unfiltered `readInputs(f)` and expects length 2 although the fixture includes four edge declarations alongside two legacy declarations. **Direction:** give IN01 one legacy declaration and IN09 exactly its two legacy declarations. Do not make reads stateful or suppress legitimate edge declarations.

4. **Must-fix — `tests/work-graph/S3-context-inputs.test.ts:488` — IN05; §3.4–3.5.** `{ ownerRun: 'runA2' }` changes both the stored body origin and its canonical owner record to runA2. That establishes a matching owner, rather than an owner reference that loads a different Run. **Direction:** preserve the requested owner and introduce the specified loaded-record identity mismatch.

5. **Must-fix — `tests/work-graph/S3-context-inputs.test.ts:552`, `:561` — IN11/IN12.** Both use `openFixture(kind)` and the same gate declaration, then expect respectively `selected` and `missing`. No Round/PASS/FAIL chain is seeded. **Direction:** establish an applicable finalized PASS chain head for IN11; independently establish PASS followed by finalized FAIL for IN12. The suspected contradiction is confirmed.

6. **Should-fix — `tests/work-graph/S3-context-inputs.test.ts:556`, `:565` — IN11/IN12.** IN11 only matches `{ kind: 'check', checkId: CHECK_ID }`, omitting the exact chain-head ref, revision and reportRef. IN12 checks only `state: 'missing'`. **Direction:** assert the complete selected check source and, for FAIL suppression, absence of any selected old PASS source.

7. **Must-fix — `tests/work-graph/S3-context-inputs.test.ts:579` — IN14; §3.5.** There is no formal Message/reply, and the service has no `decisionApplications` dependency. Without that seam, §3.5 specifies `unavailable/unsupported`, not the asserted `missing/decision_not_applied`. **Direction:** seed a replied Message, provide the unapplied projection and assert its existing status remains unchanged.

8. **Must-fix — `tests/work-graph/S3-context-inputs.test.ts:626` — IN19; §3.4.** A locally constructed QueryRunRef/context is treated as canonical, but no QueryJob, QueryRun or persistent Session binding exists. **Direction:** establish the canonical Query through the real owners, then assert old-A, complete versions, unchanged Query permissions and zero ledger commits.

9. **Should-fix — `tests/work-graph/S3-context-inputs.test.ts:466`, `:573`, `:613`, `:621` — IN02/IN13/IN17/IN18.** IN02 checks the fixture’s digest rather than consumed old-A; IN13 uses partial source matching and excludes only `applicability`; IN17 omits full stored-origin equality and historical usage; IN18 omits the no-body assertion. **Direction:** assert the returned body/digest, exact environment source, complete provenance/usage and absence of leaked body respectively.

10. **Should-fix — `tests/work-graph/S3-context-inputs.test.ts:592` — IN15.** Only `readMany` and `openArtifact` are counted. Lookup, event, commit and raw-body IO remain unobserved. **Direction:** assert zero calls across every injected store/material/body IO boundary.

11. **Should-fix — `tests/work-graph/S3-context-inputs.test.ts:602` — IN16.** The direct read uses consumer `workCtx(runB)`, but the bridged read defaults to Host `f.ctx`; it also only requires `ready`. **Direction:** perform both reads under the consumer Run context, and assert the bridge returns `selected` with the original historical ref.

12. **Should-fix — `tests/work-graph/S3-context-inputs.test.ts:515` — IN08; §3.5.** Checking `declaration.upstream=tA` establishes identity, not the specified current runA fact. However, `InputSelectionV1` provides no explicit upstream-history/card field. **Direction:** clarify the specified carrier before strengthening this assertion; do not invent `runHistory` or `sources` fields.

13. **Must-fix — `tests/work-graph/S3-graph-context.test.ts:340`, `:430` — GR04/GR06/GR19; §5.1, §4.1.** The fixture seeds Run records but lacks the claim-linked TaskAttempt/outbox chain needed by the real `createRunStateReader`. Its final-window reader returns `incomplete` for a missing outbox. **Direction:** build valid execution records through the real claim fixture; do not bypass the execution reader with bare Run decoding.

14. **Must-fix — `tests/work-graph/S3-graph-context.test.ts:600` — GR07; §4.1.** The default fixture contains lowercase `b` in `src/b`, Session `sb` and role JSON containing `builder`. These fields are searchable, contradicting `items=[]`. **Direction:** give GR07 a fixture whose searchable fields contain uppercase B but no lowercase b.

15. **Must-fix — `tests/work-graph/S3-graph-context.test.ts:367`, `:688`, `:706` — GR17/GR18; §4.1.** The Query context has no canonical QueryJob/QueryRun, submission receipt/event or persistent binding. GR17 cannot establish the valid bridge; GR18 can reject because records are absent rather than because the initiator differs. **Direction:** establish one valid human/u submission; change only the caller initiator for GR18.

16. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:695` — GR17.** The cursor check computes `scopeKey=H(...)` and compares it with the same expression. It never examines a returned cursor; the single match also produces no continuation cursor. **Direction:** obtain an actual outer cursor from a pageable fixture and check its decoded scopeKey against the specified original Query identity.

17. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:689`, `:711`, `:724` — GR17/GR18/GR19.** The tests do not inspect the actual reader contexts. GR18’s RecordStore lookup count is not a Session-port call count; GR19 inspects the caller’s constant `workCtx`, not the execution reader’s Host context. Required actor/materialReader equality, Session-context preservation, revision preservation and zero Kernel/material/ledger changes are incomplete. **Direction:** observe calls around the real readers and compare persisted revisions before and after.

18. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:624` — GR10.** `if (... nextCursor === null) return` silently passes when an implementation fails to paginate. **Direction:** require a non-null first cursor before changing the Plan and asserting `revision_conflict`.

19. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:515` — GR09.** The foreign cursor contains arbitrary hashes, rather than a valid cursor produced for another Goal. It may reject for malformed query/basis identity. **Direction:** obtain the cursor from a real second-Goal read.

20. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:557`, `:571`, `:608`, `:636`, `:668`, `:673`, `:681` — GR03/04/08/11/14/15/16.** GR03’s `toContainEqual` does not establish the exact dependency set. Model-zero assertions are absent for GR04/14; record-zero assertions only count `readMany`; GR11’s file/raw-body boundary is unobserved. **Direction:** assert the exact applicable set and connect each required zero-count assertion to the corresponding boundary.

21. **Should-fix — `tests/work-graph/S3-graph-context.test.ts:82`, `:84`, `:86`, `:340` — §5.1, GR06.** old-A, w2 and Round refs are declared but their records/bodies are not seeded. Consequently, exclusion of the dedicated `ra/rb` Round names is not exercised. **Direction:** complete the shared fixture. The specified M1/M2 definitions and GR05 path variant are correct.

22. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:36` — CA03/04/10/11/13/14/15; §4.2, §5.1.** `CTX = {}`, `TASK_INPUT = {}` and dependencies cast from `{}` omit required execution, role, configuration, permissions and ports. CA13 similarly casts empty Query facts. **Direction:** provide valid inputs and required dependencies; stub only the dependency behavior each case needs to control.

23. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:65` — CA02.** `scrambled` changes object-property insertion order; every row array contains one item, and no source array is shuffled. Only renderer sections are compared, not the complete binding. **Direction:** shuffle multi-item source/row arrays and compare the complete input and assembly binding.

24. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:88` — CA03.** Two direct `assembleTask` calls compare string hashes and upstream `selectedTaskInputs`. They do not create prepared manifests, compare bundle ArtifactRefs or count new bodies. **Direction:** perform two unbound preparations through the preparation service and check all three frozen results.

25. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:97` — CA04; §2.4, §3.6.** Nothing is bound, Goal/notes are not changed, and graph/input readers throw on the first assembly. `briefReads` counts `readAttentionFacts`, not brief reads. This demands unspecified assembler caching. **Direction:** prepare and bind first, change upstream facts, then verify bound preparation returns the original value without actual graph/input/brief rereads.

26. **Should-fix — `tests/runtime/S3-context-assembler.test.ts:138`, `:168` — CA06/CA08.** CA06 checks counters but not that all rows survive. CA08’s `toContain` checks do not establish omissions at the task’s end or absence of leftover optional body text. **Direction:** compare the complete expected rendered strings.

27. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:192` — CA09; §4.3.** A naked 5000-byte renderer row has no selection/ref/version or completeness metadata. `not.toContain(body)` also permits partial retention. **Direction:** exercise a legal selected input through the assembler, asserting whole-row omission, preserved selection/ref versions and incomplete-body representation.

28. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:214` — CA11.** The empty fixture supplies no missing declaration or tA facts; assertions merely search for `d1` and `tA` anywhere. **Direction:** supply a legal missing selection and current upstream facts, then check their reminder representation and successful execution preparation.

29. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:222` — CA12.** `brief = 'renderContinuationBriefZh(brief, digest)'` is a literal string. The anomaly reminder is also inserted directly into the renderer. **Direction:** use a legal existing C3 brief, the actual renderer and an official anomalies projection consumed by the assembler.

30. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:235` — CA13.** `expect(QUERY_CONTEXT_PRELUDE).not.toContain(question)` checks a constant, not the actual systemPrompt. **Direction:** inspect the real Query preparation/request, preserving the original question/guide in user input and excluding dynamic facts from systemPrompt.

31. **Should-fix — `tests/runtime/S3-context-assembler.test.ts:247` — CA14.** Five availability values are checked, but generic `未接入` does not establish that current understanding is represented as unavailable rather than fabricated empty understanding. **Direction:** check the specified unavailable understanding/extension representations.

32. **Must-fix — `tests/runtime/S3-context-assembler.test.ts:257` — CA15.** The test makes the entire `readContextFacts` dependency throw; it does not isolate an extensions failure or observe manifest/body writes. **Direction:** establish valid surrounding facts, make the extension reader fail and assert unavailable plus zero new manifest/body writes.

33. **Should-fix — `tests/runtime/S3-graph-tools.test.ts:234` — GT02.** The zero-call check omits recorded `readInputs`, `readContextFacts` and `readAttentionFacts`. **Direction:** check all lower-port calls.

34. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:298` — GT05; §4.4.** A recording history fake replaces the driver’s Host proxy. There is no canonical Query or archived/busy Session; actor/materialReader checks and full-page equality are missing. The canned page identifies runB although the request targets runA. **Direction:** exercise the driver proxy with valid records, inspect the actual Host context and a distinct per-call signal, preserve the full RT8 page and count Query/model creation.

35. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:312` — GT06.** Two unconditional forbidden fakes replace a canonical w2 Run. Directly calling history without scope validation would still pass. **Direction:** establish the cross-workspace record and verify card validation rejects before RT8, with no body returned.

36. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:325` — GT07; §2.4, §3.5.** No original manifest is prepared. The requested declaration is r2, the canned selection declares r1 with exact old-A, and its selected source is new-A. A legacy exact declaration cannot legitimately change that way. **Direction:** establish a supported formal source change, verify the look’s complete fixed version and prove the original old binding remains unchanged.

37. **Should-fix — `tests/runtime/S3-graph-tools.test.ts:339` — GT08.** The fake returns A/中/B solely by cursor and ignores `maxBytes`; it can pass even if the adapter fails to forward 3. Its declaration also fixes old-A while its source describes A中B. **Direction:** use a matching A中B declaration and real pagination, or make the fake validate every pagination argument.

38. **Should-fix — `tests/runtime/S3-graph-tools.test.ts:376` — GT09.** An unconditional invalid fake substitutes for a legitimately minted r1 cursor misused with r2. No-body is not explicitly checked. **Direction:** establish a valid original cursor and distinguish its legal continuation from cross-declaration misuse.

39. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:386` — GT10.** Direct handler calls replace the required real Query Kernel/provider round trip. There is no next provider request, actual writable-tools check or observed workspace change set. **Direction:** execute find→look through the real Kernel with the scripted provider and inspect the subsequent request.

40. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:402` — GT11.** Factory names are checked, but no grant containing send/note/shell, prepared manifest, Query ceiling or real request exists. **Direction:** exercise actual grant filtering and explicit look/find authorization.

41. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:411` — GT12.** No look/read executes. Checking definition keys for `workflow`/`ack` cannot detect handler writes or Workflow calls. **Direction:** execute the read and observe actual ack, acceptedInputs, commit and Workflow boundaries.

42. **Must-fix — `tests/runtime/S3-graph-tools.test.ts:423` — GT13.** The test starts with fabricated `cur1`, checks only generic `execution_failed`, and uses old-A provenance for A中B content. Invalid/forbidden failures would pass. **Direction:** obtain the real first-page cursor; assert domain `rejected/capacity`, no zero-progress ready page, and successful reuse of the original cursor with 3 bytes.

43. **Should-fix — `tests/runtime/S3-graph-tools.test.ts:448` — GT14.** The summary alone is 80 KiB; the complete ToolResult is larger. **Direction:** size the complete serialized fixture to the specified 80 KiB. The capacity/error/effects assertions otherwise cover the row.

44. **Should-fix — `tests/work-graph/S3-prepared-context-admission.test.ts:450` — AD02.** `expect(prepared.inputBinding).toEqual(prepared.inputBinding)` is tautological. `bodyReads` also does not directly measure resolver calls. **Direction:** compare the persisted Run binding with its pre-replay snapshot and observe the resolver boundary.

45. **Should-fix — `tests/work-graph/S3-prepared-context-admission.test.ts:516`, `:571`, `:633` — AD07.** The manifest is assigned the hardcoded `intersection`, then compared with that same array. Distinct Host/Role/Query ceilings are not established and independently checked. **Direction:** derive the expected intersection from actual configuration facts and check the bound prepared result.

46. **Should-fix — `tests/work-graph/S3-prepared-context-admission.test.ts:534` — AD08; §3.6.** The @7→@8 setup is legitimate; its current failure is consistent with missing revision validation, rather than a demonstrated setup error. But `commitCount()` counts attempted commits, so requiring no increment rejects a valid CAS-based `revision_conflict`. Run/Query/Session binding preservation is unasserted. **Direction:** check the required refusal and unchanged persisted bindings; distinguish attempted commits from successful ledger commits.

47. **Should-fix — `tests/work-graph/S3-prepared-context-admission.test.ts:314`, `tests/work-graph/S3-role-profiles.test.ts:55` — §5.1.** AD’s `runB = claim.runRef` uses the helper’s generated `r4c-claim-id-*` identity, not frozen runB. RP seeds Workspace revision 1 rather than 7. AD07 additionally omits the shared Plan/task/upstream fixture. **Direction:** use the frozen identities/revisions and complete the applicable shared facts.

48. **Should-fix — `tests/work-graph/S3-role-profiles.test.ts:157`, `:256` — RP01/RP06.** RP01 never exercises production assembler consumption of the table. RP06 compares two profile skill IDs but never configures/loads multiple skills or establishes an unchanged Session role. **Direction:** exercise the specified assembler and AG6 skill-loading paths with an immutable role pin.

49. **Should-fix — `tests/work-graph/S3-role-profiles.test.ts:220` — RP03; §2.5.** The exact validation issue `['content.platformDuty', 'bad_enum']` is imposed by the test, but the spec fixes only enum validation and install rejection `invalid`. **Direction:** retain the specified rejection/no-commit assertions; either document the validation-detail contract or stop freezing its incidental issue code.

50. **Must-fix — `tests/app/S3-attention-context.test.ts:108`, `:126`, `:146`, `:175` — AT02/03/04/06; §4.5.** AT02 serializes `delta.changes`, not notification text; AT06 checks the revision DTO, not one `revision_change` line. AT03 omits the old canonical locator; AT04 supplies already-encoded edge keys and does not verify scanner encoding or endpoint detail refs. **Direction:** check actual rendered notifications and canonical locators, with AT04 starting from formal requirements. **The local change fixtures themselves are valid; the suspected fixture gaps are refuted in that narrower sense.**

51. **Must-fix — `tests/app/S3-attention-context.test.ts:163` — AT05; §4.5.** Calling only `graphChanges(before, after)` permits an observer that ignores detail changes to pass—the exact wiring error §4.5 warns about. **Direction:** prime and observe the digest-only change, asserting actual delivery, one changed element and its notification row.

52. **Must-fix — `tests/app/S3-attention-context.test.ts:186`, `:203` — AT07/AT08; §4.5.** Byte limits, parseability and omission counts are checked, but a renderer emitting only an omission row can pass. Required scope, hint and longest fitting prefix are not established. **Direction:** assert the complete permissible output and exact omission metadata at the byte boundary.

53. **Must-fix — `tests/app/S3-attention-context.test.ts:84`, `:216`, `:230`, `:277` — AT01/09/10/12.** Observer-only assertions omit actual sends/requestId/text. “Real consumption” is a manual `markProcessed`; `Object.keys(observer)` excluding `targetSession` says nothing about Host recipients. AT12 checks changedFiles, not actual notification sources. **Direction:** observe the Host send/consume path, exact retry identity/text, watermark call counts, changed-file sources and unchanged recipient.

54. **Must-fix — `tests/app/S3-attention-context.test.ts:241` — AT11; §4.5.** Both legacy plans and the new assembler reader return unavailable. A scanner that completely ignores `readAttentionGraph` already passes. **Direction:** forbid legacy graph reads, observe the assembler call and make only that reader fail.

55. **Should-fix — `tests/app/S3-graph-routes.test.ts:123`, `:133` — RT03/RT04.** The zero-port spy is disconnected from dispatch; no receipt boundary is observed. Parser rejection is meaningful, but the side-effect assertions are trivial. **Direction:** connect the rejected envelope to the actual route execution boundary and observe ports/writers.

56. **Should-fix — `tests/app/S3-graph-routes.test.ts:143`, `:175`, `:198` — RT05/RT06.** `const modelStarts = 0` is unconnected. RT06 hand-builds bindings, so it cannot detect incorrect production owner forwarding. **Direction:** use the real binding factory with observed owners/context/input and a connected model counter. RT01/RT02 appropriately use graph spies to inspect real route forwarding.

57. **Must-fix — `tests/scenarios/S3-context-and-inputs.test.ts:37`, `tests/scenarios/S3-query-graph.test.ts:38` — SC01/SC02; §5.1.** Default `openHostScenario` seeds the AG2b plan: no p/w/g/p1/S3 tasks, oB/vB, A.out declaration, old-A or canonical runA. Its existing Work/Query grants also omit look/find. SC02’s literal `runId: 'runA'` does not create that Run. **Direction:** establish the complete frozen SQLite fixture and explicit graph grants through real owners.

58. **Must-fix — `tests/scenarios/S3-context-and-inputs.test.ts:30`, `:46`, `:65` — SC01.** The script looks at the AG2b consumer instead of tA, never reads runA history, and repeats prepare before start rather than after completion/binding. It checks AG2b text, not oB/vB/missing input, and omits Session-count and tB-not-satisfied assertions. **Direction:** follow the frozen action sequence and verify every persistence, input and lifecycle expectation.

59. **Must-fix — `tests/scenarios/S3-query-graph.test.ts:54` — SC02.** `digest: expect.any(String)` does not establish the saved Answer text; checking the task ID omits state/obligations; `expect(historyResult).toBeDefined()` accepts an error or not-found response. **Direction:** read the real Answer body and assert exact task facts plus canonical historical versions.

60. **Must-fix — `tests/scenarios/S3-query-graph.test.ts:67` — SC02.** The case ends after write/edit exclusions. It omits graph expansion/history pagination without model calls, the large Host notification, its byte limit, one consumption and zero second-scan sends. **Direction:** complete that entire second half within SC02’s existing `it`.

61. **Must-fix — `src/contracts/validation/role.ts:26`, `src/app/host.ts:509`, `:574` — part-1 book B.** Existing bodies now perform real duty validation, change the actual Host tool grant and compute the new configuration revision. These are behavioral implementations, not types/signatures/stubs or exhaustive-switch accommodations. **Direction:** defer these behaviors to part 2. Their intended eventual behavior is specified; the violation is the two-stage boundary.

62. **Should-fix — `src/core/agent-runtime/role-profiles.ts:63` — part-1 book A.** The literal profile table is expressly allowed, but `platformRoleProfile` already implements lookup/cloning. A blanket “every behavioral function throws” rule does not exempt this callable body. **Direction:** retain the table and defer callable behavior, or explicitly resolve this exception before freezing.

63. **Must-fix — `src/composition/create-platform.ts:725`, `:978` — §4.6, part-1 book B(e).** Newly exposed `graphContext`/`taskInputs` are raw owners, and `readAttentionGraph` reaches the public Runtime through its spread without a `trackedCall` wrapper. This omits the specified close protection. **Direction:** keep one underlying instance while publishing tracked read adapters.

64. **Nit — `src/ui/api/routes.ts:92` — part-1 write scope.** This is the only changed file outside the listed scope. The two labels are the minimal extension required by `Record<CoreRouteSuffix, string>` after adding the suffixes; no new UI behavior is introduced. **Direction:** record it as a type-forced scope exception.

Two specification seams also need lead clarification: §5.1 says there is no numeric business `planRevision`, while the current Plan contracts/codecs require it; and CA01 requests `inputDigest` although §4.3’s renderer return type has no such field. Keeping the existing required Plan field is appropriate; hashing the renderer’s text does not test a persisted inputDigest.

The remaining inspected production changes are types/signatures/stubs or mechanical wiring: `attention-observer.ts` does not implement its new diff; preparation bodies retain their previous behavior; Runtime shares and forwards to the new assembler; composition construction and route forwarding are expressly allowed.

| Test file | IDs found = expected | Rows checked | Runs |
|---|---|---:|---:|
| `tests/state/context-input.test.ts` | ST01–ST15 | 15 | 15 |
| `tests/work-graph/S3-context-inputs.test.ts` | IN01–IN19 | 19 | 38, M/S |
| `tests/work-graph/S3-graph-context.test.ts` | GR01–GR19 | 19 | 38, M/S |
| `tests/runtime/S3-context-assembler.test.ts` | CA01–CA15 | 15 | 15 |
| `tests/work-graph/S3-prepared-context-admission.test.ts` | AD01–AD08 | 8 | 16, M/S |
| `tests/work-graph/S3-role-profiles.test.ts` | RP01–RP06 | 6 | 12, M/S |
| `tests/runtime/S3-graph-tools.test.ts` | GT01–GT14 | 14 | 14 |
| `tests/app/S3-attention-context.test.ts` | AT01–AT12 | 12 | 12 |
| `tests/app/S3-graph-routes.test.ts` | RT01–RT06 | 6 | 6 |
| `tests/scenarios/S3-context-and-inputs.test.ts` | SC01 | 1 | 1 |
| `tests/scenarios/S3-query-graph.test.ts` | SC02 | 1 | 1 |
| **Total** | **No missing/extra IDs** | **116** | **168** |