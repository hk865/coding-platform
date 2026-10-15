/**
 * RL slice row RL-32b (RE2): the automatic-rework notice carries the
 * memory-cap sentence and the `raise_memory_cap` action when the round that
 * triggered the rework has a check with `resourceCapHit` (spec §5.2 RL-32b,
 * L16, A5).
 *
 * Builds: the real R3e evidence fixture + `createTargetPlatform` over the same
 * SQLite ledger with the Kernel `ProcessSandbox` swapped by the RL double. The
 * registered check runs through the real runner, the check result is committed
 * through the real `recordCheckResult` owner, the system opens the successor
 * round through `platform.evidence.reverifyRound`, and the notice is read
 * through the public `platform.decisions.queryDecisionQueue`.
 * Rows: RL-32b.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { DecisionQueueReadV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import * as automaticReworkNotices from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, R3E_WORK_TASK_ID } from '../helpers/R3e-evidence-fixture.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const MIB = 1_048_576;
/** The cap-hit report the row names: memory cap 6144 MiB. */
const CAP_HIT = { status: 'applied', memoryMaxBytes: 6144 * MIB, tasksMax: 512,
  memory: 'cap_hit', processes: 'none_observed', observationComplete: true } as const;
/** The same failing check without the memory event. */
const NO_HIT = { status: 'applied', memoryMaxBytes: 6144 * MIB, tasksMax: 512,
  memory: 'none_observed', processes: 'none_observed', observationComplete: true } as const;

/** Today's exact notice sentence for this task's first counted system round. */
const TODAY = `自动返工 · ${R3E_WORK_TASK_ID} · 第 1 次（1/3）`;
const CAP_SENTENCE = '检查超出内存上限（当时上限 6144 MiB）';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  rlSandbox.reset();
  vi.restoreAllMocks();
});

function automationCtx(ctx: CoreCallContext, scope: { projectId: string; workspaceId: string }): CoreCallContext {
  return { ...ctx, principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId,
      actor: WORKFLOW_AUTOMATION_ACTOR } };
}

/**
 * One registered check through the Kernel double, finalized FAIL, then the
 * system's successor round on a changed source. The trigger check is read back
 * through the public evidence owner, and the one automatic-rework notice
 * through the public decision queue.
 */
