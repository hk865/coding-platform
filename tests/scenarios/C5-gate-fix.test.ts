/**
 * A.2 step 6: scenario C5-gate-fix (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C5-gate-fix.test.ts`; §9 VD-5, VD-11, VD-15, VR-14/15; §4 P20, TASK-15, TASK-30,
 * the GV table; §2 GOAL-27, GOAL-30; §13.7 points 5, 8 and 9; §11 I-17, I-18, I-20 after every step).
 *
 * 1. The main path, moved from tests/composition/A2-gate-reverify-platform.test.ts (it is this
 *    scenario on the composition root, STEP5-FLIPS §13 5.9 part 2 (j); its assertions are kept as
 *    they were, its fixture is tests/scenarios/support/gate.ts `gateCase`). The work passes, the
 *    workspace breaks before the gate's root round captures it, the gate check FAILs; GV-9 tries one
 *    `reverify_round{onlyIfSourceChanged}`, the owner commits `source_unchanged`, GV-8 stops the gate
 *    as `gate_needs_fix` and the Goal is NEEDS_DECISION with the failing check; an operator adopts a
 *    required fix Task (W16) carrying the gate's obligation with the round's report in
 *    `PlanChangeReason.sources`; the fix Task runs (a first claim: no continuation brief), repairs
 *    the file and passes; its Run's end makes the refusal stale; the gate is re-verified
 *    (`sourceChanged`, `check_failed`) on the anchored producer, passes, and the Goal completes. Step 6
 *    adds: the invariants after every step, the adopted reason's sources, the first-claim facts, the
 *    stale refusal and the retry's new refusal pin, the old report's body, and the completion's
 *    exclusion of the first round's FAIL evidence.
 * 2. The control (row: "修复没修好时"), on the shared harness (AG2b seed, platform mode): the fix Runs
 *    change nothing, so the fix Task's own rounds FAIL; the Workflow reworks the fix Task, not the
 *    gate (GV-5 before GV-8/GV-9 even though each fix Run's end makes the gate's refusal stale), until
 *    the fix Task's second requeue is refused `no_new_basis`; the Goal's NEEDS_DECISION reason is the
 *    fix Task's stop.
 *
 * Scripted model replies only; a real ProcessSandbox runs the registered checks.
 */
import { afterEach, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_GATE_TASK_ID, AG2B_RESULT_FILE, AG2B_RESULT_TEXT } from '../helpers/AG2b-collaboration-fixture.js';
import { assertInvariants, cleanupScenarios, openPlatformScenario } from './harness.js';
import { createFileReplies, textReply } from './support/common.js';
import {
  adoptFixTaskOn, checkInvariants, cleanupCases, finalizedRound, finalizeOutcomesOfTask, gateCase, performedSteps, performsOn,
} from './support/gate.js';

afterEach(cleanupCases);
afterEach(cleanupScenarios);

