/**
 * Task E change feed (Host hub): classification of commit notices, the
 * `Last-Event-ID` resume decision, ring eviction, and handle notices that carry
 * no cursor and are never replayed. The HTTP stream itself is covered by
 * `change-stream.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { changeKindOf, createChangeFeed, type ChangeFeedEvent } from '../../src/app/change-feed.js';
import { parseChangeStreamResume } from '../../src/app/core-routes.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

const c = (seq: number) => makeCommitCursor(seq);
const resumeFrom = (value?: string) => parseChangeStreamResume(value);
const scope = { projectId: 'feed-project', workspaceId: 'feed-workspace' };

describe('change kind classification', () => {
  it('maps every registered aggregate family to its resource kind and unknown types to other', () => {
    const expected: Record<string, string> = {
      Goal: 'goals', GoalPhase: 'goals',
      PlanRevision: 'tasks', PlanProposal: 'tasks', Task: 'tasks', TaskAttempt: 'tasks', TaskLease: 'tasks',
      TaskRequeue: 'tasks', TaskReduction: 'tasks', TaskEvidenceIndex: 'tasks', TaskReworkRefusal: 'tasks',
      TaskReviewProtocol: 'tasks', VerificationRound: 'tasks', Evidence: 'tasks', ReviewWork: 'tasks', ReviewResult: 'tasks',
      Run: 'executions', ControlIntent: 'executions', Control: 'executions', DispatchOutboxEntry: 'executions',
      ModelRequestPermit: 'executions', CoreOperation: 'executions',
      Session: 'sessions', SessionWorkLink: 'sessions',
      SessionMessage: 'messages',
      QueryJob: 'queries', QueryRun: 'queries', QueryJobAnswer: 'queries',
      ArchitectureCatalog: 'architecture', ArchitectureReview: 'architecture', ObservedArchitecture: 'architecture',
      WorkspaceArchitectureObservationCurrent: 'architecture', ArchitectureBaselineRevision: 'architecture',
      ProjectArchitectureBaselineActive: 'architecture',
      Project: 'project', Workspace: 'project', RoleSpecRevision: 'project', ProjectRoleSpecActive: 'project',
      CompletionPolicyRevision: 'project', ProjectCompletionPolicyActive: 'project',
      CoordinationPolicyRevision: 'project', ProjectCoordinationPolicyActive: 'project',
      SomethingNew: 'other',
    };
    for (const [aggregateType, kind] of Object.entries(expected)) expect([aggregateType, changeKindOf(aggregateType)]).toEqual([aggregateType, kind]);
  });

  it('publishes a commit notice with its cursor as id, the union of kinds and the touched projects', () => {
    const feed = createChangeFeed();
    feed.started(c(4));
    const seen: ChangeFeedEvent[] = [];
    feed.open(resumeFrom(), event => seen.push(event));
    feed.committed({ cursor: c(5), aggregates: [
      { aggregateType: 'Task', projectId: 'p2' }, { aggregateType: 'Run', projectId: 'p1' },
      { aggregateType: 'TaskAttempt', projectId: 'p1' }, { aggregateType: 'CoreOperation', projectId: null },
    ] });
    feed.committed({ cursor: c(6), aggregates: [] });
    expect(seen).toEqual([
      { name: 'change', id: 'c0000000005', data: { cursor: 'c0000000005', kinds: ['executions', 'tasks'], projects: ['p1', 'p2'] } },
      { name: 'change', id: 'c0000000006', data: { cursor: 'c0000000006', kinds: ['other'], projects: [] } },
    ]);
    expect(feed.head()).toBe('c0000000006');
  });
});

describe('Last-Event-ID resume decision', () => {
  function seeded(bufferSize?: number) {
    const feed = createChangeFeed(bufferSize === undefined ? {} : { bufferSize });
    feed.started(c(10));
    feed.committed({ cursor: c(11), aggregates: [{ aggregateType: 'Goal', projectId: 'p1' }] });
    feed.committed({ cursor: c(13), aggregates: [{ aggregateType: 'SessionMessage', projectId: 'p2' }] });
    feed.committed({ cursor: c(14), aggregates: [{ aggregateType: 'Task', projectId: 'p1' }] });
    return feed;
  }
  const opening = (feed: ReturnType<typeof createChangeFeed>, value?: string) => {
    const subscription = feed.open(resumeFrom(value), () => undefined);
    subscription.close();
    return subscription.opening;
  };

  it('answers ready for a fresh or up-to-date client and one coalesced change for a kept gap', () => {
    const feed = seeded();
    expect(opening(feed)).toEqual({ name: 'ready', id: 'c0000000014', data: { cursor: 'c0000000014' } });
    expect(opening(feed, '')).toEqual({ name: 'ready', id: 'c0000000014', data: { cursor: 'c0000000014' } });
    expect(opening(feed, 'c0000000014')).toEqual({ name: 'ready', id: 'c0000000014', data: { cursor: 'c0000000014' } });
    expect(opening(feed, 'c0000000013')).toEqual({ name: 'change', id: 'c0000000014',
      data: { cursor: 'c0000000014', kinds: ['tasks'], projects: ['p1'] } });
    // A cursor inside a multi-event commit replays that whole commit.
    expect(opening(feed, 'c0000000012')).toEqual({ name: 'change', id: 'c0000000014',
      data: { cursor: 'c0000000014', kinds: ['messages', 'tasks'], projects: ['p1', 'p2'] } });
    // The seeded head itself is still inside the window.
    expect(opening(feed, 'c0000000010')).toEqual({ name: 'change', id: 'c0000000014',
      data: { cursor: 'c0000000014', kinds: ['goals', 'messages', 'tasks'], projects: ['p1', 'p2'] } });
  });

  it('resets a cursor that is older than the window, newer than the head, or malformed', () => {
    const feed = seeded();
    expect(opening(feed, 'c0000000009')).toEqual({ name: 'reset', id: 'c0000000014',
      data: { cursor: 'c0000000014', reason: 'cursor_too_old' } });
    expect(opening(feed, 'c0000000099')).toEqual({ name: 'reset', id: 'c0000000014',
      data: { cursor: 'c0000000014', reason: 'cursor_unknown' } });
    for (const garbage of ['14', 'c14', 'c0000000000', 'C0000000014', 'c0000000014 ', 'x'.repeat(40)]) {
      expect(opening(feed, garbage)).toEqual({ name: 'reset', id: 'c0000000014',
        data: { cursor: 'c0000000014', reason: 'cursor_invalid' } });
    }
  });

  it('raises the floor when the ring evicts a notice', () => {
    const feed = seeded(2);
    // c11 was evicted: a client at c10 may have missed it.
    expect(opening(feed, 'c0000000010').data).toEqual({ cursor: 'c0000000014', reason: 'cursor_too_old' });
    expect(opening(feed, 'c0000000011')).toEqual({ name: 'change', id: 'c0000000014',
      data: { cursor: 'c0000000014', kinds: ['messages', 'tasks'], projects: ['p1', 'p2'] } });
  });

  it('treats an empty ledger as head zero and an unreadable head as unknown until the first commit', () => {
    const empty = createChangeFeed();
    empty.started(null);
    expect(opening(empty)).toEqual({ name: 'ready', id: null, data: { cursor: null } });
    expect(opening(empty, 'c0000000001').data).toEqual({ cursor: null, reason: 'cursor_unknown' });
    empty.committed({ cursor: c(2), aggregates: [{ aggregateType: 'Project', projectId: 'p1' }] });
    expect(opening(empty, 'c0000000001')).toEqual({ name: 'change', id: 'c0000000002',
      data: { cursor: 'c0000000002', kinds: ['project'], projects: ['p1'] } });

    const unknown = createChangeFeed();
    unknown.started('unknown');
    expect(opening(unknown)).toEqual({ name: 'ready', id: null, data: { cursor: null } });
    expect(opening(unknown, 'c0000000005').data).toEqual({ cursor: null, reason: 'head_unknown' });
    unknown.committed({ cursor: c(7), aggregates: [{ aggregateType: 'Goal', projectId: 'p1' }] });
    expect(opening(unknown, 'c0000000007').name).toBe('ready');
    expect(opening(unknown, 'c0000000006').data).toEqual({ cursor: 'c0000000007', reason: 'cursor_too_old' });
  });
});

describe('handle notices and subscriptions', () => {
  it('broadcasts driver and command notices without an id and never replays them', () => {
    const feed = createChangeFeed();
    feed.started(c(3));
    const seen: ChangeFeedEvent[] = [];
    const subscription = feed.open(resumeFrom(), event => seen.push(event));
    feed.driverChanged({ scope, goalId: 'g1', taskId: null });
    feed.commandChanged({ scope, commandId: 'workbench-command-1', state: 'settled' });
    expect(seen).toEqual([
      { name: 'change', id: null, data: { cursor: 'c0000000003', kinds: ['driver'], projects: ['feed-project'],
        scope, goalId: 'g1', taskId: null } },
      { name: 'change', id: null, data: { cursor: 'c0000000003', kinds: ['command'], projects: ['feed-project'],
        scope, commandId: 'workbench-command-1', state: 'settled' } },
    ]);
    expect(feed.head()).toBe('c0000000003');
    const resumed = feed.open(resumeFrom('c0000000003'), () => undefined);
    expect(resumed.opening.name).toBe('ready');
    resumed.close();
    subscription.close();
  });

  it('unsubscribes on close and isolates a throwing subscriber', () => {
    const feed = createChangeFeed();
    feed.started(null);
    const first: string[] = [];
    const broken = feed.open(resumeFrom(), () => { throw new Error('broken stream'); });
    const healthy = feed.open(resumeFrom(), event => first.push(event.name));
    expect(feed.subscribers()).toBe(2);
    feed.committed({ cursor: c(1), aggregates: [{ aggregateType: 'Project', projectId: 'p1' }] });
    expect(first).toEqual(['change']);
    broken.close();
    healthy.close();
    expect(feed.subscribers()).toBe(0);
    feed.committed({ cursor: c(2), aggregates: [{ aggregateType: 'Project', projectId: 'p1' }] });
    expect(first).toEqual(['change']);
  });
});
