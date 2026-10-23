/**
 * A.2 step 6, scenario C3 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C3-brief-idempotency.test.ts`; §12.2 W-24 (C3-R1), W-02, W-05 with RUN-16 →
 * RUN-03, W-25 (C3-R2); §6.1 contract (e) and RUN-02/RUN-03; §11 I-19; §12.10 steps 1–5).
 *
 * Run 1 writes a notes file and answers without the result file, so the registered static check
 * FAILs; the Workflow requeues the Task automatically and claims the requeue: Run 2 is `Claimed`
 * with its `requeueRef`, and its `prepare` assembles the continuation brief into the content-addressed
 * manifest. Then the Host stops at each crash point before the Kernel:
 *
 * - W-24 (C3-R1): after the prepare stored the manifest, before RUN-02. The reconcile does nothing;
 *   the Workflow prepares again. With the workspace unchanged it is the same manifest (the body put
 *   is replayed); with the source changed in between it is another manifest whose brief differs only
 *   in the workspace facts. Either one is authorized: the Run was still `Claimed`, nothing was pinned.
 * - W-02: after RUN-02, before the begin. The workspace source changes; the Workflow re-drives the same
 *   claim and `prepare` rebuilds the bound value (`rehydratePreparedExecution`): the same brief digest,
 *   not a brief of the changed source.
 * - W-05: after the begin, with no Kernel Turn. The reconcile revokes the entry (RUN-16); the source
 *   changes again; the next start re-authorizes it (RUN-03, generation 2) with the same input binding;
 *   Run 2 then enters with that brief and completes.
 * - W-25 (C3-R2): the Host crashes before the prepare and restarts without the Kernel Store registration,
 *   so it cannot read the facts Run's Kernel store (`host_config`): the reconcile leaves the claim Session
 *   (H-03) and writes nothing, as does a second start; `prepare` answers `unavailable` and pins no
 *   degraded brief; nothing changes; the Workflow waits and retries on the next advance, and binds the
 *   full brief once the store is readable. The `transient` variant: another process holds the Kernel
 *   store at the restart and at the prepare (support/brief.ts `lockKernelStore`): the same answers.
 *
 * Reaching the crash points: W-24 and W-05 stop between Workflow steps (W-05 with the Kernel store
 * moved aside during the start, support/common.ts `startWithKernelAside`, as A8-2a does); the Host has no
 * seam between RUN-02 and RUN-04, so W-02's authorization is committed by a composition root on the
 * same files that is cancelled right after the commit (support/common.ts `authorizeWithoutBegin`).
 * A8-2a/A8-1c (tests/scenarios/A8-host-restart-entry.test.ts) assert the reconcile side of W-05 → RUN-03;
 * here the same Run first passes W-24 and W-02, and the assertions are about the brief.
 *
 * The §11 invariants are checked after every step that changes records (the harness in `advance()`
 * and after every restart; owner writes outside the Workflow here). Scripted model replies only; no
 * real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  continuationBriefDigest, continuationBriefMarker, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { moveKernelAside, restoreKernel } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import { artifactCount, lockKernelStore, manifestOf, notesThenText } from './support/brief.js';
import {
  NOTES_FILE, NO_REDRIVE, authorizeWithoutBegin, briefOf, codeOf, editThenText, execution, performsAfterRequeues, preparedOf,
  selectedRun, sessionKey, sourceDigestOf, stepOf, turnStarts,
} from './support/common.js';

afterEach(cleanupScenarios);

const KERNEL_FILES = ['kernel.sqlite', 'kernel.sqlite-wal', 'kernel.sqlite-shm', 'kernel.sqlite-journal'];

/**
 * Run 1 FAILs, the Workflow requeues it automatically (`check_failed` #1) and claims the requeue in
 * Run 1's Session; stops before Run 2's `start`. Answers Run 2, its prepared value, the stored brief
 * and the TaskRequeue.
 */