it('C5 gate fix (§15.2 5.9, GV-8/GV-9, P20, TASK-15): a FAILed gate stops as gate_needs_fix, a fix Task repairs it, and the automatic re-verification completes the Goal', async () => {
  const { openEnvironment, drive, select, isGateStep, taskRow, goalDisplay, adoptFixTask, ctx, GATE, CHECK_ID, MARKER, hostActor } = gateCase;
  const { platform, scripted, workspaceRoot } = await openEnvironment(async (index, root) => {
    // Model call 1 is the fix Task's Run: it repairs the file the gate check reads.
    if (index === 1) await writeFile(join(root, 'source.txt'), `${MARKER}: repaired by the fix Task\n`);
  });

  // The work passes and completes; the gate's root is about to open on its Run.
  const toGate = await drive(platform, select('a2-gate-flow'), isGateStep('open_checks'));
  if (toGate.stopped === null) throw new Error('the Workflow must reach the gate open');
  const work1 = await taskRow(platform, 'work-1');
  expect(work1).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'pending' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'awaiting_gate', gateTaskId: GATE }]) });
  // The workspace breaks before the gate round captures it, so the gate check FAILs.
  await writeFile(join(workspaceRoot, 'source.txt'), 'the delivered work, broken later\n');
  const failed = await drive(platform, toGate.stopped);

  // GV-9 → one automatic re-verification with onlyIfSourceChanged; the source did not change: source_unchanged.
  const finalize = failed.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the gate round must finalize');
  expect(finalize.result.value.outcome).toBe('FAIL');
  const r1 = finalize.result.value.snapshot;
  const firstReverify = failed.receipts.find(receipt => receipt.kind === 'reverify_round');
  expect(firstReverify).toMatchObject({ kind: 'reverify_round', result: { status: 'committed', value: { kind: 'refused',
    refusal: { revision: 1, code: 'source_unchanged', failureClass: 'check_failed', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      configurationRevision: null, goalEndedRunsAtRefusal: 1 } } } });
  // GV-8: the Workflow stops on the gate with the stop reason as its code.
  expect(failed).toMatchObject({ state: 'waiting' });
  expect(failed.reason).toMatch(/^gate_needs_fix: the goal gate goal-gate /);
  const reportRef = r1.checks[0]!.reportRef;
  expect(reportRef).not.toBeNull();
  const failingChecks = [{ checkId: CHECK_ID, phase: 'finished', outcome: 'FAIL', cause: null, reportRef }];
  // P20 and the gate's TaskRow.failure come from its own chain head, anchored on work-1's Run.
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'failed',
    phaseCause: { code: 'check_failed', detail: { gate: true, ordinal: 1, checkIds: [CHECK_ID] } },
    failure: { subjectKind: 'gate', runRef: work1.execution, failureClass: 'check_failed', notReworkableCause: null,
      round: { roundRef: r1.ref, revision: r1.revision, status: 'finalized', outcome: 'FAIL', ordinal: 1, autoCount: 0, failingChecks },
      requeueActors: [], reverifyActors: ['human', 'system', 'agent'],
      automation: { lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: false },
        verdict: { kind: 'stopped', reason: 'gate_needs_fix', detail: { operation: 'reverify', failingChecks } } } } });
  // GOAL-30: nothing automatic is left, so the Goal needs a decision, naming the failing check and its report.
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'gate_needs_fix', taskId: GATE, detail: { operation: 'reverify', failingChecks } } });

  // An operator adds a required fix Task (W16) with the gate round's report as a source: GV-5.
  const fix = await adoptFixTask(platform, reportRef);
  // (step 6) The adopted change carries the report in PlanChangeReason.sources (the UI action "添加修复任务"),
  // and the fix Task carries the gate's obligation.
  expect(await platform.plans.readPlanProposal(ctx(), fix.proposalRef)).toMatchObject({ status: 'ready',
    value: { status: 'accepted', reason: { text: `Fix the failed gate check ${CHECK_ID}`, sources: [reportRef] } } });
  expect(fix.plan.obligations).toMatchObject([{ taskIds: ['work-1', GATE, 'fix-1'] }]);
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'failed',
    failure: { automation: { verdict: { kind: 'none' } } } });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'gate_fix_in_progress', gateTaskId: GATE, failingChecks }]) });

  // (step 6) Required work runs before the gate: the fix Task's first claim, its Run (which repairs the file) and
  // its own PASS round. The Workflow stops before the gate's re-verification.
  const toReverify = await drive(platform, select('a2-gate-flow-2'), isGateStep('reverify_round'));
  if (toReverify.stopped === null || toReverify.stopped.operation.kind !== 'reverify_round') {
    throw new Error('the Workflow must reach the gate re-verification');
  }
  expect(toReverify.receipts.flatMap(receipt => receipt.kind === 'finalize_checks' && receipt.result.status === 'committed'
    ? [[receipt.result.value.snapshot.ref.taskId, receipt.result.value.outcome]] : [])).toEqual([['fix-1', 'PASS']]);
  const fixRow = await taskRow(platform, 'fix-1');
  expect(fixRow).toMatchObject({ effectivePhase: 'satisfied' });
  if (fixRow.execution === null) throw new Error('the fix Task must have its Run');
  // A first claim, not a requeue: no TaskRequeue, so no continuation brief (C3 binds only requeued Runs).
  const fixRun = await platform.executions.readExecution(ctx(), fixRow.execution);
  if (fixRun.status !== 'ready') throw new Error('the fix Run must be readable');
  expect(fixRun.value.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(fixRun.value.run.requeueRef).toBeUndefined();
  expect(fixRun.value.run.inputBinding?.continuationBriefDigest).toBeUndefined();
  expect(await platform.runtime.readContinuationBrief!(ctx(), { runRef: fixRow.execution })).toEqual({ status: 'ready', value: null });
  expect(scripted.requests).toHaveLength(2);
  expect(JSON.stringify(scripted.requests[1])).not.toContain('[continuation-brief v1');
  // §13.7 point 8: the fix Run's end made the refusal stale, so GV-9 applies again, with the refusal pin @1 (point 9:
  // a new request identity, never a replay of the refused one).
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'failed', failure: { round: { roundRef: r1.ref, ordinal: 1 },
    automation: { lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: true },
      verdict: { kind: 'reverify', roundRef: r1.ref, onlyIfSourceChanged: true, failureClass: 'check_failed', retryAfterRefusal: true } } } });
  expect(toReverify.stopped.operation.request).toMatchObject({ input: { predecessorRoundRef: r1.ref, onlyIfSourceChanged: true,
    reason: 'auto-reverify:check_failed#1' }, meta: { expected: [{ ref: r1.ref, revision: r1.revision },
    { ref: { aggregateType: 'TaskReworkRefusal', taskId: GATE, operation: 'reverify', subjectId: r1.ref.roundId }, revision: 1 }] } });

  // The Workflow performs that re-verification (the refusal pin @1, a new request identity): the source changed, so
  // the successor opens on the anchored producer.
  const toSuccessorCheck = await drive(platform, toReverify.stopped, isGateStep('run_check'));
  if (toSuccessorCheck.stopped === null) throw new Error('the Workflow must reach the successor gate check');
  expect(await taskRow(platform, 'fix-1')).toMatchObject({ effectivePhase: 'satisfied' });
  const reverified = toSuccessorCheck.receipts.find(receipt => receipt.kind === 'reverify_round');
  if (reverified?.kind !== 'reverify_round' || reverified.result.status !== 'committed'
    || reverified.result.value.kind !== 'reverified') throw new Error(`the gate must be re-verified: ${JSON.stringify(reverified)}`);
  const r2 = reverified.result.value.round;
  expect(r2).toMatchObject({ status: 'open', subject: { taskId: GATE }, subjectRunRef: work1.execution, executor: hostActor,
    chain: { ordinal: 2, predecessorRoundRef: r1.ref, autoCount: 1, reverify: { actorClass: 'system',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, failureClass: 'check_failed', exemption: 'none', sourceChanged: true,
      reason: 'auto-reverify:check_failed#1' } } });
  // TASK-30: the gate follows its open successor (P20 verifying, ordinal 2); GOAL-27 gate_verifying.
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running', detail: { gate: true, ordinal: 2, predecessorRoundRef: r1.ref } } });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'gate_verifying', gateTaskId: GATE }]) });

  const done = await drive(platform, toSuccessorCheck.stopped);
  expect(done.state).toBe('completed');
  expect(done.receipts.find(receipt => receipt.kind === 'finalize_checks')).toMatchObject({ result: { status: 'committed',
    value: { outcome: 'PASS', snapshot: { ref: r2.ref } } } });
  // TASK-15: the gate completes from its PASS head; R1's FAIL evidence left the fold with the chain.
  expect(done.receipts.find(receipt => receipt.kind === 'complete_task')).toMatchObject({ result: { status: 'committed',
    value: { phase: 'satisfied', completion: { roundRef: r2.ref } } } });
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'COMPLETED' });
  // VR-15: the FAILed gate round and its report stay readable as they were.
  expect(await platform.evidence.readVerification(ctx(), r1.ref)).toMatchObject({ status: 'ready',
    value: { ref: r1.ref, status: 'finalized', outcome: 'FAIL', revision: r1.revision } });
  expect(scripted.calls()).toBe(2);

  // (step 6) The old report's body is still the FAILed observation (exit 3 on the broken source).
  const report = await platform.materials.openArtifact(ctx(), { ref: reportRef!, usage: 'historical_explanation' });
  if (report.status !== 'ready') throw new Error(`the old gate report must stay readable: ${JSON.stringify(report)}`);
  expect(JSON.parse(report.value.body)).toMatchObject({ observation: { kind: 'executed', exitCode: 3 } });
  // (step 6) VD-5: the successor superseded R1's evidence (the whole chain so far), and the gate's completion
  // folded none of it: only R2's PASS evidence is effective.
  const r1Evidence = r1.evidenceRefs.map(ref => ref.evidenceId);
  expect(r1Evidence.length).toBeGreaterThan(0);
  expect(r2.chain?.supersededEvidenceIds).toEqual(r1Evidence);
  const completion = done.receipts.find(receipt => receipt.kind === 'complete_task');
  if (completion?.kind !== 'complete_task' || completion.result.status !== 'committed') throw new Error('the gate must complete');
  const reduction = completion.result.value;
  expect([...reduction.effectiveEvidenceIds, ...reduction.blockingEvidenceIds, ...reduction.staleEvidenceIds,
    ...reduction.outOfScopeEvidenceIds].filter(id => r1Evidence.includes(id))).toEqual([]);
  const r2Final = await platform.evidence.readVerification(ctx(), r2.ref);
  if (r2Final.status !== 'ready') throw new Error('the successor round must be readable');
  expect([...reduction.effectiveEvidenceIds].sort()).toEqual(r2Final.value.evidenceRefs.map(ref => ref.evidenceId).sort());
  await checkInvariants(platform, 'end');
}, 180_000);

