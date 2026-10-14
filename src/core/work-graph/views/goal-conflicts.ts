/**
 * Slice 5 §4.3/F43: pure Goal footprint and conflict assembly.
 *
 * This view reads the current formal architecture catalog and the two Goals'
 * active Plan pointers plus the executed-files seam, maps executed project
 * paths to real `ModuleRef`s by the catalog's `paths` (longest legal segment
 * match), and calls the pure `state/goal-settings-machine.ts:goalConflictFacts`.
 * It never guesses a module from a name, never widens a missing scope to "the
 * whole project", and keeps unknown files as `unmapped`/`possiblyIncomplete`
 * instead of claiming "no conflict".
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import { decisionSourceKey,
  type DecisionOptionV1, type GoalDecisionBasisV1, type GoalFootprintV1,
  type GoalSettingsV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type {
  DecisionCardV1,
  GoalConflictReadV1,
  GoalExecutedFilesPort,
  S5RecordPort,
} from '../model/decision-contracts.js';
import { decodeGoalSnapshot, readGoalSettings } from '../persistence/record-codecs.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { GOAL_BY_WORKSPACE_INDEX } from '../tasks/plan-readers.js';
import { decodeGoalPhaseSnapshot } from '../tasks/completion-record-codecs.js';
import { goalConflictFacts } from '../state/goal-settings-machine.js';

/**
 * The read-only slice of the shared RecordStore seam every `views/` reader uses.
 * `commit` is deliberately absent: this cluster only reads and assembles.
 */
export type DecisionReadRecordsPort = Pick<S5RecordPort, 'readMany' | 'lookup'>;

/** The narrow conflict read the aggregator (F42) delegates to. */
export interface GoalConflictAssemblerPort {
  queryGoalConflicts(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<GoalConflictReadV1>>;
}

/** Only the current catalog, the executed-files seam and read-only records are needed. */
export type GoalConflictAssemblerDependencies = {
  records: DecisionReadRecordsPort;
  catalog: ArchitectureCatalogPort;
  executedFiles: GoalExecutedFilesPort;
};

/** The fixed §4.3 conflict options, in the frozen order wait/order/parallel. */
export const CONFLICT_OPTIONS: readonly DecisionOptionV1[] = Object.freeze([
  { id: 'wait', label: '等前一个目标', effect: 'apply' },
  { id: 'order', label: '调整顺序', effect: 'apply' },
  { id: 'parallel', label: '接受风险并行', effect: 'apply' },
]);

// -------------------------------------------------------------------------- //
// Shared read-only helpers (used by every `views/` reader)                     //
// -------------------------------------------------------------------------- //

export type LookupBatch<T> = { items: T[]; watermark: CommitCursor | null; truncated: boolean };

/** §4.1 line 772: a source lookup window that keeps changing is retried at most 4 times. */
const WINDOW_MAX_ATTEMPTS = 4;
/** Internal sentinel: this attempt did not observe one stable ledger window. */
const CONFLICT_WINDOW_MOVED: unique symbol = Symbol('goal-conflicts.window-moved');

/**
 * §8.2 scope/权限: every explicit Workspace ref is compared with the bound
 * `ctx` scope BEFORE any read. A cross-Workspace request is `forbidden`; the
 * readers never open a foreign object first.
 */
export function workspaceScopeProblem(ctx: CoreCallContext, workspace: WorkspaceScope): CoreRejection | null {
  if (workspace.projectId !== ctx.projectId || workspace.workspaceId !== ctx.workspaceId) {
    return { status: 'rejected', code: 'forbidden',
      reason: 'the requested workspace is outside the bound call scope' };
  }
  return null;
}

/**
 * §4.1 line 772: the whole read must have observed at least the caller's
 * `atLeastCursor`, else the real `not_ready` stamp is published instead of an
 * older page masquerading as fresh.
 */
export function atLeastCursorResult<T>(
  observed: CommitCursor | null,
  required: CommitCursor | undefined,
): ReadResult<T> | null {
  if (required === undefined) return null;
  if (observed !== null && String(observed) >= String(required)) return null;
  return { status: 'not_ready', observed: observed === null ? null : { kind: 'platform', cursor: observed },
    required: { kind: 'platform', cursor: required } };
}

/** A Store failure mapped to the domain vocabulary; `views/` never writes. */
export function storeFailureToRejection(failure: { code: string; reason: string }, current?: unknown): CoreRejection {
  const allowed = new Set(['invalid', 'forbidden', 'revision_conflict', 'idempotency_conflict', 'not_found',
    'dependency_blocked', 'cycle', 'busy', 'source_stale', 'incomplete', 'capacity', 'unsupported', 'unavailable', 'cancelled']);
  const code = allowed.has(failure.code) ? failure.code as CoreRejection['code'] : 'unavailable';
  const rejection: CoreRejection = { status: 'rejected', code, reason: failure.reason };
  if (Array.isArray(current)) rejection.current = current as NonNullable<CoreRejection['current']>;
  return rejection;
}

/** §8.2 data row: extract a reason from a thrown/undecodable read failure. */
function unavailableReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'reason' in error
    && typeof (error as { reason: unknown }).reason === 'string') {
    return (error as { reason: string }).reason;
  }
  return error instanceof Error ? error.message : 'the read failed';
}

