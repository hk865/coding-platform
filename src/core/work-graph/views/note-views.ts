/**
 * Slice 4B L22/L23: `NoteCheckPort` — the one implementation of the derived
 * per-note fields (`freshness`, `changedFiles`, `sourceUnavailable`, `invalid`,
 * `conflicting`, `overQuota`, `updateDue`, `currentEligible`, the L23 anchor
 * status, `unresolvedFacts`/`uncheckedFacts`, the L2a class-5 hints, a link's
 * read-time verification). It writes no record. Two kinds of Host memory live
 * in its closure, one per Host because the platform builds this check once: the
 * second tier's link conclusions with the doubtful and broken link registers,
 * and the single-file parse answers kept by text digest. Both only answer later
 * reads sooner and are gone on restart. A read never builds a TS program; only
 * `checkNotes` with `verifyLinks` hands doubtful links to the second tier.
 *
 * P9: every fact kind is resolved through a reader that already exists:
 * `record` pointers go through the record transaction port (a `SessionMessage`
 * through the existing message decoder), `note` pointers through the note head,
 * `file` pointers through `WorkspaceToolsPort`, `commit` by format only. The
 * note read model injects this port and never imports this file (L18).
 *
 * §9: a failed plan/catalog/Run read is NEVER a definite answer. Any non-`ready`
 * dependency read rejects the whole `checkNotes` call with `unavailable`; the
 * note read model propagates that rejection instead of returning a fresh item.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult, CoreRejection } from '../../../contracts/core/results.js';
import { okFalse } from '../../../contracts/core/rejections.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { LinkEvidenceStoredV1, LinkPayloadV1, LinkVerificationV1, NoteAnchorV1, NoteFactV1, NoteHeadSnapshot,
  NoteSectionsV1, NoteVersionSnapshot, SymbolLocatorV1 } from '../../../contracts/note.js';
import { headerExtrasOf, renderNoteHeader } from '../../../contracts/note.js';
import { bigramWindows, normalizeSearchText } from '../../record-store/lookup-index.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodeRefKey } from '../../record-store/record-codec.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { AdoptedArchitecture, ArchitectureCatalogPort, ArchitectureRevision, ModuleDefinition } from '../architecture/catalog-contracts.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { NoteCheckV1, NoteFileObservationV1, NoteHeadCheckItemV1, NoteHeadCheckPort, NoteHintV1, NoteLinkVerifyV1,
  NoteSimilarV1, NoteUpdateDueTriggerV1, UnderstandingStatusV1 } from '../model/note-contracts.js';
import { NOTE_ANCHOR_LINK_QUOTA, NOTE_ANCHOR_QUOTA, NOTE_BASIS_FILE_MAX_BYTES, NOTE_CHECK_DEADLINE_MS, NOTE_GOAL_LINK_QUOTA,
  NOTE_GOAL_QUOTA, NOTE_LINK_VERIFY_MAX, NOTE_NATIVE_READ_WAIT_MS, NOTE_PROJECT_FLOW_QUOTA, NOTE_READ_FACTS_MAX,
  NOTE_READ_FILES_MAX, NOTE_READ_PARSE_BYTES_MAX, NOTE_SIMILAR_MAX, NOTE_SIMILAR_MIN,
  NOTE_SYMBOL_RECHECK_MAX, analysedDigestsMatch } from '../model/note-contracts.js';
import { anchorKeyOf, noteCheckWorkspace, signatureDigestOf, symbolRangeText, type NoteAnchorWorkspace } from '../notes/note-anchors.js';
import { isSafeProjectPath, qualifyProjectPath, resolveStoredProjectPath, splitWorkspacePath } from '../../../contracts/workspace-path.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import { anchorSlots } from '../notes/note-related-scope.js';
import { foldInputOf, foldUpdateDue } from '../notes/note-update-due.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { ReferenceAnswerV1, ReferenceCheckResultV1, ReferenceQuestionV1, WorkspaceFile, WorkspaceResult } from '../../workspace/ports.js';
import type { NativeLookupV1 } from '../../workspace/native-single-file.js';
import { fileSyntaxOf, namesInRanges, syntaxTreeOf, type FileSyntaxV1, type LineRange, type NameUseV1, type NavItemV1,
  type SyntaxTreeV1 } from '../../workspace/single-file-syntax.js';
import { languageOfPath } from '../../workspace/architecture-language-provider.js';
import { evidenceScopeOf, literalInScope, partFieldsOf, referenceFieldsOf, relationNeedsKey, type EvidenceScopeV1 } from '../notes/link-evidence.js';
import {
  createNoteHeadDerivations, mapStoreFailure, newHeadCache,
  type HeadCache, type NoteHeadDerivations, type NoteHeadLike,
} from '../notes/note-read-model.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot, noteHeadRefKey, noteVersionRefKey,
  currentPointerRefKey, decodeCurrentPointerSnapshot,
} from '../persistence/note-record-codecs.js';
import { S2B_PLAN_REVISION_BY_GOAL_LOOKUP, decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { stageContinuityOf } from '../notes/note-continuity.js';
import { readGoalPlanWindow, readGoalTriggerRecords } from '../tasks/plan-readers.js';
import { decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeRunActivitySnapshot } from '../persistence/run-activity-codecs.js';
import { mapExecutedFilesToModules } from './goal-conflicts.js';

export type NoteCheckLimits = {
  readFilesMax?: number;
  readFactsMax?: number;
  symbolRecheckMax?: number;
  basisFileMaxBytes?: number;
  anchorQuota?: number;
  goalQuota?: number;
  /** The link populations' soft quotas (spec §2). */
  anchorLinkQuota?: number;
  goalLinkQuota?: number;
  projectFlowQuota?: number;
  /** One call's single-file parses read at most this much text in total (`NOTE_READ_PARSE_BYTES_MAX`). */
  readParseBytesMax?: number;
  /** How long an `agent` check waits for the second tier (`NOTE_CHECK_DEADLINE_MS`). */
  checkDeadlineMs?: number;
};

export type NoteCheckDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  /** The plan readers (`queryGoal`/`queryTaskGraph`) or a narrower double. */
  plans?: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  workspace?: NoteAnchorWorkspace;
  /** The project's main workspace; absent treats the caller's workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
  /** R1: the raw artifact store; an artifact fact is an existence check only. */
  artifacts?: Pick<RawArtifactStorePort, 'read'>;
  limits?: NoteCheckLimits;
};

type Reject = { ok: false; code: CoreRejection['code']; reason: string };
type Outcome<T> = { ok: true; value: T } | Reject;
type StaleReason = NoteCheckV1['anchorRetiredReasons'][number];
type UnresolvedReason = NoteCheckV1['unresolvedFacts'][number]['reason'];

/** A `ReadResult` that is not `ready` may be a bare `not_found`/`not_ready`. */
function readFailureReason(value: unknown, fallback: string): string {
  return typeof value === 'object' && value !== null && 'reason' in value && typeof (value as { reason: unknown }).reason === 'string'
    ? (value as { reason: string }).reason : fallback;
}

const COMMIT_SHA = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** R1: a `file` fact's digest must be 64 lowercase hex before any read. */
const FILE_DIGEST = /^[0-9a-f]{64}$/;
const RETIRED_NOTE_STATES: readonly NoteHeadSnapshot['state'][] = ['superseded', 'withdrawn', 'rejected'];
const RETIRED_TASK_DISPOSITIONS: readonly string[] = ['cancelled', 'superseded'];

type CheckBody = {
  noteId: string; version: number; state: NoteHeadSnapshot['state']; kind: NoteHeadSnapshot['kind'];
  topic: string; topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[];
  facts: NoteFactV1[]; basis: NoteHeadSnapshot['basis']; sections?: NoteSectionsV1; link?: LinkPayloadV1;
  source: NoteHeadSnapshot['source'];
  replaces: readonly string[]; contradicts: readonly string[]; coexistWith: readonly string[];
};

function bodyOfHead(head: NoteHeadSnapshot): CheckBody {
  return { noteId: head.noteId, version: head.version, state: head.state, kind: head.kind, topic: head.topic,
    topicKey: head.topicKey, conclusion: head.conclusion, anchor: head.anchor, extraAnchors: head.extraAnchors,
    facts: head.facts, basis: head.basis, source: head.source, replaces: head.replaces, contradicts: head.contradicts,
    coexistWith: head.coexistWith,
    ...(head.sections === undefined ? {} : { sections: head.sections }),
    ...(head.link === undefined ? {} : { link: head.link }) };
}

function bodyOfVersion(version: NoteVersionSnapshot): CheckBody {
  return { noteId: version.noteId, version: version.version, state: version.state, kind: version.kind,
    topic: version.topic, topicKey: version.topicKey, conclusion: version.conclusion, anchor: version.anchor,
    extraAnchors: version.extraAnchors, facts: version.facts, basis: version.basis, replaces: version.replaces,
    contradicts: version.contradicts, coexistWith: version.coexistWith, source: version.source,
    ...(version.sections === undefined ? {} : { sections: version.sections }),
    ...(version.link === undefined ? {} : { link: version.link }) };
}

/**
 * One path's working-tree read. `digest` hashes the raw bytes; `textDigest` hashes the decoded
 * text the read port gives (BOM removed), the basis of a symbol locator's `fileDigest` and of a
 * configuration digest. Only a path whose decoded text a locator, a link gate or a configuration
 * needs keeps `content` and `textDigest`; `sizeBytes` is the read port's raw size.
 */
type FileRead = { status: 'ready'; digest: string; textDigest: string | null; content: string | null; sizeBytes: number }
  | { status: 'missing' | 'forbidden' | 'capacity' | 'unavailable' };
type ReadyRead = Extract<FileRead, { status: 'ready' }>;

/**
 * MF3/R3: the one per-call observation budget. A path is read at most once per
 * call; the 257th distinct path in item order (and every later one) is
 * `exhausted` and reported as an `unchecked` observation, never silently skipped.
 */
type PathRead = FileRead | { status: 'exhausted' };

/** R3: one call's Python/C++ lookups; the call waits for them together at most `NOTE_NATIVE_READ_WAIT_MS`. */
type NativeReads = {
  sent: Map<string, Promise<NativeLookupV1>>;
  settled: Map<string, NativeLookupV1>;
  expired: boolean;
  deadline: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
};

type CheckBudget = {
  reads: Map<string, PathRead>;
  /** The project's main workspace, resolved once by `readPlanned`; stored paths are read by this. */
  mainWorkspaceId: string;
  factsRemaining: number;
  /** R4: distinct files the call may still parse on its own, the file anchors and the link gates together. */
  symbolRechecksRemaining: number;
  /** R4: text bytes those parses may still take; a file is charged once per call. */
  parseBytesRemaining: number;
  parsed: Set<string>;
  /** One syntax tree per file and call. */
  trees: Map<string, SyntaxTreeV1>;
  natives: NativeReads;
};

/** The per-item observations, deduplicated by path, in first-encounter order. */
type ItemObservations = Map<string, NoteFileObservationV1>;

/**
 * R2: the plan/catalog caches live for exactly one `checkNotes` call. The plan
 * key includes the project, because two projects may both have `s4a-goal`.
 * S2.3: one head cache is shared by every item of the call, seeded by the read
 * model with the anchor sets it already read.
 */
type CheckCaches = {
  plans: Map<string, Outcome<PlanRevisionSnapshot | null>>;
  /**
   * U-3 (§11.5): per goal, the trigger read, keyed `${projectId}\0${goalId}`
   * exactly as `plans`. Read once per call and reused by every item and by
   * `understandingAnchors`; a goal with no current plan caches the empty read.
   */
  triggers: Map<string, Outcome<{ triggers: NoteUpdateDueTriggerV1[];
    claimedArchiveKeys: ReadonlySet<string> }>>;
  /** U-3: the per-anchor understanding status, so a goal/stage pointer is read once. */
  understandings: Map<string, Outcome<UnderstandingStatusV1>>;
  /**
   * Pointers and pointed heads the caller already read, keyed
   * `${projectId}\0${anchorKey}` exactly as `understandings`. A seeded anchor
   * skips its own pointer and head reads.
   */
  understandingSeed: Map<string, { pointer: { noteId: string | null; revision: number | null };
    head: NoteHeadSnapshot | null }>;
  architecture: {
    current?: Outcome<ArchitectureRevision>;
    byRevision: Map<number, Outcome<ArchitectureRevision>>;
  };
  heads: HeadCache;
  /** S2.6 (b4): `conflicting`/`overQuota` per `noteId@head.version`. */
  derivations: Map<string, { conflicting: boolean; overQuota: boolean }>;
  /** S2.6 (b9): the Run task scope per Run ref. */
  runTaskScope: Map<string, Outcome<{ moduleRef: string | null }>>;
  /** S2.6 (b10): two separate caches, never one merged map. */
  planRevisions: Map<string, Outcome<Map<number, PlanRevisionSnapshot>>>;
  basisPlans: Map<string, Outcome<PlanRevisionSnapshot | null>>;
  /** S2.6: the staged repair task per staged Run key. */
  stagedRepair: Map<string, Outcome<{ goalId: string; taskId: string } | null>>;
  /** S2.6: `note` fact head reads per ref; successes only. */
  noteHeads: Map<string, Outcome<NoteHeadSnapshot | null>>;
};

function newCheckCaches(): CheckCaches {
  return { plans: new Map(), triggers: new Map(), understandings: new Map(), understandingSeed: new Map(),
    architecture: { byRevision: new Map() }, heads: newHeadCache(),
    derivations: new Map(), runTaskScope: new Map(), planRevisions: new Map(), basisPlans: new Map(),
    stagedRepair: new Map(), noteHeads: new Map() };
}

