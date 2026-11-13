/**
 * The `repair_approval` card source: a read projection over a Goal's staged
 * `repair` notes. A card exists exactly when the repair needs one
 * (`repairNeedsCard`: structural, every-step, rename) or when, after the
 * note's bound round is a settled PASS, the footprint is unknown/incomplete.
 * 121-109: structural and rename are lifted for a repair staged under the
 * "auto" switch, until its activation's hold notice exists (Q6: the card
 * depends on that one record).
 * Nothing is written; a note version change is a new key, and a note that moved
 * (or needs no card) reads as no card.
 *
 * The source keeps the projection's own read order: the note's staged run and
 * bound round first, then — only for a settled PASS — the run-executed Plan's
 * declared scope, the RunActivity, the observation and the current catalog.
 * The card and the answer facts share `repairApprovalObjects`, exactly as the
 * structural proposal source shares its object read.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, VersionPin } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import { decisionSourceKey, decisionSubjectGoalRef, type DecisionObjectV1,
  type DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import { renderNoteHeader, type NoteHeadSnapshot } from '../../../contracts/note.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { ObservedArchitecturePort } from '../architecture/contracts.js';
import {
  catalogGateRefused, readCatalogPointerRevision, readCurrentCatalogWindow, type CurrentCatalogWindow,
} from '../architecture/catalog-service.js';
import { repairCardLifted, repairNeedsCard } from '../architecture/repair-ops.js';
import { REPAIR_APPROVAL_OPTIONS } from '../communication/decision-source-facts.js';
import {
  DECISION_WINDOW_MOVED_REASON, type DecisionCardSourcePort, type DecisionCardV1, type S5RecordPort,
} from '../model/decision-contracts.js';
import { readBoundRepairRound, readObservation, readRepairAutoHold, footprintProblem } from '../notes/activate-repair.js';
import { readAllHeads } from '../notes/note-base-reader.js';
import { overlayFileKnowledge, prepareNoteFiles, preparedHeads } from '../notes/note-knowledge.js';
import type { KnowledgeLines } from '../model/line-knowledge.js';
import { moduleRefOf } from '../notes/note-anchors.js';
import { mapStoreFailure } from '../notes/store-failures.js';
import {
  decodeNoteHeadSnapshot, noteHeadRefKey, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
} from '../persistence/note-record-codecs.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { decodeRunActivitySnapshot, runActivityRefKey } from '../persistence/run-activity-codecs.js';
import { readGoalSettings } from '../persistence/record-codecs.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import { runActivityRefOf } from '../tasks/run-activity-service.js';
import { readGoal } from '../tasks/plan-readers.js';
import { nestedSourceObject, parseDecisionSourceKey } from '../tasks/decision-source-identity.js';
import { createCollectionCardSource } from './decision-read-model.js';
import { runRefOfPins, taskRefOfPins } from './decision-card-refs.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';

export type RepairApprovalSourceDependencies = {
  records: DecisionReadRecordsPort;
  /** #46: a repair's ops come from its note file (the pin and moves stay the record's). */
  knowledge: KnowledgeLines;
  observation: Pick<ObservedArchitecturePort, 'observationState' | 'listFiles'>;
  /** The project's main workspace; absent treats the Run's workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
};

/** The note's own decision object, in the same aggregate shape the note card uses. */
export function repairApprovalObjects(head: Pick<NoteHeadSnapshot, 'kind' | 'anchor' | 'structural'
  | 'conclusion' | 'ref' | 'version'>): DecisionObjectV1[] {
  return [{
    kind: 'aggregate',
    pin: { ref: { aggregateType: 'NoteHead', projectId: head.ref.projectId, noteId: head.ref.noteId },
      revision: head.version },
    label: renderNoteHeader(head),
  }];
}

/** The pinned note of a `repair_approval` source, or null when the key is not its canonical identity. */
function notePinOfSource(source: DecisionSourceV1): VersionPin | null {
  if (source.kind !== 'repair_approval') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'repair_approval') return null;
  const raw = nestedSourceObject(parsed.body, 'note');
  if (raw === null) return null;
  const ref = raw['ref'];
  const revision = raw['revision'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'NoteHead'
    || typeof ref['projectId'] !== 'string' || ref['projectId'].length === 0
    || typeof ref['noteId'] !== 'string' || ref['noteId'].length === 0
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  const pin: VersionPin = {
    ref: { aggregateType: 'NoteHead', projectId: ref['projectId'], noteId: ref['noteId'] },
    revision,
  };
  return decisionSourceKey({ kind: 'repair_approval', note: pin }) === source.key ? pin : null;
}