/** The store's read watermark; a failure is returned, never turned into `null`. */
export async function readWatermark(
  records: DecisionReadRecordsPort,
): Promise<{ status: 'ready'; value: CommitCursor | null } | CoreRejection> {
  const read = await records.readMany([]);
  if (read.status !== 'ready') return storeFailureToRejection(read);
  return { status: 'ready', value: read.value.readThrough };
}

/** §4.1 line 772: one §4.1 lookup page is at most 200 records. */
const LOOKUP_PAGE_LIMIT = 200;

/**
 * One registered index's complete candidate set, paged by `after` to the very
 * end (2A L10: the shared reads have no whole-window cap). §4.1 line 772: a page
 * that observed a later commit than the window's first page makes the window
 * inconsistent; the whole read is retried (<=4) and a persistently changing
 * index is reported `unavailable`, never stamped with a mixed watermark.
 * `truncated` stays in the type (P5) and is always `false`: the read reaches
 * the end, so a complete count is always safe to report.
 */
export async function lookupAll<T = EncodedRecord>(
  records: DecisionReadRecordsPort,
  index: string,
  values: readonly (string | number | boolean | null)[],
): Promise<LookupBatch<T>> {
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const items: T[] = [];
    let first: CommitCursor | null | undefined;
    let stable = true;
    let after: string | undefined;
    for (;;) {
      const page = await records.lookup({ index, values, limit: LOOKUP_PAGE_LIMIT,
        ...(after === undefined ? {} : { after }) });
      if (page.status !== 'ready') throw page;
      const pageWatermark = page.value.readThrough;
      if (first === undefined) first = pageWatermark;
      else if (first !== pageWatermark) stable = false;
      for (const record of page.value.records) items.push(record as unknown as T);
      const next = page.value.next;
      if (next === null || next === undefined) break;
      after = next;
    }
    if (stable) return { items, watermark: first ?? null, truncated: false };
  }
  throw { status: 'rejected', code: 'unavailable',
    reason: `lookup index ${index} did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts` };
}

/** Every Goal of a workspace through the existing `a2-goal-by-workspace` index. */
export async function listWorkspaceGoals(
  records: DecisionReadRecordsPort,
  workspace: WorkspaceScope,
): Promise<{ goals: GoalSnapshot[]; watermark: CommitCursor | null; truncated: boolean }> {
  const batch = await lookupAll(records, GOAL_BY_WORKSPACE_INDEX, [workspace.projectId, workspace.workspaceId]);
  const goals: GoalSnapshot[] = [];
  for (const record of batch.items) {
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') continue;
    const goal = decoded.value;
    if (goal.ref.projectId !== workspace.projectId || goal.workspaceRef.workspaceId !== workspace.workspaceId) continue;
    goals.push(goal);
  }
  goals.sort((left, right) => compareText(canonicalJson(left.ref as unknown as JsonValue), canonicalJson(right.ref as unknown as JsonValue)));
  return { goals, watermark: batch.watermark, truncated: batch.truncated };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function goalParallelRiskText(otherGoalRef: GoalRef): string {
  return `与 ${otherGoalRef.goalId} 并行，已接受风险`;
}

/** §2.2/§2.8: the default-applying read of the saved settings (record-codecs helper). */
export function normalizedGoalSettings(goal: GoalSnapshot): GoalSettingsV1 {
  return readGoalSettings(goal);
}

export function goalDecisionBasis(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return { goalRef: { ...goal.ref }, workspaceRef: { ...goal.workspaceRef }, objective: goal.objective,
    activePlanRef: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision },
    settings: structuredClone(normalizedGoalSettings(goal)) };
}

