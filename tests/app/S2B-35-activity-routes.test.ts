/**
 * Slice 2B BE5 / row 2B-35 (Group W): the five activity/timeline routes.
 *
 * What it builds and through which public calls:
 *   - a real SQLite RecordStore through `openS2BTrackFixture` (real Goal/Plan/
 *     Session/claim/execution-entry services); one real Run is claimed and ended
 *     through the real `TaskClaimPort`/`ExecutionEntryPort` and its `RunActivity`
 *     is written through the public `createRunActivityService`;
 *   - a second real SQLite store through `openS2BTimelineFixture` (its Goal/Plan
 *     through the real public Plan service) for the task-state timeline route,
 *     because the L11 read also consumes the session-anomaly index;
 *   - the four read owners (`createActivityReadModel`, `createTrackReadModel`,
 *     `createTaskStateTimeline`) over those stores;
 *   - the real HTTP seam (`createWorkbenchServer` over the real
 *     `createPlatformCoreRouteBindings`) for the plain read routes and for the
 *     storage-failure row; real `createLocalWorkbenchHost` instances for the
 *     human-admitted and no-lease `busy` rows;
 *   - the per-Query read through that seam with one `QueryRunRef` of this
 *     fixture's scope that no QueryRun record exists for, so the row names the
 *     route's wiring and leaves the populated views to the Query activity tests.
 *
 * Expected values come from the public reads (the route must return exactly what
 * the owner read returns), except the `activity/queries` rows, whose literals are
 * the L16 view of a Query with no history. The human-only row is asserted through
 * the real route binding with a non-Host principal, which the fixed Host actor
 * cannot express. No database reads and no model calls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type {
  ActivityCalendarV1, QueryActivityViewV1, RunActivityViewV1,
} from '../../src/core/work-graph/views/activity-read-model.js';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import type { TaskStateTimelinePageV1 } from '../../src/core/work-graph/views/task-state-timeline.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
} from '../../src/app/core-routes.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_PLACEHOLDER } from '../../src/app/core-http-types.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { acquireHostInstanceLease } from '../../src/app/host-instance-lease.js';
import { PLATFORM_TOKEN_META_NAME } from '../helpers/host-page.js';
import { createActivityReadModel } from '../../src/core/work-graph/views/activity-read-model.js';
import { createTrackReadModel } from '../../src/core/work-graph/views/track-read-model.js';
import { createTaskStateTimeline } from '../../src/core/work-graph/views/task-state-timeline.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { openS2BTimelineFixture, type S2BTimelineFixture } from '../helpers/S2B-task-timeline-fixture.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';

const TOKEN = 's2b-activity-routes-token';
const FAILURE_REASON = 's2b-activity-route-storage-read-failure';
/** The literal window the calendar/track rows read; quarter-aligned (L9). */
const FROM = '2026-09-24T00:00:00.000Z';
const TO = '2026-09-24T02:00:00.000Z';
const temporary: string[] = [];
let activityFixture: S2BTrackFixture;
let timelineFixture: S2BTimelineFixture;
let composed: Awaited<ReturnType<typeof createTargetPlatform>>;
let successServer: WorkbenchServer;
let failingServer: WorkbenchServer;
let routeBindings: ReturnType<typeof createPlatformCoreRouteBindings>;
let noLeaseHost: LocalWorkbenchHost | null = null;
let leasedHost: LocalWorkbenchHost | null = null;
let activityScope: { projectId: string; workspaceId: string };
let activityRun: RunRef;
let activityGoal: GoalRef;
let timelineScope: { projectId: string; workspaceId: string };
let timelineGoal: GoalRef;
type Reads = ReturnType<typeof createActivityReadModel> & ReturnType<typeof createTrackReadModel>;
let activityReads: Reads;
let timelineReads: ReturnType<typeof createTaskStateTimeline>;

