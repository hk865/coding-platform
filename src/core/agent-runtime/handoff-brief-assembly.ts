/**
 * The Work handoff brief's material assembly (H; B4, B-01/B-05).
 *
 * The assembler reads durable facts only and returns F2's normalized material:
 * for an executor, the handed tasks in plan order with their phase and last
 * result, the source Run's last formal conclusion (the final assistant message
 * named by `state.outcome.finalMessageId`, never thinking or an intermediate
 * reply), the module note index and the source Run's understanding pointer; for
 * an adviser, every Goal of the project (whole-project scope under the material rule), each
 * Goal's tasks, note index and open decisions, plus the source Session's last
 * three ended Query answers cut to 2 KiB.
 *
 * It does not create record 5 and does not commit. Every read failure is a
 * rejection of the whole material (`unavailable`), never a partial or empty
 * material; a cancelled Turn read is `cancelled`, and `not_entered` on the
 * source's conclusion is the named absence `no_formal_final_answer`.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { NoteAnchorV1, NoteSourceV1 } from '../../contracts/note.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../contracts/dispatch.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { rejected } from '../../contracts/core/rejections.js';
import type {
  HandoffBriefMaterialV1, HandoffBriefNoteIndexV1, HandoffBriefTaskV1,
} from '../../contracts/handoff-brief.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { messageOf } from '../../contracts/error-message.js';
import { truncateUtf8 } from '../../contracts/utf8.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../record-store/lookup-ports.js';
import type { DecisionReadPort } from '../work-graph/model/decision-contracts.js';
import type { NoteItemV1, NoteReadPort } from '../work-graph/model/note-contracts.js';
import { MEMORY_PAGE_MAX } from '../work-graph/model/note-contracts.js';
import type { QueryExecutionPort } from '../work-graph/queries/contracts.js';
import {
  S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP, decodeQueryRunSnapshotRecord,
} from '../work-graph/queries/query-record-codecs.js';
import { decodeGoalSnapshot } from '../work-graph/persistence/record-codecs.js';
import { lookupAll } from '../work-graph/persistence/lookup-all.js';
import type { SessionDirectoryPort } from '../work-graph/model/session-contracts.js';
import { WORK_EXECUTION_BY_SESSION_LOOKUP } from '../work-graph/model/session-facts-contracts.js';
import { decodeDispatchOutboxEntry } from '../work-graph/tasks/claim-record-codecs.js';
import {
  GOAL_BY_WORKSPACE_INDEX, readCanonicalTaskFacts, readGoalPlanWindow,
} from '../work-graph/tasks/plan-readers.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { RoleScopeV1 } from '../../contracts/role-lines.js';
import type { HandoffBriefMaterialAssembler } from '../work-graph/sessions/session-handoff-service.js';
import { readPreviousTurn } from './continuation-brief-assembly.js';
import { finalAssistantMessageOf } from './kernel-turn-facts.js';
import type { SessionHistoryCursorOwner } from './session-operations.js';

/** The one Query answer cut: 2 KiB of UTF-8, as §2.3/§3.6 fix it. */
export const HANDOFF_QUERY_ANSWER_BYTES = 2048;
const LOOKUP_PAGE_LIMIT = 200;
const MAX_PAGES = 1000;

/**
 * The reads the assembler is allowed to use, injected by the composition root.
 * `records` is the one RecordStore port (goals, goal Runs and the ordered
 * ended-Query lookup); the three narrow ports are the existing owners of note
 * pages, decision cards and Query execution answers. The assembler opens no
 * other store.
 */
export type HandoffBriefAssemblyDeps = {
  history: SessionHistoryCursorOwner;
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  notes: Pick<NoteReadPort, 'listByAnchor'>;
  decisions: Pick<DecisionReadPort, 'queryDecisionQueue'>;
  queryExecution: Pick<QueryExecutionPort, 'readQueryExecution'>;
};

