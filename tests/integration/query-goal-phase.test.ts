import { afterEach, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerFixture } from '../verification/reviewer-fixture.js';
import { composeQueryDrive } from '../../src/composition/query-composition.js';
import { QueryExecutionContextCompiler, QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { QueryWorkspaceSourceReader } from '../../src/data/workspace-reader/query-workspace-source-reader.js';
import { selectQueryCollaborationFacts } from '../../src/data/context-compiler/query-collaboration-facts.js';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { buildReduceGoalCommand } from '../../src/contracts/commands/goal-phase.js';
import type { GoalPhaseSnapshot } from '../../src/contracts/goal-phase.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { P107_ROLE_BINDING_READER_V1, P107_SCHEMA } from '../contract-support/fixtures/workspace-fixtures.js';

const roots: string[] = [], runtimes: ReadOnlyQueryRuntime[] = [];
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function completedGoalQuery(externalSourceChange = false) {
  const s = await reviewerFixture(roots, { goalGate: true });
  const started = await s.service.startReview(s.scope, s.input), ref = started.review.work!.ref;
  const { packet } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
  expect((await s.service.resumeReview(s.scope, { requestId: s.input.requestId })).review.formal.goalPhase).toBe('COMPLETED');
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: s.scope.projectId, goalId: s.scope.goalId };
  const loaded = await s.h.ledger.load(phaseRef);
  if (loaded.status !== 'found') throw Error('Formal GoalPhase missing');
  const phase = loaded.snapshot as GoalPhaseSnapshot;
  expect(phase.phase).toBe('COMPLETED');
  await s.h.advanceProjection();
  expect(await s.h.goalStatus(s.scope)).toMatchObject({ status: 'ready', goal: { phase: 'COMPLETED', aggregateRevision: phase.revision } });
  if (externalSourceChange) await writeFile(join(s.root, 'after-acceptance.ts'), 'export const unverifiedChange = true;\n');
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request)); const common = { schemaVersion: 1 as const, requestId: request.requestId };
    yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: 'Labelled protocol fixture; semantic quality is not evaluated.', basis: [] }] }) };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
  const runtime = new ReadOnlyQueryRuntime(join(s.directory, 'goal-query'), {
    materials: new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault }), rootFor: () => s.root,
    bind: async () => ({ configuration: { provider: 'deepseek', model: 'goal-query-stub', baseUrl: 'http://127.0.0.1', revision: 'test' }, client }),
  });
  runtimes.push(runtime); await runtime.init();
  const drive = composeQueryDrive({ ledger: s.h.ledger, control: s.h.control, vault: s.h.vault, context: s.h.queryContext, runtime, now: () => P107_SCHEMA }, () => s.h.advanceProjection());
  expect(await s.h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: 'completed-query', aggregateId: 'completed-query', expectedRevision: 0,
    correlationId: 'completed-query', submittedAt: P107_SCHEMA, identity: { projectId: s.scope.projectId, actor: { kind: 'human', id: 'user' }, idempotencyKey: 'completed-query' },
    payload: { runId: 'completed-query-run', intent: { schemaVersion: 1, intentId: 'completed-query', projectId: s.scope.projectId, workspaceId: s.scope.workspaceId,
      goalId: s.scope.goalId, question: '当前正式Goal状态是什么？请引用已持久化的完成事实，并说明不能从运行自述推出的事项。', focusTaskRefs: [],
      budget: { maxTokens: 128000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'completed-query',
      execution: { kind: 'semantic_query', roleBinding: P107_ROLE_BINDING_READER_V1, runtimeBudget: DEFAULT_RUNTIME_BUDGET } } } })).toMatchObject({ status: 'committed' });
  expect(await drive.driveQuery({ reason: 'after-formal-completion' })).toMatchObject({ started: 1, answered: 1, failures: [] });
  expect(requests).toHaveLength(1);
  const actual = requests[0]!.messages.find(m => m.role === 'user' && m.content.includes('"semantic_query"'));
  if (!actual || actual.role !== 'user') throw Error('Actual model input missing');
  return { s, phase, phaseRef, runtime, input: JSON.parse(actual.content) };
}

