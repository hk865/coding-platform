# FILES CHANGED

**This round (test-only; production untouched):**
- `tests/composition/WP2-wiring.test.ts`
- `tests/helpers/WP2-platform-support.ts`
- `tests/work-graph/WP2-context-extensions.test.ts`
- `tests/work-graph/WP2-message-duties.test.ts`

**Carried unchanged from earlier sessions (still in the working tree):** the 20 production files, `tests/scenarios/WP2-wiring-scenario.test.ts`, `tests/state/WP2-positions.test.ts`, `tests/record-store/WP2-notice-cursors.test.ts`, `tests/work-graph/WP2-undelivered-notices.test.ts`, the deleted `tests/runtime/WP2-context-assembly.test.ts`, and the approved refreeze/harness changes (`S5-message-decision`, `S5-user-messages`, `S1-wait-copy-retirement`, `S5-decision-routes`, `harness.ts`, `support/common.ts`).

# ROWS

Every spec §5.2 row still has at least one test whose name starts with its id. Rows changed this round:

| Row | Test name(s) | RED first seen | Implementation |
|---|---|---|---|
| F06 | `F06 [budget] a real continuation is kept whole while reminder rows that do not fit are cut from the E2 prepared input` (`tests/composition/WP2-wiring.test.ts:477`) | old assertion only checked prefixes (no RED; strengthening) | `context-assembler.ts:optionalRowsFromExtensions`/render |
| F07 | `F07 a focus task keeps the real Task-linked goal_cause card and another focus excludes it` (`:541`); `F07 follows the real page boundary and keeps the named tail Task card under focus` (`WP2-context-extensions.test.ts:402`); `F07 exactly 5,000 real waiting cards succeed…` (`:454`) | old tests derived keys/text from the returned card / fabricated pages | `context-extensions.ts`, `decision-read-model.ts` |
| F08 | `F08 real Work preparation carries the installed extensions in the bound scope, Query preparation stays copy/planning, and a foreign scope is refused` (`:600`) | restored Query mode/extensions lost with the deleted runtime file | `context-extensions.ts`, `context-assembler.ts:optionalRowsFromExtensions` |
| F10 | `F10 [%s] (Query recovery, positive) a standalone Query on the reply-authoring Session retires it…` (`:1833`); `F10 [%s] (Query recovery)…` (`:1737`) | new positive case / memory notice read after recovery | `query-execution.ts:reconcileQuery/resolveUnknownQueryRun` |
| F11 | `F11 [%s] marking one displayed notice…` (`:705`) | old order computed by `messageId <` ternary | `undelivered-reply-notices.ts` (ordering only) |
| F14 | Work `:1128`; user answer `:1467`; Query Answer `:1585` | literal reply body via `readMessageBody` missing; Work subset matching | `message-machine.ts`, `mailbox-service.ts` |
| M02 | `M02 the real resolver and the Session fact return the complete merged guard set…` (`WP2-message-duties.test.ts:250`); `M02 a resolver guard that repeats the Session guard merges to one entry…` (`:278`) | old test checked only the Session guard + uniqueness | `message-duties-adapter.ts` |
| Z01–Z02, F01–F05, F09, F12, F13, F15, M01, M03–M11, W231, P01 | unchanged from report-4 | — | — |

