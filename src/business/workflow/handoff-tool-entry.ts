/**
 * The `hand_off` tool's one platform entry (book-7c §3.5). It owns no write of its own: it proves the tool's caller and
 * source line, reads the source Run's current understanding, then accepts through the existing trusted Host handoff
 * entry (`handoff.accept`, trigger `tool`). The accept stores record 2's `tool` fragment and, when the source line is
 * long-lived or the Goal's autonomy asks for a person, opens the approval card; this entry maps that committed result
 * to the tool's three success arms and never returns a `WriteResult` verbatim.
 *
 * The understanding rule (book-7c §3.5 item 3): at least one current `understanding` note whose source is the source
 * Run, on a goal or stage anchor of the handed tasks' goals. A missing, foreign or other-Run note is
 * `{ status: 'incomplete', text }` and writes nothing; a damaged note version is `invalid`, never a partial
 * understanding pointer. An adviser's own line hands no task, so its one Goal is the caller Run's Goal.
 *
 * The reads the tool group cannot carry on `CoreCallContext` (the note read, the Goal plan window, the Session
 * facts/directory/duty reads and the accept owner) come from the one factory call per platform: the entry closes
 * over its platform's own dependencies and no module-level installation exists.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ActorRef } from '../../contracts/command-event.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionWorkLink } from '../../contracts/core/session.js';
import type { RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { NoteAnchorV1 } from '../../contracts/note.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { HandoffToolFragmentV1 } from '../../contracts/handoff.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import { templateToolNames } from '../../contracts/continuation-brief-render.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { NoteItemV1, NoteReadPort } from '../../core/work-graph/model/note-contracts.js';
import type { SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type { SessionFactsPort } from '../../core/work-graph/model/session-facts-contracts.js';
import type { GoalPlanWindow } from '../../core/work-graph/tasks/plan-readers.js';
import { workspaceOf } from '../../core/work-graph/tasks/request-service.js';
import type { SessionDutyReadPort } from '../../core/work-graph/model/work-line-contracts.js';
import { HANDOFF_SYSTEM_PRINCIPAL } from '../../core/work-graph/model/request-contracts.js';
import { agentActorOf } from '../../core/work-graph/model/tool-commit-arguments.js';
import type { SessionHandoffPort } from '../../core/work-graph/sessions/session-handoff-service.js';
import { handoffContextOf } from '../../core/work-graph/sessions/session-handoff-service.js';
import { sameRef } from '../../core/work-graph/state/ref-equality.js';

/** The frozen pack texts the incomplete result renders from; the tool's own copy is the generated platform pack. */
const TEXTS: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;
/** One note page (the note port admits 1–100); the anchor page is paged to its end, so this is not a bound. */
const NOTE_PAGE_LIMIT = 100;

/** The reads the tool group cannot carry on `CoreCallContext`; the composition builds one entry with them. */
export type HandoffToolEntryDependenciesV1 = {
  /** The one trusted Host accept owner the tool's accept calls. */
  handoff: Pick<SessionHandoffPort, 'acceptHandoff'>;
  /** The note read the understanding check pages and version-reads. */
  notes: Pick<NoteReadPort, 'readNote' | 'listByAnchor'>;
  /** The Goal's active plan window: the stage anchors of the handed tasks. */
  plans: (ctx: CoreCallContext, goalRef: GoalRef) => Promise<GoalPlanWindow>;
  /** The source Session card (its real duty and its open `responsible` links). */
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  /** The source Session's own last Work claim: the real source Run of another line. */
  sessionFacts: Pick<SessionFactsPort, 'readSessionFacts'>;
  duty: SessionDutyReadPort;
};

export type HandoffRequestInputV1 = {
  commandId: string;
  /** L16: the book's caller shape (book-7c.md:994); T fills `actor`, and H derives record 2's own actor below. */
  caller: { actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef;
    duty: 'executor' | 'adviser' };
  source: SessionRef;
  assignments: { target: { kind: 'create'; duty: 'executor' | 'adviser' } | { kind: 'existing'; session: SessionRef };
    tasks: TaskTriple[] }[];
  reason: string;
};

export type HandoffRequestResultV1 =
  | { status: 'incomplete'; text: string }
  | { status: 'accepted'; operation: OperationRef }
  | { status: 'needs_decision'; cardKey: string; operation: OperationRef }
  | CoreRejection;

function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }

/** The handed tasks' distinct Goals, in the order they first appear. */
function taskGoalsOf(input: HandoffRequestInputV1): GoalRef[] {
  const goals = new Map<string, GoalRef>();
  for (const assignment of input.assignments) {
    for (const task of assignment.tasks) {
      const key = canonicalJson({ projectId: task.projectId, goalId: task.goalId } as never);
      if (!goals.has(key)) goals.set(key, { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId });
    }
  }
  return [...goals.values()];
}

/**
 * The Goals whose understanding the assignment requires: the handed Tasks' Goals. An adviser's own line hands no
 * task, so its one Goal is the caller Run's Goal; any other assignment with no handed task has no Goal to prove.
 */
