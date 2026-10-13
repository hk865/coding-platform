# K part A — lead decisions for the old-test flips (2026-10-13, lead)
> Frozen into slice-K-SPEC §9 on 2026-10-14: D1→M1, D2→M2, D10→M4, D11→M5, D9→M6, D6→M7, D12→M8, D8→M9; M3 (the health call runs with the Host principal) came from the flip review. D3–D5, D7, D13, D14 are test-writing rules for the frozen flips.

Frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md` (834e5897). These decisions settle the
open questions of the drafted flip list (`impl/kA/flips-raw.md`, workflow wf_4b016508-218) and amend the spec only where
marked **AMENDMENT**. The amendments go into the spec as §9 when the flips are frozen.

## D1. Business fixtures are the "closing unsupported" fixture — AMENDMENT
- `createAgentRuntime` gains ONE optional dependency, named `turnClosure`. DSH defines its fields: the health owner's
  `recordSessionHealth` and this Host instance's lease (L4/L5). `create-platform.ts` always wires it.
- Without `turnClosure`, the Runtime port does not install `closeOpenTurn` (§2: "not installed is unsupported").
- Workflow `claimRequeued` with a port that has no `closeOpenTurn`: it returns no `close_open_turn` step and goes
  straight to today's fallback (`create_session{requeue}` plus the wiring-1 handover), exactly as today.
- Maintenance with a port that has no `closeOpenTurn`: a definite failure, so today's logic word for word.
- Consequence: `tests/business/S1-session-maintenance.test.ts` (IT10 and all others) and
  `tests/business/WP1-continuation-handover.test.ts` (HO01–HO13, HM01–HM04) stay **byte-identical**. Their fixtures
  (`workflowForFixture`, `createHandoverWorkflow`) wire no `turnClosure`, so they are the §6 "closing unsupported"
  fixture. No fixture change, no `selectPastUnsupportedClose` helper. The closing-success counterparts are new KE3 tests
  (KA-07, KA-10, KA-14) that DSH writes.

## D2. Scenario "closing unsupported" = a Kernel-level switch in the test file
For a real Host (scenario harness), the Runtime has `turnClosure`, so "unsupported" must come from the Kernel: L4 step 5,
"Kernel has no closeOpenTurn → unsupported". The Runtime reads `closeOpenTurn` (and `readTurnBounds`) from its injected
`kernel` dependency (`create-platform.ts` passes the public-api module namespace) **at call time**, never caches it at
construction. A test file that needs the switch adds exactly this (precedent: `tests/composition/R4-control-runtime-platform.test.ts`):

```ts
const kernelClosure = vi.hoisted(() => ({ supported: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => (kernelClosure.supported ? actual['closeOpenTurn'] : undefined) });
});
afterEach(() => { kernelClosure.supported = true; });
```
- Adjust the relative path to the file's directory. Merge `vi`/`afterEach` into the existing vitest import.
- A fallback case sets `kernelClosure.supported = false` before the first (re)start whose maintenance or Workflow would
  close the Turn, and leaves it off for the rest of that case.
- With the switch off, maintenance falls to today's logic. The Workflow, reaching a `kernel_turn_open` line with no
  continuation, still returns the `close_open_turn` step; its receipt is `{ status: 'unsupported' }`, and its next is
  today's `create_session{requeue}`. So a fallback sequence = today's sequence with that one step inserted.

## D3. Receipt lists
With `stopBefore` on `start`, the receipts end `... 'close_open_turn', 'claim_task', 'prepare'` (`prepare` is its own
step, workflow.ts:1716-1725). Use exact lists only where the old test used exact lists; otherwise `arrayContaining`.

## D4. A8-3l step 6 (forced Turn on S1)
Move it before the closure: right after the requeue is committed and before the claim advance, while S1's Turn is
still open (Step 4b). Its comparison base stays `oldKernel`.

## D5. Harness step kinds
No `RECEIPT_STEPS` entry for `close_open_turn`; it is FuzzStep `other`. No harness change. If an invariant rejects the
SES-13 health write in that step, DSH stops and reports.

## D6. No new database reads
- No flipped or added assertion may read `kernel.sqlite` or `ledger.sqlite` (no new `kernelSnapshot`, `kernelTurnOf`,
  `readSqlite`, `forceTurnOnKernelSession` uses). This is the user's standing rule.
- An old line that reads the Kernel database and no longer holds under K: delete it, or replace it with a public read
  (the core route for Session history, or a platform reader the test already uses) when one is at hand.
- Existing `h.counts()` file-count assertions keep their role; change the expected value where §6 says so (the closure
  appends exactly one Kernel record).
- The appended `run.interrupted` record itself is KA-01 (KE1), not asserted in scenarios.

## D7. Splits
- A8-3n, A8-3r (spec), SC01 (spec), and A7-G4 (lead: split, to keep the GOAL-29 fallback coverage).
- The success case is the flipped test. The fallback case is the old test, with the D2 switch off and the D2 step
  inserted, renamed to say "(closing unsupported)".
- New test names start with the old row ids plus the KA row, for example `A8-3n (closing supported; KA-10, ...)`.

## D8. Beyond §6, accepted (report them in the frozen file)
- `tests/scenarios/A7-control.test.ts` G-04/GOAL-29 (~line 1175): flip, no split (A7-G4 keeps the fallback).
- `tests/scenarios/A8-host-restart.test.ts`:
  - the A8-3d harness case kernelRecords +1;
  - the test at ~666: a closing restart before a new quiet restart;
  - the ~732 'on' branch: same Session;
  - W-11 line ~502 and W-12 line ~541 flip.
- `tests/scenarios/A8-host-restart-entry.test.ts` A8-2d: session health ~511-512 flips (besides the count).
- `tests/kernel/B2-history-public-export.test.ts`: allow `closeOpenTurn` and `readTurnBounds`.
- `tests/app/A2-runtime-capabilities.test.ts:158` and `:121`.
- `tests/composition/R3c-R4b-platform.test.ts:170`.
- `tests/scenarios/A4-duplicate-receipts.test.ts`, `tests/scenarios/C3-paused-continue-brief.test.ts`,
  `tests/scenarios/harness.test.ts` (the drafted items).

## D9. Capability texts — AMENDMENT (L11 left the wording open)
Production text (DSH writes it into `workspaceRuntimeCapabilities`, create-platform.ts) — exact:

**continueHistory.reason**
```
a continuation is a new Run, never a resume of the original Turn. A Run created by a requeue starts with a continuation brief of the previous Run's durable facts and is labelled a continuation, not a resumed execution. When the previous Turn has a Kernel terminal, a new Run in the same Session continues its history, including the successor Run after a yielded wait. When the previous Turn has no Kernel terminal (for example a Run interrupted by a Host restart, including one paused then, a Run stopped at restart by a queued cancel, or one a person attested while its Kernel Turn was still open), the Kernel refuses a new Turn in that Session and the original Session is unavailable (kernel_turn_open, its history stays readable) until the platform closes the dangling Turn. For a Work line the platform closes it as interrupted: the Session maintenance does so after a clean interruption, a stop by a queued cancel or a person's attestation, and the Workflow does so when a person, or the Goal, continues a paused-interrupted Run. The closure never resumes the interrupted Turn and never invents a result for an unfinished tool call; the Session becomes available again and the continuation is a new Run in the same Session, whose model history holds the completed Turns before the interrupted one, while what the interrupted Turn had accepted reaches it only through the continuation brief. When the closure is not possible (only the legacy Kernel reader, another Kernel adapter, a Kernel that cannot close a Turn, an unreadable Kernel store, or another Run at the Kernel head), and for a Query line, whose open Turn is not closed, the continuation is a new Run in a new Session that continues the original Session's last completed history (same Kernel adapter only; otherwise the brief alone). After a Host restart a waiting continuation is rebuilt only when its Turn has exactly one waiting message; otherwise its outcome is recorded as unknown (continuation_unrebuildable), keeping its Session and Lease until a person attests it
```
Every phrase the old A2 test asserts for continueHistory still holds, so those assertions stay unchanged. KA-17 asserts
the new sentences.

**recoverRun.reason** — replace only the sentence
`The continuation of an interrupted Run is a new Run with a continuation brief, in a new Session that continues the original Session's last completed history.`
with
`The continuation of an interrupted Run is a new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session; when that closure is not possible, in a new Session that continues the original Session's last completed history (see continueHistory).`
Old assertions `'new Run with a continuation brief, in a new Session'` (A2:121, R3c:170) become the two phrases
`'new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session'`
and `'when that closure is not possible, in a new Session that continues the original Session'`.

