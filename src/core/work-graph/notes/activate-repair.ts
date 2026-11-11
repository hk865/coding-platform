/**
 * 8C G3: the one repair-activation owner and the pure repair-footprint
 * predicate. It binds a staged `repair` note to the effective head of its Run's
 * round chain, checks the round PASS, the approval and the footprint, and then
 * commits the note's `staged → accepted` together with G2's catalog revision
 * contribution in ONE `PreparedCommit`.
 *
 * The approval read and the card projection are the only other callers of the
 * pure predicate; no second activation entry and no second command id exists.
 */
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import { isSafeProjectPath, normalizeProjectPath, resolveStoredProjectPath } from '../../../contracts/workspace-path.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { ModuleRef, VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRecord } from '../state/message-machine.js';
import type { DecisionChangeProofV1, DecisionSubjectV1 } from '../../../contracts/goal-decisions.js';
import type { NoteBodyV1, CatalogRepairOpV1, NoteHeadSnapshot, PendingNoteHeadSnapshot } from '../../../contracts/note.js';
import type { RunActivitySnapshot } from '../../../contracts/run-activity.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  CommitCursorBinding, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { ObservedArchitecturePort } from '../architecture/contracts.js';
import {
  architectureWritePlansOf, catalogPinOf, knowledgeBaselineOf, readCurrentCatalogWindow,
} from '../architecture/catalog-service.js';
import {
  knowledgeCommit, knowledgeFilesNotWritten, writeKnowledge, type KnowledgeCommitThrow, type KnowledgePrepared,
} from '../knowledge/knowledge-write.js';
import type { KnowledgeLines, LineKnowledge } from '../model/line-knowledge.js';
import { decodeArchitectureCatalogRevisedEvent, encodeArchitectureCatalogRevisedEvent,
  ARCHITECTURE_CATALOG_REVISED_EVENT } from '../architecture/catalog-record-codecs.js';
