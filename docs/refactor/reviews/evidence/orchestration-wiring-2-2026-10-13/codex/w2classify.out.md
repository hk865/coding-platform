**Do not freeze the current suite unchanged.** Of the **76 new cases plus four L12 edits**, I recommend **keep 6 / rewrite 45 / drop or merge 29**. No existing case is ready to keep unchanged as S1–S3 acceptance.

This was a static, read-only review against the [rubric](D:/cc-lead-notes/impl/w2/TEST-RUBRIC.md) and [WP2 specification](D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:247). I changed no files and ran no tests.

The main findings are:

- **S1 is missing.** PI01’s scripted model produces text; its callback directly calls `platform.decisionMessages.sendUserMessage`. It bypasses the Runtime tool handler, argument validation, trusted identity and request-ID construction. See [the callback](D:/cxt/w2-spec/tests/composition/WP2-wiring.test.ts:110).
- **PI01 has a self-derived autonomy expectation.** It sets `every_step`, then obtains the expected value from `readGoalSettings`. Assert the literal `autonomy: every_step`. See [the assertion](D:/cxt/w2-spec/tests/composition/WP2-wiring.test.ts:298).
- **RA04 does not demonstrate preservation of a genuinely bound execution.** It manually constructs the manifest/envelope and calls `rehydratePreparedExecution`; checking `JSON.parse(bytes).input` checks test-created bytes. Its unchanged graph-read counter is also disconnected from that function. See [RA04](D:/cxt/w2-spec/tests/runtime/WP2-context-assembly.test.ts:58).
- **Business tests inspect storage internals extensively.** PI02 queries SQLite events. The NR fixture’s `storeSnapshot()` scans records, events, receipts and claims—and issues deliberately rejected commits to discover claim owners. That is unsuitable for observing business reads. See [PI02’s SQL](D:/cxt/w2-spec/tests/composition/WP2-wiring.test.ts:336) and [the snapshot helper](D:/cxt/w2-spec/tests/helpers/WP2-notices-fixture.ts:250).
- **Several expectations reuse production logic.** DU05 calls `effectivePlatformDuty` to obtain the expected rejection; NR12 calls `storeFailureToRejection`; NR10 reconstructs the cursor encoding and computes its expected ordering.

For classification, public module-port doubles supplying pages, legacy records or failures are acceptable at S4. Assertions about internal invocation sequences are different. Likewise, comparing a replay with an **independently validated original receipt** is legitimate; reading the very field being checked through another projection is not an independent oracle.

File abbreviations below:

| Code | File |
|---|---|
| DU | [WP2-message-duties.test.ts](D:/cxt/w2-spec/tests/work-graph/WP2-message-duties.test.ts) |
| CX | [WP2-context-extensions.test.ts](D:/cxt/w2-spec/tests/work-graph/WP2-context-extensions.test.ts) |
| NR | [WP2-undelivered-notices.test.ts](D:/cxt/w2-spec/tests/work-graph/WP2-undelivered-notices.test.ts) |
| RA | [WP2-context-assembly.test.ts](D:/cxt/w2-spec/tests/runtime/WP2-context-assembly.test.ts) |
| PI | [WP2-wiring.test.ts](D:/cxt/w2-spec/tests/composition/WP2-wiring.test.ts) |
| ST | [WP2-notice-cursors.test.ts](D:/cxt/w2-spec/tests/record-store/WP2-notice-cursors.test.ts) |
| SA | [session-availability.test.ts](D:/cxt/w2-spec/tests/state/session-availability.test.ts) |
| SV | [S1-wait-disposal.test.ts](D:/cxt/w2-spec/tests/work-graph/S1-wait-disposal.test.ts) |

Levels are **1 business flow / 2 module contract / 3 local unit**. Seam classifications describe the **current test**, not its proposed replacement. Manually assembled owner integrations are level 2; they do not become S1–S3 merely by using a real backend.

The duties cases:

