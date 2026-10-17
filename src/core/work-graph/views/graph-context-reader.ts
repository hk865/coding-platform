/**
 * Slice 3 WorkGraph `views` read model (part 2).
 *
 * `createGraphContextReader(deps)` is the ONE read-only graph/context view. It
 * never writes a record, never calls a transition and never opens material
 * except through the exact input owner. Each public read is scope/shape-first:
 * a malformed request or cursor is refused before the first record read.
 *
 * Two private bridges keep the Host-only owner seams intact:
 *  - `resolveGraphSessionReadContext`: Host/work_run pass through; a QueryRun is
 *    fully verified against its canonical QueryJob/QueryRun, request Goal and
 *    ORIGINAL submission initiator before a same-scope internal Host context is
 *    built for `sessions.findSessions/readSession` only.
 *  - `resolveGraphExecutionReadContext`: Host passes through; Query reuses that
 *    verified context; a work_run's canonical Run is verified before a
 *    same-scope internal Host context carrying `deps.hostActor` is built for
 *    `executions.readExecution/listExecutions` only.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  AttentionGraphReadRequestV1, ContextExtensionsV1, ContextSourceV1,
  GraphAttentionDetailV1, GraphAttentionFactsV1, GraphNodeRefV1,
  InputDeclarationV1, InputSelectionV1,
} from '../../../contracts/graph-context.js';
import type { ArchitectureBaselineRevisionRef } from '../../../contracts/governance.js';
import type { AggregateRef, GoalRef, GoalSnapshot, VersionedRef } from '../../../contracts/ledger.js';
import type {
  AcceptanceObligation, DependencyRequirement, PlanRevisionRef, PlanRevisionSnapshot,
  PlanStage, PlanTaskAssignment, RuntimeTask,
} from '../../../contracts/plan.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { EncodedRecord, StoreFailure } from '../../record-store/ports.js';
import type { LookupValue } from '../../record-store/lookup-ports.js';
import { normalizeSearchText } from '../../record-store/lookup-index.js';
import { pathOwnershipOf } from '../notes/note-path-ownership.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../model/execution-read-contracts.js';
import type { TaskContextInputPort } from '../model/context-input-contracts.js';
import type { TaskGraph, TaskRow } from '../model/plan-contracts.js';
import type { SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  ContextReadRequestV1, GraphContextFactsV1, GraphContextReadPort, GraphFindRequestV1,
  GraphLookRequestV1, GraphReadPageV1, GraphTaskCardV1, NodeCardV1,
} from '../model/graph-context-contracts.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  decodeVerificationRoundSnapshot, VERIFICATION_ROUND_BY_TASK_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import {
  decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  decodeQueryJobSnapshot, decodeQueryJobSubmittedEvent, decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import { decodeGoalSnapshot, canonicalRefKey } from '../persistence/record-codecs.js';
import { isBasisUnsupported, planTaskFacts } from '../tasks/plan-task-basis.js';

export type GraphContextReaderDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  goals: Pick<PlanTaskPort, 'queryGoal'>;
  plans: Pick<PlanTaskPort, 'queryTaskGraph'>;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession'>;
  executions: ExecutionReadPort;
  inputs: TaskContextInputPort;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  extensions?: (ctx: CoreCallContext, request: ContextReadRequestV1) => Promise<ReadResult<ContextExtensionsV1>>;
};

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

const KIND_ORDER: Record<GraphNodeRefV1['kind'], number> = {
  goal: 0, stage: 1, task: 2, module: 3, session: 4, run: 5, round: 6,
};
const GRAPH_RELATIONS = ['card', 'children', 'neighbours', 'executions', 'checks'] as const;
/** Fixed in-call page budget for every underlying owner list. Reaching it is
 * `incomplete`: a partial candidate list is never published as the full set. */
const GRAPH_PAGE_BUDGET = 50;
const ROUND_LOOKUP_LIMIT = 50;
const SESSION_PAGE_LIMIT = 200;
const EXECUTION_PAGE_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function rejected<T>(code: CoreError, reason: string): ReadResult<T> {
  return { status: 'rejected', code, reason };
}
/** Propagate a non-ready dependency read without inventing a value. */
function propagate<T>(result: ReadResult<unknown>): ReadResult<T> {
  if (result.status === 'ready') throw new Error('propagate expects a non-ready read result');
  if (result.status === 'not_found') return { status: 'not_found' };
  if (result.status === 'not_ready') return result;
  return result;
}
/** One RecordStore failure maps to one Core rejection; `corrupt`/store damage is
 * `unavailable`, never an empty or partial result. */
function storeFailureRead<T>(failure: StoreFailure): ReadResult<T> {
  if (failure.code === 'not_found') return { status: 'not_found' };
  if (failure.code === 'invalid') return rejected('invalid', failure.reason);
  if (failure.code === 'unsupported') return rejected('incomplete', failure.reason);
  return rejected('unavailable', `${failure.code}: ${failure.reason}`);
}
/** Snapshot the caller's trusted scope/identity synchronously; later awaits
 * never observe a caller mutating the object it passed in. The AbortSignal is
 * shared deliberately. */
function cloneCallContext(ctx: CoreCallContext): CoreCallContext {
  return {
    projectId: ctx.projectId,
    ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
    principal: structuredClone(ctx.principal),
    materialReader: structuredClone(ctx.materialReader),
    signal: ctx.signal,
  };
}
function compareRefKeys(left: { ref: unknown }, right: { ref: unknown }): number {
  const a = canonicalJson(left.ref as unknown as JsonValue);
  const b = canonicalJson(right.ref as unknown as JsonValue);
  return a < b ? -1 : a > b ? 1 : 0;
}
/** §4.5: the attention graph keys stay the legacy `kind:id` strings the AT
 * cases use, so a node is located across scans by the same key. */
function attentionKey(node: GraphNodeRefV1): string {
  switch (node.kind) {
    case 'goal': return 'goal:' + node.ref.goalId;
    case 'stage': return 'stage:' + node.stageId;
    case 'task': return 'task:' + node.ref.taskId;
    case 'module': return 'module:' + node.ref.moduleId;
    case 'session': return 'session:' + node.ref.sessionId;
    case 'run': return 'run:' + node.ref.runId;
    case 'round': return 'round:' + node.ref.roundId;
  }
}
/** §4.5 / slice 0: the exact edge signatures the legacy scanner produced. */
function attentionEdges(
  graph: TaskGraph | null,
  plan: PlanRevisionSnapshot | null,
  architecture: AdoptedArchitecture | null,
): string[] {
  const edges: string[] = [];
  if (plan !== null) {
    for (const edge of plan.executionDag.dependsOn) {
      edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires.kind + ':' + edge.requires.label);
    }
    for (const edge of plan.taskHierarchy.parentOf) edges.push('parent:' + edge.parentTaskId + '->' + edge.childTaskId);
  }
  for (const row of graph?.tasks ?? []) {
    for (const relation of row.relations) {
      edges.push('relation:' + relation.fromTaskId + '->' + relation.toTaskId + ':' + relation.kind);
    }
  }
  for (const dependency of architecture?.dependencies ?? []) {
    edges.push('arch-depends:' + dependency.from.moduleId + '->' + dependency.to.moduleId);
  }
  for (const pair of architecture?.containment?.parentOf ?? []) {
    edges.push('arch-parent:' + pair.parent.moduleId + '->' + pair.child.moduleId);
  }
  return [...new Set(edges)].sort();
}
function attentionSource(ref: AggregateRef, revision: number, digest: string | null = null): ContextSourceV1 {
  return { kind: 'record', ref, revision, digest };
}
function nodeKey(node: GraphNodeRefV1): string {
  return canonicalJson(node as unknown as JsonValue);
}
function compareNodes(left: GraphNodeRefV1, right: GraphNodeRefV1): number {
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kind !== 0) return kind;
  const a = nodeKey(left);
  const b = nodeKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
function dedupeSort(nodes: readonly GraphNodeRefV1[]): GraphNodeRefV1[] {
  const seen = new Set<string>();
  const out: GraphNodeRefV1[] = [];
  for (const node of nodes) {
    const key = nodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  out.sort(compareNodes);
  return out;
}
/** G-04/RW-13: the query's owner among the modules. Module identity is decided
 * by ONE `pathOwnershipOf` candidate per module carrying all of its paths, so
 * `src` and `src/` of one module are not a tie; two different modules sharing
 * the longest path are a `tie`, and both are returned with that shared path.
 * The winning stripped prefix (`.` for the root) comes straight from the shared
 * decision, so no private prefix matcher is needed. */
type PathSearchOwnership =
  | { status: 'owner'; path: string }
  | { status: 'none' }
  | { status: 'tie'; path: string };

function longestPathOwner(modules: readonly { paths: readonly string[] }[], query: string): PathSearchOwnership {
  const normalized = normalizeSearchText(query);
  // Item 4a: ownership is decided on the normalised, stripped paths, so the
  // candidate's value carries exactly those paths and the owner path is the
  // shared decision's winning prefix (a raw `Src` must not lose the `src/a.ts`
  // query).
  const candidates = modules.map((module) => {
    const paths = module.paths
      .map((raw) => normalizeSearchText(raw))
      .map((raw) => (raw.endsWith('/') ? raw.slice(0, -1) : raw))
      .filter((path) => path.length > 0);
    return { value: paths, paths };
  });
  const ownership = pathOwnershipOf(normalized, candidates);
  if (ownership.status === 'none') return { status: 'none' };
  // The tied candidates share one winning prefix string; `prefix` is it.
  return { status: ownership.status, path: ownership.prefix };
}
/** G-04: equality, directory-boundary ownership or a directory under the query.
 * A `tie` is treated like an owner carrying the shared winning path, so every
 * tied module matches; `none` still matches any path under the query. The
 * directory-under branch uses the stripped path (`src/` is the query `src`'s own
 * directory, not one under it). */
function pathMatches(value: string, needle: string, ownership: PathSearchOwnership): boolean {
  const normalized = normalizeSearchText(value);
  const path = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (ownership.status === 'none') return path.startsWith(`${needle}/`);
  if (path === needle) return true;
  if (path === ownership.path) return true;
  return path.startsWith(`${needle}/`);
}
function sameActor(left: ActorRef, right: ActorRef): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === 'agent' && right.kind === 'agent') {
    return left.runRef.projectId === right.runRef.projectId && left.runRef.goalId === right.runRef.goalId
      && left.runRef.runId === right.runRef.runId;
  }
  return true;
}
function refProblem(value: unknown, fields: readonly string[], aggregateType?: string): string | null {
  if (!isRecord(value)) return 'a ref must be an object';
  if (aggregateType !== undefined && value['aggregateType'] !== aggregateType) {
    return `a ref must carry aggregateType ${aggregateType}`;
  }
  for (const field of fields) if (!nonEmpty(value[field])) return `a ref requires ${field}`;
  return null;
}
const TASK_TRIPLE_FIELDS = ['projectId', 'goalId', 'taskId'] as const;
const PLAN_REF_FIELDS = ['projectId', 'planId'] as const;
const ROUND_REF_FIELDS = ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId'] as const;