import {
  draftCatalogRevision, finishCatalogRevision, type CatalogRevisionDependencies,
} from '../architecture/revision-planner.js';
import { repairBindingDigest, repairNeedsCard } from '../architecture/repair-ops.js';
import { decodeEvidenceSnapshot } from '../persistence/evidence-record-codecs.js';
import {
  NOTE_DISPOSITION_CHANGED_EVENT_TYPE, NOTE_EVENT_SCHEMA_VERSION, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
  decodeNoteHeadSnapshot, encodeNoteDispositionChangedEvent, encodeNoteHeadSnapshot, encodeNoteVersionSnapshot,
  noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { readGoalSettings } from '../persistence/record-codecs.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { decodeRun, } from '../persistence/run-record-codecs.js';
import { decodeRunActivitySnapshot, runActivityRefKey } from '../persistence/run-activity-codecs.js';
import { newNoteVersionRecord, noteBodyOf, transitionNote } from '../state/note-machine.js';
import { roundChainHead, roundGoalActivityProblem, roundSubjectActivityProblem } from '../state/verification-machine.js';
import { readGoal, readPlan, readRunRoundChain } from '../tasks/plan-readers.js';
import { runActivityRefOf } from '../tasks/run-activity-service.js';
import { evidenceApplicabilityWithBasis } from '../tasks/evidence-coverage.js';
import { replayCommittedReceipt } from '../tasks/receipt-replay.js';
import { mapExecutedFilesToModules } from '../model/architecture-footprint.js';
import { noteCommandIdentity, noteFileWritesOf } from './note-service.js';
import { normalizePath } from './note-anchors.js';
import { readAllHeads } from './note-base-reader.js';
import { mapStoreFailure } from './store-failures.js';
import type { S5RecordPort } from '../model/decision-contracts.js';

export type RepairReadRecords = Pick<S5RecordPort, 'readMany' | 'lookup'>;

export type RepairActivationDependencies = {
  records: GoalRecordTransactionPort & RepairReadRecords;
  observation: Pick<ObservedArchitecturePort, 'observationState' | 'listFiles'>;
  decisionMessages: {
    readDecisionMessagePin(ctx: CoreCallContext, input: { source: RepairApprovalSourceV1 }):
      Promise<ReadResult<{ message: SessionMessageRecord | null }>>;
  };
  catalogRevision: Pick<CatalogRevisionDependencies, 'taskFacts' | 'responsibility' | 'duty'>;
  /** The knowledge files the activation reads the current catalog from and writes. */
  knowledge: KnowledgeLines;
  /** The project's main workspace; absent treats the Run's workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
  now(): string;
  eventId(): string;
  newId(): string;
};

/**
 * The `repair_approval` arm of `DecisionSourceV1`/`DecisionSourceIdentityV1`.
 * G4 owns those two contract arms; this local shape is structurally the arm it
 * adds, so the owner's un-narrowed `readDecisionMessagePin` stays assignable
 * once G4 lands and this file needs no cast.
 */
type RepairApprovalSourceV1 = {
  kind: 'repair_approval';
  key: string;
  subject: DecisionSubjectV1;
  pins: VersionPin[];
};

export type ActivateRepairResult =
  | { status: 'activated'; noteId: string; version: number; cursor: CommitCursor; revision: ArchitectureRevision }
  | { status: 'not_ready'; reason: 'approval_pending' | 'check_not_passed' | 'footprint_unknown' | 'goal_paused' }
  | { status: 'forbidden'; reason: 'outside_footprint'; paths: string[] }
  | { status: 'source_stale'; reason: 'catalog_changed' | 'note_version_changed' | 'round_changed' }
  | { status: 'revision_conflict'; current: VersionPin[] }
  | CoreRejection;

export type RepairActivationService = {
  activateRepair(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number }):
    Promise<ActivateRepairResult>;
  attemptRepairsForGoal(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ActivateRepairResult[]>;
};

type ArchitectureRevision = import('../architecture/catalog-contracts.js').ArchitectureRevision;

type RunChain = { run: RunSnapshot; rounds: RoundSnapshot[] };

function repairReadFailure(failed: Exclude<ReadResult<unknown>, { status: 'ready' }>): CoreRejection {
  if (failed.status === 'rejected') return failed;
  if (failed.status === 'not_found') return rejected('not_found', 'the requested record does not exist');
  return rejected('incomplete', 'the requested record is not readable at the required watermark');
}

function stagedRunKeyOf(projectId: string, goalId: string, runId: string): string {
  return canonicalJson({ aggregateType: 'Run', projectId, goalId, runId } as unknown as JsonValue);
}

/**
 * Read the Run and its whole round chain once. `attemptRepairsForGoal` shares
 * one promise per `stagedRunKey`; the round binding itself is selected per note
 * by `boundRoundOf` because two notes of one Run bind different versions.
 */
async function readRunChain(records: RepairReadRecords, head: NoteHeadSnapshot):
Promise<ReadResult<RunChain | null>> {
  if (head.stagedRunKey === null) return { status: 'ready', value: null };
  const slash = head.stagedRunKey.indexOf('/');
  const goalId = head.stagedRunKey.slice(0, slash);
  const runId = head.stagedRunKey.slice(slash + 1);
  const runKey = stagedRunKeyOf(head.ref.projectId, goalId, runId);
  const runRead = await records.readMany([runKey]);
  if (runRead.status !== 'ready') return mapStoreFailure(runRead);
  const runRecord = runRead.value.records.find((record) => record.refKey === runKey);
  if (runRecord === undefined) return rejected('not_found', `staged repair Run ${runId} is missing`);
  const decodedRun = decodeRun(runRecord);
  if (!decodedRun.ok) return rejected('unavailable', decodedRun.reason);
  const run = decodedRun.value;
  const chain = await readRunRoundChain(records, run);
  if (chain.status !== 'ready') return chain;
  return { status: 'ready', value: { run, rounds: chain.rounds } };
}

/** The effective head binds this note at exactly its staged version, or nothing binds it (DR-01). */
function boundRoundOf(head: NoteHeadSnapshot, chain: RunChain): ReadResult<RoundSnapshot | null> {
  const chainHead = roundChainHead(chain.rounds);
  if (chainHead.kind === 'none') return { status: 'ready', value: null };
  if (chainHead.kind === 'invalid') return rejected('unavailable', chainHead.reason);
  const round = chainHead.head;
  return {
    status: 'ready',
    value: round.stagedRepairs.some((binding) => binding.noteId === head.noteId && binding.version === head.version)
      ? round
      : null,
  };
}

/** Pure read shared by the activation and the `repair_approval` projection. */
export async function readBoundRepairRound(
  records: RepairReadRecords, head: NoteHeadSnapshot,
): Promise<ReadResult<RoundSnapshot | null>> {
  const chain = await readRunChain(records, head);
  if (chain.status !== 'ready') return chain;
  if (chain.value === null) return { status: 'ready', value: null };
  return boundRoundOf(head, chain.value);
}

/**
 * The footprint predicate. Every input is already-read material; the function
 * never reads records and never guesses a declared module or an observed file.
 * `approval: 'approve'` only clears an unknown result (missing/incomplete
 * evidence); a proven outside path still returns `outside`.
 */
export function footprintProblem(input: {
  activity: RunActivitySnapshot | null;
  catalog: import('../../../contracts/architecture-catalog.js').AdoptedArchitecture;
  declared: readonly ModuleRef[];
  observation: ReadonlySet<string> | null;
  ops: readonly CatalogRepairOpV1[];
  /** The Run workspace the catalog, changed files and observation are relative to. */
  workspaceId: string;
  mainWorkspaceId: string;
  approval: 'approve' | null;
}): { kind: 'unknown'; paths: string[] } | { kind: 'outside'; paths: string[] } | null {
  const { activity, catalog, declared, observation, ops, approval } = input;
  const pathOps = ops.filter((op) => op.op === 'add_path' || op.op === 'remove_path');
  const touchedPaths = pathOps.map((op) => normalizeProjectPath(op.path));
  const counted = activity !== null && activity.facts.status === 'counted' ? activity.facts : null;
  const incomplete = counted !== null && (counted.changedFiles.possiblyIncomplete
    || counted.changedFiles.definiteOmitted > 0 || counted.changedFiles.possibleOmitted > 0);
  if (counted === null || incomplete) {
    return approval === 'approve' ? null : { kind: 'unknown', paths: touchedPaths };
  }
  const definite = new Set(counted.changedFiles.definite.map((path) => normalizePath(path)));
  const observed = observation === null ? null : new Set([...observation].map((path) => normalizePath(path)));
  const mapped = mapExecutedFilesToModules(catalog,
    counted.changedFiles.definite.map((path) => ({ path, certainty: 'definite' as const })))
    .flatMap((file) => file.moduleRef === null ? [] : [file.moduleRef]);
  const affected = new Set<string>();
  for (const ref of [...declared, ...mapped]) affected.add(ref.moduleId);
  for (const op of ops) if (op.op === 'add_module') affected.add(op.module.ref.moduleId);

  const outside = new Set<string>();
  const unknown = new Set<string>();

  /** The one path rule for `add_path`/`remove_path` and `add_module` paths. */
  function repairPathProblem(raw: string): void {
    const projectPath = normalizeProjectPath(raw);
    if (!isSafeProjectPath(projectPath)) { outside.add(projectPath); return; }
    // The changed files and the observation are the Run workspace's relative
    // paths: resolve the stored project path to its own workspace first, and
    // compare only when it is this Run's workspace.
    let resolved: { workspaceId: string; path: string };
    try { resolved = resolveStoredProjectPath(projectPath, input.mainWorkspaceId); }
    catch { outside.add(projectPath); return; }
    if (resolved.workspaceId !== input.workspaceId) { outside.add(projectPath); return; }
    const path = resolved.path;
    if (definite.has(path)) return;
    // A literal path that is not a definite file is a directory prefix: it is
    // proven only when a successful observation has EVERY file under it in
    // `definite`; `.` is the root prefix and matches every relative file.
    if (observed === null) { unknown.add(projectPath); return; }
    const prefix = path === '.' ? '' : path;
    for (const file of observed) {
      const under = prefix === '' || file === prefix || file.startsWith(`${prefix}/`);
      if (under && !definite.has(file)) { outside.add(projectPath); return; }
    }
  }

  for (const op of pathOps) repairPathProblem(op.path);
  for (const op of ops) {
    switch (op.op) {
      case 'add_path':
      case 'remove_path':
        break;
      case 'add_module':
        for (const path of op.module.paths) repairPathProblem(path);
        break;
      case 'remove_module':
        if (!affected.has(op.moduleId)) outside.add(op.moduleId);
        break;
      case 'set_dependency_reason':
      case 'add_dependency':
      case 'remove_dependency':
      case 'add_forbid_rule':
      case 'remove_forbid_rule':
        if (!affected.has(op.from.moduleId)) outside.add(op.from.moduleId);
        if (!affected.has(op.to.moduleId)) outside.add(op.to.moduleId);
        break;
      case 'set_parent':
      case 'set_responsibility':
      case 'set_module_name':
      case 'add_interface':
      case 'set_interface':
      case 'remove_interface':
        if (!affected.has(op.moduleId)) outside.add(op.moduleId);
        break;
    }
  }
  if (unknown.size > 0 && approval !== 'approve') return { kind: 'unknown', paths: [...unknown] };
  if (outside.size > 0) return { kind: 'outside', paths: [...outside] };
  return null;
}

function fingerprintOfActivation(ctx: CoreCallContext, input: {
  commandId: string; noteId: string; expectedVersion: number;
}): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1, kind: 's8c-repair-activation', projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null,
    commandId: input.commandId, noteId: input.noteId, expectedVersion: input.expectedVersion,
  } as unknown as JsonValue));
}

