/**
 * A.2 step 5.9 part 1 through the real Host over HTTP (docs/refactor/STATE-MACHINES-SPEC.md
 * §9 VR-14/VR-15, VD-12, VD-13; §4 TASK-28 (reverify refusal), TASK-29; §15.2 5.9
 * `verification/reverify` 路由). No real model: the scripted model answers once.
 *
 * Run 1 answers with text only, so the registered check (the result file must
 * exist with the expected text) fails and the round finalizes FAIL; the Host
 * stops the Workflow before its automatic `requeue_task` (C8, 5.8). The
 * operator asks "重新检查" over `verification/reverify`, with the predecessor
 * pin read from the Task row (`failure.round.{roundRef, revision}`, TD-8):
 * - with `onlyIfSourceChanged` while nothing changed: a committed `refused`
 *   value (`source_unchanged`, TaskReworkRefusal@1, not an HTTP error), which
 *   the Task row shows as its last reverify refusal;
 * - after the operator writes the result file, with the refusal pin @1: the
 *   successor round (ordinal 2, `human`, `sourceChanged`), the Task row
 *   `verifying` on it (TASK-29), and the Workflow runs its check on the same
 *   Run, completes the Task and the Goal — no second model call (VD-12: a
 *   successor round builds no Attempt or Run).
 * A stale predecessor is an HTTP refusal with the head pin; a malformed body
 * is `invalid`, never a Host failure.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { ReverifyOutcomeV1 } from '../../src/core/work-graph/model/evidence-contracts.js';
import {
  AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, cleanupAG2b, corePost, graphWrite,
  seedAG2bWorkGraph, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  cleanupRestart, driveWorkflow, post, publicDirectory, selectWork, workRow,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

function refusalPin(round: RoundSnapshot, revision: number) {
  return { ref: { aggregateType: 'TaskReworkRefusal', projectId: round.ref.projectId, goalId: round.ref.goalId,
    taskId: round.ref.taskId, operation: 'reverify', subjectId: round.ref.roundId }, revision };
}

it('verification/reverify: a FAIL head is refused source_unchanged, then after the fix its successor completes the Goal', async () => {
  const publicDir = await publicDirectory();
  const host = await startAG2bHost(publicDir, { replies: [{ kind: 'text', text: 'A2 reverify: an answer without the file' }] });
  try {
    await seedAG2bWorkGraph(host);
    // Run 1 ends with text only; the registered check fails; the Host stops before the automatic requeue.
    const firstReceipts: WorkflowStepReceipt[] = [];
    const firstSteps = await driveWorkflow(host, selectWork('a2-reverify-route-1'),
      { stopBefore: 'requeue_task', receipts: firstReceipts });
    const first = { state: firstSteps.at(-1)!.next === null ? firstSteps.at(-1)!.state : 'stopped', receipts: firstReceipts };
    expect(first.state).toBe('stopped');
    const finalize = first.receipts.find(receipt => receipt.kind === 'finalize_checks');
    if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the round must finalize');
    const r1 = finalize.result.value.snapshot;
    expect(r1).toMatchObject({ status: 'finalized', outcome: 'FAIL', chain: { ordinal: 1 } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' },
      failure: { round: { roundRef: r1.ref, revision: r1.revision, ordinal: 1 }, reverifyActors: ['human', 'system', 'agent'] } });
    // The button builds its predecessor pin from the read model alone (TD-8 `round.{roundRef, revision}`).
    const head = (await workRow(host)).failure as { round: { roundRef: RoundSnapshot['ref']; revision: number } };
    const headPin = { ref: head.round.roundRef, revision: head.round.revision };

    // "重新检查" with the gate-fix condition while nothing changed: a committed refusal value.
    const unchanged = await post<WriteResult<ReverifyOutcomeV1>>(host, 'verification/reverify', graphWrite(AG2B_SCOPE,
      { predecessorRoundRef: head.round.roundRef, onlyIfSourceChanged: true }, 'a2-reverify-unchanged', [headPin]));
    expect(unchanged).toMatchObject({ status: 'committed', replayed: false, value: { kind: 'refused', refusal: { revision: 1,
      code: 'source_unchanged', requestedBy: { kind: 'human' }, subjectRoundRef: r1.ref, failureClass: 'check_failed' } } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed', failure: { automation: {
      lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: false } } } });

    // The operator fixes the work by hand, then asks again with the refusal pin.
    await writeFile(join(host.root, AG2B_RESULT_FILE), AG2B_RESULT_TEXT);
    const reverified = await post<WriteResult<ReverifyOutcomeV1>>(host, 'verification/reverify', graphWrite(AG2B_SCOPE,
      { predecessorRoundRef: head.round.roundRef, onlyIfSourceChanged: true, reason: 'the result file is written now' },
      'a2-reverify-fixed', [headPin, refusalPin(r1, 1)]));
    if (reverified.status !== 'committed' || reverified.value.kind !== 'reverified') {
      throw new Error(`the reverify must open the successor: ${JSON.stringify(reverified)}`);
    }
    const r2 = reverified.value.round;
    expect(r2).toMatchObject({ status: 'open', subjectRunRef: r1.subjectRunRef, chain: { ordinal: 2, predecessorRoundRef: r1.ref,
      reverify: { actorClass: 'human', failureClass: 'check_failed', sourceChanged: true, reason: 'the result file is written now' } } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: r1.ref } } });

    // The old head is no longer the head: an HTTP refusal naming the successor.
    const stale = await corePost(host.base, 'verification/reverify', host.token, graphWrite(AG2B_SCOPE,
      { predecessorRoundRef: r1.ref }, 'a2-reverify-stale', [{ ref: r1.ref, revision: r1.revision }]));
    expect(stale.status).not.toBe(200);
    expect(await stale.json()).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      current: [{ ref: r2.ref, revision: 1 }] });
    // A malformed body is `invalid`, never a Host failure.
    for (const input of [{}, { predecessorRoundRef: 'not-a-round' }, { predecessorRoundRef: r2.ref, extra: true }]) {
      const response = await corePost(host.base, 'verification/reverify', host.token,
        graphWrite(AG2B_SCOPE, input, `a2-reverify-bad-${JSON.stringify(input).length}`, [{ ref: r2.ref, revision: 1 }]));
      expect(response.status, JSON.stringify(input)).not.toBe(500);
      expect(await response.json(), JSON.stringify(input)).toMatchObject({ status: 'rejected', code: 'invalid' });
    }

    // The Workflow runs the successor's check on the same Run and completes the Task and the Goal.
    const secondReceipts: WorkflowStepReceipt[] = [];
    const secondSteps = await driveWorkflow(host, selectWork('a2-reverify-route-2'),
      { stopBefore: 'requeue_task', receipts: secondReceipts });
    const second = { state: secondSteps.at(-1)!.state, receipts: secondReceipts };
    expect(second.state).toBe('completed');
    expect(second.receipts.find(receipt => receipt.kind === 'finalize_checks')).toMatchObject({
      result: { status: 'committed', value: { outcome: 'PASS', snapshot: { ref: r2.ref } } } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'satisfied' });
    expect(host.scripted.calls()).toBe(1);
  } finally {
    await host.host.close();
  }
}, 90_000);
