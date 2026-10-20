# T wave 1: frozen finding table, rework 1 (lead, 2026-10-19 22:40)

Source: the Codex full audit of the merged wave-1 copy (decision 80-2), seven groups, `codex2/t-aud-G1..G7.out.md`
(会出错 5, 违规 35, 不整洁 20 before dedup). The lead deduped them, checked the disputed ones against the books and the
code, and ruled. This table binds rework 1 (decision 81: at most three DSH reworks). The Codex ids in brackets point
into the audit answers, which DSH may read for the evidence lines.

Copy: `~/dsh-work/slices/s9tbW1` (HEAD `5daea2e`, tag `t-base` = repository 3a9f6d94). Rule sheet: **v2** (frozen
for this rework; see §0).

## 0. Lead rulings that apply everywhere

- **R-1 Rule sheet v2.** v2 (`test-rule-sheet-v2.md`) binds this rework. The change that matters here is A1: a value a
  public route or tool receives from outside is a public input, even when its type is called a draft. Example: the
  `plans/propose` body, which the route hands to `plans.proposePlan` (`src/app/core-routes.ts:388`, `:1067`). A
  helper may pass such a body to that owner, and the test then goes on through public steps. Codex's v2 instance list
  (`t-v2-list.out.md`) says which current uses this covers.
- **R-2 Format-only adaptation of a seed that must stay.** An item made a record field required (TP-009
  `contextAssembly`, TP-025 `chain`, TP-045 `finalizedAt`, …). A handwritten seed that is still BLOCKED or not yet
  converted may then be brought to the current format:
  - add exactly the fields the current codec requires, with the value the current writer writes;
  - change nothing else, and leave its assertions as they are;
  - list each such seed in the reply as `FORMAT` (file:line, field).

  This is not a conversion, and the item's BLOCKED stays open. Wave 1 already did this in several places; they stand
  under this ruling (W1-R3, W1-R4).
- **R-3 Tamper-only rows go.** A row whose prior state can only be made by rewriting an accepted record in place (no
  public step makes it) is tamper-only, under root `AGENTS.md` rule 4 and decision 79-4. Delete the row and name the
  reason (the `file:line` that shows no public step makes the state). The production check stays: T does not delete
  production guards for this reason; the coverage triage after T looks at them.
- **R-4 Unreachable rows go, guarded ones stay.** A row whose state no public step reaches (for example, physically
  removing a Task from a Plan) is deleted, with the `file:line` of the check that refuses that state. If the row's
  claim is a refusal that a current check makes, keep it as an A6 row (`describe('rejects: …')`, prior state from
  A1, one built refused input, a public read showing nothing changed).
- **R-5 Fallback.** Where a ruling below says "convert" and you find that the public step still cannot reach the
  state, mark that row BLOCKED with the evidence. Leave it in its wave-1 form (or R-2 form) and go on. Do not invent
  a third way.
- **R-6 Evidence first.** If you find that a finding's facts are wrong against the code (the line does not say what
  the finding claims), do not apply its fix: report it in the reply with `file:line`.

## 1. Production

| id | class | location | item | what is wrong | the fix |
|---|---|---|---|---|---|
| W1-01 | 违规 [G1-01] | `src/app/startup-reconcile.ts:209`, `:336` and the sites listed in G1-01 (`goal-fan-out-driver.ts:364`, `workflow.ts:1132`, `create-platform.ts:2124`, `context-assembler.ts:1471`, `execution-driver.ts:614,1038,1056,1303`, `run-reconcile.ts:102,264,699`, `runtime.ts:329`) | TP-011, TP-060 | TP-060's 书面核对改正 makes the whole list of V1 narrowings part of the V1 removal (`t-items-TP.md` TP-060). They are still there, and so is the `legacy` start-up classification. | Narrow on whether an authorization exists, keeping the current phase and kernel checks. Delete `startingEntryOf`'s `legacy` return type, its doc text, the test of it and its report branch. Behaviour with no authorization and with V2 stays as it is. `rg` the TP-060 list again for any site still narrowing on V1. |
| W1-02 | 违规 [G2-01] | `src/core/work-graph/state/session-availability.ts:339`; `sessions/session-directory.ts:958`; `sessions/session-record-codecs.ts:660` | TP-007, TP-062, TP-122 | TP-062's 书面核对改正: provenance is non-null and the codec does not fill in null. The stored operation's `action.provenance` is still optional or null, and creating the Session now fills in `new`. | `SessionOperationRecord.action.provenance` is required and non-null, and the operation codec refuses missing or null. `createSessionRecord` copies it, and the internal fallback goes. The public admission's default for an omitted input stays (`session-directory.ts:707`, written at `:782`). Before the change, `rg` every writer of the operation record and list them in the reply. |
| W1-03 | 不整洁 [G2-05] | `src/core/work-graph/state/run-machine.ts:20`, `:412`, `:930`, `:1931`, `:2202` | TP-109 | Comments still describe the deleted RUN-09..11 `R` event source. | Delete those sentences. Describe the RUN-16 same-commit settlement as the code does it. |
| W1-04 | 不整洁 [G2-06] | `src/core/workspace/typescript-source-query.ts:12` | TP-026 | The comment gives work to the deleted `ProjectSourceIndex`. | Delete that part, and keep the accurate sentence about the analyzer reading a frozen snapshot. |