async function noticeAfterSystemReverify(resourceCaps: object): Promise<{
  notice: NoticeItemV1;
  triggerCheck: RoundSnapshot['checks'][number];
}> {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32b-rev', artifactRefs: [] } });
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());

  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`RL-32b open did not commit: ${JSON.stringify(opened)}`);
  const ran = await platform.checks.runRegisteredCheck(fixture.ctx, {
    input: { roundRef: opened.value.ref, checkId: fixture.passCheck.checkId },
    meta: { requestId: 'rl32b-run', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  if (ran.status !== 'ready') throw new Error(`RL-32b check did not finish: ${JSON.stringify(ran)}`);
  const roundRead = await platform.evidence.readVerification(fixture.ctx, opened.value.ref);
  if (roundRead.status !== 'ready') throw new Error(`RL-32b round read failed: ${JSON.stringify(roundRead)}`);
  const triggerCheck = roundRead.value.checks.find((check) => check.checkId === fixture.passCheck.checkId);
  if (triggerCheck === undefined) throw new Error('RL-32b the committed round has no trigger check');
  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, { input: { roundRef: opened.value.ref },
    meta: { requestId: 'rl32b-finalize', expected: [{ ref: opened.value.ref, revision: ran.value.revision }] } });
  if (finalized.status !== 'committed') throw new Error(`RL-32b finalize did not commit: ${JSON.stringify(finalized)}`);

  // VR-14 needs a new basis: change the real verification source between rounds.
  await writeFile(join(fixture.workspaceRoot, 'src', 'input.txt'), 'RL-32b rework source v2\n');
  const predecessor = finalized.value.snapshot;
  const reverify = platform.evidence.reverifyRound;
  if (reverify === undefined) throw new Error('RL-32b platform has no reverifyRound owner');
  const successor = await reverify(automationCtx(fixture.ctx, fixture.scope), {
    input: { predecessorRoundRef: predecessor.ref },
    meta: { requestId: 'rl32b-reverify', expected: [{ ref: predecessor.ref, revision: predecessor.revision }] } });
  if (successor.status !== 'committed' || successor.value.kind !== 'reverified') {
    throw new Error(`RL-32b system reverify did not open a successor: ${JSON.stringify(successor)}`);
  }

  const page = await platform.decisions.queryDecisionQueue(fixture.ctx, {
    workspace: fixture.scope, sections: ['notices'], categories: ['automatic_rework'], page: { limit: 50 } });
  if (page.status !== 'ready') throw new Error(`RL-32b notice read failed: ${JSON.stringify(page)}`);
  const notice = page.value.notices.find((item) => item.category === 'automatic_rework');
  if (notice === undefined) throw new Error('RL-32b read no automatic-rework notice');
  return { notice, triggerCheck };
}

it('RL-32b (a) a cap-hit trigger round appends the memory-cap sentence to the notice summary', async () => {
  const { notice } = await noticeAfterSystemReverify(CAP_HIT);
  expect(notice.summary).toBe(`${TODAY} · ${CAP_SENTENCE}`);
}, 120_000);

it('RL-32b (b) the cap-hit notice carries the raise_memory_cap action', async () => {
  const { notice } = await noticeAfterSystemReverify(CAP_HIT);
  expect(notice.actions).toEqual([{ kind: 'raise_memory_cap' }]);
}, 120_000);

it('RL-32b (c) the same failure without cap_hit keeps today notice and carries no action', async () => {
  const { notice } = await noticeAfterSystemReverify(NO_HIT);
  expect({ summary: notice.summary, actions: notice.actions }).toEqual({ summary: TODAY, actions: undefined });
}, 120_000);

it('RL-32b (d) the committed check record carries the memory-cap hit through the public round read', async () => {
  const { triggerCheck } = await noticeAfterSystemReverify(CAP_HIT);
  expect(triggerCheck.resourceCapHit).toEqual({ memory: 'cap_hit', memoryCapMiB: 6144 });
}, 120_000);

/**
 * 5(c)-5 (e)/(f), RE2: one failing trigger round through the Kernel double,
 * FINALIZED FAIL, then the system's automatic requeue. The requeue branch reads
 * the round named by `TaskRequeue.afterRoundRef` (not through the chain), and
 * the notice is read through the public decision queue.
 */
async function noticeAfterSystemRequeue(resourceCaps: object): Promise<{ notice: NoticeItemV1 }> {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32b-rev', artifactRefs: [] } });
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());

  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`RL-32b requeue open did not commit: ${JSON.stringify(opened)}`);
  const ran = await platform.checks.runRegisteredCheck(fixture.ctx, {
    input: { roundRef: opened.value.ref, checkId: fixture.passCheck.checkId },
    meta: { requestId: 'rl32b-requeue-run', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  if (ran.status !== 'ready') throw new Error(`RL-32b requeue check did not finish: ${JSON.stringify(ran)}`);
  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, { input: { roundRef: opened.value.ref },
    meta: { requestId: 'rl32b-requeue-finalize', expected: [{ ref: opened.value.ref, revision: ran.value.revision }] } });
  if (finalized.status !== 'committed') throw new Error(`RL-32b requeue finalize did not commit: ${JSON.stringify(finalized)}`);

  const goal = await platform.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goal.status !== 'ready') throw new Error('RL-32b requeue Goal read failed');
  const run = await platform.executions.readExecution(fixture.ctx, fixture.subjectRunRef);
  if (run.status !== 'ready') throw new Error('RL-32b requeue Run read failed');
  const requeued = await platform.claims.requeueTask!(automationCtx(fixture.ctx, fixture.scope), {
    meta: { requestId: 'rl32b-requeue', expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision },
      { ref: fixture.subjectRunRef, revision: run.value.run.revision }] },
    input: { taskRef: fixture.subject, afterRunRef: fixture.subjectRunRef, reason: 'the registered check failed; try again' } });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`RL-32b automatic requeue was refused: ${JSON.stringify(requeued)}`);
  }

  const page = await platform.decisions.queryDecisionQueue(fixture.ctx, {
    workspace: fixture.scope, sections: ['notices'], categories: ['automatic_rework'], page: { limit: 50 } });
  if (page.status !== 'ready') throw new Error(`RL-32b requeue notice read failed: ${JSON.stringify(page)}`);
  const notice = page.value.notices.find((item) => item.category === 'automatic_rework' && item.rework?.operation === 'requeue');
  if (notice === undefined) throw new Error('RL-32b read no automatic-requeue notice');
  return { notice };
}