| id | file | level | seam | anti-patterns found | verdict |
|---|---|---:|---|---|---|
| DU01 | DU | 2 | S4 | implementation-coupled; duplicate of id DU15 | drop or merge into id DU15: retain pinned-role behaviour, remove collaborator-call assertions |
| DU02 | DU | 2 | S4 | implementation-coupled | rewrite: use literal template/version examples and assert resolved duties; remove invocation assertions |
| DU03 | DU | 2 | S4 | implementation-coupled | rewrite: consolidate fallback cases at adapter output; test sending permissions through DU16 |
| DU04 | DU | 2 | S4 | implementation-coupled | drop or merge into id DU03: preserve the distinct valid-spec-without-duty branch |
| DU05 | DU | 2 | S4 | implementation-coupled; tautological | rewrite: assert literal `forbidden` and specified reason, not `effectivePlatformDuty(...)` |
| DU06 | DU | 2 | S4 | implementation-coupled; mock returns asserted value | rewrite: one fail-closed matrix with literal results, no fallback facts and no internal call expectations |
| DU07 | DU | 2 | S4 | implementation-coupled | drop or merge into id DU06: include inadmissible binding |
| DU08 | DU | 2 | S4 | implementation-coupled; mock returns asserted value | drop or merge into id DU06: include Session-read failures |
| DU09 | DU | 2 | S4 | implementation-coupled; mock returns asserted value | drop or merge into id DU06: include pinned-spec failures |
| DU10 | DU | 2 | S4 | implementation-coupled | rewrite: retain identity/scope mismatch outcomes, remove assertions about which internal reader ran |
| DU11 | DU | 2 | S4 | implementation-coupled | rewrite: create a real readonly copy and prove production admission/tool policy prevents sending |
| DU12 | DU | 2 | S4 | implementation-coupled | drop or merge into id DU16: add ordinary-reviewer behaviour to the production intent matrix |
| DU13 | DU | 2 | S4 | none | keep at module seam: duplicate and conflicting guards are meaningful adapter-contract branches |
| DU14 | DU | 2 | S4 | implementation-coupled | drop or merge into id PI03: cover caller-visible scope/cancellation rejection |
| DU15 | DU | 2 | none | implementation-coupled; side-channel read; tautological | rewrite: production Run invokes the tool; assert one independently specified queue card, not reconstructed commit guards |
| DU16 | DU | 2 | none | side-channel read | rewrite: production tool calls show notify succeeds and decision request is forbidden, with no new decision card |
| DU17 | DU | 2 | none | implementation-coupled; side-channel read | rewrite: replay through production after a boundary fault/role invalidation; retain the validated original receipt |
| DU18 | DU | 2 | S4 | implementation-coupled; side-channel read | rewrite: activate R2 through production and show the old Session cannot acquire R2’s authority |

The context-provider cases:

| id | file | level | seam | anti-patterns found | verdict |
|---|---|---:|---|---|---|
| CX01 | CX | 2 | none | implementation-coupled | drop or merge into id PI03: retain optional-port compatibility in its focused regression coverage |
| CX02 | CX | 2 | none | implementation-coupled; mock returns asserted value | drop or merge into id CX15: use actual setting changes and literal expected context |
| CX03 | CX | 2 | none | implementation-coupled; mock returns asserted value | rewrite: production preparation fails visibly on settings-read failure instead of preparing empty/default context |
| CX04 | CX | 3 | none | none | drop or merge into id RA04: keep its valid G-invariance assertion inside the real settings-change flow |
| CX05 | CX | 2 | none | implementation-coupled | drop or merge into id CX16: demonstrate waiting → answered-pending-application through real owners |
| CX06 | CX | 2 | none | implementation-coupled | rewrite: create real task-associated and Goal cards, then prepare focused context and inspect its visible reminders |
| CX07 | CX | 2 | none | implementation-coupled | drop or merge into id CX06: retain empty-focus/no-active-Plan as a named variant |
| CX08 | CX | 2 | none | implementation-coupled | rewrite: create an actual two-Goal conflict and prepare context for the second Goal |
| CX09 | CX | 2 | none | implementation-coupled | rewrite: production preparation must contain the literal missing-card-source warning while retaining available cards |
| CX10 | CX | 2 | none | implementation-coupled | rewrite: prove a real later-page focused card reaches prepared context; remove queue-call transcript assertions |
| CX11 | CX | 2 | none | implementation-coupled | rewrite: test observable completeness/capacity, using genuinely old pending cards; names beginning `old-` do not establish age |
| CX12 | CX | 2 | none | implementation-coupled; mock returns asserted value | rewrite: a later read failure/window change must prevent partial prepared context |
| CX13 | CX | 2 | none | implementation-coupled | drop or merge into id CX10 for completeness/deduplication; synthetic conflicting-page contracts need an explicitly agreed context-reader seam |
| CX14 | CX | 2 | none | implementation-coupled; mock returns asserted value | drop or merge into id PI03: retain observable authorization/cancellation failure |
| CX15 | CX | 2 | none | side-channel read | rewrite: read default, set `every_step`, prepare through production; remove encoded-record inspection |
| CX16 | CX | 2 | none | side-channel read; tautological | rewrite: prepare before/after answering; assert literal reminder behaviour and public pending-application state, not reconstructed source-pin expectations |

