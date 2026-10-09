# Wiring package 1, part 2 guided round: three fixes in the Workflow handover (new Session, key-information brief)

You start in a NEW Session. Everything you need is in this brief and in the copy. Read this whole brief first.

## 1. What this copy is and what is done

- The working tree is a git copy of the product repository (TypeScript, Node 24, vitest). Tag `slice-base` is the
  baseline; `DSH-BASELINE.md` holds its check numbers.
- "Wiring package 1" (I-1 duty resolver, I-3 anomaly reminder rows, G Goal-content check at entry, E15 handover of an
  ordinary continuation) is implemented in the working tree (uncommitted). Its frozen spec is inside the copy:
  `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md` (Chinese; §0 lead notes L1–L17 win over the
  body; §3 state rows W1-HO-01…04; §4.4 E15 items 1–9; §7 rules).
- Today: typecheck 0, check:architecture 0; the 8 new test files (63 runs) pass except SC01/SC02, which stop only at
  the registered check because this sandbox has no `/usr/bin/bwrap` (outside the sandbox the lead measured 63/63);
  the 34-file regression set fails exactly the 49 baseline tests (all bwrap ENOENT), `production-reach` passes.
- The lead removed two now-reached entries from `tests/architecture/production-reach-allowlist.json`
  (`RoleReadOptions`, `RoleConfigurationPort.readRoleSpec`). That change is the lead's and stays; do not touch the file.
- An independent review found three defects in `src/business/workflow/workflow.ts`, all in the E15 code. This round
  fixes exactly these three items (section 4), nothing else.

## 2. Frozen files (never change them)

At the end `sha256sum` of these 12 files must print exactly:

```
f6cb56adc3438f24da95d3b3e39b614d1c10e446d768259eebd786036c3eb006  tests/state/WP1-goal-content.test.ts
8f891f6bcbfb2ed23ba045aad65011cae37bc8230e1226e7579ac11304f45b0c  tests/runtime/WP1-context-assembly.test.ts
4f679aae6b28fa7c50819dc2d51806992e956c8ff50d35e1eac4c8042ae33ec3  tests/work-graph/WP1-context-anomalies.test.ts
b4a6c5878509def560f54ebb99d0363199e7650522ae43baedabb50a33e66a4a  tests/work-graph/WP1-goal-content-entry.test.ts
58d0b64b2048bd5a5d4dd9a0381d81bcde672a5bb9b809ea9d191cd1b158e620  tests/business/WP1-start-refusal.test.ts
a075471a0b8caa010ab4d586d501469fa48d3816ba7a801ae6f7ba86303bf27a  tests/composition/WP1-session-duty.test.ts
8ea44e7dce044e486a099b20016602926a5b431ec3c068ffaffb024a5ab251d9  tests/business/WP1-continuation-handover.test.ts
e65135e4f935e3c1c5eecea03068bcb20a7fb5316486e5056530b4acf619b379  tests/scenarios/WP1-wiring.test.ts
440f9165790d1734fb884caa202da9698969401c7113d065b96592e16ef80f2e  tests/helpers/WP1-entry-fixture.ts
6ecebf3b7cd9cf4be6d38222f37b87a5b3bdfc222318c41ab11268e83b7e9963  tests/helpers/WP1-handover-fixture.ts
4d45ce44ccb3b9e4b0b13deb26d96c66b0814427aca4a36ee2e82211c30c023b  tests/helpers/WP1-scenario-fixture.ts
413e6a043e980c143fe81b8822fb6e037c1e5907a34bebd47c592f4fe093a48c  tests/helpers/WP1-units-fixture.ts
```

## 3. Rules

1. **Write scope: only `src/business/workflow/workflow.ts`.** Every other file stays byte-identical (check with
   `git diff --stat` before and after: only the line count of `workflow.ts` may change). No new file, no new export.
2. Keep the existing behaviour everywhere the items do not name: §4.4 item 8 (without `deps.responsibilities`
   everything is exactly as before: `create_session` → claim with the receipt's revision; `claimRequeued` checks
   nothing), HO09 (no `continuation` provenance → plain claim), the result mappings of W1-HO-02 / W1-HO-03, the
   archive step's request, the order of reads.