afterAll(async () => {
  await successServer?.close().catch(() => undefined);
  await failingServer?.close().catch(() => undefined);
  await noLeaseHost?.close().catch(() => undefined);
  await leasedHost?.close().catch(() => undefined);
  await composed?.close().catch(() => undefined);
  await activityFixture?.close().catch(() => undefined);
  await timelineFixture?.close().catch(() => undefined);
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

function hostContext(scope: { projectId: string; workspaceId: string },
  actor: { kind: 'human' | 'system'; id: string }): CoreCallContext {
  return {
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor },
    signal: new AbortController().signal,
  };
}

async function post(base: string, suffix: string, scope: unknown, input: unknown): Promise<unknown> {
  return await postWithToken(base, TOKEN, suffix, scope, input);
}

async function postWithToken(base: string, token: string, suffix: string, scope: unknown, input: unknown): Promise<unknown> {
  const response = await fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify({ scope, input }),
  });
  return await response.json();
}


async function placeholderPublicDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 's2b-35-public-'));
  temporary.push(directory);
  await writeFile(join(directory, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  return directory;
}

/** The test-only storage wrapper (L-fixtures exception): every read fails as `unavailable`. */
function failingRecords(): { readMany: unknown; lookup: unknown; lookupOrdered: unknown; eventAt: unknown } {
  const fail = async () => ({ status: 'rejected' as const, code: 'unavailable' as const, reason: FAILURE_REASON });
  return { readMany: fail, lookup: fail, lookupOrdered: fail, eventAt: fail };
}

beforeAll(async () => {
  activityFixture = await openS2BTrackFixture('sqlite');
  const track = activityFixture;
  activityScope = { projectId: track.b2.base.scope.projectId, workspaceId: track.b2.base.scope.workspaceId };
  activityGoal = track.goalRef;
  // One real ended Run plus its real RunActivity (public service).
  activityRun = await track.runAndEnd('work-1', await track.newSession('s2b-35'),
    '2026-09-24T00:10:00.000Z', '2026-09-24T00:40:00.000Z');
  await track.writeActivity(activityRun, countedFacts({
    turnStartedAt: '2026-09-24T00:10:00.000Z', lastRecordAt: '2026-09-24T00:40:00.000Z',
    quarters: [{ at: '2026-09-24T00:15:00.000Z', steps: 5, edits: 2, editsUnknown: 0 }],
    changedFiles: { definite: ['src/a.ts'] },
  }));

  timelineFixture = await openS2BTimelineFixture('sqlite');
  timelineScope = { projectId: timelineFixture.ctx.projectId, workspaceId: timelineFixture.ctx.workspaceId! };
  timelineGoal = await timelineFixture.createGoal({ goalId: 's2b-35-timeline-goal', workTaskIds: ['work-1'] });

  const noWorkspace = {
    async resolveRoot() {
      return { status: 'rejected' as const, code: 'not_found' as const, reason: 'no route fixture workspace IO' };
    },
    async authorize() {
      return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no route fixture workspace IO' };
    },
  };
  composed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace });
  const now = () => B2_AT;
  activityReads = {
    ...createActivityReadModel({ records: track.records, now }),
    ...createTrackReadModel({ records: track.records, now }),
  };
  timelineReads = createTaskStateTimeline({ records: timelineFixture.records });
  routeBindings = createPlatformCoreRouteBindings({
    ...composed, activity: activityReads, timeline: timelineReads,
  } as unknown as Parameters<typeof createPlatformCoreRouteBindings>[0]);
  successServer = createWorkbenchServer({
    token: TOKEN, bindings: routeBindings, actor: { kind: 'human', id: 's2b-35-operator' },
    bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
    allowsScope: () => true,
  });
  await successServer.listen(0);

  // The failure row: the SAME real reads over a records port whose reads fail.
  const failing = failingRecords();
  failingServer = createWorkbenchServer({
    token: TOKEN,
    bindings: createPlatformCoreRouteBindings({
      ...composed,
      activity: { ...createActivityReadModel({ records: failing as never, now }),
        ...createTrackReadModel({ records: failing as never, now }) },
      timeline: createTaskStateTimeline({ records: failing as never }),
    } as unknown as Parameters<typeof createPlatformCoreRouteBindings>[0]),
    actor: { kind: 'human', id: 's2b-35-operator' },
    bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
    allowsScope: () => true,
  });
  await failingServer.listen(0);
}, 120_000);

