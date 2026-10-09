Reviewed the working-tree specification against commit `216e0e2b`, including the requested decisions, slice specifications, code, fixtures, and `e48218a5`. No files were changed, no tests were run, and no model provider was called.

**The specification needs correction before implementation.** The strongest blockers are an E15 maintenance race that contradicts the promised archive path, and GE05’s unreachable fixture.

## PART A — E15: coordinated state transitions

For code references below:

| Alias | File |
|---|---|
| WF | `src/business/workflow/workflow.ts` |
| MA | `src/business/workflow/session-maintenance.ts` |
| AR | `src/business/workflow/session-archive.ts` |
| RS | `src/core/work-graph/sessions/session-responsibility-service.ts` |
| SR | `src/core/work-graph/state/session-responsibility.ts` |
| SF | `src/core/work-graph/tasks/session-facts.ts` |
| SL | `src/core/work-graph/session-lifecycle.ts` |

`P` is the predecessor, `C` its continuation, `T` the task, and `h` the responsibility-transfer commit cursor. “Retired” means `health === 'unavailable'`; it is independent of `lifecycle === 'archived'`.

### The four views

| View | Normal E15 progression |
|---|---|
| **1. Sessions** | P remains `active`, with its existing health, while C is created `active/available`, unoccupied. Transfer increments **both** Session revisions. Archiving P changes its lifecycle and clears its archive request; it does not rehabilitate its health. Claiming T subsequently occupies C. |
| **2. Responsibility links** | Creating C already opens C’s responsible link to T. Temporarily, P and C both have open links. Transfer closes P’s link at `until=h`, increments its link revision, and preserves its `since`. C’s already-open link retains its revision and `since`. |
| **3. Archive request** | P’s request goes `absent → registered(handoff_complete) → absent`, with P becoming archived at the final transition. A partial failure after registration leaves the request durable and resumable. A first-acceptance refusal creates no request. |
| **4. Workflow** | Selection runs maintenance **before** choosing work. A perform step executes and constructs its next operation **before** its trailing maintenance page. Thus the returned operation can already have stale pins when maintenance finishes. |

The operative ordering is:

```text
select_work:
  maintenance(one page) → select next operation

perform:
  execute step → construct next operation
               → skip maintenance only for top-level replayed:true
               → otherwise maintenance(one page)
               → return the previously constructed next operation

E15:
  create_session → transfer_responsibility
                 → retired P: maintenance archive → claim_task
                 → eligible live P: archive_predecessor → claim_task
                 → other cases/refusals: claim_task
  claim_task → prepare → start
```

Maintenance uses a bounded Session-directory page and a cursor; a particular P need not be visited on a particular call. Within a visited Session, the important ordering is:

```text
legacy-provenance resolution
→ existing archive-request recovery
→ unknown-outcome occupancy guard
→ terminal responsibility cleanup
→ retired / copy / executor-idle archive decision
```

### Transition table

The table distinguishes existing behavior from W’s proposed additions.