The notice cases:

| id | file | level | seam | anti-patterns found | verdict |
|---|---|---:|---|---|---|
| NR01 | NR | 2 | S4 | implementation-coupled | drop or merge into id NR12: distinguish absent capability from installed-but-failing source |
| NR02 | NR | 2 | S4 | implementation-coupled | drop or merge into id NR15: use actual replies on active/archived unavailable Sessions, not a scan-call list |
| NR03 | NR | 2 | S4 | none | keep at module seam: full-pair identity and cross-page deduplication are substantive rules |
| NR04 | NR | 2 | S4 | implementation-coupled | drop or merge into id NR28: retain original-message and legacy-sender Goal attribution |
| NR05 | NR | 2 | S4 | implementation-coupled | rewrite: assert stable-window output versus mismatch rejection; merge NR29’s cursor mismatches |
| NR06 | NR | 2 | S4 | implementation-coupled | rewrite: assert the independently identified tail item survives both empty-page layers; remove call-transcript assertions |
| NR07 | NR | 2 | S4 | implementation-coupled | rewrite: retain terminal-page versus overflow outcomes; avoid making exact collaborator call counts the contract |
| NR08 | NR | 2 | S4 | none | keep at module seam: distinct-output capacity and rejection without partial results |
| NR09 | NR | 2 | S4 | none | keep at module seam: conflicting duplicate metadata versus identical duplicates |
| NR10 | NR | 2 | S4 | implementation-coupled; tautological | rewrite: use a worked literal ordering and round-trip returned opaque cursors; do not reproduce cursor serialization |
| NR11 | NR | 2 | S4 | implementation-coupled | rewrite: obtain a real cursor, reuse it with incompatible scope/filter/after; retain literal malformed-input and limit cases |
| NR12 | NR | 2 | S4 | mock returns asserted value; tautological | rewrite: literal failure contracts, including Store-error mapping; do not call the production conversion helper |
| NR13 | NR | 2 | S4 | implementation-coupled; mock returns asserted value | rewrite: watermark-aware boundary fixtures demonstrate required freshness through returned results |
| NR14 | NR | 2 | S4 | implementation-coupled | rewrite: fixed old/new-window examples prove whole-window discard and four-attempt failure; avoid cursor-call transcripts |
| NR15 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production unavailable/archive → late reply → queue; use receipt positions and public observations |
| NR16 | NR | 2 | none | implementation-coupled; side-channel read | drop or merge into id NR15: retain continuation-present as a named variant |
| NR17 | NR | 2 | none | implementation-coupled; side-channel read; duplicate of id NR26 | drop or merge into id NR26 |
| NR18 | NR | 2 | none | implementation-coupled; side-channel read | drop or merge into id PI02: retain available-with-response and unavailable-without-response exclusions |
| NR19 | NR | 2 | none | implementation-coupled; side-channel read | drop or merge into id NR22: assert unshown items remain visible, without decoding display tokens |
| NR20 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production seen → later reply → reopen; assert only the later reply remains unseen |
| NR21 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production old reply → another line seen → unavailable; assert the old reply becomes newly visible |
| NR22 | NR | 2 | none | implementation-coupled; side-channel read; tautological | rewrite: fixed expected item order, opaque display tokens, page-by-page seen and reopen |
| NR23 | NR | 2 | none | implementation-coupled; side-channel read | drop or merge into id PI02: retain equal-clock/backward-clock variants for both commit orders |
| NR24 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production health/Work/Query recovery paths yield the same public notice behaviour; remove batch-record inspection |
| NR25 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production Work/Query/user reply paths preserve independently validated original receipts across replay/reopen |
| NR26 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production transfer/archive leaves notice present until actual input acceptance; assert public reply/history outcomes |
| NR27 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: production enter → seen → recover → re-enter shows disappearance and a new unseen occurrence |
| NR28 | NR | 2 | S4 | implementation-coupled; side-channel read | rewrite: retain legacy/filter/corruption contract at S4 using explicit historical inputs; remove the mixed codec/owner/snapshot suite |
| NR29 | NR | 2 | S4 | none | drop or merge into id NR05: R/P inconsistency is another source-mismatch branch |
| NR30 | NR | 2 | none | implementation-coupled; side-channel read | rewrite: boundary fault injection plus public health/message/queue results proves rollback and lost-receipt recovery |

