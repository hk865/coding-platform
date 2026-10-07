/**
 * A.2 step 6: scenario C5-reverify-guards (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C5-reverify-guards.test.ts`; §13.7 points 3–9 and its examples; §9 VD-13, VR-14;
 * §4 AV-7a..AV-7d; §2 GOAL-30; lead decision LA-4; §11 invariants after every step).
 *
 * (a) `verification_uncovered`: the Workflow's automatic re-verification of an INCONCLUSIVE head is
 *     refused and committed when the registered checks cover no requirement; no round opens and no
 *     check starts; the Goal is NEEDS_DECISION/verification_uncovered; registering a covering check
 *     makes the refusal stale and the next advance re-verifies. Plus the moved owner-level case (from
 *     tests/composition/A2-reverify-platform.test.ts; part of (a) and (b)): the cap refuses the
 *     automation, `verification_uncovered` refuses even the operator and stores its configuration
 *     revision, a covering configuration makes it stale.
 * (b) A timed-out check with the workspace changed between every round: three automatic
 *     re-verifications pass the key (autoCount 1..3), then AV-7a stops the Task as
 *     `auto_rework_cap_reached{reverify}` without a request or a refusal; the operator's re-check is
 *     allowed (autoCount 0) and the automatic count starts again at #1.
 * (c) `not_started`: the sandbox cannot launch the check (`launch_failed`, made deterministic by a
 *     ProcessSandbox subclass over the real Kernel module: only `execute` of a check throws; the probe
 *     and everything else are the Kernel's); the exemption skips the key (the same key is admitted
 *     three times) but counts, so the cap stops it. The mock is file-wide: the other cases, the two
 *     moved ones included, run with the flag off, where the subclass delegates to the Kernel's `execute`.
 * (d) A timed-out check on an unchanged workspace: exactly one automatic re-verification, then the
 *     committed `no_new_basis{reverify}` and NEEDS_DECISION/no_new_basis (the moved VR-03 case from
 *     tests/composition/A2-verification-chain-platform.test.ts, extended: the stop is a Goal cause at
 *     once; the headline is checked after the fixture's other required Task, work-2, has stopped
 *     too, so it holds whether or not claimable work keeps GOAL-30 off the headline, NOTES Q5;
 *     work-2's Run end makes work-1's refusal stale: one retry, refused again @2, §13.4 #21).
 *
 * The moved cases keep their own composition-root fixtures (tests/scenarios/support/gate.ts) and
 * their assertions; the new cases run on the shared harness (AG2b seed, platform mode). Scripted
 * model replies only.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { assertInvariants, checkRevisionOf, cleanupScenarios, openPlatformScenario, performs, SCENARIO_OPERATOR } from './harness.js';
import { textReply } from './support/common.js';
import {
  chainCase, checkInvariants, cleanupCases, finalizedRound, finalizeOutcomesOfTask, performedSteps, reverifyCase,
} from './support/gate.js';

/** (c): while set, a registered check's launch fails before any process starts (`ProcessSandboxError('launch_failed')`). */
const sandbox = vi.hoisted(() => ({ launchFails: false, launches: 0 }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/public-api.js')>();
  // The probe constructs the Kernel's own class, so only the runner's `execute` of a check meets this.
  class LaunchFailingProcessSandbox extends actual.ProcessSandbox {
    override async execute(request: Parameters<InstanceType<typeof actual.ProcessSandbox>['execute']>[0]) {
      if (!sandbox.launchFails) return super.execute(request);
      sandbox.launches += 1;
      throw new actual.ProcessSandboxError('launch_failed', 'scenario: the isolated check process could not be launched');
    }
  }
  return { ...actual, ProcessSandbox: LaunchFailingProcessSandbox };
});

afterEach(cleanupCases);
afterEach(cleanupScenarios);
afterEach(() => {
  sandbox.launchFails = false;
  sandbox.launches = 0;
});

const WORK = AG2B_WORK_TASK_ID;
const CHECK = 'ag2b-static';

