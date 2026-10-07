/**
 * A.2 step 6: scenario C5-gate-fix-open (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C5-gate-fix-open.test.ts`; §9 VD-8, VD-11, VD-15, VR-14; §4 P20, the GV table
 * (GV-3′, GV-5, GV-10); §11 invariants after every step).
 *
 * On the shared harness (AG2b seed, platform mode, a real ProcessSandbox for the registered check):
 * the work passes; its result is lost before the gate's root round captures the workspace; the gate
 * round opens and its check is still pending when an operator adopts a required fix Task. The
 * Workflow runs the fix first (required work before the gate); the fix Run writes the result again
 * and its own round passes. Only then does the gate's pending check begin: the source is no longer
 * the frozen one, so the begin is refused `frozen_source_changed` (VD-8, no process), the round
 * finalizes INCONCLUSIVE, and GV-10 re-verifies it with no source condition (`check_incomplete`) on
 * the anchored producer. The successor passes and the Goal completes. No model call beyond the fix
 * Run's: a re-verification builds no Run.
 */
import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_GATE_TASK_ID, AG2B_RESULT_FILE, AG2B_RESULT_TEXT } from '../helpers/AG2b-collaboration-fixture.js';
import { assertInvariants, cleanupScenarios, openPlatformScenario } from './harness.js';
import { createFileReplies } from './support/common.js';
import { adoptFixTaskOn, finalizedRound, finalizeOutcomesOfTask, performedSteps, performsOn } from './support/gate.js';

afterEach(cleanupScenarios);

const GATE = AG2B_GATE_TASK_ID;
const FIX = 'ag2b-fix';