| ID | From-state | Trigger and guard | To-state | Writes | Specification / code |
|---|---|---|---|---|---|
| A1 | P retired, unoccupied, no continuation or R; T’s link open; latest interruption platform-proven clean, without a human pause fence | Pre-selection maintenance visits P; existing retirement conditions pass | P archived before ordinary continuation selection | Existing retired archive may create an anomaly anchor and drop responsibility; **this request does not create an archive-origin requeue when its execution is `none`** | L15; MA:`platformCleanInterruption`, lines 504–526; AR:575–580 |
| A2 | P retired with `kernel_turn_open`, T link open, no R | Pre-selection maintenance; pause-fenced interruption or human-attested stop does not satisfy `platformCleanInterruption` | P remains active/retired; later selection can create C | No retirement-branch writes | L15, HO01, SC01; MA:514–516; `A8-host-restart-paused.test.ts` |
| A3 | Requeued T, predecessor P; no selected successor | `select_work` after maintenance; selection chooses creation and `continuationProvenanceFor` accepts P | `create_session` operation carrying continuation provenance | None | §4.4.1; WF:718, 992–1048 |
| A4 | C absent; P→T open | Perform `create_session`; public owner completes | C active/available, no occupancy/R; C→T open, link revision 1; proposed next is transfer | C and its initial responsibility link are created | W1-HO-01, HO01; WF:1041–1048, 1304 |
| A5 | P→T open; C→T normally already open | Transfer; four pins match, T’s writer stopped, scope/target valid, C eligible | P→T closed at h; C→T remains open; P and C Session revisions each +1 | Atomic transfer writes both Sessions and links; P link revision +1, `until=h`; C link unchanged when already open | W1-HO-02, HO02; RS:`runAttempt`; SR:33–67, 95–107 |
| A6 | Same, but C→T absent or closed | Transfer with appropriate destination-link pin | Destination link opened/reopened | Absent link becomes revision 1; closed link becomes revision +1; `since=h`, `until=null`; both Session revisions +1 | §4.4.2; SR:`openDestination` |
| A7 | Transfer request prepared | Any transfer guard fails, e.g. a stale Session pin | Owner rejects; proposed Workflow next is claim using a fresh C read | Transfer itself writes nothing; trailing maintenance can still write | L11, HO08; SR:39–56; WF:1495–1500 |
| A8 | P active/retired, no R or occupancy, continuation exists | Maintenance visits P; unknown-outcome guard passed; terminal links cleaned; no open task/work responsibility remains | P archived through `handoff_complete` | Request registration, then archive completion; no handoff anomaly or requeue; terminal cleanup may add preceding writes | W1-AUTO-01, HM01/HM04; proposed §4.4.8 inserted into MA after line 498 |
| A9 | P retired with continuation and an open **nonterminal** task/work link | Maintenance visits P | P retained | No writes from the new retired-continuation branch | HM02; W1-AUTO-01; MA:`closeTerminalResponsibilities` runs first |
| A10 | P retired and occupied by an `outcome_unknown` Run | Maintenance visits P, with no existing R | Retained; maintenance reports `busy/archive_unknown_confirmation_required` | No writes for this guard | L14, HM03; MA:473–498; decision 45 |
| A11 | Transfer committed; P active, health not unavailable, no R/occupancy/wait | Fresh P/facts reads succeed | Proposed `archive_predecessor` operation, pinned to the P revision just read | No writes while constructing the operation | W1-HO-02; §4.4.3–4 |
| A12 | P meets A11, R absent | Perform archive; pin valid; no unchosen unfinished task/work responsibility | R registered with `mode:'handoff_complete'`, execution `none`, tasks `[]`, wait `null`; then P archived/R cleared | Normally P revision +1 for registration and +1 for completion; no anchor, requeue, or message disposal | W1-HO-03, L14; AR:`archiveLine`, `drive`; SL:`requestSessionArchive`, `finishSessionArchive` |
| A13 | P also has an unfinished T2/work responsibility | Perform the same empty-choice archive | `invalid/archive_disposal_required`; P active, R absent; next claim | Zero archive writes | HO04; AR:294–314 |
| A14 | P live but occupied, waiting, already archiving, archived, or unreadable | Post-transfer eligibility check fails | No explicit predecessor-archive operation; next claim, if claim prerequisites can be read | No archive writes | §4.4.3, HO05 |
| A15 | P has a registered R; archive stopped partway | Next maintenance page visits P | Existing archive drive resumes; either remains pending or archives P/clears R | Remaining durable archive steps only | Existing recovery, **also applicable to live P**; MA:473–478; AR:`continueArchiveLine` |
| A16 | C eligible, T requeue still claimable | Perform fresh-pinned `claim_task` | New claim/Run; C occupied by the claim | Existing claim-owner writes; transfer’s C revision increment must already be reflected | L10, §4.4.5; WF:`buildClaimOperation` |
| A17 | Claimed Run starting/unbound | `prepare`, then successful `start` | Prepared artifacts, then authorized/entered execution | Preparation stores artifacts; authorization binds the Run; neither operation transfers responsibility | WF:1336–1353; `execution-preparation.ts:prepareExecution`; `execution-entry-service.ts:authorizeRuntimeEntry` |
| A18 | C created, P→T still open; process stopped before transfer | Fresh selection, after maintenance; reusable C has matching continuation provenance | Transfer reconstructed with current pins | Selection itself writes nothing | W1-HO-04, HO06; proposed insertion in WF:`claimRequeued` |
| A19 | Transfer committed, no archive request yet; process stopped | Fresh selection | Retired P can be archived by maintenance; live P gets no reconstructed explicit archive under L13 | Maintenance-dependent; live P is **not guaranteed** to remain active | L13, HO07; MA:`finishedAtProof` |
| A20 | A completed owner request is resent | Owner receipt lookup matches identity/fingerprint | Original receipt/cursor replayed; Workflow derives the next operation from current facts | No repeated owner write; direct top-level `replayed:true` suppresses trailing maintenance | W1-HO-01/02; HO12; RS:359–405; WF:1495–1500 |

An archive request already registered before a crash is materially different from a crash **before registration**. L13’s omission concerns the latter. Existing maintenance still resumes the former, including for live predecessors.

