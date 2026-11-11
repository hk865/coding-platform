/**
 * Slice 4A L4–L8/L18: the ONE note writer. It resolves the trusted caller and
 * source (L5), runs the format/anchor/relation/same-topic/quota gates (L4), asks
 * the pure `state/note-machine.ts` for the admission disposition and writes the
 * head, its version, the superseded heads' versions, the current pointer and the
 * three event kinds in ONE RecordStore commit. Reads go through
 * `notes/note-read-model.ts`; this file never reads the database to answer a test.
 */
import { principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type {
  CatalogRepairOpV1, CurrentPointerRef, CurrentPointerSnapshot, LinkDraftV1, LinkEndRequestV1, LinkPayloadV1, NoteAnchorV1,
  NoteDraftAnchorV1, NoteFactV1, NoteHeadSnapshot,
  NoteReviewReason, NoteSourceV1, NoteState, NoteVersionSnapshot, PendingNoteHeadSnapshot,
  RepairPayloadV1, ResponsibilityMoveV1,
} from '../../../contracts/note.js';
import { isGeneral, NOTE_KINDS, payloadKindProblem } from '../../../contracts/note.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { hasOnlyKeys, isPos, isRecord } from '../../../contracts/validation/common.js';
import type { RoleConfigurationRef, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type {
  NoteAnchorFactsDeps, NoteAnchorWorkspace, ResolvedNoteAnchors,
} from './note-anchors.js';
import { anchorFormatProblem, anchorKeyOf, conclusionProblem, noteCheckWorkspace, normalizePath, resolveNoteAnchors, topicKeyOf, topicProblem } from './note-anchors.js';
import { isSafeProjectPath, normalizeRequestProjectPath, resolveStoredProjectPath, splitWorkspacePath } from '../../../contracts/workspace-path.js';
import { checkLinkDraft, endpointIdentityOf, evidenceRoleProblem, literalKeyProblem } from './link-evidence.js';
import { languageOfPath } from '../../workspace/architecture-language-provider.js';
import type { ScribeScope, ScribeScopeCall } from './scribe-scope.js';
import { moduleOfAnchor, newScribeScopeCall, sourceIsAuthorOf } from './scribe-scope.js';
import type { EffectiveScopeReadPort } from '../state/role-scope.js';
import { stageContinuityOf } from './note-continuity.js';
import { anchorSlots } from './note-related-scope.js';
import { readGoalPlanWindow, type GoalPlanWindow } from '../tasks/plan-readers.js';
import { S2B_PLAN_REVISION_BY_GOAL_LOOKUP, decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { headsByAnchorKey, readAllHeads, type ReadFailureCode } from './note-base-reader.js';
import { renderUnderstandingBody } from './note-rendering.js';
import { mapStoreFailure } from './store-failures.js';
import { isKnowledgeAnchor, noteKnowledgeOf } from './note-file.js';
import { rawModuleId } from '../../../contracts/workspace-module-id.js';
import type { KnowledgeFileChange, KnowledgeLines, LineKnowledge } from '../model/line-knowledge.js';
import {
  knowledgeCommit, knowledgeFilesNotWritten, writeKnowledge, type KnowledgePrepared, type KnowledgeWritePlan,
} from '../knowledge/knowledge-write.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { CurrentCatalogWindow } from '../architecture/catalog-service.js';
import { catalogModuleFactsOf, readCurrentCatalogWindow, readRevisionByRef } from '../architecture/catalog-service.js';
import {
  readArchitectureBaselinePin, readArchitectureCatalogRef,
} from '../architecture/catalog-record-codecs.js';
import { exactKeys } from '../architecture/architecture-service.js';
import { qualifyOps } from '../architecture/proposal-service.js';
import {
  applyRepairOps, catalogRevisionMovesProblem, parseRepairOps, structuralOfRepair, type RepairProblemV1,
} from '../architecture/repair-ops.js';
import type {
  NoteDecisionApplicationInputV1, NoteDecisionApplyPort, NoteDispositionResult, NoteDutyResolver, NoteErrorCode,
  NoteExistingTopicV1, NoteWritePort, WriteNoteInput, WriteNoteResult,
} from '../model/note-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import type { NoteQueryRunSourcePort, PlanningQueryRunV1 } from '../tasks/planning-query-run.js';
import type { DecisionSourceAttempt } from '../model/decision-contracts.js';
import {
  NOTE_ANCHOR_LINK_QUOTA, NOTE_ANCHOR_QUOTA, NOTE_BASIS_FILES_MAX, NOTE_BASIS_FILE_MAX_BYTES, NOTE_BODY_MAX_BYTES,
  NOTE_EXISTING_TOPICS_MAX, NOTE_EXTRA_ANCHORS_MAX, NOTE_FACTS_MAX, NOTE_GOAL_LINK_QUOTA, NOTE_GOAL_QUOTA,
  NOTE_LINK_EVIDENCE_MAX, NOTE_PROJECT_FLOW_QUOTA, PROJECT_UNDERSTANDING_BODY_MAX_BYTES,
  UNDERSTANDING_BODY_MAX_BYTES,
} from '../model/note-contracts.js';
import type {
  GoalRecordTransactionPort, EncodedRecord, EncodedDomainEvent, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreResult,
} from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import {
  CURRENT_POINTER_MOVED_EVENT_TYPE, NOTE_DISPOSITION_CHANGED_EVENT_TYPE,
  NOTE_EVENT_SCHEMA_VERSION, NOTE_WRITTEN_EVENT_TYPE,
  S4_NOTE_BY_REVIEW_STATUS_LOOKUP, S8E_NOTE_BY_KIND_STATE_LOOKUP, currentPointerRefKey,
  decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot,
  encodeCurrentPointerMovedEvent, encodeCurrentPointerSnapshot,
  encodeNoteDispositionChangedEvent, encodeNoteHeadSnapshot, encodeNoteVersionSnapshot, encodeNoteWrittenEvent,
  factProblem, noteDispositionChangedEventFromEvent, noteHeadRefKey, noteVersionRefKey, noteWrittenEventFromEvent,
} from '../persistence/note-record-codecs.js';
import {
  actualDispositionTargets, admitNoteWrite, moveCurrentPointerRecord, newCurrentPointerRecord, newNoteHeadRecord,
  newNoteVersionRecord, noticeClassOf, noteWriteAuthority, secretaryNoteScope, transitionNote, userReasonsOf,
  type NoteDispositionEventV1, type NoteUserReasonTargetV1,
} from '../state/note-machine.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { reworkActorClassOf } from '../../../contracts/task-requeue.js';
import type {
  ToolCommitLookupInput, ToolCommitLookupResult,
} from '../../../contracts/unknown-call-review.js';
import {
  recordNoteRequestOf, type RecordNoteArgs, type RecordNoteRequestV1,
} from '../model/note-contracts.js';
import { toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId } from '../model/tool-commit-arguments.js';
import { replayCommittedReceipt, type ReceiptReplayFailure } from '../tasks/receipt-replay.js';

/**
 * The trusted Run→Session facts the composition root resolves for a work_run
 * caller (the public execution reader is Host-only). `notes` may not import
 * `materials`, so the composition injects the reader; it returns the bounded,
 * already-scoped facts and never a Host capability.
 */
export type NoteRunFactResolver = (ctx: CoreCallContext, runRef: RunRef) =>
  Promise<ReadResult<{ goalId: string; sessionRef: SessionRef; role: RoleConfigurationRef; planRef: PlanRevisionRef }>>;

export type NoteServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  duties: NoteDutyResolver;
  runFacts: NoteRunFactResolver;
  /**
   * The one trusted source for a running QueryRun: the unchanged secretary
   * resolver, or the planning resolver it dispatches to (§5.2.8(2)).
   */
  queryRun: NoteQueryRunSourcePort;
  workspace: NoteAnchorWorkspace;
  workspaceMaxFileBytes: number;
  /** The project's main workspace (its `start_lines` operation), for project-path qualification. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  scopes?: ScribeScope;
  /** 120-13 丙: the line's effective scope, read for a region adviser's write; absent, no region check. */
  regionScopes?: Pick<EffectiveScopeReadPort, 'readEffectiveScope'>;
  /** KLS-2: the note files every write and disposition writes after its commit. */
  knowledge: KnowledgeLines;
  now(): string;
  eventId(): string;
  newId(): string;
  /** P4 injection points (tests shrink the soft quota); production uses the spec constants. */
  anchorQuota?: number;
  goalQuota?: number;
  /** L7/8E: the link populations' soft quotas (spec §2); the general quotas above stay as they are. */
  anchorLinkQuota?: number;
  goalLinkQuota?: number;
  /** F1's flow-only project quota (100): a soft quota that never refuses a write. */
  projectFlowQuota?: number;
  basisFileMaxBytes?: number;
};

type Rejected = { status: 'rejected'; code: NoteErrorCode; reason: string };
const forbidden = (reason: string): Rejected => rejected('forbidden', reason);

/** C3.1: a raw draft anchor that names the project (shape only; class 1/2 follow). */
function isProjectAnchorDraft(anchor: unknown): boolean {
  return isRecord(anchor) && anchor['kind'] === 'project';
}

/** Narrow a core error to the note port's closed code set (unknown → unavailable). */
function noteCodeOf(code: string): NoteErrorCode {
  return code === 'invalid' || code === 'forbidden' || code === 'not_found' || code === 'revision_conflict'
    || code === 'unavailable' || code === 'unsupported' ? code : 'unavailable';
}

/** A head one note commit writes: the knowledge fields, its id and its source. */
type NoteFileHead = Parameters<typeof noteKnowledgeOf>[0] & Pick<NoteHeadSnapshot, 'noteId'>;

/**
 * KLS-2: the note-file changes of every head one note commit writes (the new
 * note, the ones it supersedes or withdraws, a disposed, activated or withdrawn
 * one), computed before the commit. A head whose primary anchor is a module,
 * interface or file goes into the line of that anchor's workspace (a module
 * id's, or a stored path's); link, flow and repair notes have no file form in
 * this format version. Unchanged bytes give no change.
 */
export async function noteFileWritesOf(heads: readonly NoteFileHead[], lines: readonly LineKnowledge[]):
Promise<StoreResult<KnowledgeWritePlan[]>> {
  const changes = new Map<LineKnowledge, KnowledgeFileChange[]>();
  for (const head of heads) {
    const anchor = head.anchor;
    if (!isKnowledgeAnchor(anchor) || head.kind === 'link' || head.kind === 'flow' || head.kind === 'repair') continue;
    // writeKnowledge hands every line of the project (never none); all of them share the main workspace.
    const mainWorkspaceId = lines[0]!.scope.mainWorkspaceId;
    let workspaceId: string;
    try {
      workspaceId = anchor.kind === 'file' ? resolveStoredProjectPath(anchor.path, mainWorkspaceId).workspaceId
        : rawModuleId(anchor.moduleId).workspaceId ?? mainWorkspaceId;
    } catch {
      return { status: 'rejected', code: 'invalid', reason: `the note ${head.noteId} has no workspace for its anchor` };
    }
    const line = lines.find(candidate => candidate.scope.workspaceId === workspaceId);
    if (line === undefined) {
      return { status: 'rejected', code: 'unavailable', reason: `the workspace ${workspaceId} of the note ${head.noteId} has no line` };
    }
    const written = await line.writeNote(noteKnowledgeOf(head), head.noteId);
    if (written.status !== 'ready') return written;
    changes.set(line, [...(changes.get(line) ?? []), ...written.value]);
  }
  return { status: 'ready', value: [...changes].map(([line, lineChanges]) => ({ line, changes: lineChanges })) };
}

function codepointLength(value: string): number { return [...value].length; }

// --------------------------------------------------------------------------
// Trusted caller and source (L5)
// --------------------------------------------------------------------------

type Caller = {
  source: NoteSourceV1;
  isUser: boolean;
  goalId: string | null;
  duty: string | null;
  sessionRef: SessionRef | null;
  /** The Run-bound plan for a work_run caller, the Plan frozen at preparation for a secretary QueryRun, `null` for a user. */
  planRef: PlanRevisionRef | null;
  /** The trusted facts of a secretary or planning QueryRun caller, `null` for every other caller. */
  queryRun: SecretaryQueryRunV1 | PlanningQueryRunV1 | null;
};

async function resolveCaller(ctx: CoreCallContext, input: WriteNoteInput, deps: NoteServiceDependencies):
Promise<{ ok: true; value: Caller } | { ok: false; rejection: Rejected }> {
  const principal = ctx.principal;
  if (principal.kind === 'query_run') {
    // A running QueryRun is admitted only through the trusted source: the
    // secretary resolver, or the planning resolver the source dispatches to
    // for a trusted planning round (§5.2.8(2)). A plain Query or a read-only
    // copy stays refused there.
    const resolved = await deps.queryRun.resolveNoteQueryRun(ctx);
    if (resolved.status === 'rejected') {
      return { ok: false, rejection: rejected(resolved.code === 'forbidden' ? 'forbidden' : 'unavailable',
        resolved.reason) };
    }
    const { kind, round } = resolved.value;
    // N11: a planning round (an exploration round too) is refused only the
    // understanding and repair kinds, before the scope is entered.
    if (kind === 'planning'
      && (input.note.kind === 'understanding' || input.note.kind === 'repair')) {
      return { ok: false, rejection: forbidden('a planning round cannot write an understanding or repair note') };
    }
    return { ok: true, value: { source: { kind: 'agent', sessionRef: round.session, runRef: null,
      queryRunRef: round.run, duty: round.duty }, isUser: false, goalId: round.effectiveGoalId,
      duty: round.duty, sessionRef: round.session, planRef: round.planRef, queryRun: round } };
  }
  if (principal.kind === 'host') {
    const actor = principal.actor;
    const actorClass = reworkActorClassOf(principal, actor);
    if (actorClass !== 'human') return { ok: false, rejection: forbidden('a system actor cannot write a note') };
    return { ok: true, value: { source: { kind: 'user', principalId: actor.id }, isUser: true,
      goalId: input.goalId, duty: null, sessionRef: null, planRef: null, queryRun: null } };
  }
  // work_run: the trusted execution fixes the goal, the Session and the duty.
  // The public execution reader is Host-only, so the composition root injects
  // the Run's own claim-linked Session facts (`NoteRunFactResolver`).
  const runRef = principal.runRef;
  const facts = await deps.runFacts(ctx, runRef);
  if (facts.status !== 'ready') {
    return { ok: false, rejection: facts.status === 'rejected'
      ? rejected(facts.code === 'forbidden' ? 'forbidden' : 'unavailable', facts.reason)
      : rejected('unavailable', 'the caller Run is not readable') };
  }
  // A resolver rejection or a throw is a read failure, never
  // `forbidden`; only a ready `'unknown'` stays `forbidden`.
  let resolved: Awaited<ReturnType<NoteServiceDependencies['duties']>>;
  try {
    resolved = await deps.duties(facts.value.role, ctx);
  } catch {
    return { ok: false, rejection: rejected('unavailable', 'the caller duty cannot be read') };
  }
  if (resolved.status !== 'ready') {
    return { ok: false, rejection: resolved.status === 'rejected'
      ? rejected('unavailable', resolved.reason)
      : rejected('unavailable', 'the caller duty cannot be read') };
  }
  const duty = resolved.value;
  if (duty === 'reviewer' || duty === 'unknown') {
    return { ok: false, rejection: forbidden('the caller has no duty that may write a note') };
  }
  return { ok: true, value: { source: { kind: 'agent', sessionRef: facts.value.sessionRef, runRef, queryRunRef: null,
    duty: duty as never }, isUser: false, goalId: facts.value.goalId, duty, sessionRef: facts.value.sessionRef,
    planRef: facts.value.planRef, queryRun: null } };
}

// --------------------------------------------------------------------------
// Record reads
// --------------------------------------------------------------------------

async function readHead(deps: NoteServiceDependencies, projectId: string, noteId: string):
Promise<{ ok: true; record: EncodedRecord | null; head: NoteHeadSnapshot | null } | { ok: false; rejection: Rejected }> {
  const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
  const read = await deps.records.readMany([refKey]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find(candidate => candidate.refKey === refKey) ?? null;
  if (record === null) return { ok: true, record: null, head: null };
  const decoded = decodeNoteHeadSnapshot(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: rejected('unavailable',
    `the note head is damaged: ${decoded.reason}`) };
  return { ok: true, record, head: decoded.value };
}

async function readPointer(deps: NoteServiceDependencies, projectId: string, anchorKey: string):
Promise<{ ok: true; record: EncodedRecord | null; pointer: CurrentPointerSnapshot | null } | { ok: false; rejection: Rejected }> {
  const ref: CurrentPointerRef = { aggregateType: 'CurrentPointer', projectId, anchorKey };
  const refKey = currentPointerRefKey(ref);
  const read = await deps.records.readMany([refKey]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find(candidate => candidate.refKey === refKey) ?? null;
  if (record === null) return { ok: true, record: null, pointer: null };
  const decoded = decodeCurrentPointerSnapshot(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: rejected('unavailable',
    `the current pointer is damaged: ${decoded.reason}`) };
  return { ok: true, record, pointer: decoded.value };
}

/**
 * L8: a pointer read that carries both the `{ noteId, revision }`
 * payload a rejected write/disposition returns AND the FULL decoded snapshot.
 * The snapshot is threaded to `supersessionOf` so `moveCurrentPointerRecord`
 * receives the readable pointer record instead of a freshly built literal
 * (AGENTS.md rule 9 / state-writes R1). An absent pointer is
 * `{ noteId: null, revision: null, snapshot: null }`; a read failure is `null` —
 * never a fabricated `{ null, null }`. The stored pointer record's revision and
 * the snapshot `revision` advance together, so the payload's `revision` is also
 * the CAS guard for the pointer record.
 */
type PointerRead = { noteId: string | null; revision: number | null; snapshot: CurrentPointerSnapshot | null };

async function currentPointerRead(deps: NoteServiceDependencies, projectId: string, anchorKey: string):
Promise<PointerRead | null> {
  const read = await readPointer(deps, projectId, anchorKey);
  if (!read.ok) return null;
  return { noteId: read.pointer?.noteId ?? null, revision: read.pointer?.revision ?? null, snapshot: read.pointer };
}

/** The public `{ noteId, revision }` payload of a pointer read (never a protected literal). */
function pointerPayload(pointer: PointerRead | null): { noteId: string | null; revision: number | null } | null {
  return pointer === null ? null : { noteId: pointer.noteId, revision: pointer.revision };
}

/**
 * L4 / decision 72 (U1): the ONE identity/fingerprint pair the note writer
 * (`writeNote`, `dispose`), the activation and the read-only `lookupToolCommit`
 * all use. The builder and these helpers were factored out so the write and the
 * lookup call one function and never drift into two copies. `activate` is the
 * platform's act, so its identity carries the fixed project/workspace scope and
 * the `activate:<noteId>:<version>` command id but never the calling principal
 * or trigger actor: every trigger of one activation replays the same receipt.
 */
export function noteCommandIdentity(op: 'write' | 'review' | 'withdraw' | 'activate', ctx: CoreCallContext,
  commandId: string): string {
  const common = { schemaVersion: 1, op, projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null, commandId };
  if (op === 'activate') return `s4-note-activate:` + sha256Hex(canonicalJson(common as unknown as JsonValue));
  return `s4-note-${op}:` + sha256Hex(canonicalJson({ ...common,
    principal: principalIdentity(ctx.principal) } as unknown as JsonValue));
}
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }

/** The one identity + fingerprint for a built `record_note` request, shared by the write and the lookup. */
function noteCommandReceiptOf(ctx: CoreCallContext, built: RecordNoteRequestV1): { identityKey: string; fingerprint: string } {
  if (built.op === 'write') {
    const request = built.request;
    return {
      identityKey: noteCommandIdentity('write', ctx, request.commandId),
      fingerprint: fingerprintOf({ kind: 's4-note-write', projectId: ctx.projectId,
        principal: principalIdentity(ctx.principal),
        commandId: request.commandId, note: request.note, expectedPointerRevision: request.expectedPointerRevision,
        goalId: request.goalId }),
    };
  }
  if (built.op === 'review') {
    const request = built.request;
    return {
      identityKey: noteCommandIdentity('review', ctx, request.commandId),
      fingerprint: fingerprintOf({ kind: 's4-note-disposition', projectId: ctx.projectId,
        principal: principalIdentity(ctx.principal),
        commandId: request.commandId, noteId: request.noteId, expectedVersion: request.expectedVersion,
        eventKind: request.verdict, reason: request.reason,
        expectedPointerRevision: request.expectedPointerRevision, resolution: request.resolution ?? null }),
    };
  }
  const request = built.request;
  return {
    identityKey: noteCommandIdentity('withdraw', ctx, request.commandId),
    fingerprint: fingerprintOf({ kind: 's4-note-disposition', projectId: ctx.projectId,
      principal: principalIdentity(ctx.principal),
      commandId: request.commandId, noteId: request.noteId, expectedVersion: request.expectedVersion,
      eventKind: 'withdraw', reason: request.reason, expectedPointerRevision: null, resolution: null }),
  };
}

async function headsByGoalState(deps: NoteServiceDependencies, projectId: string, goalId: string,
  state: NoteState): Promise<{ ok: true; heads: NoteHeadSnapshot[] } | { ok: false; code: ReadFailureCode; reason: string }> {
  const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [projectId, goalId, state]);
  if (!page.ok) return page;
  return { ok: true, heads: page.heads };
}

// --------------------------------------------------------------------------
// Draft validation (L4.1–L4.3)
// --------------------------------------------------------------------------

function sameKindFamily(left: string, right: string): boolean {
  // The four families (book :430–434): the six general kinds replace only each
  // other; an understanding, a repair, a link and a flow each replace only their
  // own kind. A link and a flow never replace one another.
  if (left === 'link' || right === 'link' || left === 'flow' || right === 'flow') return left === right;
  return isGeneral(left) === isGeneral(right);
}

/**
 * The ONE supersession target rule, shared by the accepted-write
 * supersession and the quota projection. The ordered, deduplicated union of
 * `replaces` and — for an understanding — the current pointer's note, minus the
 * subject itself and any id also listed in `coexistWith`
 * (R1/S4-NOTE-08: an id in both is not superseded).
 */
function supersessionTargetsOf(subject: { noteId: string; kind: NoteHeadSnapshot['kind'];
  replaces: readonly string[]; coexistWith: readonly string[] }, pointerNoteId: string | null): string[] {
  const coexisting = new Set(subject.coexistWith);
  const targets: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | null | undefined): void => {
    if (candidate === null || candidate === undefined || candidate === '' || candidate === subject.noteId) return;
    if (seen.has(candidate) || coexisting.has(candidate)) return;
    seen.add(candidate);
    targets.push(candidate);
  };
  for (const target of subject.replaces) add(target);
  if (subject.kind === 'understanding') add(pointerNoteId);
  return targets;
}

/** The stored body of an understanding is the rendered five sections (L4.1). */
export { renderUnderstandingBody } from './note-rendering.js';

/** The repair pin's exact shape; the readers validate each ref arm. */
function repairPinProblem(value: unknown): string | null {
  if (!isRecord(value) || !exactKeys(value, ['catalogRef', 'baseline'])) {
    return 'the repair pin carries exactly catalogRef and baseline';
  }
  if (readArchitectureCatalogRef(value['catalogRef']) === null) return 'the repair catalogRef is invalid';
  if (readArchitectureBaselinePin(value['baseline']) === null) return 'the repair baseline pin is invalid';
  return null;
}

/** The repair payload's exact outer shape; ops are parsed by the one op parser. */
function repairInputProblem(value: unknown): string | null {
  if (!isRecord(value) || !exactKeys(value, ['pin', 'ops', 'responsibilityMoves'])) {
    return 'a repair note requires pin, ops and responsibilityMoves';
  }
  const pin = repairPinProblem(value['pin']);
  if (pin !== null) return pin;
  if (!Array.isArray(value['ops'])) return 'the repair ops must be an array';
  if (!Array.isArray(value['responsibilityMoves'])) return 'the repair responsibilityMoves must be an array';
  return null;
}

// --------------------------------------------------------------------------
// The link draft's L1 shape (spec §4 L1): bare tokens, except the field-path
// forms for an end or an evidence `at`. The evidence role table and the literal
// bound live in `link-evidence.ts`; this is the one shape pass.
// --------------------------------------------------------------------------

const LINK_EVIDENCE_ROLES: readonly string[] = ['use', 'wire', 'register', 'emit', 'receive', 'launch', 'entry'];

function isEndDraftKind(value: unknown): value is 'module' | 'interface' | 'file' {
  return value === 'module' || value === 'interface' || value === 'file';
}

/** `symbolRequest.language` must agree with the file's extension (C7/F24). */
function endLanguageMismatch(anchor: Record<string, unknown>): boolean {
  const request = anchor['symbolRequest'];
  if (anchor['kind'] !== 'file' || !isRecord(request) || typeof anchor['path'] !== 'string') return false;
  return languageOfPath(anchor['path']) !== request['language'];
}

function linkKeyProblem(link: Record<string, unknown>, relation: string): string | null {
  const has = link['key'] !== undefined;
  const key = link['key'];
  if (relation === 'injects' || relation === 'callback') {
    if (has && key !== null) return 'link_key_mismatch';
    return null;
  }
  if (!has) return 'link_key_mismatch';
  if (key === null) return null;
  if (!isRecord(key)) return 'link_key_invalid';
  if (key['kind'] === 'literal') {
    return typeof key['text'] === 'string' && literalKeyProblem(key['text']) === null ? null : 'link_key_invalid';
  }
  if (key['kind'] !== 'symbol') return 'link_key_invalid';
  if (relation === 'spawns') return 'link_key_invalid';
  const anchor = key['anchor'];
  // LinkKeyV1's symbol key is a file anchor that carries the symbol request.
  if (!isRecord(anchor) || anchor['kind'] !== 'file' || anchor['symbolRequest'] === undefined) {
    return 'link_key_invalid';
  }
  // Reuse the one file-anchor shape rule; its prefixed text is not the token.
  if (anchorFormatProblem(anchor, 'link.key') !== null) return 'link_key_invalid';
  return endLanguageMismatch(anchor) ? 'link_key_invalid' : null;
}

function linkEvidenceProblem(link: Record<string, unknown>, relation: string): string | null {
  const evidence = link['evidence'];
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > NOTE_LINK_EVIDENCE_MAX) {
    return 'evidence_count';
  }
  const roles: string[] = [];
  for (const entry of evidence) {
    const role = isRecord(entry) ? entry['role'] : undefined;
    if (typeof role !== 'string' || !LINK_EVIDENCE_ROLES.includes(role)) return 'evidence_roles';
    roles.push(role);
  }
  if (evidenceRoleProblem(relation as never, roles as never) !== null) return 'evidence_roles';
  for (const [index, entry] of evidence.entries()) {
    const field = `link.evidence[${String(index)}].at`;
    const at = isRecord(entry) ? entry['at'] : undefined;
    if (!isRecord(at)) return `evidence_invalid: ${field}`;
    if (!isSafeProjectPath(at['path']) || splitWorkspacePath(at['path']).path === '.') return `evidence_invalid: ${field}.path`;
    const hasRequest = at['symbolRequest'] !== undefined;
    const hasRange = at['range'] !== undefined;
    if (hasRequest && hasRange) return `evidence_invalid: ${field}`;
    const range = at['range'];
    if (hasRange) {
      if (!isRecord(range) || !isPos(range['startLine']) || !isPos(range['endLine'])
        || range['startLine'] > range['endLine']) return `evidence_invalid: ${field}.range`;
    }
    if (hasRequest) {
      const request = at['symbolRequest'];
      const shaped = anchorFormatProblem({ kind: 'file', path: at['path'], symbolRequest: request }, field);
      if (shaped !== null) return `evidence_invalid: ${field}.symbolRequest`;
      // A symbolRequest is only for TS/JS files (F24): another extension or a
      // language that disagrees with it is the same field-path refusal.
      const pathLanguage = languageOfPath(at['path'] as string);
      if (pathLanguage !== 'typescript' || pathLanguage !== (request as Record<string, unknown>)['language']) {
        return `evidence_invalid: ${field}.symbolRequest`;
      }
    }
  }
  return null;
}