it('(a) verification_uncovered: the automatic re-verification is refused and committed, no round opens and no check starts, the Goal needs a decision; a covering check makes the next advance re-verify', async () => {
  const h = await openPlatformScenario({ check: { timeoutAfterMs: 300 }, script: { replies: [textReply('c5 guards (a): the work Run')] } });
  await assertInvariants(h, 'seeded');
  // The work Run's check times out: an INCONCLUSIVE head the automation would re-verify (AV-7d).
  const first = h.select('c5-a', WORK);
  const toReverify = await h.advance(first, { stopBefore: performs('reverify_round') });
  expect(toReverify.state).toBe('stopped');
  const r1 = finalizedRound(performedSteps(first, toReverify).find(step => step.receipt.kind === 'finalize_checks'));
  expect(r1).toMatchObject({ outcome: 'INCONCLUSIVE', checks: [{ checkId: CHECK, incompleteCause: 'process_timed_out' }] });

  // The Host registers another check of another kind: it covers no requirement of the obligation (ag2b-checks@2).
  h.registerCheck({ command: 'node -e "process.exit(0)"', kind: 'dynamic' });
  const before = h.counts();
  const refusedInput = h.select('c5-a-2', WORK);
  const refused = await h.advance(refusedInput);
  // One automatic request, refused as a committed value that stores the configuration revision (LA-4); then waiting.
  const refusedSteps = performedSteps(refusedInput, refused);
  expect(refusedSteps.map(step => step.operation.kind)).toEqual(['reverify_round']);
  expect(refusedSteps[0]!.receipt).toMatchObject({ result: { status: 'committed', value: { kind: 'refused', refusal: {
    revision: 1, code: 'verification_uncovered', failureClass: 'check_incomplete', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    configurationRevision: checkRevisionOf(2), ref: { operation: 'reverify', subjectId: r1.ref.roundId } } } } });
  expect(refused.state).toBe('waiting');
  // 0 re-verifications: no successor round, no check process, no model call.
  expect(h.lastWorld?.rounds.map(round => round.ref.roundId)).toEqual([r1.ref.roundId]);
  expect(h.counts().checksBegun).toBe(before.checksBegun);
  expect(h.counts().modelCalls).toBe(before.modelCalls);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', failure: { failureClass: 'check_incomplete',
    round: { roundRef: r1.ref, ordinal: 1 }, automation: { lastReverifyRefusal: { code: 'verification_uncovered', revision: 1, stale: false },
      verdict: { kind: 'stopped', reason: 'verification_uncovered', detail: { operation: 'reverify' } } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'verification_uncovered', taskId: WORK, detail: { operation: 'reverify' } } });
  // AV-7c stops it: another advance takes no step and writes nothing.
  const stopped = h.counts();
  expect(await h.advance(h.select('c5-a-3', WORK))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(stopped);

  // A covering check (static, ag2b-checks@3): the stored refusal is stale (LA-4), and the next advance re-verifies.
  h.registerCheck('pass');
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { lastReverifyRefusal: { code: 'verification_uncovered', stale: true },
    verdict: { kind: 'reverify', roundRef: r1.ref, retryAfterRefusal: true } } } });
  const coveredInput = h.select('c5-a-4');
  const covered = await h.advance(coveredInput);
  const coveredSteps = performedSteps(coveredInput, covered);
  expect(coveredSteps[0]).toMatchObject({ operation: { kind: 'reverify_round', request: { meta: { expected: [
    { ref: r1.ref, revision: r1.revision }, { ref: { aggregateType: 'TaskReworkRefusal', subjectId: r1.ref.roundId }, revision: 1 }] } } },
  receipt: { result: { status: 'committed', value: { kind: 'reverified', round: {
    configuration: { configurationRevision: checkRevisionOf(3) }, chain: { ordinal: 2, predecessorRoundRef: r1.ref, autoCount: 1 } } } } } });
  expect(finalizeOutcomesOfTask(coveredSteps, WORK)).toEqual(['PASS']);
  expect(covered.state).toBe('completed');
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(h.modelCalls()).toBe(1);
}, 180_000);