### F1 — must-fix: live predecessor maintenance competes with explicit handoff archiving

- **Spec:** §0.2 L12–L13; §7.3; HO03, HO07.
- **Code:** [session-maintenance.ts:173](D:/cxt/w1-spec-check/src/business/workflow/session-maintenance.ts:173), `finishedAtProof`; lines 538–558; [workflow.ts:1495](D:/cxt/w1-spec-check/src/business/workflow/workflow.ts:1495).

A production-reachable counterexample is:

1. P’s pinned role explicitly has executor duty.
2. P previously completed another task U; U’s terminal close is older than the idle threshold.
3. P still owns unfinished T, preventing idle archive.
4. A role-mismatch continuation transfers T to C.
5. Workflow constructs `archive_predecessor(P@r)`.
6. Trailing maintenance ignores T’s nonterminal transfer close **but still uses U’s terminal close**. It archives P as `executor_idle`.
7. The returned handoff archive operation now carries a stale P pin.

Thus “one line, one archive path” is false. Likewise, after a transfer/crash, the maintenance preceding fresh selection can archive P, contradicting HO07’s unconditional `P active` expectation.

**Suggested direction:** Specify how live handoff archival and executor-idle maintenance coordinate, including older terminal responsibility history and pins constructed before maintenance.

### F2 — should-fix: maintenance is not restricted to committed perform steps

- **Spec:** §0.2 L10–L12; §3 Workflow rows; HO12.
- **Code:** `src/business/workflow/workflow.ts:1491–1500`; `src/business/workflow/session-archive.ts:archiveLine`.

The comment says “only when the step really committed,” but the implementation only excludes a receipt result with top-level `replayed:true`. Refusals, preparation results, and other non-replayed results still trigger maintenance.

Archive composition results do not become top-level `replayed:true` merely because their constituent receipts replayed. Therefore an archive replay can still run maintenance.

This matters when interpreting “zero writes”: a refused transfer/archive owner can write nothing while its enclosing `advanceWork` writes through maintenance.

**Suggested direction:** Freeze the actual maintenance predicate and distinguish owner-local zero writes from whole-advance writes.

### F3 — should-fix: create replay cannot guarantee the same next operation

- **Spec:** §3 W1-HO-01, “原 create 回执重放时 next 相同.”
- **Code:** `src/business/workflow/workflow.ts:performStep/create_session`; `claimRequeued`; `src/core/work-graph/state/session-responsibility.ts:58`.

Immediately after creation, P→T is open, so the proposed next operation is transfer. After that transfer succeeds, replaying the original creation receipt finds P→T closed and must take the claim fallback. Even before transfer, another legitimate Session write can change the freshly derived transfer pins and request ID.

The owner receipt can be identical; the derived Workflow continuation generally cannot.

**Suggested direction:** Promise receipt idempotence separately from recomputing the next operation from current facts.

### F4 — should-fix: L15 incorrectly attributes an archive-origin requeue to retirement maintenance

- **Spec:** §0.2 L15.
- **Code:** [session-archive.ts:575](D:/cxt/w1-spec-check/src/business/workflow/session-archive.ts:575); `src/core/work-graph/session-lifecycle.ts:deriveExecutionAndPins`.

For the described already-ended, unoccupied predecessor, the archive request’s execution is `none`. The archive drive can create the retired anomaly and drop responsibility, but only a request with `R.execution.kind === 'work'` adds the execution-origin requeue.

The existing ordinary restart/advance path performs the later requeue. L15 is correct that maintenance can archive P before continuation creation, but wrong about the requeue’s origin.

**Suggested direction:** Separate retirement’s anchor/drop writes from the subsequent ordinary requeue.

## PART B — G: preparation, entry, refusal, and rebinding

The intended digest is:

```text
sha256(canonicalJson({
  contentVersion: 1,
  goalId,
  objective,
  workspaceId
}))
```

It is placed in the matching Goal record source of a **Work** context binding. It is not a digest of the complete rendered Goal section.

The preparation view and persisted Run view must remain distinct: preparing an unbound Run creates prepared artifacts; the Run fixes its input binding at successful authorization.