/** §4.3 line 829: the two ways a Goal stops generating new conflict cards. */
export type GoalTerminalState = { cancelled: boolean; completed: boolean };

/**
 * §4.3: a Goal is terminal when its desired state is `cancelled` or a formal
 * `GoalPhase` snapshot proves it `COMPLETED`. Absence is a real "not terminal";
 * a failed or corrupt GoalPhase read is RETURNED (`unavailable`), never turned
 * into the false fact "not terminal" that would resurface a waiting card.
 */
export async function readGoalTerminalState(
  records: DecisionReadRecordsPort,
  goal: GoalSnapshot,
): Promise<ReadResult<GoalTerminalState>> {
  if (goal.desiredState === 'cancelled') {
    return { status: 'ready', value: { cancelled: true, completed: false } };
  }
  const refKey = canonicalJson({ aggregateType: 'GoalPhase', projectId: goal.ref.projectId,
    goalId: goal.ref.goalId } as unknown as JsonValue);
  let read: Awaited<ReturnType<DecisionReadRecordsPort['readMany']>>;
  try {
    read = await records.readMany([refKey]);
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }
  if (read.status !== 'ready') return storeFailureToRejection(read);
  const record = read.value.records.find((candidate) => candidate.refKey === refKey);
  if (record === undefined) return { status: 'ready', value: { cancelled: false, completed: false } };
  const decoded = decodeGoalPhaseSnapshot(record);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `GoalPhase: ${decoded.reason}` };
  }
  // §4.3 line 829 (lead, accept review NEW-2): only a completion of the CURRENT active Plan is a terminal fact.
  const completedPlanIsActive = goal.activePlanRevision !== null
    && canonicalJson(decoded.value.planRef as unknown as JsonValue) === canonicalJson(goal.activePlanRevision as unknown as JsonValue);
  return { status: 'ready', value: { cancelled: false, completed: decoded.value.phase === 'COMPLETED' && completedPlanIsActive } };
}

// -------------------------------------------------------------------------- //
// The assembler                                                               //
// -------------------------------------------------------------------------- //

/** Builds the conflict assembler; the factory itself never throws. */
export function createGoalConflictAssembler(
  deps: GoalConflictAssemblerDependencies,
): GoalConflictAssemblerPort {
  return {
    async queryGoalConflicts(ctx, input) {
      return queryGoalConflicts(deps, ctx, input);
    },
  };
}

async function queryGoalConflicts(
  deps: GoalConflictAssemblerDependencies,
  ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; atLeastCursor?: CommitCursor },
): Promise<ReadResult<GoalConflictReadV1>> {
  // §4.1 line 772 / §3.3: one stable window, at most 4 attempts.
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const result = await assembleGoalConflicts(deps, ctx, input);
    if (result !== CONFLICT_WINDOW_MOVED) return result;
  }
  return { status: 'rejected', code: 'unavailable',
    reason: `conflicts did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts` };
}

