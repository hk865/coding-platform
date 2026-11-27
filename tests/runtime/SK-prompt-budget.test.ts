/**
 * SK T1–T3: the planning request sizes. The expected values are the SK ruling's
 * frozen 110,279 target (budget 111,616 minus 1,337) for the two 128k guard rows
 * T2 and T3, and the anchors K2, K3, K4 and K9; the measured input is the real
 * Query record's `prompt.selection.inputTokens`, never a scripted model's usage
 * report.
 *
 * T1a is the 1M positive row: the adviser planning round opens and carries the
 * four anchors. The original 128k T1 row is deleted. T2 and T3 remain the 128k
 * guard rows with the 110,279 target. The worlds are the frozen S6B3 goal-card
 * world opened on the model the row selects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapExecutionQueryProfile } from '../../src/app/core-http-types.js';
import type { HandleInterventionResultV1 } from '../../src/business/workflow/ports.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { interventionPlanningQueryRefs, type QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { AG2B_CONSUMER_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
import {
  configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, valueOf,
  type S6B3World, type S6B3Workspace,
} from '../helpers/S6B3-fixture.js';

/** The SK ruling's target: 111,616 budget minus the 1,337 target margin. */
const TARGET_INPUT_TOKENS = 110_279;
/** The three DeepSeek model names the Host gives 1M; every other name gets 128k. */
const SMALL_MODEL = 'deepseek-chat';
const WIDE_MODEL = 'deepseek-v4.1-flash';

type BudgetWorld = { world: S6B3World; second: S6B3Workspace };

const worlds: S6B3World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

/**
 * The S6B3 world on the 128k model by default, or on the 1M window when
 * `modelName` is WIDE_MODEL: `models/save` replaces the catalog's one model with
 * a DeepSeek name, then the second workspace is opened through the Host's own
 * settings route with two Goals. Every profile the scope publishes then carries
 * the model's window and the normal 16,384 output reserve.
 */
async function openBudgetWorld(label: string, modelName = SMALL_MODEL): Promise<BudgetWorld> {
  const world = await openS6B3World({ backend: 'memory', mainGoals: 'none' });
  worlds.push(world);
  const snapshot = await world.host.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error(`SK: the settings snapshot is not ready: ${JSON.stringify(snapshot)}`);
  const model = snapshot.value.models[0];
  if (model === undefined) throw new Error('SK: the Host catalog has no model');
  const saved = await world.host.settings('models/save', {
    id: model.id, label: model.label, provider: 'deepseek', model: modelName,
  });
  if (saved.status !== 'ready') throw new Error(`SK: models/save was refused: ${JSON.stringify(saved)}`);
  const second = await configureS6B3SecondWorkspace(world, { name: label, goals: 2 });
  const window = modelName === WIDE_MODEL ? 1_000_000 : 128_000;
  if (second.profile.runtimeBudget.contextWindowTokens !== window) {
    throw new Error(`SK: the scope's secretary profile is not on the ${window} window: ${JSON.stringify(second.profile.runtimeBudget)}`);
  }
  return { world, second };
}

function adviserProfileOf(world: S6B3World, scope: { projectId: string; workspaceId: string }):
Promise<BootstrapExecutionQueryProfile> {
  return world.host.readProfiles().then(profiles => {
    const profile = profiles.find(candidate => candidate.scope.projectId === scope.projectId
      && candidate.scope.workspaceId === scope.workspaceId
      && candidate.sessionRole.kind === 'legacy_template'
      && candidate.sessionRole.templateId === platformRoleProfile('adviser').template.templateId);
    if (profile === undefined) throw new Error(`SK: the scope ${scope.workspaceId} publishes no adviser profile`);
    return profile;
  });
}

