# Group fx1: archive owner, wait disposal, requeue (work-graph services)

Read RULES.md first (same folder). Your files:

- `tests/work-graph/S1-requeue.test.ts` — SV35, SV36, SV37, SV38, SV48, SV49, SV50, SV57, SV59 (spec §5.3; §3.2 S1-TASK-01/02; §3.4 line "对于 archiveOrigin…"; §4.1 steps 3–7)
- `tests/work-graph/S1-archive-owner.test.ts` — SV21, SV22, SV23, SV24, SV25, SV56, SV60, SV61 (spec §5.3; §2.3; §3.2 S1-SES-02…06; §3.4; §4.1 last paragraphs)
- `tests/work-graph/S1-wait-disposal.test.ts` — SV30, SV31, SV32, SV33, SV34, SV54, SV55 (spec §5.3; §2.5; §3.2 S1-MSG-01/02; §3.3 `disposeArchiveWait`, `readUndeliveredReplies`)
- New helper allowed: `tests/helpers/S1-archive-service-fixture.ts` (only if needed).

## Lead decisions for this group (binding)

- **D1 (SV50, SV59).** `TaskReworkRefusalSnapshotV1` (`src/contracts/task-requeue.ts:227`) has no `automation`
  field and the spec adds none. Do not assert `refusal.automation`. Assert the refusal's existing fields the row
  names (`code: 'auto_rework_cap_reached'`, `failureClass`, the after-Run, revision 1, 0 TaskRequeue) and observe
  "autoCount=4 / cap=3" (SV50) and "counted=true / count4 / cap3" (SV59) by calling the existing pure
  `nextRequeueAutoCount` (`src/core/work-graph/state/task-failure.ts:446`) on the chain read back from the store
  after the refusal (runs and requeues of the Task, the same policy) — expected
  `{ automatic: true, counted: true, autoCount: 4, cap: 3 }`.
- **D2 (SV61).** Row: `ready / state=partial / rejection=revision_conflict`. Assert `partial`, not `pending`.
- **D3.** Ordinary failures, cancellations and stops in the givens are produced by the real control / result paths
  (submit control → deliver → terminal observation; Kernel result through the B2 fixture), not by rewriting
  Run / Attempt outcomes.

## Findings for your files (from review-codex2.md; the first five were verified by the lead)

1. (verified) SV50/SV59 assert `refusal.automation` (`S1-requeue.test.ts:633`, `:678`) — see D1.
2. (verified) SV49/SV50/SV59 assert `f.captures` = [] although `growChain()` already captured during setup
   (`:215` pushes on each ordinary requeue; `:619`, `:638`, `:683`). Measure the delta caused by the tested action.
3. (verified) SV37 (`S1-requeue.test.ts:549–556`) opens a responsibility and then calls `finishSessionArchive` with
   the link still open → S1-SES-04 must refuse. Perform the real disposal of the link first (through the
   responsibility owner / archive steps), then assert: S archived, exactly one anchor, link closed, Task still
   `paused_interrupted`, 0 TaskRequeue.
4. SV35/SV38 (`:507`, `:568`): `run_cancelled` is recorded before R is registered and without the archive's control
   intent. Register R, submit the archive's deterministic cancel, observe that stop, then anchor / requeue. SV35 also
   needs a real prior count of three (cap 3) on the chain. SV38: assert the existing requeue is unchanged (complete
   value and cursor), replay observations, 0 new Attempt / Run / Kernel.
5. SV36/SV48: add the full refusal observations (code `forbidden`, reason prefix, 0 TaskRequeue, 0 refusal, record /
   event counts unchanged on the store the requeue owner writes).
6. SV49: the r0 anchor must have matching R execution evidence (anchor recorded for r0 through the real path), and
   the request targets afterRun r2; 0 TaskRequeue / 0 refusal; captures delta 0.
7. SV50: the latest Run must be an ordinary automatic failure (real failed result), not a cancelled Run.
8. SV57: raw message write and missing persisted checks — the yield wait must be real (yield through the B2 path),
   archive-cancelled through `disposeArchiveWait`; assert 0 anchors in the store and no ConsumedWait fabricated.
9. SV59: the ordinary failure before retirement is raw-rewritten at `:270–298`; produce it through the real result
   path, then retire S through its owner, then the real `retired_archive` anchor.
10. SV22 (`S1-archive-owner.test.ts:452–474`): the race is put on D's second Run and the conflict pin expected to
    name D; the row needs a legal race on S's own facts after the final read (use the commit barrier of
    `tests/helpers/graph-session-fixture.ts:commitBarrier` to commit a legal write on S between read and commit),
    `revision_conflict` whose current points to S, lifecycle active, the already disposed link unchanged (exact
    `until`, not just non-null). If no legal write on S can exist at that point, list it under UNDETERMINED.
11. SV23 (`:512–516`): compares the whole `readMany` result including the global `readThrough` cursor; compare the
    exact encoded message record separately from the store cursor.
12. SV61 (`:313`, `:633`): see D2; also SV60/SV61 wait choices at `:602` / `:630` name a yielded wait that neither
    running Run has — use a wait that exists or none, as the row needs.
13. SV60 (`:615–620`): assert the recovered request, the original pin (`r0@k`), the original intent / ref / cursor,
    `replayed: true`, 0 new intents, delivery of the original intent, no `idempotency_conflict`.
14. SV33/SV34 (`S1-wait-disposal.test.ts:480`, `:507`): S is never retired; the response is saved before the
    archive; the yielded wait stays undisposed while the final archive is expected to commit. Build: real yield wait →
    retire S through its owner → archive under the retired exception → then the late reply is saved → assert the row.
    SV33 must not require a disposition that the row does not name.
15. SV31 (`:438`): recovery must retry the failed wait-cancel step itself on the same store (reopen the service on
    the same SQLite / memory store) and assert: transfer not written again, the original wait cancelled once, the
    original receipt value, final wait facts not waiting.
16. SV30: assert the original wait is cancelled and the complete replay receipt; question bodyRef unchanged; handler
    D; response inputId accepted exactly once.
17. SV32: the new target D must actually consume the existing responseRef (D's real acceptance), not only "response
    retained"; no second question / answer created.
18. SV54 (`:545–553`): compares the same port object before/after; count real commits / receipts before and after
    on the store.
19. SV55: the acceptance must come from D's real `input_accepted` Kernel fact (the existing accept path), exact
    refs: acceptedInputs one item, `inputId = deriveSessionInputId(m,'response')`, executionRef = D's Run.
20. G1 raw writes: `S1-wait-disposal.test.ts:192` (ordinary message / response raw write), `S1-requeue.test.ts:320`
    (forged control / reconciliation), `:270` (rewritten Run / Attempt outcomes) → real entries.
