# Slice 4A round 2 — reply

## FILES CHANGED (`git diff HEAD --stat`; 17 tracked, +2733/−786)
```
 src/composition/create-platform.ts                 |   8 +-
 src/contracts/note.ts                              |  37 +-
 src/core/work-graph/model/note-contracts.ts        |   1 -
 src/core/work-graph/notes/note-anchors.ts          | 493 +++++++++---
 src/core/work-graph/notes/note-read-model.ts       | 333 ++++++--
 src/core/work-graph/notes/note-service.ts          | 864 ++++++++++++-------
 src/core/work-graph/notes/scribe-scope.ts          | 211 ++---
 src/core/work-graph/persistence/note-record-codecs.ts | 140 +++-
 src/core/work-graph/state/note-machine.ts          |  52 +-
 tests/architecture/production-reach-allowlist.json |  24 -
 tests/helpers/S4A-note-fixture.ts                  |  81 +-
 tests/helpers/S4A-note-interleave-fixture.ts       | 180 +++--
 tests/helpers/S4A-note-scope-fixture.ts            |  18 +-
 tests/work-graph/S4A-note-concurrency.test.ts      | 134 +++-
 tests/work-graph/S4A-note-history.test.ts          | 231 +++++-
 tests/work-graph/S4A-note-scope.test.ts            | 233 +++++-
 tests/work-graph/S4A-note-write.test.ts            | 479 +++++++++-
```
New untracked (L-scope): `src/core/work-graph/notes/note-anchor-facts.ts`, `tests/helpers/S4A-note-fault-fixture.ts`, `tests/work-graph/S4A-note-caps.test.ts`, `S4A-note-failures.test.ts`, `S4A-note-symbol.test.ts`. Frozen files untouched (`state-writes.test.ts` unchanged this round). `.dsh-scratch/` deleted.