async function assembleGoalConflicts(
  deps: GoalConflictAssemblerDependencies,
  ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; atLeastCursor?: CommitCursor },
): Promise<ReadResult<GoalConflictReadV1> | typeof CONFLICT_WINDOW_MOVED> {
  // §8.2 scope row: the explicit Workspace is compared with the bound scope
  // before any foreign Goal/Plan record is read.
  const scopeProblem = workspaceScopeProblem(ctx, input.workspace);
  if (scopeProblem !== null) return scopeProblem;
  let listed: Awaited<ReturnType<typeof listWorkspaceGoals>>;
  try {
    listed = await listWorkspaceGoals(deps.records, input.workspace);
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }
  // §3.3 "集合枚举用首读 ledgerHorizon": the first listing fixes the ONE window
  // every footprint read below must share; `sourceCursor` is that horizon, never
  // a later watermark.
  const watermark = listed.watermark;
  const footprints: { goal: GoalSnapshot; footprint: GoalFootprintV1 }[] = [];
  for (const goal of listed.goals) {
    const read = await readGoalFootprint(deps, ctx, { goalRef: goal.ref,
      ...(input.atLeastCursor === undefined ? {} : { atLeastCursor: input.atLeastCursor }) });
    if (read.status !== 'ready') return read;
    footprints.push({ goal, footprint: read.value });
  }

  // §4.3 line 829: a cancelled or formally COMPLETED Goal never produces a new
  // conflict WAITING card. Read the terminal fact for every listed Goal inside
  // the same window before the window is verified.
  const terminalByKey = new Map<string, GoalTerminalState>();
  for (const { goal } of footprints) {
    const terminalRead = await readGoalTerminalState(deps.records, goal);
    if (terminalRead.status !== 'ready') return terminalRead;
    terminalByKey.set(canonicalJson(goal.ref as unknown as JsonValue), terminalRead.value);
  }

  // §4.1 line 772: a later horizon proves the listing and the footprint reads did
  // not share one window. Retry the whole window rather than publish a mixed one.
  const windowRead = await readWatermark(deps.records);
  if (windowRead.status !== 'ready') return windowRead;
  if (windowRead.value !== null && (watermark === null || windowRead.value > watermark)) return CONFLICT_WINDOW_MOVED;
  if (watermark === null) return { status: 'rejected', code: 'unavailable', reason: 'the workspace has no readable ledger watermark' };
  const readiness = atLeastCursorResult<GoalConflictReadV1>(watermark, input.atLeastCursor);
  if (readiness !== null) return readiness;

  const cards: DecisionCardV1[] = [];
  const labels: GoalConflictReadV1['labels'] = [];
  const footprintCompleteness: GoalConflictReadV1['footprintCompleteness'] = footprints.map(({ goal, footprint }) => ({
    goalRef: { ...goal.ref },
    executedFiles: footprint.executedFilesAvailable ? 'available' : 'not_available',
    possiblyIncomplete: footprint.possiblyIncomplete,
    unmappedFiles: footprint.executedFiles.filter((file) => file.moduleRef === null).map((file) => file.path),
  }));

  for (let leftIndex = 0; leftIndex < footprints.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < footprints.length; rightIndex += 1) {
      const left = footprints[leftIndex]!;
      const right = footprints[rightIndex]!;
      const facts = goalConflictFacts(left.footprint, right.footprint);
      const risk = acceptedRisk(left.goal, right.goal);
      if (risk) {
        labels.push(labelFor(left.goal, right.goal));
        labels.push(labelFor(right.goal, left.goal));
        continue;
      }
      if (!facts.overlaps) continue;
      const leftTerminal = terminalByKey.get(canonicalJson(left.goal.ref as unknown as JsonValue));
      const rightTerminal = terminalByKey.get(canonicalJson(right.goal.ref as unknown as JsonValue));
      const terminal: GoalTerminalState = {
        cancelled: (leftTerminal?.cancelled ?? false) || (rightTerminal?.cancelled ?? false),
        completed: (leftTerminal?.completed ?? false) || (rightTerminal?.completed ?? false),
      };
      cards.push(conflictCard(left.goal, right.goal, terminal));
    }
  }
  return { status: 'ready', value: { cards, labels, footprintCompleteness, sourceCursor: watermark } };
}

function acceptedRisk(left: GoalSnapshot, right: GoalSnapshot): boolean {
  const match = (self: GoalSnapshot, other: GoalSnapshot): boolean => {
    const risks = normalizedGoalSettings(self).parallelRisks;
    return risks.some((risk) => canonicalJson(risk.otherGoalRef as unknown as JsonValue) === canonicalJson(other.ref as unknown as JsonValue)
      && canonicalJson(risk.selfPlanRef as unknown as JsonValue) === canonicalJson(self.activePlanRevision as unknown as JsonValue)
      && canonicalJson(risk.otherPlanRef as unknown as JsonValue) === canonicalJson(other.activePlanRevision as unknown as JsonValue));
  };
  return match(left, right) || match(right, left);
}

