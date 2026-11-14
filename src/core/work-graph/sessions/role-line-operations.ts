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
import type { KnowledgeReadBaseV1 } from '../../../contracts/knowledge.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { decisionSourceKey, type DecisionSelectionV1, type DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../../contracts/task-requeue.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import { moduleRefInProjectView } from '../architecture/catalog-service.js';
import {
  isRoleLineOpenDuty, isRoleScopeV1, roleLineDutyOf, roleScopeOfTarget, workLinkTargetOf,
  type CapacityAtCapDetailV1, type NotifyProjectInputV1, type RoleLineDutyV1, type RoleLineOpenDutyV1,
  type RoleLineSplitSavedV1, type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { CommitFragment } from '../persistence/command-executor.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type {
  RoleLineOperationV1, SessionCard, SessionDirectoryPort, SessionOperationRecord,
} from '../model/session-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { ColdStartPhaseV1, RoleLineActionV1, RoleLineStepStateV1, WorkspaceJoinPhaseV1 } from '../state/role-line-action.js';
import { allocationNext } from '../state/role-line-allocation.js';
import {
  ROLE_LINE_CHANGE_SCOPE_PHASE, roleLineChildCommandId, roleLineOperationRef, roleLineStepTransition,
  type START_LINES_PHASES,
} from '../state/role-line-operation.js';
import { createAllocationRead, openLimitOf, seatAtCap } from './allocation-read.js';
import { roleLineStepSession, writeRoleLineOperation } from './role-line-operation-write.js';
import { roleLineOperationChangedCodec, roleLineSplitSavedCodec } from './role-line-orchestration-codecs.js';
import { roleLineCommitContribution } from './role-scope-commit.js';
import { stableSessionCreationIdentity } from './session-directory.js';
import {
  handoffContextOf, pendingWorkHandoffBrief, savedHostPrincipal, workHandoffBriefCommit,
  type HandoffBriefMaterialAssembler,
} from './session-handoff-service.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, encodeSessionOperationRecord, operationRefKey,
} from './session-record-codecs.js';
import { responsibleLinkRef, type SessionResponsibilityPort } from './session-responsibility-service.js';
import { eventIdOf, trustedContext } from './trusted-context.js';

export const ROLE_LINE_SPLIT_PHASES = ['planned', 'admitted', 'created', 'linked', 'done'] as const;
export type RoleLineSplitPhaseV1 = (typeof ROLE_LINE_SPLIT_PHASES)[number];
/** TS-10 item 6: the planner's answer is the saved body without its source. */
export type RoleLineSplitPlanV1 = Omit<RoleLineSplitSavedV1, 'source'>;

/** `cardKey` (card supplement C7): the adjustment waits for a person's `role_line_change` card. */
export type RoleLineLineV1 = { operation: OperationRef; session: SessionRef | null; revision: number; cardKey?: string };
export type RoleLineContinueResultV1 = { revision: number;
  state: 'done' | 'waiting' | 'created' | 'registered' | 'blocked';
  capacity: CapacityAtCapDetailV1 | null };

export type RoleLineCreateInputV1 = { commandId: string; duty: PlatformDutyV1; scope: { kind: 'project' };
  reason: string; provenance: SessionProvenanceV1; roleConfiguration: RoleConfigurationRef;
  name: string | null; roleScopes: RoleScopeV1[];
  /** `null` when the parent operation belongs to another workspace of the project (a project-level join): line
   *  creation reads the parent through the line workspace's scope, so such a parent cannot be inherited. */
  parentOperation: OperationRef | null };
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

/** `affectedGoals` (card supplement C4): only a platform caller passes it; the `role-lines/open` route never forwards it. */
export type RoleLineOpenCommandV1 = { commandId: string; duty: RoleLineOpenDutyV1;
  scope: RoleScopeV1[]; name?: string; affectedGoals?: GoalRef[] };