it('C5 gate fix while the gate round is open: the fix runs first, the pending gate check ends frozen_source_changed, the round finalizes INCONCLUSIVE, the gate is re-verified with no source condition and the Goal completes, with no model call beyond the fix Run', async () => {
  const h = await openPlatformScenario({ script: { replies: [...createFileReplies('c5-open-work', AG2B_RESULT_FILE, AG2B_RESULT_TEXT),
    ...createFileReplies('c5-open-fix', AG2B_RESULT_FILE, AG2B_RESULT_TEXT)] } });
  await assertInvariants(h, 'seeded');

  // The work passes; its result is lost before the gate's root round captures the workspace.
  const toGate = await h.advance(h.select('c5-open'), { stopBefore: performsOn('open_checks') });
  if (toGate.next === null) throw new Error('the Workflow must reach the gate open');
  const work = await h.taskRow();
  expect(work).toMatchObject({ effectivePhase: 'satisfied' });
  await rm(join(h.root, AG2B_RESULT_FILE));
  // The gate's root round opens on the work's Run (VD-15) and freezes the broken source; its check is still pending.
  const toGateCheck = await h.advance(toGate.next, { stopBefore: performsOn('run_check') });
  expect(toGateCheck.state).toBe('stopped');
  const opened = performedSteps(toGate.next, toGateCheck).find(step => step.operation.kind === 'open_checks');
  if (opened?.receipt.kind !== 'open_checks' || opened.receipt.result.status !== 'committed') throw new Error('the gate round must open');
  const r1 = opened.receipt.result.value;
  expect(r1).toMatchObject({ status: 'open', subject: { taskId: GATE }, subjectRunRef: work.execution, chain: { ordinal: 1 },
    checks: [{ checkId: 'ag2b-static', phase: 'pending' }] });
  expect(await h.taskRow(GATE)).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running', detail: { gate: true, ordinal: 1 } } });

  // The operator adds a required fix Task while the gate's check is pending (no report exists yet).
  await adoptFixTaskOn(h, { fixId: FIX, checkId: 'ag2b-static', sources: [], label: 'c5-open-fix' });
  // GV-3′: an open gate head with a pending check is not re-verified.
  expect(await h.taskRow(GATE)).toMatchObject({ effectivePhase: 'verifying', failure: { automation: { verdict: { kind: 'none' } } } });
  const callsBeforeFix = h.modelCalls();
  const checksBeforeFix = h.counts().checksBegun;

  // The Workflow runs the fix first: its claim, its Run (which writes the result again) and its own PASS round all come
  // before any gate step; then the gate's pending check meets the changed source.
  const second = h.select('c5-open-2');
  const toReverify = await h.advance(second, { stopBefore: performsOn('reverify_round') });
  if (toReverify.next === null || toReverify.next.kind !== 'perform' || toReverify.next.operation.kind !== 'reverify_round') {
    throw new Error('the Workflow must reach the gate re-verification');
  }
  const steps = performedSteps(second, toReverify);
  const fixClaim = steps.findIndex(step => step.task === FIX && step.operation.kind === 'claim_task');
  const firstGateStep = steps.findIndex(step => step.task === GATE);
  expect(fixClaim).toBeGreaterThanOrEqual(0);
  expect(firstGateStep).toBeGreaterThan(steps.findIndex(step => step.task === FIX && step.operation.kind === 'complete_task'));
  expect(finalizeOutcomesOfTask(steps, FIX)).toEqual(['PASS']);
  expect(await h.taskRow(FIX)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(h.modelCalls() - callsBeforeFix, 'the fix Run made its two scripted calls').toBe(2);
  // VD-8: the begin compares the source with the frozen one and refuses with the marker; no process starts (only the
  // fix round's check began), and the Workflow finalizes the round instead of retrying the check.
  const gateSteps = steps.filter(step => step.task === GATE);
  expect(gateSteps.map(step => step.operation.kind)).toEqual(['run_check', 'finalize_checks']);
  expect(gateSteps[0]!.receipt).toMatchObject({ kind: 'run_check', result: { status: 'rejected', code: 'source_stale',
    reason: expect.stringMatching(/^frozen_source_changed: /) } });
  expect(h.counts().checksBegun - checksBeforeFix, 'only the fix round\'s check began').toBe(1);
  expect(finalizedRound(gateSteps[1])).toMatchObject({ ref: r1.ref, status: 'finalized', outcome: 'INCONCLUSIVE',
    gaps: [{ code: 'pending_check' }, { code: 'source_changed' }] });
  // GV-10: an INCONCLUSIVE gate head is re-verified with no source condition, class check_incomplete.
  expect(await h.taskRow(GATE)).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'round_inconclusive', detail: { gate: true, ordinal: 1 } },
    failure: { subjectKind: 'gate', failureClass: 'check_incomplete', automation: { verdict: { kind: 'reverify', roundRef: r1.ref,
      needsFinalize: false, onlyIfSourceChanged: false, failureClass: 'check_incomplete' } } } });
  const request = toReverify.next.operation.request;
  expect(request.input).toMatchObject({ predecessorRoundRef: r1.ref, reason: 'auto-reverify:check_incomplete#1' });
  expect(request.input.onlyIfSourceChanged ?? false, 'GV-10 sets no source condition').toBe(false);

  // The successor round on the anchored producer passes; the gate and the Goal complete.
  const done = await h.advance(toReverify.next);
  expect(done.state).toBe('completed');
  const doneSteps = performedSteps(toReverify.next, done);
  const reverified = doneSteps[0]?.receipt;
  if (reverified?.kind !== 'reverify_round' || reverified.result.status !== 'committed' || reverified.result.value.kind !== 'reverified') {
    throw new Error(`the gate must be re-verified: ${JSON.stringify(reverified)}`);
  }
  const r2 = reverified.result.value.round;
  expect(r2).toMatchObject({ subject: { taskId: GATE }, subjectRunRef: work.execution, chain: { ordinal: 2, predecessorRoundRef: r1.ref,
    autoCount: 1, reverify: { actorClass: 'system', requestedBy: WORKFLOW_AUTOMATION_ACTOR, failureClass: 'check_incomplete',
      exemption: 'none', sourceChanged: true, reason: 'auto-reverify:check_incomplete#1' } } });
  expect(finalizeOutcomesOfTask(doneSteps, GATE)).toEqual(['PASS']);
  expect(doneSteps.find(step => step.task === GATE && step.receipt.kind === 'complete_task')?.receipt).toMatchObject({
    result: { status: 'committed', value: { phase: 'satisfied', completion: { roundRef: r2.ref } } } });
  expect(await h.taskRow(GATE)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  // No model call beyond the fix Run: two Runs in all (the work and the fix), and the re-verification called nothing.
  expect(h.modelCalls() - callsBeforeFix).toBe(2);
  expect(h.lastWorld?.runs).toHaveLength(2);
  await assertInvariants(h, 'end');
}, 180_000);