**safePointPause.reason** — replace only `(a new continuation Run in a new Session)` with
`(a new continuation Run, in the same Session once the platform has closed the dangling Kernel Turn, otherwise in a new Session)`.
No old test asserts it.

## D10. kernelSessionApiVersion
- `src/core/agent-runtime/contracts.ts:5` widens to `1 | 2 | 3` (production, DSH; beyond §6, accepted).
- A2:158 becomes `expect(report.kernelSessionApiVersion).toBe(3);`.
- R4a:814: 2 → 3 (§6).

## D11. Continuation brief Turn status — AMENDMENT
- `ContinuationBriefV1.stoppedAt.turnStatus` gains `'interrupted'`. This amends §6 "continuation-brief.ts 不改" for this
  one value.
- `TURN_STATUSES` in `src/contracts/continuation-brief.ts` and in `continuation-brief-assembly.ts` both gain it.
- A closed interrupted Turn reports `'interrupted'`, never the `'running'` fallback. KA-09 asserts it.
- Old tests: no assertion depends on it. Do not add one in the flips.

## D12. Late Kernel appends from an abandoned Host
After the closure the head revision moved, so a held Kernel call of an abandoned Host fails its terminal append with
the Kernel's revision conflict (sqlite-stores.ts:218 `Session revision 冲突`). Expected; not asserted; drainAbandoned
tolerates it. Comments saying "draining it lets its Kernel end the Turn" are updated where the test is edited.

## D13. Unreadable Kernel store (A8-host-restart W-14, ~610)
The closure returns `unreadable`, a definite failure, so today's logic runs (for a human-attested line the exemption
skips it; nothing is written). Keep the test; do not cite decision 51 for it.

## D14. Comments and names
Update every comment, docblock bullet and test name in an edited test that becomes false. Keep row ids. Do not touch
comments of tests you do not edit, except a header docblock bullet that describes an edited test.