function goalRefProblem(value: unknown): string | null {
  return refProblem(value, ['projectId', 'goalId'], 'Goal');
}
function planRefProblem(value: unknown): string | null {
  return refProblem(value, PLAN_REF_FIELDS, 'PlanRevision');
}
function nodeShapeProblem(node: unknown): string | null {
  if (!isRecord(node)) return 'target.node must be an object';
  switch (node['kind']) {
    case 'goal': return refProblem(node['ref'], ['projectId', 'goalId'], 'Goal');
    case 'stage': return planRefProblem(node['planRef']) ?? (nonEmpty(node['stageId']) ? null : 'a stage node requires stageId');
    case 'task': return refProblem(node['ref'], TASK_TRIPLE_FIELDS) ?? planRefProblem(node['planRef']);
    case 'module': return refProblem(node['ref'], ['projectId', 'moduleId']);
    case 'session': return refProblem(node['ref'], ['projectId', 'sessionId']);
    case 'run': return refProblem(node['ref'], ['projectId', 'goalId', 'runId'], 'Run');
    case 'round': return refProblem(node['ref'], ROUND_REF_FIELDS, 'VerificationRound');
    default: return 'target.node.kind is not recognized';
  }
}
/** `null` means in scope; a non-null reason is a `forbidden` refusal. */
function nodeScopeProblem(node: GraphNodeRefV1, projectId: string, workspaceId: string | undefined, goal: GoalRef): string | null {
  switch (node.kind) {
    case 'goal':
      return node.ref.projectId === projectId && node.ref.goalId === goal.goalId
        ? null : 'the Goal node is outside the requested goal';
    case 'stage':
      return node.planRef.projectId === projectId ? null : 'the Stage node is outside the requested project';
    case 'task':
      return node.ref.projectId === projectId && node.ref.goalId === goal.goalId
        ? null : 'the Task node is outside the requested goal';
    case 'module':
      return node.ref.projectId === projectId ? null : 'the Module node is outside the requested project';
    case 'session':
      return node.ref.projectId === projectId ? null : 'the Session node is outside the requested project';
    case 'run':
      return node.ref.projectId === projectId && node.ref.goalId === goal.goalId
        ? null : 'the Run node is outside the requested goal';
    case 'round':
      return node.ref.projectId === projectId && node.ref.goalId === goal.goalId
        && (workspaceId === undefined || node.ref.workspaceId === workspaceId)
        ? null : 'the Round node is outside the requested scope';
  }
}
/** The path grammar: no drive letter, backslash, empty segment, `.` segment or
 * `..`, no NUL; the project root is the single explicit `.` locator. */
function pathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'path must be a non-empty string';
  if (path.includes('\u0000')) return 'path must not contain NUL';
  if (path.includes('\\')) return 'path must not contain a backslash';
  if (/^[a-zA-Z]:/.test(path)) return 'path must not carry a drive letter';
  if (path === '.') return null;
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') return 'path must not contain an empty segment';
    if (segment === '.') return 'path must not contain a dot segment';
    if (segment === '..') return 'path must not contain a parent segment';
  }
  return null;
}
function pageLimitProblem(limit: unknown): string | null {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return 'page.limit must be an integer between 1 and 100';
  }
  return null;
}
function parsePage(page: unknown): { limit: number; afterCursor: string | null } | string {
  if (!isRecord(page)) return 'the read requires a page with afterCursor and limit';
  const limit = page['limit'];
  const limitProblem = pageLimitProblem(limit);
  if (limitProblem !== null) return limitProblem;
  const afterCursor = page['afterCursor'];
  if (afterCursor !== null && typeof afterCursor !== 'string') return 'page.afterCursor must be a string or null';
  return { limit: limit as number, afterCursor: afterCursor as string | null };
}

// -------------------------------------------------------------------------- //
// Cursor codec                                                                //
// -------------------------------------------------------------------------- //

type PageCursor = { v: 1; scopeKey: string; queryKey: string; basisKey: string; offset: number };

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeCursor(raw: string): PageCursor | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed['v'] !== 1) return null;
  const scopeKey = parsed['scopeKey'];
  const queryKey = parsed['queryKey'];
  const basisKey = parsed['basisKey'];
  const offset = parsed['offset'];
  if (!nonEmpty(scopeKey) || !nonEmpty(queryKey) || !nonEmpty(basisKey)) return null;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return null;
  return { v: 1, scopeKey, queryKey, basisKey, offset };
}
/** Original (never internal-bridge) principal identity hashed into `scopeKey`. */
function originalPrincipalIdentity(ctx: CoreCallContext): JsonValue {
  const principal = ctx.principal;
  if (principal.kind === 'host') return { kind: 'host', actor: principal.actor };
  if (principal.kind === 'work_run') return { kind: 'work_run', runRef: principal.runRef };
  return { kind: 'query_run', queryRunRef: principal.queryRunRef };
}
function scopeKeyOf(ctx: CoreCallContext, goal: GoalRef): string {
  return sha256Hex(canonicalJson({
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId ?? null,
    goalId: goal.goalId,
    principal: originalPrincipalIdentity(ctx),
  } as unknown as JsonValue));
}
function lookQueryKey(request: GraphLookRequestV1): string {
  const target = request.target.kind === 'path'
    ? { kind: 'path', path: request.target.path }
    : { kind: 'node', node: request.target.node };
  return sha256Hex(canonicalJson({
    kind: 'look', relation: request.relation, target, limit: request.page.limit,
  } as unknown as JsonValue));
}
function findQueryKey(request: GraphFindRequestV1): string {
  return sha256Hex(canonicalJson({ kind: 'find', needle: request.needle, limit: request.page.limit } as unknown as JsonValue));
}

// -------------------------------------------------------------------------- //
// Store read helpers                                                          //
// -------------------------------------------------------------------------- //

type Batch = { present: Map<string, EncodedRecord>; missing: Set<string>; readThrough: CommitCursor | null };

function emptyExtensions(): ContextExtensionsV1 {
  return {
    notes: { availability: 'not_implemented', rows: [] },
    anomalies: { availability: 'not_implemented', rows: [] },
    footprint: { availability: 'not_implemented', rows: [] },
    goalSettings: { availability: 'not_implemented', autonomy: null },
    decisions: { availability: 'not_implemented', rows: [] },
  };
}

function internalHostContext(ctx: CoreCallContext, actor: Extract<ActorRef, { kind: 'human' | 'system' }>): CoreCallContext {
  const projectId = ctx.projectId;
  const workspaceId = ctx.workspaceId;
  const materialReader: MaterialReader = {
    kind: 'host', projectId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    actor,
  };
  return {
    projectId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    principal: { kind: 'host', actor },
    materialReader,
    signal: ctx.signal,
  };
}

/** The wired index extensions, or the five `not_implemented` rows when absent.
 * A throw or a rejection is returned as the real refusal, never made available. */
async function readIndexes(
  extensions: GraphContextReaderDependencies['extensions'],
  ctx: CoreCallContext,
  request: ContextReadRequestV1,
): Promise<ReadResult<ContextExtensionsV1>> {
  if (extensions === undefined) return { status: 'ready', value: emptyExtensions() };
  try {
    const read = await extensions(ctx, request);
    if (read.status !== 'ready') return propagate(read);
    return read;
  } catch (error) {
    return rejected('unavailable', `the context extensions read failed: ${messageOf(error)}`);
  }
}

// -------------------------------------------------------------------------- //
// Universe assembly                                                           //
// -------------------------------------------------------------------------- //

type Universe = {
  goal: GoalSnapshot;
  workspace: VersionedRef | null;
  plan: PlanRevisionSnapshot | null;
  graph: TaskGraph | null;
  architecture: AdoptedArchitecture | null;
  baseline: ArchitectureBaselineRevisionRef | null;
  baselineRevision: number | null;
  baselineDigest: string | null;
  sessionCards: SessionCard[];
  runCache: Map<string, RunSnapshot | null>;
  roundCache: Map<string, RoundSnapshot>;
};

type ReadContexts = { sessionCtx: CoreCallContext; executionCtx: CoreCallContext };

type UniverseOptions = { sessions: boolean; planHint?: PlanRevisionRef };