export type AssembleHandoffBriefInput =
  | {
      duty: 'executor';
      /** The source line and the Run whose facts the brief reports; both are null when the line never ran. */
      source: SessionRef;
      sourceRun: RunRef | null;
      /** The source Session's last ended Run record, read by `readPreviousTurn`; null when it never ran. */
      sourceRecord: TaskExecutionRecord | null;
      /** The handed tasks of the assignment, in its own order. */
      tasks: readonly TaskTriple[];
      workspaceId: string;
      signal: AbortSignal;
      /** The tool accept's saved admission-time understanding; null means read the current version below. */
      understanding: { noteId: string; version: number }[] | null;
    }
  | {
      duty: 'adviser';
      source: SessionRef;
      sourceRun: RunRef | null;
      workspaceId: string;
      signal: AbortSignal;
      /** The frozen scope this operation actually hands over: project, goal or region; never a task/work link. */
      handedScope: readonly RoleScopeV1[];
      /** The tool accept's saved admission-time understanding; null means read the current version below. */
      understanding: { noteId: string; version: number }[] | null;
    };

function readHandoffRejection(result: Exclude<ReadResult<unknown>, { status: 'ready' }>, what: string): CoreRejection {
  if (result.status === 'rejected') {
    return result.code === 'cancelled' ? result : rejected('unavailable', `${what}: ${result.reason}`);
  }
  if (result.status === 'not_found') return rejected('unavailable', `${what} was not found`);
  if (result.status === 'not_ready') return rejected('unavailable', `${what} is not ready`);
  return rejected('unavailable', what);
}

function signalRejection(signal: AbortSignal): CoreRejection | null {
  return signal.aborted ? rejected('cancelled', 'the handoff brief read was cancelled') : null;
}

/** A read that throws is the named `unavailable`; cancellation still propagates as `cancelled`. */
function thrownRead(error: unknown, signal: AbortSignal, what: string): CoreRejection {
  return signal.aborted ? rejected('cancelled', 'the handoff brief read was cancelled')
    : rejected('unavailable', `${what}: ${messageOf(error)}`);
}

function noteSourceRunMatches(source: NoteSourceV1, run: RunRef): boolean {
  return source.kind === 'agent' && source.runRef !== null
    && canonicalJson(source.runRef) === canonicalJson(run);
}

/** One anchor's complete current note page, paged to the end (`next === null`); an incomplete read is a failure. */
async function readAnchorNotes(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, anchor: NoteAnchorV1, signal: AbortSignal,
): Promise<ReadResult<NoteItemV1[]>> {
  const items: NoteItemV1[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cancelled = signalRejection(signal);
    if (cancelled !== null) return cancelled;
    let read: Awaited<ReturnType<HandoffBriefAssemblyDeps['notes']['listByAnchor']>>;
    try {
      read = await deps.notes.listByAnchor(ctx, { anchor, limit: MEMORY_PAGE_MAX, cursor });
    } catch (error) {
      return thrownRead(error, signal, `the note page of ${anchor.kind} ${anchorKey(anchor)}`);
    }
    if (read.status !== 'ready') return readHandoffRejection(read, `the note page of ${anchor.kind} ${anchorKey(anchor)}`);
    items.push(...read.value.items);
    if (read.value.next === null) {
      if (!read.value.complete) {
        return rejected('unavailable', `the note page of ${anchor.kind} ${anchorKey(anchor)} is not complete`);
      }
      return { status: 'ready', value: items };
    }
    cursor = read.value.next;
  }
  return rejected('unavailable', `the note page of ${anchor.kind} ${anchorKey(anchor)} exceeds the page bound`);
}

function anchorKey(anchor: NoteAnchorV1): string {
  return canonicalJson(anchor as unknown as JsonValue);
}