it('RL-32b (e) a requeue whose trigger round has a cap hit carries the sentence and the action', async () => {
  const { notice } = await noticeAfterSystemRequeue(CAP_HIT);
  expect({ summary: notice.summary, actions: notice.actions })
    .toEqual({ summary: `${TODAY} · ${CAP_SENTENCE}`, actions: [{ kind: 'raise_memory_cap' }] });
}, 120_000);

it('RL-32b (f) a requeue whose trigger round has no cap hit keeps today notice and carries no action', async () => {
  const { notice } = await noticeAfterSystemRequeue(NO_HIT);
  expect({ summary: notice.summary, actions: notice.actions }).toEqual({ summary: TODAY, actions: undefined });
}, 120_000);

/**
 * 5(c)-5 (g), RE2: the trigger round has two cap-hit checks registered in the
 * order `[r3e-pass, r3e-interrupt]` and executed in that same order, but the
 * sentence must name the first cap hit by `checkId` (`r3e-interrupt`, 512 MiB).
 */
async function noticeAfterTwoCheckReverify(): Promise<{ notice: NoticeItemV1 }> {
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  rlSandbox.next = (command) => defaultRLSandboxResult({ exitCode: 137,
    resourceCaps: { ...CAP_HIT, memoryMaxBytes: command === fixture.passCheck.command ? 6144 * MIB : 512 * MIB },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32b-rev', artifactRefs: [] } });
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());

  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`RL-32b ordering open did not commit: ${JSON.stringify(opened)}`);
  let round = opened.value;
  // The later-sorting check runs first, so execution order is not checkId order.
  for (const checkId of [fixture.passCheck.checkId, fixture.interruptCheck.checkId]) {
    const ran = await platform.checks.runRegisteredCheck(fixture.ctx, {
      input: { roundRef: round.ref, checkId },
      meta: { requestId: `rl32b-order-run-${checkId}`, expected: [{ ref: round.ref, revision: round.revision }] } });
    if (ran.status !== 'ready') throw new Error(`RL-32b ordering check ${checkId} did not finish: ${JSON.stringify(ran)}`);
    round = ran.value;
  }
  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, { input: { roundRef: round.ref },
    meta: { requestId: 'rl32b-order-finalize', expected: [{ ref: round.ref, revision: round.revision }] } });
  if (finalized.status !== 'committed') throw new Error(`RL-32b ordering finalize did not commit: ${JSON.stringify(finalized)}`);

  await writeFile(join(fixture.workspaceRoot, 'src', 'input.txt'), 'RL-32b ordering source v2\n');
  const predecessor = finalized.value.snapshot;
  const successor = await platform.evidence.reverifyRound!(automationCtx(fixture.ctx, fixture.scope), {
    input: { predecessorRoundRef: predecessor.ref },
    meta: { requestId: 'rl32b-order-reverify', expected: [{ ref: predecessor.ref, revision: predecessor.revision }] } });
  if (successor.status !== 'committed' || successor.value.kind !== 'reverified') {
    throw new Error(`RL-32b ordering reverify did not open a successor: ${JSON.stringify(successor)}`);
  }

  const page = await platform.decisions.queryDecisionQueue(fixture.ctx, {
    workspace: fixture.scope, sections: ['notices'], categories: ['automatic_rework'], page: { limit: 50 } });
  if (page.status !== 'ready') throw new Error(`RL-32b ordering notice read failed: ${JSON.stringify(page)}`);
  const notice = page.value.notices.find((item) => item.category === 'automatic_rework' && item.rework?.operation === 'reverify');
  if (notice === undefined) throw new Error('RL-32b read no automatic-reverify notice');
  return { notice };
}

