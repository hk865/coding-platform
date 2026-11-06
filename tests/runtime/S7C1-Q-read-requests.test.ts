/**
 * Q-read-requests: the one read-only request view over `MainSurfaceReadPort`.
 *
 * Every arm is one real secretary request round whose scripted model calls the
 * registered `read_requests` tool; the tool result is the JSON the next model
 * request carries. A's request and answer are visible to B on another secretary
 * line of the same Goal; C is the oldest of twenty-one requests and is read
 * through the `next` cursor (three requests give no next page); `requestRoot`
 * returns that one request; a real Work caller selects no `read_requests`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6AWorldOptions } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B, holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { openS7B2RoundWorld } from '../helpers/S7B2-secretary-rounds.js';
import { setS7D1Open } from '../helpers/S7D1-allocation-world.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { S7A_REPLY_TOOLS, sessionOf } from '../helpers/S7A-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { MainPageCursorV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { finalToolNamesOf, type FinalToolListInputV1 } from '../../src/core/agent-runtime/tool-group-assembly.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close().catch(() => undefined)));
});

/** The tool's own JSON value; a domain refusal is reported with the owner's code. */
function readValue<T>(value: unknown, what: string): T {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  if (record['status'] === 'rejected' || record['status'] === 'not_found' || record['status'] === 'not_ready') {
    throw new Error(`${what} was refused: ${JSON.stringify(value)}`);
  }
  return value as T;
}

type Held = { secretary: { ref: { projectId: string; sessionId: string } }; requestRoot: QueryJobRef;
  requests: ModelRequest[] };

/** One real round; `after` adds the next reply at a held later model request. */
async function runRound(world: S6AHostWorld, input: {
  label: string; goalId: string | null; first: S6AReply[];
  after?: Array<(request: ModelRequest) => S6AReply[] | null>;
}): Promise<Held> {
  let task: Promise<void> | undefined;
  const held = await holdS6BRequestRound(world, { label: input.label, goalId: input.goalId,
    replies: () => input.first }, async round => {
    const gates = [];
    for (const _ of input.after ?? []) gates.push(await world.gates.modelRequest(round.secretary));
    const run = (async () => {
      for (const [index, step] of (input.after ?? []).entries()) {
        const gate = gates[index]!;
        const request = await gate.reached;
        const replies = step(request);
        if (replies !== null) await world.scripted.script(round.secretary, replies);
        gate.release();
      }
    })();
    task = run;
    return { secretary: round.secretary, requestRoot: round.request.requestRoot };
  });
  await task;
  return { ...held.value, requests: await world.scripted.requests(held.value.secretary) };
}

const readRequestsCall = (callId: string, args: Record<string, unknown>) =>
  ({ kind: 'calls' as const, calls: [{ callId, name: 'read_requests', args }] });
const answerReply = (body: string) => ({ kind: 'text' as const, text: secretaryAnswer({ body }) });

type Page = { goalId: string; requests: readonly { requestRoot: QueryJobRef }[];
  next: MainPageCursorV1 | null };

/** A real Work caller whose own Host grant names `read_requests` still gets no read tool. */
async function expectNoWorkReadTool(): Promise<void> {
  const workOptions = { backend: 'memory' as const,
    extraBindings: [{ binding: S7A_REPLY_TOOLS.binding, mergeTools: ['read_requests'] }] } as
    S6AWorldOptions;
  const work = await openS6AHostWorld(workOptions);
  worlds.push(work);
  const ws = s6aCardsWorkspace(work, S6A_SCOPE);
  await governS6B(work, ws, work.goals);
  const goal = (await ws.createGoal('q-read-work-goal', 'Q read Work goal')).ref;
  const { tasks } = await adoptS6BPlan(ws, goal, { label: 'q-read-work',
    role: S6A_WORK_ROLE.templateId, taskIds: ['q-read-work-1'] });
  const line = await sessionOf(work, await createS6BLine(ws, { label: 'q-read-work-line',
    role: S6A_WORK_ROLE, tasks }));
  await work.scripted.script(line, [{ kind: 'text', text: 'Q read Work answer' }]);
  const claimInput = await advanceUntil(work.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'q-read-work',
    sessionHint: line.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(work.ag2b, claimInput, { stopBefore: 'open_checks', receipts });
  const start = receipts.find(entry => entry.kind === 'start')?.result as
    { status?: string; code?: string; reason?: string } | undefined;
  if (start?.status === 'committed' || start?.status === 'ready') {
    // A Work Run that did start still offers no read tool.
    const requests = await work.scripted.requests(line);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]!.tools.map(tool => tool.name)).not.toContain('read_requests');
  } else {
    // The Work path does not know the name at all: it refuses the start
    // instead of offering the Query-only tool.
    expect(start).toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(start?.reason).toContain('read_requests');
  }
  // The same assembly rule at its public entry: a Work selection naming the
  // Query-only tool produces a final list without it.
  const final = finalToolNamesOf({
    callKind: 'work', noteAdmission: { class: 'none' }, selected: ['read', 'read_requests'],
    readOnly: false, reviewPhase: null, hasBlockedCommands: false, reviewSource: false,
    frozenSource: false, materialTools: false,
    owners: { mailbox: true, decisionMessages: true, applicationReceipt: true, sessions: true,
      plans: true, graph: true, notes: true, unknownCallReviews: true, commandRerunRequests: true,
      memberCreation: true, reworkRequests: true, recheckRequests: true },
    readonlyCommand: { requested: false, access: undefined, allowsReadWholeWorkspace: false },
  } satisfies FinalToolListInputV1);
  expect(final.ok).toBe(true);
  if (!final.ok) return;
  expect(final.value).not.toContain('read_requests');
}