function baseOf(server: WorkbenchServer): string {
  return `http://${server.address!.host}:${server.address!.port}`;
}

/** The one QueryRunRef the `activity/queries` rows name: a real scope, no QueryRun record. */
function missingQueryRef(): QueryRunRef {
  return { aggregateType: 'QueryRun', projectId: activityScope.projectId,
    workspaceId: activityScope.workspaceId, queryJobId: 's2b-35-missing', runId: 's2b-35-missing-run' };
}

/** A real leased Host over a fresh SQLite directory; returns it and its base/token. */
async function startHost(actor: { kind: 'human' | 'system'; id: string }, scope: { projectId: string; workspaceId: string },
  lock: boolean): Promise<{ host: LocalWorkbenchHost; base: string; token: string }> {
  const directory = await mkdtemp(join(tmpdir(), 's2b-35-host-'));
  temporary.push(directory);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'README.md'), '# s2b-35 host workspace\n');
  if (lock) {
    // The live peer is the real lease this process would hold: acquire it through
    // the production path and keep it, so the next Host reads a live pid.
    await acquireHostInstanceLease({ directory, now: () => B2_AT });
  }
  // PC-2 ruling 2: `<settings>/prompts` must not be under the workspace root.
  const settingsDirectory = await mkdtemp(join(tmpdir(), 's2b-35-settings-'));
  temporary.push(settingsDirectory);
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory },
    actor,
    publicDir: await placeholderPublicDirectory(),
    now: () => B2_AT,
    settings: { settingsDirectory },
    workspaces: [{ scope, name: 'S2B-35 host', root: directory, workspaceRevision: 1, readPrefixes: ['.'] }],
  });
  const address = await host.listen(0);
  return { host, base: address.url, token: await readPageToken(address.url) };
}