function newCheckBudget(limits: NoteCheckLimits): CheckBudget {
  return { reads: new Map(), mainWorkspaceId: '', factsRemaining: limits.readFactsMax ?? NOTE_READ_FACTS_MAX,
    symbolRechecksRemaining: limits.symbolRecheckMax ?? NOTE_SYMBOL_RECHECK_MAX,
    parseBytesRemaining: limits.readParseBytesMax ?? NOTE_READ_PARSE_BYTES_MAX, parsed: new Set(), trees: new Map(),
    natives: { sent: new Map(), settled: new Map(), expired: false, deadline: null, timer: null } };
}

type FactOutcome =
  | { kind: 'untouched' }
  | { kind: 'unchecked' }
  // R3: the fact's path is past the per-call file budget.
  | { kind: 'budget' }
  | { kind: 'unresolved'; reason: UnresolvedReason }
  | { kind: 'changed'; path: string; deleted: boolean }
  | { kind: 'source_unavailable' }
  | { kind: 'basis_note_retired' };

/** R3: a changed file's symbol locator found again in that file alone. */
type SymbolRecheck = { status: 'live' } | { status: 'changed' } | { status: 'missing' } | { status: 'unchecked' };

/** R7's second exception: the parse answers kept across calls, LRU by source bytes. */
const PARSE_ANSWERS_SOURCE_BYTES_MAX = 8 * 1024 * 1024;
type NameAnswer = { name: string; textual: boolean; uses: NameUseV1[] };
/** `names`: one answer per (ranges, name). */
type ParseAnswers = { bytes: number; items?: NavItemV1[]; syntax?: FileSyntaxV1; names: Map<string, NameAnswer> };

type StoredReason = Extract<LinkVerificationV1, { status: 'unverifiable' }>['reason'];
/**
 * One part of a link's read: an evidence's own rules (`question: null`), one evidence × one
 * definition it must reference, or a stored reason the link's shape gives. `doubt` is a reference
 * part only the second tier can decide; it always carries its question.
 */
type LinkPartStatus = 'ok' | 'broken' | 'doubt' | 'unavailable' | 'budget' | StoredReason;
type LinkPart = { evidence: number | null; question: ReferenceQuestionV1 | null; status: LinkPartStatus };
/** The first tier's parts, the raw digests of the gate files it read and its read of the stored configuration. */
type LinkRead = { parts: LinkPart[]; files: Map<string, string>; config: { path: string; digest: string } | null };
/** R7: a second-tier conclusion, valid while the version and every gate digest are as recorded. */
type LinkConclusion = { version: number; gate: { files: ReadonlyMap<string, string>; config: { path: string; digest: string } | null };
  conclusion: LinkVerificationV1 };
type LinkRegisterEntry = { projectId: string; workspaceId: string; noteId: string; version: number };
type ReferenceField = ReturnType<typeof referenceFieldsOf>[number];
type Definition = { path: string; name: string; line: number | null; locator: SymbolLocatorV1 | undefined };

const STORED_ORDER: readonly StoredReason[] = ['key_not_literal', 'language_unsupported', 'analyzer_unavailable'];
/** A plain identifier; a computed name, an index or a call/construct signature is not one. */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;
const MEMBER_PARENTS: ReadonlySet<string> = new Set(['class', 'interface', 'enum']);
const isTsPath = (path: string): boolean => languageOfPath(path) === 'typescript';

/**
 * R5's merge, 8E C6's order: any definite break is `broken` with every broken evidence index; then
 * an unreadable part (`unavailable` before `budget`); then a doubtful one (`refs_pending`); then a
 * stored reason, in the write side's order; else `verified`.
 */
function linkVerificationOfParts(parts: readonly LinkPart[]): LinkVerificationV1 {
  const missing = [...new Set(parts.flatMap(part => part.status === 'broken' && part.evidence !== null ? [part.evidence] : []))]
    .sort((left, right) => left - right);
  if (missing.length > 0) return { status: 'broken', missing };
  const has = (status: LinkPartStatus): boolean => parts.some(part => part.status === status);
  if (has('unavailable')) return { status: 'unchecked', reason: 'unavailable' };
  if (has('budget')) return { status: 'unchecked', reason: 'budget' };
  if (has('doubt')) return { status: 'unchecked', reason: 'refs_pending' };
  const stored = STORED_ORDER.find(reason => has(reason));
  return stored === undefined ? { status: 'verified' } : { status: 'unverifiable', reason: stored };
}

/** R6: a second-tier answer as a part. An answer it cannot decide is `analyzer_unavailable`; a failed one is unread. */
function answeredStatus(answer: ReferenceAnswerV1 | undefined): LinkPartStatus {
  if (answer === undefined || answer.status === 'failed') return 'unavailable';
  if (answer.status === 'found') return 'ok';
  return answer.status === 'not_found' ? 'broken' : 'analyzer_unavailable';
}

/** R7: only an answer with a definite reason is kept; `undecided` and `failed` are asked again. */
const recordableAnswer = (answer: ReferenceAnswerV1): boolean => answer.status === 'found' || answer.status === 'not_found'
  || (answer.status === 'unverifiable' && answer.reason !== 'undecided');

/** R10: a link is current only while its read is neither broken nor unchecked. */
const linkReadCurrent = (verification: LinkVerificationV1 | undefined): boolean =>
  verification === undefined || (verification.status !== 'broken' && verification.status !== 'unchecked');


/** The definition behind a reference field: its file, its stored name and name line, and its locator when written. */
function definitionOf(link: LinkPayloadV1, extraAnchors: readonly NoteAnchorV1[], field: ReferenceField): Definition | null {
  if (field === 'key') {
    const key = link.key;
    if (key?.kind !== 'symbol') return null;
    return { path: key.path, name: key.symbol?.qualifiedName ?? key.symbolRequest.name,
      line: key.symbol?.range.startLine ?? key.symbolRequest.range?.startLine ?? null, locator: key.symbol };
  }
  const end = field === 'to' ? link.ends.to : link.ends.via;
  const anchor = extraAnchors[field === 'to' ? 0 : 1];
  if (end?.kind !== 'file' || end.symbolRequest === undefined || anchor?.kind !== 'file') return null;
  return { path: anchor.path, name: anchor.symbol?.qualifiedName ?? end.symbolRequest.name,
    line: anchor.symbol?.range.startLine ?? end.symbolRequest.range?.startLine ?? null, locator: anchor.symbol };
}

/**
 * R5 rules 4–5: the single-file facts that show the evidence's range no longer references X.
 * `names` answers X's name first, then each of the evidence file's import names.
 */
function referenceGone(x: NavItemV1, definitionFile: FileSyntaxV1, evidenceFile: FileSyntaxV1,
  names: readonly NameAnswer[]): boolean {
  const own = names[0]!;
  const importsAbsent = names.slice(1).every(entry => !entry.textual);
  // Rule 4: a member is wired by its name; a top-level X by its name or an import's.
  if (x.parentKind !== null) return MEMBER_PARENTS.has(x.parentKind) && !own.textual;
  if (!own.textual) return importsAbsent;
  // Rule 5: every use is free, nothing in the evidence file binds it, and X's module file is not global.
  return definitionFile.isModule && !definitionFile.globalAugmented && own.uses.every(use => use === 'free')
    && !evidenceFile.boundNames.includes(x.name) && importsAbsent;
}

/** The Python/C++ symbol locators of one note body. */
function nativeLocatorsOf(body: CheckBody): { path: string; symbol: SymbolLocatorV1; language: 'python' | 'cpp' }[] {
  const located: { path: string; symbol: SymbolLocatorV1; language: 'python' | 'cpp' }[] = [];
  for (const anchor of [body.anchor, ...body.extraAnchors]) {
    if (anchor.kind !== 'file' || anchor.symbol === undefined) continue;
    const language = anchor.symbol.language;
    if (language === 'python' || language === 'cpp') located.push({ path: anchor.path, symbol: anchor.symbol, language });
  }
  return located;
}

/** One item's checked result, kept until the call's second tier and registers are done. */
type CheckedItem = { result: NoteCheckV1; head: NoteHeadSnapshot;
  link: { read: LinkRead | null; eligibleBase: boolean } | null };

/**
 * R3/R5: one item's single-file judgements, made for every item in item order before the call
 * waits for its Python/C++ lookups: each changed locator file's recheck by slot (`null` for a
 * Python/C++ locator, answered after the wait) and the link's read (kept conclusion or first tier).
 */
type ItemJudgement = { locators: Map<number, SymbolRecheck | null>;
  link: { verification: LinkVerificationV1; read: LinkRead | null } | null };

/**
 * R3: the locator among the same-name symbols of its changed file: several pick the stored name
 * lines; none is `missing` only after an exact parse; the signature digest is compared as written.
 */
function locatorRecheck(content: string, symbol: SymbolLocatorV1, found: readonly {
  start: { line: number; column: number }; end: { line: number; column: number } }[], exact: boolean): SymbolRecheck {
  if (found.length === 0) return exact ? { status: 'missing' } : { status: 'unchecked' };
  const chosen = found.length === 1 ? found[0]
    : found.find(item => item.start.line === symbol.range.startLine && item.end.line === symbol.range.endLine);
  if (chosen === undefined) return { status: 'unchecked' };
  const digest = signatureDigestOf(symbolRangeText(content, chosen.start, chosen.end));
  return digest === symbol.signatureDigest ? { status: 'live' } : { status: 'changed' };
}

/** L22: the bounded size of the one similar-notes anchor-lookup page. */
export const NOTE_SIMILAR_SCAN = 100;