| ID | From-state | Trigger and guard | To-state | Writes | Specification / code |
|---|---|---|---|---|---|
| G1 | Run starting/unbound; graph facts available | `prepare`; matching Goal source exists | Prepared manifest contains current Goal-content digest | Prepared input/manifest artifacts; no authorization or fixed Run input binding yet | §4.3.1, GC03, GE01; `context-assembler.ts:922–934`; `execution-preparation.ts:prepareExecution` |
| G2 | Same, Query assembly | `assembleQuery` | Existing Query binding unchanged | Existing Query preparation only | L2, GC04; `context-assembler.ts:assembleQuery` |
| G3 | Prepared, unbound | Fresh entry; existing admission passes; matching Goal digest is a string and matches current Goal | Authorized generation 1; binding fixed | Existing authorization commit and event | W1-CTX-01, CTX-01; `execution-entry-service.ts:authorizeAdmission`, `authorizeRuntimeEntry` |
| G4 | Prepared, unbound | Matching Goal string digest differs | `revision_conflict/context_goal_changed:`; Run remains unbound | No entry-owner writes or authorization event | GE02; proposed insertion after `contextConsumptionProblem`’s Workspace loop, line 1141 |
| G5 | Prepared, unbound | Matching Goal source absent, assembly absent, or digest `null` | G adds no refusal; other guards still decide | Normal authorization if all other checks pass | L2, §4.3.2, GE03; `contextConsumptionProblem:1123` |
| G6 | Prepared, unbound; Workspace source version and Goal digest both stale | Entry | Workspace-specific refusal first | No entry-owner writes | GE06; `execution-entry-service.ts:1135–1141` |
| G7 | Prepared under P1; unrelated P2 adopted | W3 permits carried-unchanged task; displayed Goal content unchanged | Entry allowed; audit names active P2 | Normal authorization with current-Goal CAS and W3 guards | GE04, C6; `execution-entry-service.ts:1494–1508`; `e48218a5` |
| G8 | Workflow performing start | Runtime returns exactly `revision_conflict` plus `context_goal_changed:` prefix | `advance`, next is prepare for the same Run | No write from this mapping; enclosing maintenance can write | W1-WF-01, WF01; `execution-driver.ts:553–560`; proposed WF start branch |
| G9 | Workflow performing start | Any other refusal | Existing `waiting`, no next operation | No write from mapping; maintenance caveat remains | WF02; WF:`performStep/start` |
| G10 | Same Run still unbound after G4 | Re-prepare, even with the same deterministic prepare request ID | Fresh assembly/current digest; subsequent entry can pass | New prepared artifacts as needed | L4; `execution-preparation.ts:173–178`, unbound assembly branch |
| G11 | Run already bound; authorization revoked | Re-prepare/re-authorize with **exactly the fixed binding and envelope** | Rehydrated preparation; authorization generation increments; no source freshness check | Existing reauthorization commit | CTX-02; `execution-preparation.ts:173–176`; `execution-entry-service.ts:1224–1230` |
| G12 | Revoked Run, but caller substitutes a different binding/envelope | Reauthorization | `invalid` fixed-binding refusal, before proposed G comparison | No authorization write | `state/run-machine.ts:1302–1305`, `preparedFixedBindingGuard:1337–1344` |
| G13 | Original authorization request already committed | Same request replayed | Original receipt returned before new freshness checks | No new authorization write | W1-CTX-01 idempotence; `execution-entry-service.ts:lookupCommit` |

The current Goal revision must still be guarded at commit time. That is different from reintroducing the **prepared context’s old Goal revision** as a consumption guard. `e48218a5` removes the latter; line 1504 retains the former.

### F5 — must-fix: GE05 cannot be constructed through today’s production owners

- **Spec:** §0.2 L1/L4; §5.1; §5.2 GE05; §7.10.
- **Code:** [run-machine.ts:1337](D:/cxt/w1-spec-check/src/core/work-graph/state/run-machine.ts:1337); `src/core/work-graph/tasks/execution-entry-service.ts:authorizeAdmission`; `src/core/agent-runtime/execution-preparation.ts:173`.

GE05 requires a revoked, previously authorized Run whose fixed manifest already contains a non-null Goal digest different from the current Goal:

- Put the mismatching digest into the first authorization: the new G guard rejects it.
- Replace the manifest/binding after revocation: `preparedFixedBindingGuard` rejects it.
- Authorize a matching digest, then change today’s Goal content: L1 correctly records that no current production owner performs that change.

Real revocation is reachable; the required **revoked-plus-stale-fixed-digest combination** is not. The existing admission suite’s raw-record manipulation is not a permissible escape from this specification’s explicit prohibition.

**Suggested direction:** Cover real fixed-binding reauthorization separately, and test the stale-digest rebinding branch at a declared unit seam or future supported Goal-change boundary.

### Frozen bytes and existing tests

The proposed mapping is compatible with the inspected frozen assertions:

