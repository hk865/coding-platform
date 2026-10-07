/**
 * Task E change feed: the Host's one in-process hub of CHANGE NOTIFICATIONS for
 * the workbench stream (`GET /api/real/core/changes`).
 *
 * Sources:
 *   - every non-replayed RecordStore commit, observed by the composition root
 *     (`RecordCommitObserver`); its notice carries the commit cursor (the
 *     `events` autoincrement id) as the SSE `id`;
 *   - the two in-memory Host handle owners the page used to poll: the
 *     collaboration driver (`driverChanged`) and the command handles
 *     (`commandChanged`). They have no commit cursor, so their notices carry no
 *     `id` and are never replayed.
 *
 * The feed never carries domain data: a notice only names coarse resource
 * kinds, project ids and, for a handle notice, the exact handle. The page
 * re-reads the affected resources through the ordinary routes.
 *
 * Resume: the last `bufferSize` commit notices are kept. A `Last-Event-ID`
 * inside that window is answered with ONE coalesced `change`; anything older,
 * newer than the head, malformed or unknown is an explicit `reset`.
 */
import type { CommitCursor } from '../contracts/command-event.js';
import { makeCommitCursor, seqOfCommitCursor } from '../contracts/ledger.js';
import type { RecordCommitNotice, RecordCommitObserver } from '../composition/commit-observer.js';
import type { CollaborationChange } from './collaboration-driver.js';
import type {
  ChangeEventName, ChangeKind, ChangeNotice, ChangeReady, ChangeReset, ChangeResetReason,
} from './core-http-types.js';
import type { ChangeStreamResume } from './core-routes.js';
import type { WorkbenchCommandChange } from './workbench-tools.js';

const DEFAULT_BUFFER_SIZE = 512;

export type ChangeFeedEvent = {
  name: ChangeEventName;
  /** The SSE `id`; null writes no `id` line (handle notices, empty ledger). */
  id: string | null;
  data: ChangeReady | ChangeNotice | ChangeReset;
};

export type ChangeSubscription = { opening: ChangeFeedEvent; close(): void };

export type ChangeFeed = RecordCommitObserver & {
  driverChanged(change: CollaborationChange): void;
  commandChanged(change: WorkbenchCommandChange): void;
  /** The newest known commit cursor; null for an empty or unknown ledger. */
  head(): string | null;
  /** Subscribe and compute the opening event in one synchronous step, so no
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

type BufferedCommit = { seq: number; kinds: ReadonlySet<ChangeKind>; projects: ReadonlySet<string> };

const sorted = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();

export function createChangeFeed(options: ChangeFeedOptions = {}): ChangeFeed {
  const bufferSize = Math.max(1, Math.floor(options.bufferSize ?? DEFAULT_BUFFER_SIZE));
  const subscribers = new Set<(event: ChangeFeedEvent) => void>();
  const buffer: BufferedCommit[] = [];
  /** Highest commit seq seen; 0 is an empty ledger. */
  let headSeq = 0;
  let headKnown = false;
  /** A resume strictly below this seq may have missed a commit that is no
   * longer kept (or was never observed). Infinite until the head is known. */
  let floor = Number.POSITIVE_INFINITY;

  const headCursor = (): CommitCursor | null => (!headKnown || headSeq === 0 ? null : makeCommitCursor(headSeq));

  function broadcast(event: ChangeFeedEvent): void {
    for (const send of [...subscribers]) {
      try { send(event); } catch { /* one broken stream never affects another */ }
    }
  }

  function opening(resume: ChangeStreamResume): ChangeFeedEvent {
    const head = headCursor();
    const reset = (reason: ChangeResetReason): ChangeFeedEvent =>
      ({ name: 'reset', id: head, data: { cursor: head, reason } });
    const ready: ChangeFeedEvent = { name: 'ready', id: head, data: { cursor: head } };
    if (resume.kind === 'fresh') return ready;
    if (resume.kind === 'invalid') return reset('cursor_invalid');
    if (!headKnown) return reset('head_unknown');
    if (resume.seq > headSeq) return reset('cursor_unknown');
    if (resume.seq === headSeq) return ready;
    if (resume.seq < floor) return reset('cursor_too_old');
    const missed = buffer.filter(entry => entry.seq > resume.seq);
    const notice: ChangeNotice = {
      cursor: head,
      kinds: sorted(missed.flatMap(entry => [...entry.kinds])),
      projects: sorted(missed.flatMap(entry => [...entry.projects])),
    };
    return { name: 'change', id: head, data: notice };
  }

  return {
    started(head) {
      if (headKnown || head === 'unknown') return;
      headSeq = head === null ? 0 : seqOfCommitCursor(head);
      headKnown = true;
      floor = headSeq;
    },
    committed(notice: RecordCommitNotice) {
      let seq: number;
      try { seq = seqOfCommitCursor(notice.cursor); } catch { return; }
      // A head that could not be read at startup becomes known at the first
      // observed commit; nothing before that commit can be replayed.
      if (!headKnown) { headKnown = true; floor = seq; }
      headSeq = Math.max(headSeq, seq);
      const kinds = new Set<ChangeKind>(notice.aggregates.map(aggregate => changeKindOf(aggregate.aggregateType)));
      if (kinds.size === 0) kinds.add('other');
      const projects = new Set<string>();
      for (const aggregate of notice.aggregates) if (aggregate.projectId !== null) projects.add(aggregate.projectId);
      buffer.push({ seq, kinds, projects });
      while (buffer.length > bufferSize) {
        const evicted = buffer.shift()!;
        floor = Math.max(floor, evicted.seq);
      }
      const cursor = makeCommitCursor(seq);
      broadcast({ name: 'change', id: cursor, data: { cursor, kinds: sorted(kinds), projects: sorted(projects) } });
    },
    driverChanged(change) {
      broadcast({ name: 'change', id: null, data: {
        cursor: headCursor(), kinds: ['driver'], projects: [change.scope.projectId],
        scope: { projectId: change.scope.projectId, workspaceId: change.scope.workspaceId },
        goalId: change.goalId, taskId: change.taskId,
      } });
    },
    commandChanged(change) {
      broadcast({ name: 'change', id: null, data: {
        cursor: headCursor(), kinds: ['command'], projects: [change.scope.projectId],
        scope: { projectId: change.scope.projectId, workspaceId: change.scope.workspaceId },
        commandId: change.commandId, state: change.state,
      } });
    },
    head: headCursor,
    open(resume, send) {
      const first = opening(resume);
      subscribers.add(send);
      return { opening: first, close: () => { subscribers.delete(send); } };
    },
    subscribers: () => subscribers.size,
  };
}