function linkShapeProblem(draft: Record<string, unknown>): string | null {
  const link = draft['link'];
  if (!isRecord(link)) return 'link_anchor_kind';
  const relation = link['relation'];
  if (typeof relation !== 'string'
    || !['calls', 'injects', 'callback', 'data', 'message', 'spawns'].includes(relation)) {
    return 'link_anchor_kind';
  }
  const anchor = draft['anchor'];
  if (!isRecord(anchor) || !isEndDraftKind(anchor['kind'])) return 'link_anchor_kind';
  const extraAnchors = draft['extraAnchors'] as unknown[];
  const count = extraAnchors.length;
  const needsTwo = relation === 'injects' || relation === 'callback';
  if (needsTwo ? count !== 2 : count < 1 || count > 2) return 'link_anchor_count';
  const to = extraAnchors[0];
  if (!isRecord(to)) return 'link_anchor_kind';
  if (needsTwo || relation === 'calls') {
    if (to['kind'] !== 'file' || to['symbolRequest'] === undefined) return 'link_anchor_kind';
  } else if (!isEndDraftKind(to['kind'])) {
    return 'link_anchor_kind';
  }
  const via = count === 2 ? extraAnchors[1] : undefined;
  if (via !== undefined) {
    if (!isRecord(via)) return 'link_anchor_kind';
    if (needsTwo) {
      if (via['kind'] !== 'file' || via['symbolRequest'] === undefined) return 'link_anchor_kind';
    } else if (via['kind'] !== 'interface' && via['kind'] !== 'file') {
      return 'link_anchor_kind';
    }
  }
  // End language/extension mismatch: the end's own field path (C7/F24).
  if (endLanguageMismatch(anchor)) return 'anchor_invalid: anchor';
  if (endLanguageMismatch(to)) return 'anchor_invalid: extraAnchors[0]';
  if (isRecord(via) && endLanguageMismatch(via)) return 'anchor_invalid: extraAnchors[1]';
  const keyProblem = linkKeyProblem(link, relation);
  if (keyProblem !== null) return keyProblem;
  const evidenceProblem = linkEvidenceProblem(link, relation);
  if (evidenceProblem !== null) return evidenceProblem;
  if (draft['structural'] === true) return 'structural_not_allowed';
  return null;
}

/**
 * The flow draft's shape (book :253–260): 2–20 steps, each an object whose only
 * key is the non-empty noteId of a link, no duplicate step, and
 * `structural: false`. Step kinds and step states are the relation step's
 * rules, not this one.
 */
function flowShapeProblem(draft: Record<string, unknown>): string | null {
  const flow = draft['flow'];
  if (!isRecord(flow)) return 'flow_step_count';
  const steps = flow['steps'];
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 20) return 'flow_step_count';
  const seen = new Set<string>();
  for (const step of steps) {
    if (!isRecord(step) || !hasOnlyKeys(step, ['link'])) return 'flow_step_count';
    const link = step['link'];
    if (typeof link !== 'string' || link.length === 0) return 'flow_step_count';
    if (seen.has(link)) return 'flow_step_duplicate';
    seen.add(link);
  }
  if (draft['structural'] === true) return 'structural_not_allowed';
  return null;
}

/**
 * L4.1/L2a class 1: the complete shape gate over the WHOLE `WriteNoteInput`.
 * `writeNote` runs it first, before the trusted caller read and before any
 * dereference or read, so a malformed input is refused `invalid` with the draft
 * and can never reach a store/plan/workspace read. Anchor object
 * existence and the `symbolRequest` shape are checked later (classes 2/3 and
 * the symbol resolution), not here.
 */
