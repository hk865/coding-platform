import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor, type GoalRef } from '../../../contracts/ledger.js';
import type {
  ConsultationCreateReadPort, ConsultationCreateV1, ConsultationFactsV1, SessionCard, SessionDirectoryPort,
} from '../model/session-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { SessionMailboxPort, SessionMessage } from '../model/communication-contracts.js';

/** The three non-`readable` classes of §3.15 item 2 (B-12); only `missing`/`corrupt` degrade to `platform_facts`. */
export type ConsultationHistoryFailureV1 = 'missing' | 'corrupt' | 'transient' | 'cancelled';
/** One inherited-prefix record the shared window returned; its body is frozen, its position is the pin. */
export type ConsultationHistoryRecordV1 = { position: number; body: string };
export type ConsultationHistoryReadV1 =
  | { status: 'readable'; records: ConsultationHistoryRecordV1[] }
  | { status: 'empty' }
  | { status: 'missing'; reason: string; records: ConsultationHistoryRecordV1[] }
  | { status: 'corrupt'; reason: string; records: ConsultationHistoryRecordV1[] }
  | { status: 'transient'; reason: string }
  | { status: 'cancelled' };
/** R implements it; the bounded-window read stays the history owner's (§3.15 item 2). */
export interface ConsultationHistoryPort {
  /** Both ends pass the already-read `SessionRecord` (`createSessionHistoryCursorOwner` `:883` has no Session reader). */
  readConsultationHistory(ctx: CoreCallContext, input: { session: SessionRecord; throughPosition: number }):
    Promise<ConsultationHistoryReadV1>;
}

/** The ONE read of a create operation's frozen consultation payload; no collection, no re-read of the source. */
export function readConsultationCreate(
  directory: Pick<SessionDirectoryPort, 'getSessionOperation'>,
): ConsultationCreateReadPort {
  return {
    async readConsultationCreate(ctx, input) {
      const read = await directory.getSessionOperation(ctx, input.operationRef);
      if (read.status !== 'ready') return read;
      const action = read.value.action;
      // Never a stand-in payload: a non-consultation create is not this read's target.
      if (action.kind !== 'create' || action.consultation === null) return { status: 'not_found' };
      return { status: 'ready', value: structuredClone(action.consultation) };
    },
  };
}

export type ConsultationFactsRequestV1 = {
  source: SessionCard;
  /** `readCompletedBoundary`'s value; `position: 0` is a truly empty line, `null` the missing/corrupt boundary
   *  that chose `platform_facts` (the collector still runs; §3.15 item 2). */
  boundary: { cursor: string | null; position: number } | null;
};
export interface ConsultationFactsPort {
  readConsultationFacts(ctx: CoreCallContext, request: ConsultationFactsRequestV1):
    Promise<ReadResult<Omit<ConsultationCreateV1, 'messageRef'>>>;
}
export type ConsultationFactsDependencies = {
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  messages: Pick<SessionMailboxPort, 'readInbox'>;
  history: ConsultationHistoryPort;
};

type ConsultationMode = Omit<ConsultationCreateV1, 'messageRef'>;
type UnreadableEntry = ConsultationFactsV1['unreadable'][number];

/** One bounded pass over the source line's frozen prefix; no Session lookup and no second page reader. */
const CONSULTATION_TASK_LIMIT = 20;
const CONSULTATION_MESSAGE_PAGE_LIMIT = 100;
const CONSULTATION_MESSAGE_LIMIT = 20;
/** The shared read window's own bound; a longer prefix is truncated and reported, never silently cut. */
const CONSULTATION_RECORD_LIMIT = 200;

/** The source card's open task links carry the Goal its work belongs to; no extra read is added. */
function sourceGoalRef(source: SessionCard): GoalRef | null {
  const taskLinks = source.links.filter(link => link.ref.target.kind === 'task');
  const link = taskLinks.find(candidate => candidate.until === null && candidate.ref.relation === 'responsible')
    ?? taskLinks.find(candidate => candidate.until === null)
    ?? taskLinks[0];
  if (link === undefined || link.ref.target.kind !== 'task') return null;
  return {
    aggregateType: 'Goal', projectId: link.ref.target.ref.projectId, goalId: link.ref.target.ref.goalId,
  };
}

function compareTaskIds(left: { taskId: string }, right: { taskId: string }): number {
  return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
}

/** A gone record is `missing`; every other failed read is `unreadable`. */
function readFailureOf(status: 'not_found' | 'not_ready' | 'rejected'): UnreadableEntry {
  return { fact: null, reason: status === 'not_found' ? 'missing' : 'unreadable' };
}

function kernelMode(source: SessionCard,
  boundary: { cursor: string | null; position: number } | null): ConsultationMode {
  return { mode: 'kernel', facts: null, reason: null, sourceRef: source.record.ref, boundary };
}

/**
 * The collector's single pass (§3.15 item 4): the already-read source history, then one Goal read, one task-graph
 * read, each task's latest Run, and the inbox. A failed per-fact read is reported beside the facts, never retried.
 */