function understandingGoalsOf(input: HandoffRequestInputV1): GoalRef[] {
  const goals = taskGoalsOf(input);
  if (goals.length > 0) return goals;
  if (input.caller.duty !== 'adviser' || !sameRef(input.source, input.caller.session)) return [];
  return [{ aggregateType: 'Goal', projectId: input.caller.run.projectId, goalId: input.caller.run.goalId }];
}

/** The source Run whose current understanding version is the one the accept stores. */
async function sourceRunOf(ctx: CoreCallContext, deps: HandoffToolEntryDependenciesV1,
  input: HandoffRequestInputV1): Promise<{ run: RunRef | null } | CoreRejection> {
  if (sameRef(input.source, input.caller.session)) return { run: input.caller.run };
  const facts = await deps.sessionFacts.readSessionFacts(ctx, input.source);
  if (facts.status === 'not_found') return rejected('not_found', 'the handoff source Session is not in this workspace');
  if (facts.status !== 'ready') {
    return facts.status === 'rejected' ? facts : unavailable('the handoff source Session facts are not ready');
  }
  return { run: facts.value.latestWork?.runRef ?? null };
}

/** The note's source is exactly the source Run and the note is still the current version. */
function isSourceNote(item: NoteItemV1, sourceRun: RunRef | null): boolean {
  if (sourceRun === null || !item.currentEligible) return false;
  return item.source.kind === 'agent' && item.source.runRef !== null && sameRef(item.source.runRef, sourceRun);
}

/** The stage anchors of the handed tasks of one Goal; a Task without a stage contributes no stage anchor. */
function stageAnchorsOf(window: GoalPlanWindow, goalRef: GoalRef, tasks: readonly TaskTriple[]): NoteAnchorV1[] {
  if (window.status !== 'ready' || window.plan === null) return [];
  const plan = window.plan;
  const anchors = new Map<string, NoteAnchorV1>();
  const wanted = new Set(tasks.map(task => task.taskId));
  for (const task of plan.tasks) {
    if (!wanted.has(task.taskId) || task.stageId === undefined) continue;
    const anchor: NoteAnchorV1 = { kind: 'stage', goalId: goalRef.goalId, planRevision: plan.planRevision,
      stageId: task.stageId };
    anchors.set(canonicalJson(anchor as never), anchor);
  }
  return [...anchors.values()];
}

/** The `incomplete` result's rendered text: the duty's template with the handed Goals as its task round. */
function understandingText(input: HandoffRequestInputV1, goals: readonly GoalRef[]): string {
  const templateId = `handoff-write-understanding-${input.caller.duty}`;
  const taskRound = [packString(TEXTS, 'handoff.understandingInstruction'),
    ...goals.map(goal => `- Goal ${canonicalJson({ projectId: goal.projectId, goalId: goal.goalId } as never)}`)].join('\n');
  return renderTemplate(TEXTS, templateId, { task_round: taskRound }, templateToolNames(TEXTS, templateId)).text;
}