/** The source Run's current understanding notes on the given anchors, in anchor order. */
async function readHandoffUnderstanding(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, anchors: readonly NoteAnchorV1[],
  sourceRun: RunRef | null, signal: AbortSignal,
): Promise<ReadResult<{ noteId: string; version: number }[]>> {
  // A line that never ran has no source Run, so no understanding note can name it; the pointer is empty, not a
  // failure. Every real read below still rejects on its own failure.
  if (sourceRun === null) return { status: 'ready', value: [] };
  const found: { noteId: string; version: number }[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const notes = await readAnchorNotes(deps, ctx, anchor, signal);
    if (notes.status !== 'ready') return notes;
    for (const note of notes.value) {
      if (note.kind !== 'understanding' || !note.currentEligible || note.version === null) continue;
      if (!noteSourceRunMatches(note.source, sourceRun)) continue;
      const key = `${note.noteId}@${String(note.version)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ noteId: note.noteId, version: note.version });
    }
  }
  return { status: 'ready', value: found };
}

/** The current notes of each module the tasks declare; a module without notes keeps an empty entry. */
async function readModuleNoteIndex(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, moduleIds: readonly string[], signal: AbortSignal,
): Promise<ReadResult<HandoffBriefNoteIndexV1>> {
  const index: HandoffBriefNoteIndexV1 = [];
  for (const moduleId of moduleIds) {
    const notes = await readAnchorNotes(deps, ctx, { kind: 'module', moduleId }, signal);
    if (notes.status !== 'ready') return notes;
    index.push({
      moduleId,
      notes: notes.value.filter(note => note.currentEligible)
        .flatMap(note => note.version === null ? [] : [{ noteRef: note.noteId, version: note.version }]),
    });
  }
  return { status: 'ready', value: index };
}

/** One Goal's adopted plan, or the rejection; `plan: null` is a ready window with no tasks. */
async function readHandoffPlan(
  deps: HandoffBriefAssemblyDeps, goalRef: GoalRef, what: string, signal: AbortSignal,
): Promise<ReadResult<{ plan: PlanRevisionSnapshot | null; planRevision: number | null }>> {
  let window: Awaited<ReturnType<typeof readGoalPlanWindow>>;
  try {
    window = await readGoalPlanWindow(deps.records, goalRef);
  } catch (error) {
    return thrownRead(error, signal, what);
  }
  if (window.status !== 'ready') return readHandoffRejection(window, what);
  return {
    status: 'ready',
    value: {
      plan: window.plan,
      planRevision: window.plan === null ? null : window.plan.planRevision,
    },
  };
}

function lastResultOf(runs: readonly RunSnapshot[]): string | null {
  const ended = runs.filter(run => run.status === 'ended' && run.endedAt !== null);
  ended.sort((left, right) => {
    const byTime = (right.endedAt ?? '').localeCompare(left.endedAt ?? '');
    return byTime !== 0 ? byTime : canonicalJson(right.ref).localeCompare(canonicalJson(left.ref));
  });
  return ended[0]?.outcome ?? null;
}

function modulesOf(task: RuntimeTask): string[] {
  return task.scope.kind === 'module' ? [task.scope.moduleRef] : [];
}

function stageAnchorOf(
  task: RuntimeTask, goalRef: GoalRef, planRevision: number,
): NoteAnchorV1 | null {
  return task.stageId === undefined
    ? null
    : { kind: 'stage', goalId: goalRef.goalId, planRevision, stageId: task.stageId };
}

/** The source Session's last three ended Query answers, newest first while reading then in natural order. */
async function readEndedQueryAnswers(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, source: SessionRef, workspaceId: string,
  signal: AbortSignal,
): Promise<ReadResult<{ run: QueryRunRef; body: string }[]>> {
  const answers: { run: QueryRunRef; body: string }[] = [];
  let after: { order: string | number; refKey: string } | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cancelled = signalRejection(signal);
    if (cancelled !== null) return cancelled;
    let read: Awaited<ReturnType<HandoffBriefAssemblyDeps['records']['lookupOrdered']>>;
    try {
      read = await deps.records.lookupOrdered({
        index: S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP,
        values: [source.projectId, workspaceId, source.sessionId],
        direction: 'desc',
        ...(after === undefined ? {} : { after }),
        limit: LOOKUP_PAGE_LIMIT,
      });
    } catch (error) {
      return thrownRead(error, signal, 'the ended QueryRun lookup');
    }
    if (read.status !== 'ready') {
      return rejected('unavailable', `the ended QueryRun lookup is unavailable: ${read.code}: ${read.reason}`);
    }
    for (const record of read.value.records) {
      let decoded: ReturnType<typeof decodeQueryRunSnapshotRecord>;
      try {
        decoded = decodeQueryRunSnapshotRecord(record);
      } catch (error) {
        return thrownRead(error, signal, `the ended QueryRun ${record.refKey} is not decodable`);
      }
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `the ended QueryRun ${record.refKey} is not decodable: ${decoded.reason}`);
      }
      const cancelledNow = signalRejection(signal);
      if (cancelledNow !== null) return cancelledNow;
      let execution: Awaited<ReturnType<HandoffBriefAssemblyDeps['queryExecution']['readQueryExecution']>>;
      try {
        execution = await deps.queryExecution.readQueryExecution(ctx, decoded.value.ref);
      } catch (error) {
        return thrownRead(error, signal, 'the Query execution read');
      }
      if (execution.status !== 'ready') return readHandoffRejection(execution, 'the Query execution');
      if (execution.value.answer === null) continue;
      answers.push({
        run: decoded.value.ref,
        body: truncateUtf8(execution.value.answer.answer.answer, HANDOFF_QUERY_ANSWER_BYTES),
      });
      if (answers.length === 3) {
        answers.reverse();
        return { status: 'ready', value: answers };
      }
    }
    if (read.value.next === null) break;
    after = read.value.next;
  }
  answers.reverse();
  return { status: 'ready', value: answers };
}

/** Every Goal of the project, in creation-cursor order (whole-project adviser scope under the material rule). */
async function readProjectGoals(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, workspaceId: string, signal: AbortSignal,
): Promise<ReadResult<GoalRef[]>> {
  const cancelled = signalRejection(signal);
  if (cancelled !== null) return cancelled;
  let batch: Awaited<ReturnType<typeof lookupAll<EncodedRecord>>>;
  try {
    batch = await lookupAll(deps.records, GOAL_BY_WORKSPACE_INDEX, [ctx.projectId, workspaceId]);
  } catch (error) {
    return thrownRead(error, signal, 'the project Goals read');
  }
  const goals: { ref: GoalRef; since: string }[] = [];
  for (const record of batch.items) {
    let decoded: ReturnType<typeof decodeGoalSnapshot>;
    try {
      decoded = decodeGoalSnapshot(record);
    } catch (error) {
      return thrownRead(error, signal, `the Goal ${record.refKey} is not decodable`);
    }
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the Goal ${record.refKey} is not decodable: ${decoded.reason}`);
    }
    goals.push({ ref: decoded.value.ref, since: decoded.value.since });
  }
  goals.sort((left, right) => left.since.localeCompare(right.since));
  return { status: 'ready', value: goals.map(goal => goal.ref) };
}

