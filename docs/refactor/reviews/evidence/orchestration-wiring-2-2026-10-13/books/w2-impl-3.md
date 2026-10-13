# Task: orchestration wiring package 2 — third session: fix round after the acceptance review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Two earlier
sessions implemented wiring package 2 in this copy; their work is in the working tree (not committed). The lead's
acceptance review found production defects and weak tests. This session fixes them. Everything you need is in this
message and in files of this copy.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 6 and the reply of section 7.

**Work with subagents.** You are the coordinator; keep your own context small. Do not read the spec, the code or the
tests yourself. Give each group of section 4 to its own subagent.

## 1. Where the material is (all inside this copy, not committed, excluded from `git status`)

- `./.dsh-ref/w2-impl.md` — the first session's brief. Its sections 1–5 (frozen spec, frozen files and sha256, lead
  decisions L-scope, L-tdd, L-reach, L-interfaces, L-SES13, L-bwrap, rules) still apply, except where this message
  says otherwise.
- `./.dsh-ref/tdd/` — the TDD skill (SKILL.md, tests.md, mocking.md).
- `./.dsh-ref/r3/acceptance-review.md` — the acceptance review (production findings 1–6, the test audit, the row
  disposition).
- `./.dsh-ref/r3/verified-fixes.md` — each production finding independently re-checked, with the minimal fix and the
  first failing test to write. **These six findings are confirmed; fix all six.**
- `./.dsh-ref/r3/w2-refreeze.md` — **the lead-frozen changes to old test assertions and the approved harness
  additions.** These are the only changes to pre-existing test files allowed in this round.
- The frozen spec: `docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md`.

Every subagent reads, in order: the TDD skill; `./.dsh-ref/w2-impl.md` sections 1–5; its group block below; the
review sections its block names; the spec sections they cite; then the code.

## 2. What changes from the first brief

- **L-scope widened**, only by:
  - the four old test files and the harness additions listed in `./.dsh-ref/r3/w2-refreeze.md`, exactly as written
    there;
  - rewrites of the new `WP2-` test files and `tests/helpers/WP2-platform-support.ts`.
- **Production files** stay within the first brief's L-scope, plus `src/core/work-graph/tasks/planning-question-reader.ts`
  (the extra change of the first round is accepted by the lead and kept).
- **Frozen sha256:** the spec and the frozen helpers of the first brief section 3 are unchanged, **except**
  `tests/state/session-availability.test.ts`, `tests/work-graph/S1-wait-disposal.test.ts` and
  `tests/architecture/state-writes.test.ts`, which stay byte-identical as well. In short: all ten sha256 values of the
  first brief still hold.
- **Rule for every test you write or rewrite** (spec §5.3, TDD skill):
  - it enters at its row's named entry (spec §5.1);
  - expected values come from the spec, a handwritten example, or an independent observation: the command's own
    receipt cursor, or a commit observed by a commit observer;
  - no reading of the database or record store to verify;
  - no assertion on internal call counts or internal flags;
  - mocks only at system boundaries: the scripted model, the clock, injected store faults.

## 3. Order

1. Wave 1, in parallel: groups **P** (production fixes) and **H** (harness additions plus the four old-test changes).
2. Wave 2, after wave 1 has reported, in parallel: groups **T1** (module-entry tests) and **T2** (platform-entry tests
   and scenarios).
3. Self-check: one read-only reviewer per group, fresh context, answering the four questions of the first brief
   section 7, **and** checking every item of the test audit in `./.dsh-ref/r3/acceptance-review.md` for its group:
   fixed or not, with file:line.
4. Fixes from the self-check, then the checks of section 6 once.

## 4. Groups

**P — production fixes (findings 1–6).**
- For each finding, write the failing test named in `verified-fixes.md` first, at its entry; see it fail for the right
  reason; then apply the minimal fix.
- Production files: `WG/state/message-machine.ts` (1), `WG/communication/mailbox-service.ts` and
  `WG/views/undelivered-reply-notices.ts` (2), `WG/sessions/session-record-codecs.ts` and
  `WG/sessions/message-record-codecs.ts` (3), `WG/views/undelivered-reply-notices.ts` (4–6).
- Tests: add to `tests/state/WP2-positions.test.ts` (P01 `decision_answered`), `tests/work-graph/WP2-undelivered-notices.test.ts`
  (M04, M05, M08 and the exception normalization), `tests/composition/WP2-wiring.test.ts` (F14 with the user answer's
  position).
- Remove the "UNSPECIFIED (reported)" comments that these fixes resolve.

**H — harness additions and the four old-test changes.**
- Apply `./.dsh-ref/r3/w2-refreeze.md` sections 1–5 exactly.
- Item 3 (IT20) needs the `commitObserver` option of section 5. Item 1 and 2 need group P's finding-1 fix to pass;
  coordinate through the coordinator and run them after P reports.