## 2. Tests: a behaviour lost its test (会出错)

| id | location | item | what is wrong | the fix |
|---|---|---|---|---|
| W1-05 [G3-01] | deleted `tests/data/project-source-index.test.ts:41,45,47,49` (`git show t-base:<path>`; all "base" lines in this table are read that way); `tests/data/typescript-source-query.test.ts:149` | TP-026 | The analyzer's incremental `changes` assertions were not moved: a repeat read gives `total:0`; a new file is `added`; a rename gives `added` + `deleted`; an edit gives `modified`. The analyzer still computes them (`typescript-source-query.ts:168,251,265`). | Add the four groups to `typescript-source-query.test.ts`, with real files captured again, added, renamed and edited. Do not bring back the old index class. |
| W1-06 [G3-02] | `tests/app/project-source-tool.test.ts:255` (base `:270`, `:274`) | TP-026 | The frozen tool's name and its four registration values (`read_only`, `workspace_read`, 60000 ms, 65536 bytes) lost their assertions with the deleted mixed case. | Move the name assertion and the four value assertions into the existing frozen case. Only the legacy part stays deleted. The expected values come from the spec or the base test's literals, not from the source constant. |
| W1-07 [G6-01] | `tests/scenarios/S3-context-and-inputs.test.ts:395` | TP-123 | tA now runs for real first, so `requests[0]` is tA's request, not tB's. | Note the request count after tA finishes. Then take tB's first request, and check its current turn's last user message for `## Goal`. Do not search all messages: tA's history in the same Session would match. |
| W1-08 [G7-02] | `tests/work-graph/R3c-plan-adoption.test.ts:291`, `:310` | TP-147 | The race (a new Run appears after the query read its old page) became "claim and start first, then query", so a reader that misses the late Run would pass. | Put back a delegating lookup gate (A3). Once the real old page is read, create the Run through the real claim, prepare and start, then return the page. Put back the assertion that the gate fired, and the original graph-result assertions. |
| W1-09 [G7-08] | `tests/work-graph/S3-prepared-context-admission.test.ts:469`, `:535` | TP-054, TP-165 | AD03 (spec: same requestId, another manifest → `idempotency_conflict`, 0 commits) now differs only in `envelopeId`. | Get the prior state from A1: T prepared for real, then entered with requestId R. The refused input is R again with T2's real prepared manifest, inside `describe('rejects: …')` (A6). Keep `idempotency_conflict` and the zero-commit assertion. |

## 2b. The lead's bubblewrap full suite on the merged copy (22:29)

Result: 772 files, 5 failed; 9,942 tests, 24 failed, 5 skipped (`checks/full-W1.txt`, `full-W1-vitest.log`).

- Eight failures were expected. Rows B-02 and B-03 rule on six of them (A2-gate-chain-facts 2, R3e-reverify 1,
  source-binding-migration 1). W1-26 rules on the other two, AD06 and AD08; each failure here counts twice, once per
  backend.
- Two merge regressions account for the other 16. Both rows below are new.