## PER ITEM
- **15c** fixed — impl `S4A-note-fixture.ts:createSession/claimRun/workCtx`; RED 32 (duty `unknown`→forbidden) → GREEN; all N-03..N-13 pass on both backends.
- **15d** fixed — `S4A-note-interleave-fixture.ts` (real platform under `vi.spyOn`, only `records.commit` gated on `NoteWritten`); tests `N-07/N-14` it.each; follow-up file anchor `src/a/x.ts` + N-14 sequential control added.
- **12a** fixed — test `N-01 %s malformed shapes are refused invalid with the draft, never thrown`; impl `note-service.ts:writeInputProblem` (first) + `note-anchors.ts:anchorFormatProblem`; RED threw/accepted → GREEN invalid+draft.
- **12b** fixed — `N-20 %s a human goalId null refuses goal, stage and task anchors`, `… a non-null human goalId must name a goal`; impl `note-service.ts:writeNote`; RED accepted → GREEN forbidden/invalid.
- **3** fixed — tests `N-04/N-07/N-08/N-11/N-02/N-10/N-20` (a)–(h) in `S4A-note-failures.test.ts` + `S4A-note-fault-fixture.ts`; impl `note-read-model.ts:readAllHeads/readAllRecords`, `note-service.ts`, `note-anchors.ts`, `scribe-scope.ts`; each RED definite-answer → GREEN unavailable/forbidden.
- **4** fixed — tests in `S4A-note-caps.test.ts` (202-note quota, 100/100/2 pages, cursor_mismatch, 200+ same-topic) + `N-04 … same-topic gate sees past 200`; impl `note-read-model.ts:listByAnchor` (complete set, memoised); RED ready/capped → GREEN.
- **9a** fixed — `N-13 %s a human repair is refused forbidden…`; impl `note-machine.ts:noteWriteAuthority`; RED staged → GREEN forbidden.
- **9b** fixed — `N-09 %s a later Run of the same Session is the author…`; impl `note-service.ts:dispose` (`sourceIsAuthorOf`); RED forbidden → GREEN withdrawn.
- **9c** fixed — `N-10 %s accepting or rejecting a pending note requires a reason`; impl `note-machine.ts:sharedProblem` + `dispose`; RED done → GREEN invalid.
- **10a** fixed — `N-10 count %s a scope with no scribe counts zero`; impl `scribe-scope.ts:countCurrentNotes` (`held`); RED project→2 → GREEN 0.
- **13** fixed — `N-01 %s a commit fact is stored as a pointer…`, `… sha is not a string`; impl `note-record-codecs.ts:factProblem` (shape-only), `note-read-model.ts` uncheckedFacts; RED 'abc' refused → GREEN stored.
- **d8** confirmed — no independent change (noteLimits + strict revision kept; caps/quota handled by 4/8).
- **d9** fixed (test only) — `N-10 count %s counts the project-level slot…`; GREEN first run (enumeration already cursor-complete + `[null,…]`); failure half covered by item 3 (g).
- **1** fixed — `N-08 %s accepting a pending general note on a goal anchor leaves the pointer` (A/B), `… a commit-time pointer conflict returns the current pointer`; impl `note-service.ts:dispose + currentPointerPayload`; RED pointer moved/revision_conflict → GREEN.
- **2** fixed — `N-10 accepting a pending note supersedes its current replaces targets`, `N-08 … supersedes it once`, `… structural … only on accept`; impl `note-service.ts:supersessionOf/supersessionTargetsOf`; RED target stayed accepted / duplicate guard → GREEN.
- **8** fixed — `N-07` (sixth `overQuota:false`, understanding not anchor-held, understanding counts to goal, repair via goal quota, structural replacement no `quota_full`); impl `note-service.ts:writeNote`, `note-machine.ts:admitNoteWrite`, `note-read-model.ts:overQuotaOf`; RED overQuota true/pending [`quota_full`] → GREEN.
- **should-1** fixed — `N-18 %s existingTopics follows the new-topic condition and the latest spelling`; impl `note-service.ts:existingTopicsOf`; RED extra module:B + `Alpha` → GREEN literal.
- **should-2** fixed — `N-14 %s a withdrawn note is not in a same-topic conflict`; impl `note-read-model.ts:conflictingOf`; RED true → GREEN false.
- **15e** fixed — `N-12 %s a write replay returns the original result verbatim`, `… the same commandId from another caller is a new command`, `… a disposition replay returns its original receipt`, `… idempotency conflict`, memory racing ×2, and `N-08`(3)/`N-06`(4); impl items 1/2/5.
- **5** fixed — tests above; impl `note-service.ts:principalOf/noteCommandIdentity/replayWrite/replayDisposition/recheck*`, `note-record-codecs.ts` `result`; RED lossy/cross-caller/revision_conflict → GREEN verbatim.
- **d7** fixed — same as 5 (event carries `result`; replay before mutable state).
- **11** fixed — (a) `N-13` tightened; impl `note-machine.ts:bumped`, `note-record-codecs.ts:noteHeadBodyProblem` (both directions); RED refused withdraw → GREEN. (b) per-event `deps.eventId()` in `note-service.ts` (code-only, no test per R13). (c) decoders retyped to `Pending*`, require `since===null`; typecheck-clean.
- **should-3** fixed — `N-11 %s historical versions carry confirmedByUser derived from change.by`; impl `note-read-model.ts:confirmedByUserOfVersion`; RED v2/v3 false → GREEN.
- **6** fixed — `N-20 %s a stage anchor keeps the bound plan revision for an agent and the current one for the user`, `… each goal's stage gets its own revision`; impl `note-service.ts:NoteRunFactResolver`, `create-platform.ts:noteRunFacts`, `note-anchors.ts:resolveNoteAnchors/basisCatalogRevisionOf`; RED agent stored 2 → GREEN 1.
- **7** fixed — new `note-anchor-facts.ts:readAnchorGoalFacts` (project/workspace guard, not_found vs unavailable distinct), used by `note-anchors.ts` + `note-read-model.ts:anchorExistsNow`; tests `N-20` cross-goal scribe/missing task/stage/listByAnchor; RED Plan-service forbidden → GREEN accepted/`anchor_not_found`.
- **14** fixed — new `S4A-note-symbol.test.ts` cases (a)–(h); impl `note-anchors.ts:symbolRequestProblem/resolveSymbol/signatureDigestOf`, `note-service.ts` warnings, `create-platform.ts:noteWorkspace`+`noteLimits.symbolHitsMax`, allowlist entry removed; RED 16/16 → GREEN.
- **15a** fixed — fixture `s0` claims goal-1 `t1`; test `N-20 %s an executor cannot use another goal's task anchor but a project scribe can`; RED s0 rejected → GREEN.
- **15b** fixed — `N-20 %s a stage anchor takes its planRevision from the execution binding`; public `proposePlan/applyPlanChange` to rev 2; RED stored 2 → GREEN bound 1 / user 2.
- **c** fixed — `N-10 %s SA1 archived (not a handover) sends n1 up to SA`; no production change (public `submitControl` cancel + `archiveLine`); GREEN.
- **d11** no code change (R11) — confirmed review slot stored `goalId:null`, reader queries `[null,…]`; covered by d9 test.
- **L-reach** done — allowlist now exactly one slice-4 group (`renderNoteHeader`); `MEMORY_PAGE_DEFAULT` export+entry removed; `NOTE_SYMBOL_HITS_MAX` removed.