it('C5 control: a fix that does not repair the failure FAILs its own round, the gate is not re-verified, and the Goal reason comes from the fix Task', async () => {
  const GATE = AG2B_GATE_TASK_ID;
  const FIX = 'ag2b-fix';
  const h = await openPlatformScenario({ script: { replies: [...createFileReplies('c5-control-work', AG2B_RESULT_FILE, AG2B_RESULT_TEXT),
    textReply('c5 control: fix Run 1 changes nothing'), textReply('c5 control: fix Run 2 changes nothing')] } });
  await assertInvariants(h, 'seeded');

  // The work passes; its result is lost before the gate's root round captures the workspace, so the gate FAILs,
  // the cheap re-verification is refused source_unchanged and the gate stops as gate_needs_fix (the main path above).
  const first = h.select('c5-control');
  const toGate = await h.advance(first, { stopBefore: performsOn('open_checks') });
  if (toGate.next === null) throw new Error('the Workflow must reach the gate open');
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  await rm(join(h.root, AG2B_RESULT_FILE));
  const failed = await h.advance(toGate.next);
  const failedSteps = performedSteps(toGate.next, failed);
  const r1 = finalizedRound(failedSteps.find(step => step.task === GATE && step.receipt.kind === 'finalize_checks'));
  expect(r1).toMatchObject({ outcome: 'FAIL', chain: { ordinal: 1 } });
  expect(failedSteps.filter(step => step.receipt.kind === 'reverify_round').map(step => step.receipt.result)).toMatchObject([
    { status: 'committed', value: { kind: 'refused', refusal: { code: 'source_unchanged', revision: 1 } } }]);
  expect(failed).toMatchObject({ state: 'waiting', reason: expect.stringMatching(/^gate_needs_fix: /) });
  const reportRef = r1.checks[0]?.reportRef ?? null;
  if (reportRef === null) throw new Error('the FAILed gate check must have its report');

  // The operator adds the fix Task with the report; its Runs change nothing.
  await adoptFixTaskOn(h, { fixId: FIX, checkId: 'ag2b-static', sources: [reportRef], label: 'c5-control-fix' });
  const callsBeforeFix = h.modelCalls();
  const second = h.select('c5-control-2');
  const fixing = await h.advance(second);
  const steps = performedSteps(second, fixing);
  // The fix Task's own rounds FAIL: Run 1, the automatic requeue #1 (AV-12), Run 2, then the second requeue's key is
  // the first one's: refused no_new_basis (§13.4), so the fix Task stops (AV-9).
  expect(finalizeOutcomesOfTask(steps, FIX)).toEqual(['FAIL', 'FAIL']);
  expect(steps.filter(step => step.receipt.kind === 'requeue_task').map(step => step.receipt.result)).toMatchObject([
    { status: 'committed', value: { kind: 'requeued', requeue: { automation: { automatic: true, autoCount: 1 } } } },
    { status: 'committed', value: { kind: 'refused', refusal: { code: 'no_new_basis', revision: 1 } } }]);
  expect(fixing.state).toBe('waiting');
  expect(h.modelCalls() - callsBeforeFix, 'one model call per fix Run').toBe(2);
  expect(await h.taskRow(FIX)).toMatchObject({ effectivePhase: 'failed', failure: { subjectKind: 'work', failureClass: 'check_failed',
    round: { outcome: 'FAIL', failingChecks: [{ checkId: 'ag2b-static', outcome: 'FAIL' }] },
    automation: { verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } } } });

  // The gate is not re-verified: the Workflow took no step on it, and its chain is still R1 alone. GV-5 precedes
  // GV-8/GV-9: each fix Run's end made the gate's refusal stale, yet the unsatisfied required fix keeps it at none.
  expect(steps.filter(step => step.task === GATE)).toEqual([]);
  expect(h.lastWorld?.rounds.filter(round => round.ref.taskId === GATE).map(round => round.ref.roundId)).toEqual([r1.ref.roundId]);
  expect(await h.taskRow(GATE)).toMatchObject({ effectivePhase: 'failed', failure: { subjectKind: 'gate',
    round: { roundRef: r1.ref, ordinal: 1, outcome: 'FAIL' },
    automation: { lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: true }, verdict: { kind: 'none' } } } });
  // GOAL-30: the Goal needs a decision, and its reason is the fix Task's stop, not the gate's.
  const display = await h.goalDisplay();
  expect(display).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'no_new_basis', taskId: FIX, detail: { operation: 'requeue' } } });
  expect(display.causes.filter(cause => cause.code === 'gate_needs_fix')).toEqual([]);

  // A later advance re-verifies nothing either: no step, no model call, no write.
  const before = h.counts();
  expect(await h.advance(h.select('c5-control-3'))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(before);
  await assertInvariants(h, 'end');
}, 180_000);