- Report the exact names and signatures of the harness additions as soon as they exist; T2 needs them.

**T1 — module-entry test rewrites (E4, E5, record store).**
Fix, per the test audit in `acceptance-review.md`:
- `tests/record-store/WP2-notice-cursors.test.ts`: remove the direct record-store reads and the duplicate memory
  backend case. Keep only mechanical binding coverage that needs no store read.
- `tests/work-graph/WP2-message-duties.test.ts`:
  - M02 guard deduplication asserts the complete literal guard set;
  - M03 does not assert internal read counts;
  - remove F04 from this file (F04 is an E1 row, done by T2).
- `tests/work-graph/WP2-undelivered-notices.test.ts`:
  - F10/F12 take R and P from independent observations, not from returned Session fields;
  - M06 asserts the named tail item;
  - M07 uses conforming pages (not one fabricated page) and no store watermark read;
  - M08 uses handwritten identities and order, plus a malformed cursor case;
  - M09 has no call counts;
  - M10 fails a later directory page, proving the whole accumulated window is discarded;
  - remove the P5 duplicate of M04;
  - M05 covers malformed and zero positions.
- `tests/work-graph/WP2-context-extensions.test.ts`: F06 answers the existing decision instead of substituting an
  empty queue; F07 reads real cards across real pages. Fault-injection cases stay as supplements but are not named as
  the F05–F08 row evidence (T2 provides E2 evidence).

**T2 — platform-entry tests and scenarios (E0–E3).**
Fix, per the test audit:
- `tests/composition/WP2-wiring.test.ts`:
  - **F03:** a real read-only copy derived through the public lifecycle, not by overwriting Session provenance in
    `WP2-platform-support.ts`.
  - **F04:** reissue the original request identity after the role-fact failure; verify the original receipt and an
    unchanged card count.
  - **F05–F08:** through real platform preparation (E2): the prepared input text and budget behaviour as the spec
    states. F07 uses Task-linked cards that exist in the product (see `goal-decision-reader.ts`). Expected text comes
    from the spec or handwritten examples.
  - **F09:** add the continuation case, and proof that no successor execution accepted the reply.
  - **F11:** add the memory backend and handwritten expected sequences.
  - **F13:** create the real responsible link through `linkSessionWork` and exercise the transfer; no fabricated
    Kernel acceptance position.
  - **F14:** cover the Query Answer writer through real Query preparation/start and `workflow.consumeConsultation`,
    with first / same-request retry / SQLite-reopen retry compared in full, including P.
  - Bracket the reading stages with a production `commitObserver` (zero commits) and the model boundary (zero model
    calls), spec §5.2 line 308 and §8.5.
- `tests/scenarios/WP2-wiring-scenario.test.ts`:
  - **Z01** advances the Workflow through the scenario harness, using the approved additions;
  - **Z02** checks the next prepared reminder input, not graph facts;
  - recovery removal is proven by a positive observation, not only a zero count.

## 5. Rules

- Test-first for every behaviour change (first brief section 5 rule 1). For test-only rewrites, keep a log: old test,
  what was wrong, new test, its result.
- No git write commands; one vitest command at a time; no real model calls; no network; do not touch ports 3080, 3099,
  44797; probes only under `./.dsh-scratch/`, deleted at the end.
- If the spec, the review and a frozen or existing test disagree: keep the test, stop that item, and report it under
  UNSPECIFIED with the three texts.

## 6. Checks

Run exactly the commands of the first brief section 8, plus these three:
```
npx vitest run tests/state/S5-message-decision.test.ts tests/work-graph/S5-user-messages.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/app/S5-decision-routes.test.ts
git diff --stat slice-base -- tests
git diff slice-base -- tests/state/S5-message-decision.test.ts tests/work-graph/S5-user-messages.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/app/S5-decision-routes.test.ts tests/scenarios/harness.ts tests/scenarios/support/common.ts
```
Expected (this sandbox, no bubblewrap):
- typecheck, check:architecture and build exit 0;
- every `WP2-` test passes, except scenario cases that need a registered check, which fail only with the sandbox kind;
- the 50-file regression run fails only in the 18 sandbox-kind cases of `DSH-BASELINE.md`;
- the four refrozen files pass, except sandbox-kind cases;
- all ten sha256 values hold;
- the tests diff lists only new `WP2-` files, the helper, and exactly the refreeze and harness changes.

## 7. Reply

The reply format of the first brief section 9, plus:
- **FINDINGS:** for each of findings 1–6: the RED message of its first test and the fix (file:symbol).
- **AUDIT:** for each item of the test audit: fixed / not fixed (why), with the new test name.
- **HARNESS:** each harness addition, with its signature.