The remaining new cases and four L12 edits:

| id | file | level | seam | anti-patterns found | verdict |
|---|---|---:|---|---|---|
| RA01 | RA | 2 | none | implementation-coupled; mock returns asserted value | drop or merge into id CX16: exercise the real reminder producer and consumer together |
| RA02 | RA | 2 | none | implementation-coupled | rewrite: production preparation under a small budget preserves obligations/continuation and omits whole reminder rows |
| RA03 | RA | 2 | none | implementation-coupled | rewrite: prepare real copy/planning Queries; inspect literal question, autonomy and absence of reminders |
| RA04 | RA | 3 | none | implementation-coupled; tautological | rewrite: bind a real execution, change settings, prepare a fresh execution, then resume/reopen the bound one |
| RA05 | RA | 2 | none | implementation-coupled; mock returns asserted value | drop or merge into id CX06: retain reminder visibility and unchanged admission-source behaviour |
| PI01 | PI | 1 | S2 | implementation-coupled; tautological | rewrite: issue a scripted tool call for S1; use literal autonomy/reminder expectations; remove internal factory mocks |
| PI02 | PI | 1 | S3 | implementation-coupled; side-channel read | rewrite: retain its strong ordering/seen/reopen flow, replace SQL and storage snapshots with boundary observations |
| PI03 | PI | 2 | none | implementation-coupled; side-channel read | rewrite: production Work/Query preparation and authorization outcomes; remove raw-owner spies and platform-key/route-definition snapshots |
| ST01 | ST | 2 | none | duplicate of id TX-bind | drop or merge into id TX-bind: add WP2 field cases to existing transaction coverage; prove owner wiring through NR24/NR25 |
| ST02 | ST | 2 | none | duplicate of id TX-reject | drop or merge into id TX-reject: preserve WP2-specific wrong-schema/registration examples |
| ST03 | ST | 2 | none | duplicate of id TX-rollback | drop or merge into id TX-rollback; retain business failure/retry in NR30 |
| ST04 | ST | 2 | none | implementation-coupled | drop or merge into id NR25 for replay/reopen, and NR28 for legacy/corrupt persisted inputs |
| L12-release | SA | 3 | S5 | none | keep at module seam: literal pending `unavailableSince: null` belongs to the existing transition test |
| L12-observe | SA | 3 | S5 | none | keep at module seam: literal pending field on missing/damaged transition |
| SV33 | SV | 2 | none | tautological | rewrite: expect the retirement commit’s cursor and `replied.cursor`, not values reread from records |
| SV34 | SV | 2 | none | tautological | rewrite: same independent cursor assertions, retaining continuation/no-delivery behaviour |