# CHECKS

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (main + UI clean) |
| `npm run check:architecture` | exit 0 (`next source boundaries: OK`; 49 submodule edges) |
| `npm run build` | exit 0 (workbench published) |
| `npx vitest run WP2-` | `Test Files 7 passed (7)` / `Tests 100 passed (100)` (75.6 s) |
| 50-file regression (brief §8 list) | `Test Files 5 failed │ 45 passed (50)` / `Tests 18 failed │ 1184 passed (1202)`; failures exactly A8-host-restart-entry (7), A8-host-restart (3), C6-unrelated-adoption (5), S1-archive-restart (1), WP1-wiring (2) — all the sandbox/bwrap kind (`waiting`→`stopped`/`completed`) |
| `npx vitest run` four refrozen files | `Test Files 4 passed (4)` / `Tests 49 passed (49)` |
| `sha256sum` (10 frozen files) | all ten match the brief's section 3 byte-for-byte |
| `git diff --stat slice-base -- tests` | 14 files, 5699 insertions(+), 19 deletions(-): only `WP2-` files, the helper, and the approved refreeze/harness changes |
| `git diff --stat slice-base -- src` | 20 files, 1125 insertions(+), 150 deletions(-) — byte-identical to round four's |
| `git status --short` | only L-scope paths; `./.dsh-scratch/` deleted; no commit (`git log` still `d1a82d1`, `e446a10`) |

# UNSPECIFIED

1. **F14 Query-answer writer receipt replay (spec §5.2 F14, line 293).** `respondFromQueryAnswer` (`src/core/work-graph/communication/mailbox-service.ts:2574`) is Host-principal-only and wired only into the Workflow port's internal `consultations.messages` (`src/composition/create-platform.ts:1185-1188`), not the public `messages` port (`:955-969`). A retried `consumeConsultation` returns at `src/business/workflow/consultation.ts:152` before the writer, so no public entry reaches the writer's replay with the same request identity. Minimal counter-example: `F14 [memory] (Query Answer)` — `expect(retried.value).toEqual(firstAnswer)` passes via the line-152 early return; the writer is never called on retry. Per the lead decision I did **not** add a production entry. The complete first/retry/reopened values, cursors, DTO R/P, notice at P and literal body are asserted.
2. **F10 positive Query recovery ordering (spec §5.2 F10, line 289; L11-2, line 174).** Following the brief's literal order (save the reply first, then run the standalone Query) yields an empty notice set, because the Query's Kernel entry accepts the existing response (`SessionMessageInputAccepted`, part `response`, acceptedInputs length 1) and the mailbox excludes consumed replies. Counter-example from a probe: reply-then-Query ⇒ `acceptedInputs: [{part:'response',…}]`, notices `[]`. The implemented positive case starts the Query first (it confirms no inputs), saves the Work-origin reply while it is in flight, then makes it unknown and recovers via the real `resolveUnknownQueryRun`, asserting the notice at the observed R on both backends. The existing derived-Session case stays as the empty-set example and now reads notices after recovery on memory too.
3. **F11 determinism seam.** `deterministicClaimIds` (`tests/helpers/WP2-platform-support.ts:83`, `:446`) seeds the memory/second-world claim through the fixture's deterministic id source over the composition's own records/role service, because `newId` is `randomUUID` and the memory message-id order flipped 3/8 across runs. Production is unchanged and the test asserts the sent message ids equal the hardcoded literals, so a fixture/order change fails loudly. If even a test-helper id-source seam is disallowed, the memory half of F11 is not pinnable as a literal.
4. **F07 module page-1 seeding.** The 100 page-1 candidates are committed via the frozen `WP2-duties-fixture.ts` real `seedCandidateProposal` (real codec + real store) rather than a Plan owner command, because `proposePlan` derives `proposalId` by SHA-256 (`planProposalIdFor`); only literal proposal ids permit the literal ordered expectation the lead requires. Counter-example: 100 `proposePlan` calls give hash-ordered keys, so any expected order would have to sort captured readback keys.
5. **Query preparation bracket.** The `observeStage` bracket in `F08` covers the read/assembly stage (opening the saved manifest), not the whole Query operation; Query preparation commits its binding by design (`query-preparation.ts:390`). Stated in a comment at `tests/composition/WP2-wiring.test.ts:651-656`.
6. **Skipped per the lead:** the aggregate 5,000-item guard of the undelivered-reply source and further tests of the temporary 5,000/50-page guards. `tests/work-graph/WP2-undelivered-notices.test.ts` was not changed.

# NOTES