- `goalPayload` remains byte-for-byte unchanged.
- G changes `contextAssembly.sources`, hence manifest bytes and manifest digest. **G alone does not change the rendered input text.**
- Sorting must occur after mapping because the digest participates in the canonical source key.
- Query assembly remains unchanged.
- CA14 and GR13 exercise absent extension wiring and can retain their `not_implemented` expectations.
- I-3 independently changes production reminder text, as §5.3 acknowledges.
- I found no existing frozen assertion in the cited suites requiring the former production manifest hash or requiring a Work Goal-source digest to remain `null`.

This is a static compatibility assessment, not a claim that those tests passed.

## PART C — Every §5.2 test row

“OK” means its expected behavior follows from the specified change and current owners, with an ordinary valid fixture. It does not mean executed.

### GC — 4 rows

| Row | Assessment |
|---|---|
| GC01 | **OK.** Pure content projection and canonical SHA-256 expectation are consistent. |
| GC02 | **OK.** Revision, active plan revision, and desired state are excluded; objective is included. |
| GC03 | **OK.** Matches G1. Map before sorting; only the same-Goal record source changes. Goal section bytes can remain unchanged. |
| GC04 | **OK.** Query uses its separate assembly path; Work-only mapping need not affect it. |

### AN — 8 rows

| Row | Assessment |
|---|---|
| AN01 | **OK.** The real list item is `{anchor, pickedUpBy}`. Filter the view’s `pickedUpBy`, then map its nested `anchor`; use that real shape in the fake. Anchor revision 1 and null digest are consistent. |
| AN02 | **OK.** Successfully reading zero anchors means `available` with no rows. |
| AN03 | **OK.** Two pages and key ordering follow §4.2. The different text for `retired_archive` matches its declared cause. |
| AN04 | **OK.** Provider-level catch yields the specified message; explicit rejections propagate. |
| AN05 | **OK as the specified limit test.** The limit has the additional user-visible historical-anchor consequence in F10. |
| AN06 | **OK for the internal adapter.** It tests context conversion, not public authorization. Missing workspace/cross-project requests must be rejected before calling the list owner. |
| AN07 | **OK.** A canonical Work Run for another task in the same Goal/workspace can read the Goal-wide anomaly projection. It need not be the anchor’s task. |
| AN08 | **OK with a small valid assembly fixture.** Whole-row optional budgeting still applies; the fixture must leave room for the row within 4096 bytes. The annotation and notice expectations match `optionalRowsFromExtensions`. |

**I-3 authorization conclusion:** The proposed context switch is safe within its stated internal boundary and is reachable.

`graph-context-reader.ts:resolveReadContexts` verifies Work/Query provenance and scope before extension reads; `loadUniverse` also performs the relevant resolution. The calls at lines 1332, 1474, and 1542 occur after those checks. The anomaly owner then independently checks Goal project/workspace at `session-anomaly-service.ts:614–650`.

The adapter itself must not become a public authorization boundary: directly accepting an arbitrary `work_run` context and replacing it with Host would not establish that Run’s authority. L7’s restriction to the verified graph-reader call sites is essential.

### GE — 6 rows

| Row | Assessment |
|---|---|
| GE01 | **OK.** Real fresh preparation followed by entry exercises G1/G3. |
| GE02 | **OK.** A manually constructed, internally valid stale manifest for an **unbound** Run can reach the new guard without database editing. |
| GE03 | **OK.** Null is the explicit compatibility bypass, subject to all other admission checks. |
| GE04 | **OK.** Digest excludes adoption-only fields; current-Goal CAS and W3 still protect entry. This preserves C6. |
| GE05 | **Impossible as specified — F5.** The stale fixed binding cannot be produced through today’s production owners under the no-record-edit rule. |
| GE06 | **OK.** Workspace mismatch must precede the new Goal comparison, provided earlier manifest/admission checks are valid. |

### WF — 2 rows

| Row | Assessment |
|---|---|
| WF01 | **OK for the next-operation assertion.** Exact code/prefix selects same-Run preparation. “No writes” must not be extended to the entire enclosing advance; see F2. |
| WF02 | **OK.** Ordinary revision conflict remains waiting. Same maintenance qualification applies. |

### DU — 9 rows