function writeInputProblem(input: unknown): string | null {
  if (!isRecord(input)) return 'the write input must be an object';
  if (typeof input['commandId'] !== 'string' || input['commandId'].length === 0) return 'a write requires a commandId';
  const goalId = input['goalId'];
  if (!(goalId === null || (typeof goalId === 'string' && goalId.length > 0))) {
    return 'goalId must be a non-empty string or null';
  }
  const expectedPointerRevision = input['expectedPointerRevision'];
  if (!(expectedPointerRevision === null || isPos(expectedPointerRevision))) {
    return 'expectedPointerRevision must be null or a positive safe integer';
  }
  const draft = input['note'];
  if (!isRecord(draft)) return 'the note draft must be an object';
  const kind = draft['kind'];
  if (typeof kind !== 'string' || !(NOTE_KINDS as readonly string[]).includes(kind)) return 'the note kind is not recognized';
  const topic = topicProblem(draft['topic']);
  if (topic !== null) return topic;
  const conclusion = conclusionProblem(draft['conclusion']);
  if (conclusion !== null) return conclusion;
  if (kind === 'understanding') {
    if ('body' in draft) return 'an understanding note gives sections, not a body';
    const sections = draft['sections'];
    if (!isRecord(sections)) return 'an understanding note requires five sections';
    for (const field of ['status', 'decided', 'open', 'next', 'risks'] as const) {
      const value = sections[field];
      if (typeof value !== 'string' || codepointLength(value) < 1) {
        return `an understanding section ${field} requires at least one code point`;
      }
    }
    const body = renderUnderstandingBody(sections as never);
    // C3.1/§11.4: the project understanding has its own, smaller cap because the
    // whole body goes into every context.
    const cap = isProjectAnchorDraft(draft['anchor']) ? PROJECT_UNDERSTANDING_BODY_MAX_BYTES : UNDERSTANDING_BODY_MAX_BYTES;
    if (Buffer.byteLength(body, 'utf8') > cap) return 'the understanding body exceeds its byte limit';
  } else {
    if ('sections' in draft) return 'only an understanding note carries sections';
    const body = draft['body'];
    if (typeof body !== 'string') return 'a note requires a body';
    if (Buffer.byteLength(body, 'utf8') > NOTE_BODY_MAX_BYTES) return 'the note body exceeds its byte limit';
  }
  const payload = payloadKindProblem(draft, kind);
  if (payload !== null) return payload;
  if (kind === 'repair') {
    const repair = repairInputProblem(draft['repair']);
    if (repair !== null) return repair;
  }
  // For a repair the caller's `structural` is optional and ignored: the
  // platform writes its own `structuralOfRepair(ops)` value.
  if (typeof draft['structural'] !== 'boolean' && !(kind === 'repair' && draft['structural'] === undefined)) {
    return 'structural must be a boolean';
  }
  const anchor = anchorFormatProblem(draft['anchor'], 'anchor');
  if (anchor !== null) return anchor.reason;
  const extraAnchors = draft['extraAnchors'];
  if (!Array.isArray(extraAnchors)) return 'extraAnchors must be an array';
  if (extraAnchors.length > NOTE_EXTRA_ANCHORS_MAX) return 'too many extra anchors';
  // C3.1/§11.4: a project understanding carries no extra anchors, so it never
  // shows up in a module lookup.
  if (kind === 'understanding' && isProjectAnchorDraft(draft['anchor']) && extraAnchors.length > 0) {
    return 'project_understanding_extra_anchors';
  }
  for (const [index, extra] of extraAnchors.entries()) {
    const problem = anchorFormatProblem(extra, `extraAnchors[${String(index)}]`);
    if (problem !== null) return problem.reason;
  }
  if (kind === 'link') {
    const linkProblem = linkShapeProblem(draft);
    if (linkProblem !== null) return linkProblem;
  }
  if (kind === 'flow') {
    const flowProblem = flowShapeProblem(draft);
    if (flowProblem !== null) return flowProblem;
  }
  const facts = draft['facts'];
  if (!Array.isArray(facts)) return 'facts must be an array';
  if (facts.length > NOTE_FACTS_MAX) return 'too many facts';
  for (const [index, fact] of facts.entries()) {
    const problem = factProblem(fact);
    if (problem !== null) return `facts[${String(index)}]: ${problem}`;
  }
  const basisFiles = draft['basisFiles'];
  if (!Array.isArray(basisFiles)) return 'basisFiles must be an array';
  if (basisFiles.length > NOTE_BASIS_FILES_MAX) return 'too many basis files';
  if (!basisFiles.every(entry => typeof entry === 'string' && entry.length > 0)) {
    return 'basisFiles entries must be non-empty strings';
  }
  for (const field of ['replaces', 'contradicts', 'coexistWith'] as const) {
    const value = draft[field];
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (!value.every(entry => typeof entry === 'string' && entry.length > 0)) {
      return `${field} entries must be non-empty strings`;
    }
  }
  return null;
}

function repairProblem(reason: string, detail: string): RepairProblemV1 {
  return { status: 'invalid', reason, detail };
}

/**
 * The write-time responsibility-move refusal: the shared pure shape check over
 * the TRIAL catalog (so a module added by the same ops can be a destination).
 * Source openness and completeness are activation's checks, not this staged
 * write's.
 */
function repairMovesProblem(raw: unknown,
  modules: readonly { ref: { projectId: string; moduleId: string } }[], projectId: string): RepairProblemV1 | null {
  const trialModules = new Set(modules
    .filter(module => module.ref.projectId === projectId)
    .map(module => module.ref.moduleId));
  const reason = catalogRevisionMovesProblem(raw as ResponsibilityMoveV1[], projectId, trialModules);
  if (reason === null) return null;
  if (reason === 'duplicate_responsibility_move' || reason === 'responsibility_destination_missing'
    || reason === 'noop_op') {
    return repairProblem(reason, reason);
  }
  return repairProblem('invalid_op', reason);
}

type RepairTrialResult = { ok: true; payload: RepairPayloadV1 } | { ok: false; rejection: Rejected };

/**
 * The ONE write-time repair trial: resolves the pin's
 * recorded baseline and its `dependencyRules`, applies the ops with G1's pure
 * engine (which also validates the final catalog), checks the move destinations
 * against the TRIAL catalog, and returns the platform-computed payload. It
 * never reads the current catalog, never commits and never checks the footprint.
 */