`TX-bind`, `TX-reject` and `TX-rollback` are labels for existing tests, not additional WP2 IDs: [multi-event binding](D:/cxt/w2-spec/tests/record-store/transaction-extensions.test.ts:153), [invalid binding targets](D:/cxt/w2-spec/tests/record-store/transaction-extensions.test.ts:116), and [final-validation rollback](D:/cxt/w2-spec/tests/record-store/transaction-extensions.test.ts:92). Reading through the RecordStore API **when RecordStore itself is under test** is not a side-channel read. These are legitimate infrastructure contracts, but need not be duplicated in WP2 acceptance.

**Coverage of the rubric’s five flows** is currently:

| Rubric flow | Existing end-to-end coverage through S1–S3 | Gaps |
|---|---|---|
| I-2: member sends a decision request | **None through S1.** PI01 reaches the owner from a model callback; DU15–18 use manually assembled owners | Actual Runtime tool dispatch; formal pinned-role production path; executor and readonly-copy rejection; fail-closed role-read failure; replay through production |
| I-4: changed autonomy affects next preparation | **PI01, partial S2:** setter → fresh preparation | Independent literal expectation; genuine default → change sequence; already-bound execution remains unchanged through production resume/reopen; G remains unchanged |
| I-6: pending cards appear, answered cards disappear | **PI01, partial S2:** pending card → prepared reminder | Answer → next preparation removes it; missing-source warning reaches final text; focus/paging/budget behaviour. CX16 and RA01 do not supply the missing production chain |
| I-5: unavailable Session exposes an undelivered reply | **PI02, partial S3:** both R/P orders, repeated reads, seen and reopen | Production recovery/re-entry; real Work/Query recovery producers; continuation/transfer/actual acceptance; later reply after seen; cross-Goal legacy isolation remains only module evidence |
| Composition: shared production backend, inert reads | **PI01/PI02 provide partial composition evidence; PI02 observes read/model deltas** | No complete four-line production chain; PI tests only SQLite; internal factory mocks and SQL observers remain; preparation is not comprehensively checked for zero model calls |

The NR owner cases contain valuable histories to reuse. They do not establish production composition merely because they exercise memory and SQLite.

**My proposed frozen acceptance set is 15 flow cases at S1–S3**, with named backend and behaviour variants. Use `createTargetPlatform` for both backends; actual persistence/restart variants run on SQLite. Count parameterized executions separately rather than hiding them inside a nominal case count.

For dynamic identifiers, use command inputs and original public receipts as correlation handles. The **expected relationship** comes from the specification: for example, in a deliberately constructed R→P history, the expected notice position is P—not an expectation computed using the production comparator.