function labelFor(goal: GoalSnapshot, other: GoalSnapshot): GoalConflictReadV1['labels'][number] {
  return { goalRef: { ...goal.ref }, otherGoalRef: { ...other.ref },
    text: goalParallelRiskText(other.ref),
    selfPlanRef: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision },
    otherPlanRef: other.activePlanRevision === null ? null : { ...other.activePlanRevision } };
}

function conflictCard(left: GoalSnapshot, right: GoalSnapshot, terminal: GoalTerminalState): DecisionCardV1 {
  const pair = [left, right]
    .map((goal) => ({ goalRef: { ...goal.ref }, revision: goal.revision,
      activePlanRef: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision } }))
    .sort((a, b) => compareText(canonicalJson(a.goalRef as unknown as JsonValue), canonicalJson(b.goalRef as unknown as JsonValue)));
  const identity = { kind: 'goal_conflict' as const, pair: [
    { goalRef: pair[0]!.goalRef, activePlanRef: pair[0]!.activePlanRef },
    { goalRef: pair[1]!.goalRef, activePlanRef: pair[1]!.activePlanRef },
  ] as [{ goalRef: GoalRef; activePlanRef: GoalSnapshot['activePlanRevision'] },
    { goalRef: GoalRef; activePlanRef: GoalSnapshot['activePlanRevision'] }] };
  const key = decisionSourceKey(identity);
  const pins = [
    ...pair.map((entry) => ({ ref: entry.goalRef, revision: entry.revision })),
    ...pair.filter((entry) => entry.activePlanRef !== null).map((entry) => ({ ref: entry.activePlanRef!, revision: 1 })),
  ];
  const source = { kind: 'goal_conflict' as const, key, goalRef: { ...pair[1]!.goalRef },
    pins, goalBases: [goalDecisionBasis(left), goalDecisionBasis(right)] };
  // Either Goal being terminal (not only the larger-key attributed one) closes
  // the pair's card; the identity/pins above stay the same so old history joins.
  const closed = terminal.cancelled || terminal.completed;
  return {
    cardKey: key, source, state: closed ? 'closed' : 'waiting_answer', goalRef: { ...pair[1]!.goalRef },
    senderSessionRef: null, requestRef: null, objects: [], options: closed ? [] : [...CONFLICT_OPTIONS],
    answerMessageRef: null, answer: null, application: null, candidateStatus: null, staleReason: null,
    closedReason: closed ? (terminal.cancelled ? 'goal_cancelled' : 'source_resolved') : null,
    readOnly: closed, actions: closed ? [] : ['answer'],
  };
}