async function repairTrial(deps: NoteServiceDependencies, ctx: CoreCallContext,
  repair: { pin: RepairPayloadV1['pin']; ops: unknown; responsibilityMoves: unknown }): Promise<RepairTrialResult> {
  const parsed = parseRepairOps(repair.ops);
  if (!parsed.ok) return { ok: false, rejection: rejected('invalid', parsed.problem.reason) };
  const { catalogRef, baseline } = repair.pin;
  if (catalogRef.projectId !== ctx.projectId) {
    return { ok: false, rejection: rejected('invalid', 'the repair pin is outside the call context project') };
  }
  if (catalogRef.projectId !== baseline.ref.projectId || catalogRef.baselineId !== baseline.ref.baselineId
    || catalogRef.revision !== baseline.ref.revision) {
    return { ok: false, rejection: rejected('invalid', 'the repair pin does not link its catalog ref to its baseline ref') };
  }
  const revision = await readRevisionByRef(deps.records, baseline.ref);
  if (revision.status === 'not_found') {
    return { ok: false, rejection: rejected('invalid', 'the repair pin names no recorded architecture baseline') };
  }
  if (revision.status === 'not_ready') {
    return { ok: false, rejection: rejected('unavailable', 'the repair pin baseline is not ready') };
  }
  if (revision.status === 'rejected') {
    return { ok: false, rejection: rejected(noteCodeOf(revision.code), revision.reason) };
  }
  if (revision.value.baseline.contentDigest !== baseline.digest) {
    return { ok: false, rejection: rejected('invalid', 'the repair pin baseline digest does not match the recorded revision') };
  }
  // The stored ops are project paths: qualify them to the request workspace
  // before the trial and before they are stored. A bare path belongs to the
  // caller, a prefixed one to its own, and a main-workspace prefix is refused.
  let mainWorkspaceId = ctx.workspaceId ?? '';
  if (deps.mainWorkspaceOf !== undefined) {
    const main = await deps.mainWorkspaceOf(ctx.projectId);
    if (main.status !== 'ready') {
      return { ok: false, rejection: rejected('unavailable',
        main.status === 'rejected' ? main.reason : 'the main workspace cannot be read') };
    }
    mainWorkspaceId = main.value ?? mainWorkspaceId;
  }
  let ops: CatalogRepairOpV1[];
  try {
    ops = qualifyOps(parsed.ops, ctx.workspaceId ?? '', mainWorkspaceId);
  } catch {
    return { ok: false, rejection: rejected('invalid', 'a repair op names the main workspace by prefix') };
  }
  const trial = applyRepairOps(revision.value.catalog.catalog,
    revision.value.baseline.content.dependencyRules ?? [], ops, ctx.projectId);
  if (!trial.ok) return { ok: false, rejection: rejected('invalid', trial.problem.reason) };
  const moves = repairMovesProblem(repair.responsibilityMoves, trial.catalog.modules, ctx.projectId);
  if (moves !== null) return { ok: false, rejection: rejected('invalid', moves.reason) };
  return { ok: true, payload: { pin: repair.pin, ops,
    responsibilityMoves: repair.responsibilityMoves as ResponsibilityMoveV1[],
    structural: structuralOfRepair(ops) } };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

/**
 * One plan window the card source has already read for a
 * Goal. `userReasonFacts` seeds its per-call cache with it, so a stage target
 * never reads the same window again.
 */
export type NotePlanWindowFactsV1 = { goalId: string; window: GoalPlanWindow };

/** The batched user-reason facts the card source reuses. */
export type NoteUserReasonFactsPort = {
  userReasonFacts(ctx: CoreCallContext, heads: readonly NoteHeadSnapshot[],
    planWindows: readonly NotePlanWindowFactsV1[],
    attempt?: DecisionSourceAttempt): Promise<ReadResult<Map<string, NoteUserReasonTargetV1>>>;
};

/**
 * The composition root's reject arm for a `repair_approval` answer. It is not a
 * public note write (`NoteWritePort`), not a route and not an HTTP type: only
 * `createTargetPlatform`'s `repair_approval` row calls it, so an ordinary
 * `notes/withdraw` can never mint the card proof that proves the answer's
 * application. The transition is the ordinary one (`staged → withdrawn`,
 * reason `rejected_by_user`); the proof rides this commit's own
 * `NoteDispositionChanged` event.
 */
export type NoteRepairRejectionPort = {
  applyRepairRejection(ctx: CoreCallContext, input: {
    commandId: string; noteId: string; expectedVersion: number;
    answerMessageRef: SessionMessageRef; actor: ActorRef | null;
  }): Promise<NoteDispositionResult>;
};

export type NoteService = NoteWritePort & NoteDecisionApplyPort & NoteUserReasonFactsPort
  & NoteRepairRejectionPort;

export function createNoteService(deps: NoteServiceDependencies): NoteService {
  const anchorQuota = deps.anchorQuota ?? NOTE_ANCHOR_QUOTA;
  const goalQuota = deps.goalQuota ?? NOTE_GOAL_QUOTA;
  // 8E's own populations: links per anchor (30), link+flow per goal (300) and
  // current flows per project (100). The general 5/200 above stay separate.
  const anchorLinkQuota = deps.anchorLinkQuota ?? NOTE_ANCHOR_LINK_QUOTA;
  const goalLinkQuota = deps.goalLinkQuota ?? NOTE_GOAL_LINK_QUOTA;
  const projectFlowQuota = deps.projectFlowQuota ?? NOTE_PROJECT_FLOW_QUOTA;
  const basisFileMaxBytes = Math.min(deps.basisFileMaxBytes ?? NOTE_BASIS_FILE_MAX_BYTES, deps.workspaceMaxFileBytes);
  // The anchor and basis-file reads are the platform's checks (`noteCheckWorkspace`).
  const checkedWorkspace = noteCheckWorkspace(deps.workspace);
  const anchorFacts: NoteAnchorFactsDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.mainWorkspaceOf === undefined ? {} : { mainWorkspaceOf: deps.mainWorkspaceOf }),
    workspace: checkedWorkspace };

  /**
   * P9: the per-commit envelope fields shared by every event of one
   * commit. Each event mints its OWN eventId (`{ ...base, eventId: deps.eventId() }`),
   * so a commit with several events never reuses one id.
   */
  function eventBase(projectId: string, workspaceId: string, occurredAt: string):
  { schemaVersion: 1; occurredAt: string; projectId: string; workspaceId: string } {
    return { schemaVersion: NOTE_EVENT_SCHEMA_VERSION, occurredAt, projectId, workspaceId };
  }

  function rejectedInput(input: WriteNoteInput, code: NoteErrorCode, reason: string,
    extra: Partial<Extract<WriteNoteResult, { status: 'rejected' }>> = {}): WriteNoteResult {
    return { status: 'rejected', code, reason, draft: input, ...extra };
  }

  /** The note owner's original wording for a failed NoteWritten replay. */
  function writeReplayRejection(failure: ReceiptReplayFailure): CoreRejection {
    switch (failure.kind) {
      case 'event_unreadable':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed write event could not be read' };
      case 'event_rejected':
        return { status: 'rejected', code: 'unavailable', reason: failure.rejection.reason };
      case 'wrong_event_type':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed write event is not a NoteWritten event' };
      case 'receipt_mismatch':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed write event disagrees with the receipt' };
      case 'undecodable':
        return { status: 'rejected', code: 'unavailable', reason: `the replayed write event is not decodable: ${failure.reason}` };
      case 'identity_mismatch':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed write event identity disagrees with the receipt' };
    }
  }

  /** The note owner's original wording for a failed NoteDispositionChanged replay. */
  function dispositionReplayRejection(failure: ReceiptReplayFailure): CoreRejection {
    switch (failure.kind) {
      case 'event_unreadable':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event could not be read' };
      case 'event_rejected':
        return { status: 'rejected', code: 'unavailable', reason: failure.rejection.reason };
      case 'wrong_event_type':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event is not a NoteDispositionChanged event' };
      case 'receipt_mismatch':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event disagrees with the receipt' };
      case 'undecodable':
        return { status: 'rejected', code: 'unavailable', reason: `the replayed disposition event is not decodable: ${failure.reason}` };
      case 'identity_mismatch':
        return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event identity disagrees with the receipt' };
    }
  }

  /**
   * R4: restore the ORIGINAL write result verbatim from the
   * NoteWritten event at the receipt cursor. Every check failure is
   * `unavailable` with the draft; a constructed success is never returned.
   */
  async function replayWrite(receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, input: WriteNoteInput,
    projectId: string): Promise<WriteNoteResult> {
    const replayed = await replayCommittedReceipt({
      receipt,
      eventAt: (cursor) => deps.records.eventAt(cursor),
      expectedEventType: NOTE_WRITTEN_EVENT_TYPE,
      decode: noteWrittenEventFromEvent,
      project: (event) => event.result,
      validate: (event, committed) => {
        const result = event.result;
        const refKey = noteVersionRefKey({ aggregateType: 'NoteVersion', projectId, noteId: result.noteId,
          version: result.version });
        const stored = committed.versions.find(entry => entry.refKey === refKey);
        return stored === undefined || stored.revision !== 1
          ? { status: 'rejected', code: 'unavailable', reason: 'the replayed write receipt does not name its NoteVersion' }
          : null;
      },
      onFailure: writeReplayRejection,
    });
    return replayed.status === 'committed'
      ? replayed.value
      : rejectedInput(input, 'unavailable', replayed.reason);
  }

  /** The mailbox pattern: a lost receipt is re-checked by identity only. */
  async function recheckWrite(identityKey: string, fingerprint: string, input: WriteNoteInput, projectId: string):
  Promise<WriteNoteResult | null> {
    let again: Awaited<ReturnType<NoteServiceDependencies['records']['lookupCommit']>>;
    try {
      again = await deps.records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return rejectedInput(input, 'unavailable', 'the write idempotency receipt could not be re-checked');
    }
    if (again.status === 'ready') return replayWrite(again.value, input, projectId);
    if (again.code === 'idempotency_conflict') return rejectedInput(input, 'invalid', 'idempotency_conflict');
    if (again.code === 'not_found') return null;
    return rejectedInput(input, 'unavailable', again.reason);
  }

  /**
   * R4: restore the ORIGINAL disposition from the
   * NoteDispositionChanged event at the receipt cursor, before any mutable read.
   */
  async function replayDisposition(receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identityKey: string,
    fingerprint: string, noteId: string): Promise<NoteDispositionResult> {
    const replayed = await replayCommittedReceipt({
      receipt,
      eventAt: (cursor) => deps.records.eventAt(cursor),
      expectedEventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE,
      decode: noteDispositionChangedEventFromEvent,
      project: (event): Extract<NoteDispositionResult, { status: 'done' }> => ({
        status: 'done', noteId, version: event.head.version, state: event.head.state,
        receipt: { identityKey, fingerprint, cursor: receipt.cursor },
      }),
      validate: (event) => event.head.noteId === noteId
        ? null
        : { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event names another note' },
      onFailure: dispositionReplayRejection,
    });
    return replayed.status === 'committed'
      ? replayed.value
      : { status: 'rejected', code: 'unavailable', reason: replayed.reason, noteId };
  }

  /** The mailbox pattern: a lost disposition receipt is re-checked by identity only. */
  async function recheckDisposition(identityKey: string, fingerprint: string, noteId: string):
  Promise<NoteDispositionResult | null> {
    let again: Awaited<ReturnType<NoteServiceDependencies['records']['lookupCommit']>>;
    try {
      again = await deps.records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: 'the disposition idempotency receipt could not be re-checked', noteId };
    }
    if (again.status === 'ready') return replayDisposition(again.value, identityKey, fingerprint, noteId);
    if (again.code === 'idempotency_conflict') {
      return { status: 'rejected', code: 'invalid', reason: 'idempotency_conflict', noteId };
    }
    if (again.code === 'not_found') return null;
    return { status: 'rejected', code: 'unavailable', reason: again.reason, noteId };
  }

  /**
   * L22 existingTopics: per anchor key, only when
   * the new `topicKey` is new on that key, group the other current general notes
   * by `topicKey` and keep the latest-written head's spelling (createdAt desc,
   * then noteId desc). Sorted by anchorKey then topicKey, plain code-unit
   * comparison, capped at `NOTE_EXISTING_TOPICS_MAX`. Computed from the
   * pre-commit `currentByAnchor` minus the heads this commit supersedes; no read
   * after the commit, so the answer can never come back partial.
   */
  function existingTopicsOf(currentByAnchor: ReadonlyMap<string, readonly NoteHeadSnapshot[]>,
    superseded: ReadonlySet<string>, ownTopicKey: string): NoteExistingTopicV1[] {
    type Group = { anchorKey: string; topicKey: string; head: NoteHeadSnapshot; count: number };
    const found = new Map<string, Group>();
    for (const [key, heads] of currentByAnchor) {
      const current = heads.filter(head => !superseded.has(head.noteId) && isGeneral(head.kind));
      // L22: no entry for this anchor when a current general note already has the
      // new topicKey on it.
      if (current.some(head => head.topicKey === ownTopicKey)) continue;
      for (const head of current) {
        const mapKey = `${key}\u0000${head.topicKey}`;
        const existing = found.get(mapKey);
        if (existing === undefined) {
          found.set(mapKey, { anchorKey: key, topicKey: head.topicKey, head, count: 1 });
        } else {
          existing.count += 1;
          if (head.createdAt > existing.head.createdAt
            || (head.createdAt === existing.head.createdAt && head.noteId > existing.head.noteId)) {
            existing.head = head;
          }
        }
      }
    }
    const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
    return [...found.values()]
      .sort((left, right) => compare(left.anchorKey, right.anchorKey) || compare(left.topicKey, right.topicKey))
      .slice(0, NOTE_EXISTING_TOPICS_MAX)
      .map(group => ({ anchorKey: group.anchorKey, topic: group.head.topic, count: group.count }));
  }

  type SupersessionSubject = Pick<NoteHeadSnapshot, 'noteId' | 'kind' | 'replaces' | 'coexistWith'>;
  type SupersessionOutcome =
    | { ok: true; records: EncodedRecord[]; guards: Map<string, number | null>; events: EncodedDomainEvent[];
        /** The superseded heads as written (their note files are written too). */
        heads: PendingNoteHeadSnapshot[] }
    | { ok: false; rejection: Rejected };

  /**
   * L6/S4-NOTE-05/08: the ONE supersession builder, used by an accepted
   * write and an accepted disposition. The target set is the ordered, deduped
   * union of `subject.replaces` and — for an understanding — the current
   * pointer's noteId, minus the subject itself (R1/S4-NOTE-08: an id also listed
   * in `coexistWith` is not superseded). Each accepted/reviewed target gets a
   * `supersede` head+version, its guard and its own NoteDispositionChanged event.
   * An understanding additionally moves the pointer under the pointer-record
   * guard. A failed or missing target read aborts with `unavailable` and the
   * caller writes nothing.
   */
  async function supersessionOf(ctx: CoreCallContext, subject: SupersessionSubject, by: NoteSourceV1,
    prereadHeads: ReadonlyMap<string, NoteHeadSnapshot | null> | null, pointerKey: string | null,
    pointer: PointerRead | null, now: string):
  Promise<SupersessionOutcome> {
    const records: EncodedRecord[] = [];
    const guards = new Map<string, number | null>();
    const events: EncodedDomainEvent[] = [];
    const written: PendingNoteHeadSnapshot[] = [];
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);
    const targets = supersessionTargetsOf(subject, pointer?.noteId ?? null);
    // RW-12a: every target not already preread by the decision is read in ONE
    // batched `readMany`; a missing or damaged head still aborts the command.
    const heads = new Map<string, NoteHeadSnapshot | null>();
    if (prereadHeads !== null) {
      for (const target of targets) {
        if (prereadHeads.has(target)) heads.set(target, prereadHeads.get(target) ?? null);
      }
    }
    const missing = targets.filter(target => !heads.has(target));
    if (missing.length > 0) {
      const refKeys = missing.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId, noteId }));
      const read = await deps.records.readMany(refKeys);
      if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
      const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
      for (const [index, target] of missing.entries()) {
        const record = byKey.get(refKeys[index]!);
        if (record === undefined) { heads.set(target, null); continue; }
        const decoded = decodeNoteHeadSnapshot(record);
        if (decoded.status !== 'decoded') {
          return { ok: false, rejection: rejected('unavailable', `a replaced note is damaged: ${decoded.reason}`) };
        }
        heads.set(target, decoded.value);
      }
    }
    for (const target of targets) {
      const head = heads.get(target)!;
      if (head === null) return { ok: false, rejection: rejected('unavailable', 'a replaced note cannot be read') };
      if (head.state !== 'accepted' && head.state !== 'reviewed') continue;
      const transition = transitionNote(head, { kind: 'supersede' });
      if (!transition.ok) continue;
      const bumped = transition.next;
      const version = newNoteVersionRecord(bumped, { kind: 'supersede', by, reason: null,
        decisionMessageRef: null }, now, null);
      records.push(encodeNoteHeadSnapshot(bumped), encodeNoteVersionSnapshot(version));
      written.push(bumped);
      guards.set(encodeNoteHeadSnapshot(bumped).refKey, head.version);
      guards.set(encodeNoteVersionSnapshot(version).refKey, null);
      events.push(encodeNoteDispositionChangedEvent({ ...base, eventId: deps.eventId(),
        eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, head: bumped, version, acknowledgementRef: null,
        actor: null, proof: null }));
    }
    if (subject.kind === 'understanding') {
      if (pointerKey === null || pointer === null) {
        return { ok: false, rejection: rejected('unavailable', 'the current pointer cannot be read') };
      }
      const ref: CurrentPointerRef = { aggregateType: 'CurrentPointer', projectId: ctx.projectId, anchorKey: pointerKey };
      const moved = pointer.snapshot === null
        ? newCurrentPointerRecord(ref, pointerKey, subject.noteId)
        : moveCurrentPointerRecord(pointer.snapshot, subject.noteId);
      records.push(encodeCurrentPointerSnapshot(moved));
      guards.set(encodeCurrentPointerSnapshot(moved).refKey, pointer.revision);
      events.push(encodeCurrentPointerMovedEvent({ ...base, eventId: deps.eventId(),
        eventType: CURRENT_POINTER_MOVED_EVENT_TYPE, pointer: moved }));
    }
    return { ok: true, records, guards, events, heads: written };
  }

  /** The card-mode proof input (the answering user; no proof on the scribe path). */
  type CardProofInput = { acknowledgementRef: SessionMessageRef; actor: ActorRef | null };

  type FinishDispositionInput = {
    identityKey: string;
    fingerprint: string;
    noteId: string;
    head: NoteHeadSnapshot;
    caller: Caller;
    transition: { ok: true; next: PendingNoteHeadSnapshot };
    decisionHeads: ReadonlyMap<string, NoteHeadSnapshot>;
    /**
     * `accept`: read the pointer only for an accepting disposition (the scribe
     * path); `always`: every card option reads it, so a reject is guarded too.
     */
    readPointer: 'accept' | 'always';
    expectedPointerRevision: number | null;
    change: NoteVersionSnapshot['change'];
    cardProof: CardProofInput | null;
  };

  /**
   * §3: the ONE shared tail of `dispose` and
   * `applyNoteDecision`, split at `transitionNote`. The fronts own their own
   * replay/caller/authority/facts/transition rules; from here on the pointer
   * CAS (+ `understanding_outdated` on accept), the supersession, the notice
   * class, the head and version records, the subject event (with the card
   * proof when `cardProof` is set), the read-only guards and the commit are
   * identical. A pointer that was READ but not written (a card reject) gets a
   * READ-ONLY pointer guard at the read revision.
   */
  async function finishDisposition(ctx: CoreCallContext, input: FinishDispositionInput):
  Promise<NoteDispositionResult> {
    const { identityKey, fingerprint, noteId, head, caller, transition, decisionHeads, change, cardProof } = input;
    const acceptance = change.kind === 'accept';
    const now = deps.now();
    const records: EncodedRecord[] = [];
    const guards = new Map<string, number | null>();
    const events: EncodedDomainEvent[] = [];
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);

    // Guard: the understanding pointer pin (and, on accept, the outdated case).
    const pointerKey = head.kind === 'understanding' ? anchorKeyOf(head.anchor) : null;
    let pointer: PointerRead | null = null;
    let pointedHead: NoteHeadSnapshot | null = null;
    if (pointerKey !== null && (input.readPointer === 'always' || acceptance)) {
      pointer = await currentPointerRead(deps, ctx.projectId, pointerKey);
      if (pointer === null) {
        return { status: 'rejected', code: 'unavailable', reason: 'the current pointer cannot be read', noteId };
      }
      if (input.expectedPointerRevision !== pointer.revision) {
        return { status: 'rejected', code: 'revision_conflict', reason: 'the current-understanding pointer moved', noteId,
          pointer: pointerPayload(pointer)! };
      }
      // C3.5/D-15 (§11.6): a newer current understanding makes this pending one
      // outdated; it can no longer be accepted (the scribe rejects it or merges
      // it into a fresh version).
      if (acceptance && pointer.noteId !== null) {
        const pointedRead = await readHead(deps, ctx.projectId, pointer.noteId);
        if (!pointedRead.ok) {
          return { status: 'rejected', code: pointedRead.rejection.code, reason: pointedRead.rejection.reason, noteId };
        }
        pointedHead = pointedRead.head;
        if (pointedHead !== null && pointedHead.createdAt > head.createdAt) {
          return { status: 'rejected', code: 'invalid', reason: 'understanding_outdated', noteId };
        }
      }
    }

    // Supersession: only an accepting disposition supersedes (and moves the pointer).
    const bumped: { noteId: string; head: NoteHeadSnapshot }[] = [];
    const written: PendingNoteHeadSnapshot[] = [transition.next];
    if (acceptance) {
      const supersession = await supersessionOf(ctx, transition.next, caller.source, decisionHeads,
        pointerKey, pointer, now);
      if (!supersession.ok) {
        return { status: 'rejected', code: supersession.rejection.code, reason: supersession.rejection.reason, noteId };
      }
      written.push(...supersession.heads);
      for (const targetId of supersessionTargetsOf(transition.next, pointer?.noteId ?? null)) {
        const targetHead = decisionHeads.get(targetId) ?? (targetId === pointer?.noteId ? pointedHead : null);
        if (targetHead === null || targetHead === undefined) continue;
        if (targetHead.state !== 'accepted' && targetHead.state !== 'reviewed') continue;
        bumped.push({ noteId: targetId, head: targetHead });
      }
      records.push(...supersession.records);
      for (const [refKey, revision] of supersession.guards) guards.set(refKey, revision);
      events.push(...supersession.events);
    }

    // §2: the writer decides the notice class from the ACTUAL
    // targets this commit superseded/withdrew (never the stored reasons).
    const supersededForNotice = supersessionTargetsOf(transition.next, pointer?.noteId ?? null);
    const userAffected = change.kind === 'withdraw'
      ? (change.by.kind !== 'user' && (head.confirmedByUser || head.source.kind === 'user'))
      : acceptance
        ? (change.by.kind !== 'user' && supersededForNotice.some(targetId => {
            const target = decisionHeads.get(targetId) ?? (targetId === pointer?.noteId ? pointedHead : null);
            return target !== null && target !== undefined
              && (target.state === 'accepted' || target.state === 'reviewed')
              && (target.confirmedByUser || target.source.kind === 'user');
          }))
        : false;
    records.push(encodeNoteHeadSnapshot(transition.next));
    guards.set(encodeNoteHeadSnapshot(transition.next).refKey, head.version);
    const version = newNoteVersionRecord(transition.next, change, now,
      noticeClassOf({ change, state: transition.next.state, kind: transition.next.kind,
        structural: transition.next.structural, userAffected }));
    records.push(encodeNoteVersionSnapshot(version));
    guards.set(encodeNoteVersionSnapshot(version).refKey, null);

    // The subject event: the card application's own event carries the actor and
    // the standard proof; every other disposition carries neither (M2: the
    // superseded targets' events stay actor:null/proof:null).
    const headPin: VersionPin = { ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId },
      revision: head.version };
    let proof: DecisionChangeProofV1 | null = null;
    let acknowledgementRef: SessionMessageRef | null = null;
    let actor: ActorRef | null = null;
    if (cardProof !== null) {
      const capturedPins: VersionPin[] = [headPin];
      if (pointerKey !== null && pointer !== null && pointer.revision !== null) {
        capturedPins.push({ ref: { aggregateType: 'CurrentPointer', projectId: ctx.projectId, anchorKey: pointerKey },
          revision: pointer.revision });
      }
      // ONE {before, after} row per changed HEAD, both sides the same NoteHead
      // aggregate (`@v -> @v+1`); no CurrentPointer row.
      const changes: DecisionChangeProofV1['changes'] = [
        { before: headPin,
          after: { ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId },
            revision: transition.next.version } },
        ...bumped.map((target): DecisionChangeProofV1['changes'][number] => ({
          before: { ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId: target.noteId },
            revision: target.head.version },
          after: { ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId: target.noteId },
            revision: target.head.version + 1 },
        })),
      ];
      proof = { acknowledgementRef: cardProof.acknowledgementRef, capturedPins, changes, basisRebases: [] };
      acknowledgementRef = cardProof.acknowledgementRef;
      actor = cardProof.actor;
    }
    events.push(encodeNoteDispositionChangedEvent({ ...base, eventId: deps.eventId(),
      eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, head: transition.next, version, acknowledgementRef, actor, proof }));

    const realGuards: RecordGuard[] = records.map(record => ({ refKey: record.refKey,
      expectedRevision: guards.get(record.refKey) ?? null }));
    // RW-2: a READ-ONLY guard at the read version for every decision target the
    // commit does not otherwise write. Extra guards are normal; they never
    // duplicate a written record's guard and get no commit-cursor binding.
    const extraGuardKeys = new Set<string>();
    for (const targetHead of decisionHeads.values()) {
      const refKey = noteHeadRefKey(targetHead.ref);
      if (guards.has(refKey) || extraGuardKeys.has(refKey)) continue;
      extraGuardKeys.add(refKey);
      realGuards.push({ refKey, expectedRevision: targetHead.version });
    }
    // A pointer that was read but not written (the card REJECT) must still be
    // guarded: a move between the read and the commit is `revision_conflict`.
    if (pointerKey !== null && pointer !== null) {
      const refKey = currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId: ctx.projectId,
        anchorKey: pointerKey });
      if (!guards.has(refKey)) realGuards.push({ refKey, expectedRevision: pointer.revision });
    }
    const commitCursorBindings = records
      .filter(record => record.schemaId === 'NoteHead@1' || record.schemaId === 'NoteVersion@1')
      .map(record => ({ refKey: record.refKey, field: 'since' as const }));
    const prepared: PreparedCommit = { identityKey, fingerprint, guards: realGuards, records, claims: [],
      indexGuards: [], indexChanges: [], events, commitCursorBindings };
    // KLS-2: the note files of every head this commit writes are computed on the lines before it.
    const thrown = { message: null as string | null };
    const outcome = await writeKnowledge(deps.knowledge, ctx,
      async (lines): Promise<KnowledgePrepared<NoteDispositionResult>> => {
        const plans = await noteFileWritesOf(written, lines);
        if (plans.status !== 'ready') {
          const mapped = mapStoreFailure(plans);
          return { kind: 'exit', value: { status: 'rejected', code: mapped.code, reason: mapped.reason, noteId } };
        }
        return { kind: 'ready', plans: plans.value,
          commit: knowledgeCommit(commit => deps.records.commit(commit), prepared, thrown) };
      });
    if (outcome.kind === 'exit') return outcome.value;
    if (outcome.kind === 'rejected') {
      const restored = await recheckDisposition(identityKey, fingerprint, noteId);
      if (restored !== null) return restored;
      if (thrown.message !== null) {
        return { status: 'rejected', code: 'unavailable', reason: 'the disposition commit could not be re-checked', noteId };
      }
      const mapped = mapStoreFailure(outcome.failure);
      // L8: a lost pointer CAS returns the current pointer; a failed re-read does
      // not fabricate one.
      if (mapped.code === 'revision_conflict' && pointerKey !== null && pointer !== null) {
        const current = await currentPointerRead(deps, ctx.projectId, pointerKey);
        if (current !== null) {
          return { status: 'rejected', code: mapped.code, reason: mapped.reason, noteId, pointer: pointerPayload(current)! };
        }
      }
      return { status: 'rejected', code: mapped.code, reason: mapped.reason, noteId };
    }
    const receipt = outcome.receipt;
    if (receipt.replayed) return replayDisposition(receipt, identityKey, fingerprint, noteId);
    if (outcome.files !== null && outcome.files.status !== 'ready') {
      return { status: 'rejected', code: 'unavailable', reason: knowledgeFilesNotWritten(outcome.files), noteId };
    }
    return { status: 'done', noteId, version: transition.next.version, state: transition.next.state,
      receipt: { identityKey, fingerprint, cursor: receipt.cursor } };
  }

  /**
   * §6: the live user-reason facts of the given
   * heads, computed with the ONE per-call plan cache. This is the per-head loop
   * the guard uses, exposed batched so the card source reads no head twice.
   */
  async function reasonFactsOf(call: NoteCall, ctx: CoreCallContext, heads: Iterable<NoteHeadSnapshot>):
  Promise<{ ok: true; value: Map<string, NoteUserReasonTargetV1> } | { ok: false; rejection: Rejected }> {
    const facts = new Map<string, NoteUserReasonTargetV1>();
    for (const head of heads) {
      const retired = await primaryAnchorRetiredNonFile(call, ctx, head.anchor);
      if (!retired.ok) return { ok: false, rejection: retired.rejection };
      facts.set(head.noteId, { noteId: head.noteId, version: head.version, state: head.state,
        userConfirmed: head.confirmedByUser, userWritten: head.source.kind === 'user',
        primaryAnchorRetiredNonFile: retired.value });
    }
    return { ok: true, value: facts };
  }

  /**
   * C3.2/§11.6 (lead ruling 9.2): read the live facts of every ACTUAL disposition
   * target (`replaces` minus `coexistWith`, plus `contradicts`) in ONE batched
   * read (RW-12a). A target that cannot be read makes the whole call
   * `unavailable`.
   */
  async function userReasonTargetsOf(call: NoteCall, ctx: CoreCallContext, head: NoteHeadSnapshot):
  Promise<{ ok: true; targets: Map<string, NoteUserReasonTargetV1>; heads: Map<string, NoteHeadSnapshot> }
  | { ok: false; rejection: Rejected }> {
    const ids = actualDispositionTargets(head);
    // RW-2: the heads are returned too, so `supersessionOf` guards the version
    // the decision actually read instead of re-reading a newer one.
    const heads = new Map<string, NoteHeadSnapshot>();
    if (ids.length === 0) return { ok: true, targets: new Map(), heads };
    const refKeys = ids.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId, noteId }));
    const read = await deps.records.readMany(refKeys);
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
    for (const [index, noteId] of ids.entries()) {
      const record = byKey.get(refKeys[index]!);
      if (record === undefined) {
        return { ok: false, rejection: rejected('unavailable', 'a disposition target cannot be read') };
      }
      const decoded = decodeNoteHeadSnapshot(record);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejected('unavailable', `a disposition target is damaged: ${decoded.reason}`) };
      }
      heads.set(noteId, decoded.value);
    }
    const facts = await reasonFactsOf(call, ctx, heads.values());
    if (!facts.ok) return { ok: false, rejection: facts.rejection };
    return { ok: true, targets: facts.value, heads };
  }

  /**
   * The batched, public-to-the-source form of
   * `reasonFactsOf` — ONE `NoteCall` (one plan cache) per call, no head read.
   */
  async function userReasonFacts(ctx: CoreCallContext, heads: readonly NoteHeadSnapshot[],
    planWindows: readonly NotePlanWindowFactsV1[], attempt?: DecisionSourceAttempt):
  Promise<ReadResult<Map<string, NoteUserReasonTargetV1>>> {
    // Every Goal's card source of one queue attempt shares the
    // attempt's catalog-window map; a new attempt starts empty.
    const call = newNoteCall(attempt);
    // Seed the per-call cache with the window the card source
    // already read, using the same key `planWindowOf` uses.
    for (const { goalId, window } of planWindows) {
      call.planWindows.set(`${ctx.projectId}\u0000${goalId}`, Promise.resolve(window));
    }
    const facts = await reasonFactsOf(call, ctx, heads);
    if (!facts.ok) return { status: 'rejected', code: facts.rejection.code, reason: facts.rejection.reason };
    return { status: 'ready', value: facts.value };
  }

  /**
   * The per-CALL caches. Every public entry (`writeNote`, `dispose`)
   * creates one object and threads it down; there is no module-level or
   * `ctx`-keyed cache, so a reused Run context cannot leak plan stages or scope
   * facts from an earlier call.
   */
  type PlanStagesOutcome = { ok: true; value: Map<number, readonly string[]> } | { ok: false; rejection: Rejected };
  type NoteCall = { planStages: Map<string, Promise<PlanStagesOutcome>>;
    planWindows: Map<string, Promise<GoalPlanWindow>>;
    catalogWindows: Map<string, Promise<CurrentCatalogWindow>>;
    anchorFacts?: NoteAnchorFactsDeps; scope: ScribeScopeCall };
  type AttemptCatalogWindows = Map<string, Promise<CurrentCatalogWindow>>;
  /**
   * The ONE private attempt-cache key. The map lives in the
   * queue window attempt's cache, so every Goal's card source shares the same
   * per-project catalog window, and a new attempt (new `attempt.cache`) starts
   * empty. Nothing is module-level or keyed by `ctx`.
   */
  const ATTEMPT_CATALOG_WINDOWS_KEY = 'notes.catalogWindows';
  function attemptCatalogWindowsOf(attempt: DecisionSourceAttempt): AttemptCatalogWindows {
    const cached = attempt.cache.get(ATTEMPT_CATALOG_WINDOWS_KEY);
    if (cached !== undefined) return cached as AttemptCatalogWindows;
    const created: AttemptCatalogWindows = new Map();
    attempt.cache.set(ATTEMPT_CATALOG_WINDOWS_KEY, created);
    return created;
  }
  /**
   * `attempt` is passed ONLY by `userReasonFacts` (the card-source read); every
   * write/dispose/scribe call omits it and keeps its own empty per-call caches.
   * Only the catalog map is shared — never `planWindows` or `planStages`.
   */
  function newNoteCall(attempt?: DecisionSourceAttempt): NoteCall {
    return { planStages: new Map(), planWindows: new Map(),
      catalogWindows: attempt === undefined ? new Map() : attemptCatalogWindowsOf(attempt),
      scope: newScribeScopeCall() };
  }

  /**
   * The current catalog window of one project, memoized per
   * call like `planWindowOf`, so several module/interface anchors of one note
   * call share ONE catalog read.
   */
  function catalogWindowOf(call: NoteCall, ctx: CoreCallContext): Promise<CurrentCatalogWindow> {
    const byProject = call.catalogWindows;
    const hit = byProject.get(ctx.projectId);
    if (hit !== undefined) return hit;
    const pending = readCurrentCatalogWindow(deps.records, ctx.projectId);
    byProject.set(ctx.projectId, pending);
    return pending;
  }

  /**
   * Requirement 3: the write path and the scribe/disposition
   * path use THIS per-call facts object, so anchor reads stay cached per call
   * and the visible behaviour (and error codes) never changes.
   */
  function anchorFactsOf(call: NoteCall): NoteAnchorFactsDeps {
    const cached = call.anchorFacts;
    if (cached !== undefined) return cached;
    const facts: NoteAnchorFactsDeps = { ...anchorFacts,
      catalogModuleFacts: async (ctx, moduleId) =>
        catalogModuleFactsOf(await catalogWindowOf(call, ctx), moduleId) };
    call.anchorFacts = facts;
    return facts;
  }

  /**
   * The Goal→active-Plan window of one Goal, memoized per CALL like
   * `planStages`, so several stage targets of one disposition read the window
   * once instead of once per target.
   */
  function planWindowOf(call: NoteCall, ctx: CoreCallContext, goalId: string): Promise<GoalPlanWindow> {
    const byGoal = call.planWindows;
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = byGoal.get(key);
    if (hit !== undefined) return hit;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const pending = readGoalPlanWindow(deps.records, goalRef);
    byGoal.set(key, pending);
    return pending;
  }

  /**
   * RW-5/§11.6 R4: the stage sets of one Goal's adopted PlanRevisions, read in
   * one window (the plan-revision index) and memoized per CALL, so several stage
   * targets of one disposition read the window once.
   */
  function planStagesByRevisionOf(call: NoteCall, ctx: CoreCallContext, goalId: string): Promise<PlanStagesOutcome> {
    const byGoal = call.planStages;
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = byGoal.get(key);
    if (hit !== undefined) return hit;
    const pending = (async (): Promise<PlanStagesOutcome> => {
      const revisions = new Map<number, readonly string[]>();
      let after: { order: string | number; refKey: string } | undefined;
      for (;;) {
        const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
          values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
        if (page.status !== 'ready') {
          return { ok: false, rejection: rejected('unavailable', page.reason || 'the plan revisions cannot be read') };
        }
        for (const record of page.value.records) {
          const decoded = decodePlanRevisionSnapshot(record);
          if (decoded.status === 'decoded') {
            revisions.set(decoded.value.planRevision, decoded.value.stages.map(stage => stage.stageId));
          }
        }
        if (page.value.next === null) break;
        after = page.value.next;
      }
      return { ok: true, value: revisions };
    })();
    byGoal.set(key, pending);
    return pending;
  }

  /**
   * L23 (§11.6 R4): is the target's MAIN anchor retired for a NON-file reason?
   * File retirement (deleted path, missing symbol) is a file reason and does not
   * drop a user card; goal and project anchors never retire. RW-5: a stage is
   * retired by the ONE shared `stageContinuityOf` over its own `planRevision`
   * through the current revision. A task still uses the narrow anchor reader,
   * now over the call's ONE plan window.
   */
  async function primaryAnchorRetiredNonFile(call: NoteCall, ctx: CoreCallContext, anchor: NoteAnchorV1):
  Promise<{ ok: true; value: boolean } | { ok: false; rejection: Rejected }> {
    if (anchor.kind === 'file' || anchor.kind === 'goal' || anchor.kind === 'project') {
      return { ok: true, value: false };
    }
    if (anchor.kind === 'stage') {
      const window = await planWindowOf(call, ctx, anchor.goalId);
      if (window.status === 'rejected') {
        if (window.code === 'not_found') return { ok: true, value: true };
        return { ok: false,
          rejection: rejected(window.code === 'forbidden' ? 'forbidden' : 'unavailable', window.reason) };
      }
      const currentRevision = window.plan === null ? null : window.plan.planRevision;
      const stages = await planStagesByRevisionOf(call, ctx, anchor.goalId);
      if (!stages.ok) return { ok: false, rejection: stages.rejection };
      const continuity = stageContinuityOf({ stageId: anchor.stageId, anchorRevision: anchor.planRevision,
        currentRevision, stagesByRevision: stages.value });
      return { ok: true, value: continuity.status === 'retired' };
    }
    const goalId = 'goalId' in anchor ? anchor.goalId : null;
    // This read path only needs the retired verdict, so the
    // candidate list (and its second catalog read) is not built here. This is
    // NOT the write/dispose path.
    // The task branch shares the call's ONE Goal→Plan window,
    // like the stage branch above; the hook is set ONLY here.
    const resolved = await resolveNoteAnchors(ctx,
      { main: anchor, extraAnchors: [], goalId, includeBasis: false },
      { ...anchorFactsOf(call), skipCandidates: true,
        goalPlanWindow: (windowCtx, windowGoalId) => planWindowOf(call, windowCtx, windowGoalId) });
    if (resolved.status === 'ok') return { ok: true, value: resolved.value.anchorEnded };
    if (resolved.code === 'invalid' && resolved.reason === 'anchor_not_found') return { ok: true, value: true };
    return { ok: false, rejection: rejected(resolved.code === 'forbidden' ? 'forbidden' : 'unavailable', resolved.reason) };
  }

  async function writeNote(ctx: CoreCallContext, input: WriteNoteInput): Promise<WriteNoteResult> {
    // This call owns its caches; nothing survives the return.
    const call = newNoteCall();
    // L4 step 1 / L2a class 1: the whole input shape is checked before the
    // trusted caller read, so a malformed input never reaches a read.
    const shapeProblem = writeInputProblem(input);
    if (shapeProblem !== null) return rejectedInput(input, 'invalid', shapeProblem);

    // N-12/L15/R4: the idempotent replay is resolved BEFORE the trusted caller
    // read and every admission gate. Identity is scoped to (operation, project,
    // workspace, the trusted principal, commandId); a same identity with another
    // fingerprint is `idempotency_conflict`, not `unavailable` (R2).
    const { identityKey, fingerprint } = noteCommandReceiptOf(ctx, { op: 'write', request: input });
    const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (prior.status === 'ready') return replayWrite(prior.value, input, ctx.projectId);
    if (prior.code === 'idempotency_conflict') return rejectedInput(input, 'invalid', 'idempotency_conflict');
    if (prior.code !== 'not_found') return rejectedInput(input, 'unavailable', prior.reason);

    const callerRead = await resolveCaller(ctx, input, deps);
    if (!callerRead.ok) return rejectedInput(input, callerRead.rejection.code, callerRead.rejection.reason);
    const caller = callerRead.value;
    const draft = input.note;
    // C3.1/§11.4: the project understanding is always goal-less, has no extra
    // anchors and is written by the project scribe or the user.
    const isProjectUnderstanding = draft.kind === 'understanding' && draft.anchor.kind === 'project';
    // A secretary QueryRun's range and stored goal are the round's frozen
    // effective goal (or the single Goal a live understanding command grants),
    // never `caller.goalId`; the pure scope decides both and refuses out-of-range
    // anchors here, before any anchor read.
    const scope = caller.queryRun === null ? null : secretaryNoteScope({
      kind: draft.kind,
      target: draft.kind !== 'understanding' ? null
        : draft.anchor.kind === 'goal' || draft.anchor.kind === 'stage' || draft.anchor.kind === 'project'
          ? draft.anchor.kind : null,
      anchorGoalIds: [draft.anchor, ...draft.extraAnchors].flatMap(anchor => 'goalId' in anchor ? [anchor.goalId] : []),
      mainAnchorGoalId: 'goalId' in draft.anchor ? draft.anchor.goalId : null,
      effectiveGoalId: caller.queryRun.effectiveGoalId,
      grantedGoalIds: caller.queryRun.goals.map(goal => goal.goalId),
    });
    if (scope !== null && 'ok' in scope) return rejectedInput(input, noteCodeOf(scope.code), scope.detail);
    // A secretary's stage anchor takes the version of the Plan frozen at the
    // round's preparation; a round prepared without one has no stage version.
    if (caller.queryRun !== null && caller.queryRun.planRef === null
      && [draft.anchor, ...draft.extraAnchors].some(anchor => anchor.kind === 'stage')) {
      return rejectedInput(input, 'invalid', 'a stage anchor needs the Plan frozen at the round preparation');
    }
    const storedGoalId = scope === null ? (isProjectUnderstanding ? null : caller.goalId) : scope.storedGoalId;
    // L4 step 2 / L5 authority: only an agent or a scribe stages a repair.
    const authority = noteWriteAuthority({ kind: draft.kind, isUser: caller.isUser, duty: caller.duty });
    if (authority !== null) return rejectedInput(input, noteCodeOf(authority.code), authority.detail);

    // Book §3.1 items 2 and 4: a repair's trial runs once against the catalog
    // and dependency rules its pin names; the platform's `structural` is the
    // only value written, and the caller's boolean is ignored.
    let repairPayload: RepairPayloadV1 | undefined;
    if (draft.kind === 'repair') {
      const trial = await repairTrial(deps, ctx, draft.repair);
      if (!trial.ok) return rejectedInput(input, trial.rejection.code, trial.rejection.reason);
      repairPayload = trial.payload;
    }
    const platformStructural = repairPayload === undefined ? draft.structural : repairPayload.structural;

    // L2a classes 1–2 and 4, through the narrow reader (the Run-bound plan is
    // passed so an agent's stage key keeps its bound revision). A link judges
    // duplicates by endpoint identity and stores plain file anchors; its ends,
    // key and evidence are resolved once by `checkLinkDraft` below.
    const anchorRead = await resolveNoteAnchors(ctx, { main: draft.anchor, extraAnchors: draft.extraAnchors,
      goalId: storedGoalId, facts: draft.facts, boundPlanRef: caller.planRef,
      ...(draft.kind === 'link' ? { duplicateIdentity: 'end' as const, resolveSymbols: false } : {}) },
    anchorFactsOf(call));
    if (anchorRead.status === 'rejected') {
      return rejectedInput(input, anchorRead.code, anchorRead.reason, {
        ...(anchorRead.anchorCandidates === undefined ? {} : { anchorCandidates: anchorRead.anchorCandidates }),
        ...(anchorRead.candidatesUnavailable === true ? { candidatesUnavailable: true } : {}),
        ...(anchorRead.symbolCandidates === undefined ? {} : { symbolCandidates: anchorRead.symbolCandidates }),
      });
    }
    const resolved: ResolvedNoteAnchors = anchorRead.value;
    // L2a class 3 (understanding compatibility, then own goal), after class 2's
    // existence check of every anchor. Scribes use their scope instead; the user
    // may use any goal.
    if (draft.kind === 'understanding') {
      // C3.1/§11.4: an understanding may now hang on a goal, a stage or the project.
      if (draft.anchor.kind !== 'goal' && draft.anchor.kind !== 'stage' && draft.anchor.kind !== 'project') {
        return rejectedInput(input, 'invalid', 'an understanding may only hang on a goal, a stage or the project');
      }
    }
    // C3.1/§11.4: the project understanding's writers are the project scribe
    // (manages the project scope) and the user; everyone else is refused.
    if (isProjectUnderstanding && !caller.isUser) {
      if (caller.duty !== 'scribe' || caller.sessionRef === null || deps.scopes === undefined) {
        return rejectedInput(input, 'forbidden', 'project_understanding_scribe_only');
      }
      const managesProject = await deps.scopes.manages(ctx, caller.sessionRef, { kind: 'project' }, call.scope);
      if (managesProject.status !== 'ready') {
        return rejectedInput(input, 'unavailable', managesProject.status === 'rejected'
          ? managesProject.reason : 'the project scope cannot be read');
      }
      if (!managesProject.value) return rejectedInput(input, 'forbidden', 'project_understanding_scribe_only');
    }
    if (!caller.isUser && caller.duty !== 'scribe' && storedGoalId !== null) {
      for (const draftAnchor of [draft.anchor, ...draft.extraAnchors]) {
        if ('goalId' in draftAnchor && draftAnchor.goalId !== storedGoalId) {
          return rejectedInput(input, 'forbidden', 'anchor_out_of_goal');
        }
      }
    }
    // L5/L2a class 3: a human with goalId null may use only project,
    // module, interface and file anchors; a non-null human goalId must exist.
    if (caller.isUser) {
      if (storedGoalId === null && resolved.anchors.some(anchor => anchor.kind === 'goal'
        || anchor.kind === 'stage' || anchor.kind === 'task')) {
        return rejectedInput(input, 'forbidden', 'anchor_out_of_goal');
      }
      if (storedGoalId !== null) {
        const goalRead = await deps.plans.queryGoal(ctx, { aggregateType: 'Goal', projectId: ctx.projectId,
          goalId: storedGoalId });
        if (goalRead.status === 'not_found') {
          return rejectedInput(input, 'invalid', 'the goalId names no goal in this project');
        }
        if (goalRead.status !== 'ready') {
          return rejectedInput(input, 'unavailable', goalRead.status === 'rejected'
            ? goalRead.reason : 'the goalId cannot be read');
        }
      }
    }
    // L2a class 3 (scribe scope): a region scribe may only use module-class
    // anchors inside its region; a project scribe may use every anchor.
    if (caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined) {
      const refusal = await deps.scopes.writeAdmission(ctx, caller.sessionRef, resolved.anchors, call.scope);
      if (refusal !== null) return rejectedInput(input, refusal.code, refusal.reason);
    }
    const warnings: ('symbol_unresolved' | 'anchor_ended' | 'evidence_unverifiable')[] = [];
    if (resolved.anchorEnded) warnings.push('anchor_ended');
    // L14: a symbolRequest that resolved to no unique locator keeps the
    // plain file anchor and reports the success warning exactly once.
    if (resolved.symbolUnresolved) warnings.push('symbol_unresolved');
    // L3b: a link's ends, symbol key and evidence symbols are found in their single files, its
    // references go to the second tier once, and the write-time verification is fixed here. A
    // refusal writes nothing; the resolved anchors replace the anchor step's plain file anchors.
    const requestWorkspaceId = ctx.workspaceId ?? '';
    const mainWorkspaceId = resolved.mainWorkspaceId;
    // A request path is qualified before any key, check or read: a bare path is
    // the caller's workspace, a prefixed one its own, and a main-workspace
    // prefix/alias is refused.
    const qualifyEnd = (end: NoteDraftAnchorV1): NoteDraftAnchorV1 => end.kind === 'file'
      ? { ...end, path: normalizeRequestProjectPath(requestWorkspaceId, end.path, mainWorkspaceId) } : end;
    let linkAnchors: NoteAnchorV1[] = resolved.anchors;
    let linkPayload: LinkPayloadV1 | undefined;
    if (draft.kind === 'link') {
      const window = await catalogWindowOf(call, ctx);
      if (window.status === 'rejected') return rejectedInput(input, 'unavailable', window.reason);
      let qualifiedDraft: LinkDraftV1;
      try {
        qualifiedDraft = { ...draft,
          anchor: qualifyEnd(draft.anchor),
          extraAnchors: draft.extraAnchors.map(qualifyEnd),
          link: { ...draft.link,
            ...(draft.link.key?.kind === 'symbol'
              ? { key: { ...draft.link.key,
                anchor: { ...draft.link.key.anchor,
                  path: normalizeRequestProjectPath(requestWorkspaceId, draft.link.key.anchor.path, mainWorkspaceId) } } }
              : {}),
            evidence: draft.link.evidence.map(entry => ({ ...entry,
              at: { ...entry.at, path: normalizeRequestProjectPath(requestWorkspaceId, entry.at.path, mainWorkspaceId) } })) } };
      } catch {
        return rejectedInput(input, 'invalid', 'evidence_invalid: link.evidence[0].at.path');
      }
      const checked = await checkLinkDraft(ctx, { draft: qualifiedDraft,
        anchors: resolved.anchors, catalog: window.status === 'ready' ? window : null },
      { workspace: checkedWorkspace, mainWorkspaceId });
      if (checked.status !== 'ok') return { ...checked, draft: input };
      linkAnchors = checked.anchors;
      linkPayload = checked.link;
      for (const token of checked.warnings) {
        if (!warnings.includes(token)) warnings.push(token);
      }
    }

    // Basis files (L11 write half): the platform reads each digest; too large is a refusal.
    const basisFiles: { path: string; digest: string }[] = [];
    for (const rawPath of draft.basisFiles) {
      if (typeof rawPath !== 'string') return rejectedInput(input, 'invalid', 'basis_file_missing');
      // R15/L11: a path that escapes the workspace (`../…`) is a class-1 shape
      // problem, not a transient read failure.
      if (!isSafeProjectPath(rawPath) || splitWorkspacePath(rawPath).path === '.') {
        return rejectedInput(input, 'invalid', 'basis_file_forbidden');
      }
      let path: string;
      try {
        path = normalizeRequestProjectPath(requestWorkspaceId, rawPath, mainWorkspaceId);
      } catch {
        return rejectedInput(input, 'invalid', 'basis_file_forbidden');
      }
      const basis = resolveStoredProjectPath(path, mainWorkspaceId);
      const basisCtx = { ...ctx, workspaceId: basis.workspaceId };
      const read = await checkedWorkspace.readWorkspace(basisCtx, { workspace: { aggregateType: 'Workspace',
        projectId: basisCtx.projectId, workspaceId: basis.workspaceId }, path: basis.path, maxBytes: basisFileMaxBytes,
        version: { kind: 'working_tree' } });
      if (read.status !== 'ready') {
        if (read.code === 'capacity') return rejectedInput(input, 'invalid', 'basis_file_too_large');
        if (read.code === 'not_found') return rejectedInput(input, 'invalid', 'basis_file_missing');
        if (read.code === 'forbidden') return rejectedInput(input, 'invalid', 'basis_file_forbidden');
        return rejectedInput(input, 'unavailable', read.reason);
      }
      basisFiles.push({ path, digest: read.value.digest });
    }

    // L4.3: relations must exist, share an anchor and match the kind family.
    // RW-12a/§11.7: every unique relation id is read in ONE batched `readMany`;
    // a missing or damaged head keeps the old `not_found` / `unavailable` result.
    const relations = new Map<string, NoteHeadSnapshot | null>();
    const relationIds: string[] = [];
    // A flow's steps join the SAME batch as the replaces/contradicts/coexistWith
    // ids: the relation step has one read, never a second source of truth.
    const stepIds = draft.kind === 'flow' ? draft.flow.steps.map(step => step.link) : [];
    for (const noteId of [...draft.replaces, ...draft.contradicts, ...draft.coexistWith, ...stepIds]) {
      if (noteId === '') return rejectedInput(input, 'invalid', 'a relation names an empty noteId');
      if (!relations.has(noteId)) {
        relations.set(noteId, null);
        relationIds.push(noteId);
      }
    }
    if (relationIds.length > 0) {
      const refKeys = relationIds.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead',
        projectId: ctx.projectId, noteId }));
      const read = await deps.records.readMany(refKeys);
      if (read.status !== 'ready') {
        const mapped = mapStoreFailure(read);
        return rejectedInput(input, mapped.code, mapped.reason);
      }
      const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
      for (const [index, noteId] of relationIds.entries()) {
        const record = byKey.get(refKeys[index]!);
        if (record === undefined) return rejectedInput(input, 'invalid', 'not_found');
        const decoded = decodeNoteHeadSnapshot(record);
        if (decoded.status !== 'decoded') {
          return rejectedInput(input, 'unavailable', `the note head is damaged: ${decoded.reason}`);
        }
        relations.set(noteId, decoded.value);
      }
    }
    // L2 (book :316–321): a flow's steps are current links of this project, the
    // flow's own anchor is the FIRST step's "from" and every extra anchor is one
    // of any step's ends — compared by endpoint identity over the stored raw
    // requests, never the resolved line or digest. Shape already answered the
    // step count and duplicates, so this step checks kinds, states and endpoints
    // only. The step link's payload is guaranteed by the strict decode.
    if (draft.kind === 'flow') {
      for (const step of draft.flow.steps) {
        const head = relations.get(step.link)!;
        if (head.kind !== 'link') return rejectedInput(input, 'invalid', 'flow_step_not_link');
      }
      for (const step of draft.flow.steps) {
        const head = relations.get(step.link)!;
        if (head.state !== 'accepted' && head.state !== 'reviewed') {
          return rejectedInput(input, 'invalid', 'flow_step_not_current');
        }
      }
      const anchor = draft.anchor;
      if (anchor.kind !== 'module' && anchor.kind !== 'interface' && anchor.kind !== 'file') {
        return rejectedInput(input, 'invalid', 'flow_anchor_mismatch');
      }
      // The stored steps' ends are project paths: qualify this request's file
      // anchors the same way before comparing identities.
      let qualifiedAnchor: NoteDraftAnchorV1;
      try { qualifiedAnchor = qualifyEnd(anchor); }
      catch { return rejectedInput(input, 'invalid', 'flow_anchor_mismatch'); }
      const firstLink = relations.get(draft.flow.steps[0]!.link)!.link as LinkPayloadV1;
      if (endpointIdentityOf(qualifiedAnchor as LinkEndRequestV1) !== endpointIdentityOf(firstLink.ends.from)) {
        return rejectedInput(input, 'invalid', 'flow_anchor_mismatch');
      }
      const stepEnds = new Set<string>();
      for (const step of draft.flow.steps) {
        const link = relations.get(step.link)!.link as LinkPayloadV1;
        stepEnds.add(endpointIdentityOf(link.ends.from));
        stepEnds.add(endpointIdentityOf(link.ends.to));
        if (link.ends.via !== null) stepEnds.add(endpointIdentityOf(link.ends.via));
      }
      for (const extra of draft.extraAnchors) {
        if (extra.kind !== 'module' && extra.kind !== 'interface' && extra.kind !== 'file') {
          return rejectedInput(input, 'invalid', 'flow_anchor_mismatch');
        }
        let qualifiedExtra: NoteDraftAnchorV1;
        try { qualifiedExtra = qualifyEnd(extra); }
        catch { return rejectedInput(input, 'invalid', 'flow_anchor_mismatch'); }
        if (!stepEnds.has(endpointIdentityOf(qualifiedExtra as LinkEndRequestV1))) {
          return rejectedInput(input, 'invalid', 'flow_anchor_mismatch');
        }
      }
    }
    // 120-13 丙: a region adviser (a Work Run or an exploration round alike) writes a note only with at least one
    // anchor of its own: a module of its effective region (deeper regions of other advisers already taken out), or
    // one of its goals. A project scope (the opening adviser) and a goal-only scope are not limited here; reads,
    // the two check tiers and a region that changes after the write are not judged.
    if (caller.duty === 'adviser' && caller.sessionRef !== null && deps.regionScopes !== undefined) {
      const scope = await deps.regionScopes.readEffectiveScope(ctx, { session: caller.sessionRef });
      if (scope.status !== 'ready') {
        return rejectedInput(input, 'unavailable', scope.status === 'rejected' ? scope.reason
          : 'the effective scope cannot be read');
      }
      const ownModules = new Set(scope.value.flatMap((entry) => entry.kind === 'region'
        ? entry.modules.map((module) => module.moduleId) : []));
      const regionLimited = scope.value.some((entry) => entry.kind === 'region')
        && !scope.value.some((entry) => entry.kind === 'project');
      if (regionLimited) {
        const ownGoals = scope.value.flatMap((entry) => entry.kind === 'goal' ? [entry.goalRef.goalId] : []);
        const window = await catalogWindowOf(call, ctx);
        if (window.status === 'rejected') return rejectedInput(input, 'unavailable', window.reason);
        const catalog = window.status === 'ready' ? window.catalog.catalog : null;
        // Evidence and basis files are not anchors: a link is judged by its checked ends, a flow by its steps' anchors.
        const judged: NoteAnchorV1[] = draft.kind === 'link' ? linkAnchors
          : draft.kind === 'flow' ? draft.flow.steps.flatMap((step) => {
            const head = relations.get(step.link)!;
            return [head.anchor, ...head.extraAnchors];
          })
          : resolved.anchors;
        const own = judged.some((anchor) => {
          const moduleId = moduleOfAnchor(catalog, anchor);
          return (moduleId !== null && ownModules.has(moduleId)) || ('goalId' in anchor && ownGoals.includes(anchor.goalId));
        });
        if (!own) return rejectedInput(input, 'forbidden', 'anchor_out_of_region');
      }
    }
    for (const noteId of [...draft.replaces, ...draft.contradicts, ...draft.coexistWith]) {
      const head = relations.get(noteId)!;
      if (head === null) continue;
      const shares = anchorSlots(head).some(key => resolved.keys.includes(key));
      if (!shares) return rejectedInput(input, 'invalid', 'anchor_not_found');
      if (draft.replaces.includes(noteId) && !sameKindFamily(draft.kind, head.kind)) {
        return rejectedInput(input, 'invalid', 'replaces_kind_mismatch');
      }
    }

    // L5: a scribe disposing another's current note must manage the target's
    // scope (the author disposing their own note is exempt). A
    // failed scope read is `unavailable`, never `forbidden`.
    if (caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined) {
      for (const noteId of [...draft.replaces, ...draft.contradicts]) {
        const head = relations.get(noteId);
        if (head === undefined || head === null) continue;
        if (sourceIsAuthorOf(head.source, caller.source)) continue;
        const targetScope = await deps.scopes.managingScopeOf(ctx, head, call.scope);
        if (targetScope.status !== 'ready') {
          return rejectedInput(input, 'unavailable',
            targetScope.status === 'rejected' ? targetScope.reason : 'the target scope cannot be read');
        }
        const manages = await deps.scopes.manages(ctx, caller.sessionRef, targetScope.value, call.scope);
        if (manages.status !== 'ready') {
          return rejectedInput(input, 'unavailable',
            manages.status === 'rejected' ? manages.reason : 'the managed scope cannot be read');
        }
        if (!manages.value) return rejectedInput(input, 'forbidden', 'outside_managed_scope');
      }
    }

    // L4.4: current same-topic admission. Any failed anchor read
    // refuses the write before the commit.
    const sameTopicConflicts: { noteId: string; version: number; conclusion: string }[] = [];
    const currentByAnchor = new Map<string, NoteHeadSnapshot[]>();
    for (const key of resolved.keys) {
      if (key === null) continue;
      const page = await headsByAnchorKey(deps.records, ctx.projectId, key);
      if (!page.ok) return rejectedInput(input, page.code, page.reason);
      const heads = page.value.filter(head => head.state === 'accepted' || head.state === 'reviewed');
      currentByAnchor.set(key, heads);
    }
    const topicKey = topicKeyOf(draft.topic);
    for (const heads of currentByAnchor.values()) {
      for (const head of heads) {
        if (head.topicKey !== topicKey || head.noteId === undefined) continue;
        const declared = draft.contradicts.includes(head.noteId) || draft.replaces.includes(head.noteId)
          || draft.coexistWith.includes(head.noteId);
        if (!declared) sameTopicConflicts.push({ noteId: head.noteId, version: head.version, conclusion: head.conclusion });
      }
    }
    if (sameTopicConflicts.length > 0) {
      return rejectedInput(input, 'invalid', 'same_topic_unresolved', { conflicts: sameTopicConflicts });
    }

    // L8: the pointer CAS is read before the projection because, for an
    // understanding, the note the pointer leaves is superseded by this write and
    // is therefore subtracted from the projected counts. The pointer CAS
    // is required for every understanding write and moved only on accept.
    const isUnderstanding = draft.kind === 'understanding';
    const pointerKey = isUnderstanding ? resolved.keys[0] : null;
    let pointerRead: PointerRead | null = null;
    if (pointerKey !== null) {
      const current = await currentPointerRead(deps, ctx.projectId, pointerKey);
      if (current === null) return rejectedInput(input, 'unavailable', 'the current pointer cannot be read');
      pointerRead = current;
      if (input.expectedPointerRevision !== current.revision) {
        return rejectedInput(input, 'revision_conflict', 'the current-understanding pointer moved',
          { pointer: pointerPayload(current)! });
      }
    } else if (input.expectedPointerRevision !== null && input.expectedPointerRevision !== undefined) {
      return rejectedInput(input, 'invalid', 'expectedPointerRevision is only for an understanding write');
    }

    // The pointer target is not in `relations` unless it is also a declared
    // replaces target; read it once so the projection sees it.
    let pointerTargetHead: NoteHeadSnapshot | null = null;
    if (isUnderstanding && pointerRead !== null && pointerRead.noteId !== null) {
      const preread = relations.get(pointerRead.noteId);
      if (preread !== undefined && preread !== null) pointerTargetHead = preread;
      else {
        const read = await readHead(deps, ctx.projectId, pointerRead.noteId);
        if (!read.ok) return rejectedInput(input, read.rejection.code, read.rejection.reason);
        pointerTargetHead = read.head;
      }
    }

    // L7: the projected counts subtract the current items this write would
    // replace, by the same target rule as supersession.
    const replacedCurrent = new Map<string, NoteHeadSnapshot>();
    for (const noteId of supersessionTargetsOf({ noteId: '', kind: draft.kind, replaces: draft.replaces,
      coexistWith: draft.coexistWith }, pointerRead?.noteId ?? null)) {
      let head: NoteHeadSnapshot | null | undefined = relations.get(noteId);
      if (head === undefined && noteId === pointerRead?.noteId) head = pointerTargetHead;
      if (head !== undefined && head !== null && (head.state === 'accepted' || head.state === 'reviewed')) {
        replacedCurrent.set(noteId, head);
      }
    }
    // C3.3/§11.6: a `replaces` target that is the same author's own pending note
    // is withdrawn in the SAME commit (`revised_while_pending`), so only one
    // pending note is left. It is subtracted from the projections below because
    // the goal quota counts pending notes.
    const revisedPending = new Map<string, NoteHeadSnapshot>();
    for (const noteId of draft.replaces) {
      const target = relations.get(noteId);
      if (target !== undefined && target !== null && target.state === 'pending_review'
        && sourceIsAuthorOf(target.source, caller.source)) revisedPending.set(noteId, target);
    }
    // L7/R6: the general anchor quota gates only general-kind items; a link has
    // its own anchor population (accepted+reviewed links per key, 30). The goal
    // quota counts every kind for the general population and link+flow for the
    // link population (300).
    const anchorFull = isGeneral(draft.kind)
      ? [...resolved.keys].some(key => {
        if (key === null) return false;
        const heads = currentByAnchor.get(key) ?? [];
        const count = heads.filter(head => isGeneral(head.kind) && !replacedCurrent.has(head.noteId)).length;
        return count >= anchorQuota;
      })
      : draft.kind === 'link' && [...resolved.keys].some(key => {
        if (key === null) return false;
        const heads = currentByAnchor.get(key) ?? [];
        const count = heads.filter(head => head.kind === 'link' && !replacedCurrent.has(head.noteId)).length;
        return count >= anchorLinkQuota;
      });
    // The goal's counted heads (deduped across the four counted states) are read
    // once: `goalFull` is the admission projection; the committed count below
    // subtracts only what this commit actually supersedes.
    const goalHeads: NoteHeadSnapshot[] = [];
    if (storedGoalId !== null) {
      const seen = new Set<string>();
      for (const state of ['accepted', 'reviewed', 'pending_review', 'staged'] as const) {
        const page = await headsByGoalState(deps, ctx.projectId, storedGoalId, state);
        if (!page.ok) return rejectedInput(input, page.code, page.reason);
        for (const head of page.heads) {
          if (seen.has(head.noteId)) continue;
          seen.add(head.noteId);
          goalHeads.push(head);
        }
      }
    }
    // The goal 200 counts every kind except link/flow; link and flow are the
    // separate `goalLinkQuota` (300) population, so a link/flow head never
    // enters the general count and a new link/flow does not increment it.
    const outsideGeneralGoal = (kind: string): boolean => kind === 'link' || kind === 'flow';
    const goalFullGeneral = !outsideGeneralGoal(draft.kind) && goalHeads.filter(head =>
      !outsideGeneralGoal(head.kind) && !replacedCurrent.has(head.noteId)
      && !revisedPending.has(head.noteId)).length >= goalQuota;
    const goalFullLink = (draft.kind === 'link' || draft.kind === 'flow') && goalHeads.filter(head =>
      (head.kind === 'link' || head.kind === 'flow') && !replacedCurrent.has(head.noteId)
      && !revisedPending.has(head.noteId)).length >= goalLinkQuota;
    // F1's soft project-flow quota: the current (accepted + reviewed) flows of
    // the project, deduped by noteId. It never refuses a write; it joins the
    // same `goalFull` admission fact (a non-human write then goes pending) and
    // feeds the committed receipt below. Like the goal counts, admission
    // subtracts the current flows this write replaces; a read failure is the
    // existing mapped rejection.
    let projectFlowCount = 0;
    let projectFlowFull = false;
    if (draft.kind === 'flow') {
      const seenFlows = new Set<string>();
      for (const state of ['accepted', 'reviewed'] as const) {
        const page = await readAllHeads(deps.records, S8E_NOTE_BY_KIND_STATE_LOOKUP, [ctx.projectId, 'flow', state]);
        if (!page.ok) return rejectedInput(input, page.code, page.reason);
        for (const head of page.heads) {
          if (seenFlows.has(head.noteId)) continue;
          seenFlows.add(head.noteId);
          projectFlowCount += 1;
        }
      }
      projectFlowFull = projectFlowCount
        - [...replacedCurrent.values()].filter(head => head.kind === 'flow').length >= projectFlowQuota;
    }
    const goalFull = goalFullGeneral || goalFullLink || projectFlowFull;

    // C3.3: `contradiction` is recorded only when a contradicted target is
    // accepted/reviewed at write (D-04); `user_note_replaced` only when the
    // superseded set holds a current user-confirmed note (understandings excepted, D-06/D-16).
    const liveContradicts = draft.contradicts.filter(noteId => {
      const target = relations.get(noteId);
      return target !== undefined && target !== null
        && (target.state === 'accepted' || target.state === 'reviewed');
    });
    const userNoteReplaced = draft.kind !== 'understanding'
      && [...replacedCurrent.values()].some(target => target.confirmedByUser);
    const admission = admitNoteWrite({ kind: draft.kind, structural: platformStructural,
      contradicts: liveContradicts, userNoteReplaced, anchorFull, goalFull, isUser: caller.isUser });

    // L7/R6: the returned and replay-stored `overQuota` is the COMMITTED
    // population, so it always equals `readNote(noteId).overQuota` right after the
    // commit. The new item counts in the state it lands in; only the targets this
    // commit actually supersedes (an `accepted` commit) stop counting — a note
    // that ends `pending_review` or `staged` supersedes nothing yet.
    const supersedesNow = admission.state === 'accepted';
    let committedOverQuota = false;
    if (isGeneral(draft.kind) && supersedesNow) {
      committedOverQuota = [...resolved.keys].some(key => {
        if (key === null) return false;
        const heads = currentByAnchor.get(key) ?? [];
        const count = heads.filter(head => isGeneral(head.kind) && !replacedCurrent.has(head.noteId)).length;
        return count + 1 > anchorQuota;
      });
    }
    if (draft.kind === 'link' && supersedesNow) {
      committedOverQuota = committedOverQuota || [...resolved.keys].some(key => {
        if (key === null) return false;
        const heads = currentByAnchor.get(key) ?? [];
        const count = heads.filter(head => head.kind === 'link' && !replacedCurrent.has(head.noteId)).length;
        return count + 1 > anchorLinkQuota;
      });
    }
    if (storedGoalId !== null) {
      const counted = goalHeads.filter(head => !(supersedesNow && replacedCurrent.has(head.noteId))
        && !revisedPending.has(head.noteId));
      if (!outsideGeneralGoal(draft.kind)
        && counted.filter(head => !outsideGeneralGoal(head.kind)).length + 1 > goalQuota) {
        committedOverQuota = true;
      }
      if ((draft.kind === 'link' || draft.kind === 'flow')
        && counted.filter(head => head.kind === 'link' || head.kind === 'flow').length + 1 > goalLinkQuota) {
        committedOverQuota = true;
      }
    }
    if (draft.kind === 'flow' && supersedesNow && projectFlowCount
      - [...replacedCurrent.values()].filter(head => head.kind === 'flow').length
      + 1 > projectFlowQuota) {
      committedOverQuota = true;
    }

    // The write stores a project path: a bare fact path is the caller's
    // workspace, a prefixed one names its own. The read side resolves the same
    // stored path back to a workspace before it reads the digest.
    const qualifiedFacts: NoteFactV1[] = [];
    for (const fact of draft.facts) {
      if (fact.kind !== 'file') { qualifiedFacts.push(fact); continue; }
      try {
        qualifiedFacts.push({ ...fact, path: normalizeRequestProjectPath(requestWorkspaceId, fact.path, mainWorkspaceId) });
      } catch {
        return rejectedInput(input, 'invalid', 'a file fact path must be a safe project path');
      }
    }
    const noteId = deps.newId();
    const now = deps.now();
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);
    const head = newNoteHeadRecord({
      ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId }, noteId,
      body: {
        kind: draft.kind, topic: draft.topic, topicKey, conclusion: draft.conclusion,
        body: draft.kind === 'understanding' ? renderUnderstandingBody(draft.sections) : draft.body,
        ...(draft.kind === 'understanding' ? { sections: draft.sections } : {}),
        anchor: linkAnchors[0]!, extraAnchors: linkAnchors.slice(1), facts: qualifiedFacts,
        basis: { planRevision: resolved.basisPlanRevision,
          catalogRevision: resolved.basisCatalogRevision, files: basisFiles },
        structural: platformStructural, replaces: [...draft.replaces], contradicts: [...draft.contradicts],
        coexistWith: [...draft.coexistWith],
        ...(repairPayload === undefined ? {} : { repair: repairPayload }),
        ...(linkPayload === undefined ? {} : { link: linkPayload }),
        ...(draft.kind === 'flow' ? { flow: draft.flow } : {}),
      },
      state: admission.state, goalId: storedGoalId, source: caller.source,
      stagedRunKey: caller.source.kind === 'agent' && draft.kind === 'repair' && caller.source.runRef !== null
        ? `${caller.source.runRef.goalId}/${caller.source.runRef.runId}` : null,
      reviewReasons: admission.reviewReasons, confirmedByUser: admission.confirmedByUser,
      anchorKeys: resolved.keys, createdAt: now, since: null,
    });
    const version1 = newNoteVersionRecord(head, { kind: 'write', by: caller.source, reason: null,
      decisionMessageRef: null }, now, noticeClassOf({
      change: { kind: 'write', by: caller.source, reason: null, decisionMessageRef: null },
      state: head.state, kind: head.kind, structural: head.structural,
      userAffected: admission.state === 'accepted'
        && [...replacedCurrent.values()].some(target => target.confirmedByUser || target.source.kind === 'user'),
    }));

    const records: EncodedRecord[] = [encodeNoteHeadSnapshot(head), encodeNoteVersionSnapshot(version1)];
    const guards = new Map<string, number | null>([[encodeNoteHeadSnapshot(head).refKey, null],
      [encodeNoteVersionSnapshot(version1).refKey, null]]);
    const events: EncodedDomainEvent[] = [];

    // R4: the FULL success result is computed BEFORE the commit —
    // `existingTopics` from the already-read `currentByAnchor` minus the heads
    // this commit supersedes (the projected post-commit state, L7) — and stored
    // verbatim in the NoteWritten event, so a replay never rebuilds it.
    const successResult: Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }> = {
      status: admission.status, noteId, version: head.version, reasons: [...admission.reviewReasons],
      overQuota: committedOverQuota, confirmedByUser: admission.confirmedByUser, warnings,
      ...(resolved.symbolProblems.length === 0 ? {} : { symbolProblems: resolved.symbolProblems }),
      existingTopics: existingTopicsOf(currentByAnchor,
        admission.state === 'accepted' ? new Set(replacedCurrent.keys()) : new Set(), topicKey),
    };

    // L6/S4-NOTE-05/08: an accepted write supersedes its current `replaces`
    // targets AND, for an understanding, the note the pointer leaves — in one
    // pass, so a target in both sets is bumped exactly once.
    const written: PendingNoteHeadSnapshot[] = [head];
    if (admission.state === 'accepted') {
      const supersession = await supersessionOf(ctx, head, caller.source, relations, pointerKey, pointerRead, now);
      if (!supersession.ok) return rejectedInput(input, supersession.rejection.code, supersession.rejection.reason);
      written.push(...supersession.heads);
      records.push(...supersession.records);
      for (const [refKey, revision] of supersession.guards) guards.set(refKey, revision);
      events.push(...supersession.events);
    }

    // C3.3/D-08/§11.6: withdraw the same author's pending `replaces` target(s)
    // in this SAME commit, reason `revised_while_pending`; one pending note is left.
    for (const pendingHead of revisedPending.values()) {
      const withdrawal = transitionNote(pendingHead, { kind: 'withdraw' });
      if (!withdrawal.ok) return rejectedInput(input, noteCodeOf(withdrawal.code), withdrawal.detail);
      const withdrawnHead = withdrawal.next;
      const withdrawnVersion = newNoteVersionRecord(withdrawnHead, { kind: 'withdraw', by: caller.source,
        reason: 'revised_while_pending', decisionMessageRef: null }, now, null);
      records.push(encodeNoteHeadSnapshot(withdrawnHead), encodeNoteVersionSnapshot(withdrawnVersion));
      written.push(withdrawnHead);
      guards.set(encodeNoteHeadSnapshot(withdrawnHead).refKey, pendingHead.version);
      guards.set(encodeNoteVersionSnapshot(withdrawnVersion).refKey, null);
      events.push(encodeNoteDispositionChangedEvent({ ...base, eventId: deps.eventId(),
        eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, head: withdrawnHead, version: withdrawnVersion,
        acknowledgementRef: null, actor: null, proof: null }));
    }

    // P9/R4: the new note's NoteWritten is the LAST event of a write commit and
    // carries the success result.
    events.push(encodeNoteWrittenEvent({ ...base, eventId: deps.eventId(),
      eventType: NOTE_WRITTEN_EVENT_TYPE, head, version: version1, result: successResult }));

    // Replace the placeholder guards with the real CAS revisions.
    const realGuards: RecordGuard[] = records.map(record => {
      const expected = guards.get(record.refKey);
      return { refKey: record.refKey, expectedRevision: expected === undefined ? null : expected };
    });

    const commitCursorBindings = records
      .filter(record => record.schemaId === 'NoteHead@1' || record.schemaId === 'NoteVersion@1')
      .map(record => ({ refKey: record.refKey, field: 'since' as const }));

    if (ctx.signal?.aborted) return rejectedInput(input, 'unavailable', 'the write was cancelled');
    const prepared: PreparedCommit = { identityKey, fingerprint, guards: realGuards, records, claims: [],
      indexGuards: [], indexChanges: [], events, commitCursorBindings };
    // KLS-2: the note files of every head this commit writes are computed on the lines before it.
    const thrown = { message: null as string | null };
    const outcome = await writeKnowledge(deps.knowledge, ctx, async (lines): Promise<KnowledgePrepared<WriteNoteResult>> => {
      const plans = await noteFileWritesOf(written, lines);
      if (plans.status !== 'ready') {
        const mapped = mapStoreFailure(plans);
        return { kind: 'exit', value: rejectedInput(input, mapped.code, mapped.reason) };
      }
      return { kind: 'ready', plans: plans.value,
        commit: knowledgeCommit(commit => deps.records.commit(commit), prepared, thrown) };
    });
    if (outcome.kind === 'exit') return outcome.value;
    if (outcome.kind === 'rejected') {
      // The mailbox pattern: a thrown or refused commit is re-checked by identity only.
      const restored = await recheckWrite(identityKey, fingerprint, input, ctx.projectId);
      if (restored !== null) return restored;
      if (thrown.message !== null) return rejectedInput(input, 'unavailable', 'the write commit could not be re-checked');
      const mapped = mapStoreFailure(outcome.failure);
      // L8: a lost pointer CAS comes back with the pointer it lost to. A failed
      // re-read returns the conflict WITHOUT a fabricated pointer.
      if (mapped.code === 'revision_conflict' && isUnderstanding && pointerKey !== null) {
        const current = await currentPointerRead(deps, ctx.projectId, pointerKey);
        if (current !== null) return rejectedInput(input, mapped.code, mapped.reason, { pointer: pointerPayload(current)! });
      }
      return rejectedInput(input, mapped.code, mapped.reason);
    }
    // Never fall through to the freshly minted noteId: a replayed receipt is
    // answered ONLY from its recorded event.
    if (outcome.receipt.replayed) return replayWrite(outcome.receipt, input, ctx.projectId);
    if (outcome.files !== null && outcome.files.status !== 'ready') {
      return rejectedInput(input, 'unavailable', knowledgeFilesNotWritten(outcome.files));
    }
    return successResult;
  }

  // ------------------------------------------------------------------------
  // Dispositions (L6): review, accept, reject, withdraw
  // ------------------------------------------------------------------------

  async function dispose(ctx: CoreCallContext, commandId: string, noteId: string, expectedVersion: number,
    eventKind: 'review' | 'accept' | 'reject' | 'withdraw', reason: string | null,
    expectedPointerRevision?: number | null,
    resolution?: 'supersede' | 'coexist',
    cardProof?: CardProofInput | null): Promise<NoteDispositionResult> {
    // This call owns its caches; nothing survives the return.
    const call = newNoteCall();
    // R4/d7: the disposition replay is resolved BEFORE `resolveCaller`, the head
    // read, the scope check, the version check and the transition, and returns
    // the ORIGINAL receipt from the recorded event.
    const built: RecordNoteRequestV1 = eventKind === 'withdraw'
      ? { op: 'withdraw', request: { commandId, noteId, expectedVersion, reason } }
      : { op: 'review', request: { commandId, noteId, expectedVersion,
          expectedPointerRevision: expectedPointerRevision ?? null, verdict: eventKind,
          ...(resolution === undefined ? {} : { resolution }), reason } };
    const { identityKey, fingerprint } = noteCommandReceiptOf(ctx, built);
    const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (prior.status === 'ready') return replayDisposition(prior.value, identityKey, fingerprint, noteId);
    if (prior.code === 'idempotency_conflict') {
      return { status: 'rejected', code: 'invalid', reason: 'idempotency_conflict', noteId };
    }
    if (prior.code !== 'not_found') return { status: 'rejected', code: 'unavailable', reason: prior.reason, noteId };

    const callerRead = await resolveCaller(ctx, { commandId, note: {} as never, expectedPointerRevision: null, goalId: null }, deps);
    if (!callerRead.ok) return { status: 'rejected', code: callerRead.rejection.code, reason: callerRead.rejection.reason, noteId };
    const caller = callerRead.value;
    const read = await readHead(deps, ctx.projectId, noteId);
    if (!read.ok) return { status: 'rejected', code: read.rejection.code, reason: read.rejection.reason, noteId };
    if (read.head === null) return { status: 'rejected', code: 'not_found', reason: 'the note does not exist', noteId };
    const head = read.head;
    // L6: the author is the note's `source.sessionRef`, not the Run; a
    // later Run of the same Session may withdraw it (slice 7 owns real handover).
    const sameAuthor = sourceIsAuthorOf(head.source, caller.source);
    if (!caller.isUser && caller.duty !== 'scribe' && !(eventKind === 'withdraw' && sameAuthor)) {
      return { status: 'rejected', code: 'forbidden', reason: 'only a scribe, the author or the user may change a disposition', noteId };
    }
    // L5/L6: a scribe may only disposition a note managed by its own scope.
    // Withdrawing one's own note stays exempt (the other dispositions do not).
    // A failed scope read is `unavailable`, never `forbidden`.
    const authorWithdraw = eventKind === 'withdraw' && sameAuthor;
    // C3.5/D-07 (§11.1): a scribe cannot withdraw a user-confirmed note
    // unless the scribe is its author; the author and the user keep that right.
    if (eventKind === 'withdraw' && !caller.isUser && caller.duty === 'scribe' && !authorWithdraw
      && head.confirmedByUser) {
      return { status: 'rejected', code: 'forbidden', reason: 'user_confirmed', noteId };
    }
    // RW-8/§11.6: `resolution` is only applicable to `verdict: 'accept'`. A
    // review or reject carrying one is refused BEFORE the scribe's scope check
    // (`managingScopeOf` reads the relation targets) and before any other
    // relation/target read, so no relation read can decide this error.
    if ((eventKind === 'review' || eventKind === 'reject') && resolution !== undefined) {
      return { status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable', noteId };
    }
    if (!caller.isUser && caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined
      && !authorWithdraw) {
      const targetScope = await deps.scopes.managingScopeOf(ctx, head, call.scope);
      if (targetScope.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable',
          reason: targetScope.status === 'rejected' ? targetScope.reason : 'the target scope cannot be read', noteId };
      }
      const manages = await deps.scopes.manages(ctx, caller.sessionRef, targetScope.value, call.scope);
      if (manages.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable',
          reason: manages.status === 'rejected' ? manages.reason : 'the managed scope cannot be read', noteId };
      }
      if (!manages.value) return { status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope', noteId };
    }
    if (head.version !== expectedVersion) {
      return { status: 'rejected', code: 'revision_conflict', reason: 'the note head moved', noteId };
    }
    const by: 'scribe' | 'user' = caller.isUser ? 'user' : 'scribe';
    // C3.2/§11.6: the machine guard reads the LIVE user-reason set, computed from
    // the ACTUAL disposition targets (`replaces` minus `coexistWith`, plus
    // `contradicts`) and their live facts — never the stored `reviewReasons`.
    let userReasons: NoteReviewReason[] = [];
    let contradictedTargets: string[] = [];
    // RW-2: the exact heads the decision read, so the commit guards the version
    // the decision was made on.
    let decisionHeads = new Map<string, NoteHeadSnapshot>();
    if (eventKind === 'accept' || eventKind === 'reject') {
      const factsRead = await userReasonTargetsOf(call, ctx, head);
      if (!factsRead.ok) {
        return { status: 'rejected', code: factsRead.rejection.code, reason: factsRead.rejection.reason, noteId };
      }
      decisionHeads = factsRead.heads;
      userReasons = userReasonsOf(head, [...factsRead.targets.values()]);
      const liveTarget = (targetNoteId: string): boolean => {
        const target = factsRead.targets.get(targetNoteId);
        return target !== undefined && (target.state === 'accepted' || target.state === 'reviewed')
          && !target.primaryAnchorRetiredNonFile;
      };
      contradictedTargets = head.contradicts.filter(liveTarget);
    }
    // C3.5/§11.6: a live contradiction with no user reason forces the scribe to
    // give a resolution; giving one in any other case is not applicable.
    if (eventKind === 'accept') {
      const resolutionRequired = contradictedTargets.length > 0 && userReasons.length === 0;
      if (resolutionRequired && resolution === undefined) {
        return { status: 'rejected', code: 'invalid', reason: 'resolution_required', noteId };
      }
      if (!resolutionRequired && resolution !== undefined) {
        return { status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable', noteId };
      }
    }
    const event: NoteDispositionEventV1 = eventKind === 'review' ? { kind: 'review', by }
      : eventKind === 'withdraw' ? { kind: 'withdraw' }
        : { kind: eventKind, by, reasons: userReasons, reason,
            ...(eventKind === 'accept' && resolution !== undefined
              ? { resolution, targets: contradictedTargets } : {}) };
    const transition = transitionNote(head, event);
    if (!transition.ok) return { status: 'rejected', code: noteCodeOf(transition.code), reason: transition.detail, noteId };

    return finishDisposition(ctx, {
      identityKey, fingerprint, noteId, head, caller, transition, decisionHeads,
      readPointer: 'accept', expectedPointerRevision: expectedPointerRevision ?? null,
      change: { kind: eventKind, by: caller.source, reason, decisionMessageRef: null },
      cardProof: cardProof ?? null,
    });
  }

  // ------------------------------------------------------------------------
  // §2: the note card's application (the answering user)
  // ------------------------------------------------------------------------

  /**
   * The card-mode disposition entry. It shares the ONE disposition core with
   * `dispose` (`transitionNote`, `supersessionOf`, the pointer CAS and the
   * commit/replay path) but differs exactly as the book says: the authority is
   * the answering user from the trusted `ctx` (`by: 'user'`), the guard is the
   * card's pins, the target set is the ACTUAL `(replaces − coexistWith) ∪
   * contradicts`, `change.decisionMessageRef`/`acknowledgementRef` are the
   * answer, and the LAST event carries the standard change proof.
   */
  async function applyNoteDecision(ctx: CoreCallContext, input: NoteDecisionApplicationInputV1):
  Promise<NoteDispositionResult> {
    const noteId = input.pin.noteId;
    const identityKey = noteCommandIdentity('review', ctx, input.commandId);
    const fingerprint = fingerprintOf({ kind: 's4-note-card-decision', projectId: ctx.projectId,
      workspaceId: ctx.workspaceId ?? null, principal: principalIdentity(ctx.principal), commandId: input.commandId,
      cardId: input.cardId, optionId: input.optionId, pin: input.pin,
      expectedPointerRevision: input.expectedPointerRevision, answerMessageRef: input.answerMessageRef,
      conditions: input.conditions });
    const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (prior.status === 'ready') return replayDisposition(prior.value, identityKey, fingerprint, noteId);
    if (prior.code === 'idempotency_conflict') {
      return { status: 'rejected', code: 'invalid', reason: 'idempotency_conflict', noteId };
    }
    if (prior.code !== 'not_found') return { status: 'rejected', code: 'unavailable', reason: prior.reason, noteId };

    // The authority is the trusted host human, never a parameter.
    const callerRead = await resolveCaller(ctx,
      { commandId: input.commandId, note: {} as never, expectedPointerRevision: null, goalId: null }, deps);
    if (!callerRead.ok) {
      return { status: 'rejected', code: callerRead.rejection.code, reason: callerRead.rejection.reason, noteId };
    }
    const caller = callerRead.value;
    if (!caller.isUser) {
      return { status: 'rejected', code: 'forbidden',
        reason: 'only the answering user may apply a note decision', noteId };
    }
    const callerActor: ActorRef | null = ctx.principal.kind === 'host' ? ctx.principal.actor : null;

    const read = await readHead(deps, ctx.projectId, noteId);
    if (!read.ok) return { status: 'rejected', code: read.rejection.code, reason: read.rejection.reason, noteId };
    if (read.head === null) return { status: 'rejected', code: 'not_found', reason: 'the note does not exist', noteId };
    const head = read.head;
    // Guard 1: the card's head pin (moved -> the existing revision_conflict).
    if (head.version !== input.pin.version) {
      return { status: 'rejected', code: 'revision_conflict', reason: 'the note head moved', noteId };
    }
    const call = newNoteCall();
    // The live user-reason set and the ACTUAL target heads (one batched read).
    const factsRead = await userReasonTargetsOf(call, ctx, head);
    if (!factsRead.ok) {
      return { status: 'rejected', code: factsRead.rejection.code, reason: factsRead.rejection.reason, noteId };
    }
    const decisionHeads = factsRead.heads;
    const userReasons = userReasonsOf(head, [...factsRead.targets.values()]);
    const mayResolve = userReasons.includes('contradiction') || userReasons.includes('user_note_replaced');
    if ((input.optionId === 'supersede' || input.optionId === 'coexist') && !mayResolve) {
      return { status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable', noteId };
    }
    const actualTargets = actualDispositionTargets(head);
    const trimmed = (input.conditions ?? '').trim();
    const resolvedReason = trimmed.length > 0 ? trimmed : `决定卡：${input.optionId}`;

    const event: NoteDispositionEventV1 = input.optionId === 'reject'
      ? { kind: 'reject', by: 'user', reasons: userReasons, reason: resolvedReason }
      : input.optionId === 'accept'
        ? { kind: 'accept', by: 'user', reasons: userReasons, reason: resolvedReason }
        : { kind: 'accept', by: 'user', reasons: userReasons, reason: resolvedReason,
            resolution: input.optionId, targets: actualTargets };
    const transition = transitionNote(head, event);
    if (!transition.ok) return { status: 'rejected', code: noteCodeOf(transition.code), reason: transition.detail, noteId };

    return finishDisposition(ctx, {
      identityKey, fingerprint, noteId, head, caller, transition, decisionHeads,
      readPointer: 'always', expectedPointerRevision: input.expectedPointerRevision,
      change: { kind: input.optionId === 'reject' ? 'reject' : 'accept', by: caller.source,
        reason: resolvedReason, decisionMessageRef: input.answerMessageRef },
      cardProof: { acknowledgementRef: input.answerMessageRef, actor: callerActor },
    });
  }

  /**
   * The composition root's `repair_approval` reject: it shares `dispose` and the
   * one `finishDisposition` tail with every other disposition, so the replay,
   * caller, guard and commit rules are the same. The card proof is supplied by
   * this caller, never by an ordinary `notes/withdraw` request.
   */
  async function applyRepairRejection(ctx: CoreCallContext, input: {
    commandId: string; noteId: string; expectedVersion: number;
    answerMessageRef: SessionMessageRef; actor: ActorRef | null;
  }): Promise<NoteDispositionResult> {
    return dispose(ctx, input.commandId, input.noteId, input.expectedVersion, 'withdraw',
      'rejected_by_user', undefined, undefined,
      { acknowledgementRef: input.answerMessageRef, actor: input.actor });
  }

  /**
   * L4 / decision 72 (U1): the read-only committed-receipt lookup for
   * `record_note`. It rebuilds the request `recordNoteRequestOf` builds for the
   * tool handler and the identity/fingerprint pair `writeNote`/`dispose` commit,
   * from the original Run's trusted provenance; it never writes and never reads
   * a business fact beyond the idempotency row.
   */
  async function lookupToolCommit(ctx: CoreCallContext, input: ToolCommitLookupInput): Promise<ToolCommitLookupResult> {
    void ctx;
    if (input.toolName !== 'record_note') return toolCommitLookupUnknownTool(input.toolName);
    const raw = input.arguments;
    if (!isRecord(raw)) return { status: 'undetermined', reason: 'invalid_arguments' };
    let identityKey: string;
    let fingerprint: string;
    try {
      const built = recordNoteRequestOf(raw as unknown as RecordNoteArgs, toolCommitRequestId(input));
      const origin = input.origin;
      const rebuilt = {
        projectId: origin.runRef.projectId,
        workspaceId: origin.workspaceId,
        principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId: origin.runRef.projectId,
          goalId: origin.runRef.goalId, runId: origin.runRef.runId } },
      } as unknown as CoreCallContext;
      ({ identityKey, fingerprint } = noteCommandReceiptOf(rebuilt, built));
    } catch {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
    let lookup: Awaited<ReturnType<NoteServiceDependencies['records']['lookupCommit']>>;
    try {
      lookup = await deps.records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'undetermined', reason: 'the note receipt lookup failed' };
    }
    return toolCommitLookupResult(lookup);
  }

  return {
    writeNote,
    async reviewNote(ctx, input) {
      return dispose(ctx, input.commandId, input.noteId, input.expectedVersion, input.verdict, input.reason,
        input.expectedPointerRevision, input.resolution);
    },
    async withdrawNote(ctx, input) {
      return dispose(ctx, input.commandId, input.noteId, input.expectedVersion, 'withdraw', input.reason);
    },
    applyNoteDecision,
    applyRepairRejection,
    userReasonFacts,
    lookupToolCommit,
  };
}