- Subagents: group C (1) and group M (1); the coordinator ran only the section 5 checks.
- `tests/runtime/WP2-context-assembly.test.ts` stays deleted (not recreated); its Query mode/extensions checks are restored at E2 inside `F08` (`:669-675`), alongside the F06 budget correction.
- No real model calls; no network; ports 3080/3099/44797 untouched; no git write commands; `./.dsh-scratch/` deleted; no commit.
- Residual: the F14 Query-answer writer-replay gap and the F10 ordering deviation are the two explicit UNSPECIFIED items above.

# REVIEW

- **F06** — **fixed.** `F06 [budget] a real continuation is kept whole…` (`tests/composition/WP2-wiring.test.ts:477`): the full continuation brief is asserted through its literal tail (`input.endsWith('- 本说明只陈述持久记录中的事实…')`, `:527`) including `### 重新入队`, the creating command's literal reason `F06 budget retry` (`:524`) and `- 没有新输入。` (`:525`); the complete omitted-row outcome is the exact literal line `reminders: 另有 3 条，用‘看’读` (`:533-537`). No queue readback.
- **F07** — **fixed.** Composition `:541` uses the literal `DEFERRED_CAUSE_KEY` (`:557-560`) and the card is only checked against it (`:565-572`). Module `WP2-context-extensions.test.ts:402` now drives the real decisions queue over a real deferred-work Goal with 100 real committed `candidate_v2` records across the real 100/page boundary and asserts the complete literal row order; `:454` adds the four seed-card identities and the four `decision:not_available:<kind>` hint identities to the exact-5,000 case.
- **F11** — **fixed.** `tests/composition/WP2-wiring.test.ts:705` writes a literal per-backend message-id table and literal expected order (`LITERAL_IDS` `:786-798`), asserts the creating commands returned those exact ids (`:800`) and rejects a wrong first item; no ternary. Enabled by the test-only `deterministicClaimIds` seam (UNSPECIFIED 3).
- **F14** — **partially fixed.** Work `:1128` now uses complete equality (`replayedReply.value` `:1205`; full DTO `:1224-1226`) and `readMessageBody` literal `F14 saved reply` (`:1197-1199`); user answer `:1467` body literal `继续` (`:1518-1520`); Query answer `:1585` body literal `F14q consultation answer` (`:1692-1694`), with first/retry/reopened values and cursors intact. The Query-answer **writer receipt replay** is not reachable through any public entry — reported under UNSPECIFIED 1, no production entry added.
- **F10 Query recovery positive** — **fixed.** New `F10 [%s] (Query recovery, positive)…` (`:1833`, both backends): real standalone semantic Query on the reply-authoring Session, unknown → real `resolveUnknownQueryRun`, R from the commitObserver log, notice asserted at R. The existing derived-Session case (`:1737`) remains the empty-set example and now reads notices after recovery on memory too. Ordering deviation reported under UNSPECIFIED 2.
- **Query preparation bracket** — **fixed.** `F08` (`:600`) brackets only the saved-manifest read with `observeStage` and comments that the binding commit belongs to preparation by design (`:651-664`); no zero-commit claim over the whole Query operation.
- **M02** — **fixed.** `WP2-message-duties.test.ts:250` asserts the complete ordered literal guard set (`ProjectCoordinationPolicyActive@null`, `ProjectRoleSpecActive(platform-executor)@null`, `Session(ref)@1`); new `:278` covers the identical-guard merge (one entry per refKey, correct `expectedRevision`).
- **Restore Query mode and extensions checks** — **fixed.** `F08` (`:669-675`) asserts the literal copy/planning markers (`# Verified read-only Query input`, `## Runtime context`, `## Goal`, `## Question`) and the absence of `## Reminders`, `## Context omissions` and the decision hint, while Work preparation still carries the installed hint (`:623`); F05/F08 reads are bracketed.
- **Skip decisions** — **honored.** The aggregate 5,000-item guard and further temporary-guard tests were not added; `WP2-undelivered-notices.test.ts` is unchanged (23/23 green).