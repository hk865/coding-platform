/**
 * Task E change feed: the Host's one in-process hub of CHANGE NOTIFICATIONS for
 * the workbench stream (`GET /api/real/core/changes`).
 *
 * Sources:
 *   - every non-replayed RecordStore commit of every project store, handed in by
 *     that project's commit observer (`committed(projectId, notice)`); each gets
 *     the next Host sequence number (`h` + 10 digits, from 1 at every Host start)
 *     as its SSE `id` and carries its own project and that project store's
 *     commit cursor;
 *   - the two in-memory Host handle owners the page used to poll: the
 *     collaboration driver (`driverChanged`) and the command handles
 *     (`commandChanged`). They carry no `id` and are never replayed; their
 *     `cursor` is the project store's head, for information only.
 *
 * The feed never carries domain data: a notice only names coarse resource
 * kinds, its project and, for a handle notice, the exact handle. The page
 * re-reads the affected resources through the ordinary routes.
 *
 * Resume: the last `bufferSize` commit notices are kept. A `Last-Event-ID`
 * inside that window is answered with one coalesced `change` per project that
 * missed something, in the order of each project's last missed notice; anything
 * older, newer than the head or malformed is an explicit `reset`. Two project
 * stores' cursors are never compared: only the Host sequence orders the stream.
 */
import type { RecordCommitNotice } from '../composition/commit-observer.js';
import type { CollaborationChange } from './collaboration-driver.js';
import type {
  ChangeEventName, ChangeKind, ChangeNotice, ChangeReady, ChangeReset, ChangeResetReason,
} from './core-http-types.js';
import { hostSequenceId, type ChangeStreamResume } from './core-routes.js';
import type { WorkbenchCommandChange } from './workbench-tools.js';

const DEFAULT_BUFFER_SIZE = 512;

export type ChangeFeedEvent = {
  name: ChangeEventName;
  /** The SSE `id`; null writes no `id` line (handle notices, no commit notice yet). */
  id: string | null;
  data: ChangeReady | ChangeNotice | ChangeReset;
};

export type ChangeSubscription = { opening: ChangeFeedEvent[]; close(): void };

export type ChangeFeed = {
  /** One non-replayed commit of one project store; it takes the next Host sequence number. */
  committed(projectId: string, notice: RecordCommitNotice): void;
  driverChanged(change: CollaborationChange, databaseCursor: string | null): void;
  commandChanged(change: WorkbenchCommandChange, databaseCursor: string | null): void;
  /** The last Host sequence id handed out; null until the first commit notice. */
  head(): string | null;
  /** Subscribe and compute the opening events in one synchronous step, so no
   * commit can fall between them. */
  open(resume: ChangeStreamResume, send: (event: ChangeFeedEvent) => void): ChangeSubscription;
  subscribers(): number;
};

export type ChangeFeedOptions = {
  /** Commit notices kept for `Last-Event-ID` resume. */
  bufferSize?: number;
};

/** Exact aggregate types per kind; anything else falls through to the patterns
 * in `changeKindOf`. */
const KIND_BY_AGGREGATE: Record<string, ChangeKind> = {
  Goal: 'goals', GoalPhase: 'goals',
  PlanRevision: 'tasks', PlanProposal: 'tasks', VerificationRound: 'tasks', Evidence: 'tasks',
  ReviewWork: 'tasks', ReviewResult: 'tasks',
  Run: 'executions', ControlIntent: 'executions', Control: 'executions', DispatchOutboxEntry: 'executions',
  ModelRequestPermit: 'executions', CoreOperation: 'executions',
  Session: 'sessions', SessionWorkLink: 'sessions',
  SessionMessage: 'messages',
  QueryJob: 'queries', QueryRun: 'queries', QueryJobAnswer: 'queries',
  Project: 'project', Workspace: 'project', RoleSpecRevision: 'project', ProjectRoleSpecActive: 'project',
};

/** Classify one aggregate type; the first matching rule wins. */
export function changeKindOf(aggregateType: string): ChangeKind {
  const exact = KIND_BY_AGGREGATE[aggregateType];
  if (exact !== undefined) return exact;
  if (aggregateType.includes('Architecture')) return 'architecture';
  if (aggregateType.includes('Policy')) return 'project';
  if (aggregateType.startsWith('Task')) return 'tasks';
  return 'other';
}