async function readRepairNoteHead(records: DecisionReadRecordsPort, pin: VersionPin): Promise<ReadResult<NoteHeadSnapshot>> {
  const key = noteHeadRefKey({ aggregateType: 'NoteHead', projectId: pin.ref.projectId,
    noteId: (pin.ref as { noteId: string }).noteId });
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? rejected('not_found', 'the repair note does not exist')
      : rejected('unavailable', 'the repair note read neither returned nor reported missing the record');
  }
  const decoded = decodeNoteHeadSnapshot(record);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the repair note is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

/** The answer-facts read of the note objects for a source's pinned head. */
export async function readRepairApprovalObjects(
  records: S5RecordPort,
  source: DecisionSourceV1,
): Promise<ReadResult<DecisionObjectV1[]>> {
  const pin = notePinOfSource(source);
  if (pin === null) return rejected('invalid', 'a repair_approval source names no NoteHead pin');
  const head = await readRepairNoteHead(records, pin);
  if (head.status !== 'ready') return head;
  // The answer is the note's own Goal: the source key carries the note pin, so
  // a subject naming another Goal would otherwise take this note's one answer
  // slot and activate the repair for the wrong Goal.
  if (decisionSubjectGoalRef(source)?.goalId !== head.value.goalId) {
    return rejected('invalid', 'the repair approval source names another Goal than the note');
  }
  if (head.value.version !== pin.revision || head.value.kind !== 'repair' || head.value.state !== 'staged') {
    return rejected('source_stale', 'the repair note is no longer staged at the source version');
  }
  return { status: 'ready', value: repairApprovalObjects(head.value) };
}

function settledPass(round: RoundSnapshot | null): boolean {
  return round !== null && round.status === 'finalized' && round.outcome === 'PASS' && round.gaps.length === 0;
}

const UNKNOWN_RUN = 'repair-approval:run:';
const UNKNOWN_ROUND = 'repair-approval:round:';
/** R-窗 (121-93): the current catalog a queue attempt's footprints read, read with the files before the window. */
const REPAIR_CATALOG = 'repair.approvalCatalog';
type PreparedCatalog = { window: CurrentCatalogWindow; pointerChecked: boolean };

/**
 * [2C2-12]: the footprint's current catalog, from the knowledge files. In a queue window it is the one `prepareWindow`
 * read before the window, its pointer checked once (a pointer that moved since is the window's move); elsewhere (the
 * single card) it is read now.
 */
async function footprintCatalog(deps: RepairApprovalSourceDependencies, ctx: CoreCallContext, projectId: string,
  cache: Map<string, unknown> | undefined): Promise<CurrentCatalogWindow> {
  const prepared = cache?.get(REPAIR_CATALOG) as PreparedCatalog | undefined;
  if (prepared === undefined) return readCurrentCatalogWindow(deps.records, projectId, { lines: deps.knowledge, caller: ctx });
  const { window } = prepared;
  if (!prepared.pointerChecked && (window.status === 'ready' || window.status === 'not_found')) {
    const pointer = await readCatalogPointerRevision(deps.records, projectId);
    if (pointer.status !== 'ready') return pointer;
    if (pointer.value !== (window.status === 'ready' ? window.activeRevision : null)) {
      return rejected('source_stale', DECISION_WINDOW_MOVED_REASON);
    }
    prepared.pointerChecked = true;
  }
  return window;
}

function cached<T>(cache: Map<string, unknown> | undefined, key: string,
  read: () => Promise<T>): Promise<T> {
  const hit = cache?.get(key) as Promise<T> | undefined;
  if (hit !== undefined) return hit;
  const pending = read();
  cache?.set(key, pending);
  return pending;
}