| id | location | item | what is wrong | the fix |
|---|---|---|---|---|
| W1-43 | `tests/work-graph/S3-prepared-context-admission.test.ts` (world built before `:371`); `tests/helpers/task-claim-fixture.ts:602` | TQ-091 × TP-054 | All 12 tests (AD01–AD04, AD06, AD08 × memory/SQLite) fail in `prepareTaskForReal`: "the architecture catalog record is missing for the active baseline revision". The test's own world writes a bare baseline. TQ-091 now makes that `unavailable`, and TP's copy did not have TQ-091. | Adopt the architecture through the public catalog service (`adoptInitialArchitecture`, as `task-claim-fixture.ts:270` does), as part of W1-25's public world. Do not add a catalog row by hand. |
| W1-44 | `tests/helpers/S1-archive-service-fixture.ts:180-205` (`enter`); failing `tests/work-graph/S1-requeue.test.ts` SV35, SV49, SV50, SV59 × memory/SQLite | TP-054 (the B2 fixture now prepares for real) | After the real prepare, `enter` appends a second continuation brief to `manifest.input` by hand and updates `inputDigest`, but not `totalBytes`. Entry refuses it: "totalBytes must be the UTF-8 byte length of the input". `S2B-track-fixture.ts:340` had the same double brief, and wave 1 removed it there. | Delete the hand-built brief, the second append, the re-put body and the patched `inputBinding`; the real prepare already carries the continuation brief. Keep the `pendingAnomalies` assertion (`:183-185`). If the real prepare's binding lacks the brief digest or the anomaly anchors that these tests need, mark it BLOCKED with the evidence. This file is in scope. |

## 3. Tests: against the book or the rule sheet (违规)