export type RoleLineChangeScopeCommandV1 = { commandId: string; session: SessionRef; scope: RoleScopeV1[] };
export type RoleLineReuseCommandV1 = { commandId: string; session: SessionRef; scope: RoleScopeV1[] };
/** d05: C1's region open (v4 :8049–:8058): one adviser line on one top-level module under the cold-start parent. */
/** `base` (KC-3): a knowledge_conflict repair round's line checks its region on the last adopted catalog. */
export type RoleLineRegionOpenInputV1 = { commandId: string; parentOperation: OperationRef;
  duty: 'adviser'; module: ModuleRef; base?: KnowledgeReadBaseV1 };
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
  /** c32: the one decision-application entry. This file writes the shared decision commit and the split arm; the
   *  queue-assign approval goes through O4a's `allocate` with `approval`, and a line add's approve / reject call
   *  `allocate` / its `rejection` (card supplement §3.3). */
  applyRoleLineChangeDecision(ctx: CoreCallContext, input: {
    answerRef: SessionMessageRef; source: DecisionSourceV1; selection: DecisionSelectionV1;
    requestId: string; expected: readonly VersionPin[];
  }): Promise<{ status: 'applied'; receipt: DecisionApplicationReceiptV1 }
    | { status: 'deferred' } | { status: 'refused'; rejection: CoreRejection }>;
}
/** `cardKey` (card supplement C7): the split waits for a person's `role_line_change` card. */
export type RoleLineSplitStartV1 = { operation: OperationRef; revision: number; cardKey?: string };
export interface RoleLineSplitPort {
  /** b02: the one starter/continuer; O2 only calls it. SPLITUND: `understanding` is an adviser tool split's admitted
   *  versions (`readOwnLineUnderstanding`'s `found`), saved by a new operation's first write only; the maintenance
   *  page and a scribe caller pass none. */
  startRoleLineSplit(ctx: CoreCallContext, input: { source: SessionRef; plan: RoleLineSplitPlanV1;
    understanding?: { noteId: string; version: number }[] }):
    Promise<ReadResult<RoleLineSplitStartV1>>;
}
export type RoleLineOperationsDeps = {
  /** The split's "unfinished split of the same source" check reads the operation index (v4 :1937). */
  records: GoalRecordTransactionPort & RecordLookupPort;
  createLine: RoleLineCreatePort;
  operations: Pick<SessionDirectoryPort, 'getSessionOperation' | 'readSession'>;
  responsibility: Pick<SessionResponsibilityPort, 'reanchorSessionResponsibility'>;
  /** SPLITUND: H's successor-step material seam (`session-handoff-service.ts:476`), the same instance H uses. Absent
   *  (a platform without a Runtime), an adviser split's done write carries no record 5. */
  brief?: HandoffBriefMaterialAssembler;
  /** b11: O5b injects the one post-release close structurally; absent keeps the terminal release unchanged. */
  closeStale?: (ctx: CoreCallContext, input: {
    projectRef: ProjectScope; duty: RoleLineDutyV1; operation: OperationRef | null;
  }) => Promise<unknown>;
  /** Lead (O1b group text): the role every new line is created with, by duty (CP: `platformRoleProfile(duty).template`). */
  platformRole(duty: PlatformDutyV1): RoleConfigurationRef;
  /** The split source's duty, read through the one Session duty resolver (CP's `sessionDutyResolver`). */
  duty: SessionDutyReadPort;
  /** Card supplement C2/C3: the platform's and the agent's line adjustments are judged by the five-layer policy before
   *  their first write; the guards ride that write. Absent, every adjustment takes the direct path. `duty` is the
   *  counted duty (the rule's per-duty limit and its counts); `splitReason` is passed by the split only. */
  adjustments?: {
    judge(ctx: CoreCallContext, input: { action: 'role_line_add' | 'role_line_split' | 'role_line_reuse';
      affectedGoals: readonly GoalRef[]; objects: readonly RoleScopeV1[]; duty: RoleLineDutyV1;
      splitReason?: RoleLineSplitPlanV1['reason'] }):
      Promise<ReadResult<{ verdict: 'automatic_notice' | 'needs_decision'; guards: RecordGuard[] }>>;
    /** C13: one project notice after a platform or agent adjustment is done (`notifyProject`). */
    notify(ctx: CoreCallContext, input: NotifyProjectInputV1): Promise<unknown>;
  };
  /** Card supplement §3.3: the goal adviser queue's one entry (structural: `sessions` does not import `tasks`). A
   *  queue-assign card's approve is `allocate` with `approval`; a line-add card's reject is `allocate` with
   *  `rejection`; an approved line add is allocated again as the platform. Absent, those three answers refuse. */
  queue?: { allocate(ctx: CoreCallContext, input: { commandId: string; goalRef: GoalRef;
    approval?: { operationRef: OperationRef; expectedRevision: number };
    rejection?: { operationRef: OperationRef; expectedRevision: number } }): Promise<WriteResult<unknown> | CoreRejection> };
  /** C1: the cold-start driver (`cold-start-service.ts`), structurally; absent, a cold start stays `blocked`. */
  coldStart?: { drive(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<ReadResult<{ phase: ColdStartPhaseV1; revision: number; completed: boolean }>> };
  /** §3.4: the second workspace's join driver (`workspace-join-service.ts`), structurally; absent, a join stays
   *  `blocked`. */
  workspaceJoin?: { drive(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<ReadResult<{ phase: WorkspaceJoinPhaseV1; revision: number; completed: boolean }>> };
  /** M4c: the follow-up driver, handed the exact operation ref the Host's index names. */
  explorationFollowUp?: { drive(ctx: CoreCallContext, input: { operation: OperationRef }):
    Promise<ReadResult<{ revision: number; completed: boolean; plannedRounds: number }>> };
  now(): string;
};

/** The one failed record: the record, the action's phase and result, and the stored refusal (L-6 replays it); `at`
 *  is the write's one clock read. The queue's line-add reject writes the same record. */
export function failedRoleLineRecordOf(record: RoleLineOperationV1, action: RoleLineActionV1, refusal: CoreRejection,
  at: string): RoleLineOperationV1 {
  return { ...record, revision: record.revision + 1, updatedAt: at, phase: 'failed',
    failure: { code: refusal.code, reason: refusal.reason },
    action: { ...action, phase: 'failed', result: { status: 'failed', reason: refusal.reason } } };
}

/** One saved operation by its own key (not bound to the caller's workspace); a missing or damaged record and a
 *  non-role-line one are refusals. */
async function readRoleLineOperationByRef(records: Pick<GoalRecordTransactionPort, 'readMany'>, ref: OperationRef):
  Promise<ReadResult<RoleLineOperationV1>> {
  const key = operationRefKey(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const stored = read.value.records.find((record) => record.refKey === key);
  if (stored === undefined) return rejected('not_found', 'the role-line operation does not exist');
  const decoded = decodeSessionOperationRecord(stored);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the role-line operation is damaged: ${decoded.reason}`);
  if (decoded.value.action.kind !== 'role_line') return rejected('invalid', 'not a role_line operation');
  return { status: 'ready', value: decoded.value as RoleLineOperationV1 };
}

/** `start_lines`' one record, born in the project's first workspace-registration commit (L26; TS-10 item 3). */
export function startLinesInitialRecord(input: { projectId: string; workspaceId: string; now: string;
  depth?: 1 | 2 | 3 }): SessionOperationRecord {
  return { ref: roleLineOperationRef(input.projectId, 'start_lines', 'start_lines'), revision: 1,
    workspaceId: input.workspaceId, phase: 'accepted', requestedAt: input.now, updatedAt: input.now,
    observation: null, failure: null,
    action: { kind: 'role_line', action: 'start_lines', phase: 'reserve', goalRef: null, result: null,
      ...(input.depth === undefined ? {} : { depth: input.depth }),
      steps: (['secretary', 'adviser', 'scribe'] as const).map((key) => ({
        key, duty: key, childOperation: null, state: 'pending' as const })) } };
}

type RoleLineAdjustmentsV1 = NonNullable<RoleLineOperationsDeps['adjustments']>;
type AdjustmentJudgeInputV1 = Parameters<RoleLineAdjustmentsV1['judge']>[1];
/** What an adjustment's first commit writes: the record (its card when `card`) and the judgement's guards. */
type AdjustmentWriteV1 = { status: 'ready'; record: RoleLineOperationV1; extra: CommitFragment | undefined; card: boolean };

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

/** C5: the stored goal of a set of affected goals — exactly one is that goal, none or several is the project. */
function onlyGoalOf(goals: readonly GoalRef[]): RoleLineActionV1['goalRef'] {
  return goals.length === 1 ? goals[0]! : null;
}

/** C13: a notice names the stored goal, else `none` (ids bounded as the maintainer notice bounds them, so the
 *  512-byte summary always fits). */
function noticeTargetOf(record: RoleLineOperationV1, none: string): string {
  return record.action.goalRef === null ? none : `目标 ${truncateUtf8(record.action.goalRef.goalId, 160)}`;
}
/** C13: the rule part of v4 :4971's "what was done; the rule; how to undo"; the writer keeps no record of which one
 *  allowed the adjustment, so the notice names the three that can. */
const ADJUSTMENT_RULE = '规则：自治规则、出厂默认或卡上的批准';

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

/** The Session's open `responsible` role-scope links that the requested scope drops — what a scope write closes
 *  (O1B-R1-01; v4 :2021 read as the links the new scope no longer names) — and the pins that guard the Session and
 *  those links in the reanchor commit (D-5 keeps them out of the fingerprint). The one copy: the line's scope change
 *  and the capacity card's `merge_scopes` both close by it. */
export function droppedScopeLinksOf(card: SessionCard, requested: readonly RoleScopeV1[]):
  { close: SessionWorkLinkRef[]; pins: VersionPin[] } {
  const kept = new Set(requested.map((scope) => canonicalKey(scope as unknown as JsonValue)));
  const open = card.links.filter((link) => {
    if (link.until !== null || link.ref.relation !== 'responsible') return false;
    const scope = roleScopeOfTarget(link.ref.target);
    return scope !== null && !kept.has(canonicalKey(scope as unknown as JsonValue));   // a kept scope stays open
  });
  return { close: open.map((link) => link.ref),
    pins: [{ ref: card.record.ref, revision: card.record.revision },
      ...open.map((link) => ({ ref: link.ref, revision: link.revision }))] };
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

/**
 * Regions across workspaces (decision 121-75, kls-design §2.3.4): the regions a person or a model names are written
 * in its own workspace's frame (its bare ids are its own modules, another workspace's carry `/@ws:`), while links,
 * claims and operations keep the project view. This is the one caller-frame step on `ModuleRef`s
 * (`architecture/catalog-service.ts` `moduleRefInProjectView`), over the project's main workspace (none yet: the
 * caller's). An id outside the grammar is `invalid`. The claim key is unchanged: a line never enters
 * it, so the lines of one workspace share a region's adviser.
 */
export async function scopesInProjectView(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string,
  callerWorkspaceId: string, scopes: readonly RoleScopeV1[]): Promise<{ status: 'ready'; value: RoleScopeV1[] } | CoreRejection> {
  const main = await readMainWorkspace(records, projectId);
  if (main.status !== 'ready') return roleLineReadFailure(main, 'the main workspace');
  const mainWorkspaceId = main.value ?? callerWorkspaceId;
  try {
    return { status: 'ready', value: scopes.map((scope): RoleScopeV1 => scope.kind !== 'region' ? scope
      : { kind: 'region', moduleRef: moduleRefInProjectView(scope.moduleRef, callerWorkspaceId, mainWorkspaceId) }) };
  } catch (error) {
    return rejected('invalid', error instanceof Error ? error.message : String(error));
  }
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

  /** The one guarded single write of a role_line operation (`writeRoleLineOperation`, shared with the cold start). */
  function writeOperation(
    ctx: CoreCallContext, prior: RoleLineOperationV1 | null, next: RoleLineOperationV1,
    command?: { commandId: string; fingerprintInput: JsonValue }, extra?: CommitFragment,
  ): Promise<WriteResult<{ revision: number }>> {
    return writeRoleLineOperation({ records: deps.records, now: deps.now }, ctx, prior, next, command, extra);
  }

  function failedRecordOf(record: RoleLineOperationV1, action: RoleLineActionV1, refusal: CoreRejection):
    RoleLineOperationV1 {
    return failedRoleLineRecordOf(record, action, refusal, deps.now());
  }

  /** A line's counted duty (its role's duty through the one resolver): the split's source and the reused line. */
  async function countedDutyOf(ctx: CoreCallContext, session: SessionRef, what: string):
    Promise<ReadResult<RoleLineDutyV1>> {
    const card = await deps.operations.readSession(ctx, session);
    if (card.status !== 'ready') return card;
    const duty = await deps.duty(card.value.record.role, ctx);
    if (duty.status !== 'ready') return roleLineReadFailure(duty, `${what} duty`);
    const counted = roleLineDutyOf(duty.value);
    return counted === null ? rejected('invalid', `${what} has no line duty`) : { status: 'ready', value: counted };
  }

  /**
   * Card supplement §3.1 (C2, C6, C9): an adjustment's command before its accepted write. A saved operation answers as
   * saved and is never judged again — waiting: its card (the accepted receipt replays); refused on the card: the
   * stored refusal; approved or never carded: the writer's own replay. A new one is judged once: a card is the
   * accepted commit itself (`waiting`, nothing driven), an automatic notice hands its guards to that commit.
   */
  async function adjustmentWriteOf(adjustments: RoleLineAdjustmentsV1, ctx: CoreCallContext,
    accepted: RoleLineOperationV1,
    judgeInput: () => Promise<{ status: 'ready'; value: AdjustmentJudgeInputV1 } | CoreRejection>):
    Promise<AdjustmentWriteV1 | CoreRejection> {
    const saved = await readRoleLineRecord(ctx, accepted.ref);
    if (saved.status === 'ready') {
      const stored = saved.value;
      if (stored.action.result?.status === 'waiting') {
        return { status: 'ready', record: stored, extra: undefined, card: true };
      }
      if (stored.phase === 'failed' && stored.failure !== null) {
        return rejected(stored.failure.code as CoreError, stored.failure.reason);   // L-6, for the add and the reuse too
      }
      return { status: 'ready', record: accepted, extra: undefined, card: false };
    }
    if (saved.status !== 'not_found') return roleLineReadFailure(saved, 'the role-line operation');
    const input = await judgeInput();
    if (input.status !== 'ready') return input;
    const judged = await adjustments.judge(ctx, input.value);
    if (judged.status !== 'ready') return roleLineReadFailure(judged, 'the adjustment judgement');
    const extra: CommitFragment = { records: [], claims: [], events: [], guards: judged.value.guards };   // book :656–:659
    if (judged.value.verdict === 'automatic_notice') return { status: 'ready', record: accepted, extra, card: false };
    let reason: string | null = null;
    if (input.value.action === 'role_line_add') {
      // §2.1: a carded add reads its seat first; at cap nothing is written and the refusal is the admission's, so the
      // caller queues the goal (no admission, no reclaim, no episode). No adviser line changes the card's "reject" text.
      const duty = input.value.duty;
      const seat = await allocationRead.readAllocationForCommit(ctx, { projectRef: { projectId: ctx.projectId }, duty });
      if (seat.status !== 'ready') return roleLineReadFailure(seat, 'the role-line allocation');
      const holders = seat.value.allocation?.holders.length ?? 0;
      const full = seatAtCap({ duty, open: openLimitOf(seat.value.limits, duty), holders,
        reservations: seat.value.allocation?.reservations.length ?? 0 });
      if (full !== null) return full;
      if (duty === 'adviser' && holders === 0) reason = 'no_adviser_line';
    }
    // C6: three differences from the uncarded write — the action phase, the waiting result, and nothing driven.
    return { status: 'ready', extra, card: true,
      record: { ...accepted, action: { ...accepted.action, phase: 'waiting', result: { status: 'waiting', reason } } } };
  }

  /** C7: the card reply of a waiting adjustment, at the cursor of the commit that wrote the card. */
  function cardReplyOf(written: Extract<WriteResult<unknown>, { status: 'committed' }>, record: RoleLineOperationV1):
    WriteResult<RoleLineLineV1> {
    return { status: 'committed', replayed: written.replayed, cursor: written.cursor,
      value: { operation: record.ref, session: null, revision: record.revision,
        cardKey: decisionSourceKey({ kind: 'role_line_change', operationRef: record.ref }) } };
  }

  /** C13 (book :863–:871): one project notice after a platform or agent adjustment is done. The subject is the stored
   *  goal (none: the project); a replay is the notice's own identity, and its refusal never undoes the done. */
  async function noticeDone(ctx: CoreCallContext, record: RoleLineOperationV1, summary: string): Promise<void> {
    const projectRef: ProjectScope = { projectId: record.ref.projectId };
    const goalRef = record.action.goalRef;
    await deps.adjustments?.notify(ctx, { projectRef, kind: 'automatic_adjustment', summary, operation: record.ref,
      subject: goalRef === null ? { kind: 'project', projectRef } : { kind: 'goal', goalRef } });
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
    // C13: a platform add is done only by this write (the caller's drive and the Host's resume alike); a reviewer, a
    // person's open and `start_lines` write no notice.
    const step = next.action.steps[index]!;
    if (completed && next.action.action === 'role_line_add' && step.key !== 'reviewer') {
      await noticeDone(ctx, next, `开线：给${noticeTargetOf(next, '项目')}新开一条 ${step.duty} 线`
        + `（${ADJUSTMENT_RULE}；可归档这条线或调上限）`);
    }
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
  function lineSessionOf(ctx: CoreCallContext, record: RoleLineOperationV1): Promise<ReadResult<SessionRef | null>> {
    return roleLineStepSession(deps.operations, ctx, record.action.steps[0] ?? { childOperation: null });
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
    // C8: an operation waiting for its `role_line_change` card is not the Host's to drive; only the answer moves it.
    if (record.action.result?.status === 'waiting') {
      return { status: 'ready', value: { revision: record.revision, state: 'waiting', capacity: null } };
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
    if (record.action.action === 'cold_start' && deps.coldStart !== undefined) {
      // The cold start moves one phase per pass; it is `done` only when its record completes.
      const driven = await deps.coldStart.drive(ctx, { projectId: record.ref.projectId, workspaceId: record.workspaceId });
      if (driven.status !== 'ready') return driven;
      // The cold start's normal wait (a request, a candidate, a card) is `waiting`; Host does not count it blocked.
      const state = driven.value.completed ? 'done'
        : driven.value.revision === record.revision ? 'waiting' : 'blocked';
      return { status: 'ready', value: { revision: driven.value.revision, state, capacity: null } };
    }
    if (record.action.action === 'workspace_join' && deps.workspaceJoin !== undefined) {
      // The join moves one of its three phases per pass; it is `done` only when its record completes.
      const driven = await deps.workspaceJoin.drive(ctx,
        { projectId: record.ref.projectId, workspaceId: record.workspaceId });
      if (driven.status !== 'ready') return driven;
      // A wait for a person (an exploration answer, a proposal card) is `waiting`; Host does not count it blocked.
      const state = driven.value.completed ? 'done'
        : driven.value.revision === record.revision ? 'waiting' : 'blocked';
      return { status: 'ready', value: { revision: driven.value.revision, state, capacity: null } };
    }
    if (record.action.action === 'exploration_followup' && deps.explorationFollowUp !== undefined) {
      // M4c: drive the exact operation the index names, never “the first follow-up of the project”.
      const driven = await deps.explorationFollowUp.drive(ctx, { operation: record.ref });
      if (driven.status !== 'ready') {
        // DREPRO-04 (lead 11-14): an `invalid` refusal is this operation's end, not a wait; write the one failed
        // record so the person reads the reason. A retryable refusal (`unavailable`, `busy`) waits for the next pass.
        if (driven.status !== 'rejected' || driven.code !== 'invalid') return driven;
        const ended = failedRecordOf(record, record.action, driven);
        const written = await writeOperation(ctx, record, ended, {
          commandId: `exploration-followup-end:${record.ref.operationId}`,
          fingerprintInput: { operation: record.ref },
        });
        if (written.status !== 'committed') return written;
        return driven;
      }
      const state = driven.value.completed ? 'done'
        : driven.value.revision === record.revision ? 'waiting' : 'blocked';
      return { status: 'ready', value: { revision: driven.value.revision, state, capacity: null } };
    }
    if (record.action.action !== 'start_lines') {
      // Person commands carry their request in the caller, not the record: the same commandId replays them
      // through the writer; the Host never guesses a scope.
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

  async function openLine(ctx: CoreCallContext, command: RoleLineOpenCommandV1): Promise<WriteResult<RoleLineLineV1>> {
    let input = command;
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
    // A person's regions are in its own workspace's frame; a platform caller's are the project view already.
    if (!platformCaller) {
      const viewed = await scopesInProjectView(deps.records, ctx.projectId, trusted.scope.workspaceId, input.scope);
      if (viewed.status !== 'ready') return viewed;
      input = { ...input, scope: viewed.value };
    }
    const savedAction = input.duty === 'reviewer' || platformCaller ? 'role_line_add' : 'open';
    const ref = roleLineOperationRef(ctx.projectId, 'open:add', input.commandId);
    const key = input.duty === 'reviewer' ? 'reviewer' : 'line';
    const now = deps.now();
    // C5: a platform caller's affected goals name the stored goal; without them the requested scope does.
    const goalRef = input.affectedGoals === undefined ? singleGoalRefOf(input.scope) : onlyGoalOf(input.affectedGoals);
    const accepted: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!, phase: 'accepted',
      requestedAt: now, updatedAt: now, observation: null, failure: null,
      action: { kind: 'role_line', action: savedAction, phase: 'reserve', goalRef, result: null,
        steps: [{ key, duty: roleLineDutyOf(input.duty), childOperation: null, state: 'pending' }] } };
    // O3-02: only the platform's add is an automatic adjustment; a person's open and any reviewer are never judged.
    const gate = savedAction === 'role_line_add' && input.duty !== 'reviewer' && deps.adjustments !== undefined
      ? await adjustmentWriteOf(deps.adjustments, lineCtx.value, accepted, async () => {
        const affectedGoals = input.affectedGoals ?? [];
        return { status: 'ready', value: { action: 'role_line_add', affectedGoals, duty: roleLineDutyOf(input.duty)!,
          objects: [...input.scope, ...affectedGoals.map((goal) => ({ kind: 'goal' as const, goalRef: goal }))] } };
      })
      : { status: 'ready' as const, record: accepted, extra: undefined, card: false };
    if (gate.status !== 'ready') return gate;
    const written = await writeOperation(lineCtx.value, null, gate.record, { commandId: ref.operationId,
      fingerprintInput: { kind: 'role_line_operation', action: savedAction,
        command: { duty: input.duty, scope: input.scope, name } } as unknown as JsonValue }, gate.extra);
    if (written.status !== 'committed') return written;
    if (gate.card) return cardReplyOf(written, gate.record);
    return driveLine(lineCtx.value, ref, { commandId: roleLineChildCommandId(ref.operationId, key), duty: input.duty,
      scope: { kind: 'project' }, reason: savedAction, provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: deps.platformRole(input.duty), name, roleScopes: [...input.scope], parentOperation: ref },
    written);
  }

  async function openScopesOf(ctx: CoreCallContext, session: SessionRef, requested: readonly RoleScopeV1[]):
    Promise<ReadResult<{ close: SessionWorkLinkRef[]; pins: VersionPin[] }>> {
    const card = await deps.operations.readSession(ctx, session);
    if (card.status !== 'ready') return card;
    return { status: 'ready', value: droppedScopeLinksOf(card.value, requested) };
  }

  async function changeScope(ctx: CoreCallContext, command: RoleLineChangeScopeCommandV1):
    Promise<WriteResult<RoleLineLineV1>> {
    let input = command;
    if (!isRecord(input) || !nonEmpty(input.commandId)) return rejected('invalid', 'roleLines.changeScope requires a commandId');
    const problem = roleScopeListProblem(input.scope);
    if (problem !== null) return rejected('invalid', problem);
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    // As `openLine`; a context without a workspace is the project's, whose frame is the main workspace's.
    if (!(ctx.principal.kind === 'host' && ctx.principal.actor.kind === 'system')) {
      const viewed = await scopesInProjectView(deps.records, ctx.projectId, ctx.workspaceId ?? lineCtx.value.workspaceId!,
        input.scope);
      if (viewed.status !== 'ready') return viewed;
      input = { ...input, scope: viewed.value };
    }
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
    // C4: the reuse's one producer (C1's region open) affects no goal; the counted duty is the reused line's.
    const gate = deps.adjustments === undefined ? { status: 'ready' as const, record: accepted, extra: undefined, card: false }
      : await adjustmentWriteOf(deps.adjustments, lineCtx.value, accepted, async () => {
        const duty = await countedDutyOf(lineCtx.value, input.session, 'the reused line');
        if (duty.status !== 'ready') return roleLineReadFailure(duty, 'the reused line');
        return { status: 'ready',
          value: { action: 'role_line_reuse', affectedGoals: [], objects: input.scope, duty: duty.value } };
      });
    if (gate.status !== 'ready') return gate;
    const written = await writeOperation(lineCtx.value, null, gate.record, { commandId: ref.operationId,
      fingerprintInput: { kind: 'role_line_operation', action: 'role_line_reuse',
        command: { session: input.session, scope: input.scope } } as unknown as JsonValue }, gate.extra);
    if (written.status !== 'committed') return written;
    if (gate.card) return cardReplyOf(written, gate.record);
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
    await noticeDone(lineCtx.value, done, `复用：线 ${truncateUtf8(input.session.sessionId, 160)} 接手`
      + `${noticeTargetOf(done, '新的范围')}（${ADJUSTMENT_RULE}；可改回这条线的范围）`);   // C13
    return { status: 'committed', value: { operation: ref, session: input.session, revision: done.revision },
      replayed: false, cursor: finished.cursor };
  }

  async function openRegionLine(ctx: CoreCallContext, input: RoleLineRegionOpenInputV1):
    Promise<RoleLineRegionOpenResultV1> {
    const trusted = trustedContext(ctx, 'a region line open');
    if (!trusted.ok) return trusted.rejection;
    const lineCtx = await lineContextOf(ctx);
    if (lineCtx.status !== 'ready') return roleLineReadFailure(lineCtx, 'the main workspace');
    // A `workspace_join` parent is read at project scope and kept even when the line lives in the main workspace:
    // its region line's origin is the join (the join owns the region exploration). Other parents outside the line's
    // workspace cannot be inherited through line creation, so their line's stored origin is its own creation.
    const parent = await readRoleLineOperationByRef(deps.records, input.parentOperation);
    const parentOperation = parent.status === 'ready' && parent.value.workspaceId !== lineCtx.value.workspaceId
      && parent.value.action.action !== 'workspace_join' ? null : input.parentOperation;
    const line = await deps.createLine.ensureLine(lineCtx.value, { commandId: input.commandId, duty: input.duty,
      scope: { kind: 'project' }, reason: 'cold_start', provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: deps.platformRole(input.duty), name: null,
      roleScopes: [{ kind: 'region', moduleRef: input.module }], parentOperation,
      ...(input.base === undefined ? {} : { base: input.base }) });
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

  async function startRoleLineSplit(ctx: CoreCallContext, input: { source: SessionRef; plan: RoleLineSplitPlanV1;
    understanding?: { noteId: string; version: number }[] }):
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
        const counted = await countedDutyOf(lineCtx.value, input.source, 'the split source');
        if (counted.status !== 'ready') return counted;
        // C4/C5: only the moved goals are affected; exactly one is the stored goal, whatever regions move with it.
        const goals = body.move.flatMap((scope) => scope.kind === 'goal' ? [scope.goalRef] : []);
        // §3.2: judged once, before the planned write; the guards ride that write (book :656–:659).
        const judged = deps.adjustments === undefined ? null : await deps.adjustments.judge(lineCtx.value, {
          action: 'role_line_split', affectedGoals: goals, objects: body.move, duty: counted.value,
          splitReason: body.reason });
        if (judged !== null && judged.status !== 'ready') return judged;
        const card = judged?.value.verdict === 'needs_decision';
        const extra = judged === null ? undefined : { records: [], claims: [], events: [], guards: judged.value.guards };
        const now = deps.now();
        // C6: a carded split is the planned commit with the action waiting; TS-8's push does not run.
        const planned: RoleLineOperationV1 = { ref, revision: 1, workspaceId: lineCtx.value.workspaceId!,
          phase: 'accepted', requestedAt: now, updatedAt: now, observation: null, failure: null,
          action: { kind: 'role_line', action: 'role_line_split', phase: card ? 'waiting' : 'planned',
            goalRef: onlyGoalOf(goals), split: roleLineSplitSavedCodec.decode(canonical),
            ...(input.understanding === undefined ? {} : { understanding: structuredClone(input.understanding) }),
            result: card ? { status: 'waiting', reason: null } : null,
            steps: [{ key: 'split', duty: counted.value, childOperation: null, state: 'pending' }] } };
        const written = await writeOperation(lineCtx.value, null, planned, { commandId: ref.operationId,
          fingerprintInput: { kind: 'role_line_operation', action: 'role_line_split', command: canonical } }, extra);
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
    // C9: a split waiting for its card — this plan's, or another plan's of the same source — answers that card.
    if (saved.action.result?.status === 'waiting') {
      return { status: 'ready', value: { operation: saved.ref, revision: saved.revision,
        cardKey: decisionSourceKey({ kind: 'role_line_change', operationRef: saved.ref }) } };
    }
    // D-6 (book :413, :415): the one call drives the saved split through admission; no pre-check — admission is the check.
    const pushed = await continueRoleLineSplit(lineCtx.value, saved);
    if (pushed.status !== 'ready') return pushed;   // at cap the op is already failed and the refusal is unchanged
    return { status: 'ready', value: { operation: saved.ref, revision: pushed.value.revision } };
  }

  /** A split phase write (the action's phase carries the split table); the step marker moves with it when given. */
  async function splitPhase(ctx: CoreCallContext, record: RoleLineOperationV1, phase: RoleLineSplitPhaseV1,
    step: RoleLineStepStateV1 | null, extra?: CommitFragment): Promise<ReadResult<RoleLineContinueResultV1>> {
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
    const written = await writeOperation(ctx, record, next, undefined, extra);
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
    if (phase === 'linked') {
      // SPLITUND: an adviser tool split's done write carries record 5 in the same commit, after the material reads.
      let extra: CommitFragment | undefined;
      const assembler = deps.brief;
      if (assembler !== undefined && saved.action.steps[0]?.duty === 'adviser') {
        const created = await lineSessionOf(runCtx, saved);
        if (created.status !== 'ready') return created;
        const line = created.value!;
        const material = await assembler.assemble(runCtx, { source: body.source, duty: 'adviser', tasks: [],
          workspaceId: saved.workspaceId, understanding: saved.action.understanding ?? null,
          handedScope: body.move });
        if (material.status !== 'ready') return material;
        const brief = pendingWorkHandoffBrief({ operation: saved.ref, source: body.source, successor: line,
          duty: 'adviser', tasks: [], workspaceId: saved.workspaceId, material: material.value });
        extra = workHandoffBriefCommit(brief, { eventId: eventIdOf(canonicalKey(brief.ref), 'handoff-brief'),
          at: deps.now() });
      }
      // C13: every split (the tool's, the page's, an approved card's) is done only here.
      const done = await splitPhase(runCtx, saved, 'done', null, extra);
      if (done.status === 'ready') {
        await noticeDone(runCtx, saved, `拆线：从线 ${truncateUtf8(body.source.sessionId, 160)} 拆出一条新线接手`
          + `${noticeTargetOf(saved, '移出的范围')}（${ADJUSTMENT_RULE}；可合并范围或归档新线）`);
      }
      return done;
    }
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

  // ------------------------------------------------------------------------
  // role_line_change (card supplement §3.3): the card's answer
  // ------------------------------------------------------------------------

  /**
   * C10/C11: the answer's one decision commit (L-1: one `RoleLineOperationChanged`). The answer's `requestId` is the
   * command, so a repeated answer replays its receipt; the operation is re-read inside the executor, and one that no
   * longer waits at the card's revision is `source_stale`. Approve sends the action back to its first phase with no
   * result; reject ends it failed `{cancelled, decision_rejected}`, with nothing to undo because nothing was done.
   */
  async function writeDecision(ctx: CoreCallContext, operation: RoleLineOperationV1, expectedRevision: number,
    optionId: 'approve' | 'reject', input: { requestId: string; answerRef: SessionMessageRef }):
    Promise<WriteResult<RoleLineOperationV1>> {
    const trusted = trustedContext(ctx, 'a role_line_change decision');
    if (!trusted.ok) return trusted.rejection;
    const key = operationRefKey(operation.ref);
    let built: RoleLineOperationV1 | null = null;
    const result = await executeWriteCommand(deps.records, {
      operation: 'role-line-decision',
      principal: ctx.principal as unknown as JsonValue,
      commandId: input.requestId,
      scope: { projectId: operation.ref.projectId, workspaceId: operation.workspaceId },
      fingerprintInput: { operation: operation.ref, optionId, answerRef: input.answerRef } as unknown as JsonValue,
      read: async () => {
        const current = await readRoleLineRecord(ctx, operation.ref);
        return current.status === 'ready' ? { status: 'ready' as const, facts: current.value }
          : roleLineReadFailure(current, 'the role-line operation');
      },
      decide: (current: RoleLineOperationV1): { refuse: CoreRejection } | { decision: RoleLineOperationV1 } => {
        if (current.action.result?.status !== 'waiting' || current.revision !== expectedRevision) {
          return { refuse: rejected('source_stale', 'the role-line operation no longer waits on this card') };
        }
        if (optionId === 'reject') {
          return { decision: failedRecordOf(current, current.action, rejected('cancelled', 'decision_rejected')) };
        }
        const first = current.action.action === 'role_line_split' ? 'planned'
          : current.action.action === 'role_line_reuse' ? 'link' : 'reserve';
        return { decision: { ...current, revision: current.revision + 1, updatedAt: deps.now(),
          action: { ...current.action, phase: first, result: null } } };
      },
      build: (next, keys) => {
        built = next;
        return { records: [encodeSessionOperationRecord(next)], claims: [],
          events: [roleLineOperationChangedCodec.encode({
            eventId: eventIdOf(keys.identityKey, 'changed'), eventType: 'RoleLineOperationChanged', schemaVersion: 1,
            occurredAt: deps.now(), projectId: next.ref.projectId, workspaceId: next.workspaceId,
            actor: trusted.actor, revision: next.revision, operationRef: next.ref })],
          guards: [{ refKey: key, expectedRevision }] };
      },
      result: { eventType: 'RoleLineOperationChanged', schemaVersion: 1,
        decode: (event) => roleLineOperationChangedCodec.decode(event),
        validate: (event, receipt, keys) => operationRefKey(event.operationRef) !== key
          ? 'the event records another operation'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        project: (event) => ({ revision: event.revision }) },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
    if (!result.replayed) return { status: 'committed', value: built!, replayed: false, cursor: result.cursor };
    // A replay answers the operation as it is now: the push after the decision replays by its own identities.
    const current = await readRoleLineRecord(ctx, operation.ref);
    if (current.status !== 'ready') return roleLineReadFailure(current, 'the role-line operation');
    return { status: 'committed', value: current.value, replayed: true, cursor: result.cursor };
  }

  /** Card supplement §3.3: check the card, write the one decision, then drive only an approved split; an answer is
   *  never judged again (C10). The receipt is the card's source closing (C12), so every success is `deferred`. */
  async function applyRoleLineChangeDecision(ctx: CoreCallContext, input: {
    answerRef: SessionMessageRef; source: DecisionSourceV1; selection: DecisionSelectionV1;
    requestId: string; expected: readonly VersionPin[];
  }): Promise<{ status: 'applied'; receipt: DecisionApplicationReceiptV1 }
    | { status: 'deferred' } | { status: 'refused'; rejection: CoreRejection }> {
    const pin = input.expected[0];                                       // the card's one pin is its operation
    if (pin === undefined || input.source.kind !== 'role_line_change'
      || input.source.key !== decisionSourceKey({ kind: 'role_line_change', operationRef: pin.ref as OperationRef })) {
      return { status: 'refused', rejection: rejected('invalid', 'not a role_line_change card') };
    }
    const optionId = input.selection.kind === 'option' ? input.selection.optionId : null;
    if (optionId !== 'approve' && optionId !== 'reject') {
      return { status: 'refused', rejection: rejected('invalid', 'a role_line_change card answers approve or reject') };
    }
    // The operation is read by its own key: a queue-assign card's lives in the goal's workspace, a line add's and a
    // split's in the main one (v4 §2.2 item 4). Its writes run in its own workspace, under the answerer's actor.
    const read = await readRoleLineOperationByRef(deps.records, pin.ref as OperationRef);
    if (read.status !== 'ready') {
      return { status: 'refused', rejection: roleLineReadFailure(read, 'the role-line operation') };
    }
    const operation = read.value;
    const operationCtx = ctx.principal.kind === 'host'
      ? handoffContextOf({ ...ctx, workspaceId: operation.workspaceId }, ctx.principal) : ctx;
    // A queue-assign card's approve IS the assignment commit, and a line-add card's reject IS the queue append (U1):
    // neither writes the decision commit first. The queue writes keep the answerer's principal.
    if (operation.action.action === 'goal_queue_assign' && optionId === 'approve') {
      return approveQueueAssign(ctx, operation, pin.revision, input.requestId);
    }
    if (operation.action.action === 'role_line_add' && optionId === 'reject') {
      return rejectLineAdd(ctx, operation, pin.revision, input.requestId);
    }
    const decided = await writeDecision(operationCtx, operation, pin.revision, optionId,
      { requestId: input.requestId, answerRef: input.answerRef });
    if (decided.status !== 'committed') return { status: 'refused', rejection: decided };
    switch (operation.action.action) {
      case 'role_line_split': {
        if (optionId === 'reject') return { status: 'deferred' };
        // An approved split that already ended failed (at cap, TS-8) answers its stored refusal on every replay of the
        // answer (L-6); the continuation would read the terminal record as done.
        const settled = decided.value;
        if (settled.phase === 'failed' && settled.failure !== null) {
          return { status: 'refused', rejection: rejected(settled.failure.code as CoreError, settled.failure.reason) };
        }
        // TS-8's one push, as the platform (C10): the approved split's child is created under this identity.
        const platform = handoffContextOf(operationCtx, { kind: 'host', actor: { ...WORKFLOW_AUTOMATION_ACTOR } });
        const pushed = await continueRoleLineSplit(platform, decided.value);
        return pushed.status === 'ready' ? { status: 'deferred' }
          : { status: 'refused', rejection: roleLineReadFailure(pushed, 'the approved split') };
      }
      case 'role_line_add': return allocateAfterDecision(ctx, operation);
      default: return { status: 'deferred' };          // an approved reuse goes on by its caller's replay (§2.3)
    }
  }

  /** An approved line add is allocated again as the platform, the confirm's command (TS-19): a candidate takes the
   *  goal, else `open` replays this approved operation and drives it, else the goal is queued. */
  async function allocateAfterDecision(ctx: CoreCallContext, operation: RoleLineOperationV1):
    Promise<{ status: 'deferred' } | { status: 'refused'; rejection: CoreRejection }> {
    const goalRef = operation.action.goalRef;
    if (deps.queue === undefined || goalRef === null) return { status: 'deferred' };
    const allocated = await deps.queue.allocate(
      handoffContextOf(ctx, { kind: 'host', actor: { ...WORKFLOW_AUTOMATION_ACTOR } }),
      { commandId: `goal-queue:${goalRef.goalId}`, goalRef });
    if (allocated.status === 'committed') return { status: 'deferred' };
    if (allocated.code === 'revision_conflict' && allocated.reason === 'goal_has_adviser') return { status: 'deferred' };
    return { status: 'refused', rejection: allocated };
  }

  /** A queue-assign card's approve: the candidate step with the card's pin; a commit closes the card's source. */
  async function approveQueueAssign(ctx: CoreCallContext, operation: RoleLineOperationV1, expectedRevision: number,
    requestId: string): Promise<{ status: 'deferred' } | { status: 'refused'; rejection: CoreRejection }> {
    const goalRef = operation.action.goalRef;
    if (deps.queue === undefined || goalRef === null) {
      return { status: 'refused', rejection: rejected('unsupported', 'the adviser queue is not wired') };
    }
    const allocated = await deps.queue.allocate(ctx, { commandId: requestId, goalRef,
      approval: { operationRef: operation.ref, expectedRevision } });
    return allocated.status === 'committed' ? { status: 'deferred' } : { status: 'refused', rejection: allocated };
  }

  /** U1, a line-add card's reject: the goal is queued and the operation ends failed in the queue's one commit. */
  async function rejectLineAdd(ctx: CoreCallContext, operation: RoleLineOperationV1, expectedRevision: number,
    requestId: string): Promise<{ status: 'deferred' } | { status: 'refused'; rejection: CoreRejection }> {
    const goalRef = operation.action.goalRef;
    if (deps.queue === undefined || goalRef === null) {
      return { status: 'refused', rejection: rejected('unsupported', 'the adviser queue is not wired') };
    }
    const queued = await deps.queue.allocate(ctx, { commandId: requestId, goalRef,
      rejection: { operationRef: operation.ref, expectedRevision } });
    return queued.status === 'committed' ? { status: 'deferred' } : { status: 'refused', rejection: queued };
  }

  return { continueOperation, open: openLine, changeScope, reuse, openRegionLine, startRoleLineSplit,
    applyRoleLineChangeDecision };
}