/** Restore the ORIGINAL `activated` result from the commit's own tail event. */
async function replayActivation(deps: RepairActivationDependencies, ctx: CoreCallContext,
  receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value'],
  input: { commandId: string; noteId: string; expectedVersion: number }): Promise<ActivateRepairResult> {
  const replayed = await replayCommittedReceipt({
    receipt,
    eventAt: (cursor) => deps.records.eventAt(cursor),
    expectedEventType: ARCHITECTURE_CATALOG_REVISED_EVENT,
    decode: decodeArchitectureCatalogRevisedEvent,
    validate: (event) => event.projectId === ctx.projectId
      ? null
      : rejected('unavailable', 'the replayed activation event belongs to another project'),
    project: (event): ActivateRepairResult => ({
      status: 'activated', noteId: input.noteId, version: input.expectedVersion + 1,
      cursor: receipt.cursor, revision: { ...event.revision, catalog: { ...event.revision.catalog, since: receipt.cursor } },
    }),
  });
  return replayed.status === 'committed' ? replayed.value : replayed;
}

/**
 * The original result of this activation command when it already committed (a concurrent copy may have),
 * the failed lookup's rejection, or null when it has not committed.
 */
async function priorActivation(deps: RepairActivationDependencies, ctx: CoreCallContext,
  keys: { identityKey: string; fingerprint: string },
  input: { commandId: string; noteId: string; expectedVersion: number }): Promise<ActivateRepairResult | null> {
  const prior = await deps.records.lookupCommit(keys);
  if (prior.status === 'ready') return replayActivation(deps, ctx, prior.value, input);
  if (prior.code === 'idempotency_conflict') return rejected('idempotency_conflict', prior.reason);
  if (prior.code !== 'not_found') return rejected('unavailable', prior.reason);
  return null;
}

export async function activateRepair(
  deps: RepairActivationDependencies, ctx: CoreCallContext,
  input: { commandId: string; noteId: string; expectedVersion: number },
): Promise<ActivateRepairResult> {
  return activateRepairWith(deps, ctx, input, new Map());
}

type ObservationRead =
  | { ok: true; files: ReadonlySet<string> | null }
  | { ok: false; rejection: CoreRejection };

