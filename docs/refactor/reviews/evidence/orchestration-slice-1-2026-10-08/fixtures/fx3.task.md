# Group fx3: Workflow archive flow, maintenance, routes (business / app)

Read RULES.md first (same folder). Your files:

- `tests/business/S1-session-maintenance.test.ts` — IT06, IT07, IT08, IT09, IT10, IT11, IT31, IT33, IT34 (spec §5.4; §4.2; §2.8 `SessionArchivePolicyV1`, `SessionDutyResolver`; §0.1 U1; §0.2 L3, L4; §3.2 S1-AUTO-01…03)
- `tests/business/S1-archive-flow.test.ts` — IT12, IT13, IT14, IT15, IT16, IT26, IT27 (spec §5.4; §4.1 all steps and paragraphs; book part 2 rules 12–14 in `slice-1-book-part2.md`)
- `tests/app/S1-session-routes.test.ts` — IT17, IT18 (spec §5.4; §4.4)
- New helper allowed: `tests/helpers/S1-workflow-archive-fixture.ts` (only if needed).

## Lead decisions for this group (binding)

- **D6 (stops are real).** "Stop committed / stopped" means: the archive's cancel submitted through
  `RunControlPort.submitControl`, delivered, and the Run's terminal observation recorded through the existing
  Runtime / reconciliation path; then `continueArchiveLine` (or the same `archiveLine` request) continues. A queued
  cancel alone leaves `pending` (book part 2 rule 12).
- **D7 (unknown Runs).** An `outcome_unknown` Work Run is produced by the existing reconciliation path (e.g. Host
  restart reconcile with the Kernel record unavailable), so that Run, Attempt and Outbox are the paired state that
  `resolveUnknownRun` (`src/composition/create-platform.ts:887`, the existing attestation) accepts. Do not rewrite
  only the Run.
- **D8 (IT34 / U1).** IT34 stays as the row says (frozen U1 "no new behaviour", HANDOFF decision 45): skip with
  `busy` / `archive_unknown_confirmation_required:` and zero commits for S; build its unknown state as in D7.
- **D9 (invariants).** Run the invariant checker of `tests/state/invariants.ts` on both backends after each mutation,
  passing the previous world where the helper supports it (so the new S1 rules run); no helper that returns without
  checking for memory.

## Findings for your files (from review-codex2.md; 6 verified by the lead)

1. (verified) IT18 (`S1-session-routes.test.ts:180–181`): the final fault is armed after the restart; start-up
   maintenance (§4.2 order: reconciliation → maintenance) can finish the archive first → arm the fault before the
   restart.
2. Maintenance due-archive cases leave S occupied (`S1-session-maintenance.test.ts:196`, `:617`, `:629`, `:722`): the
   B2 fixture claims Task A in S at once; closing B or C does not stop that Run or release S. IT07/IT08/IT31 expect S
   archived; IT06 passes only because S is occupied. Build the idle executor history: S's Run on A finished through
   the real result path, A formally finished, S's responsibility closed by the terminal-close path at t0 (so the
   closing event carries `taskBasis.finishedAt = t0`), S unoccupied; then IT06 now=t1−1ms → archived=[], IT07 now=t1
   → archived=[S], archivedAt=t1. IT08: a new unfinished Task given to S before the deadline; after it finishes the
   due time is its new finishedAt + 86,400,000 ms. IT31: as in the row (plan change after t0 does not reset).
3. IT10 (`:561`, `:685`): the retirement helper only overwrites Session health / occupancy and leaves Run / Attempt /
   Lease live, then expects an anchor and disposal. Produce the retirement and the stopped writer through their
   owners / real paths (row: "有新retired无continuation且释放占用").
4. IT33 (`:761`): expects A `pending` although the fixture's starting Run makes A `running`; IT33's A has never had a
   Run of S (row) → use an execution-free Task A with the initial link from `createSession`; assert A's
   effectivePhase unchanged (compare with the value read before).
5. IT34 (`:572`, `:775–794`): the unknown state is inconsistent (see D7, D8); add the event / receipt totals for zero
   commits.
6. IT11: copy answered (real consultation path), original source still running; complete observations: copy
   archived, source revision and occupancy unchanged, Query / provider not re-run, invariants.
7. IT13/IT16/IT27 (`S1-archive-flow.test.ts:505`, `:553`, `:598`): each enters a Run, calls `archiveLine`, then
   expects final disposal / re-dispatch, but no stop completion follows (D6). Also `{status:'ready'}` at `:559` /
   `:609` accepts a pending result — assert the exact state. IT13: stop / anchor / drop committed, then a final
   failure (injected at the final commit) → `partial`, message `处置已完成，归档没成功`, rejection `revision_conflict`,
   disposed links not restored.
8. IT14 (`:389`, `:526`): the helper raw-writes a QueryRun while the Work occupancy remains, and the answer is only a
   comment. Build a real Query execution in S (claim, enter), `archiveLine` → pending / `归档中`, 0 cancel / 0 anchor;
   then save the answer through the real answer path and finish the Query; then `continueArchiveLine` → archived.
9. IT15/IT26 (`:410`, `:583`): only the Run is set to `outcome_unknown`, its Attempt stays started → `resolveUnknownRun`
   rejects (`src/core/work-graph/state/attempt-machine.ts:536`). See D7.
10. IT16/IT27 (`:570`): "nondecreasing revision" does not prove D's history preserved; assert D's existing history
    exactly (the records read before vs after) and `sessionBasis: null`, `seededFrom: null`,
    `continuity: 'other_session'`; IT27: one new Session with `provenance = {schemaVersion:1, kind:'new'}`, no
    continuation from S.
11. Memory invariant helpers return without checking (`S1-session-maintenance.test.ts:588`,
    `S1-archive-flow.test.ts:464`); service helpers call `checkAllInvariants(world)` without `prev` (D9).
12. IT12: keep (real entered Work); assert the exact pending result (`state:'pending'`, message `归档中 · 停止中`,
    R present, 0 responsibility transfer, 0 requeue).