/** The Goal's open decision cards (`waiting_answer`), paged to the end, as source kind + key. */
async function readOpenDecisions(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, goalRef: GoalRef, workspaceId: string,
  signal: AbortSignal,
): Promise<ReadResult<{ source: DecisionSourceV1['kind']; key: string }[]>> {
  const found: { source: DecisionSourceV1['kind']; key: string }[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cancelled = signalRejection(signal);
    if (cancelled !== null) return cancelled;
    let read: Awaited<ReturnType<HandoffBriefAssemblyDeps['decisions']['queryDecisionQueue']>>;
    try {
      read = await deps.decisions.queryDecisionQueue(ctx, {
        workspace: { projectId: ctx.projectId, workspaceId },
        goalRef,
        sections: ['waiting_answer'],
        page: { limit: MEMORY_PAGE_MAX, ...(cursor === undefined ? {} : { cursor }) },
      });
    } catch (error) {
      return thrownRead(error, signal, `the open decisions of ${goalRef.goalId}`);
    }
    if (read.status !== 'ready') return readHandoffRejection(read, `the open decisions of ${goalRef.goalId}`);
    for (const card of read.value.waitingAnswer) {
      const key = `${card.source.kind}:${card.source.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ source: card.source.kind, key: card.source.key });
    }
    if (read.value.nextCursor === null) return { status: 'ready', value: found };
    cursor = read.value.nextCursor;
  }
  return rejected('unavailable', `the open decisions of ${goalRef.goalId} exceed the page bound`);
}

type Conclusion =
  | { run: RunRef; finalMessageId: string; body: string }
  | { absent: 'no_formal_final_answer' };

async function readConclusion(
  deps: HandoffBriefAssemblyDeps, input: Extract<AssembleHandoffBriefInput, { duty: 'executor' }>,
): Promise<{ value: Conclusion } | { rejection: CoreRejection }> {
  // A source with no Work Run never entered the Kernel: the named absence, not a failed read and not a fabricated
  // conclusion. A present record whose Turn is unavailable still rejects below.
  if (input.sourceRun === null || input.sourceRecord === null) {
    return { value: { absent: 'no_formal_final_answer' } };
  }
  let turn: Awaited<ReturnType<typeof readPreviousTurn>>;
  try {
    turn = await readPreviousTurn(deps.history, input.sourceRecord, input.signal);
  } catch (error) {
    return { rejection: thrownRead(error, input.signal, 'the source Turn read') };
  }
  if (turn.kernel === 'retry') {
    return {
      rejection: rejected(turn.code === 'cancelled' ? 'cancelled' : 'unavailable', turn.reason),
    };
  }
  if (turn.kernel === 'unavailable') return { rejection: rejected('unavailable', turn.reason) };
  if (turn.kernel === 'not_entered') return { value: { absent: 'no_formal_final_answer' } };
  const outcome = turn.state.outcome ?? null;
  if (outcome === null || outcome.kind !== 'completed') {
    return { value: { absent: 'no_formal_final_answer' } };
  }
  const message = finalAssistantMessageOf(turn.state, outcome.finalMessageId);
  if (message === null) return { value: { absent: 'no_formal_final_answer' } };
  return {
    value: { run: input.sourceRun, finalMessageId: outcome.finalMessageId, body: message.message.content },
  };
}

/** The executor material: handed tasks in plan order, the source conclusion, the module index and the pointer. */
async function assembleExecutor(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext,
  input: Extract<AssembleHandoffBriefInput, { duty: 'executor' }>,
): Promise<ReadResult<HandoffBriefMaterialV1>> {
  const byGoal = new Map<string, TaskTriple[]>();
  for (const task of input.tasks) {
    const current = byGoal.get(task.goalId);
    if (current === undefined) byGoal.set(task.goalId, [task]);
    else current.push(task);
  }
  const tasks: HandoffBriefTaskV1[] = [];
  const moduleIds: string[] = [];
  const anchors: NoteAnchorV1[] = [];
  for (const [goalId, handed] of byGoal) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const planRead = await readHandoffPlan(deps, goalRef, `the adopted plan of ${goalId}`, input.signal);
    if (planRead.status !== 'ready') return planRead;
    if (planRead.value.plan === null) {
      return rejected('unavailable', `the handed Task's Goal ${goalId} has no adopted plan`);
    }
    const plan = planRead.value.plan;
    const planRevision = planRead.value.planRevision!;
    let factsRead;
    try {
      factsRead = await readCanonicalTaskFacts(deps.records, goalRef, plan);
    } catch (error) {
      return thrownRead(error, input.signal, `the Task facts of ${goalId}`);
    }
    if (factsRead.status !== 'ready') return readHandoffRejection(factsRead, `the Task facts of ${goalId}`);
    const facts = factsRead.value;
    const handedIds = new Set(handed.map(task => task.taskId));
    const found = new Set<string>();
    anchors.push({ kind: 'goal', goalId });
    for (const planTask of plan.tasks) {
      const anchor = stageAnchorOf(planTask, goalRef, planRevision);
      if (anchor !== null) anchors.push(anchor);
      if (!handedIds.has(planTask.taskId)) continue;
      found.add(planTask.taskId);
      tasks.push({ task: { projectId: ctx.projectId, goalId, taskId: planTask.taskId },
        phase: facts.byTaskId.get(planTask.taskId)!.effectivePhase,
        lastResult: lastResultOf(facts.runsByTaskId.get(planTask.taskId) ?? []) });
      for (const moduleId of modulesOf(planTask)) {
        if (!moduleIds.includes(moduleId)) moduleIds.push(moduleId);
      }
    }
    if (found.size !== handedIds.size) {
      return rejected('unavailable', `a handed Task of ${goalId} is not in the adopted plan`);
    }
  }
  const conclusion = await readConclusion(deps, input);
  if ('rejection' in conclusion) return conclusion.rejection;
  const noteIndex = await readModuleNoteIndex(deps, ctx, moduleIds, input.signal);
  if (noteIndex.status !== 'ready') return noteIndex;
  const understanding = input.understanding === null
    ? await readHandoffUnderstanding(deps, ctx, anchors, input.sourceRun, input.signal)
    : { status: 'ready' as const, value: structuredClone(input.understanding) };
  if (understanding.status !== 'ready') return understanding;
  return {
    status: 'ready',
    value: {
      duty: 'executor',
      tasks,
      conclusion: conclusion.value,
      noteIndex: noteIndex.value,
      understanding: understanding.value,
      oldLine: input.source,
    },
  };
}