/** One workspace's observation: the state read and every page of its file list. */
export async function readObservation(deps: Pick<RepairActivationDependencies, 'observation'>,
  ctx: CoreCallContext, projectId: string, workspaceId: string): Promise<ObservationRead> {
  const observedState = await deps.observation.observationState(ctx, {
    workspace: { projectId, workspaceId },
  });
  if (observedState.status !== 'ready') return { ok: false, rejection: repairReadFailure(observedState) };
  if (observedState.value.current === null) return { ok: true, files: null };
  const files: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await deps.observation.listFiles(ctx, { captureRef: observedState.value.current.captureRef, cursor });
    if (page.status !== 'ready') return { ok: false, rejection: repairReadFailure(page) };
    files.push(...page.value.nodes.map((node) => node.path));
    cursor = page.value.nextCursor;
  } while (cursor !== null);
  return { ok: true, files: new Set(files) };
}

/**
 * One attempt's observation reuse, keyed by workspace. `attemptRepairsForGoal`
 * owns the map for one call; a standalone `activateRepair` gets a fresh one, so
 * nothing is cached across attempts.
 */
type ObservationCache = Map<string, Promise<ObservationRead>>;

function repairObservationOf(deps: RepairActivationDependencies, ctx: CoreCallContext, run: RunSnapshot,
  cache: ObservationCache): Promise<ObservationRead> {
  const key = `${run.ref.projectId}\u0000${run.workspaceSnapshot.workspaceId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const pending = readObservation(deps, ctx, run.ref.projectId, run.workspaceSnapshot.workspaceId);
  cache.set(key, pending);
  return pending;
}

async function activateRepairWith(
  deps: RepairActivationDependencies, ctx: CoreCallContext,
  input: { commandId: string; noteId: string; expectedVersion: number },
  observationCache: ObservationCache,
): Promise<ActivateRepairResult> {
  const identityKey = noteCommandIdentity('activate', ctx, input.commandId);
  const fingerprint = fingerprintOfActivation(ctx, input);
  const prior = await priorActivation(deps, ctx, { identityKey, fingerprint }, input);
  if (prior !== null) return prior;

  const thrown = { message: null as string | null };
  const activation = { result: null as ActivationPrepared | null };
  const outcome = await writeKnowledge(deps.knowledge, ctx, lines => prepareActivation(deps, ctx, input,
    observationCache, { identityKey, fingerprint }, lines, thrown, activation));
  if (outcome.kind === 'exit') return outcome.value;
  const result = activation.result;
  if (outcome.kind === 'rejected') {
    // DR-02: the withdrawal commits under its own identity and answers `withdrawn` once it landed.
    if (result?.kind === 'withdrawn') {
      const landed = await deps.records.lookupCommit(result.keys);
      if (landed.status === 'ready') return rejected('invalid', 'withdrawn');
      return thrown.message !== null ? rejected('unavailable', 'the withdrawal commit could not be re-checked')
        : mapStoreFailure(outcome.failure);
    }
    const restored = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (restored.status === 'ready') return replayActivation(deps, ctx, restored.value, input);
    return thrown.message !== null ? rejected('unavailable', 'the activation commit could not be re-checked')
      : mapStoreFailure(outcome.failure);
  }
  const receipt = outcome.receipt;
  if (result?.kind !== 'withdrawn' && receipt.replayed) return replayActivation(deps, ctx, receipt, input);
  if (outcome.files !== null && outcome.files.status !== 'ready') {
    return rejected('unavailable', knowledgeFilesNotWritten(outcome.files));
  }
  if (result === null) return rejected('unavailable', 'the activation was not prepared');
  if (result.kind === 'withdrawn') return rejected('invalid', 'withdrawn');
  // The event carries the pre-bind revision (`catalog.since` is null); the
  // caller's result carries the commit cursor, exactly as the replay restores
  // it and as the human catalog-revision route fills it.
  const { noteId, version, revision } = result;
  return { status: 'activated', noteId, version, cursor: receipt.cursor,
    revision: { ...revision, catalog: { ...revision.catalog, since: receipt.cursor } } };
}

/** What a prepared activation answers once its commit lands: the activation, or the subject's withdrawal. */
type ActivationPrepared =
  | { kind: 'activated'; noteId: string; version: number; revision: ArchitectureRevision }
  | { kind: 'withdrawn'; keys: { identityKey: string; fingerprint: string } };

/**
 * Everything after the receipt lookup: the note, round, footprint and approval
 * checks, the current catalog read (from the knowledge files), the plan, the
 * records and the file changes, prepared after the knowledge lines are taken.
 */
async function prepareActivation(
  deps: RepairActivationDependencies, ctx: CoreCallContext,
  input: { commandId: string; noteId: string; expectedVersion: number },
  observationCache: ObservationCache, keys: { identityKey: string; fingerprint: string },
  lines: readonly LineKnowledge[], thrown: KnowledgeCommitThrow,
  activation: { result: ActivationPrepared | null },
): Promise<KnowledgePrepared<ActivateRepairResult>> {
  const { identityKey, fingerprint } = keys;
  const exit = (value: ActivateRepairResult): KnowledgePrepared<ActivateRepairResult> => ({ kind: 'exit', value });
  const noteKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId, noteId: input.noteId });
  const headRead = await deps.records.readMany([noteKey]);
  if (headRead.status !== 'ready') return exit(mapStoreFailure(headRead));
  const headRecord = headRead.value.records.find((record) => record.refKey === noteKey);
  if (headRecord === undefined) return exit(rejected('not_found', 'the note does not exist'));
  const decodedHead = decodeNoteHeadSnapshot(headRecord);
  if (decodedHead.status !== 'decoded') return exit(rejected('unavailable', `the note head is damaged: ${decodedHead.reason}`));
  const head = decodedHead.value;
  if (head.state === 'withdrawn') return exit(rejected('invalid', 'withdrawn'));
  if (head.state !== 'staged') return exit(rejected('invalid', 'not_staged'));
  if (input.expectedVersion !== head.version) return exit({ status: 'source_stale', reason: 'note_version_changed' });
  if (head.stagedRunKey === null) return exit(rejected('invalid', 'not_staged'));
  const repair = head.repair!;

  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: head.ref.projectId, goalId: head.goalId! };
  const goalRead = await readGoal(deps.records, goalRef);
  if (goalRead.status !== 'ready') return exit(goalRead);
  const goal = goalRead.goal;
  if (roundGoalActivityProblem(goal.desiredState) !== null) {
    return exit({ status: 'not_ready', reason: 'goal_paused' });
  }

  const chainRead = await readRunChain(deps.records, head);
  if (chainRead.status !== 'ready') return exit(repairReadFailure(chainRead));
  if (chainRead.value === null) return exit({ status: 'source_stale', reason: 'round_changed' });
  const chain = chainRead.value;
  const bound = boundRoundOf(head, chain);
  if (bound.status !== 'ready') return exit(repairReadFailure(bound));
  const round = bound.value;
  if (round === null) return exit({ status: 'source_stale', reason: 'round_changed' });
  if (round.status !== 'finalized' || round.outcome !== 'PASS' || round.gaps.length > 0) {
    return exit({ status: 'not_ready', reason: 'check_not_passed' });
  }
  const binding = round.stagedRepairs.find((entry) => entry.noteId === head.noteId && entry.version === head.version);
  if (binding === undefined || binding.digest !== repairBindingDigest(noteBodyOf(head))) {
    return exit({ status: 'source_stale', reason: 'round_changed' });
  }
  if (canonicalJson(round.identity.baselinePin as unknown as JsonValue)
    !== canonicalJson(repair.pin.baseline as unknown as JsonValue)) {
    return exit({ status: 'source_stale', reason: 'round_changed' });
  }
  const run = chain.run;
  const planRead = await readPlan(deps.records, run.planRef);
  if (planRead.status !== 'ready') return exit(repairReadFailure(planRead));
  const plan = planRead.plan;
  // Recompute the PASS applicability against the repair's pinned catalog, never
  // the catalog this activation is about to write.
  if (round.evidenceRefs.length > 0) {
    const evidenceKeys = round.evidenceRefs.map((ref) => canonicalJson(ref as unknown as JsonValue));
    const evidenceRead = await deps.records.readMany(evidenceKeys);
    if (evidenceRead.status !== 'ready') return exit(mapStoreFailure(evidenceRead));
    const byKey = new Map(evidenceRead.value.records.map((record) => [record.refKey, record]));
    for (const [index, ref] of round.evidenceRefs.entries()) {
      const key = evidenceKeys[index]!;
      const record = byKey.get(key);
      if (record === undefined) return exit(rejected('incomplete', 'a bound round Evidence is absent'));
      const decodedEvidence = decodeEvidenceSnapshot(record);
      if (decodedEvidence.status !== 'decoded') return exit(rejected('unavailable', decodedEvidence.reason));
      const currentAnchor = {
        schemaVersion: 1 as const, planRef: plan.ref, planRevision: plan.planRevision,
        workspaceRevision: round.identity.workspaceRevision,
        pinnedCompletionPolicy: round.verificationPlan.pinnedCompletionPolicy,
        pinnedArchitectureBaseline: repair.pin.baseline,
      };
      const decision = evidenceApplicabilityWithBasis({
        evidence: decodedEvidence.value.evidence, adoptedPlan: plan, evidencePlan: plan, currentAnchor,
      });
      if (decision.applicability !== 'APPLICABLE') return exit({ status: 'source_stale', reason: 'round_changed' });
    }
  }

  const task = plan.tasks.find((candidate) => candidate.taskId === run.task.taskId);
  const declared: ModuleRef[] = task !== undefined && task.scope.kind === 'module'
    ? [{ projectId: run.task.projectId, moduleId: task.scope.moduleRef }]
    : [];

  const activityKey = runActivityRefKey(runActivityRefOf({ ref: run.ref }));
  const activityRead = await deps.records.readMany([activityKey]);
  if (activityRead.status !== 'ready') return exit(mapStoreFailure(activityRead));
  const activityRecord = activityRead.value.records.find((record) => record.refKey === activityKey);
  if (activityRecord === undefined && !activityRead.value.missing.includes(activityKey)) {
    return exit(rejected('unavailable', 'the RunActivity read neither returned nor reported missing the record'));
  }
  let activity: RunActivitySnapshot | null = null;
  if (activityRecord !== undefined) {
    const decodedActivity = decodeRunActivitySnapshot(activityRecord);
    if (decodedActivity.status !== 'decoded') return exit(rejected('unavailable', decodedActivity.reason));
    activity = decodedActivity.value;
  }

  const observationRead = await repairObservationOf(deps, ctx, run, observationCache);
  if (!observationRead.ok) return exit(observationRead.rejection);
  const observation = observationRead.files;

  const catalogWindow = await readCurrentCatalogWindow(deps.records, run.ref.projectId, { lines: deps.knowledge, caller: ctx });
  if (catalogWindow.status !== 'ready') {
    return exit(catalogWindow.status === 'not_found'
      ? rejected('not_found', 'the project has no current architecture catalog')
      : repairReadFailure(catalogWindow));
  }
  const pinnedCatalog = catalogWindow.catalog.catalog;
  // The activity's changed files and the observation are the Run workspace's
  // relative paths: project the ONE catalog onto that workspace before the
  // footprint compares them.
  const runWorkspaceId = run.workspaceSnapshot.workspaceId;
  let mainWorkspaceId = runWorkspaceId;
  if (deps.mainWorkspaceOf !== undefined) {
    const main = await deps.mainWorkspaceOf(run.ref.projectId);
    // A failed main read refuses the activation as `unavailable`; a ready `null`
    // (no workspace yet) keeps the Run's workspace as main.
    if (main.status !== 'ready') {
      return exit(rejected('unavailable', main.status === 'rejected' ? main.reason : 'the main workspace cannot be read'));
    }
    mainWorkspaceId = main.value ?? runWorkspaceId;
  }
  const runCatalog = catalogForWorkspace(pinnedCatalog, runWorkspaceId, mainWorkspaceId);
  const firstProblem = footprintProblem({ activity, catalog: runCatalog, declared, observation, ops: repair.ops,
    workspaceId: runWorkspaceId, mainWorkspaceId, approval: null });
  const renamed = repair.ops.some((op) => op.op === 'set_module_name');
  const needsCard = repairNeedsCard({ structural: repair.structural, rename: renamed,
    autonomy: readGoalSettings(goal).autonomy, footprintUnknown: firstProblem?.kind === 'unknown' });

  let problem = firstProblem;
  let approvalMessage: SessionMessageRecord | null = null;
  if (needsCard) {
    const headPin: VersionPin = { ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId: head.noteId },
      revision: head.version };
    const source: RepairApprovalSourceV1 = {
      kind: 'repair_approval',
      key: canonicalJson({ kind: 'repair_approval', note: headPin } as never),
      subject: { kind: 'goal', goalRef },
      pins: [headPin],
    };
    const answerRead = await deps.decisionMessages.readDecisionMessagePin(ctx, { source });
    if (answerRead.status !== 'ready') return exit(repairReadFailure(answerRead));
    const message = answerRead.value.message;
    const response = message?.response ?? null;
    const selection = response !== null && 'decision' in response ? response.decision.selection : null;
    const approved = selection !== null && selection.kind === 'option' && selection.optionId === 'approve';
    if (!approved) return exit({ status: 'not_ready', reason: 'approval_pending' });
    if (message !== null) approvalMessage = message;
    problem = footprintProblem({ activity, catalog: runCatalog, declared, observation, ops: repair.ops,
      workspaceId: runWorkspaceId, mainWorkspaceId, approval: 'approve' });
  }
  if (problem !== null && problem.kind === 'unknown') return exit({ status: 'not_ready', reason: 'footprint_unknown' });
  if (problem !== null) return exit({ status: 'forbidden', reason: 'outside_footprint', paths: problem.paths });

  if (canonicalJson(catalogPinOf(catalogWindow) as unknown as JsonValue)
    !== canonicalJson(repair.pin as unknown as JsonValue)) {
    return exit({ status: 'source_stale', reason: 'catalog_changed' });
  }

  const taskProblem = await currentTaskProblem(deps.records, goal, run, plan);
  // A failed read of the current Plan rejects unchanged and writes nothing; only
  // a successfully read non-active subject takes the withdrawal path.
  if (taskProblem.status !== 'ready') return exit(taskProblem);
  if (taskProblem.value !== null) {
    const withdrawal = withdrawalOf(deps, ctx, head, goalRef, input.commandId);
    if (!withdrawal.ok) return exit(withdrawal.rejection);
    const notePlans = await noteFileWritesOf([withdrawal.head], lines);
    if (notePlans.status !== 'ready') return exit(mapStoreFailure(notePlans));
    activation.result = { kind: 'withdrawn',
      keys: { identityKey: withdrawal.prepared.identityKey, fingerprint: withdrawal.prepared.fingerprint } };
    return { kind: 'ready', plans: notePlans.value,
      commit: knowledgeCommit(commit => deps.records.commit(commit), withdrawal.prepared, thrown) };
  }

  const revisionDeps: CatalogRevisionDependencies = {
    records: deps.records, now: deps.now, eventId: deps.eventId, knowledge: deps.knowledge, ...deps.catalogRevision,
  };
  const activationRefused = async (planned: Exclude<ReadResult<never>, { status: 'ready' }>):
    Promise<KnowledgePrepared<ActivateRepairResult>> => {
    if (planned.status !== 'rejected') return exit(repairReadFailure(planned));
    if (planned.code === 'revision_conflict') return exit({ status: 'revision_conflict', current: planned.current ?? [] });
    // Quick check 5: the basis moved; when this same command committed meanwhile, its result comes first.
    if (planned.code === 'source_stale') return exit(await priorActivation(deps, ctx, keys, input) ?? planned);
    return exit(planned);
  };
  // Stack review 1: the architecture and note files are read and their changes computed before the planner's
  // ledger half reads the basis the commit is checked against.
  const draft = await draftCatalogRevision(revisionDeps, ctx, {
    expected: repair.pin, ops: repair.ops, responsibilityMoves: repair.responsibilityMoves,
    reason: head.body, commandId: input.commandId,
  });
  if (draft.status !== 'ready') return activationRefused(draft);
  const transition = transitionNote(head, { kind: 'activate' });
  if (!transition.ok) return exit(rejected(transition.code, transition.detail));
  const activatedHead = transition.next;
  const plans = await architectureWritePlansOf(lines, draft.value.catalog, knowledgeBaselineOf(draft.value.content));
  if (plans.status !== 'ready') return exit(mapStoreFailure(plans));
  const notePlans = await noteFileWritesOf([activatedHead], lines);
  if (notePlans.status !== 'ready') return exit(mapStoreFailure(notePlans));
  const planned = await finishCatalogRevision(revisionDeps, ctx, draft.value);
  if (planned.status !== 'ready') return activationRefused(planned);
  const contribution = planned.value;

  const now = deps.now();
  const version = newNoteVersionRecord(activatedHead, {
    kind: 'activate', by: { kind: 'platform' }, reason: null, decisionMessageRef: null,
  }, now, null);
  const headEvent = {
    schemaVersion: NOTE_EVENT_SCHEMA_VERSION, occurredAt: now, projectId: ctx.projectId,
    workspaceId: ctx.workspaceId ?? '',
  };
  const noteHeadRecord = encodeNoteHeadSnapshot(activatedHead);
  const noteVersionRecord = encodeNoteVersionSnapshot(version);
  const noteEvent = encodeNoteDispositionChangedEvent({
    ...headEvent, eventId: deps.eventId(), eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE,
    head: activatedHead, version, acknowledgementRef: null, actor: null, proof: null,
  });

  const merged = mergeGuards([
    ...contribution.guards,
    { refKey: canonicalJson(goalRef as unknown as JsonValue), expectedRevision: goal.revision },
    { refKey: noteHeadRecord.refKey, expectedRevision: head.version },
    { refKey: noteVersionRecord.refKey, expectedRevision: null },
    { refKey: canonicalJson(round.ref as unknown as JsonValue), expectedRevision: round.revision },
  ]);
  if (!merged.ok) return exit(merged.rejection);

  const records: EncodedRecord[] = [...contribution.records, noteHeadRecord, noteVersionRecord];
  const events: EncodedDomainEvent[] = [noteEvent, ...contribution.events];
  // The approval is an application: its formal proof must ride the commit's last
  // event (the catalog revision), and the note head's N -> N+1 is the change the
  // answer captured. An automatic repair has no approval message and carries none.
  if (approvalMessage !== null) {
    const last = events[events.length - 1];
    const decoded = last === undefined ? null : decodeArchitectureCatalogRevisedEvent(last);
    if (decoded === null || decoded.status !== 'decoded') {
      return exit(rejected('unavailable', 'the activation catalog event is not readable'));
    }
    const proof: DecisionChangeProofV1 = {
      acknowledgementRef: structuredClone(approvalMessage.ref),
      capturedPins: approvalMessage.response !== null && 'decision' in approvalMessage.response
        ? approvalMessage.response.decision.source.pins.map(pin => structuredClone(pin)) : [],
      changes: [{ before: { ref: structuredClone(head.ref), revision: head.version },
        after: { ref: structuredClone(activatedHead.ref), revision: activatedHead.version } }],
      basisRebases: [],
    };
    events[events.length - 1] = encodeArchitectureCatalogRevisedEvent({ ...decoded.value, proof });
  }
  const commitCursorBindings: CommitCursorBinding[] = [
    ...(contribution.commitCursorBindings ?? []),
    { refKey: noteHeadRecord.refKey, field: 'since' },
    { refKey: noteVersionRecord.refKey, field: 'since' },
  ];
  const prepared: PreparedCommit = {
    identityKey, fingerprint, indexGuards: [], indexChanges: [],
    guards: merged.guards, records, claims: contribution.claims, events, commitCursorBindings,
    ...(contribution.ledgerHorizon === undefined ? {} : { ledgerHorizon: contribution.ledgerHorizon }),
  };
  activation.result = { kind: 'activated', noteId: head.noteId, version: activatedHead.version,
    revision: contribution.revision };
  return { kind: 'ready', plans: [...plans.value, ...notePlans.value],
    commit: knowledgeCommit(commit => deps.records.commit(commit), prepared, thrown) };
}

/**
 * The subject's disposition in the Goal's CURRENT adopted Plan (a cancelled or
 * superseded task). The run-executed Plan is only reused when the pointer still
 * names it; otherwise the current Plan is read. A `ready` value names the
 * subject problem (the note is withdrawn); a non-ready result is the read's own
 * rejection and must not be mistaken for an inactive subject.
 */
async function currentTaskProblem(records: RepairActivationDependencies['records'],
  goal: import('../../../contracts/ledger.js').GoalSnapshot, run: RunSnapshot,
  runPlan: import('../../../contracts/plan.js').PlanRevisionSnapshot):
  Promise<{ status: 'ready'; value: CoreRejection | null } | CoreRejection> {
  let plan = goal.activePlanRevision !== null
    && canonicalJson(goal.activePlanRevision as unknown as JsonValue) === canonicalJson(runPlan.ref as unknown as JsonValue)
    ? runPlan : null;
  if (plan === null && goal.activePlanRevision !== null) {
    const read = await readPlan(records, goal.activePlanRevision);
    if (read.status !== 'ready') return repairReadFailure(read);
    plan = read.plan;
  }
  const task = plan?.tasks.find((candidate) => candidate.taskId === run.task.taskId);
  const problem = roundSubjectActivityProblem(task?.disposition ?? null, run.task);
  return { status: 'ready', value: problem === null || problem.ok ? null : rejected(problem.code, problem.detail) };
}

/**
 * DR-02: a cancelled/superseded subject really withdraws the note before the
 * owner answers `invalid/withdrawn`. It reuses `transitionNote(withdraw)`, the
 * note writer's head/version encoders and one commit (under its own identity,
 * through the activation's knowledge write); there is no catalog revision in
 * this path. A second call sees a non-staged head and writes nothing.
 */
function withdrawalOf(deps: RepairActivationDependencies, ctx: CoreCallContext, head: NoteHeadSnapshot,
  goalRef: GoalRef, commandId: string):
  { ok: true; head: PendingNoteHeadSnapshot; prepared: PreparedCommit } | { ok: false; rejection: CoreRejection } {
  const transition = transitionNote(head, { kind: 'withdraw' });
  if (!transition.ok) return { ok: false, rejection: rejected(transition.code, transition.detail) };
  const withdrawn = transition.next;
  const now = deps.now();
  const version = newNoteVersionRecord(withdrawn, { kind: 'withdraw', by: { kind: 'platform' }, reason: null,
    decisionMessageRef: null }, now, null);
  const headRecord = encodeNoteHeadSnapshot(withdrawn);
  const versionRecord = encodeNoteVersionSnapshot(version);
  const event = encodeNoteDispositionChangedEvent({
    schemaVersion: NOTE_EVENT_SCHEMA_VERSION, occurredAt: now, projectId: ctx.projectId,
    workspaceId: ctx.workspaceId ?? '', eventId: deps.eventId(), eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE,
    head: withdrawn, version, acknowledgementRef: null, actor: null, proof: null,
  });
  const identityKey = noteCommandIdentity('withdraw', ctx, commandId);
  const fingerprint = sha256Hex(canonicalJson({
    schemaVersion: 1, kind: 's8c-repair-subject-withdraw', projectId: ctx.projectId,
    workspaceId: ctx.workspaceId ?? null, commandId, noteId: head.noteId, expectedVersion: head.version,
    goalId: goalRef.goalId,
  } as unknown as JsonValue));
  return { ok: true, head: withdrawn, prepared: {
    identityKey, fingerprint, indexGuards: [], indexChanges: [],
    guards: [
      { refKey: headRecord.refKey, expectedRevision: head.version },
      { refKey: versionRecord.refKey, expectedRevision: null },
    ],
    records: [headRecord, versionRecord], claims: [], events: [event],
    commitCursorBindings: [
      { refKey: headRecord.refKey, field: 'since' },
      { refKey: versionRecord.refKey, field: 'since' },
    ],
  } };
}

export async function attemptRepairsForGoal(
  deps: RepairActivationDependencies, ctx: CoreCallContext, input: { goalRef: GoalRef },
): Promise<ActivateRepairResult[]> {
  const goalRead = await readGoal(deps.records, input.goalRef);
  if (goalRead.status !== 'ready') return [goalRead];
  const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
    [input.goalRef.projectId, input.goalRef.goalId, 'staged']);
  if (!page.ok) return [rejected(page.code, page.reason)];
  const repairs = page.heads.filter((head) => head.kind === 'repair');
  const cache = new Map<string, Promise<ReadResult<RunChain | null>>>();
  const entries: { head: NoteHeadSnapshot; round: RoundSnapshot | null; failure: CoreRejection | null }[] = [];
  for (const head of repairs) {
    if (head.stagedRunKey === null) { entries.push({ head, round: null, failure: null }); continue; }
    let pending = cache.get(head.stagedRunKey);
    if (pending === undefined) {
      pending = readRunChain(deps.records, head);
      cache.set(head.stagedRunKey, pending);
    }
    const chain = await pending;
    if (chain.status !== 'ready') {
      entries.push({ head, round: null, failure: repairReadFailure(chain) });
      continue;
    }
    const bound = chain.value === null ? null : boundRoundOf(head, chain.value);
    entries.push({
      head,
      round: bound !== null && bound.status === 'ready' ? bound.value : null,
      failure: bound !== null && bound.status !== 'ready' ? repairReadFailure(bound) : null,
    });
  }
  entries.sort((left, right) => {
    const leftUntil = left.round?.status === 'finalized' ? left.round.until : null;
    const rightUntil = right.round?.status === 'finalized' ? right.round.until : null;
    if (leftUntil === null && rightUntil === null) return left.head.noteId < right.head.noteId ? -1
      : left.head.noteId > right.head.noteId ? 1 : 0;
    if (leftUntil === null) return 1;
    if (rightUntil === null) return -1;
    if (leftUntil !== rightUntil) return leftUntil < rightUntil ? -1 : 1;
    return left.head.noteId < right.head.noteId ? -1 : left.head.noteId > right.head.noteId ? 1 : 0;
  });
  const results: ActivateRepairResult[] = [];
  // One observation read per workspace for THIS attempt only.
  const observationCache: ObservationCache = new Map();
  for (const entry of entries) {
    results.push(entry.failure ?? await activateRepairWith(deps, ctx, {
      commandId: `activate:${entry.head.noteId}:${entry.head.version}`,
      noteId: entry.head.noteId, expectedVersion: entry.head.version,
    }, observationCache));
  }
  return results;
}

export function createRepairActivationService(deps: RepairActivationDependencies): RepairActivationService {
  return {
    activateRepair: (ctx, input) => activateRepair(deps, ctx, input),
    attemptRepairsForGoal: (ctx, input) => attemptRepairsForGoal(deps, ctx, input),
  };
}
