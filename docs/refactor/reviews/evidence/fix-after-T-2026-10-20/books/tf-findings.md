# Fix round after T: frozen finding table for rework 1 (lead, 2026-10-21 01:45)

Source: Codex grouped read-only audit of `tf-base..d4140be` in eight parts (`codex2/tf/P1.out.md` … `P8.out.md`,
01:26–01:39; 会出错 2, 违规 25, 不整洁 10, 建议 27). The lead checked each finding against the code and the book and
rules here. Rework 1 applies §1, one row all or nothing; §2 are the rulings, binding for this round and the next;
§3 are the findings not adopted, with the reason; nothing outside §1 changes.

## 0. Rulings

- **R-TF-1 (the allowlist).** The 48 HTTP request and response types that only `src/ui` reached stay as `wire-format`
  allowlist entries (164 → 212). The book's "then add nothing" meant no production code; the user decided to keep the
  HTTP interface and its wire-format types (decision 86-2), and the allowlist's `wire-format` kind is how they are kept.
  DSH's reading was right; the book's wording was the lead's.
- **R-TF-2 (restored tests use their file's fixtures).** A test TF2 restored may use the fixture, backend choice and
  waiting the other tests of its file use (W1-future-plan's memory-only `setup`, WP2's `open()` default, the polling
  of the A2-reconcile-runtime restart rows, `S1-archive-service-fixture`, `S2C-L-*-support`, `B2-runtime-fixture`'s
  governance seed, the S3-prepared-context-admission set-up). Those fixtures' hand-written state is T's leftover and
  goes with decision 86-3 (folded into the slice that next changes those files); the lead lists them in STATUS.
- **R-TF-3 (cascades of unused names).** A local that was used only by a removed unused local is removed with it
  (TF5 step 3 asks for an empty second run).
- **R-TF-4 (the rows left to the lead).** For the D1/D2 rows whose proposal offers two ways or leaves the choice to the
  lead, the lead keeps the code in this round, with three kinds of reason:
  - a `catch` on a tracked or fire-and-forget promise stays (removing it turns any later bug into an unhandled
    rejection that ends the process): `C2-050`, `C3-001`, `C3-004`, `C3-006`…`C3-009`, `C3-016`…`C3-018`, `C3-048`,
    `C3-073`, `C3-104`, `C3-107`;
  - a spec, frozen contract or later slice needs it: `A3-021`, `A3-022` (slice 9), `C2-022`…`C2-024`
    (`slice-3-SPEC.md:502`), `C2-030`, `C2-031` (K3), `C3-070` (`slice-1-SPEC.md:600`), `C3-105`
    (`slice-8-SPEC.md:316/323`), `C3-049` (R6), `C1-048`, `C1-049`, `C1-067` (Delivery);
  - a narrowing the structure round before 6A (decision 85-1) decides as a whole: `C3-011`, `C3-012` (the
    route builder's optional owners and driver), `C4-127`, `C4-128` (the line store port), `C3-057`;
  - the remaining ones are integrity mappings or tie-breaks with no cost: `A2-031`, `A3-028`, `B-035`, `C1-005`,
    `C1-020`, `C4-048`, `C4-090`, `C4-098`, `C3-026`.
- **R-TF-5 (frozen contracts).** A member of a `src/contracts` type stays even when the code stops producing it
  (`retired_unrecorded` in `src/contracts/work-line.ts:46`, `legacyUnchecked` at `:120`); only the code that produces
  or tolerates the old shape goes.

## 1. Rows for rework 1

| row | source | where | what to do |
|---|---|---|---|
| TFR-01 | P2-01 (会出错) | `src/core/work-graph/views/work-line-reader.ts:283-316`, `:1794` | NP-5 is half done: the two null-kind counts (`readLegacyUnchecked`, `countKinds(…, [null])`) still run, and a failed count now makes `legacyUnchecked` `unavailable` with no marker behind it. Delete `readLegacyUnchecked` and its calls; the response field stays (R-TF-5) and is always `{ status: 'exact', value: 0 }` (the codec refuses a Session without provenance, `session-record-codecs.ts:736`). At `:1794` `complete` is `true`. Delete the comment at `:283-284`. `tests/work-graph/S2C-lines-scale.test.ts:51` already expects exact 0. |
| TFR-02 | P2-02, P1-01 | `persistence/plan-record-codecs.ts:125-127`, `:984-997`; `tasks/plan-readers.ts:681`, `:697-700`, `:756-768`; `views/decision-read-model.ts:1661`; `tests/helpers/S5-decision-fixture.ts:569-586`, `:1233` | A1-007 with A1-043, as A1-007's proposal says: `seedCommit` accepts `commitCursorBindings`, and `seedCandidateProposal` commits `encodePlanProposal(proposal, { since: null })` with the binding `[{ refKey: planProposalRefKey(proposal.ref), field: 'since' }]`, as production creates a chain (`plan-service.ts:1421-1434`). Then the decoder requires `since` for `candidate_v2`, positions are `CommitCursor`, `compareProposalChainPositions` loses both null arms, and the `?? null` at the four places go. The comment at `plan-readers.ts:681` is then true. Do not convert the seed to public steps in this round (R-TF-2). |
| TFR-03 | P1-02 | `tasks/unknown-call-review-service.ts:1496` | A1-100 is recorded deleted but the `?? null` is there: `readThrough = watermarks[0]!;` (the tuple is non-empty by `:1453`, `:1459`, `:1464`). |
| TFR-04 | P2-03 | `sessions/session-record-codecs.ts:714-720`; `state/line-status.ts:287`, `:351`, `:601`, `:817`; `views/work-line-reader.ts:2285` | A1-013, A1-016 as the proposal says: the codec refuses `health: 'unavailable'` without a recognized `healthConclusion` (an `available` Session keeps its legal `null`); drop the `?? null` fallbacks, the `unrecorded` text and the code that produces `retired_unrecorded` (the contract member stays, R-TF-5). `slice-2C-SPEC.md:1299` 2C-01 (2) says a null conclusion exists only in data from before slice 1. The coordinator serializes the files (book §2). |
| TFR-05 | P2-04 | `tests/work-graph/A2-step1-codecs.test.ts:338-393`; `state/verification-machine.ts:821-823` | A1-026, A1-027 were BLOCKED by a test that hand-writes an interrupted check with no `incompleteCause` (`:338`, `:362`, `:393`); the public interrupt always writes one (`evidence-service.ts:1414`, `:1420`; `verification-machine.ts:935`, `:991`). Build that row's root round, interruption and successor through public steps, keep its lookup assertions, then apply the two rows' proposals (the codec refuses an interrupted check without its cause; the fold always appends it). If the public steps cannot produce the row's state with the rule sheet v2 forms, the rows stay BLOCKED with that evidence and the test is unchanged. |
| TFR-06 | P2-06 | `state/session-availability.ts:600` | A1-024 removed the `default` and with it the `never` check: keep exhaustiveness after the `switch` (`event satisfies never;` or the file's existing idiom). |
| TFR-07 | P3-01 | `evidence/evidence-service.ts:180-190`, `:934`, `:936`, `:1289`, `:1291` | C4-038 changed behaviour: the new `mapWorkspaceFailure` returns `source_stale`, `capacity`, `unsupported` where the old `mapWorkspaceRejection` returned `unavailable`. The proposal's premise is false (`WorkspaceError` has codes that are not `CoreError`, `src/core/workspace/ports.ts:12`). Restore the base code exactly (`.lead-ref`/tf-base), result `kept`, note "proposal premise false". |
| TFR-08 | P4-03 | `src/core/agent-runtime/runtime.ts:304` | B-023 is recorded simplified but the `authorization !== undefined` fallback is there: `executionHistory?.kernel`, else the narrowed authorization's `kernel`, as the proposal says. |
| TFR-09 | P4-04 | `src/business/workflow/session-maintenance.ts:338`, `:590` | NP-2 left a `provenance === null / undefined` check at `:338` and an optional access at `:590`; `SessionRecord.provenance` is required (`src/contracts/core/session.ts:40`): remove both. |
| TFR-10 | P4-05, P5-02 | `tests/runtime/S2B-36-observer-cancel-reread.test.ts:66-93`; `tests/runtime/S2B-38-run08-unknown-activity.test.ts:176-205`; `src/core/agent-runtime/execution-control.ts:153`; `tests/helpers/K3-35-runtime.ts:177`, `:231`; `tests/helpers/K3-blocked-command-fixture.ts:284`, `:325` | C2-039 was BLOCKED by two tests whose stand-alone observer has no `controls` (`tests/helpers/B2-runtime-fixture.ts:290`); production always passes them (`src/composition/create-platform.ts:1196`). Move the two cases onto a Runtime with real `controls` and a real cleanup proof, reaching the re-read cancel by an allowed fault injection; keep the cancel, zero-write and retry assertions; then make `controls` required as the row says. If that cannot be done with the rule sheet v2 forms, C2-039 stays BLOCKED with the evidence, and the `controls` wiring TF1 added to `K3-35-runtime.ts` and `K3-blocked-command-fixture.ts` is undone. |
| TFR-11 | P7-01 (会出错) | `scripts/verify-isolated.mjs:36-58` | `npm run verify:isolated` now fails: the build makes no page, so the Host smoke gets 503 at `:52`. Write a temporary `index.html` holding `PLATFORM_TOKEN_PLACEHOLDER` (as `tests/helpers/host-page.ts` does) into a temporary public directory, pass it to the Host as `publicDir`, keep the three checks (token in the page, bootstrap 200 with it, 403 without), remove the directory after; fix the comment at `:36`. **Do not run the script** (it runs the whole suite with the default worker count); the lead runs its smoke part. |
| TFR-12 | P1-03…P1-06, P2-07…P2-09, P3-02, P4-06, P5-04 | as listed | Comments and leftovers: `plan-readers.ts:154` (completion is required), `:1317` (drop "unlike readReworkRecords"); `owner-record-read.ts:7` (no decode-message parameter); `run-reconcile-service.ts:406` (drop "and no unchecked legacy predecessor"); `work-line-reader.ts:283` (with TFR-01); `activity-read-model.ts:399` (a failed Session resolution fails the read); `undelivered-reply-notices.ts:328` (only the `unavailableSince` / entry position check remains); `materials/applicability.ts:95` (`return origin.owner` in the `run` arm); `tests/scenarios/S2C-K-retired.test.ts:277-293` (drop the stale scenario note); `src/app/attention-observer.ts:373-376` (both parameters required, drop the missing case). |

## 2. Checks for rework 1

Every row's tests (the files that import the changed files), the typecheck, `check:architecture`, `build`, the
assertion ledger `tf-base..HEAD` (new lines mapped to `TFR-nn`), `--noUnusedLocals` still 0. One commit:
`TF rework 1`.

## 3. Not adopted

| finding | reason |
|---|---|
| P1-07 | R-TF-4 (Delivery fields stay for their slice). |
| P2-05 (A2-028, A2-029) | `slice-2B-SPEC.md:171` L17 still says an old execution may have a `null` Session and `RunActivitySnapshot.sessionRef` is a frozen contract type (`src/contracts/run-activity.ts:63`); the proposal itself asks for a spec sign-off. Kept; the L17 sentence is obsolete under decision 79 and goes when 2B's files are next changed (STATUS fold-in list). |
| P2-10…P2-13, P3-03…P3-05, P4-07…P4-18, P5-05…P5-11 | R-TF-4. |
| P4-01, P4-02 (A3-002, A3-003) | The proposal says keep (book §3: "when the proposal says which, follow it"); the deletion would narrow `ContinuationBriefV1` in `src/contracts`. |
| P5-01 (C3-011) | R-TF-4 (decision 85-1). |
| P5-03 | The two removed test-side checks were dead once the dependency types became required; no assertion is lost (the ledger has no line for them). |
| P6-01…P6-07 | R-TF-2. TF3's spec check holds: `slice-3-SPEC.md:356`, `:743`; no normal flow writes the Workspace record between prepare and entry (Codex P6 table). |
| P7-02 | R-TF-1. |
| P8-01 | R-TF-3. |

## 4. Result (lead, 2026-10-21 03:10)

- **Rework 1** (`8317081`, DSH): TFR-01, -02, -03, -05, -06, -07, -09, -11, -12 done; TFR-04, -08, -10 BLOCKED.
  Rulings (`tf-r2-book.md` §1): TFR-08: B-023 kept, no change; TFR-10: C2-039 stays BLOCKED and the four tests that
  build an observer without `controls` (S2B-36 :66-93, S2B-38 :176-205, B2-runtime-execution :383, :483) are T
  leftovers (86-3); TFR-04 redone with a legal `healthConclusion` (`missing`) in the two R4c test mutations.
- **Rework 2** (`bd58f4a`, DSH): TFR-04 done.
- **Rework audit** (Codex `R.out.md`: 会出错 1, 违规 3, 不整洁 3). The lead fixed five directly (decision 81 and the C1
  precedent: small fixes after the last rework are the lead's), commit "TF lead fixes after the rework audit":
  - R-01 (会出错): `verify-isolated.mjs` writes the temporary page inside the `try` whose `finally` removes it;
  - R-02: `decodePlanProposalOrigin` returns only `since` again (the `noticeAutomationCap` pass-through was outside
    TFR-02);
  - R-04: the successor's `supersededEvidenceIds` expected from the root as the owner returned it (the root
    supersedes nothing, its one executed check left one evidence id), not from the production `chainEvidenceIds`;
  - R-05, R-06: two comments made true (the Session codec; a missing cause is not read as null).
- **Not adopted:**
  - R-03 (TFR-05's conversion still calls owner writes the Host would call: `recordCheckResult` with a built
    observation, `interruptCheck(host_restart)`; the R3e fixture's Run seed). Ruling R-TF-6: the subject of
    `A2-step1-codecs` is the stored round and its lookups; T kept that file's constructed records, and what made the
    old row wrong was a record no writer produces (an interrupted check without a cause). The rounds now come from
    the evidence owner's own writes, so they have the current shape by construction; that meets the row's purpose.
    Converting this codec test to a real Runtime with real check processes and a Host restart is out of proportion;
    the R3e fixture's seed is the file's fixture (R-TF-2).
  - R-07 (the TFR-08 evidence): Codex shows RUN-23 does carry a V2 authorization (`run-machine.ts:2126`, `:1166`,
    `:1025`), so DSH's reason "RUN-23 has no authorization" was wrong. B-023 stays kept for another reason: the
    `executionAuthorization` type is optional at that call and the narrowing the proposal assumes is not established
    there; the row goes with the structure round (85-1). The lead corrects the wording in the evidence.