async function requeuedRunPrepared(h: HostScenario, flowId: string) {
  const stopped = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID), { stopBefore: performsAfterRequeues(h, 'start', 1) });
  expect(stopped.state).toBe('stopped');
  const [requeue, ...more] = h.lastWorld?.requeues ?? [];
  if (requeue === undefined) throw new Error('the Workflow must have requeued Run 1');
  expect(more).toEqual([]);
  expect(requeue).toMatchObject({ failureClass: 'check_failed', automation: { automatic: true, autoCount: 1 } });
  const run2Ref = await selectedRun(h);
  const prepared = preparedOf(stopped.next);
  const digest = prepared.inputBinding.continuationBriefDigest;
  if (digest === undefined) throw new Error('a requeue Run prepares a continuation brief');
  const manifest = manifestOf(h.database, prepared.inputBinding.manifestDigest);
  const brief = manifest.continuationBrief;
  if (brief === undefined) throw new Error('the prepared manifest must carry the brief');
  // §6.1 (e): the brief names the new Run and its TaskRequeue; the digest pins it; it is in the input (PC-2 moves the reminders section after it).
  expect(brief).toMatchObject({ runRef: run2Ref, requeueRef: requeue.ref, mode: 'rework', failureClass: 'check_failed' });
  expect(continuationBriefDigest(brief)).toBe(digest);
  expect(manifest.input).toContain(`\n\n${renderContinuationBriefZh(brief, digest)}`);
  return { run2Ref, prepared, brief, digest, requeue };
}

/** Run 2 is still `Claimed`: nothing authorized, nothing bound. */
async function expectClaimed(h: HostScenario, run2Ref: Awaited<ReturnType<typeof selectedRun>>) {
  const record = await execution(h, run2Ref);
  expect(record.run).toMatchObject({ status: 'starting', startedAt: null, envelope: null });
  expect(record.run.executionAuthorization).toBeUndefined();
  expect(record.run.inputBinding).toBeUndefined();
  return record;
}

