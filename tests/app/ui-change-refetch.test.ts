/**
 * Task E record-notice refetches — `src/ui/state/change-refetch.ts`.
 *
 * A commit notice for `goals` or `tasks` of the selected workspace's project
 * re-reads only the Goal detail and Task graph that workspace already shows.
 * The refetch is quiet: it writes those two slices from a `ready` reply for the
 * Goal still shown and leaves the pending request, error, notice and forms
 * alone. Nothing shown means no request.
 * Stubbed fetch, fake timers: no DOM, no Host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeNotice } from '../../src/app/core-http-types.js';
import { createRefreshHub } from '../../src/ui/api/refresh.js';
import { goalGraphNoticeMatches, refetchGoalGraph, shownGoalId, watchRecordChanges } from '../../src/ui/state/change-refetch.js';
import type { ScopeState } from '../../src/ui/state/scope-state.js';
import { scopes, setSelectedKey, store } from '../../src/ui/state/workbench.js';
import type { WorkbenchAction } from '../../src/ui/state/workbench.js';

const target = { projectId: 'p', workspaceId: 'w' };
const goalReady = (goalId: string, marker = 'old') =>
  ({ status: 'ready', value: { goal: { ref: { aggregateType: 'Goal', projectId: 'p', goalId }, objective: marker }, pendingPlan: null } });
const graphReady = (marker: string) => ({ status: 'ready', value: { tasks: [marker] } });

function scopeShowing(options: { goal?: string | null; graph?: string | null } = {}): ScopeState {
  const goal = options.goal === undefined ? 'g' : options.goal;
  const graph = options.graph === undefined ? 'g' : options.graph;
  return {
    key: 'scope-a', config: { scope: target },
    goalRead: goal === null ? null : goalReady(goal),
    taskGraph: graph === null ? null : graphReady('old'), taskGraphGoalId: graph ?? '',
    pending: null, error: 'kept error', notice: 'kept notice', lastRequest: null, sending: false,
    forms: { goalId: '', proposalId: '' },
  } as unknown as ScopeState;
}

const notice = (over: Partial<ChangeNotice> = {}): ChangeNotice =>
  ({ cursor: 'c0000000010', kinds: ['tasks'], projects: ['p'], ...over });

type Sent = { url: string; body: { scope: unknown; input: unknown } };

function stubHost(reply: (route: string) => unknown) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) as Sent['body'] });
    return new Response(JSON.stringify(reply(url.slice('/api/real/core/'.length))), { status: 200 });
  }));
  return sent;
}

let renders: WorkbenchAction[] = [];
let unlisten: () => void = () => undefined;
beforeEach(() => {
  renders = [];
  unlisten = store.listen(action => renders.push(action));
});
afterEach(() => {
  unlisten();
  scopes().clear();
  setSelectedKey('');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('matching', () => {
  it('matches goals/tasks notices of the selected project only while a Goal or graph is shown', () => {
    expect(shownGoalId(goalReady('g'))).toBe('g');
    expect(shownGoalId({ status: 'rejected', reason: 'x' })).toBeNull();
    expect(shownGoalId(null)).toBeNull();
    const scope = scopeShowing();
    expect(goalGraphNoticeMatches(scope, notice())).toBe(true);
    expect(goalGraphNoticeMatches(scope, notice({ kinds: ['goals'] }))).toBe(true);
    expect(goalGraphNoticeMatches(scope, notice({ kinds: ['executions', 'sessions', 'messages'] }))).toBe(false);
    expect(goalGraphNoticeMatches(scope, notice({ kinds: ['driver'] }))).toBe(false);
    expect(goalGraphNoticeMatches(scope, notice({ projects: ['other'] }))).toBe(false);
    expect(goalGraphNoticeMatches(undefined, notice())).toBe(false);
    expect(goalGraphNoticeMatches(scopeShowing({ goal: null, graph: null }), notice())).toBe(false);
    expect(goalGraphNoticeMatches(scopeShowing({ goal: null }), notice())).toBe(true);
  });
});

describe('refetchGoalGraph', () => {
  it('re-reads the shown Goal and graph, writes only those slices and renders once', async () => {
    const sent = stubHost(route => route === 'goals/read' ? goalReady('g', 'new') : graphReady('new'));
    const scope = scopeShowing();
    await refetchGoalGraph(scope);
    expect(sent).toEqual([
      { url: '/api/real/core/goals/read', body: { scope: target, input: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } } },
      { url: '/api/real/core/tasks/query', body: { scope: target, input: { goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } } } },
    ]);
    expect(scope.goalRead).toEqual(goalReady('g', 'new'));
    expect(scope.taskGraph).toEqual(graphReady('new'));
    expect(scope.taskGraphGoalId).toBe('g');
    expect([scope.error, scope.notice, scope.pending, scope.lastRequest, scope.forms.goalId]).toEqual(['kept error', 'kept notice', null, null, '']);
    expect(renders).toEqual([{ type: 'render', scopeKey: 'scope-a' }]);
  });

  it('keeps what is shown when the reply is not ready or the shown Goal changed meanwhile', async () => {
    const rejected = scopeShowing();
    stubHost(() => ({ status: 'rejected', code: 'unavailable', reason: 'down' }));
    await refetchGoalGraph(rejected);
    expect(rejected.goalRead).toEqual(goalReady('g'));
    expect(rejected.taskGraph).toEqual(graphReady('old'));

    const switched = scopeShowing();
    stubHost(route => {
      // The user opened another Goal while the refetch was in flight.
      if (route === 'goals/read') switched.goalRead = goalReady('h');
      else { switched.taskGraphGoalId = 'h'; }
      return route === 'goals/read' ? goalReady('g', 'new') : graphReady('new');
    });
    await refetchGoalGraph(switched);
    expect(switched.goalRead).toEqual(goalReady('h'));
    expect(switched.taskGraph).toEqual(graphReady('old'));
    expect(renders).toEqual([]);
  });

  it('sends nothing when no Goal or graph is shown', async () => {
    const sent = stubHost(() => graphReady('new'));
    await refetchGoalGraph(scopeShowing({ goal: null, graph: null }));
    expect(sent).toEqual([]);
  });
});

describe('watchRecordChanges', () => {
  it('refetches the selected workspace 300 ms after a matching notice and on reset, never on a timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const sent = stubHost(route => route === 'goals/read' ? goalReady('g', 'new') : graphReady('new'));
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const unwatch = watchRecordChanges(hub);
    const scope = scopeShowing({ graph: null });
    scopes().set(scope.key, scope);
    hub.deliverNotice(notice());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toEqual([]);
    setSelectedKey(scope.key);
    hub.deliverNotice(notice({ projects: ['other'] }));
    hub.deliverNotice(notice({ kinds: ['executions'] }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    hub.deliverNotice(notice({ kinds: ['goals'] }));
    await vi.advanceTimersByTimeAsync(299);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => { expect(sent.map(item => item.url)).toEqual(['/api/real/core/goals/read']); });
    hub.catchUp(true);
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => { expect(sent).toHaveLength(2); });
    unwatch();
    hub.deliverNotice(notice());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(2);
  });
});
