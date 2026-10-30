/**
 * Q-recipe (book-7b.md §5 row 1226), SR6 §6.4: an `intervention_planning` Query on
 * Q's planning world — submit with the person's real message (without it: invalid,
 * no QueryJob), the intervention template and binding, and the parsed v2 answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { queryJobRefFor, type QueryJobRef, type QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryExecutionRecord } from '../../src/core/work-graph/queries/contracts.js';
import { parseInitialPlanningResponseV2 } from '../../src/contracts/initial-planning-parse.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF,
  graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { ready } from '../helpers/S5-application-support.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { claimQuery, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const refsOf = (suffix: string): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } => {
  const queryJobRef: QueryJobRef = queryJobRefFor(S6A_SCOPE.projectId, S6A_SCOPE.workspaceId, `${suffix}-job`);
  return { queryJobRef, queryRunRef: { aggregateType: 'QueryRun', ...S6A_SCOPE,
    queryJobId: queryJobRef.queryJobId, runId: `${suffix}-run` } };
};

async function personText(world: S6AHostWorld, messageRef: S7BPlanningWorld['messageRef']): Promise<string> {
  const body = (await world.post('messages/body', plain(S6A_SCOPE, { messageRef, part: 'message' }))).body as
    ReadResult<{ text: string }>;
  return ready<{ text: string }>(body).text;
}

async function submitPins(world: S6AHostWorld, goalRef: S7BPlanningWorld['goalRef'],
  refs: ReturnType<typeof refsOf>): Promise<unknown[]> {
  const goal = ready<{ goal: { revision: number } }>(
    (await world.post('goals/read', plain(S6A_SCOPE, goalRef))).body as ReadResult<{ goal: { revision: number } }>);
  return [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
    { ref: goalRef, revision: goal.goal.revision },
    { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 }];
}

async function submitPlanning(world: S6AHostWorld, planning: S7BPlanningWorld, question: string, suffix: string,
  sourceMessageRef: S7BPlanningWorld['messageRef'] | null): Promise<{ body: unknown } & ReturnType<typeof refsOf>> {
  const refs = refsOf(suffix);
  const body = await world.post('queries/submit', graphWrite(S6A_SCOPE, {
    queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId,
    intent: {
      schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
      workspaceId: S6A_SCOPE.workspaceId, goalId: planning.goalRef.goalId, question, focusTaskRefs: [],
      budget: AG2B_QUERY_BUDGET, multiTurn: { maxRounds: 1 }, correlationId: `${suffix}-corr`,
      execution: { kind: 'intervention_planning', roleBinding: S6A_WORK_ROLE_BINDING,
        runtimeBudget: AG2B_RUNTIME_BUDGET,
        ...(sourceMessageRef === null ? {} : { sourceMessageRef }) },
    },
  }, `${suffix}-submit`, await submitPins(world, planning.goalRef, refs)));
  return { body: body.body, ...refs };
}

async function openBody(world: S6AHostWorld, ref: unknown): Promise<string> {
  const opened = ready<{ body: string }>((await world.post('materials/open', plain(S6A_SCOPE, {
    ref, usage: 'historical_explanation',
  }))).body as ReadResult<{ body: string }>);
  return opened.body;
}

const PLANNING_ANSWER = JSON.stringify({ schemaVersion: 2, kind: 'needs_decision',
  summary: 'S7B3 planning answer', questions: ['Which scope should the plan take?'] });

describe('the intervention-planning Query recipe', () => {
  it('admits a real source message, renders the intervention template and parses the answer', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, messageRef, sessionRef } = planning;
    const text = await personText(world, messageRef);
    const submitted = await submitPlanning(world, planning, text, 'q-recipe', messageRef);

    expect(submitted.body).toMatchObject({ status: 'committed', value: {
      job: { job: { queryJobId: submitted.queryJobRef.queryJobId } } } });
    const stored = await readQuery(world.ag2b, submitted.queryJobRef);
    expect(stored.job.job.intent.execution).toMatchObject({
      kind: 'intervention_planning', sourceMessageRef: messageRef });

    const claimed = await claimQuery(world, submitted.queryJobRef, sessionRef, null, 'q-recipe-claim');
    expect(claimed).toMatchObject({ status: 'committed' });
    const prepared = await prepareAttempt(world, submitted.queryJobRef, 'q-recipe-prepare');
    const manifest = JSON.parse(await openBody(world, prepared.bundleRef)) as PreparedQueryManifestV1;
    expect(manifest.contextAssembly.callKind).toBe('intervention_planning');
    expect(manifest.contextAssembly.sectionOrder).toEqual(['role', 'goal', 'task']);
    expect(manifest.promptSet.toolNames.filter(name => ['write', 'edit', 'shell'].includes(name))).toEqual([]);
    expect(manifest.permissions.writeScope).toEqual([]);

    await world.scripted.script(sessionRef, [{ kind: 'text', text: PLANNING_ANSWER }]);
    const started = ready<QueryExecutionRecord>(
      await start(world, prepared, 'q-recipe-start') as unknown as ReadResult<QueryExecutionRecord>);
    const request = (await world.scripted.requests(sessionRef))[0];
    if (request === undefined) throw new Error('the planning Query served no model request');
    const first = request.messages[0] as { role: string; content: string };
    expect(first.role).toBe('user');
    const input = first.content;

    // The intervention template's five slots: prelude, role, goal, plan and message.
    expect(input.startsWith('# Verified read-only Query input')).toBe(true);
    expect(input).toContain('## Runtime context\n');
    expect(input).toContain('## Goal\n');
    // Hand-computed from the frozen fixtures: adoptS6BPlan's planId and revision, ag2bPlanDraft's two tasks.
    expect(input).toContain('plan: s6b-plan-s7b3-planning@1\n'
      + 'stages: (none)\n'
      + 'tasks: Independent work ag2b-work (ag2b-work), Goal gate (ag2b-gate)');
    // The message slot is the person's text; the goal section does not also render it.
    const questionAt = input.indexOf('## Question');
    expect(questionAt).toBeGreaterThan(0);
    expect(input.slice(0, questionAt)).not.toContain(text);
    expect(input.slice(questionAt)).toContain(`## Question\n${text}`);
    // The widened preparation condition appends the initial-planning answer guide.
    expect(input).toContain(`${text}\n\nReturn exactly one JSON object as your entire final answer, `
      + 'with schemaVersion 2 and kind "plan" or "needs_decision"');
    expect(input).not.toContain('## Footprint');

    const answerRef = started.answer?.ref;
    if (answerRef === undefined) throw new Error('the planning Query recorded no answer');
    const answer = ready<{ answer: { bodyRef: unknown } }>((await world.post('queries/answer',
      plain(S6A_SCOPE, answerRef))).body as ReadResult<{ answer: { bodyRef: unknown } }>);
    const parsed = parseInitialPlanningResponseV2(await openBody(world, answer.answer.bodyRef));
    expect(parsed.status).toBe('parsed');
    if (parsed.status !== 'parsed') throw new Error(`the planning answer did not parse: ${JSON.stringify(parsed)}`);
    expect(parsed.response).toMatchObject({
      schemaVersion: 2, kind: 'needs_decision', summary: 'S7B3 planning answer',
      questions: ['Which scope should the plan take?'],
    });
  });
});

describe('rejects: an intervention_planning submit without a source message', () => {
  it('is invalid and writes no QueryJob', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const submitted = await submitPlanning(planning.world, planning,
      await personText(planning.world, planning.messageRef), 'q-recipe-no-source', null);
    expect(submitted.body).toMatchObject({ status: 'rejected', code: 'invalid' });
    const read = (await planning.world.post('queries/read', plain(S6A_SCOPE, submitted.queryJobRef))).body as
      { status: string };
    expect(read.status).toBe('not_found');
  });
});