it('C3-R1 (W-24), W-02, W-05 → RUN-16 → RUN-03: one requeue Run passes every crash point before the Kernel and keeps one brief', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE,
    script: { replies: [...notesThenText('c3-idem'), ...editThenText('c3-idem-run2')] } });

  // 1. Run 1 FAILs; Run 2 is claimed and prepared: the manifest with the brief is stored, the Run does not reference it.
  const { run2Ref, prepared: p1, brief, digest } = await requeuedRunPrepared(h, 'c3-idem-1');
  const claimed = await expectClaimed(h, run2Ref);
  const artifacts = artifactCount(h.database);
  const kernelAfterRun1 = h.kernelSnapshot();
  const beforeCrash = h.counts();
  expect(beforeCrash).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  // 2. W-24 (C3-R1): the Host stops before RUN-02. The reconcile leaves Run 2 alone and writes nothing.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [], problems: [] } });
  expect(h.counts(), '§12.10 step 4: no Kernel Turn, model call, check or ledger write').toEqual(beforeCrash);
  expect((await execution(h, run2Ref)).run).toEqual(claimed.run);
  await h.restart({ crash: true });
  expect(h.counts(), 'another start on the same data writes nothing').toEqual(beforeCrash);

  // The Workflow prepares again: the workspace is unchanged, so it is the same manifest (the body put replays).
  const again = await h.advance(h.select('c3-idem-2', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(again.receipts.map(receipt => receipt.kind)).toEqual(['prepare']);
  const p2 = preparedOf(again.next);
  expect(p2.inputBinding, 'same brief digest, manifest digest and input digest').toEqual(p1.inputBinding);
  expect(p2.claim).toEqual(p1.claim);
  expect(p2.envelope.bundleRef).toEqual(p1.envelope.bundleRef);
  expect(artifactCount(h.database), 'the same content-addressed body: nothing new stored').toBe(artifacts);
  expect((await execution(h, run2Ref)).run, 'Run 2 is still Claimed').toEqual(claimed.run);

  // 3. W-02: the re-prepared value is authorized (RUN-02 binds the brief) and the Host stops before the begin.
  const authorized = await authorizeWithoutBegin(h, p2, 'c3-idem-w02-start');
  expect(codeOf(authorized.answer), JSON.stringify(authorized.answer)).toBe('cancelled');
  expect(authorized.modelCalls).toBe(0);
  const bound = await execution(h, run2Ref);
  expect(bound.run).toMatchObject({ status: 'starting', startedAt: null, envelope: p2.envelope, inputBinding: p2.inputBinding,
    executionAuthorization: { schemaVersion: 2, phase: 'authorized', generation: 1, consumerId: AG2B_CONSUMER_ID } });
  expect(bound.run.executionHistory).toBeUndefined();
  await assertInvariants(h, 'W-02: authorized, not begun', stepOf(h, 'entry_authorized', 'W-02: authorized, not begun'));
  expect(await briefOf(h.host, run2Ref)).toEqual({ brief, digest });
  const authorizations = (): number => h.ledgerEventTypes().filter(type => type === 'ExecutionEntryAuthorized').length;
  expect(authorizations(), 'Run 1 and Run 2 each authorized once').toBe(2);
  const authorizedCounts = h.counts();
  expect(authorizedCounts).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  const report2 = await h.restart({ crash: true });
  expect(report2.report).toMatchObject({ runs: [], problems: [] });
  expect(h.counts()).toEqual(authorizedCounts);
  expect((await execution(h, run2Ref)).run).toEqual(bound.run);
  // §12.10 step 4: another start on the same data writes nothing either.
  expect((await h.restart({ crash: true })).report).toMatchObject({ runs: [], problems: [] });
  expect(h.counts(), 'another start on the same data writes nothing').toEqual(authorizedCounts);
  expect((await execution(h, run2Ref)).run).toEqual(bound.run);

  // The workspace source changes after RUN-02: a prepare that assembled the brief again would capture another
  // source digest (case 2), so the equalities below show the bound brief is rebuilt, not re-assembled (I-19).
  await writeFile(join(h.root, 'src', 'c3-after-w02.txt'), 'C3: changed after W-02, before the re-drive\n');
  expect(await sourceDigestOf(h.root)).not.toBe(brief.workspace.checkpoints.at(-1)?.sourceDigest);

  // The Workflow re-drives the same claim; `prepare` rebuilds the bound value (no new brief, nothing stored).
  const rebuilt = await h.advance(h.select('c3-idem-3', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(rebuilt.receipts.map(receipt => receipt.kind)).toEqual(['prepare']);
  const p3 = preparedOf(rebuilt.next);
  expect(p3).toEqual({ kind: 'task', claim: bound.outbox.claim, envelope: bound.run.envelope, inputBinding: bound.run.inputBinding });
  expect(p3).toEqual(p2);
  expect(artifactCount(h.database)).toBe(artifacts);

  // 4. W-05: the begin commits and the Kernel is never reached (its store is aside during the start).
  const aside = await moveKernelAside(h.database);
  const entering = await h.advance(rebuilt.next!, { invariants: { label: 'c3-idem begin with the Kernel store aside' } });
  expect(entering.state, JSON.stringify(entering.steps.map(step => [step.state, step.reason]))).toBe('waiting');
  // An empty store a reader opened at the mapped path meanwhile is removed before the real one is put back.
  for (const name of KERNEL_FILES) await rm(join(h.database, name), { force: true });
  await restoreKernel(h.database, aside);
  expect(h.kernelSnapshot(), 'the real Kernel store is back unchanged').toEqual(kernelAfterRun1);
  expect((await execution(h, run2Ref)).run).toMatchObject({ executionAuthorization: { phase: 'entering', generation: 1 },
    inputBinding: p2.inputBinding });
  expect(authorizations(), 'W-02: the begin reused the persisted permit, no second authorization').toBe(2);

  // The crash: the Kernel holds no Turn of the fixed identity, so the reconcile revokes the entry (RUN-16).
  const report3 = await h.restart({ crash: true });
  expect(report3.report).toMatchObject({ runs: [{ ref: JSON.stringify(run2Ref), row: 'W-05', status: 'reconciled', reason: 'not_entered' }],
    problems: [] });
  const revoked = await execution(h, run2Ref);
  expect(revoked.run).toMatchObject({ executionAuthorization: { phase: 'revoked', generation: 1 }, envelope: p2.envelope,
    inputBinding: p2.inputBinding });
  expect(h.kernelSnapshot()).toEqual(kernelAfterRun1);
  // The source changes again after RUN-16: RUN-03 must still bind the brief RUN-02 bound.
  const sourceBeforeRun03 = await sourceDigestOf(h.root);
  await writeFile(join(h.root, 'src', 'c3-after-run16.txt'), 'C3: changed after RUN-16, before RUN-03\n');
  expect(await sourceDigestOf(h.root)).not.toBe(sourceBeforeRun03);

  // 5. RUN-03 re-authorizes the same input binding (generation 2); Run 2 enters with the brief and completes.
  const done = await h.advance(h.select('c3-idem-4', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  expect(done.receipts.find(receipt => receipt.kind === 'prepare')?.result, 'the prepare rebuilt the bound value')
    .toEqual({ status: 'ready', value: p2 });
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed', envelope: p2.envelope, inputBinding: p2.inputBinding,
    executionAuthorization: { schemaVersion: 2, generation: 2 } });
  expect(authorizations(), 'RUN-03: one re-authorization').toBe(3);
  expect(await briefOf(h.host, run2Ref), 'I-19: the brief bound at RUN-02 is the one Run 2 ran with').toEqual({ brief, digest });
  // The Kernel Turn of Run 2 started with that brief; PC-2 puts the reminders section after it.
  const run2Turns = turnStarts(h.database).filter(turn => turn.runId === ended.run.executionHistory?.kernel.runId);
  expect(run2Turns).toHaveLength(1);
  expect(run2Turns[0]!.content).toContain(`\n\n${renderContinuationBriefZh(brief, digest)}`);
  expect(JSON.stringify(h.modelRequests()[2]?.messages)).toContain(continuationBriefMarker(digest));
  expect(h.counts()).toMatchObject({ modelCalls: 4, kernelTurnsStarted: 2 });
  expect(h.lastWorld?.requeues, 'no further requeue').toHaveLength(1);
  expect(claimed.run.requeueRef).toEqual(ended.run.requeueRef);
  await h.drainAbandoned();
}, 180_000);

it('C3-R1 (W-24) with the source changed before the Workflow prepares again: the second prepare is another manifest whose brief differs only in the workspace facts; the Run was still Claimed, so it is the one authorized', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE,
    script: { replies: [...notesThenText('c3-moved'), ...editThenText('c3-moved-run2')] } });
  const { run2Ref, prepared: p1, brief: brief1, digest: digest1 } = await requeuedRunPrepared(h, 'c3-moved-1');
  const claimed = await expectClaimed(h, run2Ref);
  const before = await sourceDigestOf(h.root);
  expect(brief1.workspace.checkpoints.at(-1)).toMatchObject({ kind: 'brief', sourceDigest: before, unavailableReason: null });

  // W-24, then the workspace source changes before the Workflow prepares Run 2 again.
  await h.restart({ crash: true });
  await writeFile(join(h.root, 'src', 'c3-operator-note.txt'), 'C3: changed after the crash, before the next prepare\n');
  const after = await sourceDigestOf(h.root);
  expect(after).not.toBe(before);

  const again = await h.advance(h.select('c3-moved-2', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(again.receipts.map(receipt => receipt.kind)).toEqual(['prepare']);
  const p2 = preparedOf(again.next);
  const digest2 = p2.inputBinding.continuationBriefDigest;
  expect(digest2).toEqual(expect.any(String));
  expect(digest2).not.toBe(digest1);
  expect(p2.inputBinding.manifestDigest).not.toBe(p1.inputBinding.manifestDigest);
  const brief2 = manifestOf(h.database, p2.inputBinding.manifestDigest).continuationBrief as ContinuationBriefV1;
  // Only the workspace facts the prepare captures differ: the brief's own checkpoint and the comparison with it.
  expect({ ...brief2, workspace: null }).toEqual({ ...brief1, workspace: null });
  expect(brief2.workspace.checkpoints.slice(0, -1)).toEqual(brief1.workspace.checkpoints.slice(0, -1));
  expect(brief2.workspace.checkpoints.at(-1)).toMatchObject({ kind: 'brief', sourceDigest: after });
  expect(brief1.workspace.segments.at(-1)).toMatchObject({ verdict: 'unchanged' });
  expect(brief2.workspace.segments.at(-1)).toMatchObject({ verdict: 'changed' });
  // Two prepared values, nothing pinned: Run 2 is still Claimed.
  expect((await execution(h, run2Ref)).run).toEqual(claimed.run);

  // The Workflow starts the re-prepared value: RUN-02 binds it; Run 2 runs with it and completes.
  const done = await h.advance(again.next!);
  expect(done.state).toBe('completed');
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed', inputBinding: p2.inputBinding,
    executionAuthorization: { schemaVersion: 2, generation: 1 } });
  expect(await briefOf(h.host, run2Ref)).toEqual({ brief: brief2, digest: digest2 });
  const run2Input = JSON.stringify(h.modelRequests()[2]?.messages);
  expect(run2Input).toContain(continuationBriefMarker(digest2!));
  expect(run2Input).not.toContain(continuationBriefMarker(digest1));
  expect(h.counts()).toMatchObject({ modelCalls: 4, kernelTurnsStarted: 2 });
  await h.drainAbandoned();
}, 120_000);