export function createNoteCheck(deps: NoteCheckDependencies): NoteHeadCheckPort {
  const limits = deps.limits ?? {};
  const basisFileMaxBytes = limits.basisFileMaxBytes ?? NOTE_BASIS_FILE_MAX_BYTES;
  const quotas = {
    anchor: limits.anchorQuota ?? NOTE_ANCHOR_QUOTA,
    goal: limits.goalQuota ?? NOTE_GOAL_QUOTA,
    anchorLink: limits.anchorLinkQuota ?? NOTE_ANCHOR_LINK_QUOTA,
    goalLink: limits.goalLinkQuota ?? NOTE_GOAL_LINK_QUOTA,
    projectFlow: limits.projectFlowQuota ?? NOTE_PROJECT_FLOW_QUOTA,
  };
  const derivations: NoteHeadDerivations = createNoteHeadDerivations(deps.records, quotas);

  const workspaceRef = (ctx: CoreCallContext) => ({ aggregateType: 'Workspace' as const,
    projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });
  // The file reads are the platform's checks (`noteCheckWorkspace`); the caller's own goal still decides eligibility.
  const workspace = deps.workspace === undefined ? undefined : noteCheckWorkspace(deps.workspace);

  // Host memory, keyed project, workspace and note. R7: the second tier's conclusion per link (head
  // version), with the gate digests it holds for. R8: head-version links read `refs_pending` with no
  // conclusion, the Host's background batch takes them. R9: accepted/reviewed head-version links read
  // `broken`, the scribe's count. R7's second exception: the parse answers by (path, text digest).
  const linkConclusions = new Map<string, LinkConclusion>();
  const doubtful = new Map<string, LinkRegisterEntry>();
  const broken = new Map<string, LinkRegisterEntry & { heldByRun: string | null }>();
  const parseAnswers = new Map<string, ParseAnswers>();
  let parseAnswerBytes = 0;
  const linkKey = (ctx: CoreCallContext, noteId: string): string =>
    canonicalJson([ctx.projectId, ctx.workspaceId ?? '', noteId]);
  const registerEntry = (ctx: CoreCallContext, head: NoteHeadSnapshot): LinkRegisterEntry =>
    ({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '', noteId: head.noteId, version: head.version });

  async function readHead(projectId: string, noteId: string): Promise<Outcome<NoteHeadSnapshot | null>> {
    const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return okFalse(read.code === 'not_found' ? 'not_found' : 'unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return { ok: true, value: null };
    const decoded = decodeNoteHeadSnapshot(record);
    if (decoded.status !== 'decoded') return okFalse('unavailable', 'damaged note head');
    return { ok: true, value: decoded.value };
  }

  /**
   * S2.6: a `note` fact's head read is memoized per ref for the call. Only a
   * success (including a definite `null`) is cached; a failed read is not.
   */
  async function readHeadCached(ctx: CoreCallContext, noteId: string, caches: CheckCaches):
  Promise<Outcome<NoteHeadSnapshot | null>> {
    const key = `${ctx.projectId}\u0000${noteId}`;
    const hit = caches.noteHeads.get(key);
    if (hit !== undefined) return hit;
    const outcome = await readHead(ctx.projectId, noteId);
    if (outcome.ok) caches.noteHeads.set(key, outcome);
    return outcome;
  }

  async function readVersion(projectId: string, noteId: string, version: number):
  Promise<Outcome<NoteVersionSnapshot | null>> {
    const refKey = noteVersionRefKey({ aggregateType: 'NoteVersion', projectId, noteId, version });
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return okFalse(read.code === 'not_found' ? 'not_found' : 'unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return { ok: true, value: null };
    const decoded = decodeNoteVersionSnapshot(record);
    if (decoded.status !== 'decoded') return okFalse('unavailable', 'damaged note version');
    return { ok: true, value: decoded.value };
  }

  /** One batch item as the check keeps it: only a path that compares or parses decoded text keeps the text. */
  function fileReadOf(read: WorkspaceResult<WorkspaceFile>, keepText: boolean): FileRead {
    if (read.status === 'ready') {
      return { status: 'ready', digest: read.value.digest, sizeBytes: read.value.sizeBytes,
        content: keepText ? read.value.content : null, textDigest: keepText ? sha256Hex(read.value.content) : null };
    }
    if (read.code === 'not_found') return { status: 'missing' };
    if (read.code === 'forbidden') return { status: 'forbidden' };
    if (read.code === 'capacity') return { status: 'capacity' };
    return { status: 'unavailable' };
  }

  /** R4: one access for these paths; an access that does not open leaves every one of them unreadable. */
  async function readBatch(ctx: CoreCallContext, budget: CheckBudget, paths: readonly string[],
    keepText: ReadonlyMap<string, boolean>, mainWorkspaceId: string): Promise<void> {
    if (paths.length === 0) return;
    if (workspace === undefined) {
      for (const path of paths) budget.reads.set(path, { status: 'unavailable' });
      return;
    }
    // A stored path reads its OWN workspace: a bare path is the main workspace,
    // a prefixed one names another. Group so each workspace gets one access,
    // then put the results back in the requested order.
    const groups = new Map<string, { originals: string[]; relative: string[] }>();
    for (const path of paths) {
      let resolved: { workspaceId: string; path: string };
      try {
        resolved = resolveStoredProjectPath(path, mainWorkspaceId);
      } catch {
        budget.reads.set(path, { status: 'forbidden' });
        continue;
      }
      const group = groups.get(resolved.workspaceId) ?? { originals: [], relative: [] };
      group.originals.push(path);
      group.relative.push(resolved.path);
      groups.set(resolved.workspaceId, group);
    }
    for (const [workspaceId, group] of groups) {
      const wctx = { ...ctx, workspaceId };
      let batch: Awaited<ReturnType<NoteAnchorWorkspace['readWorkspaceFiles']>>;
      try {
        batch = await workspace.readWorkspaceFiles(wctx, { workspace: workspaceRef(wctx), paths: group.relative,
          maxBytes: basisFileMaxBytes });
      } catch {
        for (const path of group.originals) budget.reads.set(path, { status: 'unavailable' });
        continue;
      }
      if (batch.status !== 'ready') {
        for (const path of group.originals) budget.reads.set(path, { status: 'unavailable' });
        continue;
      }
      group.originals.forEach((path, index) => {
        budget.reads.set(path, fileReadOf(batch.value[index]!, keepText.get(path) === true));
      });
    }
  }

  /** The file paths one item reads, in the order it reads them; `text` marks a path whose decoded text it needs. */
  function itemPaths(ctx: CoreCallContext, body: CheckBody, factsLeft: { value: number },
    add: (path: string, text: boolean) => void): void {
    for (const file of body.basis.files) add(file.path, false);
    for (const fact of body.facts) {
      if (factsLeft.value <= 0) break;
      factsLeft.value -= 1;
      if (fact.kind === 'file' && FILE_DIGEST.test(fact.digest) && isSafeProjectPath(fact.path)
        && splitWorkspacePath(fact.path).path !== '.') add(fact.path, false);
    }
    for (const anchor of [body.anchor, ...body.extraAnchors]) {
      if (anchor.kind === 'file' && (anchor.deleted !== true || anchor.symbol !== undefined)) add(anchor.path, anchor.symbol !== undefined);
    }
    if (body.kind !== 'link' || body.link === undefined) return;
    const link = body.link;
    // R5's gate: every evidence file, each definition file it references, the stored configuration,
    // and the configuration a kept conclusion was decided under.
    for (const evidence of link.evidence) {
      add(evidence.at.path, true);
      for (const field of partFieldsOf(link.relation, evidence.role, link.key?.kind)) {
        const definition = definitionOf(link, body.extraAnchors, field);
        if (definition !== null) add(definition.path, true);
      }
    }
    if (link.analysisConfig.path !== null) add(link.analysisConfig.path, true);
    const kept = linkConclusions.get(linkKey(ctx, body.noteId))?.gate.config;
    if (kept !== undefined && kept !== null) add(kept.path, true);
  }

  /**
   * R4: every path the call's items read, listed in item order first (deduplicated; the first
   * `readFilesMax` are read, every later one is past the budget), then read in one access, or in two
   * when a Python/C++ locator is among them: those files first, so their lookups are on their way
   * while the rest is read and the TS files are parsed.
   */
  async function readPlanned(ctx: CoreCallContext, bodies: readonly CheckBody[], budget: CheckBudget): Promise<Reject | null> {
    const keepText = new Map<string, boolean>();
    const factsLeft = { value: limits.readFactsMax ?? NOTE_READ_FACTS_MAX };
    for (const body of bodies) {
      itemPaths(ctx, body, factsLeft, (path, text) => { keepText.set(path, text || keepText.get(path) === true); });
    }
    const ordered = [...keepText.keys()];
    const admitted = ordered.slice(0, limits.readFilesMax ?? NOTE_READ_FILES_MAX);
    for (const path of ordered.slice(admitted.length)) budget.reads.set(path, { status: 'exhausted' });
    const requestWorkspaceId = ctx.workspaceId ?? '';
    // The main workspace is read only when a path must actually be resolved: a
    // prefixed path names its own workspace, and a bare stored path is the main
    // workspace, so both need the caller-is-main decision. With no admitted path
    // there is nothing to resolve and no read.
    let mainWorkspaceId = requestWorkspaceId;
    if (deps.mainWorkspaceOf !== undefined && admitted.length > 0) {
      const main = await deps.mainWorkspaceOf(ctx.projectId);
      // A failed main read makes the whole check `unavailable`; a ready `null`
      // (no workspace yet) keeps the caller's workspace as main.
      if (main.status !== 'ready') {
        return okFalse('unavailable', readFailureReason(main, 'the main workspace cannot be read'));
      }
      mainWorkspaceId = main.value ?? requestWorkspaceId;
    }
    budget.mainWorkspaceId = mainWorkspaceId;
    const native = new Set(bodies.flatMap(body => nativeLocatorsOf(body).map(located => located.path)));
    await readBatch(ctx, budget, admitted.filter(path => native.has(path)), keepText, mainWorkspaceId);
    sendNativeLookups(ctx, budget, bodies);
    await readBatch(ctx, budget, admitted.filter(path => !native.has(path)), keepText, mainWorkspaceId);
    return null;
  }

  /** R3: a path's read in this call; every path was read, or marked past the budget, before any item is judged. */
  function readPathOnce(budget: CheckBudget, path: string): PathRead {
    return budget.reads.get(path) ?? { status: 'unavailable' };
  }

  /** R3: one path's observation against one expected digest (null = existence only), by raw bytes or decoded text. */
  function observationFor(path: string, read: PathRead, expectedDigest: string | null,
    basis: 'raw' | 'text'): NoteFileObservationV1 {
    if (read.status === 'ready') {
      const current = basis === 'text' ? read.textDigest : read.digest;
      return { path, digest: read.digest,
        outcome: expectedDigest !== null && current !== expectedDigest ? 'changed' : 'same' };
    }
    const outcome: NoteFileObservationV1['outcome'] =
      read.status === 'missing' ? 'deleted' : read.status === 'exhausted' ? 'unchecked' : read.status;
    return { path, digest: null, outcome };
  }

  /**
   * R3: the check's ONLY way to observe a file. Each caller gets the outcome
   * computed against its own expected digest, while the item keeps the first
   * observation of that path and the call-level budget reads the file once.
   */
  function observeForItem(budget: CheckBudget, itemObs: ItemObservations, path: string,
    expectedDigest: string | null, basis: 'raw' | 'text'): NoteFileObservationV1 {
    const observed = observationFor(path, readPathOnce(budget, path), expectedDigest, basis);
    if (!itemObs.has(path)) itemObs.set(path, observed);
    return observed;
  }

  /**
   * R3: one `read` lookup per changed Python/C++ locator file, sent before the rest is read; each
   * is charged to the parse budget first. The first one starts the call's one wait.
   */
  function sendNativeLookups(ctx: CoreCallContext, budget: CheckBudget, bodies: readonly CheckBody[]): void {
    const lookup = workspace?.lookup;
    if (lookup === undefined) return;
    const natives = budget.natives;
    for (const body of bodies) {
      for (const located of nativeLocatorsOf(body)) {
        const read = budget.reads.get(located.path);
        if (natives.sent.has(located.path) || read?.status !== 'ready' || read.textDigest === located.symbol.fileDigest) continue;
        if (!chargeParse(budget, located.path, read.sizeBytes)) continue;
        // The lookup analyses one workspace: the stored path's own, with the
        // workspace-relative path, never the caller's workspace and a prefix.
        let resolved: { workspaceId: string; path: string };
        try { resolved = resolveStoredProjectPath(located.path, budget.mainWorkspaceId); }
        catch { continue; }
        const answer = lookup({ ...ctx, workspaceId: resolved.workspaceId },
          { language: located.language, path: resolved.path, text: read.content!,
            digest: read.digest, mode: 'read' });
        natives.sent.set(located.path, answer);
        // An answer after the deadline is not part of this read; the process still finishes and keeps it.
        void answer.then(value => { if (!natives.expired) natives.settled.set(located.path, value); });
        // At the deadline the loop yields once, so an answer already in takes part; the rest read unchecked.
        natives.deadline ??= new Promise<void>(resolve => {
          natives.timer = setTimeout(() => setImmediate(() => { natives.expired = true; resolve(); }), NOTE_NATIVE_READ_WAIT_MS);
        });
      }
    }
  }

  /** R3: the call's one wait for its Python/C++ lookups: until every one has answered or the deadline passed. */
  async function settleNatives(budget: CheckBudget): Promise<void> {
    const natives = budget.natives;
    if (natives.deadline !== null) await Promise.race([Promise.all(natives.sent.values()), natives.deadline]);
  }

  /** R4: a file is parsed on its own only within the call's file and byte budgets; a file already parsed in the call is free. */
  function chargeParse(budget: CheckBudget, path: string, bytes: number): boolean {
    if (budget.parsed.has(path)) return true;
    if (budget.symbolRechecksRemaining <= 0 || bytes > budget.parseBytesRemaining) return false;
    budget.symbolRechecksRemaining -= 1;
    budget.parseBytesRemaining -= bytes;
    budget.parsed.add(path);
    return true;
  }

  function treeOf(budget: CheckBudget, path: string, read: ReadyRead): SyntaxTreeV1 | null {
    const built = budget.trees.get(path);
    if (built !== undefined) return built;
    if (!chargeParse(budget, path, read.sizeBytes)) return null;
    const tree = syntaxTreeOf(path, read.content!);
    budget.trees.set(path, tree);
    return tree;
  }

  /**
   * R7's second exception: the answers of earlier parses, by path and decoded text digest, so the
   * same text is parsed once; a hit is not a parse and takes no budget. Only answers are kept.
   */
  const parseKey = (path: string, read: ReadyRead): string => `${path}\u0000${read.textDigest!}`;
  function keptParse(key: string): ParseAnswers | undefined {
    const entry = parseAnswers.get(key);
    if (entry !== undefined) { parseAnswers.delete(key); parseAnswers.set(key, entry); }
    return entry;
  }
  function keepParse(key: string, bytes: number): ParseAnswers {
    const kept = keptParse(key);
    if (kept !== undefined) return kept;
    const entry: ParseAnswers = { bytes, names: new Map() };
    parseAnswers.set(key, entry);
    parseAnswerBytes += bytes;
    for (const [oldest, value] of parseAnswers) {
      if (parseAnswerBytes <= PARSE_ANSWERS_SOURCE_BYTES_MAX || oldest === key) break;
      parseAnswers.delete(oldest);
      parseAnswerBytes -= value.bytes;
    }
    return entry;
  }

  /** A file's navigation items; `null` when the parse budget is spent. */
  function navItemsOf(budget: CheckBudget, path: string, read: ReadyRead): NavItemV1[] | null {
    const key = parseKey(path, read);
    const kept = keptParse(key)?.items;
    if (kept !== undefined) return kept;
    const tree = treeOf(budget, path, read);
    if (tree === null) return null;
    const items = tree.navigationItems();
    keepParse(key, read.sizeBytes).items = items;
    return items;
  }

  function fileSyntaxIn(budget: CheckBudget, path: string, read: ReadyRead): FileSyntaxV1 | null {
    const key = parseKey(path, read);
    const kept = keptParse(key)?.syntax;
    if (kept !== undefined) return kept;
    const tree = treeOf(budget, path, read);
    if (tree === null) return null;
    const syntax = fileSyntaxOf(tree);
    keepParse(key, read.sizeBytes).syntax = syntax;
    return syntax;
  }

  function namesIn(budget: CheckBudget, path: string, read: ReadyRead, ranges: LineRange[] | null,
    names: readonly string[]): NameAnswer[] | null {
    const key = parseKey(path, read);
    const nameKey = (name: string): string => JSON.stringify([ranges, name]);
    let answers = keptParse(key)?.names;
    // Only the names not answered before for these ranges are looked up.
    const missing = [...new Set(names)].filter(name => answers?.has(nameKey(name)) !== true);
    if (missing.length > 0) {
      const tree = treeOf(budget, path, read);
      if (tree === null) return null;
      answers = keepParse(key, read.sizeBytes).names;
      for (const answer of namesInRanges(tree, ranges, missing)) answers.set(nameKey(answer.name), answer);
    }
    return names.map(name => answers!.get(nameKey(name))!);
  }

  /**
   * R3: a changed file's symbol locator found again in that file alone by its stored name. TS reads
   * its navigation items now (a spent budget is `unchecked`); a Python/C++ locator is `null` here
   * and answered from its lookup after the call's wait (`nativeRecheck`); another language is `unchecked`.
   */
  function recheckLocator(budget: CheckBudget, path: string, read: ReadyRead,
    symbol: SymbolLocatorV1): SymbolRecheck | null {
    if (symbol.language === 'python' || symbol.language === 'cpp') return null;
    if (symbol.language !== 'typescript') return { status: 'unchecked' };
    const items = navItemsOf(budget, path, read);
    if (items === null) return { status: 'unchecked' };
    return locatorRecheck(read.content!, symbol, items.filter(item => item.name === symbol.qualifiedName), true);
  }

  /** R3: a Python/C++ locator from its lookup's answer; not sent, failed or later than the deadline is `unchecked`. */
  function nativeRecheck(budget: CheckBudget, path: string, read: ReadyRead, symbol: SymbolLocatorV1): SymbolRecheck {
    const answer = budget.natives.settled.get(path);
    if (answer?.status !== 'parsed') return { status: 'unchecked' };
    return locatorRecheck(read.content!, symbol, answer.symbols.filter(item => item.name === symbol.qualifiedName),
      answer.exact);
  }

  /** R3/R5: one item's single-file judgements in its order: the changed locator files, then the link. */
  function judgeItem(ctx: CoreCallContext, body: CheckBody, budget: CheckBudget): ItemJudgement {
    const locators = new Map<number, SymbolRecheck | null>();
    [body.anchor, ...body.extraAnchors].forEach((anchor, index) => {
      if (anchor.kind !== 'file' || anchor.symbol === undefined) return;
      const read = readPathOnce(budget, anchor.path);
      if (read.status === 'ready' && read.textDigest !== anchor.symbol.fileDigest) {
        locators.set(index, recheckLocator(budget, anchor.path, read, anchor.symbol));
      }
    });
    if (body.kind !== 'link' || body.link === undefined) return { locators, link: null };
    const kept = keptConclusion(ctx, body, budget);
    if (kept !== null) return { locators, link: { verification: kept, read: null } };
    const read = firstTierLinkParts(body.link, body.extraAnchors, budget);
    return { locators, link: { verification: linkVerificationOfParts(read.parts), read } };
  }
  /** An evidence's scope in its file now: the named function's declaration spans, else its range or the whole file. */
  function evidenceScope(budget: CheckBudget, read: ReadyRead,
    at: LinkEvidenceStoredV1['at']): EvidenceScopeV1 | LinkPartStatus {
    const request = at.symbolRequest;
    if (request === undefined) return evidenceScopeOf(at, undefined);
    const items = navItemsOf(budget, at.path, read);
    if (items === null) return 'budget';
    const named = items.filter(item => item.name === request.name);
    // Rule 1: the function the range was named by is gone; one that only moved is still there.
    if (named.length === 0) return 'broken';
    const stored = at.symbol?.range;
    const chosen = named.length === 1 ? named[0] : named.find(item => stored !== undefined
      && item.start.line === stored.startLine && item.end.line === stored.endLine);
    if (chosen === undefined) return 'unavailable';
    return evidenceScopeOf(at, { kind: 'symbol', name: chosen.name, symbolKind: chosen.kind,
      location: { path: at.path, digest: read.textDigest!, start: chosen.start, end: chosen.end },
      declarationRanges: chosen.declarationRanges });
  }

  /** R5 rules 3–5 for one evidence × definition, from the two files' single-file syntax. */
  function referenceRule(budget: CheckBudget, definition: Definition, definitionRead: ReadyRead, path: string,
    read: ReadyRead, ranges: LineRange[] | null): LinkPartStatus {
    const items = navItemsOf(budget, definition.path, definitionRead);
    if (items === null) return 'budget';
    const named = items.filter(item => item.name === definition.name);
    // Rule 3: X is gone from its file (its slot reads retired by the anchor check).
    if (named.length === 0) return 'broken';
    const x = named.length === 1 ? named[0] : named.find(item => item.start.line === definition.line);
    // Several of that name and none on the stored name line (8E N3).
    if (x === undefined) return 'unavailable';
    if (x.name === 'constructor' || x.name === 'default' || !PLAIN_NAME.test(x.name)) return 'doubt';
    const definitionFile = fileSyntaxIn(budget, definition.path, definitionRead);
    const evidenceFile = fileSyntaxIn(budget, path, read);
    if (definitionFile === null || evidenceFile === null) return 'budget';
    const names = namesIn(budget, path, read, ranges, [x.name, ...evidenceFile.importNames]);
    if (names === null) return 'budget';
    return referenceGone(x, definitionFile, evidenceFile, names) ? 'broken' : 'doubt';
  }

  /**
   * R5, the link's first tier: one part per evidence's own rules and per evidence × definition it
   * references, from file digests and single-file syntax only. A part whose files and configuration
   * are as written keeps the write-time result; an evidence `fileDigest` of null, a definition
   * without a locator, or a stored `analyzer_unavailable` redo it on every read. A reference part
   * whose evidence file or definition file is not TS/JS keeps the stored `language_unsupported`
   * without a parse. The definite rules (1–5) break the evidence; any other change waits for the
   * second tier (`doubt`), and a changed configuration only makes the reference parts doubtful.
   */
  function firstTierLinkParts(link: LinkPayloadV1, extraAnchors: readonly NoteAnchorV1[],
    budget: CheckBudget): LinkRead {
    const parts: LinkPart[] = [];
    const files = new Map<string, string>();
    const gateRead = (path: string): PathRead => {
      const read = readPathOnce(budget, path);
      if (read.status === 'ready') files.set(path, read.digest);
      return read;
    };
    const unreadable = (read: PathRead): LinkPartStatus => read.status === 'exhausted' ? 'budget' : 'unavailable';
    const needsKey = relationNeedsKey(link.relation);
    const key = link.key ?? null;
    const redoAlways = link.verification.status === 'unverifiable' && link.verification.reason === 'analyzer_unavailable';
    // The write side's own language_unsupported: an end or the symbol key asked in another language.
    if ([link.ends.from, link.ends.to, link.ends.via].some(end => end?.kind === 'file' && end.symbolRequest !== undefined
      && !isTsPath(end.path)) || (needsKey && key?.kind === 'symbol' && !isTsPath(key.path))) {
      parts.push({ evidence: null, question: null, status: 'language_unsupported' });
    }
    // No stored configuration path is no configuration gate; the selection rule is not rerun here.
    let configuration: 'same' | 'changed' | 'unavailable' | 'budget' = 'same';
    let config: LinkRead['config'] = null;
    if (link.analysisConfig.path !== null) {
      const read = readPathOnce(budget, link.analysisConfig.path);
      if (read.status === 'ready') {
        config = { path: link.analysisConfig.path, digest: read.textDigest! };
        configuration = read.textDigest === link.analysisConfig.digest ? 'same' : 'changed';
      } else {
        configuration = read.status === 'missing' ? 'changed' : read.status === 'exhausted' ? 'budget' : 'unavailable';
      }
    }

    const referencePart = (definition: Definition, path: string, read: ReadyRead, same: boolean,
      scopeOf: () => EvidenceScopeV1 | LinkPartStatus): { question: ReferenceQuestionV1 | null; status: LinkPartStatus } => {
      if (!isTsPath(path) || !isTsPath(definition.path)) return { question: null, status: 'language_unsupported' };
      const definitionRead = gateRead(definition.path);
      if (definitionRead.status === 'missing') return { question: null, status: 'broken' };
      if (definitionRead.status !== 'ready') return { question: null, status: unreadable(definitionRead) };
      const redo = !same || redoAlways || definition.locator === undefined
        || definitionRead.textDigest !== definition.locator.fileDigest;
      if (!redo && configuration === 'same') return { question: null, status: 'ok' };
      const scoped = scopeOf();
      if (typeof scoped === 'string') return { question: null, status: scoped };
      const question: ReferenceQuestionV1 = {
        definition: { path: definition.path, name: definition.name, line: definition.line },
        evidence: { path, ranges: scoped.kind === 'whole_file' ? null : scoped.ranges } };
      const single = redo ? referenceRule(budget, definition, definitionRead, path, read, question.evidence.ranges) : 'doubt';
      if (single !== 'doubt') return { question, status: single };
      return { question, status: configuration === 'unavailable' || configuration === 'budget' ? configuration : 'doubt' };
    };

    for (const [index, evidence] of link.evidence.entries()) {
      const path = evidence.at.path;
      const own = (status: LinkPartStatus): void => { parts.push({ evidence: index, question: null, status }); };
      const read = gateRead(path);
      // Rule 1: the evidence file is gone.
      if (read.status === 'missing') { own('broken'); continue; }
      if (read.status !== 'ready') { own(unreadable(read)); continue; }
      const same = evidence.fileDigest !== null && read.digest === evidence.fileDigest;
      let scope: EvidenceScopeV1 | LinkPartStatus | undefined;
      const scopeOf = (): EvidenceScopeV1 | LinkPartStatus => scope ??= evidenceScope(budget, read, evidence.at);
      if (!same) {
        // Rule 1: the line range now runs past the end of the file, or the named function is gone.
        if (evidence.at.range !== undefined && evidence.at.range.endLine > read.content!.split('\n').length) { own('broken'); continue; }
        const scoped = scopeOf();
        if (typeof scoped === 'string') { own(scoped); continue; }
        // Rule 2: the literal key is on no line of the scope.
        if (needsKey && key?.kind === 'literal' && !literalInScope(read.content!, key.text, scoped)) own('broken');
      }
      if (needsKey && key === null) own('key_not_literal');
      for (const field of partFieldsOf(link.relation, evidence.role, link.key?.kind)) {
        const definition = definitionOf(link, extraAnchors, field);
        if (definition !== null) parts.push({ evidence: index, ...referencePart(definition, path, read, same, scopeOf) });
      }
    }
    return { parts, files, config };
  }

  /** R7: the kept second-tier conclusion, when the version and every gate digest are as it was decided under. */
  function keptConclusion(ctx: CoreCallContext, body: CheckBody, budget: CheckBudget): LinkVerificationV1 | null {
    const kept = linkConclusions.get(linkKey(ctx, body.noteId));
    if (kept === undefined || kept.version !== body.version) return null;
    for (const [path, digest] of kept.gate.files) {
      const read = readPathOnce(budget, path);
      if (read.status !== 'ready' || read.digest !== digest) return null;
    }
    if (kept.gate.config !== null) {
      const read = readPathOnce(budget, kept.gate.config.path);
      if (read.status !== 'ready' || read.textDigest !== kept.gate.config.digest) return null;
    }
    return kept.conclusion;
  }
  /** §9: a failed plan read is `unavailable`, never a definite "no plan". */
  async function currentPlan(ctx: CoreCallContext, goalId: string,
    caches: CheckCaches): Promise<Outcome<PlanRevisionSnapshot | null>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.plans.get(key);
    if (hit !== undefined) return hit;
    const ref: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const window = await readGoalPlanWindow(deps.records, ref);
    const outcome: Outcome<PlanRevisionSnapshot | null> = window.status === 'ready'
      ? { ok: true, value: window.plan }
      : okFalse('unavailable', readFailureReason(window, 'the goal plan cannot be read'));
    caches.plans.set(key, outcome);
    return outcome;
  }

  /**
   * §11.5/U-3: the goal's trigger read, cached per goal for the call exactly as
   * `plans`. A goal with no current plan has no triggers (a legal empty read);
   * any failure (including `unsupported`) rejects the whole check.
   */
  async function currentTriggers(ctx: CoreCallContext, goalId: string, caches: CheckCaches):
  Promise<Outcome<{ triggers: NoteUpdateDueTriggerV1[]; claimedArchiveKeys: ReadonlySet<string> }>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.triggers.get(key);
    if (hit !== undefined) return hit;
    const plan = await currentPlan(ctx, goalId, caches);
    let outcome: Outcome<{ triggers: NoteUpdateDueTriggerV1[]; claimedArchiveKeys: ReadonlySet<string> }>;
    if (!plan.ok) outcome = plan;
    else if (plan.value === null) outcome = { ok: true, value: { triggers: [], claimedArchiveKeys: new Set() } };
    else {
      const ref: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
      const read = await readGoalTriggerRecords(deps.records, ref, plan.value);
      outcome = read.status === 'ready'
        ? { ok: true, value: { triggers: read.triggers, claimedArchiveKeys: read.claimedArchiveKeys } }
        : okFalse('unavailable', readFailureReason(read, 'the goal triggers cannot be read'));
    }
    caches.triggers.set(key, outcome);
    return outcome;
  }

  type ParsedUnderstandingAnchor =
    | { kind: 'project' }
    | { kind: 'goal'; goalId: string }
    | { kind: 'stage'; goalId: string; stageId: string };

  /**
   * §11.5: `understandingAnchors` are the anchor keys `checkHeads` was asked
   * for. The project anchor is `project`; the others are `goal:<id>` and
   * `stage:<goalId>/<planRevision>/<stageId>`. A key that is none of these is
   * not an understanding anchor.
   */
  function parseUnderstandingAnchorKey(anchorKey: string): ParsedUnderstandingAnchor | null {
    if (anchorKey === 'project') return { kind: 'project' };
    if (anchorKey.startsWith('goal:')) {
      const goalId = anchorKey.slice('goal:'.length);
      return goalId.length === 0 ? null : { kind: 'goal', goalId };
    }
    if (!anchorKey.startsWith('stage:')) return null;
    const rest = anchorKey.slice('stage:'.length);
    const first = rest.indexOf('/');
    const second = first < 0 ? -1 : rest.indexOf('/', first + 1);
    if (first <= 0 || second <= first + 1 || second === rest.length - 1) return null;
    return { kind: 'stage', goalId: rest.slice(0, first), stageId: rest.slice(second + 1) };
  }

  /**
   * §11.4/§11.5/U-3: one anchor's `UnderstandingStatusV1` from the same caches
   * the item check uses. The project anchor stays `updateDue: null` (M-12g); a
   * goal/stage anchor folds the trigger read. Memoized per anchor, so a lookup
   * reads its pointer once and a goal's triggers once.
   */
  async function understandingOfAnchorKey(ctx: CoreCallContext, anchorKey: string, caches: CheckCaches):
  Promise<Outcome<UnderstandingStatusV1>> {
    const cacheKey = `${ctx.projectId}\u0000${anchorKey}`;
    const hit = caches.understandings.get(cacheKey);
    if (hit !== undefined) return hit;
    const outcome = await computeUnderstandingOfAnchorKey(ctx, anchorKey, caches);
    caches.understandings.set(cacheKey, outcome);
    return outcome;
  }

  async function computeUnderstandingOfAnchorKey(ctx: CoreCallContext, anchorKey: string, caches: CheckCaches):
  Promise<Outcome<UnderstandingStatusV1>> {
    const parsed = parseUnderstandingAnchorKey(anchorKey);
    if (parsed === null) return okFalse('invalid', `not an understanding anchor: ${anchorKey}`);
    // When the caller already read this anchor's pointer and
    // pointed head, use them and skip both reads (the project branch too).
    const seed = caches.understandingSeed.get(`${ctx.projectId}\u0000${anchorKey}`);
    let pointer: { noteId: string | null; revision: number | null } = { noteId: null, revision: null };
    if (seed !== undefined) {
      pointer = seed.pointer;
    } else {
      // §11.4: the same pointer key the write side uses.
      const pointerKey = currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId: ctx.projectId, anchorKey });
      const pointerRead = await deps.records.readMany([pointerKey]);
      if (pointerRead.status !== 'ready') {
        return okFalse('unavailable', readFailureReason(pointerRead, 'the current pointer cannot be read'));
      }
      const pointerRecord = pointerRead.value.records.find(candidate => candidate.refKey === pointerKey);
      if (pointerRecord !== undefined) {
        const decoded = decodeCurrentPointerSnapshot(pointerRecord);
        if (decoded.status !== 'decoded') return okFalse('unavailable', 'damaged current pointer');
        pointer = { noteId: decoded.value.noteId, revision: decoded.value.revision };
      }
    }
    if (parsed.kind === 'project') {
      return { ok: true, value: { anchorKey, pointer, updateDue: null, latestTriggerCursor: null } };
    }

    const plan = await currentPlan(ctx, parsed.goalId, caches);
    if (!plan.ok) return plan;
    const triggers = await currentTriggers(ctx, parsed.goalId, caches);
    if (!triggers.ok) return triggers;

    let head: NoteHeadSnapshot | null = seed === undefined ? null : seed.head;
    if (seed === undefined && pointer.noteId !== null) {
      const read = await readHeadCached(ctx, pointer.noteId, caches);
      if (!read.ok) return read;
      head = read.value;
    }
    // The one baseline rule, shared with the to-dos and the reader.
    const anchor = foldInputOf(anchorKey, head, plan.value, parsed.kind === 'stage' ? parsed.stageId : null);
    const folded = foldUpdateDue({ triggers: triggers.value.triggers, plan: plan.value, anchors: [anchor] })[0]!;
    return { ok: true, value: { anchorKey, pointer, updateDue: folded.updateDue,
      latestTriggerCursor: folded.latestTriggerCursor } };
  }

  /** §9: a failed catalog read is `unavailable`, never an empty module list. */
  async function currentArchitecture(ctx: CoreCallContext, caches: CheckCaches):
  Promise<Outcome<ArchitectureRevision>> {
    const hit = caches.architecture.current;
    if (hit !== undefined) return hit;
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    const outcome: Outcome<ArchitectureRevision> = read.status === 'ready' ? { ok: true, value: read.value }
      : okFalse('unavailable', readFailureReason(read, 'the architecture catalog cannot be read'));
    caches.architecture.current = outcome;
    return outcome;
  }

  /**
   * S2.6 (b8): a historical catalog revision is memoized per revision number
   * for the whole check call.
   */
  async function architectureRevision(ctx: CoreCallContext, revision: number, caches: CheckCaches):
  Promise<Outcome<ArchitectureRevision>> {
    const hit = caches.architecture.byRevision.get(revision);
    if (hit !== undefined) return hit;
    const current = await currentArchitecture(ctx, caches);
    if (!current.ok) return current;
    const read = await deps.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref: { ...current.value.baseline.ref, revision } } });
    const outcome: Outcome<ArchitectureRevision> = read.status === 'ready'
      ? { ok: true, value: read.value }
      : okFalse('unavailable', readFailureReason(read, 'the basis catalog revision cannot be read'));
    caches.architecture.byRevision.set(revision, outcome);
    return outcome;
  }

  function moduleIn(modules: readonly ModuleDefinition[], moduleId: string): ModuleDefinition | undefined {
    return modules.find(module => module.ref.moduleId === moduleId);
  }

  /**
   * Slice 2B L14 (`s2b-plan-revision-by-goal`): one Goal's PlanRevisions,
   * ordered by `acceptedAt`. Used to find the basis revision by its number,
   * because each adopted revision carries a NEW planId (plan-machine.ts:1404).
   * A store failure is `unavailable`; a genuinely absent revision is `null`.
   */
  async function basisPlanByNumber(ctx: CoreCallContext, goalId: string,
    planRevision: number, caches: CheckCaches): Promise<Outcome<PlanRevisionSnapshot | null>> {
    // S2.6 (b10): one cache per (goal, revision number).
    const key = `${ctx.projectId}\u0000${goalId}\u0000${String(planRevision)}`;
    const hit = caches.basisPlans.get(key);
    if (hit !== undefined) return hit;
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return okFalse('unavailable', page.reason);
      for (const record of page.value.records) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status === 'decoded' && decoded.value.planRevision === planRevision) {
          const found: Outcome<PlanRevisionSnapshot | null> = { ok: true, value: decoded.value };
          caches.basisPlans.set(key, found);
          return found;
        }
      }
      if (page.value.next === null) {
        const missing: Outcome<PlanRevisionSnapshot | null> = { ok: true, value: null };
        caches.basisPlans.set(key, missing);
        return missing;
      }
      after = page.value.next;
    }
  }

  /**
   * MF5/R5: every adopted PlanRevision of one Goal, keyed by its revision
   * number, read once through the S2B index. A store failure is `unavailable`.
   * S2.6 (b10): memoized per goal for the whole call.
   */
  async function planRevisionsOfGoal(ctx: CoreCallContext, goalId: string, caches: CheckCaches):
  Promise<Outcome<Map<number, PlanRevisionSnapshot>>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.planRevisions.get(key);
    if (hit !== undefined) return hit;
    const revisions = new Map<number, PlanRevisionSnapshot>();
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return okFalse('unavailable', page.reason);
      for (const record of page.value.records) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status === 'decoded') revisions.set(decoded.value.planRevision, decoded.value);
      }
      if (page.value.next === null) {
        const outcome: Outcome<Map<number, PlanRevisionSnapshot>> = { ok: true, value: revisions };
        caches.planRevisions.set(key, outcome);
        return outcome;
      }
      after = page.value.next;
    }
  }

  /**
   * L23: the MAIN anchor's retirement decides `anchorStatus`; a retired extra
   * anchor only appears in `retiredExtraAnchors`. A symbol locator compares its
   * file by decoded text; a changed file is parsed on its own (R3) within the
   * call's parse budgets, shared with the link gates (R4).
   */
  async function anchorStatusOf(ctx: CoreCallContext, body: CheckBody, budget: CheckBudget,
    itemObs: ItemObservations, caches: CheckCaches, judgement: ItemJudgement):
  Promise<Outcome<{ retired: boolean; reasons: StaleReason[]; retiredExtraAnchors: string[]; unchecked: boolean;
    staleReasons: string[]; anchorSlots: NoteCheckV1['anchorSlots'] }>> {
    const retiredExtraAnchors: string[] = [];
    const staleReasons: string[] = [];
    let unchecked = false;
    const all = [body.anchor, ...body.extraAnchors];
    // One reason list per slot: the primary anchor first, then `extraAnchors`
    // order. A slot keeps its own status even when two slots name one key.
    const slotReasons: StaleReason[][] = all.map(() => []);
    const needsCatalog = all.some(anchor => anchor.kind === 'module' || anchor.kind === 'interface');
    // MF5/R5: each task/stage anchor resolves against its OWN goal's plan.
    const plans = new Map<string, PlanRevisionSnapshot | null>();
    for (const goalId of new Set(all.flatMap(anchor =>
      anchor.kind === 'task' || anchor.kind === 'stage' ? [anchor.goalId] : []))) {
      const read = await currentPlan(ctx, goalId, caches);
      if (!read.ok) return read;
      plans.set(goalId, read.value);
    }
    let modules: readonly ModuleDefinition[] = [];
    if (needsCatalog) {
      const read = await currentArchitecture(ctx, caches);
      if (!read.ok) return read;
      modules = read.value.catalog.catalog.modules;
    }

    const retirementOf = async (anchor: NoteAnchorV1): Promise<Outcome<StaleReason[]>> => {
      switch (anchor.kind) {
        case 'module':
          if (moduleIn(modules, anchor.moduleId) === undefined) return { ok: true, value: ['module_removed'] };
          return { ok: true, value: [] };
        case 'interface': {
          const module = moduleIn(modules, anchor.moduleId);
          if (module === undefined || !module.interfaces.some(item => item.id === anchor.interfaceId)) {
            return { ok: true, value: ['interface_removed'] };
          }
          return { ok: true, value: [] };
        }
        case 'task': {
          const plan = plans.get(anchor.goalId) ?? null;
          if (plan === null) return { ok: true, value: [] };
          const task = plan.tasks.find(candidate => candidate.taskId === anchor.taskId);
          if (task === undefined || RETIRED_TASK_DISPOSITIONS.includes(task.disposition)) return { ok: true, value: ['task_ended'] };
          return { ok: true, value: [] };
        }
        case 'stage': {
          const current = plans.get(anchor.goalId) ?? null;
          if (current === null) { unchecked = true; return { ok: true, value: [] }; }
          if (anchor.planRevision > current.planRevision) { unchecked = true; return { ok: true, value: [] }; }
          const revisions = await planRevisionsOfGoal(ctx, anchor.goalId, caches);
          if (!revisions.ok) return revisions;
          // RW-5/§11.6 R4: the ONE shared continuity decision over the closed
          // revision window; a missing revision read makes it `unchecked`.
          const continuity = stageContinuityOf({ stageId: anchor.stageId,
            anchorRevision: anchor.planRevision, currentRevision: current.planRevision,
            stagesByRevision: new Map([...revisions.value].map(([revision, plan]) =>
              [revision, plan.stages.map(stage => stage.stageId)] as const)) });
          if (continuity.status === 'unchecked') { unchecked = true; return { ok: true, value: [] }; }
          if (continuity.status === 'retired') {
            return { ok: true, value: ['stage_not_in_current_plan'] };
          }
          return { ok: true, value: [] };
        }
        case 'file': {
          if (anchor.deleted === true) return { ok: true, value: [] };
          const observed = observeForItem(budget, itemObs, anchor.path, anchor.symbol?.fileDigest ?? null, 'text');
          if (observed.outcome === 'deleted') return { ok: true, value: ['file_deleted'] };
          if (observed.outcome !== 'same' && observed.outcome !== 'changed') unchecked = true;
          return { ok: true, value: [] };
        }
        default:
          return { ok: true, value: [] };
      }
    };

    for (let index = 0; index < all.length; index += 1) {
      const outcome = await retirementOf(all[index]!);
      if (!outcome.ok) return outcome;
      const retired = outcome.value;
      slotReasons[index]!.push(...retired);
      if (index > 0 && retired.length > 0) retiredExtraAnchors.push(anchorKeyOf(all[index]!));
    }

    for (let index = 0; index < all.length; index += 1) {
      const anchor = all[index]!;
      if (anchor.kind !== 'file' || anchor.symbol === undefined) continue;
      const read = readPathOnce(budget, anchor.path);
      const observed = observeForItem(budget, itemObs, anchor.path, anchor.symbol.fileDigest, 'text');
      if (observed.outcome === 'same') continue; // the stored decoded-text digest matches: no parse
      if (observed.outcome === 'deleted') continue; // file_deleted already handled
      if (observed.outcome !== 'changed' || read.status !== 'ready') { unchecked = true; continue; }
      const rechecked = judgement.locators.get(index) ?? nativeRecheck(budget, anchor.path, read, anchor.symbol);
      if (rechecked.status === 'changed') staleReasons.push('symbol_signature_changed');
      else if (rechecked.status === 'missing') {
        slotReasons[index]!.push('symbol_missing');
        if (index > 0 && !retiredExtraAnchors.includes(anchorKeyOf(anchor))) retiredExtraAnchors.push(anchorKeyOf(anchor));
      } else if (rechecked.status === 'unchecked') {
        unchecked = true;
      }
    }
    const reasons = slotReasons[0] ?? [];
    const anchorSlots: NoteCheckV1['anchorSlots'] = slotReasons.map(reasonsOfSlot => ({
      status: reasonsOfSlot.length > 0 ? 'retired' as const : 'live' as const,
      reasons: reasonsOfSlot,
    }));
    return { ok: true, value: { retired: reasons.length > 0, reasons, retiredExtraAnchors, unchecked, staleReasons,
      anchorSlots } };
  }

  /** L11 definitions: plan adoption, task definitions, module/interface definitions. */
  async function definitionStaleness(ctx: CoreCallContext, body: CheckBody, caches: CheckCaches):
  Promise<Outcome<{ staleReasons: string[]; unchecked: boolean }>> {
    const staleReasons: string[] = [];
    let unchecked = false;
    const anchors = [body.anchor, ...body.extraAnchors];

    if (body.kind === 'understanding' && (body.anchor.kind === 'goal' || body.anchor.kind === 'stage')) {
      const goalId = 'goalId' in body.anchor ? body.anchor.goalId : null;
      if (goalId !== null && body.basis.planRevision !== null) {
        const read = await currentPlan(ctx, goalId, caches);
        if (!read.ok) return read;
        if (read.value !== null && read.value.planRevision !== body.basis.planRevision) staleReasons.push('plan_changed');
      }
    }

    for (const anchor of anchors) {
      if (anchor.kind !== 'task' || body.basis.planRevision === null) continue;
      const read = await currentPlan(ctx, anchor.goalId, caches);
      if (!read.ok) return read;
      const plan = read.value;
      if (plan === null) { unchecked = true; continue; }
      if (plan.planRevision === body.basis.planRevision) continue;
      const basis = await basisPlanByNumber(ctx, anchor.goalId, body.basis.planRevision, caches);
      if (!basis.ok) return basis;
      if (basis.value === null) { unchecked = true; continue; }
      const before = basis.value.tasks.find(candidate => candidate.taskId === anchor.taskId);
      const after = plan.tasks.find(candidate => candidate.taskId === anchor.taskId);
      if (before === undefined || after === undefined
        || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
        staleReasons.push('task_definition_changed');
      }
    }

    const hasModuleAnchor = anchors.some(anchor => anchor.kind === 'module' || anchor.kind === 'interface');
    if (hasModuleAnchor && body.basis.catalogRevision !== null) {
      const current = await currentArchitecture(ctx, caches);
      if (!current.ok) return current;
      const currentModules = current.value.catalog.catalog.modules;
      const basis = await architectureRevision(ctx, body.basis.catalogRevision, caches);
      if (!basis.ok) return basis;
      const basisModules = basis.value.catalog.catalog.modules;
      for (const anchor of anchors) {
        if (anchor.kind === 'module') {
          const before = moduleIn(basisModules, anchor.moduleId);
          const after = moduleIn(currentModules, anchor.moduleId);
          if (before === undefined || after === undefined
            || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
            staleReasons.push('module_definition_changed');
          }
        } else if (anchor.kind === 'interface') {
          const beforeModule = moduleIn(basisModules, anchor.moduleId);
          const afterModule = moduleIn(currentModules, anchor.moduleId);
          const before = beforeModule?.interfaces.find(item => item.id === anchor.interfaceId);
          const after = afterModule?.interfaces.find(item => item.id === anchor.interfaceId);
          if (before === undefined || after === undefined
            || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
            staleReasons.push('module_definition_changed');
          }
        }
      }
    }
    return { ok: true, value: { staleReasons, unchecked } };
  }

  /**
   * MF13/R13: the authoring agent Run's task scope in the Run's bound plan. A
   * failed Run/plan read is `unavailable`, never a definite mismatch.
   */
  async function agentRunTaskScope(ctx: CoreCallContext, runRef: RunRef, caches: CheckCaches):
  Promise<Outcome<{ moduleRef: string | null }>> {
    const refKey = canonicalJson(runRef as unknown as JsonValue);
    // S2.6 (b9): one Run task scope per Run ref for the whole call.
    const hit = caches.runTaskScope.get(refKey);
    if (hit !== undefined) return hit;
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return okFalse('unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return okFalse('unavailable', 'the authoring Run cannot be read');
    const decoded = decodeRun(record);
    if (!decoded.ok) return okFalse('unavailable', decoded.reason);
    const run = decoded.value;
    const planKey = planRevisionRefKey(run.planRef);
    const planRead = await deps.records.readMany([planKey]);
    if (planRead.status !== 'ready') return okFalse('unavailable', planRead.reason);
    const planRecord = planRead.value.records.find(candidate => candidate.refKey === planKey);
    if (planRecord === undefined) return okFalse('unavailable', 'the Run bound plan cannot be read');
    const planDecoded = decodePlanRevisionSnapshot(planRecord);
    if (planDecoded.status !== 'decoded') return okFalse('unavailable', 'the Run bound plan is damaged');
    const task = planDecoded.value.tasks.find(candidate => candidate.taskId === run.task.taskId);
    const scope = task?.scope;
    const outcome: Outcome<{ moduleRef: string | null }> = { ok: true,
      value: { moduleRef: scope !== undefined && scope.kind === 'module' ? scope.moduleRef : null } };
    caches.runTaskScope.set(refKey, outcome);
    return outcome;
  }

  /** MF13/R13: a `file` fact for the path, or a `counted` RunActivity listing it. */
  async function hasDeletionProof(ctx: CoreCallContext, body: CheckBody, path: string): Promise<Outcome<boolean>> {
    for (const fact of body.facts) {
      if (fact.kind === 'file' && fact.path === path) return { ok: true, value: true };
      if (fact.kind !== 'record' || (fact.ref as { aggregateType?: string }).aggregateType !== 'RunActivity') continue;
      const refKey = canonicalJson(fact.ref as unknown as JsonValue);
      const read = await deps.records.readMany([refKey]);
      // R13: a failed read is `unavailable`, never "no proof".
      if (read.status !== 'ready') return okFalse('unavailable', read.reason);
      const record = read.value.records.find(candidate => candidate.refKey === refKey);
      if (record === undefined) continue;
      const decoded = decodeRunActivitySnapshot(record);
      // R13: an undecodable proof record is `unavailable`, never unproved.
      if (decoded.status !== 'decoded') return okFalse('unavailable', decoded.reason);
      if (decoded.value.facts.status === 'counted'
        && decoded.value.facts.changedFiles.definite.includes(path)) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }

  /** L2a class 5 / §4 rule 23: the three post-write hints. */
  async function classFiveHints(ctx: CoreCallContext, body: CheckBody, mainWorkspaceId: string,
    caches: CheckCaches): Promise<Outcome<NoteHintV1[]>> {
    const hints: NoteHintV1[] = [];
    const anchors = [body.anchor, ...body.extraAnchors];
    const moduleAnchors = anchors.filter((anchor): anchor is Extract<NoteAnchorV1, { kind: 'module' | 'interface' }> =>
      anchor.kind === 'module' || anchor.kind === 'interface');
    const fileAnchors = anchors.filter((anchor): anchor is Extract<NoteAnchorV1, { kind: 'file' }> => anchor.kind === 'file');
    let catalog: AdoptedArchitecture | null = null;
    if (moduleAnchors.length > 0 || fileAnchors.length > 0) {
      const read = await currentArchitecture(ctx, caches);
      if (!read.ok) return read;
      catalog = read.value.catalog.catalog;
    }
    // A stored path names its own workspace: project the ONE catalog onto that
    // workspace and attribute the workspace-relative path there. The project
    // catalog never decides a second workspace's file (the main root `.` would
    // swallow an unowned second-workspace path).
    const attributedModuleOf = (path: string): string | null => {
      if (catalog === null) return null;
      let resolved: { workspaceId: string; path: string };
      try { resolved = resolveStoredProjectPath(path, mainWorkspaceId); }
      catch { return null; }
      return mapExecutedFilesToModules(catalogForWorkspace(catalog, resolved.workspaceId, mainWorkspaceId),
        [{ path: resolved.path, certainty: 'definite' as const }])[0]?.moduleRef?.moduleId ?? null;
    };

    // R13: longest-prefix attribution; the root `"."` owns nothing. A file
    // anchor contributes its own attributed module to the anchored set.
    if ((moduleAnchors.length > 0 || fileAnchors.length > 0) && body.basis.files.length > 0 && catalog !== null) {
      const anchored = new Set<string>(moduleAnchors.map(anchor => anchor.moduleId));
      for (const anchor of fileAnchors) {
        const moduleId = attributedModuleOf(anchor.path);
        if (moduleId !== null) anchored.add(moduleId);
      }
      const mapped = body.basis.files.flatMap(file => {
        const moduleId = attributedModuleOf(file.path);
        return moduleId === null ? [] : [moduleId];
      });
      if (!mapped.some(moduleId => anchored.has(moduleId))) {
        hints.push('basis_outside_anchor');
      }
    }

    // R13: only agent-written notes, against the authoring Run's bound plan.
    if (fileAnchors.length > 0 && catalog !== null && body.source.kind === 'agent' && body.source.runRef !== null) {
      const scope = await agentRunTaskScope(ctx, body.source.runRef, caches);
      if (!scope.ok) return scope;
      if (scope.value.moduleRef !== null) {
        for (const file of fileAnchors) {
          const fileModule = attributedModuleOf(file.path);
          if (fileModule !== null && fileModule !== scope.value.moduleRef) {
            hints.push('file_module_mismatch');
            break;
          }
        }
      }
    }

    // R13: every `deleted: true` file anchor needs resolved deletion evidence.
    for (const anchor of fileAnchors) {
      if (anchor.deleted !== true) continue;
      const proof = await hasDeletionProof(ctx, body, anchor.path);
      if (!proof.ok) return proof;
      if (proof.value) continue;
      hints.push('deleted_path_unverified');
    }
    return { ok: true, value: hints };
  }

  async function resolveFact(ctx: CoreCallContext, fact: NoteFactV1, budget: CheckBudget,
    itemObs: ItemObservations, caches: CheckCaches): Promise<Outcome<FactOutcome>> {
    switch (fact.kind) {
      case 'commit':
        return { ok: true, value: COMMIT_SHA.test(fact.sha)
          ? { kind: 'unchecked' } : { kind: 'unresolved', reason: 'invalid_commit_format' } };
      case 'note': {
        const note = await readHeadCached(ctx, fact.noteId, caches);
        if (!note.ok) {
          return { ok: true, value: note.code === 'not_found'
            ? { kind: 'unresolved', reason: 'not_found' } : { kind: 'unresolved', reason: 'unavailable' } };
        }
        if (note.value === null) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        if (fact.version > note.value.version) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        if (RETIRED_NOTE_STATES.includes(note.value.state)) return { ok: true, value: { kind: 'basis_note_retired' } };
        return { ok: true, value: { kind: 'untouched' } };
      }
      case 'file': {
        // R1: format before reading — a bad digest is the new
        // `invalid_file_digest`; a path outside the workspace is `forbidden`.
        if (!FILE_DIGEST.test(fact.digest)) return { ok: true, value: { kind: 'unresolved', reason: 'invalid_file_digest' } };
        if (!isSafeProjectPath(fact.path) || splitWorkspacePath(fact.path).path === '.') return { ok: true, value: { kind: 'unresolved', reason: 'forbidden' } };
        // R3: the fact's path shares the call-level observation budget.
        const observed = observeForItem(budget, itemObs, fact.path, fact.digest, 'raw');
        if (observed.outcome === 'unchecked') return { ok: true, value: { kind: 'budget' } };
        if (observed.outcome === 'deleted') return { ok: true, value: { kind: 'changed', path: fact.path, deleted: true } };
        if (observed.outcome === 'same') return { ok: true, value: { kind: 'untouched' } };
        if (observed.outcome === 'changed') return { ok: true, value: { kind: 'changed', path: fact.path, deleted: false } };
        return { ok: true, value: { kind: 'unresolved',
          reason: observed.outcome === 'forbidden' ? 'forbidden' : 'unavailable' } };
      }
      case 'record': {
        const refKey = canonicalJson(fact.ref as unknown as JsonValue);
        const read = await deps.records.readMany([refKey]);
        if (read.status !== 'ready') return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const record = read.value.records.find(candidate => candidate.refKey === refKey);
        const isMessage = (fact.ref as { aggregateType?: string }).aggregateType === 'SessionMessage';
        if (record === undefined) {
          return { ok: true, value: isMessage ? { kind: 'source_unavailable' } : { kind: 'unresolved', reason: 'not_found' } };
        }
        // R1: a record pointer resolves when its current revision is >= the
        // pointer's revision; the digest, when present, is not compared. This
        // applies to a `SessionMessage` too, before its decoder runs.
        if (fact.revision > record.revision) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        if (isMessage) {
          const decoded = decodeSessionMessageRecord(record);
          return { ok: true, value: decoded.status === 'decoded' ? { kind: 'untouched' } : { kind: 'source_unavailable' } };
        }
        const decoded = decodeRefKey(record.refKey);
        if (decoded.status === 'decoded' && decoded.value.aggregateType !== (fact.ref as { aggregateType?: string }).aggregateType) {
          return { ok: true, value: { kind: 'unresolved', reason: 'kind_mismatch' } };
        }
        return { ok: true, value: { kind: 'untouched' } };
      }
      case 'artifact': {
        // R1: existence through the raw artifact store; the check reads no body
        // and is not authorization-gated.
        if (deps.artifacts === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const read = await deps.artifacts.read(fact.ref);
        if (read.status === 'ready') return { ok: true, value: { kind: 'untouched' } };
        const code: string = read.code;
        return { ok: true, value: { kind: 'unresolved', reason: code === 'not_found' ? 'not_found'
          : code === 'forbidden' ? 'forbidden' : 'unavailable' } };
      }
      case 'kernel_history': {
        // R1: the Run record and its execution-history locator; the Kernel
        // entries themselves are never read here.
        const refKey = canonicalJson(fact.runRef as unknown as JsonValue);
        const read = await deps.records.readMany([refKey]);
        if (read.status !== 'ready') return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const record = read.value.records.find(candidate => candidate.refKey === refKey);
        if (record === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        const decoded = decodeRun(record);
        if (!decoded.ok) return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const history = decoded.value.executionHistory;
        if (history === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        const sessionMatches = history.sessionRef.projectId === fact.sessionRef.projectId
          && history.sessionRef.sessionId === fact.sessionRef.sessionId;
        const kernelMatches = history.kernel.adapterId === fact.adapterId
          && history.kernel.kernelSessionId === fact.kernelSessionId
          && history.kernel.runId === fact.kernelRunId && history.kernel.turnId === fact.turnId;
        if (!sessionMatches || !kernelMatches) return { ok: true, value: { kind: 'unresolved', reason: 'kind_mismatch' } };
        const observed = history.endPosition ?? history.observedThroughPosition;
        if (fact.throughPosition > observed) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        return { ok: true, value: { kind: 'untouched' } };
      }
      default:
        return { ok: true, value: { kind: 'untouched' } };
    }
  }

  /** L9: the staged repair's OWN Run (`stagedRunKey`) names the owning task. */
  async function stagedRepairTask(ctx: CoreCallContext, stagedRunKey: string | null, caches: CheckCaches):
  Promise<Outcome<{ goalId: string; taskId: string } | null>> {
    if (stagedRunKey === null) return { ok: true, value: null };
    const separator = stagedRunKey.indexOf('/');
    if (separator <= 0 || separator === stagedRunKey.length - 1) return { ok: true, value: null };
    // S2.6: one read per staged Run key for the whole call.
    const hit = caches.stagedRepair.get(stagedRunKey);
    if (hit !== undefined) return hit;
    const goalId = stagedRunKey.slice(0, separator);
    const runId = stagedRunKey.slice(separator + 1);
    const refKey = canonicalJson({ aggregateType: 'Run', projectId: ctx.projectId, goalId, runId } as unknown as JsonValue);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return okFalse('unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return okFalse('unavailable', 'the staged repair Run cannot be read');
    const decoded = decodeRun(record);
    if (!decoded.ok) return okFalse('unavailable', decoded.reason);
    const outcome: Outcome<{ goalId: string; taskId: string } | null> = { ok: true,
      value: { goalId: decoded.value.task.goalId, taskId: decoded.value.task.taskId } };
    caches.stagedRepair.set(stagedRunKey, outcome);
    return outcome;
  }

  /**
   * Slice 4B L22/P12 (M-13): similar notes for the write-side check. Candidate
   * set = current (accepted/reviewed/pending_review) notes sharing an anchor key,
   * excluding self and anything named in the subject's relations. Similarity is
   * Jaccard over the bigram windows of `normalize(topic) + "\n" +
   * normalize(conclusion)`. At most `NOTE_SIMILAR_MAX`, ties by `noteId`; it
   * never blocks a write.
   */
  async function similarNotes(ctx: CoreCallContext, body: CheckBody): Promise<Outcome<NoteSimilarV1[]>> {
    const keys = [body.anchor, ...body.extraAnchors].map(anchorKeyOf);
    const excluded = new Set<string>([body.noteId, ...body.replaces, ...body.contradicts, ...body.coexistWith]);
    const candidates = new Map<string, NoteHeadSnapshot>();
    for (const key of keys) {
      for (const index of S4_NOTE_BY_ANCHOR_LOOKUPS) {
        // L22: ONE bounded anchor-lookup page per index, never a next-loop.
        const page = await deps.records.lookup({ index, values: [ctx.projectId, key], limit: NOTE_SIMILAR_SCAN });
        if (page.status !== 'ready') return okFalse('unavailable', page.reason);
        for (const record of page.value.records) {
          const decoded = decodeNoteHeadSnapshot(record);
          if (decoded.status !== 'decoded') return okFalse('unavailable', 'damaged note head');
          const head = decoded.value;
          if (!anchorSlots(head).includes(key)) continue;
          if (excluded.has(head.noteId)) continue;
          if (head.state !== 'accepted' && head.state !== 'reviewed' && head.state !== 'pending_review') continue;
          candidates.set(head.noteId, head);
        }
      }
    }
    const windowsOf = (topic: string, conclusion: string): Set<string> =>
      new Set(bigramWindows(`${normalizeSearchText(topic)}\n${normalizeSearchText(conclusion)}`));
    const subject = windowsOf(body.topic, body.conclusion);
    const scored: NoteSimilarV1[] = [];
    for (const head of candidates.values()) {
      const other = windowsOf(head.topic, head.conclusion);
      let intersection = 0;
      for (const window of subject) if (other.has(window)) intersection += 1;
      const union = subject.size + other.size - intersection;
      const similarity = union === 0 ? 0 : intersection / union;
      if (similarity < NOTE_SIMILAR_MIN) continue;
      scored.push({ noteId: head.noteId, version: head.version,
        header: renderNoteHeader({ kind: head.kind, anchor: head.anchor, structural: head.structural,
          conclusion: head.conclusion, ...headerExtrasOf(head) }), similarity });
    }
    scored.sort((left, right) => right.similarity - left.similarity || (left.noteId < right.noteId ? -1 : 1));
    return { ok: true, value: scored.slice(0, NOTE_SIMILAR_MAX) };
  }

  /** S2.5: the item's body: the head, or the asked version (a supplied `snapshot` is ignored at the head version). */
  async function bodyOfItem(ctx: CoreCallContext, item: NoteHeadCheckItemV1): Promise<Outcome<CheckBody>> {
    if (item.version === item.head.version) return { ok: true, value: bodyOfHead(item.head) };
    let snapshot = item.snapshot;
    if (snapshot === undefined) {
      const version = await readVersion(ctx.projectId, item.head.noteId, item.version);
      if (!version.ok) return version;
      if (version.value === null) return okFalse('not_found', 'the note version does not exist');
      snapshot = version.value;
    }
    return { ok: true, value: bodyOfVersion(snapshot) };
  }

  /**
   * S2.5: the one item body shared by `checkNotes` (which reads the head and
   * version first) and `checkHeads` (which is handed them). Every file it
   * observes was read before the call's first item (R4).
   */
  async function checkItem(ctx: CoreCallContext, item: NoteHeadCheckItemV1, body: CheckBody, judgement: ItemJudgement,
    budget: CheckBudget, withSimilar: boolean, caches: CheckCaches):
  Promise<Outcome<CheckedItem>> {
    const head = item.head;
    const stagedRunKey: string | null = head.stagedRunKey;

    const cache = caches.heads;
    // S2.6 (b4): `conflicting`/`overQuota` are memoized per noteId@head.version.
    const derivationKey = `${head.noteId}@${String(head.version)}`;
    // §11.3 (b11): a derivation the read model already made (conflicts) is handed
    // over per item and used instead of being recomputed here.
    const suppliedConflicting = item.version === head.version
      ? (item as NoteHeadCheckItemV1 & { conflicting?: boolean }).conflicting : undefined;
    let derived = caches.derivations.get(derivationKey);
    if (derived === undefined) {
      const conflicting = suppliedConflicting === undefined
        ? await derivations.conflictingOf(ctx.projectId, head as NoteHeadLike, cache)
        : { ok: true as const, value: suppliedConflicting };
      if (!conflicting.ok) return conflicting;
      const overQuota = await derivations.overQuotaOf(ctx.projectId, head, cache);
      if (!overQuota.ok) return overQuota;
      derived = { conflicting: conflicting.value, overQuota: overQuota.value };
      caches.derivations.set(derivationKey, derived);
    }

    const changedFiles: { path: string; deleted: boolean }[] = [];
    const staleReasons: string[] = [];
    const unresolvedFacts: { index: number; reason: UnresolvedReason }[] = [];
    const uncheckedFacts: number[] = [];
    const hints: NoteHintV1[] = [];
    const itemObs: ItemObservations = new Map();
    let unchecked = false;
    let sourceUnavailable = false;

    // R3: the check's ONE observation pass. Basis files first, then file facts,
    // then file anchors; all share the call's distinct-file budget.
    for (const file of body.basis.files) {
      const observation = observeForItem(budget, itemObs, file.path, file.digest, 'raw');
      if (observation.outcome === 'changed') { changedFiles.push({ path: observation.path, deleted: false }); staleReasons.push('file_changed'); }
      else if (observation.outcome === 'deleted') { changedFiles.push({ path: observation.path, deleted: true }); staleReasons.push('file_deleted'); }
      else if (observation.outcome !== 'same') unchecked = true;
    }

    const definitions = await definitionStaleness(ctx, body, caches);
    if (!definitions.ok) return definitions;
    staleReasons.push(...definitions.value.staleReasons);
    if (definitions.value.unchecked) unchecked = true;

    // R13: deletion is the expected state for a `deleted: true` file anchor, so
    // a proving `file` fact's `deleted` outcome never makes the note stale.
    const deletedAnchorPaths = new Set([body.anchor, ...body.extraAnchors]
      .flatMap(anchor => anchor.kind === 'file' && anchor.deleted === true ? [anchor.path] : []));

    for (let index = 0; index < body.facts.length; index += 1) {
      if (budget.factsRemaining <= 0) { uncheckedFacts.push(index); unchecked = true; continue; }
      budget.factsRemaining -= 1;
      const resolved = await resolveFact(ctx, body.facts[index]!, budget, itemObs, caches);
      if (!resolved.ok) return resolved;
      const outcome = resolved.value;
      if (outcome.kind === 'budget') { uncheckedFacts.push(index); unchecked = true; }
      else if (outcome.kind === 'unchecked') uncheckedFacts.push(index);
      else if (outcome.kind === 'unresolved') unresolvedFacts.push({ index, reason: outcome.reason });
      else if (outcome.kind === 'changed') {
        if (outcome.deleted && deletedAnchorPaths.has(outcome.path)) continue;
        changedFiles.push({ path: outcome.path, deleted: outcome.deleted }); staleReasons.push('file_changed');
      }
      else if (outcome.kind === 'source_unavailable') sourceUnavailable = true;
      else if (outcome.kind === 'basis_note_retired') staleReasons.push('basis_note_retired');
    }

    let invalid = false;
    if (body.state === 'staged' && body.kind === 'repair') {
      const staged = await stagedRepairTask(ctx, stagedRunKey, caches);
      if (!staged.ok) return staged;
      if (staged.value === null) {
        // The staged repair's own Run cannot be identified; never guess live.
        unchecked = true;
      } else {
        const plan = await currentPlan(ctx, staged.value.goalId, caches);
        if (!plan.ok) return plan;
        if (plan.value !== null) {
          const task = plan.value.tasks.find(candidate => candidate.taskId === staged.value!.taskId);
          if (task === undefined || RETIRED_TASK_DISPOSITIONS.includes(task.disposition)) invalid = true;
        } else {
          unchecked = true;
        }
      }
    }

    const hintOutcome = await classFiveHints(ctx, body, budget.mainWorkspaceId, caches);
    if (!hintOutcome.ok) return hintOutcome;
    hints.push(...hintOutcome.value);

    const anchor = await anchorStatusOf(ctx, body, budget, itemObs, caches, judgement);
    if (!anchor.ok) return anchor;
    staleReasons.push(...anchor.value.staleReasons);
    if (anchor.value.unchecked) unchecked = true;

    // R5/R7: a link reads its kept second-tier conclusion, else its first tier (judged before the items).
    const linkVerification = judgement.link?.verification;
    const linkRead = judgement.link?.read ?? null;

    let freshness: NoteCheckV1['freshness'] = 'fresh';
    if (unchecked || unresolvedFacts.length > 0) freshness = 'unchecked';
    else if (staleReasons.length > 0 || anchor.value.retired) freshness = 'stale';

    const stateEligible = body.state === 'accepted' || body.state === 'reviewed';
    // R11: only the head version can be a current conclusion, even when the
    // caller reaches `checkNotes` directly (the read model's own mask is not
    // the only boundary).
    const isHeadVersion = item.version === head.version;
    // L9/§11.4: an `accepted` note is a current conclusion only in the caller's
    // own goal or when the user confirmed it; `reviewed` carries no goal
    // condition, and the project understanding is current for every goal.
    const callerGoalId = ctx.principal.kind === 'work_run' ? ctx.principal.runRef.goalId : null;
    const isProjectUnderstanding = body.kind === 'understanding' && body.anchor.kind === 'project';
    // A link is read across goals by the Host route, so the general note's
    // own-goal term does not apply to it.
    const ownGoalEligible = body.kind === 'link' || isProjectUnderstanding || body.state !== 'accepted'
      || callerGoalId === null || head.goalId === callerGoalId || head.confirmedByUser;
    // R10: a link is current only while every anchor slot is live and its read is neither broken nor unchecked.
    const slotsLive = body.kind !== 'link' || anchor.value.anchorSlots.every(slot => slot.status === 'live');
    const eligibleBase = stateEligible && ownGoalEligible && isHeadVersion && freshness === 'fresh'
      && !derived.conflicting && !invalid && !sourceUnavailable && !anchor.value.retired && unresolvedFacts.length === 0
      && slotsLive;
    const currentEligible = eligibleBase && linkReadCurrent(linkVerification);

    let similar: NoteSimilarV1[] | undefined;
    if (withSimilar) {
      const computed = await similarNotes(ctx, body);
      if (!computed.ok) return computed;
      similar = computed.value;
    }

    // §11.5/M-12: only an accepted/reviewed HEAD understanding on a goal or
    // stage anchor carries `updateDue`; the project anchor and every other item
    // stay `null` (M-12g).
    let updateDue: boolean | null = null;
    if (isHeadVersion && body.kind === 'understanding'
      && (body.anchor.kind === 'goal' || body.anchor.kind === 'stage')
      && (body.state === 'accepted' || body.state === 'reviewed')) {
      const status = await understandingOfAnchorKey(ctx, anchorKeyOf(body.anchor), caches);
      if (!status.ok) return status;
      updateDue = status.value.updateDue;
    }

    const result: NoteCheckV1 = {
      noteId: body.noteId, version: body.version,
      observedFiles: [...itemObs.values()],
      freshness, changedFiles, staleReasons,
      sourceUnavailable, invalid, conflicting: derived.conflicting, overQuota: derived.overQuota, updateDue,
      currentEligible,
      anchorStatus: anchor.value.retired ? 'retired' : 'live',
      anchorRetiredReasons: anchor.value.reasons,
      anchorSlots: anchor.value.anchorSlots,
      retiredExtraAnchors: anchor.value.retiredExtraAnchors,
      unresolvedFacts, uncheckedFacts, hints,
      // The read-time result: the first tier's, or the kept second-tier conclusion.
      ...(linkVerification === undefined ? {} : { linkVerification }),
      ...(similar === undefined ? {} : { similar }),
    };
    return { ok: true, value: { result, head, link: body.kind === 'link' ? { read: linkRead, eligibleBase } : null } };
  }

  /** R8/R9: a link's read updates the doubtful queue and the broken register of its head version. */
  function registerLinkRead(ctx: CoreCallContext, entry: CheckedItem, heldByRun: string | undefined): void {
    const verification = entry.result.linkVerification;
    if (entry.link === null || verification === undefined) return;
    const head = entry.head;
    const key = linkKey(ctx, head.noteId);
    // Every state change bumps the version, so an entry of an older version is out of date.
    if (doubtful.get(key)?.version !== head.version) doubtful.delete(key);
    if (broken.get(key)?.version !== head.version) broken.delete(key);
    if (entry.result.version !== head.version) return;
    if (verification.status === 'unchecked' && verification.reason === 'refs_pending') doubtful.set(key, registerEntry(ctx, head));
    else if (verification.status !== 'unchecked') doubtful.delete(key);
    registerBroken(ctx, head, verification, heldByRun);
  }

  /** R9: an accepted/reviewed head version read `broken` is registered, with the Run it was read for when given. */
  function registerBroken(ctx: CoreCallContext, head: NoteHeadSnapshot, verification: LinkVerificationV1,
    heldByRun: string | undefined): void {
    const key = linkKey(ctx, head.noteId);
    if (verification.status !== 'broken' || (head.state !== 'accepted' && head.state !== 'reviewed')) {
      broken.delete(key);
      return;
    }
    const held = broken.get(key);
    broken.set(key, { ...registerEntry(ctx, head),
      heldByRun: heldByRun ?? (held?.version === head.version ? held.heldByRun : null) });
  }

  /** The shared pass of both entries: the bodies, the one gate read, each item, then the Host registers. */
  async function checkAll(ctx: CoreCallContext, items: readonly NoteHeadCheckItemV1[], caches: CheckCaches,
    withSimilar: boolean, heldByRun: string | undefined):
  Promise<Outcome<{ items: CheckedItem[]; mainWorkspaceId: string }>> {
    const bodies: CheckBody[] = [];
    for (const item of items) {
      const body = await bodyOfItem(ctx, item);
      if (!body.ok) return body;
      bodies.push(body.value);
    }
    const budget = newCheckBudget(limits);
    try {
      const notPlanned = await readPlanned(ctx, bodies, budget);
      if (notPlanned !== null) return notPlanned;
      // R3: every item's single-file work first, in item order, while the Python/C++ lookups run; then the one wait.
      const judgements = bodies.map(body => judgeItem(ctx, body, budget));
      await settleNatives(budget);
      const checked: CheckedItem[] = [];
      for (const [index, item] of items.entries()) {
        const outcome = await checkItem(ctx, item, bodies[index]!, judgements[index]!, budget, withSimilar, caches);
        if (!outcome.ok) return outcome;
        checked.push(outcome.value);
      }
      for (const entry of checked) registerLinkRead(ctx, entry, heldByRun);
      return { ok: true, value: { items: checked, mainWorkspaceId: budget.mainWorkspaceId } };
    } finally {
      if (budget.natives.timer !== null) clearTimeout(budget.natives.timer);
    }
  }

  /**
   * R6: the head-version links read `refs_pending` (no kept conclusion), by `noteId`, at most
   * `NOTE_LINK_VERIFY_MAX`, go to one second-tier request, one group per link of its doubtful parts.
   * The answers replace those parts and the link is merged again. An `agent` caller waits at most
   * `checkDeadlineMs`; past it the whole batch reads `budget`, while the request still finishes and
   * is kept as if it had been waited for. Failure in any form is a `failed` answer.
   */
  async function verifyDoubtful(ctx: CoreCallContext, checked: readonly CheckedItem[],
    priority: NoteLinkVerifyV1['priority'], heldByRun: string | undefined, mainWorkspaceId: string): Promise<void> {
    const byNote = new Map<string, CheckedItem[]>();
    for (const entry of checked) {
      const verification = entry.result.linkVerification;
      if (entry.link?.read == null || entry.result.version !== entry.head.version
        || verification?.status !== 'unchecked' || verification.reason !== 'refs_pending') continue;
      byNote.set(entry.head.noteId, [...(byNote.get(entry.head.noteId) ?? []), entry]);
    }
    const links = [...byNote.keys()].sort().slice(0, NOTE_LINK_VERIFY_MAX).map(noteId => byNote.get(noteId)!);
    if (links.length === 0) return;
    const reads = links.map(entries => entries[0]!.link!.read!);
    const verify = workspace?.verify;
    // One analysis reads one workspace: resolve each link's question paths and
    // send its group to that workspace's analyzer, with workspace-relative
    // paths. A link whose two files span workspaces stays doubtful (the same
    // rule the write side uses), and one workspace's failure keeps its links
    // doubtful without hiding another workspace's answers.
    const pending = links.map((entries, index) => {
      const questions = reads[index]!.parts.flatMap(part =>
        part.status === 'doubt' && part.question !== null ? [part.question] : []);
      if (questions.length === 0) return null;
      let workspaceId: string | null = null;
      const relative: ReferenceQuestionV1[] = [];
      for (const question of questions) {
        let definition: { workspaceId: string; path: string };
        let evidence: { workspaceId: string; path: string };
        try {
          definition = resolveStoredProjectPath(question.definition.path, mainWorkspaceId);
          evidence = resolveStoredProjectPath(question.evidence.path, mainWorkspaceId);
        } catch { return null; }
        if (definition.workspaceId !== evidence.workspaceId) return null;
        if (workspaceId !== null && workspaceId !== definition.workspaceId) return null;
        workspaceId = definition.workspaceId;
        relative.push({ definition: { ...question.definition, path: definition.path },
          evidence: { ...question.evidence, path: evidence.path } });
      }
      return workspaceId === null ? null : { index, workspaceId, questions: relative };
    });
    const byWorkspace = new Map<string, { index: number; questions: ReferenceQuestionV1[] }[]>();
    for (const item of pending) {
      if (item === null) continue;
      byWorkspace.set(item.workspaceId, [...(byWorkspace.get(item.workspaceId) ?? []),
        { index: item.index, questions: item.questions }]);
    }
    const results = new Map<number, ReferenceCheckResultV1 | null>();
    const requests = [...byWorkspace].map(async ([workspaceId, items]) => {
      if (verify === undefined) return;
      const wctx = { ...ctx, workspaceId };
      let result: ReferenceCheckResultV1 | null;
      try {
        const answer = await verify(wctx, { workspace: workspaceRef(wctx), priority,
          groups: items.map(item => item.questions) });
        result = answer.status === 'ready' ? answer.value : null;
      } catch {
        result = null;
      }
      for (const [offset, item] of items.entries()) {
        results.set(item.index, result === null ? null : {
          answers: links.map((_, index) => index === item.index ? (result.answers[offset] ?? []) : []),
          analysed: result.analysed.map(entry => ({ ...entry,
            path: qualifyProjectPath(workspaceId, entry.path, mainWorkspaceId) })),
          config: result.config === null ? null
            : { path: qualifyProjectPath(workspaceId, result.config.path, mainWorkspaceId), digest: result.config.digest },
        });
      }
    });
    const settled = Promise.all(requests).then(() => links.map((entries, index) =>
      settleLink(ctx, entries[0]!.head, reads[index]!, results.get(index) ?? null, index, heldByRun)));
    let conclusions: LinkVerificationV1[] | null;
    if (priority === 'agent') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), limits.checkDeadlineMs ?? NOTE_CHECK_DEADLINE_MS); });
      conclusions = await Promise.race([settled, deadline]);
      clearTimeout(timer);
    } else {
      conclusions = await settled;
    }
    links.forEach((entries, index) => {
      const verification: LinkVerificationV1 = conclusions?.[index] ?? { status: 'unchecked', reason: 'budget' };
      for (const entry of entries) {
        entry.result = { ...entry.result, linkVerification: verification,
          currentEligible: entry.link!.eligibleBase && linkReadCurrent(verification) };
      }
    });
  }

  /**
   * R6/R7: one link's second-tier answers merged into its first tier. The conclusion is kept only
   * when every answer has a definite reason and the analysed files (and the configuration, when it
   * is the gate's) still have the digests the first tier read; otherwise this read is `unavailable`.
   */
  function settleLink(ctx: CoreCallContext, head: NoteHeadSnapshot, read: LinkRead, result: ReferenceCheckResultV1 | null,
    index: number, heldByRun: string | undefined): LinkVerificationV1 {
    const answers = result?.answers[index];
    let next = 0;
    const parts = read.parts.map(part => part.status === 'doubt' && part.question !== null
      ? { ...part, status: answeredStatus(answers?.[next++]) } : part);
    const configAgrees = result?.config == null || read.config === null || result.config.path !== read.config.path
      || result.config.digest === read.config.digest;
    let conclusion = linkVerificationOfParts(parts);
    const key = linkKey(ctx, head.noteId);
    if (result !== null && (!analysedDigestsMatch(result.analysed, read.files) || !configAgrees)) {
      conclusion = { status: 'unchecked', reason: 'unavailable' };
    } else if (result !== null && answers !== undefined && answers.every(recordableAnswer)) {
      linkConclusions.set(key, { version: head.version, gate: { files: read.files, config: result.config }, conclusion });
      // A newer version queued meanwhile has no conclusion yet and stays queued.
      if (doubtful.get(key)?.version === head.version) doubtful.delete(key);
    }
    registerBroken(ctx, head, conclusion, heldByRun);
    return conclusion;
  }

  return {
    /**
     * S2.5: the public shape is unchanged. It reads the head and version with
     * today's mapping and then runs the shared item body.
     */
    async checkNotes(ctx, input): Promise<ReadResult<NoteCheckV1[]>> {
      if (!Array.isArray(input.items)) return { status: 'rejected', code: 'invalid', reason: 'items must be an array' };
      // R2: the record caches live for one call; only the Host memory above outlives it.
      const caches = newCheckCaches();
      const items: NoteHeadCheckItemV1[] = [];
      for (const item of input.items) {
        if (typeof item?.noteId !== 'string' || item.noteId.length === 0 || !Number.isSafeInteger(item.version)) {
          return { status: 'rejected', code: 'invalid', reason: 'each item needs a note id and a version' };
        }
        const headOutcome = await readHeadCached(ctx, item.noteId, caches);
        if (!headOutcome.ok) return mapStoreFailure(headOutcome);
        if (headOutcome.value === null) return mapStoreFailure(okFalse('not_found', 'the note does not exist'));
        items.push({ head: headOutcome.value, version: item.version });
      }
      const checked = await checkAll(ctx, items, caches, input.withSimilar === true, input.heldByRun);
      if (!checked.ok) return mapStoreFailure(checked);
      if (input.verifyLinks !== undefined) {
        await verifyDoubtful(ctx, checked.value.items, input.verifyLinks.priority, input.heldByRun,
          checked.value.mainWorkspaceId);
      }
      return { status: 'ready', value: checked.value.items.map(entry => entry.result) };
    },
    /**
     * S2.5: the internal entry the read model uses. The heads arrive from
     * records read in the same call; the check never re-reads them.
     */
    async checkHeads(ctx, input): Promise<ReadResult<{ items: NoteCheckV1[]; understanding: UnderstandingStatusV1[] }>> {
      if (!Array.isArray(input.items)) return { status: 'rejected', code: 'invalid', reason: 'items must be an array' };
      const caches = newCheckCaches();
      if (input.anchorSets !== undefined) {
        // S2.3: seed exactly the sets the read model already read, keyed as its
        // own anchor cache keys them (never from a filtered set).
        for (const [key, heads] of input.anchorSets) caches.heads.anchors.set(key, { ok: true, value: heads });
      }
      if (input.planWindows !== undefined) {
        // The read model's related-scope resolution already
        // read these goals' active plan windows; seed the check's own per-call
        // cache so `currentPlan` does not read the same window twice.
        for (const [key, plan] of input.planWindows) caches.plans.set(key, { ok: true, value: plan });
      }
      if (input.understandingPointers !== undefined) {
        // The caller already read these pointers and pointed
        // heads; seed them so `computeUnderstandingOfAnchorKey` skips its own
        // per-anchor pointer and head reads for the whole call.
        for (const [key, seed] of input.understandingPointers) caches.understandingSeed.set(key, seed);
      }
      for (const item of input.items) {
        if (item?.head === undefined || typeof item.head.noteId !== 'string'
          || !Number.isSafeInteger(item.version)) {
          return { status: 'rejected', code: 'invalid', reason: 'each item needs a head and a version' };
        }
      }
      const checked = await checkAll(ctx, input.items, caches, false, undefined);
      if (!checked.ok) return mapStoreFailure(checked);
      const results = checked.value.items.map(entry => entry.result);
      // U-3: the same caches answer the requested understanding anchors
      // (pointers, triggers and the plan), so `lookup` no longer reads its own.
      const understanding: UnderstandingStatusV1[] = [];
      for (const anchorKey of input.understandingAnchors ?? []) {
        const status = await understandingOfAnchorKey(ctx, anchorKey, caches);
        if (!status.ok) return mapStoreFailure(status);
        understanding.push(status.value);
      }
      return { status: 'ready', value: { items: results, understanding } };
    },
    doubtfulLinks(scope, max) {
      return [...doubtful.values()]
        .filter(entry => entry.projectId === scope.projectId && entry.workspaceId === scope.workspaceId)
        .sort((left, right) => (left.noteId < right.noteId ? -1 : left.noteId > right.noteId ? 1 : 0))
        .slice(0, max).map(entry => ({ noteId: entry.noteId, version: entry.version }));
    },
    brokenLinks(scope) {
      return [...broken.values()]
        .filter(entry => entry.projectId === scope.projectId && entry.workspaceId === scope.workspaceId)
        .map(entry => ({ noteId: entry.noteId, version: entry.version, heldByRun: entry.heldByRun }));
    },
  };
}
