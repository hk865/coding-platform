/**
 * 7D2 O1b (v4 §2.2): the one `role_line` operation driver and the writers that create and link role lines —
 * `start_lines` (L26), `open`/`change-scope` (L27), `reuse` (L39), the split's starter/continuer (b02; O2 only calls
 * it) and the region open C1 calls. A line is created only through `ensureLine` (`B/line-creation.ts`): the
 * reservation is the admission's (`session-directory.ts` writes the parent step `reserved` in the child's seat
 * commit), the conversion is `recordSessionCreated`'s, and the release is one `cancel_reservation` in the
 * operation's terminal commit. A scope write is the one L25 reanchor commit. Every single operation write goes
 * through `executeWriteCommand` with one `RoleLineOperationChanged` event (L-1).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ModuleRef, ProjectScope, RoleConfigurationRef, SessionRef, SessionWorkLinkRef, VersionPin,
} from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { SessionProvenanceV1 } from '../../../contracts/core/session.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import {
  isRoleLineOpenDuty, isRoleScopeV1, roleLineDutyOf, roleScopeOfTarget, workLinkTargetOf,
  type CapacityAtCapDetailV1, type RoleLineDutyV1, type RoleLineOpenDutyV1, type RoleLineSplitSavedV1,
  type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { CommitFragment } from '../persistence/command-executor.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type {
  RoleLineOperationV1, SessionCard, SessionDirectoryPort, SessionOperationRecord,
} from '../model/session-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { RoleLineActionV1, RoleLineStepStateV1 } from '../state/role-line-action.js';
import { allocationNext } from '../state/role-line-allocation.js';
import {
  ROLE_LINE_CHANGE_SCOPE_PHASE, roleLineChildCommandId, roleLineOperationRef, roleLineStepTransition,
  type START_LINES_PHASES,
} from '../state/role-line-operation.js';
import { createAllocationRead, seatAtCap } from './allocation-read.js';
import { roleLineOperationChangedCodec, roleLineSplitSavedCodec } from './role-line-orchestration-codecs.js';
import { roleLineCommitContribution } from './role-scope-commit.js';
import { stableSessionCreationIdentity } from './session-directory.js';
import { handoffContextOf, savedHostPrincipal } from './session-handoff-service.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, encodeSessionOperationRecord, operationRefKey,
} from './session-record-codecs.js';
import { responsibleLinkRef, type SessionResponsibilityPort } from './session-responsibility-service.js';
import { eventIdOf, trustedContext } from './trusted-context.js';

export const ROLE_LINE_SPLIT_PHASES = ['planned', 'admitted', 'created', 'linked', 'done'] as const;
export type RoleLineSplitPhaseV1 = (typeof ROLE_LINE_SPLIT_PHASES)[number];
/** TS-10 item 6: the planner's answer is the saved body without its source. */
export type RoleLineSplitPlanV1 = Omit<RoleLineSplitSavedV1, 'source'>;

export type RoleLineLineV1 = { operation: OperationRef; session: SessionRef | null; revision: number };
export type RoleLineContinueResultV1 = { revision: number;
  state: 'done' | 'waiting' | 'created' | 'registered' | 'blocked';
  capacity: CapacityAtCapDetailV1 | null };

export type RoleLineCreateInputV1 = { commandId: string; duty: PlatformDutyV1; scope: { kind: 'project' };
  reason: string; provenance: SessionProvenanceV1; roleConfiguration: RoleConfigurationRef;
  name: string | null; roleScopes: RoleScopeV1[]; parentOperation: OperationRef };
export type RoleLineCreateResultV1 =
  | { status: 'created' | 'replayed'; session: SessionRef }
  | { status: 'accepted'; operationRef: OperationRef }
  | { status: 'capacity_blocked'; duty: PlatformDutyV1; detail: CapacityAtCapDetailV1 | null }
  | CoreRejection;
export interface RoleLineCreatePort {
  ensureLine(ctx: CoreCallContext, input: RoleLineCreateInputV1): Promise<RoleLineCreateResultV1>;
  /** D-4: ruling 4.7's read-only half (`B/line-creation.ts:173`); the resume rebuilds the saved child's input. */
  findLine(ctx: CoreCallContext, input: { commandId: string }): Promise<ReadResult<{ status: 'none' } | {
    status: 'found'; input: Omit<RoleLineCreateInputV1, 'commandId' | 'scope' | 'name' | 'roleScopes' | 'parentOperation'>
      & { name?: string | null; roleScopes?: RoleScopeV1[] } }>>;
}

export type RoleLineOpenCommandV1 = { commandId: string; duty: RoleLineOpenDutyV1;
  scope: RoleScopeV1[]; name?: string };
export type RoleLineChangeScopeCommandV1 = { commandId: string; session: SessionRef; scope: RoleScopeV1[] };
export type RoleLineReuseCommandV1 = { commandId: string; session: SessionRef; scope: RoleScopeV1[] };
/** d05: C1's region open (v4 :8049–:8058): one adviser line on one top-level module under the cold-start parent. */
export type RoleLineRegionOpenInputV1 = { commandId: string; parentOperation: OperationRef;
  duty: 'adviser'; module: ModuleRef };
export type RoleLineRegionOpenResultV1 =
  | { status: 'created' | 'replayed'; value: RoleLineLineV1 }
  | Exclude<RoleLineCreateResultV1, { status: 'created' | 'replayed' }>;

export interface RoleLineOperationsPort {
  continueOperation(ctx: CoreCallContext, input: { operation: OperationRef }):
    Promise<ReadResult<RoleLineContinueResultV1>>;
  open(ctx: CoreCallContext, input: RoleLineOpenCommandV1): Promise<WriteResult<RoleLineLineV1>>;
  changeScope(ctx: CoreCallContext, input: RoleLineChangeScopeCommandV1): Promise<WriteResult<RoleLineLineV1>>;
  reuse(ctx: CoreCallContext, input: RoleLineReuseCommandV1): Promise<WriteResult<RoleLineLineV1>>;
  /** d05 / v4 :9066: C1 binds this by symbol and creates no line itself. */
  openRegionLine(ctx: CoreCallContext, input: RoleLineRegionOpenInputV1): Promise<RoleLineRegionOpenResultV1>;
}
export type RoleLineSplitStartV1 = { operation: OperationRef; revision: number };
export interface RoleLineSplitPort {
  /** b02: the one starter/continuer; O2 only calls it. */
  startRoleLineSplit(ctx: CoreCallContext, input: { source: SessionRef; plan: RoleLineSplitPlanV1 }):
    Promise<ReadResult<RoleLineSplitStartV1>>;
}
export type RoleLineOperationsDeps = {
  /** The split's "unfinished split of the same source" check reads the operation index (v4 :1937). */
  records: GoalRecordTransactionPort & RecordLookupPort;
  createLine: RoleLineCreatePort;
  operations: Pick<SessionDirectoryPort, 'getSessionOperation' | 'readSession'>;
  responsibility: Pick<SessionResponsibilityPort, 'reanchorSessionResponsibility'>;
  /** b11: O5b injects the one post-release close structurally; absent keeps the terminal release unchanged. */
  closeStale?: (ctx: CoreCallContext, input: {
    projectRef: ProjectScope; duty: RoleLineDutyV1; operation: OperationRef | null;
  }) => Promise<unknown>;
  /** Lead (O1b group text): the role every new line is created with, by duty (CP: `platformRoleProfile(duty).template`). */
  platformRole(duty: PlatformDutyV1): RoleConfigurationRef;
  /** The split source's duty, read through the one Session duty resolver (CP's `sessionDutyResolver`). */
  duty: SessionDutyReadPort;
  now(): string;
};