it('C3-R2 (W-25): after a restart the facts Run\'s Kernel store is not registered (host_config): prepare answers unavailable, pins no degraded brief and changes nothing; the Workflow waits and retries, and binds the full brief once the store is readable', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE,
    script: { replies: [...notesThenText('c3-r2'), ...editThenText('c3-r2-run2')] } });
  // Run 1 FAILs; the automatic requeue is claimed; stop before Run 2's prepare.
  const toPrepare = await h.advance(h.select('c3-r2-1', AG2B_WORK_TASK_ID), { stopBefore: performsAfterRequeues(h, 'prepare', 1) });
  expect(toPrepare.state).toBe('stopped');
  const run2Ref = await selectedRun(h);
  const claimed = await expectClaimed(h, run2Ref);

  // The Host crashes and restarts without the Kernel Store registration: Run 1's Kernel read is `host_config`.
  // §12.10 steps 2–4: the reconcile leaves the claim Session (H-03) and Run 2 alone and writes nothing.
  const preRestart = h.counts();
  const restarted = await h.restart({ crash: true, noKernelStores: true });
  expect(restarted.report).toMatchObject({ sessions: [{ ref: sessionKey(claimed.session), row: 'H-03', status: 'left' }],
    runs: [], problems: [] });
  expect(h.counts(), '§12.10 step 4: no Kernel Turn, model call, check or ledger write').toEqual(preRestart);
  expect((await execution(h, run2Ref)).run).toEqual(claimed.run);
  // Another start on the same data (still without the registration) writes nothing either.
  const again = await h.restart({ crash: true });
  expect(again.report).toMatchObject({ sessions: [{ ref: sessionKey(claimed.session), row: 'H-03', status: 'left' }],
    runs: [], problems: [] });
  expect(h.counts(), 'another start on the same data writes nothing').toEqual(preRestart);
  expect((await execution(h, run2Ref)).run).toEqual(claimed.run);
  const before = h.counts();
  const artifacts = artifactCount(h.database);
  for (const flowId of ['c3-r2-2', 'c3-r2-3']) {
    // Every advance retries the prepare; it answers `unavailable` (SD-2: no evidence), stores no manifest, writes nothing.
    const waiting = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID));
    expect(waiting.state, flowId).toBe('waiting');
    expect(waiting.receipts, flowId).toMatchObject([{ kind: 'prepare', result: { status: 'rejected', code: 'unavailable' } }]);
    expect(waiting.reason, flowId).toMatch(/the previous Turn is not readable now/);
    expect((await execution(h, run2Ref)).run, `${flowId}: Run 2 is unchanged (Claimed)`).toEqual(claimed.run);
    expect(h.counts(), flowId).toEqual(before);
    expect(artifactCount(h.database), `${flowId}: no degraded brief is stored`).toBe(artifacts);
  }
  expect(await h.answer('executions/brief', plain(AG2B_SCOPE, { runRef: run2Ref })), 'nothing is bound').toMatchObject({
    status: 'rejected', code: 'incomplete', reason: 'the requeue Run has not bound its continuation brief yet' });

  // The store is registered again: the next advance prepares the full brief and Run 2 completes.
  await h.restart({ noKernelStores: false });
  const done = await h.advance(h.select('c3-r2-4', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  const bound = await briefOf(h.host, run2Ref);
  if (bound === null) throw new Error('Run 2 must bind its brief');
  expect(bound.brief.stoppedAt).toMatchObject({ kernel: 'read', turnStatus: 'completed', reason: null });
  expect(bound.brief.toolCalls.confirmed).toMatchObject([{ callId: 'c3-r2-notes', name: 'edit', result: 'success' }]);
  expect(bound.brief.workspace.selfChanged).toMatchObject({ status: 'known', confirmed: [NOTES_FILE] });
  expect((await execution(h, run2Ref)).run).toMatchObject({ status: 'ended', outcome: 'completed',
    inputBinding: { continuationBriefDigest: bound.digest } });
  expect(h.counts()).toMatchObject({ modelCalls: 4, kernelTurnsStarted: 2 });
  await h.drainAbandoned();
}, 120_000);