it('a formal GoalGate completion reaches the actual public Query model input without asking the model to reduce tasks', async () => {
  const { input, phase } = await completedGoalQuery();
  expect(input.material.goalPhase).toMatchObject({ ref: phase.ref, revision: phase.revision, planRef: phase.planRef,
    phase: 'COMPLETED', reasonCodes: phase.reasonCodes, reducedAt: phase.reducedAt, matchesCurrentPlan: true });
  expect(input.material.goalPhase.authority).toContain('committed');
  expect(input.rules.join(' ')).not.toContain('Do not claim Task or Goal completion.');
}, 60000);

it('a new Query after external source changes cites recorded completion without treating Query freshness as renewed acceptance', async () => {
  const { s, input, phase, phaseRef, runtime } = await completedGoalQuery(true);
  expect(await s.h.ledger.load(phaseRef)).toMatchObject({ status: 'found', snapshot: phase });
  expect(input.material.goalPhase).toMatchObject({ phase: 'COMPLETED', matchesCurrentPlan: true, revision: phase.revision });
  const compiler = new QuerySourceContextCompiler({ ledger: () => s.h.ledger, observations: runtime.observations,
    source: new QueryWorkspaceSourceReader(() => s.root), architectureReviews: scope => architectureReviewView(s.h.ledger, scope) });
  expect((await compiler.currentness(s.scope.projectId, s.scope.workspaceId)).get('completed-query')).toBe(true);
  // The model really receives the distinction, even though Query freshness and
  // Plan identity both hold; this is an input-contract test, not model quality.
  expect(input.material.goalPhase.authority).toContain('does not prove acceptance of the currently observed source');
  // The authority record above carries the source-applicability limitation;
  // role presentation no longer duplicates the old long rules paragraph.
}, 60000);

it('a GoalPhase-only new reduction invalidates the previous Query even when Goal, Task and native source stay unchanged', async () => {
  const { s, phase, phaseRef, runtime, input } = await completedGoalQuery();
  const compiler = new QuerySourceContextCompiler({ ledger: () => s.h.ledger, observations: runtime.observations, source: new QueryWorkspaceSourceReader(() => s.root), architectureReviews: scope => architectureReviewView(s.h.ledger, scope) });
  const current = async () => (await compiler.currentness(s.scope.projectId, s.scope.workspaceId)).get('completed-query');
  expect(await current()).toBe(true);
  const goalBefore = await s.h.ledger.load(input.material.goalContext.ref);
  expect(await s.h.reduceGoal(buildReduceGoalCommand({ projectId: s.scope.projectId, goalId: s.scope.goalId, expectedRevision: phase.revision,
    commandId: 'new-goal-phase', idempotencyKey: 'new-goal-phase', correlationId: 'goal-query', submittedAt: P107_SCHEMA, actor: { kind: 'system', id: 'goal-reducer' } }))).toMatchObject({ status: 'committed' });
  expect(await s.h.ledger.load(input.material.goalContext.ref)).toEqual(goalBefore);
  expect(await s.h.ledger.load(phaseRef)).toMatchObject({ status: 'found', snapshot: { revision: phase.revision + 1, phase: 'COMPLETED' } });
  expect(await current()).toBe(false);
}, 60000);

it('keeps missing or historical GoalPhase explicit and rejects a cross-Goal returned snapshot', async () => {
  const { s, input, phase } = await completedGoalQuery();
  let selected: GoalPhaseSnapshot | null = { ...phase, planRef: { ...phase.planRef!, planId: 'previous-plan' } };
  const ledger = { load: async (ref: Parameters<typeof s.h.ledger.load>[0]) => ref.aggregateType === 'GoalPhase'
    ? selected ? { status: 'found' as const, snapshot: selected } : { status: 'not_found' as const, ref }
    : s.h.ledger.load(ref) };
  const read = () => selectQueryCollaborationFacts({ ledger }, s.scope, input.material.acceptedPlan);
  expect((await read()).goalPhase).toMatchObject({ phase: 'COMPLETED', planRef: { planId: 'previous-plan' }, matchesCurrentPlan: false });
  selected = null; expect((await read()).goalPhase).toBeNull();
  selected = { ...phase, ref: { ...phase.ref, goalId: 'another-goal' } };
  await expect(read()).rejects.toThrow();
}, 60000);