/** §4.3: one Goal's footprint (planned modules + mapped executed files). */
export async function readGoalFootprint(
  deps: GoalConflictAssemblerDependencies,
  ctx: CoreCallContext,
  input: { goalRef: GoalRef; atLeastCursor?: CommitCursor },
): Promise<ReadResult<GoalFootprintV1>> {
  let goal: GoalSnapshot;
  try {
    const read = await deps.records.readMany([canonicalJson(input.goalRef as unknown as JsonValue)]);
    if (read.status !== 'ready') return storeFailureToRejection(read);
    const record = read.value.records.find((candidate) => candidate.refKey === canonicalJson(input.goalRef as unknown as JsonValue));
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable', reason: `Goal footprint: ${decoded.reason}` };
    goal = decoded.value;
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }

  // The current formal catalog (a baseline without a catalog is NOT an empty one).
  // §8.2 data row: a catalog read that cannot complete is `unavailable` naming
  // the source, never the legitimate "no catalog adopted" answer. Only a real
  // `not_found` (or a ready result with `catalog: null`) stays `architecture = null`.
  let architecture: AdoptedArchitecture | null = null;
  let revision: Awaited<ReturnType<ArchitectureCatalogPort['readArchitectureRevision']>>;
  try {
    revision = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  } catch (error) {
    return { status: 'rejected', code: 'unavailable',
      reason: `architecture catalog: ${unavailableReason(error)}` };
  }
  if (revision.status === 'ready') {
    architecture = revision.value.catalog === null ? null : revision.value.catalog.catalog;
  } else if (revision.status === 'rejected') {
    return { status: 'rejected', code: 'unavailable', reason: `architecture catalog: ${revision.reason}` };
  } else if (revision.status === 'not_ready') {
    return { status: 'rejected', code: 'unavailable', reason: 'architecture catalog: the read window was not ready' };
  }
  // `not_found` is the genuine "no catalog adopted" answer: keep it as absence.

  // The active Plan's planned modules (work + a real module scope). §4.3 line
  // 825: future/deferred are still intent, only cancelled/superseded are out.
  const plannedModules: ModuleRef[] = [];
  if (goal.activePlanRevision !== null) {
    try {
      const read = await deps.records.readMany([canonicalJson(goal.activePlanRevision as unknown as JsonValue)]);
      if (read.status !== 'ready') return storeFailureToRejection(read);
      const record = read.value.records.find((candidate) => candidate.refKey === canonicalJson(goal.activePlanRevision as unknown as JsonValue));
      if (record !== undefined) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable', reason: `Goal footprint plan: ${decoded.reason}` };
        const seen = new Set<string>();
        for (const task of decoded.value.tasks) {
          if (task.taskKind !== 'work' || task.disposition === 'cancelled' || task.disposition === 'superseded'
            || task.scope.kind !== 'module') continue;
          const module = { projectId: goal.ref.projectId, moduleId: task.scope.moduleRef };
          const key = canonicalJson(module as unknown as JsonValue);
          if (seen.has(key)) continue;
          seen.add(key);
          plannedModules.push(module);
        }
      }
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
  }

  const executed = await deps.executedFiles.readGoalExecutedFiles(ctx, { goalRef: input.goalRef,
    ...(input.atLeastCursor === undefined ? {} : { atLeastCursor: input.atLeastCursor }) });
  if (executed.status !== 'ready') return executed;
  const mapped = architecture === null
    ? executed.value.files.map((file) => ({ path: file.path, moduleRef: null, certainty: file.certainty }))
    : mapExecutedFilesToModules(architecture, executed.value.files);
  return { status: 'ready', value: {
    goalRef: { ...goal.ref },
    planRef: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision },
    plannedModules,
    executedFiles: mapped,
    executedFilesAvailable: executed.value.availability === 'available',
    possiblyIncomplete: executed.value.possiblyIncomplete || executed.value.availability !== 'available'
      || mapped.some((file) => file.moduleRef === null),
  } };
}

/**
 * §4.3: project-relative, segmented, longest legal catalog path match; files
 * with no single longest owner stay `moduleRef: null` (unmapped), never guessed.
 */
export function mapExecutedFilesToModules(
  catalog: AdoptedArchitecture,
  files: readonly { path: string; certainty: 'definite' | 'possible' }[],
): GoalFootprintV1['executedFiles'] {
  const definitions = catalog.modules.flatMap((definition) => definition.paths.map((prefix) => ({ definition, prefix })));
  return files.map((file) => {
    let bestLength = -1;
    let winners: ModuleRef[] = [];
    for (const { definition, prefix } of definitions) {
      const length = matchingPrefixLength(file.path, prefix);
      if (length < 0) continue;
      if (length > bestLength) { bestLength = length; winners = [definition.ref]; continue; }
      if (length === bestLength) {
        const key = canonicalJson(definition.ref as unknown as JsonValue);
        if (!winners.some((winner) => canonicalJson(winner as unknown as JsonValue) === key)) winners.push(definition.ref);
      }
    }
    return { path: file.path, moduleRef: winners.length === 1 ? winners[0]! : null, certainty: file.certainty };
  });
}

/** `-1` when the path is not under the prefix; otherwise the matched prefix length. */
function matchingPrefixLength(filePath: string, prefix: string): number {
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (normalized.length === 0) return -1;
  if (filePath === normalized) return normalized.length;
  if (filePath.startsWith(`${normalized}/`)) return normalized.length;
  return -1;
}