| id | location | item | what is wrong | the fix |
|---|---|---|---|---|
| W1-10 [G1-02, G2-04, G6-02, G3-05] | `tests/helpers/WP1-units-fixture.ts:505-559`; `tests/business/WP1-start-refusal.test.ts:17`, `:42` | TP-009, TP-054 | A binding built by calling the assembler on stub facts, then a hand-built manifest and prepared value, with a Runtime double that forbids prepare. TP-009's 书面核对改正 excludes this "builder" route. | Use the public create and claim, the real `prepareExecution` (`tests/helpers/task-claim-fixture.ts:570`) and the real `startRun`. Make each refusal from a real cause, with a public step between prepare and start:<br>• WF01 `context_goal_changed`: a public change of the Goal the binding pins;<br>• WF02 another `revision_conflict`: a public change of another source the binding pins.<br>Keep the assertions. `WP1-start-refusal.test.ts` is on your whitelist for this. If either refusal has no public cause, that row is BLOCKED (R-5), and its fixture stays in its R-2 form. |
| W1-11 [G3-04] | `tests/app/A2-continuation-projection.test.ts:84`, `:91`, `:97`, `:105` | TP-069 | Four single-`advance` assertions now check the last step of `driveWorkflow`. | Each of the four calls `workflow/advance` once through the shared `post`, and checks that call's value. The start-up chain may still use `driveWorkflow`. |
| W1-12 [G3-06] | `tests/composition/platform.test.ts:80` | TP-001, TP-005 | The unknown-kind refusal is not an A6 row: no `describe('rejects: …')`, and no public read showing nothing changed. The TP book check asked for A6 (`t-bk-TPa.out.md:19`). | Move it into a `rejects:` block. Build the prior state with public steps, change only the kind, and compare a public read before and after. Keep `unsupported` and both backends. |
| W1-13 [G4-01] | `tests/helpers/C1-mailbox-fixture.ts:153-174` | TP-054, TP-081 | After a real prepare, the fixture still hand-builds the running and entered authorization and `commitRaw`s it, and changed `consumerId`. Codex shows why the real start reached only `entering`: the fixture's `provider: 'test'` (`task-claim-fixture.ts:520`) is refused by the provider registry before the Kernel. | Use a supported provider configuration, a scripted model and the real Runtime prepare and start. Hold the model request at an A3 gate (pattern: `tests/helpers/S2B-runtime-steps-fixture.ts:174`, `:282`, `:308`). Read `currentRun` and the envelope through the public execution read. Delete the seed and its `consumerId` change. |
| W1-14 [G4-02] | `tests/helpers/S1-session-facts-fixture.ts:206-227` | TP-062 | `createLegacySession` has no caller left, and still writes the old operation; its expectation was changed from `toBeNull()` to `kind:'new'`. | Delete `createLegacySession` and what only it uses. |
| W1-15 [G4-03, G5-01] | `tests/helpers/S2B-track-fixture.ts:356-398`; `tests/helpers/S2B-runtime-steps-fixture.ts:104`, `:106`, `:275` | TP-096 | The track fixture reuses only the policy install. Its enter and end still write entered facts, end events and observations by hand. TP-096's 书面核对改正 moves both fixtures. | Connect the track's enter and end to the shared start/gate/finish helpers and keep the Run handle. Delete the handwritten enter and end facts. Keep the callers' assertions and values. |
| W1-16 [G4-04, G7-14] | `tests/work-graph/S2B-32-task-timeline-fold.test.ts:228`; deleted `tests/work-graph/S2B-r2-s-preentry-control.test.ts` | TP-095, TP-160 | The merge went the wrong way: the item keeps the r2 public-flow case and deletes the fold's old part. | Restore `S2B-r2-s-preentry-control.test.ts` with the public-flow case and its five time assertions. Delete the duplicate from the fold. The raw control seed stays deleted. |
| W1-17 [G5-03] | `tests/helpers/S5-decision-fixture.ts:846-857` | TP-101 | A fixture-only `builder/1 → decisionDuty` mapping, defaulting to adviser. TP-101's 书面核对改正 asks for production's own `legacyDuty` match, which maps only the five formal templates (`src/composition/create-platform.ts:804`). | Delete the fixture mapping. Give the sending Session a formal template that production maps to the duty this message needs, if no kept assertion changes. Otherwise revert TP-101's conversion to `t-base` and mark it BLOCKED. The production match stays as it is. |
| W1-18 [G5-04] | `tests/helpers/S5-queue-support.ts:300` | TP-104 | The expected value is `installed.ref`, which is the program's own output (F8). | Use the handwritten `policyRef` from `:288`. |
| W1-19 [G6-03] | `tests/helpers/task-claim-fixture.ts:652-654`; used at `tests/work-graph/S3-prepared-context-admission.test.ts:588`, `:589`, `:714` | TP-009, TP-054 | The new Query helper reads the manifest straight from the body store (F7). | Read it through the fixture's real materials owner, `openArtifact(ctx, { ref: bundleRef, usage: 'current' })` (`src/core/work-graph/materials/material-service.ts:156`), then parse it. |
| W1-20 [G6-04] | `tests/runtime/source-binding-migration.test.ts:297-384` | TP-030, TP-118 | The new real-submission authorization test runs on memory only. It is a service-layer row, so the rule sheet asks for SQLite too. | Run the same test and fixture on memory and SQLite, with the real shared backend, the same A3 gate, and the same initiator and read-count assertions. |
| W1-21 [G6-06] | `tests/scenarios/S2C-K-legacy-provenance.test.ts:100` (base `:506`, `:510`, `:512`) | TP-007, TP-062, TP-122 | The kept indexed scene lost its two-segment form. Three assertions went: indexed, every item is an execution, and the task list equals `[TASK_ID, TASK_ID]`. TP-122's 书面核对改正 keeps that scene. | Rebuild the two segments from a current continuation Session, a real Work claim and a publicly submitted, unclaimed Query. Put the three assertions back. The old backfill step stays deleted. |
| W1-22 [G6-07] | `tests/runtime/K3-34-tool-name-constants.test.ts:59` | TP-026 | The expected total is still `BUILTIN_TOOL_NAMES.size + 12`, which comes from a source constant (F8). | Write the total as a literal counted by hand from the spec's name table (`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:159-171`), less the deleted `project_index`. Codex counts 15; count it yourself. Write the sum in a comment and keep the member assertions. |
| W1-23 [G6-08] | `tests/scenarios/K-W-workflow-close.test.ts:233-257` | TP-121 | KA-07 was merged into `WP1-wiring.test.ts` (`:49`, `:68`), but the source was not deleted (book rule 3). | Delete KA-07 from `K-W-workflow-close.test.ts`. |
| W1-24 [G7-01] | `tests/state/run-machine.test.ts:969` (base `:1015`) | TP-133 | The `[EV.begin, CLAIMED]` case (a never-bound CLAIMED Run, then begin) and its exact `forbidden` and `detail` assertion went with the V1 test, though TP-133's 覆盖 keeps it. | Put that one case back with its original code and detail. The V1 and pre-B2 sub-cases stay deleted. |
| W1-25 [G7-06] | `tests/work-graph/S3-prepared-context-admission.test.ts:233`, `:343-382` | TP-165 | The upstream ended Run is still `commitRaw`ed. The new Session is registered with `recordSessionCreated` (a Host fact), and the Workspace is written at @5 before it is moved publicly to @7. | Make the upstream Run with the real Session, claim, prepare and start, then end it through the scripted model. Create the Session publicly. Take the Workspace from its public registration to @7 with public steps only. Delete the raw Run, the Host fact and the @5 seed. |
| W1-26 [G7-07, G2-03] | `tests/work-graph/S3-prepared-context-admission.test.ts:458`, `:572`, `:595-603` | TP-054, TP-165 | The shared `prepare` change broke two BLOCKED rows. AD06's `CHANGED` input is ignored, because a real prepare of a bound Run returns the same Prepared. AD08 lost the Workspace source the base helper put in by hand, but kept its `revision_conflict` assertion. | **AD06** (ruled now): the prior state comes from A1, a real unentered failure followed by Host reconcile to `revoked` (`src/app/startup-reconcile.ts:330`, `src/core/agent-runtime/run-reconcile.ts:320`). The changed binding is the one built refused input, inside `describe('rejects: …')` (A6). Keep `invalid` and the unchanged-binding (RUN-03) assertion.<br>**AD08** stays BLOCKED. Give AD08 alone the base preparation path again (a local copy of the base helper, base `:383`), so it runs as it did at `t-base`. The lead takes the gap separately: the spec expects `revision_conflict`, but the real binding has no Workspace source, at `t-base` too (`graph-context-reader.ts:1010`, `execution-entry-service.ts:1073`). |
| W1-27 [G7-09] | `tests/work-graph/R4b-session-directory.test.ts:53`, `:100`, `:102` | TQ-091 (the lead's merge fix) | The lead's fix added a handwritten catalog record to a trusted seed (F3). | Replace the seed's architecture baseline and catalog rows with the public `adoptInitialArchitecture`, as `tests/helpers/task-claim-fixture.ts:270` does. Keep the `not_found` and no-Session assertions (`:284-304`). The rest of that seed is outside this rework. |
| W1-28 [G7-10] | `tests/work-graph/S5-request-candidates.test.ts:274-286` | TP-169 | After the public propose, RC09 still asserts through `recordAt` and `storeSnapshot().claims` (F7). | Check the same facts through public reads: the proposal read for the absent `requestRef`/`notAdopted`, and the request-candidate read for no claim. If no public read shows one of them, that assertion is BLOCKED (R-5). The title drops "old", as the item says. |
| W1-29 [G7-11] | `tests/state/S1-dispatch.test.ts:109` | TP-127 | UT28 was merged into UT27, but the target name lost UT28's spec-row id (book rule 3). | Name the target with both UT27 and UT28. |

## 4. Tests: tidy (不整洁)

Delete only the dead parts named in each finding (imports, declarations, comments, names). Keep anything a BLOCKED
row still uses.

| id | Codex | items |
|---|---|---|
| W1-30 | G3-07 dead imports after the A2 helper move | TP-069 |
| W1-31 | G3-08 dead imports after the CLI start merge | TP-070 |
| W1-32 | G3-09 dead imports, and the misplaced token comment | TP-071 |
| W1-33 | G3-10 leftovers of deleted R3b cases (SQLite and temp-dir imports, `ArtifactBodyRows`, `otherOwner`, `keyFor`, `rowFor`, empty cleanups) | TQ-094..099 |
| W1-34 | G3-11 `S2C-line-routes.test.ts:293`, `:298`: 13 Sessions, two archived heads | TP-098, TP-161 |
| W1-35 | G4-05 dead imports and locals (S1 workflow-archive, C1 after W1-13, B2 execution, S2A planning) | TP-054, 081, 083, 084 |
| W1-36 | G5-05 to G5-09 dead imports (S2B-track, S2C-L-runs, S2C-X-scale, S5-decision, S5-queue) | TP-009, 054, 096, 101 |
| W1-37 | G5-10 stale comments in S2B-track and S5-decision (`pausedB`: change the words only, not the order) | TP-097, 099, 101, 103, 154 |
| W1-38 | G6-09 dead imports in WP2-duties and WP2-notices | TP-009, 054 |
| W1-39 | G6-10 `SP-text-scan.test.ts:12-14`: `mkdtemp`, `tmpdir`, `join` | TQ-072, 100, 107 |
| W1-40 | G6-11 `task-claim-fixture.ts:191` comment; G6-12 `R4c-source-authority-guards.test.ts:279` title | TP-107, 108, 115 |
| W1-41 | G7-12 dead helpers and imports in S3-prepared-context-admission and S5-goal-settings (after W1-25 and W1-26) | TP-054, 103, 164, 165 |
| W1-42 | G7-13 test names that still claim deleted content: narrow them to what the test does | TQ-110, TP-156, 157, TQ-085, 086 |

## 5. Not taken (no change)

| Codex | ruling |
|---|---|
| G2-02 (TP-015 text) | `execution` is now required, so a single text for missing, null or non-object is right, and "when present" would now be wrong. The text for a current, valid input has not changed. |
| G6-05 (TP-124) | TP-009 makes the hand-built manifest invalid, and a real prepare is the smallest current-format path. The handwritten entered/result calls stay BLOCKED. The wave-1 reply's "untouched" claim was wrong; say so in this reply. |
| G7-04 (TP-025: VD-1, VD-15, GAP-52, P10, P20) and G7-05 (TQ-115: IN11, IN12 seeds) | R-2. Each two-old-roots input is now two current roots, each with its root chain. That is the current-format form of the same bad state, and the assertions are unchanged. The lead freezes these inputs as they are. |
| G3-03 (TQ-001), G5-02 (TP-100), G7-03 (TP-147, 150, 151) | R-1. Codex's v2 list confirms the type: the `plans/propose` request is the owner's own parameter type, and `draft: PlanRevisionDraft` is a public request field (`core-http-types.ts:289`, `:293`, `:329`; `plan-contracts.ts:38`). The lead checked all five sites (`S0-attention-edge-label.test.ts:166`, `S5-decision-fixture.ts:829`, `R3c-plan-adoption.test.ts:197`, `R4c-source-authority-reader.test.ts:117`, `R4c-task-claim-boundaries.test.ts:118`). Each passes a hand-written body, or one built from the fixture's own plan, to `plans.proposePlan`, then goes on publicly: **v2 允许**, no change. If you find one of them built from a store read, replace that read with the public plan read. |

## 6. BLOCKED and partial parts: the lead's rulings

| id | item | part | ruling |
|---|---|---|---|
| B-01 | TP-010 | delete the manifest's `selectedTaskInputs` | **Dropped.** The field is current: a real prepare writes it (`execution-preparation.ts:531`) and the context-input check uses it (`state/context-input.ts:334`). Nothing to do. |
| B-02 | TP-025 | `A2-gate-chain-facts.test.ts:237`, `R3e-reverify.test.ts:477` (red), `A2-gate-chain-facts.test.ts:304` (red) | `:237` and `:477` (a root with no chain or no slot): if the row's claim is how the platform treats such a root, R-4 applies. It is old data (79-1); delete the row, with the cover being the bad-chain codec tests (`A2-step1-codecs.test.ts:387`, `:416`, `:426`). If the claim is a current guard, apply R-2 and keep it. `:304` (finalized copy with a foreign subject) is a current bad-chain input that now fails earlier, on `finalizedAt` (`evidence-record-codecs.ts:335`): apply R-2 (add `finalizedAt`) so it still reaches the subject check. Keep its assertion. |
| B-03 | TP-030, TP-118 | `source-binding-migration.test.ts:399` "changed current execution" (red) | R-3. The state is an accepted request rewritten in place (`:400`); no public step does that (`query-run-recovery.ts:558`, `:568`, `:638`). Delete the row. |
| B-04 | TP-117 | the two `state.set` consumers (`source-binding-migration.test.ts:139-196`) | Check each assertion. A rewrite of an accepted authorization or Reviewer digest in place: R-3, delete. One that needs only running, entered or ended: convert to the real Runtime (pattern `R4c-source-authority-guards.test.ts:318-340`). List each assertion and its ruling. |
| B-05 | TP-054, TP-081 | C1 entered | W1-13. |
| B-06 | TP-054 | WP1 Runtime double | W1-10. |
| B-07 | TP-054, TP-165 | AD06, AD08, upstream runA | W1-25, W1-26. |
| B-08 | TP-108 | `seedRun` uses | Per use, with R-5:<br>(a) a second Run in the same Session (`R4c-graph-history.test.ts:146`): real. The first Run ends, a second Task is claimed in the same Session, then prepared and started. The late-lower-end sub-case (`:594`) stays BLOCKED.<br>(b) a running Run with no Attempt or outbox (`R4c-execution-read.test.ts:212`): R-4, delete. The claim writes them together (`claim-service.ts:1272`).<br>(c) unrelated Runs for scale (`R4c-execution-read.test.ts:369`, `R4c-execution-history-index.test.ts:915`, `:917`): claim independent Goals or Tasks publicly.<br>(d) two hand-built histories racing for one empty Kernel identity (`R4c-execution-history-index.test.ts:268`): R-4, delete; a real Runtime gives each Run its own kernel run id (`execution-driver.ts:620`). The occupied-slot refusal (`:612`, `:656`) is an A6 row: prior state from A1, one refused request.<br>(e) one Task with two running Runs, then `planRef` changed (`R4c-task-claim-concurrency.test.ts:63`, `:70`): the old Run ends, then a new plan (R-1 propose body, review, apply), then the current Run. |
| B-09 | TP-148 | archived or unavailable Session with a new lease holder (`R4c-execution-read.test.ts:175`, `:187`) | Real: end, requeue, claim, Host probe (`sessions/session-health.ts:121`), archive. R-5. |
| B-10 | TQ-103, 104, 112 | `seedAcceptedTask`, occupancy, cancel, link, archive (`tests/helpers/graph-session-fixture.ts:398-431`) | `seedAcceptedTask`: under R-1, propose a body, review it and adopt it publicly. Then follow the book's route: claim without `openResponsibleLink`, busy, cancel the unentered Run, close the link, archive (`t-items-TQ.md` TQ-104, TQ-112). R-5. |
| B-11 | TQ-111 | rows 22-62 of `A1-independent-review.test.ts` (Task physically removed from the Plan) | R-4, delete. The public plan change refuses a physical removal (`plan-validation.ts:338`); name that refusal's test as the cover. The catalog race half stays as wave 1 made it. |
| B-12 | TQ-114 | `S3-context-inputs.test.ts:432-482` mixed world; IN14 Message (`:494`, `:818`) | IN14: send, reply and decide publicly; the message id comes from the request id as the owner makes it, written as a literal you derive by hand. Rows that need a Run of a Goal in another Workspace: R-4 (`claim-service.ts:920`), delete. Convert the other Plan/Run parts to public steps (R-5). |
| B-13 | TQ-115 | IN11, IN12 | IN11: real open, begin, result and finalize. This table allows its expected revision and report type to change: work them out by hand from those steps, and write the working in a comment. IN12 (a FAIL successor of a PASS round): R-4 (`verification-machine.ts:512`, `:631`); delete it, unless it also asserts something a reachable successor shows, in which case report it. |
| B-14 | — | still BLOCKED, ruled after rework 1 | TP-072 and TP-091 (R9: 101 counted plus 2 to backfill); TP-099 (the Project@1, Workspace@3 and Goal@6 checkpoints); TP-124 (an Agent requeue: the tool is refused at start, GAP-46); TP-146 (a Kernel slot conflict); TP-163 (the GR world); TP-108(a)'s late-lower-end sub-case. Leave them as they are. |
| B-15 | — | closed | TQ-001 (R-1, pending the v2 list); TQ-091 (closed by the merge and W1-27); S2B requeue `totalBytes` (wave 1 already removed the second brief). |

## 7. Lead items (not for DSH)

- **L-1 AD08.** Slice-3 spec AD08: when the Workspace moves @7 → @8 after assembly, entry must give
  `revision_conflict`. Production puts no Workspace source in the binding (`graph-context-reader.ts:1010`), and that
  was already so at `t-base`. The base test passed only because its helper added a Workspace source by hand. Decide
  between a production fix (after T, like the decision-85-5 fixes) and a spec change.
- **L-2 Production guards left with no test** by R-3 and R-4 (for example the re-check behind B-03). The coverage run
  after T lists them, and the lead decides.