/** The source Run's current understanding versions, in Goal order, or the refusal/incomplete arm. */
async function readUnderstanding(ctx: CoreCallContext, deps: HandoffToolEntryDependenciesV1,
  input: HandoffRequestInputV1): Promise<{ found: { noteId: string; version: number }[] } | { text: string } | CoreRejection> {
  const goals = understandingGoalsOf(input);
  const source = await sourceRunOf(ctx, deps, input);
  if ('status' in source) return source;
  const anchors: { goal: GoalRef; anchors: NoteAnchorV1[] }[] = [];
  for (const goal of goals) {
    const window = await deps.plans(ctx, goal);
    if (window.status === 'rejected') return window;
    const tasks = input.assignments.flatMap(assignment => assignment.tasks)
      .filter(task => task.goalId === goal.goalId);
    anchors.push({ goal, anchors: [{ kind: 'goal', goalId: goal.goalId }, ...stageAnchorsOf(window, goal, tasks)] });
  }
  const found: { noteId: string; version: number }[] = [];
  const seen = new Set<string>();
  for (const entry of anchors) {
    for (const anchor of entry.anchors) {
      let cursor: string | null = null;
      for (;;) {
        const page = await deps.notes.listByAnchor(ctx, { anchor, limit: NOTE_PAGE_LIMIT, cursor });
        if (page.status === 'not_found') break;
        if (page.status === 'not_ready') return { text: understandingText(input, goals) };
        if (page.status === 'rejected') {
          return page.code === 'cancelled' ? page : { text: understandingText(input, goals) };
        }
        for (const listed of page.value.items) {
          if (listed.kind !== 'understanding') continue;
          const read = await deps.notes.readNote(ctx, { noteId: listed.noteId, version: listed.version });
          if (read.status === 'not_found' || read.status === 'not_ready') {
            return { text: understandingText(input, goals) };
          }
          if (read.status === 'rejected') {
            if (read.code === 'invalid') return read;
            return read.code === 'cancelled' ? read : { text: understandingText(input, goals) };
          }
          if (!isSourceNote(read.value, source.run)) continue;
          const key = `${read.value.noteId}@${String(read.value.version)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ noteId: read.value.noteId, version: read.value.version });
        }
        if (page.value.next === null) break;
        cursor = page.value.next;
      }
    }
  }
  return found.length === 0 ? { text: understandingText(input, goals) } : { found };
}

/** The tool's caller/source admission, before any understanding read; a secretary/other line is `forbidden`. */
async function admissionOf(ctx: CoreCallContext, deps: HandoffToolEntryDependenciesV1,
  input: HandoffRequestInputV1): Promise<{ sourceDuty: 'executor' | 'adviser'; links: readonly SessionWorkLink[] } | CoreRejection> {
  const card = await deps.sessions.readSession(ctx, input.source);
  if (card.status === 'not_found') return rejected('not_found', 'the handoff source Session is not in this workspace');
  if (card.status !== 'ready') return unavailable('the handoff source Session read is not ready');
  const duty = await deps.duty(card.value.record.role, ctx);
  if (duty.status !== 'ready') return unavailable('the handoff source duty is not known');
  if (duty.value !== 'executor' && duty.value !== 'adviser') {
    return rejected('forbidden', 'only an executor or adviser line can be handed off by the tool');
  }
  const ownLine = sameRef(input.source, input.caller.session);
  if (input.caller.duty === 'executor' && !ownLine) {
    return rejected('forbidden', 'an executor hands only its own line');
  }
  if (input.caller.duty === 'adviser' && !ownLine && duty.value !== 'executor') {
    return rejected('forbidden', 'an adviser hands another line only when it is an executor line');
  }
  if (input.caller.duty === 'adviser' && ownLine && duty.value !== 'adviser') {
    return rejected('forbidden', 'an adviser hands its own line only when that line is an adviser line');
  }
  return { sourceDuty: duty.value, links: card.value.links };
}

/**
 * The tool's task rules, after the understanding check: every task must hold an open `responsible` link on the
 * source, and an adviser handing another line hands tasks of its Run's Goal.
 */
function taskProblemOf(input: HandoffRequestInputV1, links: readonly SessionWorkLink[]): CoreRejection | null {
  const ownLine = sameRef(input.source, input.caller.session);
  for (const [index, assignment] of input.assignments.entries()) {
    for (const [taskIndex, task] of assignment.tasks.entries()) {
      const held = links.some(link => link.ref.relation === 'responsible' && link.until === null
        && link.ref.target.kind === 'task' && sameRef(link.ref.target.ref, task));
      if (!held) {
        return rejected('invalid', `assignments[${index}].tasks[${taskIndex}] is not a task the source line is responsible for`);
      }
      if (input.caller.duty === 'adviser' && !ownLine && task.goalId !== input.caller.run.goalId) {
        return rejected('invalid', `assignments[${index}].tasks[${taskIndex}] is not in the adviser Run's Goal`);
      }
    }
  }
  return null;
}

/**
 * The `hand_off` entry factory: one closure per platform, over that platform's own reads. It owns no write: the
 * understanding check runs before the accept, the accept's committed value decides `accepted` versus
 * `needs_decision`, and every rejection is returned verbatim.
 */
export function createHandoffToolEntry(deps: HandoffToolEntryDependenciesV1):
{ requestHandoff(ctx: CoreCallContext, input: HandoffRequestInputV1): Promise<HandoffRequestResultV1> } {
  async function requestHandoff(ctx: CoreCallContext, input: HandoffRequestInputV1): Promise<HandoffRequestResultV1> {
    const reading = handoffContextOf(ctx, HANDOFF_SYSTEM_PRINCIPAL);
    const admitted = await admissionOf(reading, deps, input);
    if ('status' in admitted) return admitted;
    const understanding = await readUnderstanding(reading, deps, input);
    if ('status' in understanding) return understanding;
    if ('text' in understanding) return { status: 'incomplete', text: understanding.text };
    const taskProblem = taskProblemOf(input, admitted.links);
    if (taskProblem !== null) return taskProblem;
    const tool: HandoffToolFragmentV1 = {
      caller: { actor: agentActorOf(input.caller.session, input.caller.run), session: structuredClone(input.caller.session),
        run: structuredClone(input.caller.run), duty: input.caller.duty },
      reason: input.reason,
      understanding: understanding.found,
    };
    const assignments = input.assignments.map(assignment => ({
      target: assignment.target.kind === 'create'
        // The book's rule: a created successor's duty follows the source line's fixed duty.
        ? { kind: 'create' as const, duty: admitted.sourceDuty }
        : { kind: 'existing' as const, session: structuredClone(assignment.target.session) },
      tasks: assignment.tasks.map(task => ({ ...task })),
    }));
    const accepted = await deps.handoff.acceptHandoff(reading, { commandId: input.commandId,
      workspace: workspaceOf(ctx), source: structuredClone(input.source),
      trigger: 'tool', assignments, tool });
    if (accepted.status === 'rejected') return accepted;
    const { operation, approval } = accepted.value;
    return approval !== null && approval.state === 'pending'
      ? { status: 'needs_decision', cardKey: approval.cardKey, operation }
      : { status: 'accepted', operation };
  }
  return { requestHandoff };
}