type BufferedCommit = { seq: number; projectId: string; cursor: string; kinds: ReadonlySet<ChangeKind> };

const sorted = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();

function commitEvent(seq: number, projectId: string, cursor: string, kinds: Iterable<ChangeKind>): ChangeFeedEvent {
  return { name: 'change', id: hostSequenceId(seq), data: { projectId, cursor, kinds: sorted(kinds), projects: [projectId] } };
}

export function createChangeFeed(options: ChangeFeedOptions = {}): ChangeFeed {
  const bufferSize = Math.max(1, Math.floor(options.bufferSize ?? DEFAULT_BUFFER_SIZE));
  const subscribers = new Set<(event: ChangeFeedEvent) => void>();
  const buffer: BufferedCommit[] = [];
  /** The last Host sequence number handed out; 0 before the first commit notice. */
  let headSeq = 0;
  /** The highest sequence number evicted from the buffer: a resume below it may
   * have missed a notice that is no longer kept. */
  let floor = 0;

  const head = (): string | null => (headSeq === 0 ? null : hostSequenceId(headSeq));

  function broadcast(event: ChangeFeedEvent): void {
    for (const send of [...subscribers]) {
      try { send(event); } catch { /* one broken stream never affects another */ }
    }
  }

  function opening(resume: ChangeStreamResume): ChangeFeedEvent[] {
    const current = head();
    const reset = (reason: ChangeResetReason): ChangeFeedEvent[] =>
      [{ name: 'reset', id: current, data: { cursor: current, reason } }];
    const ready: ChangeFeedEvent[] = [{ name: 'ready', id: current, data: { cursor: current } }];
    if (resume.kind === 'fresh') return ready;
    if (resume.kind === 'invalid') return reset('cursor_invalid');
    if (resume.seq > headSeq) return reset('cursor_unknown');
    if (resume.seq === headSeq) return ready;
    if (resume.seq < floor) return reset('cursor_too_old');
    // One coalesced notice per project: its last missed commit's sequence and cursor, and the union of its kinds.
    const missed = new Map<string, { last: BufferedCommit; kinds: Set<ChangeKind> }>();
    for (const entry of buffer) {
      if (entry.seq <= resume.seq) continue;
      const group = missed.get(entry.projectId) ?? { last: entry, kinds: new Set<ChangeKind>() };
      group.last = entry;
      for (const kind of entry.kinds) group.kinds.add(kind);
      missed.set(entry.projectId, group);
    }
    return [...missed.values()].sort((left, right) => left.last.seq - right.last.seq)
      .map(group => commitEvent(group.last.seq, group.last.projectId, group.last.cursor, group.kinds));
  }

  return {
    committed(projectId, notice) {
      headSeq += 1;
      const kinds = new Set<ChangeKind>(notice.aggregates.map(aggregate => changeKindOf(aggregate.aggregateType)));
      if (kinds.size === 0) kinds.add('other');
      buffer.push({ seq: headSeq, projectId, cursor: notice.cursor, kinds });
      while (buffer.length > bufferSize) floor = buffer.shift()!.seq;
      broadcast(commitEvent(headSeq, projectId, notice.cursor, kinds));
    },
    driverChanged(change, databaseCursor) {
      broadcast({ name: 'change', id: null, data: {
        projectId: change.scope.projectId, cursor: databaseCursor, kinds: ['driver'], projects: [change.scope.projectId],
        scope: { projectId: change.scope.projectId, workspaceId: change.scope.workspaceId },
        goalId: change.goalId, taskId: change.taskId,
      } });
    },
    commandChanged(change, databaseCursor) {
      broadcast({ name: 'change', id: null, data: {
        projectId: change.scope.projectId, cursor: databaseCursor, kinds: ['command'], projects: [change.scope.projectId],
        scope: { projectId: change.scope.projectId, workspaceId: change.scope.workspaceId },
        commandId: change.commandId, state: change.state,
      } });
    },
    head,
    open(resume, send) {
      const first = opening(resume);
      subscribers.add(send);
      return { opening: first, close: () => { subscribers.delete(send); } };
    },
    subscribers: () => subscribers.size,
  };
}