## REVIEWERS' FINDINGS
- **G0**: 15c pass; 15d required the file anchor + N-14 control → applied.
- **GA**: no blocking (12a/12b/3/9a/9b/9c/10a/13/d8/d9 pass); d9 "project slot" test is a regression guard, 13's "sha not string" sub-case not discriminating, class-1 anchor errors reuse `anchor_not_found` — accepted/minor.
- **GB1**: items 1/2 pass; item 2 test (c) non-discriminating (true RED impossible) — kept as regression guard.
- **GB2**: item 8/should-1/should-2 pass; flagged the R6 staged/pending-replacement projection corner → UNSPECIFIED below.
- **GC1/GC2**: all pass.
- **GD**: two edge fixes (`note-anchor-facts.ts:62` goal-vs-plan; `note-anchors.ts:340` capture failure → unavailable) and two test-discrimination fixes (7b/7c) → **all four applied** in a final pass; 223 tests green after.

## CHECKS
- `npm run typecheck` → clean.
- `npm run check:architecture` → `next source boundaries: OK`.
- `npm run build` → OK (workbench published).
- `node scripts/build-kernel-patch.mjs --check` → 56/56 `"matches": true`.
- S4A + `tests/architecture/` + `platform.test.ts` → **11 files / 252 passed**.
- S4A + platform + state-writes + production-reach (after GD fixes) → **10 files / 223 passed**.
- Full suite `npx vitest run --maxWorkers=4` → **49 failed files / 329 passed (378); 153 failed / 6549 passed / 29 skipped (6731), 684 s**. All 153 failures are within `DSH-BASELINE.md` §A (0 outside; 2 baseline entries passed: `S2B-be1s-shell` cancelled-no-change and the `state/invariants` suite).
- `git status --short` → only the L-scope files above; `.dsh-scratch/` removed.

## UNSPECIFIED
1. **Item 14 test (a) range** (L14/§0.3): frozen `typescript-source-query.ts:162` returns the `nameSpan`; `alpha` at lines 1–3 yields range `{1,1}` + sha256("alpha"). Stored locator = the hit range per L14; implementation faithful, test literal adjusted (approved).
2. **Class-1 anchor shape failures** reuse reason `anchor_not_found` and drop the field (`WriteNoteResult` has no field channel) (spec §2 reason list / L2a "指出字段") — minor.
3. **R6 looseness**: a staged/pending replacement whose target is currently accepted can make `write.overQuota` differ from `readNote` at an exactly-full goal (L7 line 134; item 8 fix line 510) — needs a lead post-note; GB implemented the item's Fix literally.
4. **Item 15b**: a literal `schemaVersion:1` rev-2 draft is refused by `plan-machine` (`incomplete: a plan change requires an accepted UserDecision`); used the `schemaVersion:2` future-delta shape the public service accepts (not seeding).
5. **Item 7(f)**: used existing goal-2 task `t10` (the item names `t3`, which lives in s4a-goal).
6. **should-3** (§4 rule 9): an absent needed intermediate version returns `unavailable`, never `false`.
7. **14 scan page size** unspecified: chose internal `SYMBOL_SCAN_PAGE=32`; cap exact.
8. **L-reach fold** touched `src/contracts/note.ts` (explicitly permitted by §4 L-reach; L-scope summary line named only the MEMORY_PAGE_DEFAULT file).
9. `NoteReadDependencies.plans` retained unused to avoid wiring churn.

## NOT BUILT
- **4B 联动补验**: N-11 `change`/history read (L12); N-19 full-text search (L10); P8 unchecked-field replacement via `NoteCheckPort`; M-02 `basis.planRevision/catalogRevision` has no 4A public field.
- **4C 联动补验**: N-06 contradiction-card `supersede` half (L17); G-01(4C) re-runs write-side symbol resolution through `record_note`.
- **第 6 片联动补验**: 9a secretary-repair refusal (no secretary source in 4A); P4 secretary/`role_exploration` write sources.
- **7 片联动补验**: real handover (successor authorship).
- **7D1 联动补验**: goal-scribe cases N-10 n5/n6 and N-22 `SG`; R12 role_spec read-failure → `'unknown'` recorded as a 7D1 item.
- **第 8 片联动补验**: N-13 listing by staged run (index written).
- Optional per R13: item 14 capture-unavailable test skipped (R13 permits); PreparedCommit `eventId` test skipped (verified by reading code).

## NOTES
GA and GD were each run as two sequential builders (GA1→GA2, GD1→GD2) because of size; one review per group. Reviews of G0, GA, GB (two halves), GC (two halves) and GD were read-only, no blocking defect in production; the GD-edge and test-discrimination findings were fixed in a final short pass. Total 19 subagents, one building agent at a time, at most two agents concurrently.