/**
 * A request made before the workspace has any goal counts in the workspace-scope
 * calendar only: its round's two real tool calls are two Query steps in that
 * day's cell, no goal's calendar holds them (neither of the two goals created
 * after it), and the per-Query activity read names no goal. The workspace is the
 * cards world's second one, which has no goal until the test creates one; its
 * round is run by the Host's own request driver with a scripted model that calls
 * the real `read` tool twice; every read names that workspace, and every
 * expected number is hand-computed (spec `slice-6-SPEC.md:421`, L16).
 *
 * The scripted model reaches the Host through an in-test wrapper of the Host's
 * configuration (rule sheet A8: the runtime configuration's model provider):
 * `createLocalWorkbenchHost` is the real one, called with the provider registry
 * replaced by one whose `create` answers this file's scripted model while a
 * test has set it, and with the options otherwise unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { ActivityCalendarV1, QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { waitFor } from './harness.js';
import { openS6ACardsWorld, type S6ACardsWorkspace, type S6ACardsWorld } from '../helpers/S6A-cards-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { ensureProjectPointers } from '../helpers/S6A-host-fixture.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';
import { createBe1ScriptedModel } from '../helpers/S2B-be1-platform-fixture.js';

/** The model client the Host's provider registry answers while a test has set it (null: the world's own). */
const injected = vi.hoisted(() => ({ client: null as null | ModelClientPort }));

vi.mock('../../src/app/host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/host.js')>();
  return { ...actual,
    createLocalWorkbenchHost: (options: Parameters<typeof actual.createLocalWorkbenchHost>[0]) => {
      const provider = options.runtimeProvider;
      const registry = provider?.registry;
      if (provider === undefined || registry === undefined) return actual.createLocalWorkbenchHost(options);
      return actual.createLocalWorkbenchHost({ ...options, runtimeProvider: { ...provider, registry: {
        get: id => registry.get(id),
        create: (id, clientOptions) => injected.client ?? registry.create(id, clientOptions),
      } } });
    } };
});

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
const worlds: S6ACardsWorld[] = [];

afterEach(async () => {
  injected.client = null;
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
});

/** The cards world opens on 2026-10-23 (the request world's first instant); the request is made at 10:00. */
const DAY = { from: '2026-10-23T00:00:00.000Z', to: '2026-10-24T00:00:00.000Z' };
const SUBMIT_AT = '2026-10-23T10:00:00.000Z';

async function calendar(workspace: S6ACardsWorkspace, scope: { kind: 'goal'; goalRef: GoalRef } | { kind: 'workspace' }):
  Promise<ActivityCalendarV1> {
  const body = await workspace.route('activity/calendar', { scope, ...DAY, granularity: 'hour', timeZone: 'UTC' }) as
    ReadResult<ActivityCalendarV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

async function queryActivity(workspace: S6ACardsWorkspace, runRef: QueryRunRef): Promise<QueryActivityViewV1> {
  const body = await workspace.route('activity/queries', { refs: [runRef] }) as ReadResult<QueryActivityViewV1[]>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/queries was not ready: ${JSON.stringify(body)}`);
  const view = body.value[0];
  if (view === undefined) throw new Error('S6A: activity/queries returned no view');
  return view;
}

/** The round's QueryRun through this workspace's `queries/read`. */
async function queryRunOf(workspace: S6ACardsWorkspace, round: QueryJobRef): Promise<QueryRunRef> {
  const body = await workspace.route('queries/read', round) as ReadResult<QueryJobRecord>;
  if (body.status !== 'ready') throw new Error(`S6A: queries/read was not ready: ${JSON.stringify(body)}`);
  return body.value.run.ref;
}

type Round = { ref: QueryJobRef; status: string; answer: string | null; session: unknown };
type Request = { goalId: string | null; effectiveGoalId: string | null; rounds: Round[] };

describe.each(BACKENDS)('R-17: a request made before any goal (%s)', (backend: S6ABackend) => {
  it('counts in the workspace calendar only, not in either goal created after it, and its activity view reads goalId null', async () => {
    // The round's model: two real `read` calls, then the answer.
    const scripted = createBe1ScriptedModel([
      { kind: 'calls', calls: [{ callId: 's6a-nogoal-read-1', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'calls', calls: [{ callId: 's6a-nogoal-read-2', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A no-goal answer' }) },
    ]);
    injected.client = scripted.client;
    const cards = await openS6ACardsWorld({ backend, extraHostOptions: { requestDriver: 'on' } });
    worlds.push(cards);
    // The project's two pointers, so the round is the secretary's semantic query with the strict answer.
    await ensureProjectPointers(cards.world);
    const workspace = cards.second;
    expect((await calendar(workspace, { kind: 'workspace' })).totals).toMatchObject({ steps: 0, querySteps: 0 });

    // The request, made while the workspace has no goal, at 10:00 (the submit moves the clock one second; the Kernel's
    // clock then stays, so both calls fall in the 10:00 cell); the Host's driver runs its round on the line it opens.
    cards.world.clock.set(SUBMIT_AT);
    const request = await workspace.submit({ label: 'nogoal', goalId: null, text: 'S6A no-goal request' });
    const view = await waitFor(async () => await workspace.readRequest(request.requestRoot) as Request,
      current => current.rounds[0]?.status === 'ended', 'the no-goal round answers');
    expect(view.rounds[0]).toMatchObject({ status: 'ended', answer: 'S6A no-goal answer', session: request.secretary });
    expect(view.goalId).toBeNull();
    expect(view.effectiveGoalId).toBeNull();
    expect(scripted.calls()).toBe(3);

    // Then the workspace's two goals, through the public route.
    const goals = [await workspace.createGoal('s6a-nogoal-first'), await workspace.createGoal('s6a-nogoal-second')];

    const runRef = await queryRunOf(workspace, request.round);
    expect(await queryActivity(workspace, runRef)).toMatchObject({
      queryRunRef: runRef, status: 'counted', reason: null, error: false,
      totals: { steps: 2, edits: 0 }, recordedBy: 'query_end',
      sessionRef: request.secretary, askedSessionRef: null, goalId: null,
    });

    // The workspace scope holds the two steps (+2 on the day), in the 10:00 cell, as Query steps.
    const whole = await calendar(workspace, { kind: 'workspace' });
    const ten = whole.cells.find(cell => cell.localHour === 10);
    if (ten === undefined) throw new Error(`S6A: no 10:00 cell: ${JSON.stringify(whole.cells)}`);
    expect({ steps: ten.steps, querySteps: ten.querySteps, edits: ten.edits, complete: ten.complete })
      .toEqual({ steps: 2, querySteps: 2, edits: 0, complete: true });
    expect(whole.totals).toMatchObject({ steps: 2, querySteps: 2, edits: 0 });

    // No goal's calendar holds it: neither goal of this workspace.
    for (const goal of goals) {
      const read = await calendar(workspace, { kind: 'goal', goalRef: goal.ref });
      expect(read.totals).toMatchObject({ steps: 0, querySteps: 0 });
      expect(read.coverage.queries.runsCounted).toBe(0);
    }
  }, 120_000);
});