async function sendPersonMessage(world: S6B3World, scope: { projectId: string; workspaceId: string },
  recipient: { projectId: string; sessionId: string }, goal: GoalRef, label: string): Promise<SessionMessage> {
  return committed<SessionMessage>(await world.host.post('messages/send', graphWrite(scope, {
    recipient, text: 'refine this segment please', entry: 'person_intervention', needsReply: true, goalRef: goal,
  }, `sk-send-${label}`)), `the message ${label}`);
}

function requestInputTokens(record: QueryJobRecord): number | undefined {
  return record.run.run.executionState?.requests[0]?.prompt.selection.inputTokens;
}

describe('SK T1–T3: the planning prompt budget', () => {
  it('T1a the adviser planning round opens at 1M and carries K2, K3, K4 and K9', async () => {
    const { world, second } = await openBudgetWorld('sk-t1a', WIDE_MODEL);
    const adviser = await adviserProfileOf(world, second.scope);
    expect(adviser.runtimeBudget.contextWindowTokens).toBe(1_000_000);
    const line = await createS6BLine(s6aCardsWorkspace(world.host, second.scope),
      { label: 'sk-t1a-adviser', role: adviser.sessionRole });
    const goal = second.goals[0]!;
    const sent = await sendPersonMessage(world, second.scope, line.ref, goal.ref, 't1a');
    world.host.scriptReplies([{ kind: 'text', text: JSON.stringify({
      schemaVersion: 2, kind: 'needs_decision', summary: 'SK T1a refine', questions: ['Which segment?'],
    }) }]);
    const about = { messageRef: sent.ref, roleBinding: adviser.roleBinding, runtimeBudget: adviser.runtimeBudget,
      budget: adviser.budget, consumerId: adviser.consumerId };
    let result: HandleInterventionResultV1 | undefined;
    for (let step = 0; step < 12; step += 1) {
      result = await world.host.platform.workflow.handleIntervention!(world.host.humanContext(), about);
      if (result.status !== 'progressed' && result.status !== 'queued') break;
    }
    expect(result, 'SK T1a: the intervention never settled').toBeDefined();
    const refs = interventionPlanningQueryRefs(sent.ref, second.scope.workspaceId);
    const record = valueOf<QueryJobRecord>((await world.host.post('queries/read',
      plain(second.scope, refs.queryJobRef))).body, 'ready', 'the T1a Query read');
    expect.soft(record.run.run.outcome, `T1a ①: ${JSON.stringify(record.job.job.closeReason)}`).toBe('answered');
    expect.soft(requestInputTokens(record), 'T1a ②: an input estimate').toBeDefined();
    const bundle = record.run.run.executionState?.prepared?.bundleRef;
    if (bundle === undefined) throw new Error('SK T1a: no bundle');
    const opened = valueOf<{ body: string }>((await world.host.post('materials/open',
      plain(second.scope, { ref: bundle, usage: 'historical_explanation' }))).body, 'ready', 'the T1a bundle');
    const input = (JSON.parse(opened.body) as { input: string }).input;
    for (const anchor of ['goal-scoped work counts for no stage gate',
      'when the change replaces or drops what a task does',
      'a validation problem is never a reason to answer questions',
      'double quotes eat one backslash']) {
      expect.soft(input, `T1a ③: ${anchor}`).toContain(anchor);
    }
  }, 180_000);

  it('T3 the secretary planning round fits 110,279 at 128k', async () => {
    const { world, second } = await openBudgetWorld('sk-t3');
    const profile = second.profile;
    const line = await createS6BLine(s6aCardsWorkspace(world.host, second.scope),
      { label: 'sk-t3-secretary', role: profile.sessionRole });
    const goal = second.goals[0]!;
    const sent = await sendPersonMessage(world, second.scope, line.ref, goal.ref, 't3');
    const registration = valueOf<{ project: { revision: number }; workspace: { revision: number } }>(
      (await world.host.post('workspaces/registration', plain(second.scope, second.scope))).body,
      'ready', 'the T3 registration');
    const queryJobId = 'sk-t3-plan';
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: second.scope.projectId,
      workspaceId: second.scope.workspaceId, queryJobId };
    const queryRunRef = { aggregateType: 'QueryRun' as const, projectId: second.scope.projectId,
      workspaceId: second.scope.workspaceId, queryJobId, runId: 'sk-t3-run' };
    const intent = {
      schemaVersion: 1, intentId: queryJobId, projectId: second.scope.projectId,
      workspaceId: second.scope.workspaceId, goalId: goal.ref.goalId,
      question: 'refine this segment please', focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: 'sk-t3-correlation',
      execution: { kind: 'intervention_planning', answerShape: 'plan_round',
        sourceMessageRef: sent.ref, roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
    };
    const submitted = (await world.host.post('queries/submit', graphWrite(second.scope, {
      queryJobId, runId: queryRunRef.runId, intent,
    }, 'sk-t3-submit', [
      { ref: { aggregateType: 'Project', projectId: second.scope.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...second.scope }, revision: registration.workspace.revision },
      { ref: goal.ref, revision: goal.revision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ]))).body;
    const query = valueOf<QueryJobRecord>(submitted, 'committed', 'the T3 submit');
    const lineRevision = valueOf<{ record: { revision: number } }>((await world.host.post('sessions/read',
      plain(second.scope, line.ref))).body, 'ready', 'the T3 line revision').record.revision;
    valueOf((await world.host.post('queries/claim', graphWrite(second.scope, {
      queryRunRef: query.run.ref, sessionRef: line.ref,
    }, 'sk-t3-claim', [
      { ref: query.job.ref, revision: query.job.revision },
      { ref: query.run.ref, revision: query.run.revision },
      { ref: { aggregateType: 'Session' as const, projectId: line.ref.projectId, sessionId: line.ref.sessionId },
        revision: lineRevision },
    ]))).body, 'committed', 'the T3 claim');
    const prepared = valueOf<PreparedQueryExecution>(
      (await world.host.post('queries/prepare', plain(second.scope, { queryRunRef: query.run.ref,
        requestId: 'sk-t3-prepare' }))).body, 'ready', 'the T3 preparation');
    world.host.scriptReplies([{ kind: 'text', text: JSON.stringify({
      schemaVersion: 2, kind: 'needs_decision', summary: 'SK T3', questions: ['Which segment?'],
    }) }]);
    const started = (await world.host.post('queries/start', plain(second.scope, { prepared,
      consumerId: AG2B_CONSUMER_ID, requestId: 'sk-t3-start' }))).body;
    expect(started, 'T3: the planning round opens').toMatchObject({ status: 'ready', value: { run: { run: { status: 'answered' } } } });
    const record = valueOf<QueryJobRecord>((await world.host.post('queries/read',
      plain(second.scope, queryJobRef))).body, 'ready', 'the T3 Query read');
    const tokens = requestInputTokens(record);
    expect(tokens).toBeDefined();
    expect(tokens).toBeLessThanOrEqual(TARGET_INPUT_TOKENS);
  }, 180_000);

  it('T2 the secretary first request round fits 110,279 at 128k', async () => {
    const { world, second } = await openBudgetWorld('sk-t2');
    const goal = second.goals[0]!;
    const held = await holdS6B3RequestAnswer(world, { scope: second.scope, label: 'sk-t2', goalId: goal.ref.goalId,
      executionKind: 'initial_coordination', reply: () => ({ kind: 'text', text: JSON.stringify({
        schemaVersion: 2, kind: 'needs_decision', summary: 'SK T2', questions: ['Which first?'],
      }) }) });
    await held.release();
    const record = valueOf<QueryJobRecord>((await world.host.post('queries/read',
      plain(second.scope, held.round))).body, 'ready', 'the T2 Query read');
    const tokens = requestInputTokens(record);
    expect(tokens).toBeDefined();
    expect(tokens).toBeLessThanOrEqual(TARGET_INPUT_TOKENS);
  }, 180_000);
});