/** The adviser material: whole-project Goals, each Goal's tasks/notes/open decisions, the Query answers, the pointer. */
async function assembleAdviser(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext,
  input: Extract<AssembleHandoffBriefInput, { duty: 'adviser' }>,
): Promise<ReadResult<HandoffBriefMaterialV1>> {
  const goalsRead = await readProjectGoals(deps, ctx, input.workspaceId, input.signal);
  if (goalsRead.status !== 'ready') return goalsRead;
  const goals: Extract<HandoffBriefMaterialV1, { duty: 'adviser' }>['goals'] = [];
  const anchors: NoteAnchorV1[] = [];
  for (const goalRef of goalsRead.value) {
    const planRead = await readHandoffPlan(deps, goalRef, `the adopted plan of ${goalRef.goalId}`, input.signal);
    if (planRead.status !== 'ready') return planRead;
    const decisions = await readOpenDecisions(deps, ctx, goalRef, input.workspaceId, input.signal);
    if (decisions.status !== 'ready') return decisions;
    anchors.push({ kind: 'goal', goalId: goalRef.goalId });
    if (planRead.value.plan === null) {
      goals.push({ goalRef, tasks: [], noteIndex: [], openDecisions: decisions.value });
      continue;
    }
    const plan = planRead.value.plan;
    const planRevision = planRead.value.planRevision!;
    let factsRead;
    try {
      factsRead = await readCanonicalTaskFacts(deps.records, goalRef, plan);
    } catch (error) {
      return thrownRead(error, input.signal, `the Task facts of ${goalRef.goalId}`);
    }
    if (factsRead.status !== 'ready') return readHandoffRejection(factsRead, `the Task facts of ${goalRef.goalId}`);
    const facts = factsRead.value;
    const tasks: HandoffBriefTaskV1[] = [];
    const moduleIds: string[] = [];
    for (const planTask of plan.tasks) {
      tasks.push({ task: { projectId: ctx.projectId, goalId: goalRef.goalId, taskId: planTask.taskId },
        phase: facts.byTaskId.get(planTask.taskId)!.effectivePhase,
        lastResult: lastResultOf(facts.runsByTaskId.get(planTask.taskId) ?? []) });
      for (const moduleId of modulesOf(planTask)) {
        if (!moduleIds.includes(moduleId)) moduleIds.push(moduleId);
      }
    }
    const noteIndex = await readModuleNoteIndex(deps, ctx, moduleIds, input.signal);
    if (noteIndex.status !== 'ready') return noteIndex;
    goals.push({ goalRef, tasks, noteIndex: noteIndex.value, openDecisions: decisions.value });
  }
  const queryAnswers = await readEndedQueryAnswers(deps, ctx, input.source, input.workspaceId, input.signal);
  if (queryAnswers.status !== 'ready') return queryAnswers;
  const understanding = input.understanding === null
    ? await readHandoffUnderstanding(deps, ctx, anchors, input.sourceRun, input.signal)
    : { status: 'ready' as const, value: structuredClone(input.understanding) };
  if (understanding.status !== 'ready') return understanding;
  return {
    status: 'ready',
    value: {
      duty: 'adviser',
      handedScope: structuredClone([...input.handedScope]),
      goals,
      queryAnswers: queryAnswers.value,
      understanding: understanding.value,
      oldLine: input.source,
    },
  };
}