/** `start_lines`' one record, born in the project's first workspace-registration commit (L26; TS-10 item 3). */
export function startLinesInitialRecord(input: { projectId: string; workspaceId: string; now: string }):
  SessionOperationRecord {
  return { ref: roleLineOperationRef(input.projectId, 'start_lines', 'start_lines'), revision: 1,
    workspaceId: input.workspaceId, phase: 'accepted', requestedAt: input.now, updatedAt: input.now,
    observation: null, failure: null,
    action: { kind: 'role_line', action: 'start_lines', phase: 'reserve', goalRef: null, result: null,
      steps: (['secretary', 'adviser', 'scribe'] as const).map((key) => ({
        key, duty: key, childOperation: null, state: 'pending' as const })) } };
}

/** The outcome of one step drive: what was written (or not) and the refusal a caller answers with. */
type StepOutcomeV1 =
  | { kind: 'progressed'; record: RoleLineOperationV1; cursor: WriteCursorV1 }
  | { kind: 'waiting'; record: RoleLineOperationV1; refusal: CoreRejection; capacity: CapacityAtCapDetailV1 | null }
  | { kind: 'blocked'; record: RoleLineOperationV1 }
  /** Another writer (the Host's resume of a `role_line_add`, or the person's own call) moved the step meanwhile. */
  | { kind: 'raced'; record: RoleLineOperationV1 }
  | { kind: 'failed'; record: RoleLineOperationV1; refusal: CoreRejection }
  | { kind: 'rejected'; rejection: CoreRejection };
type WriteCursorV1 = Extract<WriteResult<unknown>, { status: 'committed' }>['cursor'];

/** A refusal that a later pass may not see again; every other refusal of a create is permanent (v4 :2210). */
const TRANSIENT_CODES: ReadonlySet<string> = new Set(['unavailable', 'busy', 'cancelled']);

/** The action phase a step state shows (the action's `phase` carries the step phase, v4 §2.2 item 3). */
function stepPhaseOf(state: RoleLineStepStateV1): (typeof START_LINES_PHASES)[number] {
  switch (state) {
    case 'pending': return 'reserve';
    case 'reserved': return 'create';
    case 'created': return 'register';
    case 'registered': case 'linked': return 'link';
    case 'done': return 'done';
    case 'failed': return 'failed';
  }
}

/** b14: the one affected goal of a single-goal scope; `null` otherwise. */
function singleGoalRefOf(scope: readonly RoleScopeV1[]): RoleLineActionV1['goalRef'] {
  return scope.length === 1 && scope[0]!.kind === 'goal' ? scope[0]!.goalRef : null;
}

/** `open`'s and the split's one at-cap mapping (v4 :1993–:1994): the admission's refusal, rebuilt from its detail
 *  by `seatAtCap`, the one copy of the sentence. The admission always fills `detail` (A1a; reply list B). */
function capacityRefusal(line: Extract<RoleLineCreateResultV1, { status: 'capacity_blocked' }>): CoreRejection {
  return seatAtCap(line.detail!)!;
}

/** A canonical scope list: every entry a role scope, no duplicate by `canonicalKey`; the empty set is legal. */
function roleScopeListProblem(scope: unknown): string | null {
  if (!Array.isArray(scope) || !scope.every(isRoleScopeV1)) return 'the scope must be a list of role scopes';
  const keys = new Set(scope.map((entry) => canonicalKey(entry as unknown as JsonValue)));
  return keys.size === scope.length ? null : 'the scope names one role scope twice';
}

function roleLineReadFailure<T>(read: ReadResult<T>, what: string): CoreRejection {
  if (read.status === 'rejected') return read;
  return rejected('unavailable', `${what} is ${read.status === 'not_found' ? 'missing' : 'not ready'}`);
}

/** v4 §2.2 item 4: the project's main workspace, the `start_lines` operation's; `null` when the project has none.
 *  The one read behind `lineContextOf` and L38's project-scope move (O2B-R1-03). */
export async function readMainWorkspace(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string):
  Promise<ReadResult<string | null>> {
  const key = operationRefKey(roleLineOperationRef(projectId, 'start_lines', 'start_lines'));
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const stored = read.value.records.find((record) => record.refKey === key);
  if (stored === undefined) return { status: 'ready', value: null };
  const decoded = decodeSessionOperationRecord(stored);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the start_lines operation is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value.workspaceId };
}