3. Spec §7 rules stay binding (summary): never `waiting` because a handover step failed; the claim's Session revision
   is read AFTER the handover, never from the `create_session` receipt; no anchor, no requeue, no message from the
   handover; errors keep their code; every state transition through `src/core/work-graph/state/` (this round adds
   none).
4. No real model; never touch ports 3080, 3099, 44797; never edit `vendor/`; no git write command (add, commit,
   checkout, restore, stash, reset, rm), no install, no server, no network. Scratch files only in `./.dsh-scratch/`
   (never `/tmp`); delete it at the end. This sandbox has no `/usr/bin/bwrap`; do not work around it.
5. Keep comments true; a comment that describes changed behaviour is fixed in the same edit.

## 4. The items (file:line in the current copy; spec rule; direction — not code)

- **F1 — closed successor link pinned as absent.** `src/business/workflow/workflow.ts:1366` (`transferStepFor`):
  the successor's link is looked up with `openResponsibleLink`, which ignores a CLOSED C→T `responsible` link, so a
  C that once had this link (closed later, e.g. through the public `linkSessionWork(active: false)`) is pinned with
  `revision: 0`. The owner compares `destinationLink?.revision ?? 0` with the pin
  (`src/core/work-graph/sessions/session-responsibility-service.ts:476`), so every such transfer is a
  `revision_conflict` → `select_work` → the W1-HO-04 recovery builds the same zero pin again: an endless loop.
  Spec §4.4 item 5: "C 对 T 的 `responsible` 关系版本（C 没有这条关系时，用 … revision: 0）" — 0 only when the
  link record does not exist. Direction: the PREDECESSOR link must still be open (unchanged); for the SUCCESSOR, find
  C's `responsible` link for `{kind:'task', ref:T}` whatever its `until`, pin its own ref and revision; use the
  revision-0 ref only when C has no such link record at all. (Check what `SessionCard.links` contains — it already
  carries closed links, `openResponsibleLink` filters them with `until === null`.)