/**
 * Assembles the complete handoff material for one assignment. No record is written; the caller creates
 * record 5 only after this returns `ready` (`book-7c.md:591`, C08).
 */
export async function assembleHandoffBrief(
  deps: HandoffBriefAssemblyDeps, ctx: CoreCallContext, input: AssembleHandoffBriefInput,
): Promise<ReadResult<HandoffBriefMaterialV1>> {
  const cancelled = signalRejection(input.signal);
  if (cancelled !== null) return cancelled;
  return input.duty === 'executor'
    ? assembleExecutor(deps, ctx, input)
    : assembleAdviser(deps, ctx, input);
}

/** The Session and execution owners the material adapter reads to locate the source Run. */
export type HandoffBriefMaterialSources = {
  records: HandoffBriefAssemblyDeps['records'];
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
};

/**
 * The successor step's one complete-material adapter: it resolves the Run the brief reports and calls
 * `assembleHandoffBrief` over the injected read owners. The reported Run is the source Session's last ENDED Run
 * (a writer may already hold a newer, still-running claim), else its current claim so `readPreviousTurn` answers
 * `not_entered` — the named `no_formal_final_answer` absence. A source that never ran is that same absence, never a
 * rejection; a located Run whose record cannot be read is `unavailable`, never a silent empty material.
 *
 * `readAssembly` is the composition root's late-bound reader group: the note and decision readers are built after
 * the handoff owner. A platform without it (no Runtime) answers `unavailable` rather than fabricating material.
 */