| Row | Assessment |
|---|---|
| DU01 | **OK.** The pinned RoleSpec’s explicit secretary duty outranks membership in ordinary Work bindings. |
| DU02 | **OK.** A successfully read RoleSpec without duty falls back to canonical Work-binding membership. |
| DU03 | **OK.** No duty and no matching Work binding yields unknown. |
| DU04 | **OK.** All three read failures return ready/unknown, rather than taking the executor fallback. |
| DU05 | **OK.** Exact `platform-reviewer@s3.1` recognition yields reviewer. |
| DU06 | **OK.** `builder@1` is not a special platform template; membership controls the fallback. |
| DU07 | **OK.** The obsolete revision is not one of the exact five recognized templates. |
| DU08 | **OK.** Missing context stops RoleSpec reading and returns unknown. |
| DU09 | **Needs fixture clarification — F6.** The control must use independently created pinned-role Sessions/fixtures, not change S’s existing RoleSpec pin or mutate its installed RoleSpec. Its executor case must also satisfy the ordinary idle-archive conditions. |

The I-1 algorithm itself is consistent with `role-profiles.ts`, `effectivePlatformDuty`, and pinned `readRoleSpec`. It intentionally does not reuse `effectivePlatformDuty`’s default executor value when duty evidence is absent.

### HO — 12 rows

| Row | Assessment |
|---|---|
| HO01 | **OK with its explicit L15 fence.** A bare helper `interruptWork` clean interruption is insufficient: pre-selection maintenance can archive P first. A paused/interrupted or correctly attested path is needed. |
| HO02 | **Missing maintenance-page precondition — F6.** Transfer/link/revision expectations are correct. Same-call archival additionally requires P to be in that trailing maintenance page and the page/owners to succeed. |
| HO03 | **Not generally guaranteed — F1/F6.** Requires no reusable role-X Session and no competing due executor-idle archival of P. Without the latter, the queued archive pin can already be stale. |
| HO04 | **OK.** Another unfinished task blocks first acceptance of the empty-choice archive with zero archive writes and no R. That link also prevents the particular idle-archive race in F1. |
| HO05 | **OK.** Transfer’s writer-stopped proof concerns T. P being occupied by another task does not itself prohibit transfer; occupancy does prohibit immediate predecessor archival. |
| HO06 | **OK.** Created C is discoverable through its open responsible link; matching provenance plus P’s still-open link reconstructs transfer. |
| HO07 | **Expected active state is not unconditional — F1.** Pre-selection maintenance can archive a live P using older terminal task history. It holds only after adding a not-due condition. |
| HO08 | **OK for transfer refusal and fresh-C claim construction.** Publicly adding an unrelated link can bump C’s Session revision. This deliberately leaves P→T open; see the product-policy issue in F8. |
| HO09 | **Missing selection precondition — F6.** An archiving/archived predecessor suppresses continuation provenance, but does not force `create_session`; ordinary selection may reuse another eligible Session. |
| HO10 | **OK.** Missing optional responsibilities port preserves the narrow-double behavior. |
| HO11 | **OK.** Reusing an ordinary, non-continuation original Session does not trigger W1-HO-04. |
| HO12 | **OK for an immediate resend with C otherwise unchanged.** Transfer owner replay preserves cursor and top-level `replayed:true` skips maintenance. “Same next” is not a general guarantee after intervening C/claim changes. |

### HM — 4 rows

| Row | Assessment |
|---|---|
| HM01 | **OK when P is included in the page, R absent, and ordinary fixture prerequisites are satisfied.** The new retired-continuation branch selects `handoff_complete`; C is untouched. |
| HM02 | **Missing nonterminal condition — F6.** An open link to a terminal T is closed by the existing earlier cleanup, producing writes and potentially immediate archive. |
| HM03 | **OK.** Existing unknown-outcome occupancy guard precedes terminal cleanup and the new branch. A newly created, provenance-resolved fixture preserves the intended zero-write assertion. |
| HM04 | **Missing no-occupancy condition — F6.** Module-only links do not block this retired handoff archive, but occupancy still does. |

### SC — 2 rows

| Row | Assessment |
|---|---|
| SC01 | **Reachable and otherwise consistent.** A8’s pause-before-crash route supplies the required protection. Retired P needs no explicit archive Workflow step. The undefined “§11 invariants” reference needs correction — F7. |
| SC02 | **OK.** Operator archival of running work can create the anchor and archive-origin requeue. Preparation includes it; actual successor entry makes pickup derivable. A clean fixture must contain no other unpicked anchors for final `rows=[]`. |

### F6 — should-fix: several fixtures omit conditions required for their exact expectations

- **Spec:** §5.2 DU09, HO02, HO03, HO09, HM02, HM04.
- **Code:** `src/business/workflow/session-maintenance.ts:428–431, 498–500, 538–558`; `src/business/workflow/workflow.ts:739–783`; `tests/helpers/S1-workflow-archive-fixture.ts:createTaskClaimFixture`.

