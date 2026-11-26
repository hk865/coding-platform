/**
 * SK T1–T3: the 128k planning request sizes. The expected values are the SK
 * ruling's frozen 110,279 target (budget 111,616 minus 1,337) and the anchors
 * K1–K9; the measured input is the real Query record's
 * `prompt.selection.inputTokens`, never a scripted model's usage report.
 *
 * T1 (the adviser planning round on its production grant) is held out of this
 * file until the 128k product question is answered. T2 and T3 are GREEN at the
 * base and guard the two secretary rounds. The worlds are the frozen S6B3
 * goal-card world opened on a 128k model, the same shape the P3 measure used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
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

type BudgetWorld = { world: S6B3World; second: S6B3Workspace };

const worlds: S6B3World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

/**
 * The S6B3 world on a 128k model: `models/save` replaces the catalog's one model
 * with a DeepSeek name the Host does not give 1M, then the second workspace is
 * opened through the Host's own settings route with two Goals. Every profile the
 * scope publishes then carries a 128k window and the normal 16,384 output reserve.
 */
async function openBudgetWorld(label: string): Promise<BudgetWorld> {
  const world = await openS6B3World({ backend: 'memory', mainGoals: 'none' });
  worlds.push(world);
  const snapshot = await world.host.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error(`SK: the settings snapshot is not ready: ${JSON.stringify(snapshot)}`);
  const model = snapshot.value.models[0];
  if (model === undefined) throw new Error('SK: the Host catalog has no model');
  const saved = await world.host.settings('models/save', {
    id: model.id, label: model.label, provider: 'deepseek', model: SMALL_MODEL,
  });
  if (saved.status !== 'ready') throw new Error(`SK: models/save was refused: ${JSON.stringify(saved)}`);
  const second = await configureS6B3SecondWorkspace(world, { name: label, goals: 2 });
  if (second.profile.runtimeBudget.contextWindowTokens !== 128_000) {
    throw new Error(`SK: the scope's secretary profile is not on 128k: ${JSON.stringify(second.profile.runtimeBudget)}`);
  }
  return { world, second };
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

describe('SK T1–T3: the 128k planning prompt budget', () => {
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