export function createGraphContextReader(deps: GraphContextReaderDependencies): GraphContextReadPort {
  // ---------------------------------------------------------------------- //
  // Local primitives                                                       //
  // ---------------------------------------------------------------------- //

  async function readBatch(keys: readonly string[]): Promise<ReadResult<Batch>> {
    let result;
    try {
      result = await deps.records.readMany(keys);
    } catch (error) {
      return rejected('unavailable', `the record read failed: ${messageOf(error)}`);
    }
    if (result.status !== 'ready') return storeFailureRead(result);
    return {
      status: 'ready',
      value: {
        present: new Map(result.value.records.map(record => [record.refKey, record])),
        missing: new Set(result.value.missing),
        readThrough: result.value.readThrough,
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // Query / Work -> internal Host bridges                                   //
  // ---------------------------------------------------------------------- //

  async function resolveGraphSessionReadContext(ctx: CoreCallContext, goal: GoalRef): Promise<ReadResult<CoreCallContext>> {
    if (ctx.signal.aborted) return rejected('cancelled', 'the graph read was cancelled');
    const principal = ctx.principal;
    if (principal.kind === 'host' || principal.kind === 'work_run') {
      return { status: 'ready', value: ctx };
    }
    const queryRunRef = principal.queryRunRef;
    const shapeProblem = refProblem(queryRunRef, ['projectId', 'workspaceId', 'queryJobId', 'runId'], 'QueryRun');
    if (shapeProblem !== null) return rejected('invalid', `the QueryRun principal is not complete: ${shapeProblem}`);
    if (queryRunRef.projectId !== ctx.projectId || queryRunRef.workspaceId !== (ctx.workspaceId ?? queryRunRef.workspaceId)) {
      return rejected('forbidden', 'the QueryRun principal is outside the call context scope');
    }
    const jobRef = {
      aggregateType: 'QueryJob' as const, projectId: queryRunRef.projectId,
      workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId,
    };
    const jobKey = canonicalJson(jobRef as unknown as JsonValue);
    const runKey = canonicalJson(queryRunRef as unknown as JsonValue);
    const read = await readBatch([jobKey, runKey]);
    if (read.status !== 'ready') return propagate(read);
    if (read.value.missing.has(jobKey) || !read.value.present.has(jobKey)) {
      return { status: 'not_found' };
    }
    if (read.value.missing.has(runKey) || !read.value.present.has(runKey)) {
      return rejected('incomplete', 'the QueryRun record is missing');
    }
    const jobDecoded = decodeQueryJobSnapshot(read.value.present.get(jobKey) as EncodedRecord);
    if (jobDecoded.status !== 'decoded') {
      return rejected('unavailable', `the QueryJob is not decodable: ${jobDecoded.reason}`);
    }
    const runDecoded = decodeQueryRunSnapshotRecord(read.value.present.get(runKey) as EncodedRecord);
    if (runDecoded.status !== 'decoded') {
      return rejected('unavailable', `the QueryRun is not decodable: ${runDecoded.reason}`);
    }
    const job = jobDecoded.value;
    const run = runDecoded.value;
    if (canonicalJson(job.ref as unknown as JsonValue) !== jobKey) {
      return rejected('unavailable', 'the QueryJob ref disagrees with its canonical key');
    }
    if (canonicalJson(run.ref as unknown as JsonValue) !== runKey) {
      return rejected('unavailable', 'the QueryRun ref disagrees with its canonical key');
    }
    if (job.job.runRef === null || canonicalJson(job.job.runRef as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the QueryJob does not bind the requested QueryRun');
    }
    if (job.job.goalId !== goal.goalId) {
      return rejected('forbidden', 'the QueryJob does not belong to the requested Goal');
    }
    const state = run.run.executionState;
    if (state === undefined) {
      return rejected('incomplete', 'the QueryRun has no persisted Session binding');
    }
    const sessionRef = state.sessionRef;
    if (sessionRef.projectId !== queryRunRef.projectId) {
      return rejected('forbidden', 'the QueryRun Session binding is outside the QueryRun project');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    const goalKey = canonicalRefKey(goal);
    const scopeRead = await readBatch([sessionKey, goalKey]);
    if (scopeRead.status !== 'ready') return propagate(scopeRead);
    if (scopeRead.value.missing.has(sessionKey) || !scopeRead.value.present.has(sessionKey)) {
      return rejected('incomplete', 'the bound Session record is missing');
    }
    const sessionDecoded = decodeSessionRecord(scopeRead.value.present.get(sessionKey) as EncodedRecord);
    if (sessionDecoded.status !== 'decoded') {
      return rejected('unavailable', `the bound Session is not decodable: ${sessionDecoded.reason}`);
    }
    if (sessionDecoded.value.ref.projectId !== queryRunRef.projectId
      || sessionDecoded.value.workspaceId !== queryRunRef.workspaceId) {
      return rejected('forbidden', 'the bound Session is outside the QueryRun scope');
    }
    if (scopeRead.value.missing.has(goalKey) || !scopeRead.value.present.has(goalKey)) {
      return { status: 'not_found' };
    }
    const goalDecoded = decodeGoalSnapshot(scopeRead.value.present.get(goalKey) as EncodedRecord);
    if (goalDecoded.status !== 'decoded') {
      return rejected('unavailable', `the Goal is not decodable: ${goalDecoded.reason}`);
    }
    if (goalDecoded.value.workspaceRef.workspaceId !== queryRunRef.workspaceId) {
      return rejected('forbidden', 'the Goal is outside the QueryRun workspace');
    }
    const submission = job.submission;
    if (submission === undefined) {
      return rejected('unsupported', 'the QueryJob has no original submission locator');
    }
    let found;
    try {
      found = await deps.records.lookupCommit({ identityKey: submission.identityKey, fingerprint: submission.fingerprint });
    } catch (error) {
      return rejected('unavailable', `the submission lookup failed: ${messageOf(error)}`);
    }
    if (found.status !== 'ready') {
      if (found.code === 'not_found') return { status: 'not_found' };
      if (found.code === 'invalid') return rejected('invalid', found.reason);
      if (found.code === 'unsupported') return rejected('incomplete', found.reason);
      return rejected('unavailable', `${found.code}: ${found.reason}`);
    }
    let located;
    try {
      located = await deps.records.eventAt(found.value.cursor);
    } catch (error) {
      return rejected('unavailable', `the original submission event could not be read: ${messageOf(error)}`);
    }
    if (located.status !== 'ready') {
      if (located.code === 'not_found') return { status: 'not_found' };
      return rejected('unavailable', `${located.code}: ${located.reason}`);
    }
    const eventDecoded = decodeQueryJobSubmittedEvent(located.value.event);
    if (eventDecoded.status !== 'decoded') {
      return rejected('unavailable', `the original submission event is not legal: ${eventDecoded.reason}`);
    }
    const event = eventDecoded.value;
    if (event.identityKey !== submission.identityKey || event.fingerprint !== submission.fingerprint
      || event.eventId !== submission.eventId) {
      return rejected('unavailable', 'the original submission identity disagrees with the QueryJob locator');
    }
    if (event.projectId !== queryRunRef.projectId || event.workspaceId !== queryRunRef.workspaceId
      || event.aggregateId !== queryRunRef.queryJobId) {
      return rejected('forbidden', 'the original submission event is outside the QueryRun scope');
    }
    const actor = event.actor;
    if (actor.kind !== 'human' && actor.kind !== 'system') {
      return rejected('unsupported', 'the original Query initiator kind is unsupported');
    }
    if (!sameActor(actor, principal.initiator)) {
      return rejected('forbidden', 'the QueryRun initiator is not the original submission actor');
    }
    return { status: 'ready', value: internalHostContext(ctx, { kind: actor.kind, id: actor.id }) };
  }

  async function resolveGraphExecutionReadContext(ctx: CoreCallContext, goal: GoalRef): Promise<ReadResult<CoreCallContext>> {
    if (ctx.signal.aborted) return rejected('cancelled', 'the graph read was cancelled');
    const principal = ctx.principal;
    if (principal.kind === 'host') return { status: 'ready', value: ctx };
    if (principal.kind === 'query_run') return resolveGraphSessionReadContext(ctx, goal);
    const runRef = principal.runRef;
    const shapeProblem = refProblem(runRef, ['projectId', 'goalId', 'runId'], 'Run');
    if (shapeProblem !== null) return rejected('invalid', `the work Run principal is not complete: ${shapeProblem}`);
    if (runRef.projectId !== ctx.projectId || runRef.goalId !== goal.goalId) {
      return rejected('forbidden', 'the work Run is outside the requested project/goal');
    }
    const runKey = canonicalJson(runRef as unknown as JsonValue);
    const read = await readBatch([runKey]);
    if (read.status !== 'ready') return propagate(read);
    if (read.value.missing.has(runKey) || !read.value.present.has(runKey)) return { status: 'not_found' };
    const decoded = decodeRun(read.value.present.get(runKey) as EncodedRecord);
    if (!decoded.ok) return rejected('unavailable', `the Run is damaged: ${decoded.reason}`);
    const run = decoded.value;
    if (canonicalJson(run.ref as unknown as JsonValue) !== runKey) {
      return rejected('unavailable', 'the Run ref disagrees with the requested Run');
    }
    if (run.task.goalId !== goal.goalId || run.ref.goalId !== goal.goalId) {
      return rejected('forbidden', 'the Run belongs to another goal');
    }
    if (ctx.workspaceId !== undefined && run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
      return rejected('forbidden', 'the Run workspace does not match the bound context');
    }
    return { status: 'ready', value: internalHostContext(ctx, deps.hostActor) };
  }

  async function resolveReadContexts(ctx: CoreCallContext, goal: GoalRef): Promise<ReadResult<ReadContexts>> {
    const principal = ctx.principal;
    if (principal.kind === 'host') return { status: 'ready', value: { sessionCtx: ctx, executionCtx: ctx } };
    if (principal.kind === 'query_run') {
      const verified = await resolveGraphSessionReadContext(ctx, goal);
      if (verified.status !== 'ready') return propagate(verified);
      return { status: 'ready', value: { sessionCtx: verified.value, executionCtx: verified.value } };
    }
    const execution = await resolveGraphExecutionReadContext(ctx, goal);
    if (execution.status !== 'ready') return propagate(execution);
    return { status: 'ready', value: { sessionCtx: ctx, executionCtx: execution.value } };
  }

  // ---------------------------------------------------------------------- //
  // Universe                                                               //
  // ---------------------------------------------------------------------- //

  async function loadRuns(runRefs: readonly RunRef[]): Promise<ReadResult<Map<string, RunSnapshot | null>>> {
    const cache = new Map<string, RunSnapshot | null>();
    if (runRefs.length === 0) return { status: 'ready', value: cache };
    const storeKeys = [...new Set(runRefs.map(ref => canonicalJson(ref as unknown as JsonValue)))];
    const read = await readBatch(storeKeys);
    if (read.status !== 'ready') return propagate(read);
    for (const ref of runRefs) {
      const key = nodeKey({ kind: 'run', ref });
      if (cache.has(key)) continue;
      const record = read.value.present.get(canonicalJson(ref as unknown as JsonValue));
      if (record === undefined) { cache.set(key, null); continue; }
      const decoded = decodeRun(record);
      if (!decoded.ok) return rejected('unavailable', `the Run is damaged: ${decoded.reason}`);
      cache.set(key, decoded.value);
    }
    return { status: 'ready', value: cache };
  }

  /** G4.3: a requested/listed Run is resolved by its exact canonical record,
   * rechecked against the Goal and workspace, and only then carded. A missing
   * record is `not_found`, a corrupt one `unavailable`; never an empty card. */
  async function ensureRuns(
    universe: Universe,
    runRefs: readonly RunRef[],
    ctx: CoreCallContext,
    goal: GoalRef,
  ): Promise<ReadResult<void>> {
    const pending: RunRef[] = [];
    for (const ref of runRefs) if (!universe.runCache.has(nodeKey({ kind: 'run', ref }))) pending.push(ref);
    if (pending.length === 0) return { status: 'ready', value: undefined };
    const storeKeys = [...new Set(pending.map(ref => canonicalJson(ref as unknown as JsonValue)))];
    const read = await readBatch(storeKeys);
    if (read.status !== 'ready') return propagate(read);
    for (const ref of pending) {
      const key = nodeKey({ kind: 'run', ref });
      if (universe.runCache.has(key)) continue;
      const storeKey = canonicalJson(ref as unknown as JsonValue);
      const record = read.value.present.get(storeKey);
      if (record === undefined || read.value.missing.has(storeKey)) return { status: 'not_found' };
      const decoded = decodeRun(record);
      if (!decoded.ok) return rejected('unavailable', `the Run is damaged: ${decoded.reason}`);
      const run = decoded.value;
      if (canonicalJson(run.ref as unknown as JsonValue) !== storeKey) {
        return rejected('unavailable', 'the Run ref disagrees with the requested Run');
      }
      if (run.task.goalId !== goal.goalId || run.ref.goalId !== goal.goalId
        || run.ref.projectId !== goal.projectId || run.task.projectId !== goal.projectId) {
        return rejected('forbidden', 'the Run belongs to another goal');
      }
      if (ctx.workspaceId !== undefined && run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
        return rejected('forbidden', 'the Run workspace does not match the bound context');
      }
      universe.runCache.set(key, run);
    }
    return { status: 'ready', value: undefined };
  }

  async function loadRounds(ctx: CoreCallContext, goal: GoalRef, graph: TaskGraph | null): Promise<ReadResult<Map<string, RoundSnapshot>>> {
    const cache = new Map<string, RoundSnapshot>();
    if (graph === null) return { status: 'ready', value: cache };
    const workspaceId = ctx.workspaceId ?? '';
    for (const row of graph.tasks) {
      const values: LookupValue[] = [ctx.projectId, workspaceId, goal.goalId, row.ref.taskId];
      let after: string | undefined;
      let pages = 0;
      while (true) {
        let result;
        try {
          result = await deps.records.lookup({
            index: VERIFICATION_ROUND_BY_TASK_LOOKUP, values, limit: ROUND_LOOKUP_LIMIT,
            ...(after === undefined ? {} : { after }),
          });
        } catch (error) {
          return rejected('unavailable', `the VerificationRound lookup failed: ${messageOf(error)}`);
        }
        if (result.status !== 'ready') return storeFailureRead(result);
        for (const record of result.value.records) {
          const decoded = decodeVerificationRoundSnapshot(record);
          if (decoded.status !== 'decoded') {
            return rejected('unavailable', `the VerificationRound is not decodable: ${decoded.reason}`);
          }
          cache.set(nodeKey({ kind: 'round', ref: decoded.value.ref }), decoded.value);
        }
        if (result.value.next === null) break;
        pages += 1;
        if (pages >= GRAPH_PAGE_BUDGET) {
          return rejected('incomplete', 'the VerificationRound listing exceeds the read budget');
        }
        after = result.value.next;
      }
    }
    return { status: 'ready', value: cache };
  }

  async function loadUniverse(ctx: CoreCallContext, goalRef: GoalRef, options: UniverseOptions): Promise<ReadResult<Universe>> {
    const goalRead = await deps.goals.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') return propagate(goalRead);
    const goal = goalRead.value.goal;
    const workspaceKey = canonicalJson(goal.workspaceRef as unknown as JsonValue);
    const workspaceRead = await readBatch([workspaceKey]);
    if (workspaceRead.status !== 'ready') return propagate(workspaceRead);
    const workspaceRecord = workspaceRead.value.present.get(workspaceKey);
    const workspace: VersionedRef | null = workspaceRecord === undefined
      ? null
      : { ref: goal.workspaceRef, revision: workspaceRecord.revision };
    const planRef = options.planHint ?? goal.activePlanRevision ?? undefined;
    let plan: PlanRevisionSnapshot | null = null;
    let graph: TaskGraph | null = null;
    if (planRef !== undefined) {
      const graphRead = await deps.plans.queryTaskGraph(ctx, { goalRef, planRef });
      if (graphRead.status === 'ready') {
        plan = graphRead.value.plan;
        graph = graphRead.value;
      } else if (graphRead.status !== 'not_found') {
        return propagate(graphRead);
      }
    }
    const archRead = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    let architecture: AdoptedArchitecture | null = null;
    let baseline: ArchitectureBaselineRevisionRef | null = null;
    let baselineRevision: number | null = null;
    let baselineDigest: string | null = null;
    if (archRead.status === 'ready') {
      architecture = archRead.value.catalog?.catalog ?? null;
      baseline = archRead.value.baseline.ref;
      baselineRevision = archRead.value.baseline.revision;
      baselineDigest = archRead.value.baseline.contentDigest;
    } else if (archRead.status !== 'not_found') {
      return propagate(archRead);
    }
    const contexts = await resolveReadContexts(ctx, goalRef);
    if (contexts.status !== 'ready') return propagate(contexts);
    let sessionCards: SessionCard[] = [];
    if (options.sessions) {
      const collected: SessionCard[] = [];
      let cursor: string | undefined;
      let pages = 0;
      while (true) {
        const sessionsRead = await deps.sessions.findSessions(contexts.value.sessionCtx, {
          workspace: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' },
          includeArchived: true,
          page: { limit: SESSION_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
        });
        if (sessionsRead.status !== 'ready') return propagate(sessionsRead);
        collected.push(...sessionsRead.value.items);
        if (sessionsRead.value.nextCursor === null) break;
        pages += 1;
        if (pages >= GRAPH_PAGE_BUDGET) {
          return rejected('incomplete', 'the Session listing exceeds the read budget');
        }
        cursor = sessionsRead.value.nextCursor;
      }
      sessionCards = collected;
    }
    const runRefs: RunRef[] = [];
    for (const row of graph?.tasks ?? []) if (row.execution !== null) runRefs.push(row.execution);
    const runs = await loadRuns(runRefs);
    if (runs.status !== 'ready') return propagate(runs);
    const rounds = await loadRounds(ctx, goalRef, graph);
    if (rounds.status !== 'ready') return propagate(rounds);
    return {
      status: 'ready',
      value: {
        goal, workspace, plan, graph, architecture, baseline, baselineRevision, baselineDigest,
        sessionCards, runCache: runs.value, roundCache: rounds.value,
      },
    };
  }

  function basisKeyOf(universe: Universe): string {
    const basis = {
      goal: { ref: universe.goal.ref, revision: universe.goal.revision, activePlanRevision: universe.goal.activePlanRevision },
      workspace: universe.workspace === null ? null : { ref: universe.workspace.ref, revision: universe.workspace.revision },
      plan: universe.plan === null ? null : { ref: universe.plan.ref, revision: universe.plan.revision },
      architecture: universe.baseline === null
        ? null
        : { ref: universe.baseline, revision: universe.baselineRevision, digest: universe.baselineDigest },
      sessions: universe.sessionCards
        .map(card => ({ ref: card.record.ref, revision: card.record.revision }))
        .sort(compareRefKeys),
      runs: [...universe.runCache.values()]
        .filter((run): run is RunSnapshot => run !== null)
        .map(run => ({ ref: run.ref, revision: run.revision }))
        .sort(compareRefKeys),
      rounds: [...universe.roundCache.values()]
        .map(round => ({ ref: round.ref, revision: round.revision }))
        .sort(compareRefKeys),
    };
    return sha256Hex(canonicalJson(basis as unknown as JsonValue));
  }

  /** G4.4: a cursor whose basis moved is `revision_conflict`; `current` names
   * the Goal's CURRENT active Plan (not the pinned `planHint`) and the current
   * Workspace pin, so the caller can retarget exactly. */
  async function revisionConflict(universe: Universe, ctx: CoreCallContext, goalRef: GoalRef): Promise<CoreRejection> {
    const current: VersionPin[] = [];
    const activePlan = universe.goal.activePlanRevision;
    if (activePlan !== null) {
      const planKeyOf = (ref: PlanRevisionRef): string => canonicalJson(ref as unknown as JsonValue);
      if (universe.plan !== null && planKeyOf(universe.plan.ref) === planKeyOf(activePlan)) {
        current.push({ ref: activePlan, revision: universe.plan.revision });
      } else {
        const activeRead = await deps.plans.queryTaskGraph(ctx, { goalRef, planRef: activePlan });
        if (activeRead.status === 'ready') current.push({ ref: activePlan, revision: activeRead.value.plan.revision });
      }
    }
    if (universe.workspace !== null) current.push({ ref: universe.workspace.ref, revision: universe.workspace.revision });
    return { status: 'rejected', code: 'revision_conflict', reason: 'the graph basis changed between pages', current };
  }

  // ---------------------------------------------------------------------- //
  // Node presentation and cards                                             //
  // ---------------------------------------------------------------------- //

  function taskTripleOf(plan: PlanRevisionSnapshot, taskId: string): TaskTriple {
    return { projectId: plan.ref.projectId, goalId: plan.goalRef.goalId, taskId };
  }
  function taskNodeOf(plan: PlanRevisionSnapshot, taskId: string): Extract<GraphNodeRefV1, { kind: 'task' }> {
    return { kind: 'task', ref: taskTripleOf(plan, taskId), planRef: plan.ref };
  }
  function moduleForTask(architecture: AdoptedArchitecture | null, task: RuntimeTask): ModuleDefinition | null {
    const scope = task.scope;
    if (scope.kind !== 'module') return null;
    const moduleId = scope.moduleRef;
    return architecture?.modules.find(module => module.ref.moduleId === moduleId) ?? null;
  }
  function declarationsForTask(plan: PlanRevisionSnapshot, taskId: string): InputDeclarationV1[] {
    const out: InputDeclarationV1[] = [];
    for (const edge of plan.executionDag.dependsOn) {
      if (edge.taskId !== taskId) continue;
      out.push({
        declarationId: 'edge:' + sha256Hex(canonicalJson({
          planRef: plan.ref, consumerTaskId: edge.taskId, dependsOnId: edge.dependsOnId, requires: edge.requires,
        } as unknown as JsonValue)),
        consumer: taskTripleOf(plan, edge.taskId),
        planRef: plan.ref,
        upstream: taskTripleOf(plan, edge.dependsOnId),
        requires: edge.requires,
        legacyArtifactRef: null,
      });
    }
    if (plan.schemaVersion === 2 && plan.inputRequirements !== undefined) {
      for (const requirement of plan.inputRequirements) {
        if (requirement.consumerTaskId !== taskId) continue;
        out.push({
          declarationId: 'legacy:' + requirement.requirementId,
          consumer: taskTripleOf(plan, requirement.consumerTaskId),
          planRef: plan.ref,
          upstream: null,
          requires: { kind: 'artifact', label: requirement.requirementId },
          legacyArtifactRef: requirement.artifactRef,
        });
      }
    }
    return out;
  }
  function downstreamOf(plan: PlanRevisionSnapshot, taskId: string): { consumer: TaskTriple; requires: DependencyRequirement }[] {
    const out: { consumer: TaskTriple; requires: DependencyRequirement }[] = [];
    for (const edge of plan.executionDag.dependsOn) {
      if (edge.dependsOnId !== taskId) continue;
      out.push({ consumer: taskTripleOf(plan, edge.taskId), requires: edge.requires });
    }
    return out;
  }

  function taskCardOf(node: Extract<GraphNodeRefV1, { kind: 'task' }>, universe: Universe): GraphTaskCardV1 | null {
    if (universe.plan === null) return null;
    const plan = universe.plan;
    const task = plan.tasks.find(candidate => candidate.taskId === node.ref.taskId);
    if (task === undefined) return null;
    const facts = planTaskFacts(plan);
    const definition = facts.definitions.get(task.taskId);
    const basis = facts.basis.get(task.taskId);
    const row: TaskRow | undefined = universe.graph?.tasks.find(candidate => candidate.ref.taskId === task.taskId);
    const definitionPlanRef = basis !== undefined && !isBasisUnsupported(basis) ? basis : plan.ref;
    const assignment: PlanTaskAssignment | null = definition?.assignment ?? null;
    const obligations: Omit<AcceptanceObligation, 'taskIds'>[] = [...(definition?.carriedObligations ?? [])];
    return {
      ref: node.ref,
      planRef: plan.ref,
      definitionPlanRef,
      definition: task,
      assignment,
      obligations,
      effectivePhase: row?.effectivePhase ?? task.phase,
      failure: row?.failure ?? null,
      stage: plan.stages.find(stage => stage.stageId === task.stageId) ?? null,
      module: moduleForTask(universe.architecture, task),
      upstream: declarationsForTask(plan, task.taskId),
      downstream: downstreamOf(plan, task.taskId),
    };
  }

  function presentationOf(node: GraphNodeRefV1, universe: Universe): { name: string; paths: string[]; summary: string } {
    switch (node.kind) {
      case 'goal':
        return { name: universe.goal.objective, paths: [], summary: universe.goal.objective };
      case 'stage': {
        const stage = universe.plan?.stages.find(candidate => candidate.stageId === node.stageId);
        return { name: stage?.title ?? node.stageId, paths: [], summary: stage?.title ?? '' };
      }
      case 'task': {
        const plan = universe.plan;
        const task = plan?.tasks.find(candidate => candidate.taskId === node.ref.taskId);
        const assignment = plan === null
          ? null
          : planTaskFacts(plan).definitions.get(node.ref.taskId)?.assignment ?? null;
        return { name: task?.title ?? node.ref.taskId, paths: [], summary: assignment?.instruction ?? task?.title ?? '' };
      }
      case 'module': {
        const module = universe.architecture?.modules.find(candidate => candidate.ref.moduleId === node.ref.moduleId);
        return { name: module?.name ?? node.ref.moduleId, paths: module?.paths ?? [], summary: module?.responsibility ?? '' };
      }
      case 'session': {
        const card = universe.sessionCards.find(candidate => candidate.record.ref.sessionId === node.ref.sessionId);
        return {
          name: node.ref.sessionId, paths: [],
          summary: card === undefined ? '' : canonicalJson(card.record.role as unknown as JsonValue),
        };
      }
      case 'run': {
        const run = universe.runCache.get(nodeKey(node)) ?? null;
        return {
          name: node.ref.runId, paths: [],
          summary: run === null ? '' : `${run.status}/${run.outcome === null ? 'null' : run.outcome}`,
        };
      }
      case 'round': {
        const round = universe.roundCache.get(nodeKey(node)) ?? null;
        return {
          name: node.ref.roundId, paths: [],
          summary: round === null ? '' : `${round.status}/${round.outcome ?? '(none)'}`,
        };
      }
    }
  }

  /** The records `readContextFacts` is built from: Goal, Plan, architecture baseline and the
   * focus Tasks' selected Runs. Runs/Rounds/Sessions of other Tasks are not this context's
   * sources (they would make a Work binding depend on, and its entry guard on, sibling Tasks). */
  function baseSources(universe: Universe, executions: readonly TaskExecutionRecord[]): ContextSourceV1[] {
    const sources: ContextSourceV1[] = [
      { kind: 'record', ref: universe.goal.ref, revision: universe.goal.revision, digest: null },
    ];
    if (universe.plan !== null) {
      sources.push({ kind: 'record', ref: universe.plan.ref, revision: universe.plan.revision, digest: null });
    }
    if (universe.baseline !== null && universe.baselineRevision !== null) {
      sources.push({
        kind: 'record', ref: universe.baseline, revision: universe.baselineRevision,
        digest: universe.baselineDigest,
      });
    }
    for (const run of executions.map(record => record.run).sort((left, right) => compareRefKeys(left, right))) {
      sources.push({ kind: 'record', ref: run.ref, revision: run.revision, digest: null });
    }
    return sources;
  }

  /** G4.4: the records THIS card was actually built from, with their revisions.
   * The same records are hashed into the page `basisKey`; the card lists only
   * its own so one executions page does not repeat the whole Run set. */
  function cardSources(universe: Universe, node: GraphNodeRefV1): ContextSourceV1[] {
    const sources: ContextSourceV1[] = [
      { kind: 'record', ref: universe.goal.ref, revision: universe.goal.revision, digest: null },
    ];
    if (universe.plan !== null) {
      sources.push({ kind: 'record', ref: universe.plan.ref, revision: universe.plan.revision, digest: null });
    }
    if (universe.baseline !== null && universe.baselineRevision !== null) {
      sources.push({
        kind: 'record', ref: universe.baseline, revision: universe.baselineRevision,
        digest: universe.baselineDigest,
      });
    }
    switch (node.kind) {
      case 'session': {
        const card = universe.sessionCards.find(candidate => candidate.record.ref.sessionId === node.ref.sessionId);
        if (card !== undefined) sources.push(attentionSource(card.record.ref, card.record.revision));
        break;
      }
      case 'run': {
        const run = universe.runCache.get(nodeKey(node)) ?? null;
        if (run !== null) sources.push(attentionSource(run.ref, run.revision));
        break;
      }
      case 'round': {
        const round = universe.roundCache.get(nodeKey(node));
        if (round !== undefined) sources.push(attentionSource(round.ref, round.revision));
        break;
      }
      case 'task': {
        const row = universe.graph?.tasks.find(candidate => candidate.ref.taskId === node.ref.taskId);
        if (row?.execution !== null && row?.execution !== undefined) {
          const run = universe.runCache.get(nodeKey({ kind: 'run', ref: row.execution })) ?? null;
          if (run !== null) sources.push(attentionSource(run.ref, run.revision));
        }
        for (const round of [...universe.roundCache.values()]
          .filter(candidate => candidate.subject.taskId === node.ref.taskId)
          .sort((left, right) => compareRefKeys(left, right))) {
          sources.push(attentionSource(round.ref, round.revision));
        }
        break;
      }
      default:
        break;
    }
    return sources;
  }

  function childrenOf(node: GraphNodeRefV1, universe: Universe): GraphNodeRefV1[] {
    switch (node.kind) {
      case 'goal': {
        const out: GraphNodeRefV1[] = [];
        if (universe.plan !== null) {
          for (const stage of universe.plan.stages) out.push({ kind: 'stage', planRef: universe.plan.ref, stageId: stage.stageId });
          for (const task of universe.plan.tasks) {
            if (task.stageId === undefined) out.push(taskNodeOf(universe.plan, task.taskId));
          }
        }
        return out;
      }
      case 'stage': {
        const out: GraphNodeRefV1[] = [];
        if (universe.plan !== null) {
          for (const task of universe.plan.tasks) {
            if (task.stageId === node.stageId) out.push(taskNodeOf(universe.plan, task.taskId));
          }
          const moduleIds = new Set<string>();
          for (const task of universe.plan.tasks) {
            const scope = task.scope;
            if (scope.kind === 'module' && scope.stageId === node.stageId) moduleIds.add(scope.moduleRef);
          }
          for (const moduleId of moduleIds) {
            const module = universe.architecture?.modules.find(candidate => candidate.ref.moduleId === moduleId);
            if (module !== undefined) out.push({ kind: 'module', ref: module.ref });
          }
        }
        return out;
      }
      case 'task': {
        const out: GraphNodeRefV1[] = [];
        if (universe.plan !== null) {
          for (const edge of universe.plan.taskHierarchy.parentOf) {
            if (edge.parentTaskId === node.ref.taskId) out.push(taskNodeOf(universe.plan, edge.childTaskId));
          }
        }
        return out;
      }
      case 'module': {
        const containment = universe.architecture?.containment;
        if (containment === undefined) return [];
        return containment.parentOf
          .filter(pair => pair.parent.moduleId === node.ref.moduleId)
          .map(pair => ({ kind: 'module', ref: pair.child }));
      }
      default:
        return [];
    }
  }

  function neighboursOf(node: GraphNodeRefV1, universe: Universe): GraphNodeRefV1[] {
    const out: GraphNodeRefV1[] = [];
    switch (node.kind) {
      case 'task': {
        if (universe.plan !== null) {
          for (const edge of universe.plan.executionDag.dependsOn) {
            if (edge.taskId === node.ref.taskId) out.push(taskNodeOf(universe.plan, edge.dependsOnId));
            if (edge.dependsOnId === node.ref.taskId) out.push(taskNodeOf(universe.plan, edge.taskId));
          }
          if (universe.plan.schemaVersion === 2 && universe.plan.taskRelations !== undefined) {
            for (const relation of universe.plan.taskRelations) {
              if (relation.fromTaskId === node.ref.taskId) out.push(taskNodeOf(universe.plan, relation.toTaskId));
              if (relation.toTaskId === node.ref.taskId) out.push(taskNodeOf(universe.plan, relation.fromTaskId));
            }
          }
          const task = universe.plan.tasks.find(candidate => candidate.taskId === node.ref.taskId);
          const taskScope = task?.scope;
          if (taskScope !== undefined && taskScope.kind === 'module') {
            const moduleId = taskScope.moduleRef;
            const module = universe.architecture?.modules.find(candidate => candidate.ref.moduleId === moduleId);
            if (module !== undefined) out.push({ kind: 'module', ref: module.ref });
          }
        }
        for (const card of universe.sessionCards) {
          for (const link of card.links) {
            if (link.ref.target.kind !== 'task') continue;
            const target = link.ref.target.ref;
            if (target.goalId === node.ref.goalId && target.taskId === node.ref.taskId) {
              out.push({ kind: 'session', ref: { projectId: node.ref.projectId, sessionId: card.record.ref.sessionId } });
            }
          }
        }
        break;
      }
      case 'module': {
        for (const dependency of universe.architecture?.dependencies ?? []) {
          if (dependency.from.moduleId === node.ref.moduleId) out.push({ kind: 'module', ref: dependency.to });
          if (dependency.to.moduleId === node.ref.moduleId) out.push({ kind: 'module', ref: dependency.from });
        }
        if (universe.plan !== null) {
          for (const task of universe.plan.tasks) {
            const scope = task.scope;
            if (scope.kind === 'module' && scope.moduleRef === node.ref.moduleId) {
              out.push(taskNodeOf(universe.plan, task.taskId));
            }
          }
        }
        for (const card of universe.sessionCards) {
          for (const link of card.links) {
            if (link.ref.target.kind !== 'module') continue;
            if (link.ref.target.ref.moduleId === node.ref.moduleId) {
              out.push({ kind: 'session', ref: { projectId: node.ref.projectId, sessionId: card.record.ref.sessionId } });
            }
          }
        }
        break;
      }
      case 'session': {
        const card = universe.sessionCards.find(candidate => candidate.record.ref.sessionId === node.ref.sessionId);
        if (card !== undefined) {
          for (const link of card.links) {
            const target = link.ref.target;
            if (target.kind === 'task' && universe.plan !== null && target.ref.projectId === universe.plan.ref.projectId) {
              out.push(taskNodeOf(universe.plan, target.ref.taskId));
            }
            if (target.kind === 'module') out.push({ kind: 'module', ref: target.ref });
          }
          if (card.record.lastExecutionRef !== null && card.record.lastExecutionRef.aggregateType === 'Run') {
            out.push({ kind: 'run', ref: card.record.lastExecutionRef });
          }
        }
        break;
      }
      case 'run': {
        const run = universe.runCache.get(nodeKey(node)) ?? null;
        if (run !== null && universe.plan !== null) {
          const task = run.task;
          if (universe.plan.tasks.some(candidate => candidate.taskId === task.taskId)) {
            out.push(taskNodeOf(universe.plan, task.taskId));
          }
        }
        break;
      }
      case 'round': {
        const round = universe.roundCache.get(nodeKey(node)) ?? null;
        if (round !== null && universe.plan !== null) {
          if (universe.plan.tasks.some(candidate => candidate.taskId === round.subject.taskId)) {
            out.push(taskNodeOf(universe.plan, round.subject.taskId));
          }
          out.push({ kind: 'run', ref: round.subjectRunRef });
        }
        break;
      }
      case 'goal':
      case 'stage':
        break;
    }
    return dedupeSort(out);
  }

  function nodeExists(node: GraphNodeRefV1, universe: Universe): boolean {
    switch (node.kind) {
      case 'goal':
        return true;
      case 'stage':
        return universe.plan?.stages.some(stage => stage.stageId === node.stageId) ?? false;
      case 'task':
        return universe.plan?.tasks.some(task => task.taskId === node.ref.taskId) ?? false;
      case 'module':
        return universe.architecture?.modules.some(module => module.ref.moduleId === node.ref.moduleId) ?? false;
      case 'session':
        return universe.sessionCards.some(card => card.record.ref.sessionId === node.ref.sessionId);
      case 'run':
        return universe.runCache.get(nodeKey(node)) !== null && universe.runCache.has(nodeKey(node));
      case 'round':
        return universe.roundCache.has(nodeKey(node));
    }
  }

  function buildCard(node: GraphNodeRefV1, universe: Universe, indexes: ContextExtensionsV1): NodeCardV1 {
    const presentation = presentationOf(node, universe);
    const task = node.kind === 'task' ? taskCardOf(node, universe) : null;
    const goal = node.kind === 'goal' ? universe.goal : null;
    const stage: PlanStage | null = node.kind === 'stage'
      ? universe.plan?.stages.find(candidate => candidate.stageId === node.stageId) ?? null
      : null;
    const module: ModuleDefinition | null = node.kind === 'module'
      ? universe.architecture?.modules.find(candidate => candidate.ref.moduleId === node.ref.moduleId) ?? null
      : null;
    const session: SessionRecord | null = node.kind === 'session'
      ? universe.sessionCards.find(card => card.record.ref.sessionId === node.ref.sessionId)?.record ?? null
      : null;
    const run: RunSnapshot | null = node.kind === 'run' ? universe.runCache.get(nodeKey(node)) ?? null : null;
    const round: RoundSnapshot | null = node.kind === 'round' ? universe.roundCache.get(nodeKey(node)) ?? null : null;
    let state: string | null = null;
    if (node.kind === 'task' && task !== null) state = task.effectivePhase;
    else if (node.kind === 'run' && run !== null) state = run.status;
    else if (node.kind === 'round' && round !== null) state = round.status;
    else if (node.kind === 'session' && session !== null) state = session.lifecycle;
    else if (node.kind === 'goal') state = goal?.desiredState ?? null;
    let executions: RunRef[] = [];
    if (node.kind === 'task' && universe.graph !== null) {
      const row = universe.graph.tasks.find(candidate => candidate.ref.taskId === node.ref.taskId);
      if (row !== undefined && row.execution !== null) executions = [row.execution];
    }
    const rounds: VerificationRoundRef[] = node.kind === 'task'
      ? [...universe.roundCache.values()].filter(candidate => candidate.subject.taskId === node.ref.taskId).map(candidate => candidate.ref)
      : [];
    return {
      node,
      name: presentation.name,
      paths: presentation.paths,
      summary: presentation.summary,
      task,
      goal,
      stage,
      module,
      session,
      run,
      round,
      state,
      children: dedupeSort(childrenOf(node, universe)),
      neighbours: dedupeSort(neighboursOf(node, universe)),
      executions,
      rounds,
      inputDeclarations: node.kind === 'task' && universe.plan !== null ? declarationsForTask(universe.plan, node.ref.taskId) : [],
      indexes,
      sources: cardSources(universe, node),
    };
  }

  async function executionsForTask(
    node: Extract<GraphNodeRefV1, { kind: 'task' }>,
    universe: Universe,
    executionCtx: CoreCallContext,
  ): Promise<ReadResult<RunRef[]>> {
    if (deps.executions.listExecutions !== undefined) {
      const refs: RunRef[] = [];
      let afterCursor: string | null = null;
      let pages = 0;
      while (true) {
        const listed = await deps.executions.listExecutions(executionCtx, {
          goalRef: universe.goal.ref,
          taskId: node.ref.taskId,
          page: { afterCursor, limit: EXECUTION_PAGE_LIMIT },
        });
        if (listed.status !== 'ready') return propagate(listed);
        refs.push(...listed.value.items.map(item => item.run.ref));
        if (listed.value.nextCursor === null) break;
        pages += 1;
        if (pages >= GRAPH_PAGE_BUDGET) {
          return rejected('incomplete', 'the execution listing exceeds the read budget');
        }
        afterCursor = listed.value.nextCursor;
      }
      return { status: 'ready', value: refs };
    }
    const row = universe.graph?.tasks.find(candidate => candidate.ref.taskId === node.ref.taskId);
    return { status: 'ready', value: row?.execution === null || row?.execution === undefined ? [] : [row.execution] };
  }

  // ---------------------------------------------------------------------- //
  // readContextFacts                                                        //
  // ---------------------------------------------------------------------- //

  async function readContextFacts(inputCtx: CoreCallContext, inputRequest: ContextReadRequestV1): Promise<ReadResult<GraphContextFactsV1>> {
    const ctx = cloneCallContext(inputCtx);
    const request = structuredClone(inputRequest);
    if (ctx.signal.aborted) return rejected('cancelled', 'readContextFacts was cancelled');
    const shape = request as unknown as { goalRef?: unknown; planRef?: unknown; focusTaskIds?: unknown; includeInputs?: unknown };
    const goalProblem = goalRefProblem(shape?.goalRef);
    if (goalProblem !== null) return rejected('invalid', `readContextFacts: ${goalProblem}`);
    if (!Array.isArray(shape.focusTaskIds) || shape.focusTaskIds.some(taskId => !nonEmpty(taskId))) {
      return rejected('invalid', 'readContextFacts requires focusTaskIds as an array of non-empty task ids');
    }
    if (shape.planRef !== undefined && planRefProblem(shape.planRef) !== null) {
      return rejected('invalid', `readContextFacts: ${planRefProblem(shape.planRef)}`);
    }
    if (shape.includeInputs !== undefined && typeof shape.includeInputs !== 'boolean') {
      return rejected('invalid', 'readContextFacts includeInputs must be a boolean');
    }
    const goalRef = shape.goalRef as GoalRef;
    const planHint = shape.planRef === undefined ? undefined : shape.planRef as PlanRevisionRef;
    const loaded = await loadUniverse(ctx, goalRef, { sessions: false, ...(planHint === undefined ? {} : { planHint }) });
    if (loaded.status !== 'ready') return propagate(loaded);
    const universe = loaded.value;
    const contexts = await resolveReadContexts(ctx, goalRef);
    if (contexts.status !== 'ready') return propagate(contexts);
    const executionCtx = contexts.value.executionCtx;

    const executions: TaskExecutionRecord[] = [];
    const focusTaskIds = shape.focusTaskIds as string[];
    for (const taskId of focusTaskIds) {
      const row = universe.graph?.tasks.find(candidate => candidate.ref.taskId === taskId);
      if (row?.execution === null || row?.execution === undefined) continue;
      const read = await deps.executions.readExecution(executionCtx, row.execution);
      if (read.status !== 'ready') return propagate(read);
      executions.push(read.value);
    }

    const indexes = await readIndexes(deps.extensions, ctx, request);
    if (indexes.status !== 'ready') return propagate(indexes);
    const extensions = indexes.value;

    const inputs: InputSelectionV1[] = [];
    if (shape.includeInputs === true) {
      if (universe.plan === null) {
        return rejected('invalid', 'readContextFacts includeInputs requires a selected Plan');
      }
      for (const taskId of focusTaskIds) {
        const read = await deps.inputs.readTaskInputs(ctx, {
          consumer: { projectId: ctx.projectId, goalId: goalRef.goalId, taskId },
          planRef: universe.plan.ref,
        });
        if (read.status !== 'ready') return propagate(read);
        inputs.push(...read.value);
      }
    }

    return {
      status: 'ready',
      value: {
        goal: universe.goal,
        graph: universe.graph,
        architecture: universe.architecture,
        executions,
        inputs,
        extensions,
        sources: baseSources(universe, executions),
        readThrough: universe.graph?.sourceCursor ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // lookGraph                                                               //
  // ---------------------------------------------------------------------- //

  function planHintOfTarget(target: GraphLookRequestV1['target']): PlanRevisionRef | undefined {
    if (target.kind !== 'node') return undefined;
    const node = target.node;
    return node.kind === 'stage' || node.kind === 'task' ? node.planRef : undefined;
  }

  function modulesMatchingPath(universe: Universe, path: string): GraphNodeRefV1[] {
    const modules = universe.architecture?.modules ?? [];
    if (path === '.') return modules.map(module => ({ kind: 'module', ref: module.ref }));
    return modules.filter(module => module.paths.includes(path)).map(module => ({ kind: 'module', ref: module.ref }));
  }

  async function lookGraph(inputCtx: CoreCallContext, inputRequest: GraphLookRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>> {
    const ctx = cloneCallContext(inputCtx);
    const request = structuredClone(inputRequest);
    if (ctx.signal.aborted) return rejected('cancelled', 'lookGraph was cancelled');
    if (request === null || typeof request !== 'object') return rejected('invalid', 'lookGraph requires a request object');
    const goalProblem = goalRefProblem(request.goalRef);
    if (goalProblem !== null) return rejected('invalid', `lookGraph: ${goalProblem}`);
    if (!GRAPH_RELATIONS.includes(request.relation)) return rejected('invalid', 'lookGraph relation is not recognized');
    const page = parsePage(request.page);
    if (typeof page === 'string') return rejected('invalid', `lookGraph: ${page}`);
    const target = request.target;
    if (!isRecord(target) || (target.kind !== 'node' && target.kind !== 'path')) {
      return rejected('invalid', 'lookGraph target must be a node or a path');
    }
    if (target.kind === 'path') {
      const pathReason = pathProblem(target.path);
      if (pathReason !== null) return rejected('invalid', `lookGraph: ${pathReason}`);
      if (request.relation !== 'card') return rejected('invalid', 'a path target supports only the card relation');
    } else {
      const nodeReason = nodeShapeProblem(target.node);
      if (nodeReason !== null) return rejected('invalid', `lookGraph: ${nodeReason}`);
      const scopeReason = nodeScopeProblem(target.node, ctx.projectId, ctx.workspaceId, request.goalRef);
      if (scopeReason !== null) return rejected('forbidden', scopeReason);
    }
    const goalRef = request.goalRef;
    const scopeKey = scopeKeyOf(ctx, goalRef);
    const queryKey = lookQueryKey(request);
    let afterOffset = 0;
    let cursorBasis: string | null = null;
    if (page.afterCursor !== null) {
      const decoded = decodeCursor(page.afterCursor);
      if (decoded === null) return rejected('invalid', 'page.afterCursor is not a valid graph cursor');
      if (decoded.scopeKey !== scopeKey || decoded.queryKey !== queryKey) {
        return rejected('invalid', 'the graph cursor belongs to another scope or query');
      }
      afterOffset = decoded.offset;
      cursorBasis = decoded.basisKey;
    }
    const planHint = planHintOfTarget(target);
    const loaded = await loadUniverse(ctx, goalRef, { sessions: true, ...(planHint === undefined ? {} : { planHint }) });
    if (loaded.status !== 'ready') return propagate(loaded);
    const universe = loaded.value;
    const contexts = await resolveReadContexts(ctx, goalRef);
    if (contexts.status !== 'ready') return propagate(contexts);
    const executionCtx = contexts.value.executionCtx;

    let relationNodes: GraphNodeRefV1[];
    if (target.kind === 'path') {
      relationNodes = modulesMatchingPath(universe, target.path);
      if (relationNodes.length === 0) return { status: 'not_found' };
    } else {
      const node = target.node;
      if (node.kind === 'run') {
        const resolved = await ensureRuns(universe, [node.ref], ctx, goalRef);
        if (resolved.status !== 'ready') return propagate(resolved);
      }
      if (!nodeExists(node, universe)) return { status: 'not_found' };
      switch (request.relation) {
        case 'card':
          relationNodes = [node];
          break;
        case 'children':
          relationNodes = childrenOf(node, universe);
          break;
        case 'neighbours':
          relationNodes = neighboursOf(node, universe);
          break;
        case 'executions': {
          if (node.kind !== 'task') return { status: 'ready', value: { items: [], nextCursor: null, readThrough: universe.graph?.sourceCursor ?? null } };
          const runs = await executionsForTask(node, universe, executionCtx);
          if (runs.status !== 'ready') return propagate(runs);
          const resolved = await ensureRuns(universe, runs.value, ctx, goalRef);
          if (resolved.status !== 'ready') return propagate(resolved);
          relationNodes = runs.value.map(ref => ({ kind: 'run', ref }));
          break;
        }
        case 'checks': {
          if (node.kind !== 'task') return { status: 'ready', value: { items: [], nextCursor: null, readThrough: universe.graph?.sourceCursor ?? null } };
          relationNodes = [...universe.roundCache.values()]
            .filter(round => round.subject.taskId === node.ref.taskId)
            .map(round => ({ kind: 'round', ref: round.ref }));
          break;
        }
        default:
          return rejected('invalid', 'lookGraph relation is not recognized');
      }
    }
    const listedRuns = relationNodes
      .filter((candidate): candidate is Extract<GraphNodeRefV1, { kind: 'run' }> => candidate.kind === 'run')
      .map(candidate => candidate.ref);
    const resolvedListed = await ensureRuns(universe, listedRuns, ctx, goalRef);
    if (resolvedListed.status !== 'ready') return propagate(resolvedListed);
    const indexes = await readIndexes(deps.extensions, ctx, {
      goalRef, focusTaskIds: [], ...(planHint === undefined ? {} : { planRef: planHint }),
    });
    if (indexes.status !== 'ready') return propagate(indexes);
    const basisKey = basisKeyOf(universe);
    if (cursorBasis !== null && cursorBasis !== basisKey) return revisionConflict(universe, ctx, goalRef);
    const sorted = dedupeSort(relationNodes);
    const pageItems = sorted.slice(afterOffset, afterOffset + page.limit);
    const nextOffset = afterOffset + pageItems.length;
    const nextCursor = nextOffset < sorted.length
      ? encodeCursor({ v: 1, scopeKey, queryKey, basisKey, offset: nextOffset })
      : null;
    return {
      status: 'ready',
      value: {
        items: pageItems.map(node => buildCard(node, universe, indexes.value)),
        nextCursor,
        readThrough: universe.graph?.sourceCursor ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // findGraph                                                               //
  // ---------------------------------------------------------------------- //

  async function findGraph(inputCtx: CoreCallContext, inputRequest: GraphFindRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>> {
    const ctx = cloneCallContext(inputCtx);
    const request = structuredClone(inputRequest);
    if (ctx.signal.aborted) return rejected('cancelled', 'findGraph was cancelled');
    if (request === null || typeof request !== 'object') return rejected('invalid', 'findGraph requires a request object');
    const goalProblem = goalRefProblem(request.goalRef);
    if (goalProblem !== null) return rejected('invalid', `findGraph: ${goalProblem}`);
    const page = parsePage(request.page);
    if (typeof page === 'string') return rejected('invalid', `findGraph: ${page}`);
    if (typeof request.needle !== 'string') return rejected('invalid', 'findGraph needle must be a string');
    const codePoints = [...request.needle].length;
    if (codePoints < 1 || codePoints > 256) return rejected('invalid', 'findGraph needle must be 1..256 Unicode code points');
    const goalRef = request.goalRef;
    const scopeKey = scopeKeyOf(ctx, goalRef);
    const queryKey = findQueryKey(request);
    let afterOffset = 0;
    let cursorBasis: string | null = null;
    if (page.afterCursor !== null) {
      const decoded = decodeCursor(page.afterCursor);
      if (decoded === null) return rejected('invalid', 'page.afterCursor is not a valid graph cursor');
      if (decoded.scopeKey !== scopeKey || decoded.queryKey !== queryKey) {
        return rejected('invalid', 'the graph cursor belongs to another scope or query');
      }
      afterOffset = decoded.offset;
      cursorBasis = decoded.basisKey;
    }
    const loaded = await loadUniverse(ctx, goalRef, { sessions: true });
    if (loaded.status !== 'ready') return propagate(loaded);
    const universe = loaded.value;
    const candidates: GraphNodeRefV1[] = [{ kind: 'goal', ref: universe.goal.ref }];
    if (universe.plan !== null) {
      for (const stage of universe.plan.stages) {
        candidates.push({ kind: 'stage', planRef: universe.plan.ref, stageId: stage.stageId });
      }
      for (const task of universe.plan.tasks) candidates.push(taskNodeOf(universe.plan, task.taskId));
    }
    for (const module of universe.architecture?.modules ?? []) candidates.push({ kind: 'module', ref: module.ref });
    for (const card of universe.sessionCards) {
      candidates.push({ kind: 'session', ref: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId } });
    }
    for (const run of universe.runCache.values()) if (run !== null) candidates.push({ kind: 'run', ref: run.ref });
    for (const round of universe.roundCache.values()) candidates.push({ kind: 'round', ref: round.ref });
    const indexes = await readIndexes(deps.extensions, ctx, { goalRef, focusTaskIds: [] });
    if (indexes.status !== 'ready') return propagate(indexes);
    const basisKey = basisKeyOf(universe);
    if (cursorBasis !== null && cursorBasis !== basisKey) return revisionConflict(universe, ctx, goalRef);
    const needle = normalizeSearchText(request.needle);
    const ownership = longestPathOwner(universe.architecture?.modules ?? [], needle);
    // A `.` query is the root directory: it owns every module by the same
    // all-modules semantics as `lookGraph`'s path target (`modulesMatchingPath`).
    // The loop below still applies the usual name/path/summary matching.
    const matched: GraphNodeRefV1[] = needle === '.' ? modulesMatchingPath(universe, '.') : [];
    for (const node of dedupeSort(candidates)) {
      const presentation = presentationOf(node, universe);
      if (normalizeSearchText(presentation.name).includes(needle)) { matched.push(node); continue; }
      if (presentation.paths.some(path => pathMatches(path, needle, ownership))) { matched.push(node); continue; }
      if (normalizeSearchText(presentation.summary).includes(needle)) { matched.push(node); }
    }
    const sorted = dedupeSort(matched);
    const pageItems = sorted.slice(afterOffset, afterOffset + page.limit);
    const nextOffset = afterOffset + pageItems.length;
    const nextCursor = nextOffset < sorted.length
      ? encodeCursor({ v: 1, scopeKey, queryKey, basisKey, offset: nextOffset })
      : null;
    return {
      status: 'ready',
      value: {
        items: pageItems.map(node => buildCard(node, universe, indexes.value)),
        nextCursor,
        readThrough: universe.graph?.sourceCursor ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // readAttentionFacts                                                      //
  // ---------------------------------------------------------------------- //

  async function readAttentionFacts(inputCtx: CoreCallContext, inputRequest: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>> {
    const ctx = cloneCallContext(inputCtx);
    const request = structuredClone(inputRequest);
    if (ctx.signal.aborted) return rejected('cancelled', 'readAttentionFacts was cancelled');
    if (request === null || typeof request !== 'object') return rejected('invalid', 'readAttentionFacts requires a request object');
    const goalRef = request.goalRef;
    if (goalRef !== null && goalRefProblem(goalRef) !== null) {
      return rejected('invalid', 'readAttentionFacts goalRef must be null or a complete GoalRef');
    }
    const archRead = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    let architecture: AdoptedArchitecture | null = null;
    let baseline: ArchitectureBaselineRevisionRef | null = null;
    let baselineRevision: number | null = null;
    let baselineDigest: string | null = null;
    if (archRead.status === 'ready') {
      architecture = archRead.value.catalog?.catalog ?? null;
      baseline = archRead.value.baseline.ref;
      baselineRevision = archRead.value.baseline.revision;
      baselineDigest = archRead.value.baseline.contentDigest;
    } else if (archRead.status !== 'not_found') return propagate(archRead);

    let plan: PlanRevisionSnapshot | null = null;
    let graph: TaskGraph | null = null;
    const details: Record<string, GraphAttentionDetailV1> = {};
    const statuses: Record<string, string> = {};
    const add = (
      node: GraphNodeRefV1, name: string, summary: string, state: string | null,
      version: string, sources: ContextSourceV1[],
    ): void => {
      const key = attentionKey(node);
      details[key] = {
        node, name, summary, state, version, sources,
        contentDigest: sha256Hex(canonicalJson({ name, summary, state, sources } as unknown as JsonValue)),
      };
      statuses[key] = state ?? 'none';
    };
    const archSources: ContextSourceV1[] = baseline === null || baselineRevision === null
      ? []
      : [{ kind: 'record', ref: baseline, revision: baselineRevision, digest: baselineDigest }];

    if (goalRef === null) {
      const version = baselineRevision === null ? '' : String(baselineRevision);
      for (const module of architecture?.modules ?? []) {
        add({ kind: 'module', ref: module.ref }, module.name, module.responsibility, null, version, archSources);
      }
    } else {
      const loaded = await loadUniverse(ctx, goalRef, { sessions: false, ...(request.planRef === undefined ? {} : { planHint: request.planRef }) });
      if (loaded.status !== 'ready') return propagate(loaded);
      const universe = loaded.value;
      plan = universe.plan;
      graph = universe.graph;
      add({ kind: 'goal', ref: universe.goal.ref }, universe.goal.objective, universe.goal.objective, universe.goal.desiredState,
        String(universe.goal.revision), [attentionSource(universe.goal.ref, universe.goal.revision)]);
      if (universe.plan !== null) {
        const planVersion = String(universe.plan.revision);
        const planSources = [attentionSource(universe.plan.ref, universe.plan.revision)];
        for (const stage of universe.plan.stages) {
          add({ kind: 'stage', planRef: universe.plan.ref, stageId: stage.stageId }, stage.title, stage.title, null, planVersion, planSources);
        }
        for (const task of universe.plan.tasks) {
          const node = taskNodeOf(universe.plan, task.taskId);
          const card = taskCardOf(node, universe);
          add(node, task.title, card?.assignment?.instruction ?? task.title, card?.effectivePhase ?? task.phase, planVersion, planSources);
        }
      }
      const moduleVersion = baselineRevision === null ? '' : String(baselineRevision);
      const moduleSources = baseline === null || baselineRevision === null
        ? []
        : [attentionSource(baseline, baselineRevision, baselineDigest)];
      for (const module of universe.architecture?.modules ?? []) {
        add({ kind: 'module', ref: module.ref }, module.name, module.responsibility, null, moduleVersion, moduleSources);
      }
      for (const card of universe.sessionCards) {
        add(
          { kind: 'session', ref: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId } },
          card.record.ref.sessionId, canonicalJson(card.record.role as unknown as JsonValue), card.record.lifecycle,
          String(card.record.revision), [attentionSource(card.record.ref, card.record.revision)],
        );
      }
      for (const run of universe.runCache.values()) {
        if (run === null) continue;
        add({ kind: 'run', ref: run.ref }, run.ref.runId, `${run.status}/${run.outcome === null ? 'null' : run.outcome}`, run.status,
          String(run.revision), [attentionSource(run.ref, run.revision)]);
      }
      for (const round of universe.roundCache.values()) {
        add({ kind: 'round', ref: round.ref }, round.ref.roundId, `${round.status}/${round.outcome ?? '(none)'}`, round.status,
          String(round.revision), [attentionSource(round.ref, round.revision)]);
      }
    }
    const nodes = Object.keys(details).sort();
    const edges = attentionEdges(graph, plan, architecture);
    const planRevision = plan === null ? null : 'plan:' + plan.ref.planId;
    let revision: string | undefined;
    if (planRevision !== null || baselineDigest !== null) {
      revision = planRevision ?? '';
      if (baselineDigest !== null) revision = (planRevision === null ? '' : planRevision + '|') + 'arch:' + baselineDigest;
    }
    return { status: 'ready', value: { nodes, edges, statuses, revision, details } };
  }

  return { readContextFacts, lookGraph, findGraph, readAttentionFacts };
}