| Proposed case | Seam; existing IDs to reuse/rewrite | One-sentence behaviour | Independent expected values |
|---|---|---|---|
| F01 | S1; DU15, DU01, PI01 | A genuinely entered secretary Run calls `send_user_message`, receives success and creates exactly one waiting decision card. | Literal request text/options/intent and allowed duty from L1/L2; tool receipt supplies only the generated message identity |
| F02 | S1; DU16, DU12 | Executor and ordinary-reviewer Runs can notify but cannot create a decision request. | Literal policy matrix: notify succeeds, decision request is forbidden; public queue contains no decision from the rejected action |
| F03 | S1 admission boundary; DU11 | A real readonly-derived Session cannot send user messages and creates no decision card. | Formal readonly-copy prohibition; accept rejection at the actual earlier admission/tool boundary—do not fabricate an entered Work copy |
| F04 | S1; DU17, DU18, DU06 | After a successful request, invalidated/unreadable role facts reject a new request while the original request replays unchanged. | First receipt validated against F01’s literals; L2 fail-closed and receipt-first rules; zero additional cards |
| F05 | S2; CX15, CX02, CX04, RA04 | Changing autonomy updates fresh preparation while an already-bound execution retains its original input and G identity. | Literal `after_plan_confirmation` and `every_step`; independently validated original input; §0.3’s invariance rule |
| F06 | S2; CX16, CX05, CX09, RA01, RA02 | A pending card reaches reminders, disappears after answering, and missing sources/budget omission remain explicit without damaging required context. | Literal card text and warning strings from L5/L9; literal required task/continuation text; waiting versus answered state rules |
| F07 | S2; CX06–08, CX10–11, RA05 | Focused preparation includes the appropriate task/Goal/conflict cards, including eligible tail-page cards, and refuses incomplete capacity results. | A worked, explicitly listed card-membership example; L5/L6 limits; fixed expected rows, not `cards.map(row)` |
| F08 | S2; CX03, CX12, CX14, RA03, PI03 | Work/Query preparation respects scope and mode, and an installed source failure prevents a misleading successful context. | Literal allowed/forbidden scopes, Query question and mode rules; specified failure codes/prefixes |
| F09 | S3; NR15–16, NR24, PI02 | A Session made unavailable through a real supported producer exposes a later reply once, including archived and continuation-present variants. | Ordered R→P worked history: expected position P; literal one-item/unchanged-successor outcomes |
| F10 | S3; NR21, NR23, NR18, PI02 | A previously saved reply becomes newly unseen when its Session later becomes unavailable, regardless of equal or backward timestamps. | Ordered P→R history: expected position R; prior available state has zero notices |
| F11 | S3; NR19–20, NR22 | Marking one displayed item seen leaves same-cursor tail items and subsequently committed replies unseen, including after reopen. | Fixed expected identity sequence and counts after each mark; literal display-scope rule; opaque tokens |
| F12 | S3; NR27 | Recovery removes the reply from undelivered results, and re-entering unavailable creates a new unseen occurrence of the same pair. | Literal sequence: visible → seen → absent → visible; R2 is the later observed transition receipt |
| F13 | S3; NR17, NR26 | Transfer and archive preserve the notice until a real execution accepts the reply, after which it disappears. | Literal notice counts before/after acceptance; original validated reply content and identity |
| F14 | S3; NR25, ST04 | Work, Query Answer and user-answer producers preserve the original reply and position across retries and SQLite reopen. | Literal response body/selection and original command identity; first validated receipt; spec’s unchanged replay relationship |
| F15 | S3; NR30, ST03 | Failed health/reply commits expose no partial business state, while a committed reply with a lost receipt is recovered exactly once. | Known pre-command public state, literal requested reply, controlled fault outcome and original commit observation |

For every applicable read phase, assert **zero new ledger commits and zero scripted-model calls** through the existing production `commitObserver` and model boundary. If “zero writes” also includes artifact/workspace effects, observe those external write boundaries. Do not inspect SQL tables, schema-specific records or internal owner calls.

F07/F08 preserve externally reachable context completeness/failure behaviour. **CX10–13 are not S4 under the proposed definition**, which names the notice source and duties adapter. If §5 retains synthetic conflicting queue-page tests, explicitly add the context reader as a module seam before freezing them; do not disguise those mocks as S2 acceptance.

The necessary **S4 supplement** is:

| Proposed case | Existing IDs | One-sentence behaviour | Independent expected values |
|---|---|---|---|
| M01 | DU02–04 | Exact legacy templates resolve their duties; unknown/version-mismatched templates and valid duty-less specs default only to executor. | Literal five-template/version table and literal executor fallback |
| M02 | DU05, DU10, DU13 | Conflicting duties, identities or guard versions reject, while identical guards collapse. | Handwritten conflict table and fixed expected guard set; no production policy helper |
| M03 | DU06–09 | Resolver, Session and pinned-spec failures never become successful fallback duties. | Literal status/code matrix from L2/§4.1, including absent versus failed |
| M04 | NR03, NR09 | Full message/response pairs deduplicate only when their metadata agrees. | Fixed pair examples, literal cardinalities and specified identity-conflict rejection |
| M05 | NR04, NR28 | Missing legacy positions block only relevant Goals, while corrupt persisted positions reject. | Explicit historical A/B inputs and literal A/B/workspace result table; no database mutation |
| M06 | NR06 | Empty intermediate directory and reply pages do not hide an eligible tail item. | One named tail item from the fixture and the specification’s continuation rule |
| M07 | NR07–08 | Terminal capacity boundaries succeed, while further pages/distinct items reject without partial results. | Literal 50-page and 5,000-item boundaries from L7 |
| M08 | NR10–11 | Same-commit items paginate in complete-key order, and cursors cannot be reused with incompatible requests. | Hand-worked order; returned opaque cursor; literal invalid limits/scope changes |
| M09 | NR05, NR29 | A changed window can recover from metadata disagreement, but stable mismatches reject. | Fixed first/second-window records and literal successful/rejected outcomes |
| M10 | NR14 | `source_stale` or changed watermarks discard the whole window, and four unstable attempts fail. | Fixed old/new item identities; literal four-attempt bound and failure prefix |
| M11 | NR01, NR12–13 | Missing capability, failed reads and insufficient freshness remain distinguishable from an available empty source. | Literal availability/error/freshness matrix; no production error-conversion helper |

The S4 doubles provide **inputs and controlled failures**, not prebuilt duties/notices as the expected result. Their assertions should target the module’s returned contract.

**The four L12 edits need two different decisions.**

The additions in [releaseSessionRecord](D:/cxt/w2-spec/tests/state/session-availability.test.ts:1053) and [observeSessionHealthRecord](D:/cxt/w2-spec/tests/state/session-availability.test.ts:1105) are sound. Literal `null` expresses the specified **pending commit binding** produced by the state transition. These existing S5 regressions do not prove persistence or notice delivery, and should not be counted as new flow acceptance.

The additions in [SV33](D:/cxt/w2-spec/tests/work-graph/S1-wait-disposal.test.ts:140) and [SV34](D:/cxt/w2-spec/tests/work-graph/S1-wait-disposal.test.ts:162) are not sound cursor oracles. If both the stored field and DTO are wrong—or absent—the projection comparison can still agree.

Use:

- **P = `replied.cursor`**, already returned by the reply command.
- **R = the commit receipt cursor captured around `retire()`**, before continuation/archive/reply commits. In production use `commitObserver`; in the existing fixture, capture only the corresponding receipt cursor, not values from its record/event payload.
- Assert the DTO contains those R/P values. Insert an unrelated later commit before reading to catch implementations that substitute the current watermark.
- Preserve the original assertions about continuation, reply retention and absence of delivery.

This follows the specification’s independent relationship “field equals its originating commit position.” It does not guess absolute ledger sequence numbers.

Alternatively, once F09/F14 own exact cursor provenance, SV33/SV34 can remain focused on their original delivery semantics. That would require explicitly revising L12’s current full-DTO assertion requirement; merely omitting the fields now would weaken the frozen specification.

Counts are by **existing named case/edit**, not backend executions or loop branches. “Drop/merge” removes a standalone case while retaining any distinct required behaviour at the named destination.

| Group | Keep | Rewrite | Drop/merge | Total |
|---|---:|---:|---:|---:|
| DU | 1 | 10 | 7 | 18 |
| CX | 0 | 9 | 7 | 16 |
| NR | 3 | 18 | 9 | 30 |
| RA | 0 | 3 | 2 | 5 |
| PI | 0 | 3 | 0 | 3 |
| ST | 0 | 0 | 4 | 4 |
| **New WP2 cases** | **4** | **43** | **29** | **76** |
| Four L12 edits | 2 | 2 | 0 | 4 |
| **Total** | **6** | **45** | **29** | **80** |

The six keeps are **four S4 module contracts and two existing S5 transition edits**. The proposed replacement acceptance set is **15 production-flow cases plus 11 focused S4 contracts**, with existing infrastructure regressions retained and consolidated separately.