export function createRoleLineOperations(deps: RoleLineOperationsDeps): RoleLineOperationsPort & RoleLineSplitPort {
  const allocationRead = createAllocationRead({ records: deps.records });

  async function readRoleLineRecord(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<RoleLineOperationV1>> {
    const read = await deps.operations.getSessionOperation(ctx, ref);
    if (read.status !== 'ready') return read;
    if (read.value.action.kind !== 'role_line') return rejected('invalid', 'not a role_line operation');
    return { status: 'ready', value: read.value as RoleLineOperationV1 };
  }

  /** v4 §2.2 item 4: every line lives in the project's main workspace, the `start_lines` operation's; a project
   *  without one uses the call's workspace and infers none. */
  async function lineContextOf(ctx: CoreCallContext): Promise<ReadResult<CoreCallContext>> {
    const main = await readMainWorkspace(deps.records, ctx.projectId);
    if (main.status !== 'ready') return main;
    if (main.value === null || main.value === ctx.workspaceId || ctx.principal.kind !== 'host') {
      return { status: 'ready', value: ctx };
    }
    return { status: 'ready', value: handoffContextOf({ ...ctx, workspaceId: main.value }, ctx.principal) };
  }

  /**
   * The one guarded single write of a role_line operation (L-1: one `RoleLineOperationChanged` with its
   * `operationRef`, through `executeWriteCommand`; precedent `role-limits-service.ts`). A step write's identity is the
   * operation and its next revision, so a lost answer replays the receipt; the accepted write of a person command
   * carries the public command as its fingerprint. `extra` rides in the same commit (the terminal release).
   */
  async function writeOperation(
    ctx: CoreCallContext, prior: RoleLineOperationV1 | null, next: RoleLineOperationV1,
    command?: { commandId: string; fingerprintInput: JsonValue }, extra?: CommitFragment,
  ): Promise<WriteResult<{ revision: number }>> {
    const trusted = trustedContext(ctx, 'a role-line operation write');
    if (!trusted.ok) return trusted.rejection;
    const key = operationRefKey(next.ref);
    const result = await executeWriteCommand(deps.records, {
      operation: 'role-line-operation',
      principal: ctx.principal as unknown as JsonValue,
      commandId: command?.commandId ?? `${next.ref.operationId}:${next.revision}`,
      scope: { projectId: next.ref.projectId, workspaceId: next.workspaceId },
      fingerprintInput: command?.fingerprintInput
        ?? ({ ref: next.ref, revision: next.revision, phase: next.phase, action: next.action } as unknown as JsonValue),
      read: async () => ({ status: 'ready' as const, facts: null }),
      decide: (): { refuse: never } | { decision: null } => ({ decision: null }),
      build: (_decision, keys) => ({
        records: [encodeSessionOperationRecord(next), ...(extra?.records ?? [])],
        claims: [...(extra?.claims ?? [])],
        events: [roleLineOperationChangedCodec.encode({
          eventId: eventIdOf(keys.identityKey, 'changed'), eventType: 'RoleLineOperationChanged', schemaVersion: 1,
          occurredAt: deps.now(), projectId: next.ref.projectId, workspaceId: next.workspaceId,
          actor: trusted.actor, revision: next.revision, operationRef: next.ref }), ...(extra?.events ?? [])],
        guards: [{ refKey: key, expectedRevision: prior === null ? null : prior.revision }, ...(extra?.guards ?? [])],
        ...(extra?.commitCursorBindings === undefined ? {} : { commitCursorBindings: extra.commitCursorBindings }),
      }),
      result: { eventType: 'RoleLineOperationChanged', schemaVersion: 1,
        decode: (event) => roleLineOperationChangedCodec.decode(event),
        validate: (event, receipt, keys) => canonicalKey(event.operationRef as unknown as JsonValue)
          !== canonicalKey(next.ref as unknown as JsonValue) ? 'the event records another operation'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        project: (event) => ({ revision: event.revision }) },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
    return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
  }

  /** The one failed record: the record, the action's phase and result, and the stored refusal (L-6 replays it). */
  function failedRecordOf(record: RoleLineOperationV1, action: RoleLineActionV1, refusal: CoreRejection):
    RoleLineOperationV1 {
    return { ...record, revision: record.revision + 1, updatedAt: deps.now(), phase: 'failed',
      failure: { code: refusal.code, reason: refusal.reason },
      action: { ...action, phase: 'failed', result: { status: 'failed', reason: refusal.reason } } };
  }

  /** One step transition; when every step is done the operation completes in the same write. */
  async function advanceStep(ctx: CoreCallContext, record: RoleLineOperationV1, index: number,
    state: RoleLineStepStateV1): Promise<StepOutcomeV1> {
    const stepped = roleLineStepTransition(record.action, index, { state });
    if (!stepped.ok) return { kind: 'rejected', rejection: rejected('unavailable', `the role line step ${stepped.reason}`) };
    const firstOpen = stepped.action.steps.find((step) => step.state !== 'done');
    const completed = firstOpen === undefined;
    const next: RoleLineOperationV1 = { ...record, revision: record.revision + 1, updatedAt: deps.now(),
      phase: completed ? 'completed' : 'running',
      action: { ...stepped.action, phase: completed ? 'done' : stepPhaseOf(firstOpen.state),
        result: completed ? { status: 'done', reason: null } : stepped.action.result } };
    const written = await writeOperation(ctx, record, next);
    if (written.status === 'rejected' && (written.code === 'revision_conflict' || written.code === 'idempotency_conflict')) {
      return { kind: 'raced', record };
    }
    if (written.status !== 'committed') return { kind: 'rejected', rejection: written };
    return { kind: 'progressed', record: next, cursor: written.cursor };
  }

  /** A permanent refusal: the step and the operation fail, and an un-converted reservation is cancelled in the SAME
   *  commit (v4 :2032 table "terminal"); the post-release close follows (b11). */
  async function failStep(ctx: CoreCallContext, record: RoleLineOperationV1, index: number,
    refusal: CoreRejection): Promise<StepOutcomeV1> {
    const step = record.action.steps[index]!;
    const stepped = roleLineStepTransition(record.action, index, { state: 'failed' });
    if (!stepped.ok) return { kind: 'rejected', rejection: rejected('unavailable', `the role line step ${stepped.reason}`) };
    const projectRef: ProjectScope = { projectId: record.ref.projectId };
    let release: CommitFragment | undefined;
    const reserved = step.childOperation !== null && step.duty !== null
      && (step.state === 'reserved' || step.state === 'created');
    if (reserved) {
      const current = await allocationRead.readAllocationForCommit(ctx, { projectRef, duty: step.duty! });
      if (current.status !== 'ready') return { kind: 'rejected', rejection: roleLineReadFailure(current, 'the role-line allocation') };
      // O1B-R1-02: `convert` removes the reservation in the commit that registers the line: absent => the line exists.
      if (!current.value.allocation?.reservations.some((entry) =>
        operationRefKey(entry.operationRef) === operationRefKey(step.childOperation!))) return { kind: 'raced', record };
      const contribution = roleLineCommitContribution({ projectRef, records: [], guards: [], links: [],
        claimChanges: [], bindings: [], events: [],
        allocation: allocationNext({ projectRef, duty: step.duty!, current: current.value.allocation,
          change: { kind: 'cancel_reservation', operationRef: step.childOperation! } }) }, current.value.allocation);
      if (!contribution.ok) return { kind: 'rejected', rejection: contribution.rejection };
      release = contribution.fragment;
    }
    const next = failedRecordOf(record, stepped.action, refusal);
    const written = await writeOperation(ctx, record, next, undefined, release);
    if (written.status === 'rejected' && (written.code === 'revision_conflict' || written.code === 'idempotency_conflict')) {
      return { kind: 'raced', record };        // a registration moved the allocation first: re-read and replay the child
    }
    if (written.status !== 'committed') return { kind: 'rejected', rejection: written };
    if (reserved) await deps.closeStale?.(ctx, { projectRef, duty: step.duty!, operation: step.childOperation });
    return { kind: 'failed', record: next, refusal };
  }

  /**
   * The step drive `start_lines`, `open` and the resumed `role_line_add` share (written once, TS-6). A `registered`
   * or `linked` step only advances its marker; any other step calls the one create entry again, which replays the
   * same child by its commandId, so a step is never re-created (v4 §2.2 item 4).
   */
  async function driveStep(ctx: CoreCallContext, record: RoleLineOperationV1, index: number,
    input: RoleLineCreateInputV1): Promise<StepOutcomeV1> {
    const step = record.action.steps[index]!;
    if (step.state === 'registered') return advanceStep(ctx, record, index, 'linked');
    if (step.state === 'linked') return advanceStep(ctx, record, index, 'done');
    const line = await deps.createLine.ensureLine(ctx, input);
    // The admission may have written the step `reserved`: continue from the record as stored now.
    const fresh = await readRoleLineRecord(ctx, record.ref);
    if (fresh.status !== 'ready') return { kind: 'rejected', rejection: roleLineReadFailure(fresh, 'the role-line operation') };
    const current = fresh.value;
    const now = current.action.steps[index]!;
    if (now.state !== 'pending' && now.state !== 'reserved' && now.state !== 'created') return { kind: 'raced', record: current };
    switch (line.status) {
      case 'created': case 'replayed':
        return advanceStep(ctx, current, index, now.state === 'created' ? 'registered' : 'created');
      case 'accepted':
        // Kernel created, registration pending: mark `created`; the next pass calls the create entry again.
        return now.state === 'created' ? { kind: 'blocked', record: current } : advanceStep(ctx, current, index, 'created');
      case 'capacity_blocked': {
        // The step stays pending; the operation waits for a `ProjectRoleLimitsChanged` wake (X-10: only the phase).
        const refusal = capacityRefusal(line);
        if (current.action.phase === 'waiting') return { kind: 'waiting', record: current, refusal, capacity: line.detail };
        const next: RoleLineOperationV1 = { ...current, revision: current.revision + 1, updatedAt: deps.now(),
          action: { ...current.action, phase: 'waiting' } };
        const written = await writeOperation(ctx, current, next);
        if (written.status !== 'committed') return { kind: 'rejected', rejection: written };
        return { kind: 'waiting', record: next, refusal, capacity: line.detail };
      }
      default:
        if (TRANSIENT_CODES.has(line.code)) return { kind: 'rejected', rejection: line };
        return failStep(ctx, current, index, line);
    }
  }

  /** The committed child's planned Session (the create operation's own ref). */
  async function lineSessionOf(ctx: CoreCallContext, record: RoleLineOperationV1): Promise<ReadResult<SessionRef | null>> {
    const child = record.action.steps[0]?.childOperation ?? null;
    if (child === null) return { status: 'ready', value: null };
    const read = await deps.operations.getSessionOperation(ctx, child);
    if (read.status !== 'ready') return read;
    return { status: 'ready', value: read.value.action.kind === 'create' ? read.value.action.plannedSessionRef : null };
  }

  function continueResultOf(outcome: StepOutcomeV1): ReadResult<RoleLineContinueResultV1> {
    switch (outcome.kind) {
      case 'rejected': return outcome.rejection;
      case 'waiting':
        return { status: 'ready', value: { revision: outcome.record.revision, state: 'waiting', capacity: outcome.capacity } };
      case 'blocked': case 'raced':
        return { status: 'ready', value: { revision: outcome.record.revision, state: 'blocked', capacity: null } };
      case 'failed':
        return { status: 'ready', value: { revision: outcome.record.revision, state: 'done', capacity: null } };
      case 'progressed': {
        const record = outcome.record;
        const open = record.action.steps.find((step) => step.state !== 'done');
        const state = record.phase === 'completed' ? 'done' : open?.state === 'created' ? 'created' : 'registered';
        return { status: 'ready', value: { revision: record.revision, state, capacity: null } };
      }
    }
  }

  /** `start_lines`' step input: the step's duty, a project line with its project link, the platform role. */
  function startLinesInputOf(record: RoleLineOperationV1, key: string): RoleLineCreateInputV1 {
    const duty = key as PlatformDutyV1;
    return { commandId: roleLineChildCommandId(record.ref.operationId, key), duty, scope: { kind: 'project' },
      reason: 'start_lines', provenance: { schemaVersion: 1, kind: 'new' }, roleConfiguration: deps.platformRole(duty),
      name: null, roleScopes: [{ kind: 'project' }], parentOperation: record.ref };
  }

  /** The saved child creation's creator as the call's principal: the child's identity is its creator's
   *  (session-directory.ts:164–:175), so a resume continues as that principal (D-4; O1B-R1-04 shares it). */
  async function creatorContextOf(ctx: CoreCallContext, childOperation: OperationRef): Promise<ReadResult<CoreCallContext>> {
    const child = await deps.operations.getSessionOperation(ctx, childOperation);
    if (child.status !== 'ready') return child;
    if (child.value.action.kind !== 'create' || child.value.action.creation === null) {
      return rejected('unavailable', 'the role line child is not a line creation');
    }
    const principal = savedHostPrincipal(child.value.action.creation.creator);
    if (principal === null) return rejected('unavailable', 'the role line child has no Host creator');
    return { status: 'ready', value: handoffContextOf(ctx, principal) };
  }

  async function continueOperation(ctx: CoreCallContext, input: { operation: OperationRef }):
    Promise<ReadResult<RoleLineContinueResultV1>> {
    const read = await deps.operations.getSessionOperation(ctx, input.operation);
    if (read.status !== 'ready') return read;
    if (read.value.action.kind !== 'role_line') return rejected('invalid', 'not a role_line operation');
    const record = read.value as RoleLineOperationV1;
    if (record.phase === 'completed' || record.phase === 'failed') {
      return { status: 'ready', value: { revision: record.revision, state: 'done', capacity: null } };
    }
    if (record.action.action === 'role_line_split') return continueRoleLineSplit(ctx, record);
    if (record.action.action === 'role_line_add') {
      // D-4: resume only from the saved child creation; a `pending` step has no child, so its caller replays it.
      const step = record.action.steps[0];                       // open / role_line_add has exactly one step
      if (step === undefined || step.childOperation === null) {
        return { status: 'ready', value: { revision: record.revision, state: 'blocked', capacity: null } };
      }
      const restored = await creatorContextOf(ctx, step.childOperation);
      if (restored.status !== 'ready') return restored;
      const savedCtx = restored.value;
      const commandId = roleLineChildCommandId(record.ref.operationId, step.key);
      const found = await deps.createLine.findLine(savedCtx, { commandId });
      if (found.status !== 'ready') return found;
      if (found.value.status === 'none') return rejected('unavailable', 'the role line child input is not stored');
      const saved = found.value.input;
      return continueResultOf(await driveStep(savedCtx, record, 0, {   // the start_lines arm's step drive, shared
        commandId, duty: saved.duty, scope: { kind: 'project' }, reason: saved.reason, provenance: saved.provenance,
        roleConfiguration: saved.roleConfiguration, name: saved.name ?? null, roleScopes: saved.roleScopes ?? [],
        parentOperation: record.ref }));
    }
    if (record.action.action !== 'start_lines') {
      // Person commands carry their request in the caller, not the record: the same commandId replays them
      // through the writer; the Host never guesses a scope. cold_start is C1's.
      return { status: 'ready', value: { revision: record.revision, state: 'blocked', capacity: null } };
    }
    // start_lines (C1, rework-1): drive the open steps in secretary -> adviser -> scribe order in this one call until
    // done, a wait or a stop; each step is still its own commit (v4 :2203), "next pass" is the next round here.
    let current = record;
    let last: StepOutcomeV1 | null = null;
    for (let pass = 0; pass < 16; pass += 1) {
      const index = current.action.steps.findIndex((step) => step.state !== 'done');
      if (index < 0) break;
      last = await driveStep(ctx, current, index, startLinesInputOf(current, current.action.steps[index]!.key));
      if (last.kind === 'raced') { current = last.record; continue; }
      if (last.kind !== 'progressed' || last.record.phase === 'completed') break;
      current = last.record;
    }
    if (last === null) return rejected('unavailable', 'the start_lines operation has no open step');
    return continueResultOf(last);
  }

  /** A person/platform add drives its one step to an end in the caller's call: done, waiting or refused. */
  async function driveLine(ctx: CoreCallContext, ref: OperationRef, input: RoleLineCreateInputV1,
    accepted: Extract<WriteResult<unknown>, { status: 'committed' }>): Promise<WriteResult<RoleLineLineV1>> {
    let cursor = accepted.cursor;
    let replayed = accepted.replayed;
    // One step is at most five writes; a race with the Host's resume only re-reads. The bound keeps a stalled
    // writer from spinning the caller: past it the line answers as not yet created.
    for (let pass = 0; ; pass += 1) {
      const read = await readRoleLineRecord(ctx, ref);
      if (read.status !== 'ready') return roleLineReadFailure(read, 'the role-line operation');
      const record = read.value;
      if (record.phase === 'completed') {
        const session = await lineSessionOf(ctx, record);
        if (session.status !== 'ready') return roleLineReadFailure(session, 'the line creation');
        return { status: 'committed', value: { operation: ref, session: session.value, revision: record.revision },
          replayed, cursor };
      }
      if (record.phase === 'failed') {
        return rejected((record.failure?.code ?? 'unavailable') as CoreError, record.failure?.reason ?? 'the line failed');
      }
      const outcome = pass < 16 ? await driveStep(ctx, record, 0, input) : { kind: 'blocked' as const, record };
      switch (outcome.kind) {
        case 'progressed': cursor = outcome.cursor; replayed = false; continue;
        case 'raced': continue;
        case 'waiting': case 'failed': return outcome.refusal;
        case 'rejected': return outcome.rejection;
        case 'blocked':
          return { status: 'committed', value: { operation: ref, session: null, revision: outcome.record.revision },
            replayed, cursor };
      }
    }
  }

  async function openLine(ctx: CoreCallContext, input: RoleLineOpenCommandV1): Promise<WriteResult<RoleLineLineV1>> {
    if (!isRecord(input) || !nonEmpty(input.commandId)) return rejected('invalid', 'roleLines.open requires a commandId');
    if (!isRoleLineOpenDuty(input.duty)) return rejected('invalid', 'role_line_duty');
    const problem = roleScopeListProblem(input.scope);
    if (problem !== null) return rejected('invalid', problem);
    if (input.name !== undefined && typeof input.name !== 'string') return rejected('invalid', 'the line name is a string');
    const name = input.name === undefined || input.name.trim() === '' ? null : input.name.trim();
    const trusted = trustedContext(ctx, 'a role-line open');
    if (!trusted.ok) return trusted.rejection;
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    // The saved action comes from the trusted principal, not an input field (v4 §2.2 item 4).
    const platformCaller = ctx.principal.kind === 'host' && ctx.principal.actor.kind === 'system';
    const savedAction = input.duty === 'reviewer' || platformCaller ? 'role_line_add' : 'open';
    const ref = roleLineOperationRef(ctx.projectId, 'open:add', input.commandId);
    const key = input.duty === 'reviewer' ? 'reviewer' : 'line';
    const now = deps.now();
    const accepted: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!, phase: 'accepted',
      requestedAt: now, updatedAt: now, observation: null, failure: null,
      action: { kind: 'role_line', action: savedAction, phase: 'reserve', goalRef: singleGoalRefOf(input.scope), result: null,
        steps: [{ key, duty: roleLineDutyOf(input.duty), childOperation: null, state: 'pending' }] } };
    const written = await writeOperation(lineCtx.value, null, accepted, { commandId: ref.operationId,
      fingerprintInput: { kind: 'role_line_operation', action: savedAction,
        command: { duty: input.duty, scope: input.scope, name } } as unknown as JsonValue });
    if (written.status !== 'committed') return written;
    return driveLine(lineCtx.value, ref, { commandId: roleLineChildCommandId(ref.operationId, key), duty: input.duty,
      scope: { kind: 'project' }, reason: savedAction, provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: deps.platformRole(input.duty), name, roleScopes: [...input.scope], parentOperation: ref },
    written);
  }

  /** The Session's open `responsible` role-scope links that the requested scope drops — what a scope write closes
   *  (O1B-R1-01; v4 :2021 read as the links the new scope no longer names) — and the pins that guard the Session and
   *  those links in the reanchor commit (D-5 keeps them out of the fingerprint). */
  async function openScopesOf(ctx: CoreCallContext, session: SessionRef, requested: readonly RoleScopeV1[]):
    Promise<ReadResult<{ close: SessionWorkLinkRef[]; pins: VersionPin[] }>> {
    const card = await deps.operations.readSession(ctx, session);
    if (card.status !== 'ready') return card;
    const kept = new Set(requested.map((scope) => canonicalKey(scope as unknown as JsonValue)));
    const open = card.value.links.filter((link) => {
      if (link.until !== null || link.ref.relation !== 'responsible') return false;
      const scope = roleScopeOfTarget(link.ref.target);
      return scope !== null && !kept.has(canonicalKey(scope as unknown as JsonValue));   // a kept scope stays open
    });
    return { status: 'ready', value: { close: open.map((link) => link.ref),
      pins: [{ ref: card.value.record.ref, revision: card.value.record.revision },
        ...open.map((link) => ({ ref: link.ref, revision: link.revision }))] } };
  }

  async function changeScope(ctx: CoreCallContext, input: RoleLineChangeScopeCommandV1):
    Promise<WriteResult<RoleLineLineV1>> {
    if (!isRecord(input) || !nonEmpty(input.commandId)) return rejected('invalid', 'roleLines.changeScope requires a commandId');
    const problem = roleScopeListProblem(input.scope);
    if (problem !== null) return rejected('invalid', problem);
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    const links = await openScopesOf(lineCtx.value, input.session, input.scope);
    if (links.status !== 'ready') return roleLineReadFailure(links, 'the line');
    const ref = roleLineOperationRef(ctx.projectId, 'open:change_scope', input.commandId);
    const now = deps.now();
    // No accepted and no done commit: the completed operation rides the one L25 commit (book :324).
    const completed: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!,
      phase: 'completed', requestedAt: now, updatedAt: now, observation: null, failure: null,
      action: { kind: 'role_line', action: 'open', phase: ROLE_LINE_CHANGE_SCOPE_PHASE, goalRef: singleGoalRefOf(input.scope),
        steps: [], result: { status: 'done', reason: null } } };
    const projectRef: ProjectScope = { projectId: ctx.projectId };
    const moved = await deps.responsibility.reanchorSessionResponsibility(lineCtx.value, {
      input: { session: input.session, close: links.value.close,
        open: input.scope.map((scope) => ({ target: workLinkTargetOf(projectRef, scope) })),
        reason: 'human_scope_change',
        operation: { record: encodeSessionOperationRecord(completed), expectedRevision: null } },
      meta: { requestId: ref.operationId, expected: links.value.pins },
    });
    if (moved.status !== 'committed') return moved;
    return { status: 'committed', value: { operation: ref, session: input.session, revision: 1 },
      replayed: moved.replayed, cursor: moved.cursor };
  }

  async function reuse(ctx: CoreCallContext, input: RoleLineReuseCommandV1): Promise<WriteResult<RoleLineLineV1>> {
    if (!isRecord(input) || !nonEmpty(input.commandId)) return rejected('invalid', 'roleLines.reuse requires a commandId');
    const problem = roleScopeListProblem(input.scope);
    if (problem !== null) return rejected('invalid', problem);
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    const ref = roleLineOperationRef(ctx.projectId, 'role_line_reuse', input.commandId);
    const now = deps.now();
    const accepted: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!, phase: 'accepted',
      requestedAt: now, updatedAt: now, observation: null, failure: null,
      action: { kind: 'role_line', action: 'role_line_reuse', phase: 'link', goalRef: singleGoalRefOf(input.scope),
        steps: [], result: null } };
    const written = await writeOperation(lineCtx.value, null, accepted, { commandId: ref.operationId,
      fingerprintInput: { kind: 'role_line_operation', action: 'role_line_reuse',
        command: { session: input.session, scope: input.scope } } as unknown as JsonValue });
    if (written.status !== 'committed') return written;
    const stored = await readRoleLineRecord(lineCtx.value, ref);
    if (stored.status !== 'ready') return roleLineReadFailure(stored, 'the role-line operation');
    if (stored.value.phase === 'completed') {
      return { status: 'committed', value: { operation: ref, session: input.session, revision: stored.value.revision },
        replayed: true, cursor: written.cursor };
    }
    const links = await openScopesOf(lineCtx.value, input.session, input.scope);
    if (links.status !== 'ready') return roleLineReadFailure(links, 'the line');
    // A replay with the same requestId returns the stored receipt and writes no second link (D-5 fingerprint).
    const moved = await deps.responsibility.reanchorSessionResponsibility(lineCtx.value, {
      input: { session: input.session, close: links.value.close,
        open: input.scope.map((scope) => ({ target: workLinkTargetOf({ projectId: ctx.projectId }, scope) })),
        reason: 'reuse' },
      meta: { requestId: ref.operationId, expected: links.value.pins },
    });
    if (moved.status !== 'committed') return moved;
    const done: RoleLineOperationV1 = { ...stored.value, revision: stored.value.revision + 1, updatedAt: deps.now(),
      phase: 'completed', action: { ...stored.value.action, phase: 'done', result: { status: 'done', reason: null } } };
    const finished = await writeOperation(lineCtx.value, stored.value, done);
    if (finished.status !== 'committed') return finished;
    return { status: 'committed', value: { operation: ref, session: input.session, revision: done.revision },
      replayed: false, cursor: finished.cursor };
  }

  async function openRegionLine(ctx: CoreCallContext, input: RoleLineRegionOpenInputV1):
    Promise<RoleLineRegionOpenResultV1> {
    const trusted = trustedContext(ctx, 'a region line open');
    if (!trusted.ok) return trusted.rejection;
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    const line = await deps.createLine.ensureLine(lineCtx.value, { commandId: input.commandId, duty: input.duty,
      scope: { kind: 'project' }, reason: 'cold_start', provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: deps.platformRole(input.duty), name: null,
      roleScopes: [{ kind: 'region', moduleRef: input.module }], parentOperation: input.parentOperation });
    if (line.status === 'accepted' || line.status === 'capacity_blocked' || line.status === 'rejected') return line;
    // The line's own operation is its creation (the cold-start message names it, v4 :7933).
    const child = stableSessionCreationIdentity(trusted.actor, ctx.projectId, input.commandId).operationRef;
    const read = await deps.operations.getSessionOperation(lineCtx.value, child);
    if (read.status !== 'ready') return roleLineReadFailure(read, 'the region line creation');
    return { status: line.status, value: { operation: child, session: line.session, revision: read.value.revision } };
  }

  // ------------------------------------------------------------------------
  // role_line_split (b02): one starter/continuer; O2 owns only the planner.
  // ------------------------------------------------------------------------

  async function unfinishedSplitOf(ctx: CoreCallContext, source: SessionRef):
    Promise<ReadResult<RoleLineOperationV1 | null>> {
    for (const phase of ['accepted', 'running'] as const) {
      let items: readonly EncodedRecord[];
      try {
        items = (await lookupAll<EncodedRecord>(deps.records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
          [ctx.projectId, ctx.workspaceId ?? '', phase])).items;
      } catch (error) {
        return rejected('unavailable', `the unfinished splits could not be read: ${String(error)}`);
      }
      for (const encoded of items) {
        const decoded = decodeSessionOperationRecord(encoded);
        if (decoded.status !== 'decoded') return rejected('unavailable', 'an unfinished operation is damaged');
        const action = decoded.value.action;
        if (action.kind === 'role_line' && action.action === 'role_line_split'
          && action.split?.source.sessionId === source.sessionId) return { status: 'ready', value: decoded.value as RoleLineOperationV1 };
      }
    }
    return { status: 'ready', value: null };
  }

  async function startRoleLineSplit(ctx: CoreCallContext, input: { source: SessionRef; plan: RoleLineSplitPlanV1 }):
    Promise<ReadResult<RoleLineSplitStartV1>> {
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return lineCtx;
    const body: RoleLineSplitSavedV1 = { source: input.source, move: input.plan.move, keep: input.plan.keep,
      reason: input.plan.reason };
    const canonical = roleLineSplitSavedCodec.encode(body);
    // An unfinished split of the same source is continued before a second is accepted (v4 :1937).
    const unfinished = await unfinishedSplitOf(lineCtx.value, input.source);
    if (unfinished.status !== 'ready') return unfinished;
    let saved = unfinished.value;
    if (saved === null) {
      const ref = roleLineOperationRef(ctx.projectId, 'role_line_split', canonical);
      const existing = await readRoleLineRecord(lineCtx.value, ref);
      if (existing.status === 'ready') saved = existing.value;
      else if (existing.status !== 'not_found') return existing;
      else {
        const card = await deps.operations.readSession(lineCtx.value, input.source);
        if (card.status !== 'ready') return card;
        const duty = await deps.duty(card.value.record.role, lineCtx.value);
        if (duty.status !== 'ready') return roleLineReadFailure(duty, 'the split source duty');
        const counted = duty.value === 'unknown' ? null : roleLineDutyOf(duty.value);
        if (counted === null) return rejected('invalid', 'the split source has no line duty');
        const now = deps.now();
        const planned: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!,
          phase: 'accepted', requestedAt: now, updatedAt: now, observation: null, failure: null,
          action: { kind: 'role_line', action: 'role_line_split', phase: 'planned', goalRef: singleGoalRefOf(body.move),
            split: roleLineSplitSavedCodec.decode(canonical), result: null,
            steps: [{ key: 'split', duty: counted, childOperation: null, state: 'pending' }] } };
        const written = await writeOperation(lineCtx.value, null, planned, { commandId: ref.operationId,
          fingerprintInput: { kind: 'role_line_operation', action: 'role_line_split', command: canonical } });
        if (written.status !== 'committed') return written;
        const stored = await readRoleLineRecord(lineCtx.value, ref);
        if (stored.status !== 'ready') return stored;
        saved = stored.value;
      }
    }
    // L-6: a same-identity split that already failed answers its stored failure and is not driven again.
    if (saved.phase === 'failed') {
      return rejected((saved.failure?.code ?? 'unavailable') as CoreError, saved.failure?.reason ?? 'the split failed');
    }
    // D-6 (book :413, :415): the one call drives the saved split through admission; no pre-check — admission is the check.
    const pushed = await continueRoleLineSplit(lineCtx.value, saved);
    if (pushed.status !== 'ready') return pushed;   // at cap the op is already failed and the refusal is unchanged
    return { status: 'ready', value: { operation: saved.ref, revision: pushed.value.revision } };
  }

  /** A split phase write (the action's phase carries the split table); the step marker moves with it when given. */
  async function splitPhase(ctx: CoreCallContext, record: RoleLineOperationV1, phase: RoleLineSplitPhaseV1,
    step: RoleLineStepStateV1 | null): Promise<ReadResult<RoleLineContinueResultV1>> {
    let action: RoleLineActionV1 = record.action;
    if (step !== null) {
      const stepped = roleLineStepTransition(action, 0, { state: step });
      if (!stepped.ok) return rejected('unavailable', `the split step ${stepped.reason}`);
      action = stepped.action;
    }
    const done = phase === 'done';
    const next: RoleLineOperationV1 = { ...record, revision: record.revision + 1, updatedAt: deps.now(),
      phase: done ? 'completed' : 'running',
      action: { ...action, phase, result: done ? { status: 'done', reason: null } : action.result } };
    const written = await writeOperation(ctx, record, next);
    if (written.status !== 'committed') return written;
    return { status: 'ready', value: { revision: next.revision, state: done ? 'done' : 'created', capacity: null } };
  }

  /**
   * Resumes at the first unfinished phase from the saved body — `planned`/`admitted` (re)run the one create entry,
   * `created` moves the saved scopes, `linked` completes — so a crash never re-plans and a replay never creates a
   * second operation or line (v4 :1939–:1953).
   */
  async function continueRoleLineSplit(ctx: CoreCallContext, saved: RoleLineOperationV1):
    Promise<ReadResult<RoleLineContinueResultV1>> {
    if (saved.phase === 'completed' || saved.phase === 'failed') {
      return { status: 'ready', value: { revision: saved.revision, state: 'done', capacity: null } };
    }
    const body = saved.action.split ?? null;
    if (body === null) return rejected('unavailable', 'the split operation has no saved body');
    // O1B-R1-04: once the admission saved the child, every later phase runs as the child's creator.
    const child = saved.action.steps[0]?.childOperation ?? null;
    let runCtx = ctx;
    if (child !== null) {
      const restored = await creatorContextOf(ctx, child);
      if (restored.status !== 'ready') return restored;
      runCtx = restored.value;
    }
    const phase = saved.action.phase as RoleLineSplitPhaseV1;
    if (phase === 'linked') return splitPhase(runCtx, saved, 'done', null);
    if (phase === 'created') return linkSplit(runCtx, saved, body);
    // planned / admitted: the new line has the source's duty and role (`record.role`) and opens standby.
    const card = await deps.operations.readSession(runCtx, body.source);
    if (card.status !== 'ready') return card;
    const duty = await deps.duty(card.value.record.role, runCtx);
    if (duty.status !== 'ready') return roleLineReadFailure(duty, 'the split source duty');
    if (duty.value === 'unknown') return rejected('invalid', 'the split source duty is unknown');
    const line = await deps.createLine.ensureLine(runCtx, { commandId: roleLineChildCommandId(saved.ref.operationId, 'split'),
      duty: duty.value, scope: { kind: 'project' }, reason: 'role_line_split',
      provenance: { schemaVersion: 1, kind: 'new' }, roleConfiguration: card.value.record.role, name: null,
      roleScopes: [], parentOperation: saved.ref });
    const fresh = await readRoleLineRecord(runCtx, saved.ref);
    if (fresh.status !== 'ready') return fresh;
    const current = fresh.value;
    // RACE-01 (11-04): another continuation may have moved the split past `admitted` while this one waited on the
    // line; go on from the phase just read and never write an earlier phase over it.
    if (current.phase === 'completed' || current.phase === 'failed'
      || current.action.phase === 'created' || current.action.phase === 'linked'
      // RACE2-01: another continuation's admission reserved the child meanwhile; go on as its creator.
      || (child === null && (current.action.steps[0]?.childOperation ?? null) !== null)) return continueRoleLineSplit(ctx, current);
    const stepState = current.action.steps[0]?.state ?? null;
    if (line.status === 'capacity_blocked') {
      // TS-8: at cap the split ends failed (no reservation yet) and the refusal is `open`'s one mapping.
      const refusal = capacityRefusal(line);
      const ended = await writeOperation(runCtx, current, failedRecordOf(current, current.action, refusal));
      if (ended.status !== 'committed') return ended;
      return refusal;
    }
    if (line.status === 'accepted') {
      return stepState === 'created' ? { status: 'ready', value: { revision: current.revision, state: 'blocked', capacity: null } }
        : splitPhase(runCtx, current, 'admitted', 'created');
    }
    if (line.status === 'rejected') {
      if (TRANSIENT_CODES.has(line.code)) return line;
      const failed = await failStep(runCtx, current, 0, line);
      return failed.kind === 'rejected' ? failed.rejection : line;
    }
    return splitPhase(runCtx, current, 'created', stepState === 'created' ? null : 'created');
  }

  /**
   * The `created` phase (lead 11-04): the saved `move` scopes leave the source and open on the new line in ONE
   * reanchor commit (`destination`), which also carries the `linked` operation; a child region the source holds only
   * through its parent opens on the new line alone (TS-5's open-only plan). Goals first, child regions last, `linked`
   * in the last commit; a crash before a commit redoes the same call, after it the receipt answers. A refused link
   * ends the split failed; the new line stays a legal standby line and its seat was converted at registration.
   */
  async function linkSplit(ctx: CoreCallContext, saved: RoleLineOperationV1, body: RoleLineSplitSavedV1):
    Promise<ReadResult<RoleLineContinueResultV1>> {
    const created = await lineSessionOf(ctx, saved);
    if (created.status !== 'ready') return created;
    if (created.value === null) return rejected('unavailable', 'the split has no created line');
    const line = created.value;
    const sourceCard = await deps.operations.readSession(ctx, body.source);
    if (sourceCard.status !== 'ready') return sourceCard;
    const lineCard = await deps.operations.readSession(ctx, line);
    if (lineCard.status !== 'ready') return lineCard;
    const heldLink = (card: SessionCard, target: ReturnType<typeof workLinkTargetOf>) => card.links.find((link) =>
      link.until === null && link.ref.relation === 'responsible'
      && canonicalKey(link.ref.target as unknown as JsonValue) === canonicalKey(target as unknown as JsonValue));
    const holds = (card: SessionCard, target: ReturnType<typeof workLinkTargetOf>): boolean =>
      heldLink(card, target) !== undefined;
    const cardPinOf = (card: SessionCard): VersionPin => ({ ref: card.record.ref, revision: card.record.revision });
    const projectRef: ProjectScope = { projectId: saved.ref.projectId };
    const targets = body.move.map((scope) => workLinkTargetOf(projectRef, scope));
    // O1B-R1-03: a target is the source's own member (v4 :2495–:2496), so a goal always moves source -> new line (a
    // source link that is gone is the reanchor's own not_found, then item 7 writes failed); only a region the source
    // does not hold as itself is a child region (it stays held, after the first commit, by the new line).
    const heldByEither = (target: ReturnType<typeof workLinkTargetOf>): boolean =>
      holds(sourceCard.value, target) || holds(lineCard.value, target);
    const moved = targets.filter((target) => target.kind === 'goal' || heldByEither(target));
    const child = targets.filter((target) => !moved.includes(target));
    // A child region opens only while the source still holds every kept region (lead split-link 5; v4 :2492–:2493).
    const keptRegions = body.keep.filter((scope) => scope.kind === 'region')
      .map((scope) => workLinkTargetOf(projectRef, scope));
    const parentsHeld = (card: SessionCard): boolean => keptRegions.every((target) => holds(card, target));
    const keptLost = (): CoreRejection => rejected('not_found', 'the split source no longer holds the kept region');
    const linked: RoleLineOperationV1 = { ...saved, revision: saved.revision + 1, updatedAt: deps.now(),
      phase: 'running', action: { ...saved.action, phase: 'linked' } };
    const operation = { record: encodeSessionOperationRecord(linked), expectedRevision: saved.revision };
    let refusal: CoreRejection | null = child.length > 0 && !parentsHeld(sourceCard.value) ? keptLost() : null;
    if (refusal === null && moved.length > 0) {
      const last = child.length === 0;
      const committed = await deps.responsibility.reanchorSessionResponsibility(ctx, {
        input: { session: body.source, destination: line,
          close: moved.map((target) => responsibleLinkRef(body.source, target)),
          open: moved.map((target) => ({ target })), reason: 'split', ...(last ? { operation } : {}) },
        meta: { requestId: `${saved.ref.operationId}:${last ? 'linked' : 'moved'}`,
          expected: [cardPinOf(sourceCard.value), cardPinOf(lineCard.value), ...moved.flatMap((target) => {
            const link = heldLink(sourceCard.value, target);
            return link === undefined ? [] : [{ ref: link.ref, revision: link.revision }];
          })] } });
      if (committed.status !== 'committed') refusal = committed;
    }
    if (refusal === null && child.length > 0) {
      // The first commit bumped the new line's Session: pin it and the source as they are now (the source pin makes
      // a scope change after this read a revision_conflict).
      const fresh = await deps.operations.readSession(ctx, line);
      if (fresh.status !== 'ready') return fresh;
      const freshSource = await deps.operations.readSession(ctx, body.source);
      if (freshSource.status !== 'ready') return freshSource;
      if (!parentsHeld(freshSource.value)) refusal = keptLost();
      else {
        const committed = await deps.responsibility.reanchorSessionResponsibility(ctx, {
          input: { session: line, close: [], open: child.map((target) => ({ target })), reason: 'split', operation },
          meta: { requestId: `${saved.ref.operationId}:linked`,
            expected: [cardPinOf(freshSource.value), cardPinOf(fresh.value)] } });
        if (committed.status !== 'committed') refusal = committed;
      }
    }
    if (refusal === null) return { status: 'ready', value: { revision: linked.revision, state: 'created', capacity: null } };
    if (TRANSIENT_CODES.has(refusal.code)) return refusal;
    const ended = await writeOperation(ctx, saved, failedRecordOf(saved, saved.action, refusal));
    if (ended.status !== 'committed') return ended;
    return refusal;
  }

  return { continueOperation, open: openLine, changeScope, reuse, openRegionLine, startRoleLineSplit };
}

