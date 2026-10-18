/**
 * UR7 generalised / F-035 (K3 B3 ruling 4/answer 7): an answered-but-unapplied
 * CRR card is applied by the ONE real Workflow advance (`createWorkflow` +
 * public `advanceWork`), never by a direct `advanceReviewDisposition` call.
 * ② replays by the answer-derived identity (the CRR changed event is the same
 * commit), ③ records the formal receipt once. The crash between ② and ③ is a
 * real failed ③ commit injection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { createCommandRerunRequestApplicationAdapter } from '../../src/business/workflow/decision-actions.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

/** The REAL Workflow over this world's owners; only the answer path is wired. */
function workflowOf(world: K3ReviewCardWorld, flowId: string, message: SessionMessage,
  decisionMessages: K3ReviewCardWorld['decisions'] = world.decisions) {
  const f = world.fixture;
  const records = world.records;
  const reads = createRunStateReader({ records });
  const { authority } = createMaterialRecordReaders(records);
  const mailbox = new Map<string, SessionMessage>([[message.ref.messageId, message]]);
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('the CRR answer row never reads capabilities'),
    createSession: async () => unsupported('the CRR answer row stops before create_session'),
    readSessionHistory: async () => unsupported('no history'),
    readExecutionHistory: async () => unsupported('no history'),
    readTaskExecutionHistory: async () => unsupported('no history'),
    prepareExecution: async () => unsupported('the CRR answer row stops before prepare'),
    startRun: async () => unsupported('the CRR answer row stops before start'),
    observeRun: async () => unsupported('the CRR answer row never observes'),
    reviewCapability: async () => ({ status: 'available' }),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('a CRR answer row never opens checks'),
    readVerification: async () => unsupported('no round read'),
    beginCheck: async () => unsupported('no begin'),
    recordCheckResult: async () => unsupported('no record'),
    finalizeChecks: async () => unsupported('no finalize'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('no checks') };
  const dependencies: WorkflowDependencies = {
    tasks: f.b2.base.goals, plans: f.b2.base.plans, sessions: f.b2.base.sessionsPort,
    claims: f.b2.base.service, executions: reads, runtime, evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: { consumerId: flowId, bindings: [{
      workspace: WORKSPACE_SCOPE,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget,
    }] },
    goalSettings: createGoalSettingsService({ records, now: () => f.now(),
      newId: () => f.newId(), operatorActor: f.operatorActor }),
    decisionMessages: decisionMessages as never,
    decisionApplications: {
      command_rerun_request: createCommandRerunRequestApplicationAdapter(world.commandRerun),
    } as never,
    applicationReceipt: world.applicationReceipt,
    messages: { readMessage: async (_ctx: CoreCallContext, ref: SessionMessageRef) => {
      const found = mailbox.get(ref.messageId);
      return found === undefined
        ? { status: 'not_found' as const }
        : { status: 'ready' as const, value: found };
    } } as never,
    unknownCallReviews: {
      readReview: world.reviews.readReview.bind(world.reviews),
      settleReview: world.reviews.settleReview.bind(world.reviews),
    } as never,
  };
  return createWorkflow(dependencies);
}

/** The public state a no-growth assertion reads: the request and the saved answer. */
async function publicState(world: K3ReviewCardWorld,
  requestRef: Parameters<K3ReviewCardWorld['commandRerun']['readRequest']>[1]['ref'],
  source: Parameters<K3ReviewCardWorld['decisions']['readDecisionAnswer']>[1]['source']) {
  const request = await world.commandRerun.readRequest(world.fixture.ctx, { ref: requestRef });
  if (request.status !== 'ready') throw new Error(JSON.stringify(request));
  const answer = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source });
  if (answer.status !== 'ready' || answer.value.message === null) throw new Error(JSON.stringify(answer));
  return { request: request.value, message: answer.value.message };
}