async function platformFactsMode(
  deps: ConsultationFactsDependencies,
  ctx: CoreCallContext,
  source: SessionCard,
  boundary: { cursor: string | null; position: number } | null,
  reason: string,
  records: readonly { position: number; body: string }[],
  unreadable: readonly UnreadableEntry[],
): Promise<ConsultationMode> {
  const facts: ConsultationFactsV1 = { facts: [], omitted: [], unreadable: [...unreadable] };
  const goalRef = sourceGoalRef(source);
  if (goalRef === null) {
    // The source line still gets its history and inbox; the absent Goal is reported, not invented.
    facts.unreadable.push({ fact: null, reason: 'missing' });
  } else {
    const goalRead = await deps.plans.queryGoal(ctx, goalRef);
    if (goalRead.status === 'ready') {
      const goal = goalRead.value.goal;
      facts.facts.push({
        kind: 'record',
        sourceRef: { ref: goal.ref, revision: goal.revision },
        body: canonicalJson(goal as unknown as JsonValue),
      });
    } else {
      facts.unreadable.push(readFailureOf(goalRead.status));
    }
    const graphRead = await deps.plans.queryTaskGraph(ctx, { goalRef });
    if (graphRead.status === 'ready') {
      const graph = graphRead.value;
      facts.facts.push({
        kind: 'record',
        sourceRef: { ref: graph.plan.ref, revision: graph.plan.revision },
        body: canonicalJson(graph.plan as unknown as JsonValue),
      });
      const tasks = [...graph.tasks].sort((left, right) => compareTaskIds(left.ref, right.ref));
      const kept = tasks.slice(0, CONSULTATION_TASK_LIMIT);
      if (tasks.length > kept.length) {
        facts.omitted.push({ section: 'tasks', count: tasks.length - kept.length });
      }
      for (const task of kept) {
        facts.facts.push({ kind: 'task', planRevision: graph.plan.ref, taskId: task.ref.taskId });
      }
      for (const task of kept) {
        if (task.execution === null) continue;
        const execution = await deps.executions.readExecution(ctx, task.execution);
        // A failed Run read writes no half body; only the unreadable entry is appended.
        if (execution.status !== 'ready') {
          facts.unreadable.push({ fact: null, reason: 'unreadable' });
          continue;
        }
        const run = execution.value.run;
        facts.facts.push({
          kind: 'record',
          sourceRef: { ref: run.ref, revision: run.revision },
          body: canonicalJson(run as unknown as JsonValue),
        });
      }
    } else {
      facts.unreadable.push(readFailureOf(graphRead.status));
    }
  }

  const keptRecords = records.slice(0, CONSULTATION_RECORD_LIMIT);
  if (records.length > keptRecords.length) {
    facts.omitted.push({ section: 'records', count: records.length - keptRecords.length });
  }
  for (const record of keptRecords) {
    facts.facts.push({
      kind: 'record',
      sourceRef: {
        ref: { aggregateType: 'Session', projectId: source.record.ref.projectId, sessionId: source.record.ref.sessionId },
        revision: record.position,
      },
      body: record.body,
    });
  }

  const recipient: SessionRef = { projectId: source.record.ref.projectId, sessionId: source.record.ref.sessionId };
  // The inbox pages by canonical key, so the line's true newest 20 need every page: keep the newest
  // 20 by commit order across pages, and let the total count each item exactly once.
  let keptMessages: { message: SessionMessage; seq: number }[] = [];
  let totalMessages = 0;
  let pageCursor: string | undefined;
  for (;;) {
    const inbox = await deps.messages.readInbox(ctx, {
      recipient,
      page: { limit: CONSULTATION_MESSAGE_PAGE_LIMIT, ...(pageCursor === undefined ? {} : { cursor: pageCursor }) },
    });
    if (inbox.status !== 'ready') {
      facts.unreadable.push(readFailureOf(inbox.status));
      return { mode: 'platform_facts', facts, reason, sourceRef: source.record.ref, boundary };
    }
    totalMessages += inbox.value.items.length;
    const newest = inbox.value.items.map((message, index) => ({
      message, seq: seqOfCommitCursor(inbox.value.cursors[index]!),
    }));
    keptMessages = [...keptMessages, ...newest]
      .sort((left, right) => left.seq - right.seq)
      .slice(-CONSULTATION_MESSAGE_LIMIT);
    if (inbox.value.nextCursor === null) break;
    pageCursor = inbox.value.nextCursor;
  }
  if (totalMessages > keptMessages.length) {
    facts.omitted.push({ section: 'messages', count: totalMessages - keptMessages.length });
  }
  for (const { message } of keptMessages) {
    facts.facts.push({
      kind: 'body',
      ref: message.bodyRef,
      sourceRef: { ref: message.ref, revision: message.revision },
    });
  }
  return { mode: 'platform_facts', facts, reason, sourceRef: source.record.ref, boundary };
}

function historyReason(status: 'missing' | 'corrupt'): string {
  return `the source line's Kernel history is ${status}`;
}

function historyUnreadable(status: 'missing' | 'corrupt'): UnreadableEntry {
  return { fact: null, reason: status === 'missing' ? 'missing' : 'unreadable' };
}

export function createConsultationFactsReader(deps: ConsultationFactsDependencies): ConsultationFactsPort {
  return {
    async readConsultationFacts(ctx, request): Promise<ReadResult<ConsultationMode>> {
      const source = request.source;
      const boundary = request.boundary;
      if (boundary === null) {
        return {
          status: 'ready',
          value: await platformFactsMode(deps, ctx, source, null, 'the source boundary is missing', [],
            [{ fact: null, reason: 'missing' }]),
        };
      }
      const history = await deps.history.readConsultationHistory(ctx, {
        session: source.record, throughPosition: boundary.position,
      });
      if (history.status === 'readable' || history.status === 'empty') {
        return { status: 'ready', value: kernelMode(source, boundary) };
      }
      if (history.status === 'transient') return rejected('incomplete', history.reason);
      if (history.status === 'cancelled') return rejected('cancelled', 'the consultation facts read was cancelled');
      return {
        status: 'ready',
        value: await platformFactsMode(deps, ctx, source, boundary, historyReason(history.status),
          history.records, [historyUnreadable(history.status)]),
      };
    },
  };
}