export function createHandoffBriefMaterialAssembler(
  sources: HandoffBriefMaterialSources,
  readAssembly: () => HandoffBriefAssemblyDeps | null,
): HandoffBriefMaterialAssembler {
  type SourceRead = { ok: true; value: TaskExecutionRecord | null } | { ok: false; rejection: CoreRejection };
  async function sourceRecordOf(ctx: CoreCallContext, source: SessionRef): Promise<SourceRead> {
    const card = await sources.sessions.readSession(ctx, source);
    if (card.status !== 'ready') {
      return { ok: false, rejection: card.status === 'rejected' ? card
        : rejected('unavailable', 'the handoff source Session read is not ready') };
    }
    const last = card.value.record.lastExecutionRef;
    let claims;
    try {
      claims = await lookupAll(sources.records, WORK_EXECUTION_BY_SESSION_LOOKUP,
        [source.projectId, card.value.record.workspaceId, source.sessionId]);
    } catch {
      return { ok: false, rejection: rejected('unavailable', 'the handoff source Run facts could not be read') };
    }
    const candidates: { runRef: RunRef; generation: number }[] = [];
    for (const encoded of claims.items) {
      const decoded = decodeDispatchOutboxEntry(encoded);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejected('unavailable',
          `the handoff source claim is damaged: ${decoded.reason}`) };
      }
      candidates.push({ runRef: decoded.value.claim.runRef, generation: decoded.value.claim.generation });
    }
    const read: { record: TaskExecutionRecord; generation: number }[] = [];
    for (const candidate of candidates) {
      // A claim names a Run that must exist: a located Run's not_found or failed read rejects, never proves absence.
      const execution = await sources.executions.readExecution(ctx, candidate.runRef);
      if (execution.status !== 'ready') {
        return { ok: false, rejection: execution.status === 'rejected' ? execution
          : rejected('unavailable', `the handoff source Run ${candidate.runRef.runId} is not readable`) };
      }
      read.push({ record: execution.value, generation: candidate.generation });
    }
    const ended = read.filter(entry => entry.record.run.endedAt !== null)
      .sort((left, right) => {
        const byEnded = (left.record.run.endedAt ?? '') < (right.record.run.endedAt ?? '') ? 1
          : (left.record.run.endedAt ?? '') > (right.record.run.endedAt ?? '') ? -1 : 0;
        return byEnded !== 0 ? byEnded : right.generation - left.generation;
      })[0];
    const chosen = ended ?? read.sort((left, right) => right.generation - left.generation)[0];
    if (chosen !== undefined) return { ok: true, value: chosen.record };
    if (last !== null && last !== undefined && last.aggregateType === 'Run') {
      const execution = await sources.executions.readExecution(ctx, last);
      if (execution.status !== 'ready') {
        return { ok: false, rejection: execution.status === 'rejected' ? execution
          : rejected('unavailable', `the handoff source Run ${last.runId} is not readable`) };
      }
      return { ok: true, value: execution.value };
    }
    // The successful claim read found no Run and the Session names none: the source never ran.
    return { ok: true, value: null };
  }
  return {
    async assemble(ctx, input) {
      const assembly = readAssembly();
      if (assembly === null) return rejected('unavailable', 'the handoff brief readers are not wired');
      const resolved = await sourceRecordOf(ctx, input.source);
      if (!resolved.ok) return resolved.rejection;
      const sourceRecord = resolved.value;
      const sourceRun = sourceRecord === null ? null : sourceRecord.run.ref;
      return assembleHandoffBrief(assembly, ctx, input.duty === 'executor'
        ? { duty: 'executor', source: input.source, sourceRun, sourceRecord,
          tasks: input.tasks, workspaceId: input.workspaceId, signal: ctx.signal, understanding: input.understanding }
        : { duty: 'adviser', source: input.source, sourceRun,
          workspaceId: input.workspaceId, signal: ctx.signal, understanding: input.understanding,
          handedScope: input.handedScope });
    },
  };
}