it('RL-32b (g) the sentence names the first cap hit by checkId, not execution or array order', async () => {
  const { notice } = await noticeAfterTwoCheckReverify();
  expect({ summary: notice.summary, actions: notice.actions }).toEqual({
    summary: `${TODAY} · 检查超出内存上限（当时上限 512 MiB）`, actions: [{ kind: 'raise_memory_cap' }] });
}, 120_000);

/**
 * 5(c)-5 (h), RE2: L-fixtures exception R10. The (e) dataset is real; only the
 * notice source's record port is wrapped at the storage boundary so that a read
 * whose keys include the trigger round's canonical key FAILS. The wrapper makes
 * no read succeed that would otherwise fail (precedent 2C-31 `failingReads`).
 */
async function requeueTriggerReadFailure(): Promise<ReadResult<DecisionQueueReadV1>> {
  let triggerKey: string | null = null;
  const original = automaticReworkNotices.createAutomaticReworkNoticeSource;
  vi.spyOn(automaticReworkNotices, 'createAutomaticReworkNoticeSource').mockImplementation((deps) => original({
    records: {
      readMany: async (keys) => {
        if (triggerKey !== null && keys.includes(triggerKey)) {
          return { status: 'rejected', code: 'unavailable', reason: 'RL-32b injected trigger round read failure' };
        }
        return deps.records.readMany(keys);
      },
      lookup: (request) => deps.records.lookup(request),
      lookupOrdered: (request) => deps.records.lookupOrdered(request),
    },
  }));

  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps: CAP_HIT,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32b-rev', artifactRefs: [] } });
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  cleanups.push(() => platform.close());

  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`RL-32b (h) open did not commit: ${JSON.stringify(opened)}`);
  const ran = await platform.checks.runRegisteredCheck(fixture.ctx, {
    input: { roundRef: opened.value.ref, checkId: fixture.passCheck.checkId },
    meta: { requestId: 'rl32b-h-run', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  if (ran.status !== 'ready') throw new Error(`RL-32b (h) check did not finish: ${JSON.stringify(ran)}`);
  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, { input: { roundRef: opened.value.ref },
    meta: { requestId: 'rl32b-h-finalize', expected: [{ ref: opened.value.ref, revision: ran.value.revision }] } });
  if (finalized.status !== 'committed') throw new Error(`RL-32b (h) finalize did not commit: ${JSON.stringify(finalized)}`);

  const goal = await platform.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goal.status !== 'ready') throw new Error('RL-32b (h) Goal read failed');
  const run = await platform.executions.readExecution(fixture.ctx, fixture.subjectRunRef);
  if (run.status !== 'ready') throw new Error('RL-32b (h) Run read failed');
  const requeued = await platform.claims.requeueTask!(automationCtx(fixture.ctx, fixture.scope), {
    meta: { requestId: 'rl32b-h-requeue', expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision },
      { ref: fixture.subjectRunRef, revision: run.value.run.revision }] },
    input: { taskRef: fixture.subject, afterRunRef: fixture.subjectRunRef, reason: 'the registered check failed; try again' } });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`RL-32b (h) automatic requeue was refused: ${JSON.stringify(requeued)}`);
  }

  triggerKey = canonicalJson(finalized.value.snapshot.ref as unknown as JsonValue);
  return await platform.decisions.queryDecisionQueue(fixture.ctx, {
    workspace: fixture.scope, sections: ['notices'], categories: ['automatic_rework'], page: { limit: 50 } });
}

it('RL-32b (h) a trigger-round read failure is unavailable, never a notice without the sentence', async () => {
  const result = await requeueTriggerReadFailure();
  expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
}, 120_000);