The material omissions are:

| Row | Required clarification |
|---|---|
| DU09 | Use separate pinned-role constructions for the counterfactual; require no occupancy/wait/module responsibility and a provable terminal close at t0. |
| HO02 | Ensure the trailing maintenance page includes P. “One page” does not guarantee immediate visitation. |
| HO03 | Ensure selection cannot reuse an existing role-X Session; isolate the intended archive path from F1. |
| HO09 | Ensure no eligible alternative Session exists. The shared fixture creates a second builder Session, so ordinary reuse is a concrete possibility. |
| HM02 | State that T is nonterminal; open is not equivalent to unfinished. |
| HM04 | State that P is unoccupied and has no existing archive request selecting a different recovery path. |

**Suggested direction:** Freeze these prerequisites in the fixture contract before freezing exact outcomes.

### F7 — note: some citations do not identify the claimed rule

- **Spec:** §0.1, §0.2 L12, §0.4, SC01.
- **Code/document locations:** `workflow.ts:1353` starts the start branch; `session-responsibility-service.ts:197` defines `destinationEligible`; slice-1 E15 text is at `slice-1-SPEC.md:801`; `session-archive.ts:776` concerns receipt lookup.

SC01 says “§11 invariants,” but this wiring document has no §11. If it means the main state-machine specification, that document and the intended invariants need to be named. Several numerical citations also point just before or to a different part of the claimed symbol.

**Suggested direction:** Prefer qualified document sections and `file:symbol` references; correct the misleading line references.

## PART D — Important transitions without a covering test row

These are coverage gaps in the specified matrix, not a request to run additional tests during this review.

| Uncovered transition | Why it matters |
|---|---|
| **A5 → competing maintenance → stale A11 operation**, with an older terminal U | Directly exposes F1; no existing HO/HM row combines handoff with executor-idle history. |
| **Refused perform → maintenance**, and archive-composite replay → maintenance | Establishes actual whole-advance writes and pin validity; HO12 only covers direct transfer replay. |
| **Create replay after transfer**, or after a legitimate pin-changing write | Exposes the W1-HO-01 idempotence contradiction. |
| **Registered handoff archive → crash → maintenance resume → completion** | Verifies the durable recovery path that remains supported even for live P, unlike the pre-registration L13 gap. |
| **P outside the current maintenance page → later page visits P** | Distinguishes eventual bounded maintenance from HO02’s immediate expectation. |
| **Open terminal responsibility → cleanup → handoff archive** | HM02 tests an open link but does not distinguish the terminal and nonterminal branches. |
| **Live P waiting → skip immediate archive; later wait resolves** | The spec skips archival but supplies no ordinary-continuation recovery branch that later revisits this live predecessor. |
| **Failed transfer → successful claim/start of C** | HO08 stops at the next operation; it does not verify the resulting retained P responsibility or its later recovery. |
| **Unreadable P/C/facts, or claim reconstruction failure** | §4.4 distinguishes proceeding to claim from waiting when claim prerequisites cannot be read; no row tests that boundary. |
| **G mismatch → Workflow re-prepare → successful second start**, using the real preparation owner | GE02 and WF01 independently cover pieces, but no row proves the complete same-Run recovery path or that the deterministic prepare ID does not replay stale preparation. |
| **Old binding with no matching Goal source / no context assembly**, and an unrelated Goal source | GE03 only covers a matching source with null digest. |
| **Authorization receipt replay with the new guard installed** | The spec expressly preserves receipt-before-guard behavior, but no new GE row exercises it. |
| **Actual fixed-binding revoked reauthorization** | Needed after correcting GE05; it must retain the exact original binding and envelope. |
| **Query principal through the I-3 adapter; denied Work/Query context never reaches it** | AN06 directly tests conversion and AN07 tests an allowed Work principal; neither validates the full Query/denial boundary. |
| **I-3 late-page failure, `not_found`, `not_ready`, or cancellation** | §4.2 specifies these outcomes, but AN04 only tests rejection/throw and AN05 tests exhaustion. |
| **More than 1,000 historical anchors, all picked up** | Exposes the availability consequence in F10 rather than merely the synthetic endless-cursor case. |

## PART E — User-visible choices not already settled

The following are behavioral choices, not merely implementation placement or request-ID details.

### F8 — should-fix: failed responsibility transfer is allowed to leave the old line responsible while C proceeds

- **Spec:** §0.1 “无”; L11; §7.1; HO08.
- **Code:** `src/core/work-graph/state/session-responsibility.ts:39–67`; `src/business/workflow/workflow.ts:claimRequeued`, `performStep/claim_task`.