it('(a)/(b) §13.7 / LA-4: the cap and verification_uncovered are committed refusals on TaskRow.failure; a covering configuration makes them stale', async () => {
  const { openEnvironment, inconclusiveHead, reverifyRequest, ctx, taskRow, checksConfiguration, hostActor } = reverifyCase;
  const CAP_0 = { schemaVersion: 1 as const, autoReworkLimit: 0, resumeOnStartup: false };
  const { platform, scripted, workspaceRoot } = await openEnvironment();
  const r1 = await inconclusiveHead(platform, workspaceRoot);

  // The platform automation (the Workflow's actor) is capped: limit 0 refuses before any capture.
  platform.registerAutomationPolicy({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
  expect(await platform.evidence.reverifyRound!(ctx({ ...WORKFLOW_AUTOMATION_ACTOR }), reverifyRequest(r1, 'a2-reverify-cap')))
    .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 1, code: 'auto_rework_cap_reached',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, configurationRevision: null, source: null } } });
  await checkInvariants(platform, 'cap refused', { kind: 'task_rework_refused', actor: { ...WORKFLOW_AUTOMATION_ACTOR },
    automationPolicy: CAP_0 });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ failure: { automation: {
    lastReverifyRefusal: { code: 'auto_rework_cap_reached', revision: 1, stale: false } } } });

  // No registered check covers the static requirement: refused for the operator too, storing the revision.
  platform.registerCheckConfiguration({ configuration: checksConfiguration('a2-reverify-dynamic', 'dynamic') });
  expect(await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-uncovered', 1)))
    .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 2, code: 'verification_uncovered',
      configurationRevision: 'a2-reverify-dynamic', requestedBy: hostActor } } });
  await checkInvariants(platform, 'uncovered refused', { kind: 'task_rework_refused', automationPolicy: CAP_0 });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked', failure: { automation: {
    lastReverifyRefusal: { code: 'verification_uncovered', revision: 2, stale: false } } } });

  // LA-4: once a covering configuration (another revision) is registered, the stored refusal is stale.
  platform.registerCheckConfiguration({ configuration: checksConfiguration('a2-reverify-checks-2') });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ failure: { automation: {
    lastReverifyRefusal: { code: 'verification_uncovered', revision: 2, stale: true } } } });
  const reverified = await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-covered', 2));
  expect(reverified).toMatchObject({ status: 'committed', value: { kind: 'reverified', round: { chain: { ordinal: 2 },
    configuration: { configurationRevision: 'a2-reverify-checks-2' } } } });
  await checkInvariants(platform, 'covered reverified', { kind: 'round_reverified', automationPolicy: CAP_0 });
  expect(scripted.calls()).toBe(1);
}, 90_000);