describe('S2B-35 activity and timeline routes (BE5)', () => {
  it('2B-35 (a) the four plain routes return exactly the public reads', async () => {
    const base = baseOf(successServer);
    const calendarInput = { scope: { kind: 'goal' as const, goalRef: activityGoal },
      from: FROM, to: TO, granularity: 'hour' as const, timeZone: 'UTC' };
    const directCalendar = await activityReads.readActivityCalendar(activityFixture.ctx, calendarInput);
    expect(directCalendar.status).toBe('ready');
    expect(await post(base, 'activity/calendar', activityScope, calendarInput) as ReadResult<ActivityCalendarV1>)
      .toEqual(JSON.parse(JSON.stringify(directCalendar)));

    const runsInput = { runRefs: [activityRun] };
    const directRuns = await activityReads.readRunActivities(activityFixture.ctx, runsInput);
    expect(directRuns.status).toBe('ready');
    expect(await post(base, 'activity/runs', activityScope, runsInput) as ReadResult<RunActivityViewV1[]>)
      .toEqual(JSON.parse(JSON.stringify(directRuns)));

    const trackInput = { goalRef: activityGoal, from: FROM, to: TO, cursor: null, limit: 10 };
    const directTrack = await activityReads.readTrackBars(activityFixture.ctx, trackInput);
    expect(directTrack.status).toBe('ready');
    expect(await post(base, 'activity/track', activityScope, trackInput) as ReadResult<TrackBarsPageV1>)
      .toEqual(JSON.parse(JSON.stringify(directTrack)));

    const timelineInput = { goalRef: timelineGoal, cursor: null, limit: 10 };
    const directTimeline = await timelineReads.readTaskStateTimeline(timelineFixture.ctx, timelineInput);
    if (directTimeline.status !== 'ready') throw new Error(`the timeline read must be ready: ${JSON.stringify(directTimeline)}`);
    expect(await post(base, 'tasks/timeline', timelineScope, timelineInput) as ReadResult<TaskStateTimelinePageV1>)
      .toEqual(JSON.parse(JSON.stringify(directTimeline)));
  }, 60_000);

  it('2B-35 (b) a failed storage read crosses each read route as the failure, never an empty result', async () => {
    const base = baseOf(failingServer);
    const expected = { status: 'rejected', code: 'unavailable', reason: FAILURE_REASON };
    expect(await post(base, 'activity/calendar', activityScope,
      { scope: { kind: 'goal', goalRef: activityGoal }, from: FROM, to: TO, granularity: 'hour', timeZone: 'UTC' }))
      .toEqual(expected);
    expect(await post(base, 'activity/runs', activityScope, { runRefs: [activityRun] })).toEqual(expected);
    expect(await post(base, 'activity/track', activityScope,
      { goalRef: activityGoal, from: FROM, to: TO, cursor: null, limit: 10 })).toEqual(expected);
    expect(await post(base, 'tasks/timeline', activityScope,
      { goalRef: activityGoal, cursor: null, limit: 10 })).toEqual(expected);
  }, 60_000);

  it('2B-35 (c) activity/backfill is forbidden for members and platform automation', async () => {
    const input = { workspace: activityScope, from: FROM, to: TO, cursor: null };
    const parsed = parseCoreRouteRequest('activity/backfill', { scope: activityScope, input });

    // A non-Host principal (a member/agent caller) is `forbidden`.
    const memberCtx: CoreCallContext = {
      projectId: activityScope.projectId, workspaceId: activityScope.workspaceId,
      principal: { kind: 'query_run', queryRunRef: { aggregateType: 'QueryRun', ...activityScope, queryJobId: 'q', runId: 'r' },
        initiator: { kind: 'human', id: 'member' } },
      materialReader: { kind: 'host', projectId: activityScope.projectId, workspaceId: activityScope.workspaceId,
        actor: { kind: 'human', id: 'member' } },
      signal: new AbortController().signal,
    };
    expect(await dispatchCoreRoute(routeBindings, 'activity/backfill', memberCtx, parsed))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });

    // A platform-automation Host actor is `forbidden` too.
    expect(await dispatchCoreRoute(routeBindings, 'activity/backfill',
      hostContext(activityScope, { kind: 'system', id: 'workflow:auto-rework' }), parsed))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  }, 60_000);

  it('2B-35 (d) a leased Host admits the human backfill; a Host without the lease answers busy', async () => {
    const leased = await startHost({ kind: 'human', id: 's2b-35-leased' },
      { projectId: 's2b-35-leased-project', workspaceId: 's2b-35-leased-workspace' }, false);
    leasedHost = leased.host;
    expect(leasedHost.reconcile.lease).toBe('owned');
    const admitted = await postWithToken(leased.base, leased.token, 'activity/backfill',
      { projectId: 's2b-35-leased-project', workspaceId: 's2b-35-leased-workspace' },
      { workspace: { projectId: 's2b-35-leased-project', workspaceId: 's2b-35-leased-workspace' },
        from: FROM, to: TO, cursor: null });
    if ((admitted as { status?: string }).status !== 'ready') {
      throw new Error(`the leased human backfill must be ready: ${JSON.stringify(admitted)}`);
    }

    const noLease = await startHost({ kind: 'human', id: 's2b-35-no-lease' },
      { projectId: 's2b-35-nolease-project', workspaceId: 's2b-35-nolease-workspace' }, true);
    noLeaseHost = noLease.host;
    expect(noLeaseHost.reconcile.lease).toBe('held_by_other');
    const busy = await postWithToken(noLease.base, noLease.token, 'activity/backfill',
      { projectId: 's2b-35-nolease-project', workspaceId: 's2b-35-nolease-workspace' },
      { workspace: { projectId: 's2b-35-nolease-project', workspaceId: 's2b-35-nolease-workspace' },
        from: FROM, to: TO, cursor: null });
    expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });
  }, 120_000);

  it('2B-35 (e) activity/queries answers one unknown view for a QueryRun with no history', async () => {
    const missing = missingQueryRef();
    const answer = await post(baseOf(successServer), 'activity/queries', activityScope, { refs: [missing] });
    expect(answer as ReadResult<QueryActivityViewV1[]>).toEqual({ status: 'ready', value: [{
      queryRunRef: missing, status: 'unknown', reason: 'no_history_locator', error: false,
      totals: null, changedFiles: null, usage: null, recordedBy: null, recordedAt: null,
      countedThroughTurnEnd: null, unresolvedCalls: null,
      sessionRef: null, askedSessionRef: null, goalId: null,
    }] });
  });
});
