/**
 * K3-29 row 13 (L29; D9; L21 ruling 4): a crash between the two steps of
 * release-hold on a human-stopped original Run.
 *
 * The worker is paused at its safe point; the Kernel is lost with the Host and
 * the next Host reconciles the Run `outcome_unknown`, so a person attests it
 * (RUN-22 creates the record) and directly holds it. The "continue" route is
 * modelled at its crash boundary by pausing the Goal: `releaseHold` commits but
 * the same operator's human requeue is refused, leaving the record `released`
 * and the Task at AV-4 with no TaskRequeue. Resuming the Goal and using
 * `tasks/requeue` then connects exactly one continuation.
 *
 * The setup is the business K3-41 (二)(三) one; this row adds the other public
 * "continue" entry (`tasks/requeue`) and the one-continuation count.
 */
import { afterEach, expect, it } from 'vitest';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, graphWrite, plain, startAG2bHost, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import {
  goalControlPins, moveKernelAside, post, publicDirectory, readExecution, restoreKernel, selectWork, tempDir, workRow,
} from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, type InvariantTarget } from './harness.js';
import { driveChecked, operatorRequeue, pausedRunOnClosedHostChecked, textReply } from './support/common.js';
import { expectQuietRestart } from './support/restart.js';

afterEach(cleanupScenarios);

async function readReview(host: AG2bHost, runRef: TaskExecutionRecord['run']['ref']): Promise<UnknownCallReviewV1> {
  const read = await post<ReadResult<UnknownCallReviewV1>>(host, 'unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready') throw new Error(`the review record must read: ${JSON.stringify(read)}`);
  return read.value;
}

/** The K3-41 setup: a human-stopped Run attested unknown, then directly held. */
async function pausedAttestedAndHeld(label: string): Promise<{
  host: AG2bHost; runRef: TaskExecutionRecord['run']['ref']; held: UnknownCallReviewV1; inv: InvariantTarget;
  root: string; database: string; publicDir: string;
}> {
  const root = await tempDir(`k3-29r13-${label}-ws-`);
  const database = await tempDir(`k3-29r13-${label}-db-`);
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  const aside = await moveKernelAside(database);
  const second = await startAG2bHost(publicDir, { root, database });
  let held: UnknownCallReviewV1;
  try {
    const unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      controlState: { desiredState: 'paused' } });
    const attested = await post<WriteResult<RunSnapshot>>(second, 'executions/resolve-unknown',
      graphWrite(AG2B_SCOPE, { runRef, reason: 'the person checked the stopped work by hand' }, `k3-29r13-attest-${label}`,
        [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed',
      value: { status: 'ended', outcome: 'crashed', reconciliation: { observation: { kind: 'human_attested' } } } });
    const record = await readReview(second, runRef);
    expect(record).toMatchObject({ status: 'needs_decision' });
    const applied = await post<WriteResult<UnknownCallReviewV1>>(second, 'unknown-call-reviews/hold',
      graphWrite(AG2B_SCOPE, { reviewRef: record.ref, text: null }, `k3-29r13-hold-${label}`,
        [{ ref: record.ref, revision: record.revision }]));
    if (applied.status !== 'committed') throw new Error(`the direct hold must commit: ${JSON.stringify(applied)}`);
    held = applied.value;
    expect(held).toMatchObject({ status: 'resolved', disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });
  } finally {
    await second.host.close();
  }
  await restoreKernel(database, aside);
  const host = await startAG2bHost(publicDir, { root, database,
    replies: [textReply(`K3-29 row 13 ${label}: the continuation ran`)] });
  return { host, runRef, held, inv, root, database, publicDir };
}

it('K3-29 row 13: a crash between releaseHold and the human requeue leaves released with no TaskRequeue; tasks/requeue then connects exactly one continuation', async () => {
  const { host: opened, runRef, held, inv, root, database, publicDir } = await pausedAttestedAndHeld('a');
  let host = opened;
  try {
    // The crash window: the Goal is paused, so `releaseHold` commits and the
    // human requeue is refused. This is the L29 row 13 durable state.
    const paused = await post<WriteResult<unknown>>(host, 'goals/control', graphWrite(AG2B_SCOPE,
      { goalRef: AG2B_GOAL_REF, control: 'pause', reason: 'hold the continuation for the crash window' },
      'k3-29r13-goal-pause', await goalControlPins(host)));
    expect(paused).toMatchObject({ status: 'committed' });
    const first = await post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(host,
      'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: held.ref }, 'k3-29r13-release',
        [{ ref: held.ref, revision: held.revision }]));
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', value: { status: 'resolved', activeRound: null, disposition: { hold: 'released' } } },
      requeue: { status: 'rejected', code: 'busy' } } });
    expect(await readReview(host, runRef)).toMatchObject({ status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', hold: 'released' } });
    expect((await readExecution(host, runRef)).run).toMatchObject({ status: 'ended' });
    expect((await workRow(host)).execution?.runId).toBe(runRef.runId);

    // A Host restart lands between the two steps: the durable state is the
    // record `released`, the paused Goal and no TaskRequeue; the next Host
    // continues from it.
    await host.host.close();
    host = await startAG2bHost(publicDir, { root, database,
      replies: [textReply('K3-29 row 13 a: the continuation ran')] });
    expect(await readReview(host, runRef)).toMatchObject({ status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', hold: 'released' } });

    // Resume the Goal and use the OTHER public "continue" entry: `tasks/requeue`.
    const resumed = await post<WriteResult<unknown>>(host, 'goals/control', graphWrite(AG2B_SCOPE,
      { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'resume for the continue click' },
      'k3-29r13-goal-resume', await goalControlPins(host)));
    expect(resumed).toMatchObject({ status: 'committed' });
    const continued = await operatorRequeue(host, runRef, 'k3-29r13-requeue', 'continue after the review hold was released');
    expect(continued, JSON.stringify(continued)).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });

    const continuation = await driveChecked(host, inv, selectWork('k3-29r13-continue', true), { stopBefore: 'open_checks' });
    expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null,
      'the drive stops after the one continuation Run').toBe('open_checks');
    const row = await workRow(host);
    expect(row.execution).not.toBeNull();
    expect(row.execution?.runId).not.toBe(runRef.runId);
    // One continuation Run: the original Run stays the single ended Run.
    expect((await readExecution(host, runRef)).run.status).toBe('ended');
  } finally {
    await host.host.close();
  }
  await expectQuietRestart(database, publicDir, root, { label: 'K3-29 row 13: a final restart' });
}, 300_000);