it('C3-R2 (W-25) with a transient Kernel read: the Kernel store is held by another process at the restart and at the prepare; the probe proves nothing (H-03), prepare answers unavailable, pins no degraded brief and changes nothing; once the store is free the next advance binds the full brief', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE,
    script: { replies: [...notesThenText('c3-r2t'), ...editThenText('c3-r2t-run2')] } });
  const toPrepare = await h.advance(h.select('c3-r2t-1', AG2B_WORK_TASK_ID), { stopBefore: performsAfterRequeues(h, 'prepare', 1) });
  expect(toPrepare.state).toBe('stopped');
  const run2Ref = await selectedRun(h);
  const claimed = await expectClaimed(h, run2Ref);
  const artifacts = artifactCount(h.database);
  const events = h.ledgerEventTypes().length;

  // Another process holds the Kernel store (support/brief.ts `lockKernelStore`): a transient condition, no evidence (SD-2).
  const kernelHeld = lockKernelStore(h.database);
  try {
    // The crash; the reconcile's probe of the claim Session is not `ready` and proves nothing: H-03, left, nothing written.
    const restarted = await h.restart({ crash: true });
    expect(restarted.report).toMatchObject({ sessions: [{ ref: sessionKey(claimed.session), row: 'H-03', status: 'left' }],
      runs: [], problems: [] });
    expect(h.ledgerEventTypes(), 'the reconcile writes nothing').toHaveLength(events);
    for (const flowId of ['c3-r2t-2', 'c3-r2t-3']) {
      // W-25: `prepare` cannot read the facts Run's Turn now: unavailable, no manifest stored, the Run unchanged.
      const waiting = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID));
      expect(waiting.state, flowId).toBe('waiting');
      expect(waiting.receipts, flowId).toMatchObject([{ kind: 'prepare', result: { status: 'rejected', code: 'unavailable' } }]);
      expect(waiting.reason, flowId).toMatch(/the previous Turn is not readable now: .*database is locked/);
      expect((await execution(h, run2Ref)).run, `${flowId}: Run 2 is unchanged (Claimed)`).toEqual(claimed.run);
      expect(h.ledgerEventTypes(), `${flowId}: nothing is written`).toHaveLength(events);
      expect(artifactCount(h.database), `${flowId}: no degraded brief is stored`).toBe(artifacts);
    }
    expect(h.modelCalls(), 'only Run 1 called the model').toBe(2);
  } finally {
    kernelHeld.release();
  }

  // The store is free: the next advance prepares the full brief and Run 2 completes with it.
  const done = await h.advance(h.select('c3-r2t-4', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  const bound = await briefOf(h.host, run2Ref);
  if (bound === null) throw new Error('Run 2 must bind its brief');
  expect(bound.brief.stoppedAt).toMatchObject({ kernel: 'read', turnStatus: 'completed', reason: null });
  expect(bound.brief.toolCalls.confirmed).toMatchObject([{ callId: 'c3-r2t-notes', name: 'edit', result: 'success' }]);
  expect(bound.brief.workspace.selfChanged).toMatchObject({ status: 'known', confirmed: [NOTES_FILE] });
  expect((await execution(h, run2Ref)).run).toMatchObject({ status: 'ended', outcome: 'completed',
    inputBinding: { continuationBriefDigest: bound.digest } });
  expect(h.counts()).toMatchObject({ modelCalls: 4, kernelTurnsStarted: 2 });
  await h.drainAbandoned();
}, 120_000);