it('(b) a timed-out check with the workspace changed between every round: three automatic re-verifications, then stopped/auto_rework_cap_reached{reverify}; the operator\'s re-check is allowed and resets the count', async () => {
  const h = await openPlatformScenario({ check: { timeoutAfterMs: 300 }, script: { replies: [textReply('c5 guards (b): the work Run')] } });
  await assertInvariants(h, 'seeded');
  let input = h.select('c5-b', WORK);
  let driven = await h.advance(input, { stopBefore: performs('reverify_round') });
  const successors: RoundSnapshot[] = [];
  for (let n = 1; n <= 3; n += 1) {
    if (driven.next === null) throw new Error(`the Workflow must request re-verification ${n}`);
    // The workspace changes before every successor round: a new source, so a new key.
    await writeFile(join(h.root, 'src', `round-${n}.txt`), `workspace change before re-verification ${n}\n`);
    const request = driven.next;
    input = request;
    // Perform this re-verification and stop before the next one.
    driven = await h.advance(request, { stopBefore: next => next !== request && performs('reverify_round')(next) });
    const steps = performedSteps(input, driven);
    const receipt = steps[0]?.receipt;
    if (receipt?.kind !== 'reverify_round' || receipt.result.status !== 'committed' || receipt.result.value.kind !== 'reverified') {
      throw new Error(`re-verification ${n} must open a successor: ${JSON.stringify(receipt)}`);
    }
    successors.push(receipt.result.value.round);
    expect(finalizeOutcomesOfTask(steps, WORK)).toEqual(['INCONCLUSIVE']);
    // INCONCLUSIVE because the successor's check timed out again (not a gap, not another incomplete cause).
    expect(finalizedRound(steps.find(step => step.task === WORK && step.receipt.kind === 'finalize_checks'))).toMatchObject({
      outcome: 'INCONCLUSIVE', checks: [{ checkId: CHECK, incompleteCause: 'process_timed_out' }], gaps: [] });
  }
  // Each passes the key (the source changed) and counts: autoCount 1, 2, 3.
  expect(successors.map(round => round.chain)).toMatchObject([1, 2, 3].map(n => ({ ordinal: n + 1, autoCount: n,
    reverify: { actorClass: 'system', failureClass: 'check_incomplete', exemption: 'none', sourceChanged: true,
      reason: `auto-reverify:check_incomplete#${n}` } })));
  // AV-7a: a fourth counted request would pass the cap (3 + 1 > 3), so the Workflow does not send it, even with the
  // workspace changed again, and no refusal is written (the cap is judged before the owner, §13.7 point 4).
  expect(driven.state).toBe('waiting');
  await writeFile(join(h.root, 'src', 'round-4.txt'), 'workspace change before the operator re-check\n');
  const capped = h.counts();
  expect(await h.advance(h.select('c5-b-capped', WORK))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(capped);
  expect(h.lastWorld?.rounds).toHaveLength(4);
  expect(h.lastWorld?.refusals).toEqual([]);
  const row = await h.taskRow();
  expect(row).toMatchObject({ effectivePhase: 'blocked', failure: { round: { ordinal: 4, autoCount: 3 },
    automation: { cap: 3, lastReverifyRefusal: null,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'auto_rework_cap_reached', taskId: WORK, detail: { operation: 'reverify' } } });

  // The operator's re-check: no cap for a human (the key still applies; the workspace changed), autoCount 0.
  const head = row.failure?.round ?? null;
  if (head === null) throw new Error('the capped Task must show its chain head');
  const operator = await h.platform.evidence.reverifyRound!(h.ctx(), { input: { predecessorRoundRef: head.roundRef,
    reason: 'the operator checks again' }, meta: { requestId: 'c5-b-operator', expected: [{ ref: head.roundRef, revision: head.revision }] } });
  expect(operator).toMatchObject({ status: 'committed', value: { kind: 'reverified', round: { chain: { ordinal: 5, autoCount: 0,
    reverify: { actorClass: 'human', requestedBy: SCENARIO_OPERATOR, sourceChanged: true, reason: 'the operator checks again' } } } } });
  await assertInvariants(h, 'operator re-check', { kind: 'round_reverified', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy(), label: 'operator re-check' });
  // The count starts again: the operator's round times out too, and the automation re-verifies it as #1.
  const again = h.select('c5-b-after-operator', WORK);
  const afterOperator = await h.advance(again, { stopBefore: performs('reverify_round') });
  const operatorSteps = performedSteps(again, afterOperator);
  expect(finalizeOutcomesOfTask(operatorSteps, WORK)).toEqual(['INCONCLUSIVE']);
  expect(finalizedRound(operatorSteps.find(step => step.task === WORK && step.receipt.kind === 'finalize_checks'))).toMatchObject({
    outcome: 'INCONCLUSIVE', checks: [{ checkId: CHECK, incompleteCause: 'process_timed_out' }], gaps: [] });
  expect(afterOperator.next).toMatchObject({ operation: { kind: 'reverify_round',
    request: { input: { reason: 'auto-reverify:check_incomplete#1' } } } });
  expect(await h.taskRow()).toMatchObject({ failure: { round: { ordinal: 5, autoCount: 0 },
    automation: { verdict: { kind: 'reverify', failureClass: 'check_incomplete' } } } });
  expect(h.modelCalls(), 'successor rounds build no Run').toBe(1);
}, 180_000);

it('(c) not_started: the sandbox cannot launch the check; the exemption skips the key (the same key admitted three times) but counts, so the cap stops it', async () => {
  sandbox.launchFails = true;
  const h = await openPlatformScenario({ check: 'pass', script: { replies: [textReply('c5 guards (c): the work Run')] } });
  await assertInvariants(h, 'seeded');
  const first = h.select('c5-c', WORK);
  const driven = await h.advance(first);
  const steps = performedSteps(first, driven);
  // Four rounds, each check begun and never launched: INCONCLUSIVE `not_started`, no gap (§13.7 point 3).
  expect(finalizeOutcomesOfTask(steps, WORK)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE', 'INCONCLUSIVE', 'INCONCLUSIVE']);
  expect(sandbox.launches).toBe(4);
  expect(h.counts().checksBegun).toBe(4);
  const rounds = h.lastWorld?.rounds ?? [];
  expect(rounds.map(round => ({ checks: round.checks, gaps: round.gaps }))).toMatchObject(Array.from({ length: 4 }, () => ({
    checks: [{ checkId: CHECK, phase: 'finished', outcome: 'INCONCLUSIVE', incompleteCause: 'not_started' }], gaps: [] })));
  // Three automatic re-verifications, all exempt `not_started` on an unchanged source: each counts (1, 2, 3).
  const reverified = steps.filter(step => step.receipt.kind === 'reverify_round').map(step => step.receipt.result);
  expect(reverified).toMatchObject([1, 2, 3].map(n => ({ status: 'committed', value: { kind: 'reverified', round: { chain: {
    ordinal: n + 1, autoCount: n, reverify: { actorClass: 'system', failureClass: 'check_incomplete', exemption: 'not_started',
      sourceChanged: false, reason: `auto-reverify:check_incomplete#${n}` } } } } })));
  // The key was skipped, not passed: the three recorded keys are the same digest (without the exemption the second
  // request would have been refused no_new_basis).
  const head = rounds.find(round => round.chain?.ordinal === 4);
  expect(head?.chain?.basisDigests).toHaveLength(3);
  expect(new Set(head?.chain?.basisDigests).size).toBe(1);
  // AV-7a: the cap stops it (3 + 1 > 3); no request was refused, no refusal record exists.
  expect(driven.state).toBe('waiting');
  expect(h.lastWorld?.refusals).toEqual([]);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', failure: { failureClass: 'check_incomplete',
    round: { ordinal: 4, autoCount: 3 }, automation: { lastReverifyRefusal: null,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'auto_rework_cap_reached', taskId: WORK, detail: { operation: 'reverify' } } });
  const before = h.counts();
  expect(await h.advance(h.select('c5-c-2', WORK))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(before);
  expect(h.modelCalls()).toBe(1);
}, 180_000);

it('(d) VR-03: a timed-out check records its INCONCLUSIVE cause and blocks the Task as round_inconclusive', async () => {
  const { openEnvironment, drive, select, taskRow, goalDisplay, CHECK_ID } = chainCase;
  const { platform, scripted } = await openEnvironment({ command: 'sleep 5', timeoutMs: 300 });
  const driven = await drive(platform, select('a2-timeout-flow', 'work-1'));
  const finalize = driven.receipts.find(receipt => receipt.kind === 'finalize_checks');
  expect(finalize).toMatchObject({ result: { status: 'committed', value: { outcome: 'INCONCLUSIVE' } } });
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the round must finalize');
  expect(finalize.result.value.snapshot.checks[0]).toMatchObject({ checkId: CHECK_ID, phase: 'finished', outcome: 'INCONCLUSIVE',
    incompleteCause: 'process_timed_out' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'round_inconclusive' } });
  // §13.7 example (5.9): with an unchanged workspace the first automatic re-verification passes (no earlier key);
  // its successor times out the same way, so the second has the same key: no_new_basis, and the Task stops (AV-7c).
  expect(driven.receipts.filter(receipt => receipt.kind === 'reverify_round')).toMatchObject([
    { result: { status: 'committed', value: { kind: 'reverified', round: { chain: { ordinal: 2, autoCount: 1 } } } } },
    { result: { status: 'committed', value: { kind: 'refused', refusal: { code: 'no_new_basis', revision: 1 } } } }]);
  expect(driven).toMatchObject({ state: 'waiting', reason: 'the selected Task work-1 is not executable right now' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ phaseCause: { detail: { ordinal: 2 } }, failure: { automation: {
    verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'reverify' } } } } });
  // (step 6, row (d)) The refusal is the automation's, on the successor head, with the configuration revision (LA-4);
  // the stop is a Goal cause at once (GOAL-30: causes are always listed); no model call beyond the work Run.
  expect(driven.receipts.filter(receipt => receipt.kind === 'reverify_round')[1]).toMatchObject({ result: { value: { refusal: {
    failureClass: 'check_incomplete', requestedBy: WORKFLOW_AUTOMATION_ACTOR, configurationRevision: 'a2-chain-checks-1' } } } });
  const workOneStop = expect.objectContaining({ code: 'no_new_basis', taskId: 'work-1',
    detail: expect.objectContaining({ operation: 'reverify' }) });
  expect(await goalDisplay(platform)).toMatchObject({ causes: expect.arrayContaining([workOneStop]) });
  expect(scripted.calls()).toBe(1);
  // work-2 (required, still claimable) runs the same way: its Run, one automatic re-verification, then no_new_basis.
  // Its Run's end (no file change) makes work-1's refusal stale (§13.7 point 8; §13.4 #21): the automation retries
  // work-1 once, under a new refusal pin, and is refused again (@2, the same key); then it stops, no loop.
  const second = await drive(platform, select('a2-timeout-flow-2'));
  expect(second.receipts.filter(receipt => receipt.kind === 'reverify_round')).toMatchObject([
    { result: { status: 'committed', value: { kind: 'refused', refusal: { code: 'no_new_basis', revision: 2,
      goalEndedRunsAtRefusal: 2, ref: { taskId: 'work-1', operation: 'reverify' } } } } },
    { result: { status: 'committed', value: { kind: 'reverified', round: { subject: { taskId: 'work-2' },
      chain: { ordinal: 2, autoCount: 1 } } } } },
    { result: { status: 'committed', value: { kind: 'refused', refusal: { code: 'no_new_basis', revision: 1,
      goalEndedRunsAtRefusal: 2, ref: { taskId: 'work-2', operation: 'reverify' } } } } }]);
  expect(second.state).toBe('waiting');
  expect(await taskRow(platform, 'work-1')).toMatchObject({ failure: { automation: {
    lastReverifyRefusal: { code: 'no_new_basis', revision: 2, stale: false },
    verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'reverify' } } } } });
  expect(await taskRow(platform, 'work-2')).toMatchObject({ effectivePhase: 'blocked', failure: { automation: {
    lastReverifyRefusal: { code: 'no_new_basis', revision: 1, stale: false },
    verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'reverify' } } } } });
  // Nothing automatic is left in the Goal: NEEDS_DECISION (GOAL-30), headed by the first required stop in plan order
  // (work-1); work-2's stop is listed too. One model call per work Run.
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'no_new_basis', taskId: 'work-1', detail: { operation: 'reverify' } },
    causes: expect.arrayContaining([workOneStop, expect.objectContaining({ code: 'no_new_basis', taskId: 'work-2' })]) });
  expect(scripted.calls()).toBe(2);
}, 90_000);