describe('UR7/F-035: the one real Workflow advance applies a saved CRR answer', () => {
  it.each(['memory', 'sqlite'] as const)('F-035 (%s): a failed ③ is repaired by the public Workflow advance; a re-drive grows no revision', async kind => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', `ur7-${kind}`,
      [{ callId: `k3-ur7-call-${kind}`, command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, `k3-ur7-request-${kind}`);
    const card = await crrCardOf(world);
    world.failNextApplicationCommit('injected ③ failure');
    const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: '', annotations: [] },
      meta: { requestId: `k3-ur7-answer-${kind}`, expected: card.source.pins },
    });
    expect(answered).toMatchObject({ status: 'ready', value: { state: 'application_not_recorded',
      action: { status: 'committed', value: { state: 'allowed' } },
      application: { status: 'rejected' } } });
    if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') {
      throw new Error(JSON.stringify(answered));
    }
    const message = answered.value.answer.value;
    const before = await publicState(world, request.ref, card.source);
    expect(before.request.revision).toBe(request.revision + 1);
    expect(before.message.application).toBeNull();

    const workflow = workflowOf(world, `k3-ur7-${kind}`, message);
    const advanced = await workflow.advanceWork(world.fixture.ctx, { schemaVersion: 1,
      goalRef: GOAL_B, flowId: `k3-ur7-${kind}`, sessionHint: null, kind: 'select_work',
      answers: [{ kind: 'command_rerun_request', requestRef: request.ref,
        answerMessageRef: message.ref }] });
    expect(advanced, JSON.stringify(advanced)).toMatchObject({ status: 'ready', value: {
      state: 'advance',
      receipt: { kind: 'apply_review_disposition', result: { status: 'ready', value: {
        state: 'applied', action: { status: 'committed', replayed: true, value: { state: 'allowed' } },
        application: { status: 'committed' } } } },
      next: { kind: 'select_work' } } });
    // D27 (restored from the pre-rework line 59): the request's public read
    // says the first advance allowed it, not only that its revision moved.
    const read = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
    expect(read).toMatchObject({ status: 'ready', value: { state: 'allowed', revision: request.revision + 1 } });
    const applied = await publicState(world, request.ref, card.source);
    expect(applied.request.revision).toBe(request.revision + 1);
    expect(applied.message.application).not.toBeNull();
    expect(applied.message.revision).toBe(before.message.revision + 1);

    // ② and ③ replay by their identity: no public revision grows twice.
    const again = await workflow.advanceWork(world.fixture.ctx, { schemaVersion: 1,
      goalRef: GOAL_B, flowId: `k3-ur7-${kind}`, sessionHint: null, kind: 'select_work',
      answers: [{ kind: 'command_rerun_request', requestRef: request.ref,
        answerMessageRef: message.ref }] });
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'ready', value: {
      state: 'advance', receipt: { kind: 'apply_review_disposition',
        result: { status: 'ready', value: { state: 'applied',
          application: { status: 'committed' } } } } } });
    const replayed = await publicState(world, request.ref, card.source);
    expect(replayed.request.revision).toBe(applied.request.revision);
    expect(replayed.message.revision).toBe(applied.message.revision);
    expect(replayed.message.application).toEqual(applied.message.application);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('N-01 (%s): an unreadable saved CRR answer waits without writing', async kind => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const label = `n01-${kind}`;
    const record = await blockedRecord(world, 'k3-20-a', label,
      [{ callId: `${label}-call`, command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, `${label}-request`);
    const card = await crrCardOf(world);

    // Save only ①; Workflow must read this answer before applying ② or ③.
    const answered = await world.decisions.answerDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: '', annotations: [] },
      meta: { requestId: `${label}-crr-answer`, expected: card.source.pins },
    });
    expect(answered.status).toBe('committed');
    if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
    const message = answered.value;
    const before = await publicState(world, request.ref, card.source);
    expect(before.request).toMatchObject({ state: 'pending', revision: request.revision });
    expect(before.message.ref).toEqual(message.ref);
    expect(before.message.revision).toBe(message.revision);
    expect(before.message.application).toBeNull();

    let failedReads = 0;
    const workflow = workflowOf(world, label, message, {
      ...world.decisions,
      readDecisionAnswer: async (ctx, input) => {
        if (failedReads === 0 && input.source.kind === card.source.kind
          && input.source.key === card.source.key) {
          failedReads += 1;
          return { status: 'rejected', code: 'unavailable',
            reason: 'the saved answer is not readable' };
        }
        return world.decisions.readDecisionAnswer(ctx, input);
      },
    });
    const advanced = await workflow.advanceWork(world.fixture.ctx, { schemaVersion: 1,
      goalRef: GOAL_B, flowId: label, taskId: 'k3-20-a', sessionHint: null, kind: 'select_work',
      answers: [{ kind: 'command_rerun_request', requestRef: request.ref,
        answerMessageRef: message.ref }] });
    expect(failedReads).toBe(1);
    expect(advanced.status).toBe('ready');
    if (advanced.status !== 'ready') throw new Error(JSON.stringify(advanced));
    // Keep both M1-sensitive assertions observable in the same run.
    expect.soft(advanced.value).toMatchObject({ state: 'waiting', next: null });
    expect.soft(advanced.value.reason).toBe('unavailable: the saved answer is not readable');

    const after = await publicState(world, request.ref, card.source);
    expect(after.request.revision).toBe(before.request.revision);
    expect(after.message.revision).toBe(before.message.revision);
    expect(after.message.application).toEqual(before.message.application);
  });
});