L11 treats every transfer refusal as permission to proceed to claim. Because creation already opened C→T, a stale transfer pin can leave **both P→T and C→T open** while C runs. Once claim succeeds, W1-HO-04’s requeued-task recovery is no longer a guaranteed next step.

The user can see the old line remain responsible—the defect decision 47 asks E15 to repair. Existing approval of partial handoff, where P retains **other** tasks, does not settle retention of P’s responsibility for **this same T** after a failed transfer.

**Suggested direction:** Explicitly settle the visible failure outcome and eventual reconciliation, instead of classifying universal proceed-on-refusal as behavior-neutral.

### F9 — should-fix: omitting live-predecessor archival after a crash changes visible line retention

- **Spec:** §0.1; L13; §1.2; HO07.
- **Code:** `src/business/workflow/workflow.ts:claimRequeued`; `src/business/workflow/session-maintenance.ts:finishedAtProof`.

L13 deliberately leaves a live predecessor active after successful transfer if execution stops before archive-request registration. Without another applicable archive rule, that Session can remain in standby indefinitely instead of joining archived lines.

Decision 47 authorizes transferring responsibility and archiving the old Session where possible. It does not explicitly select this crash-dependent retention policy. Calling it a conservative crash edge does not make its line-count and retention effects invisible. F1 additionally shows that L13’s claimed outcome is not universally implemented.

**Suggested direction:** Record this as an explicit visible exception or provide recovery that preserves the agreed archival outcome.

### F10 — should-fix: historical anchor volume becomes a new blocker for graph reads and Work preparation

- **Spec:** L8; §4.2.3; AN05; §0.1 “无.”
- **Code:** `src/core/work-graph/tasks/session-anomaly-service.ts:652–679`; `src/core/work-graph/views/graph-context-reader.ts:390–401, 1332, 1474, 1542`.

`listSessionAnomalies` pages **all** anchors before the provider filters `pickedUpBy`. Consequently, a Goal with 1,001 historical anchors can hit the provider’s ten-page refusal even if every anchor has been picked up and the desired reminder index is empty.

This refusal propagates into context preparation and the wired graph reads. The existing frozen rule that genuine extension-read failures propagate does not itself decide that successful historical accumulation should introduce this new failure boundary.

**Suggested direction:** Define the user-visible capacity behavior, or arrange bounded reading of the relevant pending projection without making accumulated resolved history block work.

I did **not** classify these already-decided behaviors as new user decisions:

- Partial handoff retains P when it still owns another unfinished task.
- A retired unknown-outcome occupant requires human confirmation.
- Archival preserves history and does not roll back file changes.
- A completed ordinary handoff need not create an interruption anomaly.
- Archive-origin pickup uses ordinary Session selection, not continuation provenance.
- Role evidence controls automatic executor archival.
- The anomaly wording accurately communicates interrupted, unverified changes.

## PART F — Counts

The base arithmetic in §0.5 is correct.

| Item | Recount | Result |
|---|---:|---|
| §3 state rows | CTX 1 + WF 1 + HO 4 + AUTO 1 + DUTY 1 + ANOM 1 = **9** | Matches |
| New Workflow operation kinds | **2** | Matches |
| §6 source files | W01–W10 = **10** | Matches |
| New source files | W08, W10 = **2** | Matches |
| Modified source files | Remaining W01–W10 = **8** | Matches |
| New test files | W11–W17 = **7** | Matches |
| Base listed files | 10 + 7 = **17** | Matches |
| Test rows | GC 4 + AN 8 + GE 6 + WF 2 + DU 9 + HO 12 + HM 4 + SC 2 = **47** | Matches |
| Planned executions | 47 + 6 additional GE backend executions + 1 additional AN07 backend execution = **54** | Matches |
| Projected total test files | 250 + 7 = **257** | Arithmetic matches |
| Projected total executions | 5626 + 54 = **5680** | Arithmetic matches |

Qualifications:

- **17 is the base file list**, not an unconditional final changed-file count. §0.5 permits up to three helper files, and §6 additionally permits modifying `src/business/workflow/index.ts`. Those permissions allow up to **21** changed files.
- Multi-case rows such as DU04 must remain one declared test row/execution per specified backend for the stated 54 count to hold.
- GE05 currently prevents the promised matrix from being realized as written. Correcting its fixture or splitting its intent may require updating counts.
- No new persistent record, event type, index, route, or tool is required by the described changes: `handoff_complete` and the source `digest` field already exist.
- The totals are **planned arithmetic**, not verified test results.