async function readStagedRun(records: DecisionReadRecordsPort, head: NoteHeadSnapshot) {
  if (head.stagedRunKey === null) return null;
  const [goalId, runId] = head.stagedRunKey.split('/');
  if (goalId === undefined || runId === undefined) return null;
  const runKey = canonicalJson({ aggregateType: 'Run', projectId: head.ref.projectId, goalId, runId } as unknown as JsonValue);
  const read = await records.readMany([runKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const record = read.value.records.find((candidate) => candidate.refKey === runKey);
  if (record === undefined) return rejected('not_found', `staged repair Run ${runId} is missing`);
  const decoded = decodeRun(record);
  if (!decoded.ok) return rejected('unavailable', decoded.reason);
  return { status: 'ready' as const, value: decoded.value };
}

/**
 * `catalogRefused`: the footprint's current catalog the read-back gate refused (`unavailable` for any reason but a
 * write in flight, which stays the read's own failure; a read its caller cancelled is answered whole), with its answer.
 */
type FootprintFacts = { footprintUnknown: boolean } | { catalogRefused: CoreRejection };

/** The footprint reads happen only behind a settled PASS, and only then. */
async function readFootprintFacts(
  deps: RepairApprovalSourceDependencies,
  ctx: CoreCallContext,
  head: NoteHeadSnapshot,
  cache: Map<string, unknown> | undefined,
): Promise<ReadResult<FootprintFacts>> {
  if (head.stagedRunKey === null) return { status: 'ready', value: { footprintUnknown: false } };
  const round = await cached(cache, `${UNKNOWN_ROUND}${head.stagedRunKey}:${head.noteId}:${head.version}`,
    () => readBoundRepairRound(deps.records, head));
  if (round.status !== 'ready') return round;
  if (!settledPass(round.value)) return { status: 'ready', value: { footprintUnknown: false } };
  const repair = head.repair;
  if (repair === undefined) return rejected('unavailable', 'a repair note carries no repair payload');

  const run = await cached(cache, `${UNKNOWN_RUN}${head.stagedRunKey}`, () => readStagedRun(deps.records, head));
  if (run === null) return { status: 'ready', value: { footprintUnknown: false } };
  if (run.status !== 'ready') return run;

  const planKey = planRevisionRefKey(run.value.planRef);
  const planRead = await deps.records.readMany([planKey]);
  if (planRead.status !== 'ready') return mapStoreFailure(planRead);
  const planRecord = planRead.value.records.find((candidate) => candidate.refKey === planKey);
  if (planRecord === undefined) {
    return planRead.value.missing.includes(planKey)
      ? rejected('not_found', 'the Run-executed Plan does not exist')
      : rejected('unavailable', 'the Run-executed Plan read neither returned nor reported missing the record');
  }
  const plan = decodePlanRevisionSnapshot(planRecord);
  if (plan.status !== 'decoded') return rejected('unavailable', `the Run-executed Plan is damaged: ${plan.reason}`);
  const task = plan.value.tasks.find((candidate) => candidate.taskId === run.value.task.taskId);
  const declared: ModuleRef[] = task !== undefined && task.scope.kind === 'module'
    ? [moduleRefOf(run.value.task.projectId, task.scope.moduleRef)] : [];

  const activityKey = runActivityRefKey(runActivityRefOf({ ref: run.value.ref }));
  const activityRead = await deps.records.readMany([activityKey]);
  if (activityRead.status !== 'ready') return mapStoreFailure(activityRead);
  const activityRecord = activityRead.value.records.find((candidate) => candidate.refKey === activityKey);
  if (activityRecord === undefined && !activityRead.value.missing.includes(activityKey)) {
    return rejected('unavailable', 'the RunActivity read neither returned nor reported missing the record');
  }
  let activity: import('../../../contracts/run-activity.js').RunActivitySnapshot | null = null;
  if (activityRecord !== undefined) {
    const decoded = decodeRunActivitySnapshot(activityRecord);
    if (decoded.status !== 'decoded') return rejected('unavailable', decoded.reason);
    activity = decoded.value;
  }

  const observation = await readObservation(deps, ctx, run.value.ref.projectId,
    run.value.workspaceSnapshot.workspaceId);
  if (!observation.ok) return observation.rejection;

  const window = await footprintCatalog(deps, ctx, run.value.ref.projectId, cache);
  if (window.status !== 'ready') {
    if (window.status === 'not_found') return rejected('not_found', 'the project has no current architecture catalog');
    return catalogGateRefused(window) && ctx.signal?.aborted !== true
      ? { status: 'ready', value: { catalogRefused: window } } : window;
  }
  const runWorkspaceId = run.value.workspaceSnapshot.workspaceId;
  // The activity's changed files and the observation are the Run workspace's
  // relative paths: project the ONE catalog onto that workspace first, exactly
  // as the activation's own footprint read does. A failed main read is
  // `unavailable`; a ready `null` keeps the Run's workspace as main.
  let mainWorkspaceId = runWorkspaceId;
  if (deps.mainWorkspaceOf !== undefined) {
    const main = await deps.mainWorkspaceOf(run.value.ref.projectId);
    if (main.status !== 'ready') {
      return rejected('unavailable', main.status === 'rejected' ? main.reason : 'the main workspace cannot be read');
    }
    mainWorkspaceId = main.value ?? runWorkspaceId;
  }
  const runCatalog = catalogForWorkspace(window.catalog.catalog, runWorkspaceId, mainWorkspaceId);
  const problem = footprintProblem({
    activity, catalog: runCatalog, declared, observation: observation.files,
    ops: repair.ops, workspaceId: runWorkspaceId, mainWorkspaceId, approval: null,
  });
  return { status: 'ready', value: { footprintUnknown: problem !== null && problem.kind === 'unknown' } };
}

/** `held`: the repair's hold notice exists (`readRepairAutoHold`), so the card shows whatever the switch said (Q6). */
function needsCard(head: NoteHeadSnapshot, autonomy: 'every_step' | 'after_plan_confirmation',
  footprintUnknown: boolean, held: boolean): boolean {
  const repair = head.repair;
  if (repair === undefined) return false;
  const lifted = repairCardLifted(head, held);
  return repairNeedsCard({ structural: repair.structural && !lifted, autonomy,
    rename: repair.ops.some((op) => op.op === 'set_module_name') && !lifted, footprintUnknown });
}

function repairApprovalCard(head: NoteHeadSnapshot, goalRef: GoalRef): DecisionCardV1 {
  const notePin: VersionPin = { ref: { aggregateType: 'NoteHead', projectId: head.ref.projectId,
    noteId: head.noteId }, revision: head.version };
  const source: DecisionSourceV1 = {
    kind: 'repair_approval',
    key: decisionSourceKey({ kind: 'repair_approval', note: notePin }),
    subject: { kind: 'goal', goalRef: structuredClone(goalRef) },
    pins: [notePin],
    goalBases: [],
  };
  return {
    cardKey: source.key,
    source,
    state: 'waiting_answer',
    subject: { kind: 'goal', goalRef: structuredClone(goalRef) },
    senderSessionRef: null,
    requestRef: null,
    objects: repairApprovalObjects(head),
    options: REPAIR_APPROVAL_OPTIONS.map((option) => ({ ...option })),
    answerMessageRef: null,
    answer: null,
    application: null,
    candidateStatus: null,
    staleReason: null,
    closedReason: null,
    openedAt: head.createdAt,
    taskRef: taskRefOfPins(source.pins), runRef: runRefOfPins(source.pins),
    readOnly: false,
    actions: ['answer'],
  };
}

async function readAutonomy(records: DecisionReadRecordsPort, goalRef: GoalRef):
Promise<ReadResult<'every_step' | 'after_plan_confirmation'>> {
  const read = await readGoal(records, goalRef);
  if (read.status !== 'ready') return read;
  return { status: 'ready', value: readGoalSettings(read.goal).autonomy };
}

/** R-窗 (ruling 9): where a queue attempt keeps the staged repair heads overlaid before the window. */
const REPAIR_FILES = 'repair.approvalFiles';
/** Set in a queue attempt whose footprint catalog the read-back gate refused. */
const REPAIR_GATE_REFUSED = 'repair.approvalGateRefused';

/**
 * 2c-2 merge (lead ruling 3, as 121-105 isolates the conflict and note cards): when a staged repair's footprint meets
 * a catalog the read-back gate refused, the queue attempt shows no repair card and says `repair_approval` is
 * `not_available`; the other cards and the notices are read. A write in flight still fails the whole queue, and the
 * single-card read keeps the refusal.
 */
export function createRepairApprovalSource(
  deps: RepairApprovalSourceDependencies,
): DecisionCardSourcePort {
  const base = createCollectionCardSource<NoteHeadSnapshot>({
    kind: 'repair_approval',
    serves: ['goal'],
    async prepareWindow(ctx, { goals, attempt }) {
      const heads: NoteHeadSnapshot[] = [];
      for (const goal of goals) {
        const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [ctx.projectId, goal.ref.goalId, 'staged']);
        if (!page.ok) return rejected(page.code, page.reason);
        heads.push(...page.heads);
      }
      const prepared = await prepareNoteFiles(attempt, REPAIR_FILES, heads, { lines: deps.knowledge, caller: ctx });
      if (prepared.status !== 'ready') return mapStoreFailure(prepared);
      // A staged repair's footprint reads the current catalog in the window; its files are read here, before it.
      if (heads.length > 0 && !attempt.cache.has(REPAIR_CATALOG)) {
        const window = await readCurrentCatalogWindow(deps.records, ctx.projectId, { lines: deps.knowledge, caller: ctx });
        attempt.cache.set(REPAIR_CATALOG, { window, pointerChecked: false } satisfies PreparedCatalog);
      }
      return { status: 'ready', value: undefined };
    },
    async readCollection(ctx, { subject, attempt }) {
      if (subject.kind !== 'goal') return { status: 'ready', value: [] };
      const goalRef = subject.goalRef;
      const autonomy = await readAutonomy(deps.records, goalRef);
      if (autonomy.status !== 'ready') return autonomy;
      const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
        [ctx.projectId, goalRef.goalId, 'staged']);
      if (!page.ok) return rejected(page.code, page.reason);
      // In the queue window the files were read before it; a staged head that moved since is the window's move.
      const shown = preparedHeads(attempt, REPAIR_FILES, page.heads);
      if (shown === 'moved') return rejected('source_stale', DECISION_WINDOW_MOVED_REASON);
      const overlaid = shown !== undefined ? { status: 'ready' as const, value: shown }
        : await overlayFileKnowledge(page.heads, { lines: deps.knowledge, caller: ctx });
      if (overlaid.status !== 'ready') return mapStoreFailure(overlaid);
      const notes: NoteHeadSnapshot[] = [];
      for (const head of overlaid.value) {
        if (head.kind !== 'repair' || head.stagedRunKey === null) continue;
        const facts = await readFootprintFacts(deps, ctx, head, attempt?.cache);
        if (facts.status !== 'ready') return facts;
        if ('catalogRefused' in facts.value) {
          if (attempt === undefined) return facts.value.catalogRefused;
          attempt.cache.set(REPAIR_GATE_REFUSED, true);
          return { status: 'ready', value: [] };
        }
        const held = await readRepairAutoHold(deps.records, head);
        if (held.status !== 'ready') return held;
        if (needsCard(head, autonomy.value, facts.value.footprintUnknown, held.value)) notes.push(head);
      }
      return { status: 'ready', value: notes };
    },
    keyOf: (head) => decisionSourceKey({ kind: 'repair_approval', note: {
      ref: { aggregateType: 'NoteHead', projectId: head.ref.projectId, noteId: head.noteId },
      revision: head.version,
    } }),
    project: (head, subject) => repairApprovalCard(head, (subject as { kind: 'goal'; goalRef: GoalRef }).goalRef),
    async readByKey(ctx, { source }) {
      const pin = notePinOfSource(source);
      if (pin === null || pin.ref.projectId !== ctx.projectId) {
        return { status: 'rejected', code: 'invalid',
          reason: 'a repair_approval source key is not a canonical NoteHead pin of this project' };
      }
      if (source.subject.kind !== 'goal') return { status: 'ready', value: null };
      const head = await readRepairNoteHead(deps.records, pin);
      if (head.status !== 'ready') return head;
      const overlaid = await overlayFileKnowledge([head.value], { lines: deps.knowledge, caller: ctx });
      if (overlaid.status !== 'ready') return mapStoreFailure(overlaid);
      const note = overlaid.value[0]!;
      if (note.version !== pin.revision || note.kind !== 'repair' || note.state !== 'staged'
        || note.stagedRunKey === null || note.goalId !== source.subject.goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      const autonomy = await readAutonomy(deps.records, source.subject.goalRef);
      if (autonomy.status !== 'ready') return autonomy;
      const facts = await readFootprintFacts(deps, ctx, note, undefined);
      if (facts.status !== 'ready') return facts;
      if ('catalogRefused' in facts.value) return facts.value.catalogRefused;
      const held = await readRepairAutoHold(deps.records, note);
      if (held.status !== 'ready') return held;
      if (!needsCard(note, autonomy.value, facts.value.footprintUnknown, held.value)) {
        return { status: 'ready', value: null };
      }
      return { status: 'ready', value: { item: note } };
    },
  });
  return {
    ...base,
    async readPage(ctx, input) {
      const result = await base.readPage(ctx, input);
      if (result.status !== 'ready' || input.page.attempt?.cache.get(REPAIR_GATE_REFUSED) !== true) return result;
      return { status: 'ready', value: { ...result.value, availability: 'not_available', items: [], nextCursor: null } };
    },
  };
}
