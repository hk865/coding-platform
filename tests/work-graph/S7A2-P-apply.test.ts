/**
 * P-apply-rows (7a:235–:251, :728; A-11): the four effects' applied messages, the apply's own comparisons, the
 * receipt codes, the party rule, the original command's replay and the first-wins slot in both directions.
 * `appliedAt` is the effect's own event time, never the apply's clock. Every prior state comes from the frozen
 * fixture's public steps; the store is never read, and a receipt is the owner's own committed `proofReceipt`.
 *
 * Until L publishes `platform.messages.applyMessage`, each row's exercise ends on the one deferred named error
 * (`7a2-rgp-v7.md:241–:259`); L replaces only that last statement.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type {
  DecisionApplicationReceiptV1, EffectWriteResultV1, SessionMessageRef,
} from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { ReverifyOutcomeV1 } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import {
  AG2B_RESULT_FILE, AG2B_RESULT_TEXT, ag2bChecksConfiguration, ag2bPlanDraft, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow, post } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import {
  applyS7A2Message, callS7A2PublishedOwner, claimRequestS7A2, sendS7A2PersonMessage,
} from '../helpers/S7A2-fixture.js';
import {
  assertTaskCompleted, holdS7AQueryRound, openS7AWorkWorld, ready, S7A_REPLY_TOOLS,
} from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('P-apply-rows: claim_created', () => {
  it('the claim applies with the effect time and the caller proof, and a later refusal loses', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend: 'memory', extraBindings: [S7A_REPLY_TOOLS],
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR,
          command: 'echo S7A2_CHECKS_OK' }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await world.setResumeOnStartup(false);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-apply-claim-goal', 'S7A2 apply claim goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-apply-claim',
        taskIds: ['s7a2-apply-claim-1', 's7a2-apply-claim-2'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-apply-claim-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 apply claim first Task' }]);
      const first = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-claim-first', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'claim_task');
      await driveWorkflow(world.ag2b, first, { stopBefore: 'claim_task' });
      await assertTaskCompleted(world, goal, tasks[0]!.taskId);
      const message = await sendS7A2PersonMessage(world, { label: 'apply-claim', recipient: line.ref });
      const request = await claimRequestS7A2(world, { goal, line, label: 'apply' });
      const written = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as EffectWriteResultV1<TaskClaim>;
      if (written.status !== 'committed') throw new Error(`the claim is ${written.status}`);
      world.clock.advance(1_000);
      const receipt = written.proofReceipt!;
      const effect = { kind: 'claim_created' as const, ref: written.value.runRef };
      const applied = await applyS7A2Message(world, { message, effect, receipt, label: 'claim' });
      expect(applied).toMatchObject({ ref: message.ref, revision: message.revision + 1,
        appliedAt: written.value.claimedAt, applicationProof: { receipt, effect } });
      const before = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
        'the applied claim message');
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 's7a2-apply-refuse', name: 'respond_session_message',
          args: { messageRef: message.ref, expectedRevision: before.revision, reject: true,
            reason: 'S7A2 P-apply after apply' } }] },
        { kind: 'text', text: 'the refusal is saved' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-refuse', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: written.value.task.taskId }, { stopBefore: 'open_checks' });
      const refused = (await world.scripted.requests(line)).flatMap(request => request.messages
        .flatMap(entry => entry.role === 'tool' ? [{ callId: entry.callId, result: entry.result }] : []))
        .find(entry => entry.callId === 's7a2-apply-refuse')?.result;
      expect(refused).toMatchObject({ status: 'error',
        output: [{ kind: 'json', value: { status: 'rejected', code: 'revision_conflict' } }] });
      const read = await world.post('messages/read', plain(S6A_SCOPE, message.ref));
      expect(read.body).toMatchObject({ status: 'ready', value: { appliedAt: written.value.claimedAt,
        rejectedAt: null } });
    };
    await exercise();
  });
});

describe.each(['memory', 'sqlite'] as const)('P-apply-rows: the original command replay (%s)', backend => {
  it('the same apply command returns the first result on both backends', async () => {
    const exercise = async () => {
      const opened = await openS7AWorkWorld({ backend });
      worlds.push(opened.world);
      const { world, goal, line } = opened;
      const message = await sendS7A2PersonMessage(world, { label: 'apply-replay', recipient: line.ref });
      const request = await claimRequestS7A2(world, { goal, line, label: 'apply' });
      const written = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as EffectWriteResultV1<TaskClaim>;
      if (written.status !== 'committed') throw new Error(`the claim is ${written.status}`);
      const receipt = written.proofReceipt!;
      const effect = { kind: 'claim_created' as const, ref: written.value.runRef };
      const applied = await applyS7A2Message(world, { message, effect, receipt, label: 'replay' });
      const replay = await callS7A2PublishedOwner(world,
        { owner: 'messages.applyMessage', wave: '7a2-l', scope: S6A_SCOPE },
        graphWrite(S6A_SCOPE, { messageRef: message.ref, proof: { receipt, effect } },
          's7a2-apply-replay').request) as WriteResult<SessionMessage>;
      expect(replay).toMatchObject({ status: 'committed', replayed: true, value: applied });
    };
    await exercise();
  });
});

describe('P-apply-rows: requeue', () => {
  it('the acknowledged requeue applies with its own ref and receipt (memory)', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend: 'memory',
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-apply-requeue-goal', 'S7A2 apply requeue goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-apply-requeue',
        taskIds: ['s7a2-apply-requeue-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-apply-requeue-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 apply requeue first Task' }]);
      const message = await sendS7A2PersonMessage(world, { label: 'apply-requeue', recipient: line.ref });
      const step = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-requeue', sessionHint: line.ref, kind: 'select_work' as const }, 'requeue_task');
      if (step.kind !== 'perform' || step.operation.kind !== 'requeue_task') {
        throw new Error(`S7A2: the Workflow did not stop at requeue_task: ${step.kind}`);
      }
      const shell = await world.post('tasks/requeue', { scope: S6A_SCOPE, request: {
        ...step.operation.request, input: { ...step.operation.request.input, acknowledgement: message.ref } } });
      const written = shell.body as EffectWriteResultV1<TaskRequeueOutcomeV1>;
      if (written.status !== 'committed' || written.value?.kind !== 'requeued') {
        throw new Error(`the requeue is ${written.status}`);
      }
      const effect = { kind: 'requeue' as const, ref: written.value.requeue.ref };
      const applied = await applyS7A2Message(world, { message, effect, receipt: written.proofReceipt!, label: 'requeue' });
      expect(applied).toMatchObject({ ref: message.ref, applicationProof: { receipt: written.proofReceipt, effect } });
    };
    await exercise();
  });
});

describe('P-apply-rows: recheck', () => {
  it('the acknowledged recheck applies with the successor round ref and receipt (memory)', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend: 'memory',
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-apply-recheck-goal', 'S7A2 apply recheck goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-apply-recheck',
        taskIds: ['s7a2-apply-recheck-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-apply-recheck-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 's7a2-apply-result', name: 'edit', args: { mode: 'create',
          path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
        { kind: 'text', text: 'S7A2 apply recheck: the work is done' }]);
      const message = await sendS7A2PersonMessage(world, { label: 'apply-recheck', recipient: line.ref });
      const runCheck = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-recheck', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'run_check');
      await writeFile(join(world.ag2b.root, 'src', 'module.ts'),
        'export const ag2bMarker = "S7A2_APPLY_SOURCE_CHANGED";\n');
      const checked = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, runCheck));
      if (checked.status !== 'ready' || checked.value.next === null) throw new Error('the Workflow must finalize');
      const finalizeCall = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance',
        plain(S6A_SCOPE, checked.value.next));
      if (finalizeCall.status !== 'ready') throw new Error('the Workflow call was not ready');
      const reverifyStep = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-recheck-2', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'reverify_round');
      if (reverifyStep.kind !== 'perform' || reverifyStep.operation.kind !== 'reverify_round') {
        throw new Error(`S7A2: the Workflow did not stop at reverify_round: ${reverifyStep.kind}`);
      }
      const shell = await world.post('verification/reverify', { scope: S6A_SCOPE, request: {
        ...reverifyStep.operation.request,
        input: { ...reverifyStep.operation.request.input, acknowledgement: message.ref } } });
      const written = shell.body as EffectWriteResultV1<ReverifyOutcomeV1>;
      if (written.status !== 'committed' || written.value?.kind !== 'reverified') {
        throw new Error(`the recheck is ${written.status}`);
      }
      const effect = { kind: 'recheck' as const, ref: written.value.round.ref };
      const applied = await applyS7A2Message(world, { message, effect, receipt: written.proofReceipt!, label: 'recheck' });
      expect(applied).toMatchObject({ ref: message.ref, applicationProof: { receipt: written.proofReceipt, effect } });
    };
    await exercise();
  });
});

describe('P-apply-rows: proposal_created', () => {
  it('the acknowledged proposal applies with its own ref and receipt (memory)', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend: 'memory' });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-apply-propose-goal', 'S7A2 apply proposal goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-apply-propose',
        taskIds: ['s7a2-apply-propose-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-apply-propose-line', role: S6A_WORK_ROLE, tasks });
      const current = await main.activePlan(goal);
      if (current === null) throw new Error('S7A2_PRECONDITION: the Goal has no adopted Plan');
      const message = await sendS7A2PersonMessage(world, { label: 'apply-propose', recipient: created.ref });
      const workIds = current.tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
      const draft = { ...ag2bPlanDraft(workIds), planId: 's7a2-apply-plan', goalId: goal.goalId,
        planRevision: current.planRevision + 1 };
      const shell = await world.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef: goal,
        basedOn: current.ref, draft, reason: { text: 'S7A2 apply proposal', sources: [] },
        acknowledgement: message.ref }, 's7a2-apply-propose', []));
      const written = shell.body as EffectWriteResultV1<PlanProposal>;
      if (written.status !== 'committed') throw new Error(`the proposal is ${written.status}`);
      const effect = { kind: 'proposal_created' as const, ref: written.value.ref };
      const applied = await applyS7A2Message(world, { message, effect, receipt: written.proofReceipt!, label: 'proposal' });
      expect(applied).toMatchObject({ ref: message.ref, applicationProof: { receipt: written.proofReceipt, effect } });
    };
    await exercise();
  });
});

const COMPARISONS = ['wrong message', 'wrong kind', 'wrong ref', 'receipt identity', 'receipt fingerprint',
  'receipt cursor'] as const;

describe('rejects: P-apply-rows: the apply\'s own comparisons', () => {
  it.each(COMPARISONS)('rejects the %s and writes nothing', async variant => {
    const exercise = async () => {
      const opened = await openS7AWorkWorld({ backend: 'memory' });
      worlds.push(opened.world);
      const { world, goal, line } = opened;
      const message = await sendS7A2PersonMessage(world, { label: 'apply-other', recipient: line.ref });
      const other = await sendS7A2PersonMessage(world, { label: 'apply-other-second', recipient: line.ref });
      const request = await claimRequestS7A2(world, { goal, line, label: 'apply' });
      const written = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as EffectWriteResultV1<TaskClaim>;
      if (written.status !== 'committed') throw new Error(`the claim is ${written.status}`);
      const receipt = written.proofReceipt!;
      const effect = { kind: 'claim_created' as const, ref: written.value.runRef };
      await applyS7A2Message(world, { message, effect, receipt, label: 'comparisons' });
      const proof = variant === 'wrong kind'
        ? { receipt, effect: { kind: 'requeue', ref: effect.ref } }
        : variant === 'wrong ref'
          ? { receipt, effect: { kind: 'claim_created', ref: { ...effect.ref, runId: 'another-run' } } }
          : variant === 'receipt identity'
            ? { receipt: { ...receipt, identityKey: 'another-identity' }, effect }
            : variant === 'receipt fingerprint'
              ? { receipt: { ...receipt, fingerprint: 'another-fingerprint' }, effect }
              : variant === 'receipt cursor'
                ? { receipt: { ...receipt,
                  cursor: 'c9999999999' as DecisionApplicationReceiptV1['cursor'] }, effect }
                : { receipt, effect };
      const rejected = await callS7A2PublishedOwner(world,
        { owner: 'messages.applyMessage', wave: '7a2-l', scope: S6A_SCOPE },
        { input: { messageRef: variant === 'wrong message' ? other.ref : message.ref, proof },
          meta: { requestId: `s7a2-apply-${variant}`, expected: [] } });
      expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
      const read = await world.post('messages/read',
        plain(S6A_SCOPE, variant === 'wrong message' ? other.ref : message.ref));
      expect(read.body).toMatchObject({ status: 'ready', value: variant === 'wrong message'
        ? { revision: other.revision, appliedAt: other.appliedAt, rejectedAt: other.rejectedAt }
        : { revision: message.revision + 1, appliedAt: written.value.claimedAt } });
    };
    await exercise();
  });
});

describe('P-apply-rows: the party', () => {
  it('the person applies and a query_run caller is forbidden (memory)', async () => {
    const exercise = async () => {
      const opened = await openS7AWorkWorld({ backend: 'memory' });
      worlds.push(opened.world);
      const { world, goal, line } = opened;
      const message = await sendS7A2PersonMessage(world, { label: 'apply-party', recipient: line.ref });
      const request = await claimRequestS7A2(world, { goal, line, label: 'apply' });
      const written = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as EffectWriteResultV1<TaskClaim>;
      if (written.status !== 'committed') throw new Error(`the claim is ${written.status}`);
      const receipt = written.proofReceipt!;
      const effect = { kind: 'claim_created' as const, ref: written.value.runRef };
      await applyS7A2Message(world, { message, effect, receipt, label: 'party' });
      const forbidden = await holdS7AQueryRound(world, { label: 'apply-party', goalId: goal.goalId },
        async context => (world.platform.messages as unknown as {
          applyMessage: (ctx: CoreCallContext, request: unknown) => Promise<WriteResult<SessionMessage>>;
        }).applyMessage(context, {
          input: { messageRef: message.ref, proof: { receipt, effect } },
          meta: { requestId: 's7a2-apply-forbidden', expected: [] },
        }));
      expect(forbidden).toMatchObject({ status: 'rejected', code: 'forbidden' });
    };
    await exercise();
  });

  it('a refusal committed first blocks a later apply (memory)', async () => {
    const exercise = async () => {
      const world = await openS6AHostWorld({ backend: 'memory', extraBindings: [S7A_REPLY_TOOLS],
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR,
          command: 'echo S7A2_CHECKS_OK' }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await world.setResumeOnStartup(false);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-apply-refused-goal', 'S7A2 apply refused goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-apply-refused',
        taskIds: ['s7a2-apply-refused-1', 's7a2-apply-refused-2'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-apply-refused-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 apply refused first Task' }]);
      const first = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-refused-first', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'claim_task');
      await driveWorkflow(world.ag2b, first, { stopBefore: 'claim_task' });
      await assertTaskCompleted(world, goal, tasks[0]!.taskId);
      const message = await sendS7A2PersonMessage(world, { label: 'apply-refused', recipient: line.ref });
      const before = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
        'the refused-first message');
      const request = await claimRequestS7A2(world, { goal, line, label: 'apply' });
      const claim = await callS7A2PublishedOwner(world,
        { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE },
        { ...request, input: { ...request.input, acknowledgement: message.ref } }) as EffectWriteResultV1<TaskClaim>;
      if (claim.status !== 'committed') throw new Error(`the claim is ${claim.status}`);
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 's7a2-apply-reject-first', name: 'respond_session_message',
          args: { messageRef: message.ref, expectedRevision: before.revision, reject: true,
            reason: 'S7A2 P-apply refused first' } }] },
        { kind: 'text', text: 'the refusal is saved' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-apply-reject-first', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: claim.value.task.taskId }, { stopBefore: 'open_checks' });
      const refused = (await world.scripted.requests(line)).flatMap(request => request.messages
        .flatMap(entry => entry.role === 'tool' ? [{ callId: entry.callId, result: entry.result }] : []))
        .find(entry => entry.callId === 's7a2-apply-reject-first')?.result;
      expect(refused).toMatchObject({ status: 'success',
        output: [{ kind: 'json', value: { status: 'committed' } }] });
      const applied = await callS7A2PublishedOwner(world,
        { owner: 'messages.applyMessage', wave: '7a2-l', scope: S6A_SCOPE },
        graphWrite(S6A_SCOPE, { messageRef: message.ref, proof: { receipt: claim.proofReceipt!,
          effect: { kind: 'claim_created', ref: claim.value.runRef } } },
        's7a2-apply-refused-first').request);
      expect(applied).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const read = await world.post('messages/read', plain(S6A_SCOPE, message.ref));
      expect(read.body).toMatchObject({ status: 'ready', value: { appliedAt: null, rejectedAt: expect.any(String) } });
    };
    await exercise();
  });
});