describe('Q-read-requests: the secretary reads the main request history', () => {
  it('pages one Goal, returns one request and stays out of a Work caller', async () => {
    await expectNoWorkReadTool();

    const options: S6AWorldOptions & { secretaryTools: readonly string[] } = {
      backend: 'memory', secretaryTools: ['read', 'read_requests'],
      extraHostOptions: { requestDriver: 'off' },
    };
    const paging = await openS7B2RoundWorld(options);
    try {
      const world = paging.world;
      await setS7D1Open(world, 'secretary', 32, 0, 's7c1-q-read-secretaries');
      const ws = s6aCardsWorkspace(world, S6A_SCOPE);
      const goalId = (await ws.createGoal('q-read-goal', 'Q read Goal')).ref.goalId;
      // C is the oldest of the Goal's requests.
      const c = await runRound(world, { label: 'q-read-c', goalId, first: [answerReply('Q read C answer')] });
      const a = await runRound(world, { label: 'q-read-a', goalId, first: [answerReply('Q read A visible answer')] });
      const b = await runRound(world, { label: 'q-read-b', goalId,
        first: [readRequestsCall('q-read-b-page', { goalId }), answerReply('Q read B answer')] });
      const firstPage = readValue<Page>(jsonOf(b.requests, 'q-read-b-page'), 'the same-Goal page');
      expect(firstPage.goalId).toBe(goalId);
      expect(firstPage.requests).toHaveLength(3);
      expect(firstPage.next).toBeNull();
      const aRow = firstPage.requests.find(row => row.requestRoot.queryJobId === a.requestRoot.queryJobId);
      if (aRow === undefined) throw new Error('the same-Goal read does not show the other line');
      expect(JSON.stringify(aRow)).toContain('Q read A visible answer');
      expect(firstPage.requests.some(row => row.requestRoot.queryJobId === c.requestRoot.queryJobId)).toBe(true);

      // Eighteen more requests of the same Goal: the Goal now has twenty-one.
      for (let index = 0; index < 18; index += 1) {
        const submitted = await world.submit({ commandId: `q-read-fill-${index}`, goalId,
          text: `Q read filler ${index}` });
        expect(submitted.status).toBe('queued');
      }

      // The reader is a no-goal secretary round, so it does not add a request to
      // the Goal it reads. Page one is full; C is the only row on page two.
      let pageOne: Page | undefined;
      const reader = await runRound(world, { label: 'q-read-page', goalId: null,
        first: [readRequestsCall('q-read-page-1', { goalId })],
        after: [(request) => {
          pageOne = readValue<Page>(jsonOf([request], 'q-read-page-1'), 'page one');
          if (pageOne.next === null) throw new Error('page one has no next page');
          return [readRequestsCall('q-read-page-2', { goalId, cursor: pageOne.next }), answerReply('Q read page answer')];
        }] });
      const pageTwo = readValue<Page>(jsonOf(reader.requests, 'q-read-page-2'), 'page two');
      if (pageOne === undefined) throw new Error('page one was not captured');
      expect(pageOne.requests).toHaveLength(20);
      expect(pageOne.next).not.toBeNull();
      expect(Object.keys(pageOne.next!).sort()).toEqual(['phase', 'rootKey', 'since']);
      expect(['goal', 'pre']).toContain(pageOne.next!.phase);
      expect(typeof pageOne.next!.since).toBe('string');
      expect(typeof pageOne.next!.rootKey).toBe('string');
      expect(pageTwo.requests).toHaveLength(1);
      expect(pageTwo.requests[0]?.requestRoot.queryJobId).toBe(c.requestRoot.queryJobId);
      expect(pageTwo.next).toBeNull();

      // `requestRoot` returns exactly that request, not a page.
      const byKey = await runRound(world, { label: 'q-read-root', goalId: null,
        first: [readRequestsCall('q-read-by-root', { requestRoot: a.requestRoot }), answerReply('Q read root answer')] });
      const rootRow = readValue<{ requestRoot: QueryJobRef; requests?: unknown }>(
        jsonOf(byKey.requests, 'q-read-by-root'), 'the by-key read');
      expect(rootRow.requestRoot.queryJobId).toBe(a.requestRoot.queryJobId);
      expect(rootRow.requests).toBeUndefined();
      expect(JSON.stringify(rootRow)).toContain('Q read A visible answer');
    } finally {
      await paging.world.close();
    }
  });
});