- **F2 — a replayed `create_session` after a finished handover builds a stale claim.**
  `src/business/workflow/workflow.ts:1518–1532` (`performStep` case `create_session`). If the same `create_session`
  request is performed again after its handover step already committed (the owner replays the original receipt,
  whose `session` snapshot carries C's revision from creation time — `session-directory.ts:986`), `buildHandoverStep`
  returns `null` (P's T link is now closed) and the claim is built with `session.revision` from the receipt; the
  transfer has meanwhile raised C's revision by 1 (`state/session-responsibility.ts`), so the claim is refused and the
  Workflow ends `waiting` (`claim_task` case, `:1537`). Spec §7 rule 2 / L10 ("领取的 Session 版本一律在交接步之后
  现读，不用 `create_session` 回执里的版本") and W1-HO-01 ("原回执重放时下一步按当时的事实重算"). Direction: when the
  `create_session` request carried a `continuation` provenance AND `deps.responsibilities` is installed (the E15
  path) and no handover step is due, build the claim with C's CURRENT revision read now from C's card (the same way
  the claim after a handover step reads it; C unreadable → `waiting` with that path's wording). A `create_session`
  without a `continuation` provenance, or a Workflow without `deps.responsibilities`, keeps the receipt's revision
  exactly as today (rule 2 of section 3).
- **F3 — comment contradicts L4.** `src/business/workflow/workflow.ts:1554–1559` (case `start`): the comment says
  a re-prepare derives "a new deterministic prepare request id". `prepareStep(base, runRef)` hashes the unchanged base
  and Run ref, so the prepare request id is the SAME; `prepareExecution` of an unbound Run assembles anew instead of
  replaying by request id, so the new manifest makes the following `start` request id different (spec §0 L4).
  Direction: correct the sentence; behaviour unchanged.

## 5. How to split the work

**This run is headless. When your turn ends, the whole run ends and every subagent that is still running is killed
(an earlier attempt of a round lost all its work that way: it started six subagents and ended its turn).** After
starting subagents, stay in your turn until every one of them has finished and reported: wait with a blocking shell
command (for example `sleep 540`) and check with `list_agents`, again and again. End your turn only after the final
checks of section 6 and the reply of section 7.

You (main Session): keep your own context small; do not read `workflow.ts` yourself beyond what you need to check.
First record `git diff --stat` and `sha256sum` of the 12 frozen files into `./.dsh-scratch/before.txt`. Then start ONE
implementation subagent with sections 1–4 of this brief verbatim. It reads spec §0 L10, L13, L17, §3 W1-HO-01…04,
§4.4 items 2–8, §7 rules 1–2, then the code at the cited lines, makes the three edits, runs `npm run typecheck` and
`npx vitest run tests/business/WP1-continuation-handover.test.ts tests/business/WP1-start-refusal.test.ts
tests/business/R5c-workflow.test.ts tests/business/A2-workflow-auto-rework.test.ts
tests/business/A2-workflow-result-mapping.test.ts tests/business/S1-archive-flow.test.ts
tests/business/S1-task-order.test.ts`, and reports: each item → file:function:line changed, test results.

When it reports, run section 6 once. Then start ONE fresh review subagent with sections 1–4 verbatim and the final
`git diff slice-base -- src/business/workflow/workflow.ts`: per item F1–F3 done / not done / done differently
(file:line), and rule 2 of section 3 (behaviour outside the items unchanged: name each place it checked). Fix what it
finds (through a subagent), re-run section 6.

## 6. Checks (main Session)

- `npm run typecheck` 0; `npm run check:architecture` 0.
- New tests: `npx vitest run tests/state/WP1-goal-content.test.ts tests/runtime/WP1-context-assembly.test.ts
  tests/work-graph/WP1-context-anomalies.test.ts tests/work-graph/WP1-goal-content-entry.test.ts
  tests/business/WP1-start-refusal.test.ts tests/composition/WP1-session-duty.test.ts
  tests/business/WP1-continuation-handover.test.ts tests/scenarios/WP1-wiring.test.ts` → 63 runs: 61 passed, 2
  failed (SC01, SC02, each `expected 'waiting' to be 'completed'` after a `run_check` step with
  `ENOENT … /usr/bin/bwrap`; anything else is a regression).
- Regression: write the 34 files below into `./.dsh-scratch/reg.txt` and run `npx vitest run $(cat
  .dsh-scratch/reg.txt)` → 49 failed / 296 passed; every failure ends `waiting` with the bwrap ENOENT (or follows
  from it), the same 49 tests as `DSH-BASELINE.md`; `production-reach` passes.
  tests/scenarios/C6-unrelated-adoption.test.ts tests/work-graph/S3-prepared-context-admission.test.ts
  tests/runtime/S3-context-assembler.test.ts tests/work-graph/S3-graph-context.test.ts tests/state/context-input.test.ts
  tests/business/S1-session-maintenance.test.ts tests/business/S1-archive-flow.test.ts tests/business/S1-task-order.test.ts
  tests/business/A2-workflow-auto-rework.test.ts tests/business/R5c-workflow.test.ts
  tests/business/A2-workflow-result-mapping.test.ts tests/composition/platform.test.ts
  tests/composition/A2-requeue-platform.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts
  tests/scenarios/A8-host-restart-attestation.test.ts tests/scenarios/A8-host-restart-entry.test.ts
  tests/scenarios/A8-host-restart-lease.test.ts tests/scenarios/A8-host-restart-paused.test.ts
  tests/scenarios/A8-host-restart-rework.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/harness.test.ts
  tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S1-archive-restart.test.ts
  tests/scenarios/S1-wait-copy-retirement.test.ts tests/work-graph/S1-anomaly-owner.test.ts
  tests/work-graph/S1-archive-owner.test.ts tests/work-graph/S1-provenance.test.ts tests/work-graph/S1-responsibility.test.ts
  tests/work-graph/S1-session-facts.test.ts tests/app/S1-session-routes.test.ts tests/architecture/state-writes.test.ts
  tests/architecture/boundaries.test.ts tests/architecture/production-reach.test.ts
- The 12 frozen sha256 unchanged; `git diff --stat` differs from `before.txt` only in `workflow.ts`.
- Run only these tests, never the whole suite. Delete `./.dsh-scratch/` at the end.

## 7. Reply (plain text, these four sections)

- FILES CHANGED: each path, one line on what changed (should be only `workflow.ts`).
- CHECKS: typecheck, check:architecture, new tests (runs, passed, failed with first failure lines), regression
  (failed/passed vs baseline, any message that differs), sha256 check, `git diff --stat` comparison.
- UNSPECIFIED: per item: what, spec line, file:line (or "none").
- NOTES: per item F1–F3 the function and lines changed; which subagents you ran (role, count).
