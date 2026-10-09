FILES:

- `tests/runtime/S1-archive-files-brief.test.ts`
- `tests/runtime/S1-routed-replies.test.ts`
- `tests/scenarios/S1-archive-restart.test.ts`
- `tests/scenarios/S1-wait-copy-retirement.test.ts`
- `tests/state/invariants.ts`
- New: `tests/helpers/S1-runtime-scenario-fixture.ts`

PER CASE:

Expected first failures below are static predictions, not executed results.

- IT01 — REWRITTEN: real edits, lost Kernel result, startup reconciliation; first: `ArchiveChangedFilesReader.readArchiveChangedFiles`.
- IT02 — REWRITTEN: real Run, registered empty Kernel store, worktree fallback; first: changed-files reader stub.
- IT03 — REWRITTEN: retired Run, anchor, responsibility disposal, archive, successor preparation; first: `SessionLifecyclePort.requestSessionArchive`.
- IT04 — REWRITTEN: frozen old manifest and literal text/digest oracle; expected passes in part 1 because historical loading/rendering is unchanged.
- IT05 — REWRITTEN: nine distinct stopped Runs and anchors, successor actually enters; first: archive-request stub.
- IT32 — REWRITTEN: another Work edits `a`; tested Run cancelled before entry; first: changed-files reader stub.
- IT28 — REWRITTEN: real yielded wait, transfer, response, running D’s next safe point; first: archive-request stub.
- IT29 — REWRITTEN: persisted messages, paginated duplicate-candidate adapter, real acceptance; first: archive-request stub.
- IT30 — REWRITTEN: unrelated idle D retains response until its next legal Work; first: archive-request stub.
- IT19 — REWRITTEN: request-boundary fault, restart, receipt replay and successor brief; first: `WorkflowPort.archiveLine`.
- IT21 — REWRITTEN: queued stop, restart, original intent/cursor; first: Workflow archive stub.
- IT22 — REWRITTEN: fault after anchor, restart, original anchor/body/cursor; first: Workflow archive stub.
- IT23 — REWRITTEN: fault after responsibility disposal, exact link interval/revision; first: Workflow archive stub.
- IT24 — REWRITTEN: fault after requeue, original value/cursor and creation counts; first: Workflow archive stub.
- IT25 — REWRITTEN: final HTTP response loss after durable commit, restart and original-request replay; first: Workflow archive stub.
- IT20 — REWRITTEN: transferred reply consumption, copy attachment/archive, owner retirement before late reply; first: Workflow archive stub.

FINDINGS:

1. DONE — nine distinct Runs, canonical identities, warning-bearing facts, omitted anchor unpicked.
2. DONE — valid edit of `b` starts; its result never persists.
3. DONE — source archived before successor claim; preparation binding/digest checked.
4. DONE — literal historical encoding and independent frozen oracle.
5. NOT DONE in full — IT28/IT30 corrected; IT29 requires the explicit overlap seam described below.
6. DONE — D10 replay separation, successor exclusion, anchor references and link history.
7. DONE — transport response loss injected after durable finalization.
8. DONE — three independent histories with actual consumption and health-owner retirement.
9. DONE — S1-5 compares adjacent commits, avoiding multi-commit restart false positives.

UNDETERMINED:

- IT29, SPEC §2.5:285 and §5.4:1042: strict production outbox/keyset reads cannot naturally produce the requested S→D overlap. The fixture injects duplicate candidates from real persisted records; Runtime and acceptance remain real.

RISKS:

- No Node, npm, npx, typecheck or tests ran.
- Lead should verify the Kernel sink fault/reconciliation at `S1-archive-files-brief.test.ts:113`, nine-Run setup at `:45`, and clock/factory interception at `S1-runtime-scenario-fixture.ts:62`.
- All case IDs/counts and local import paths were checked by reading; only the six permitted files were edited.