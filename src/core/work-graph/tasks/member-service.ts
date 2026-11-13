/**
 * The member request owner: the one implementation behind the
 * `MemberRequestPortV1`/`MemberDecisionPortV1` pair.
 *
 * A member request is admitted once (`member.request`) and advanced by its own
 * owner: the decision is a card (`awaiting_decision`) or an automatic notice,
 * an approved/automatic request creates the child line through the injected
 * line-creation port in the Host's trusted system context, and a secretary
 * request first proves the adopted Plan, a responsible adviser and the request's
 * current owner. The child identity is the operation's own `<operationId>:create`
 * and the child Session's registration commit carries `MemberCreated`; the
 * receipt of that commit is the official proof receipt a message may cite.
 *
 * The member operation's arm and its pure input rule live in
 * `state/member-creation.ts`; the action arm and `core-op-member-by-goal` live in
 * `sessions/session-record-codecs.ts`. This file writes progress through those
 * shapes only. Every write goes through the shared R2 executor; `ctx.principal`
 * is the actor of every write; the stored caller is informational (record 1) and
 * never becomes a second identity.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { CORE_ERRORS } from '../../../contracts/core/results.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { CapacityAtCapDetailV1 } from '../../../contracts/role-lines.js';
import { OperationRefShape, SessionMessageRefShape } from '../../../contracts/data-format-refs.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, RecordCommitIdentityPort, RecordGuard,
} from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { RequestOwnerReadPort, SessionMailboxPort } from '../model/communication-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { SecretaryQueryRunPort } from '../model/secretary-query-run-contracts.js';
import type { SessionDirectoryPort, SessionOperationRecord, SessionOperationRecordOf } from '../model/session-contracts.js';
import type { SessionReusePortV1 } from '../model/pick-ports.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { DutyRecipientPort } from '../sessions/duty-recipient.js';
import { sessionRegisterIdentityKey, stableSessionCreationIdentity } from '../sessions/session-directory.js';
import {
  CORE_OPERATION_MEMBER_BY_GOAL_LOOKUP, decodeSessionOperationRecord, encodeSessionOperationRecord,
  memberCreationAcceptedCodec, memberCreationDecidedCodec, operationRefKey, plainSessionRef, plainSessionRefKey,
} from '../sessions/session-record-codecs.js';
import type { MemberCallerV1, MemberCreateActionV1, MemberCreationStepV1 } from '../state/member-creation.js';
import { acceptedMemberCreation, advancedMemberCreation, memberCreateInputProblem } from '../state/member-creation.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { matchAutonomyRule } from '../state/autonomy-rules.js';
import { openLimitOf, type createAllocationRead } from '../sessions/allocation-read.js';
import type { AutonomyRulePort, AutonomyRuleViewV1 } from './autonomy-rule-service.js';
import type { ResponsibilityRecipientPort } from './responsibility-recipient.js';
import { commandIdentity, commandKeys, executeWriteCommand } from '../persistence/command-executor.js';
import {
  agentActorOf, toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId,
} from '../model/tool-commit-arguments.js';
import type { ToolCommitLookup, ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import { lookupCommittedReceiptByIdentity } from '../persistence/receipt-lookup.js';
import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import { goalRefFor } from '../persistence/commit-compiler.js';
import { readGoalPlanWindow, readGoalsByWorkspaceCreated } from './plan-readers.js';
import { planGuard } from './entry-plan-reader.js';
import { writeAnswer } from '../sessions/session-handoff-service.js';
import { readOwnerRecord } from './owner-record-read.js';
import { workspaceOf } from './request-service.js';
import { hostSystemContext } from '../model/platform-check-context.js';

export type { MemberCallerV1 };

export type MemberRequestInputV1 = {
  commandId: string;
  caller: MemberCallerV1;
  duty: 'executor';
  scope: { kind: 'task'; task: TaskTriple };
  reason: string;
  acknowledgement?: SessionMessageRef;
};

export type MemberRequestResultV1 =
  | { status: 'created'; session: SessionRef; operation: OperationRef; proofReceipt: DecisionApplicationReceiptV1 }
  | { status: 'reused'; session: SessionRef; operation: OperationRef }
  | { status: 'pending'; operation: OperationRef }
  | { status: 'needs_decision'; cardKey: string; operation: OperationRef }
  | CoreRejection;

export type PendingMemberCardV1 = { task: TaskTriple; operation: OperationRef; source: DecisionSourceV1 };

export interface MemberRequestPortV1 {
  requestMember(ctx: CoreCallContext, input: MemberRequestInputV1): Promise<MemberRequestResultV1>;
  resumePendingMemberCreations(ctx: CoreCallContext): Promise<ReadResult<{
    resumed: readonly { operation: OperationRef; child: OperationRef; session: SessionRef }[];
    left: readonly { operation: OperationRef; code: string; reason: string }[];
  }>>;
  readPendingMemberCards(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<readonly PendingMemberCardV1[]>>;
  readMemberRequestCommit(ctx: CoreCallContext, input: { commandId: string }):
    Promise<{ status: 'committed' } | { status: 'missing' } | { status: 'unavailable'; reason: string }>;
}

export type MemberDecisionInputV1 = {
  commandId: string;
  operation: OperationRef;
  answer: SessionMessageRef;
  verdict: 'approve' | 'reject';
};

export interface MemberDecisionPortV1 {
  applyMemberDecision(ctx: CoreCallContext, input: MemberDecisionInputV1): Promise<
    | { status: 'done'; session: SessionRef; operation: OperationRef; receipt: DecisionApplicationReceiptV1 }
    | { status: 'rejected'; operation: OperationRef; code: CoreError; reason: string }
    | { status: 'stale'; operation: OperationRef }
    | CoreRejection
  >;
}

/** The creator's accepted permissions; a Work caller's child Session stores this as its delegation ceiling. */
export type MemberDelegationCeilingV1 = { tools: string[]; writeScope: string[]; createMember: boolean };

/**
 * The injected line-creation driver (B's `LineCreationPort.ensureLine`). W may
 * not import `B/`, so M declares only the shape it sends and reads; the
 * composition root passes the real factory method. The child is always a task
 * executor line with the original `<operationId>:create` identity and this
 * operation as `parentOperation`.
 */
export type MemberLineCreationInputV1 = {
  commandId: string;
  duty: 'executor';
  scope: { kind: 'task'; task: TaskTriple };
  reason: string;
  provenance: { schemaVersion: 1; kind: 'new' };
  roleConfiguration: RoleConfigurationRef;
  /** A Work caller's accepted permissions; absent is no ceiling. A secretary- or adviser-created line never carries one. */
  delegationCeiling?: MemberDelegationCeilingV1;
  secretaryCreated?: true;
  parentOperation: OperationRef;
};

export type MemberLineCreationResultV1 =
  | { status: 'created' | 'replayed'; session: SessionRef }
  | { status: 'accepted'; operationRef: OperationRef }
  | { status: 'capacity_blocked'; duty: string; detail: CapacityAtCapDetailV1 | null }
  | { status: 'rejected'; code: string; reason: string };

export interface MemberLineCreationPortV1 {
  ensureLine(ctx: CoreCallContext, input: MemberLineCreationInputV1): Promise<MemberLineCreationResultV1>;
}

export type MemberServiceDependenciesV1 = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession'>;
  lines: MemberLineCreationPortV1;
  requests: RequestOwnerReadPort;
  secretaryRuns: SecretaryQueryRunPort;
  duties: DutyRecipientPort;
  /** L42/L35 (book :846): the one responsible-adviser read behind both checks; `asker: null` keeps out the creator
   *  and the person, so a `human` answer is `invalid/no_responsible_adviser`. */
  advisers: Pick<ResponsibilityRecipientPort, 'resolveResponsibilityRecipient'>;
  /** D-18 (book :850): the responsible adviser's one notice per operation, through the mailbox's own send;
   *  a Host system `notify` opens no model turn (decision 98-4). */
  messages: Pick<SessionMailboxPort, 'sendMessage'>;
  /**
   * The one real Run read; the Work caller's accepted envelope supplies both its admission (`create_member` and
   * `createMember: true`) and the child Session's delegation ceiling. A secretary caller never reads it.
   */
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  /** 121-109: the one Session duty read; a Work caller whose line is an adviser builds its executor line on the Host's
   *  executor grant, not on its own envelope. */
  duty: SessionDutyReadPort;
  /**
   * The executor line's Role for one Task: the composition reads the Task's current plan assignment and returns
   * the served binding's `sessionRole`; absent binding is a rejection, never the platform executor template.
   */
  executorRole: (
    ctx: CoreCallContext, input: { workspace: WorkspaceScope; task: TaskTriple },
  ) => Promise<ReadResult<RoleConfigurationRef>>;
  /** The identity-only receipt read (the store object's `commitIdentities`, not `records`). */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  /** P's `createSessionChooser.reusable`, injected by L1; absent means no reuse (the positive half joins L1). */
  reuse?: SessionReusePortV1;
  /**
   * The project's autonomy rules and the executor seat read, both needed for a rule match (L37): a rule is checked
   * against the executor quota after this one more line. Without both the request keeps the factory default.
   */
  autonomyRules?: Pick<AutonomyRulePort, 'read'>;
  allocation?: Pick<ReturnType<typeof createAllocationRead>, 'readAllocationForCommit'>;
  now(): string;
  eventId(): string;
};

export type MemberServiceV1 = {
  request: MemberRequestPortV1;
  decision: MemberDecisionPortV1;
  /** The read-only committed `member.request` lookup for the `create_member` tool. */
  lookupToolCommit: ToolCommitLookup;
};

type MemberOperationRecordV1 = SessionOperationRecordOf<MemberCreateActionV1>;
type MemberProgressV1 = MemberCreateActionV1['progress'];
type MemberStage = MemberProgressV1['stage'];
type AcceptedEventV1 = Extract<ReturnType<typeof memberCreationAcceptedCodec.decode>, { status: 'decoded' }>['value'];
type DecidedEventV1 = Extract<ReturnType<typeof memberCreationDecidedCodec.decode>, { status: 'decoded' }>['value'];

/** The Host system actor every child Session is created as; its identity is also the registration receipt key. */
const MEMBER_SYSTEM_ACTOR = { kind: 'system' as const, id: 'member-service' };
const REQUEST_OPERATION = 'member.request';
const DECIDE_OPERATION = 'member.decide';
const STAGE_OPERATION = 'member.request.stage';
const MEMBER_REUSE_PAGES = 8;
const MEMBER_REUSE_PAGE_LIMIT = 50;

function coreErrorOf(value: string): CoreError {
  return (CORE_ERRORS as readonly string[]).includes(value) ? value as CoreError : 'unavailable';
}

function memberScopeProblem(ctx: CoreCallContext): CoreRejection | null {
  if (!nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)) {
    return rejected('forbidden', 'a member request requires a bound project/workspace context');
  }
  return null;
}

const systemContext = (ctx: CoreCallContext): CoreCallContext => hostSystemContext(ctx, MEMBER_SYSTEM_ACTOR);

function memberOperationId(identityKey: string): string {
  return `member-${identityKey.slice(`${REQUEST_OPERATION}:`.length)}`;
}

function childCommandIdOf(operation: OperationRef): string {
  return `${operation.operationId}:create`;
}

function sourceOf(record: MemberOperationRecordV1): DecisionSourceV1 {
  const task = record.action.input.scope.task;
  const pin = { ref: structuredClone(record.ref), revision: record.revision };
  return {
    kind: 'member_creation',
    key: decisionSourceKey({ kind: 'member_creation', operationRef: record.ref }),
    subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId } },
    pins: [pin],
    goalBases: [],
  };
}

function acceptedAction(record: MemberOperationRecordV1): MemberCreateActionV1 {
  return structuredClone(record.action);
}

function newMemberRecord(input: {
  ref: OperationRef; workspaceId: string; at: string; actionInput: MemberCreateActionV1['input'];
}): MemberOperationRecordV1 {
  const accepted = acceptedMemberCreation(input.actionInput);
  return {
    ref: input.ref,
    revision: 1,
    workspaceId: input.workspaceId,
    action: accepted.action,
    phase: accepted.phase,
    requestedAt: input.at,
    updatedAt: input.at,
    observation: null,
    failure: null,
  };
}

/** The record envelope around one pure progress step: this writer adds the revision and the step's time. */
function advanced(
  record: MemberOperationRecordV1,
  at: string,
  step: MemberCreationStepV1,
): MemberOperationRecordV1 {
  const next = advancedMemberCreation(record.action, record.phase, step);
  return {
    ...record,
    revision: record.revision + 1,
    updatedAt: at,
    phase: next.phase,
    action: next.action,
  };
}

function encodeMemberRecord(record: MemberOperationRecordV1): EncodedRecord {
  return encodeSessionOperationRecord(record as unknown as SessionOperationRecord);
}

function acceptedEvent(deps: MemberServiceDependenciesV1, record: MemberOperationRecordV1) {
  return memberCreationAcceptedCodec.encode({
    eventId: deps.eventId(), eventType: 'MemberCreationAccepted', schemaVersion: 1, occurredAt: record.requestedAt,
    projectId: record.ref.projectId, workspaceId: record.workspaceId, operationRef: structuredClone(record.ref),
    revision: record.revision, action: acceptedAction(record),
  });
}

function decidedEvent(deps: MemberServiceDependenciesV1, record: MemberOperationRecordV1) {
  return memberCreationDecidedCodec.encode({
    eventId: deps.eventId(), eventType: 'MemberCreationDecided', schemaVersion: 1, occurredAt: record.updatedAt,
    projectId: record.ref.projectId, workspaceId: record.workspaceId, operationRef: structuredClone(record.ref),
    revision: record.revision, action: structuredClone(record.action),
  });
}

/** The pure input identity of one request write: the caller's own declared caller, never a read result. */
function requestFingerprintInput(
  input: MemberRequestInputV1, workspace: WorkspaceScope, task: TaskTriple, acknowledgement: SessionMessageRef | null,
): JsonValue {
  return {
    workspace, caller: input.caller, duty: 'executor', scope: { kind: 'task', task }, reason: input.reason,
    acknowledgement,
  } as unknown as JsonValue;
}

/** The stage command of one progress write: one key covers exactly this revision's stage. */
function stageCommand(ref: OperationRef, revision: number, stage: MemberStage): {
  operation: string; commandId: string; fingerprintInput: JsonValue;
} {
  return {
    operation: STAGE_OPERATION,
    commandId: `${ref.operationId}:${stage}:${String(revision)}`,
    fingerprintInput: { operationRef: ref, revision, stage } as unknown as JsonValue,
  };
}

function goalGuard(goal: GoalSnapshot): RecordGuard {
  return { refKey: canonicalJson(goal.ref as unknown as JsonValue), expectedRevision: goal.revision };
}

function acknowledgementProblem(ctx: CoreCallContext, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const problem = checkShape(SessionMessageRefShape, value, 'stored');
  if (problem !== null) return `the member acknowledgement is invalid: ${problem}`;
  const acknowledgement = value as SessionMessageRef;
  if (acknowledgement.projectId !== ctx.projectId
    || (ctx.workspaceId !== undefined && acknowledgement.workspaceId !== ctx.workspaceId)) {
    return 'the member acknowledgement belongs to another workspace';
  }
  return null;
}

type RequestDecision =
  | { kind: 'reused'; session: SessionRef }
  | { kind: 'needs_decision' }
  | { kind: 'automatic_notice' };

type RequestFactsBase = {
  workspace: WorkspaceScope;
  caller: MemberCallerV1;
  actionInput: MemberCreateActionV1['input'];
  guards: RecordGuard[];
};
type RuleMatchInput = Parameters<typeof matchAutonomyRule>[0];
/** A Work caller's accepted delegation as the rule match reads it; a secretary caller has none. */
type MemberRuleDelegationV1 = NonNullable<RuleMatchInput['delegation']>;
/** The rules a request is judged with, the executor seat counts, and the guards of both reads. */
type MemberRuleFactsV1 = {
  view: AutonomyRuleViewV1; setGuard: RecordGuard;
  counts: RuleMatchInput['counts']; allocationGuard: RecordGuard;
};
type RequestFacts =
  | (RequestFactsBase & { kind: 'host_pick'; ceiling?: undefined })
  | (RequestFactsBase & {
      kind: 'work' | 'secretary';
      goal: GoalSnapshot;
      reused: SessionRef | null;
      ceiling?: MemberDelegationCeilingV1;
      delegation?: MemberRuleDelegationV1;
      /** `null` when the service has no rule reads: the factory default decides. */
      rules: MemberRuleFactsV1 | null;
    });

type ResolvedRequestCaller =
  | { kind: 'host_pick'; caller: MemberCallerV1 }
  | {
      kind: 'work' | 'secretary';
      caller: MemberCallerV1;
      goal: GoalSnapshot;
      plan: PlanRevisionSnapshot;
      guards: RecordGuard[];
      ceiling?: MemberDelegationCeilingV1;
      delegation?: MemberRuleDelegationV1;
    };

type DecisionFacts = { operation: MemberOperationRecordV1; plan: PlanRevisionSnapshot | null };
type DecisionChoice = { kind: 'creating' | 'reject' | 'stale'; guards: RecordGuard[] };

export function createMemberService(deps: MemberServiceDependenciesV1): MemberServiceV1 {
  const now = deps.now;

  // O4b's resolver is the only Goal→region read; `asker:null` forbids the creator and the person, so a `human`
  // answer is `invalid/no_responsible_adviser`, never a substitution.
  async function responsibleAdviserOf(
    ctx: CoreCallContext, task: TaskTriple, plan: PlanRevisionSnapshot | null,
  ): Promise<SessionRef | null | CoreRejection> {
    const row = plan === null ? undefined : plan.tasks.find((candidate) => candidate.taskId === task.taskId);
    const moduleRef = row !== undefined && row.scope.kind === 'module'
      ? { projectId: task.projectId, moduleId: row.scope.moduleRef } : null;
    const input = { projectId: task.projectId, goalRef: goalRefFor(task.projectId, task.goalId),
      moduleRef, asker: null };
    // L42's order: the Goal's adviser first, the task module's region adviser only when that is empty.
    // `general` is the goal-only arm (`asker:null` removes the creator); `technical` keeps its own region-first order.
    const goalRead = await deps.advisers.resolveResponsibilityRecipient(systemContext(ctx), { ...input, kind: 'general' });
    if (goalRead.status !== 'ready') {
      return goalRead.status === 'rejected' ? goalRead
        : rejected('unavailable', 'the responsible adviser could not be read');
    }
    if (goalRead.value.kind === 'session') return goalRead.value.session;
    const regionRead = await deps.advisers.resolveResponsibilityRecipient(systemContext(ctx), { ...input, kind: 'technical' });
    if (regionRead.status !== 'ready') {
      return regionRead.status === 'rejected' ? regionRead
        : rejected('unavailable', 'the responsible adviser could not be read');
    }
    return regionRead.value.kind === 'session' ? regionRead.value.session : null;
  }

  async function readMemberOperation(ref: OperationRef): Promise<MemberOperationRecordV1 | null | CoreRejection> {
    const read = await readOwnerRecord({
      store: deps.records,
      refKey: operationRefKey(ref),
      decode: decodeSessionOperationRecord,
      readError: (message) => rejected('unavailable', `the member operation could not be read: ${message}`),
    });
    if (!read.ok) {
      if ('notFound' in read) return null;
      // The owner read's only `invalid` is a decode failure; the member arm answers damage as unavailable.
      return read.rejection.code === 'invalid'
        ? rejected('unavailable', `the member operation is damaged: ${read.rejection.reason}`)
        : read.rejection;
    }
    if ((read.value.action as { kind: string }).kind !== 'member_create') {
      return rejected('unavailable', 'the operation is not a member creation');
    }
    return read.value as unknown as MemberOperationRecordV1;
  }

  async function creationReceipt(projectId: string, childCommandId: string):
    Promise<DecisionApplicationReceiptV1 | CoreRejection> {
    const identityKey = sessionRegisterIdentityKey(MEMBER_SYSTEM_ACTOR, projectId, childCommandId);
    const read = await lookupCommittedReceiptByIdentity(deps.commitIdentities, identityKey);
    if (read.status !== 'found') {
      return read.status === 'missing'
        ? rejected('unavailable', 'the member creation commit is missing')
        : rejected('unavailable', `the member creation receipt is unavailable: ${read.reason}`);
    }
    return { identityKey, fingerprint: read.fingerprint, cursor: read.receipt.cursor };
  }

  /**
   * The Work caller's one Run read: its accepted permissions admit the request and become the child ceiling, and with
   * the role binding's version they are the delegation a rule match checks.
   */
  async function readWorkCaller(ctx: CoreCallContext, caller: Extract<MemberCallerV1, { kind: 'work' }>):
    Promise<{ ceiling: MemberDelegationCeilingV1; delegation: MemberRuleDelegationV1; guard: RecordGuard }
      | CoreRejection> {
    let read;
    try {
      read = await deps.executions.readExecution(systemContext(ctx), structuredClone(caller.run));
    } catch (error) {
      return rejected('unavailable', `the member caller Run could not be read: ${messageOf(error)}`);
    }
    if (read.status === 'not_found') return rejected('unavailable', 'the member caller Run is missing');
    if (read.status === 'not_ready') return rejected('unavailable', 'the member caller Run is not ready');
    if (read.status !== 'ready') return read;
    const run = read.value.run;
    if (run.envelope === null) return rejected('forbidden', 'the member caller Run has no accepted envelope');
    const permissions = run.envelope.permissions;
    if (!permissions.tools.includes('create_member') || permissions.createMember !== true) {
      return rejected('forbidden', 'the member caller Run is not admitted to create a member');
    }
    return {
      ceiling: {
        tools: [...permissions.tools], writeScope: [...permissions.writeScope], createMember: true,
      },
      delegation: {
        revision: run.envelope.roleBinding.bindingVersion, tools: [...permissions.tools],
        writeScope: [...permissions.writeScope], policyRevision: permissions.policyRevision,
      },
      guard: { refKey: canonicalJson(run.ref as unknown as JsonValue), expectedRevision: run.revision },
    };
  }

  function adoptedPlanProblem(
    goal: GoalSnapshot, plan: PlanRevisionSnapshot, task: TaskTriple, workspace: WorkspaceScope,
  ): CoreRejection | null {
    if (goal.workspaceRef.projectId !== workspace.projectId
      || goal.workspaceRef.workspaceId !== workspace.workspaceId) {
      return rejected('forbidden', 'the member Task Goal is in another workspace');
    }
    if (plan.goalRef.projectId !== task.projectId || plan.goalRef.goalId !== task.goalId
      || !plan.tasks.some((candidate) => candidate.taskId === task.taskId)) {
      return rejected('invalid', 'the member Task is not in the adopted Plan');
    }
    return null;
  }

  async function resolveRequestCaller(
    ctx: CoreCallContext, input: MemberRequestInputV1, task: TaskTriple, workspace: WorkspaceScope,
  ): Promise<ResolvedRequestCaller | CoreRejection> {
    if (input.caller.kind === 'host_pick') {
      if (ctx.principal.kind !== 'host') {
        return rejected('forbidden', 'only the Host may suggest a member pick');
      }
      return { kind: 'host_pick', caller: { kind: 'host_pick' } };
    }
    if (input.caller.kind === 'work') {
      if (ctx.principal.kind !== 'work_run') {
        return rejected('forbidden', 'a work member caller requires a Work Run principal');
      }
      if (canonicalJson(input.caller.run as unknown as JsonValue)
        !== canonicalJson(ctx.principal.runRef as unknown as JsonValue)) {
        return rejected('forbidden', 'the member caller Run is not the calling Run');
      }
      const work = await readWorkCaller(ctx, input.caller);
      if ('status' in work) return work;
      const window = await readGoalPlanWindow(deps.records, goalRefFor(task.projectId, task.goalId));
      if (window.status !== 'ready') {
        return window.code === 'not_found'
          ? rejected('invalid', window.reason) : rejected(window.code, window.reason);
      }
      const plan = window.plan;
      if (plan === null) return rejected('invalid', 'the member Task is not in the adopted Plan');
      const planProblem = adoptedPlanProblem(window.goal, plan, task, workspace);
      if (planProblem !== null) return planProblem;
      return {
        kind: 'work', caller: structuredClone(input.caller), goal: window.goal, plan,
        guards: [goalGuard(window.goal), planGuard(plan), work.guard], ceiling: work.ceiling,
        delegation: work.delegation,
      };
    }
    if (ctx.principal.kind !== 'query_run') {
      return rejected('forbidden', 'a secretary member caller requires a QueryRun principal');
    }
    let resolved;
    try {
      resolved = await deps.secretaryRuns.resolveSecretaryQueryRun(ctx);
    } catch (error) {
      return rejected('unavailable', `the secretary round could not be resolved: ${messageOf(error)}`);
    }
    if (resolved.status !== 'ready') return resolved;
    const round = resolved.value;
    if (round.scope.projectId !== ctx.projectId || round.scope.workspaceId !== ctx.workspaceId) {
      return rejected('forbidden', 'the secretary round is bound to another workspace');
    }
    let window;
    try {
      window = await readGoalPlanWindow(deps.records, goalRefFor(task.projectId, task.goalId));
    } catch (error) {
      return rejected('unavailable', `the adopted Plan could not be read: ${messageOf(error)}`);
    }
    if (window.status !== 'ready' && window.code !== 'not_found') {
      return rejected(window.code, window.reason);
    }
    let plan: PlanRevisionSnapshot | null = null;
    if (window.status === 'ready') {
      // A ready window without a plan is not a plan-membership question: no adopted Plan exists.
      plan = window.plan;
      if (plan === null) return rejected('invalid', 'the member Task is not in the adopted Plan');
      const planProblem = adoptedPlanProblem(window.goal, plan, task, workspace);
      if (planProblem !== null) return planProblem;
    }
    // The advisory and request-owner reads are Host-side directory/fact reads: a QueryRun principal may not read
    // Sessions, so they run in the same trusted system context as the child creation. The caller's own ctx stays on
    // the round resolution above and on every command identity/write.
    const trusted = systemContext(ctx);
    const adviser = await responsibleAdviserOf(ctx, task, plan);
    if (adviser !== null && 'status' in adviser) return adviser;
    if (adviser === null) return rejected('invalid', 'no_responsible_adviser');
    // The special name belongs only to an absent adviser; a missing plan with an adviser is a plain invalid.
    if (window.status !== 'ready') return rejected('invalid', window.reason);
    let owner;
    try {
      owner = await deps.requests.ownerOf(trusted, { requestRoot: round.requestRoot });
    } catch (error) {
      return rejected('unavailable', `the request owner could not be read: ${messageOf(error)}`);
    }
    if (owner.status === 'not_found') return rejected('forbidden', 'the request has no current owner');
    if (owner.status === 'not_ready') return rejected('unavailable', 'the request owner is not readable');
    if (owner.status !== 'ready') return rejected(owner.code, owner.reason);
    if (owner.value === null || plainSessionRefKey(owner.value) !== plainSessionRefKey(round.session)) {
      return rejected('forbidden', 'the secretary does not currently own this request');
    }
    return {
      kind: 'secretary',
      caller: {
        kind: 'secretary_query', session: structuredClone(round.session), run: structuredClone(round.run),
        round: structuredClone(round.round), requestRoot: structuredClone(round.requestRoot),
      },
      goal: window.goal,
      plan: plan!,
      guards: [goalGuard(window.goal), planGuard(plan!)],
    };
  }

  async function findReusable(ctx: CoreCallContext, workspace: WorkspaceScope, task: TaskTriple,
    role: RoleConfigurationRef): Promise<SessionRef | null | CoreRejection> {
    if (deps.reuse === undefined) return null;
    const target = { kind: 'task', ref: task } as JsonValue;
    let cursor: string | null = null;
    for (let page = 0; page < MEMBER_REUSE_PAGES; page += 1) {
      let read;
      try {
        // The candidate directory is a Host-side read too: the caller may be a QueryRun, which the directory does not
        // admit. The reuse verdict below still receives the caller's own ctx.
        read = await deps.sessions.findSessions(systemContext(ctx), {
          workspace, role, includeArchived: false,
          page: cursor === null ? { limit: MEMBER_REUSE_PAGE_LIMIT } : { limit: MEMBER_REUSE_PAGE_LIMIT, cursor },
        });
      } catch (error) {
        return rejected('unavailable', `the member reuse candidates could not be read: ${messageOf(error)}`);
      }
      if (read.status === 'not_found') return rejected('unavailable', 'the member reuse candidates are not readable');
      if (read.status === 'not_ready') return rejected('unavailable', 'the member reuse candidates are not ready');
      if (read.status !== 'ready') return read;
      for (const card of read.value.items) {
        const openResponsible = card.links.filter((link) =>
          link.ref.relation === 'responsible' && link.until === null);
        if (openResponsible.length !== 1) continue;
        if (canonicalJson(openResponsible[0]!.ref.target as unknown as JsonValue) !== canonicalJson(target)) continue;
        let verdict;
        try {
          verdict = await deps.reuse.reusable(ctx, { workspaceId: workspace.workspaceId, sessionRole: role, card });
        } catch (error) {
          return rejected('unavailable', `the member reuse verdict failed: ${messageOf(error)}`);
        }
        if (verdict.reusable) {
          return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
        }
      }
      if (read.value.nextCursor === null) return null;
      cursor = read.value.nextCursor;
    }
    return null;
  }

  async function readMemberRequestFacts(
    ctx: CoreCallContext, input: MemberRequestInputV1, workspace: WorkspaceScope, task: TaskTriple,
    acknowledgement: SessionMessageRef | null,
  ): Promise<{ status: 'ready'; facts: RequestFacts } | CoreRejection> {
    const resolved = await resolveRequestCaller(ctx, input, task, workspace);
    if ('status' in resolved) return resolved;
    const actionInput: MemberCreateActionV1['input'] = {
      workspace: structuredClone(workspace), caller: structuredClone(resolved.caller), duty: 'executor',
      scope: { kind: 'task', task: structuredClone(task) }, reason: input.reason,
      acknowledgement: acknowledgement === null ? null : structuredClone(acknowledgement),
      commandId: input.commandId, fingerprint: '0'.repeat(64),
    };
    const inputProblem = memberCreateInputProblem({ input: actionInput });
    if (inputProblem !== null) return rejected('invalid', inputProblem);
    if (resolved.kind === 'host_pick') {
      return {
        status: 'ready',
        facts: {
          kind: 'host_pick', workspace: structuredClone(workspace), caller: resolved.caller, actionInput, guards: [],
        },
      };
    }
    const role = await deps.executorRole(ctx, { workspace, task });
    if (role.status !== 'ready') {
      if (role.status === 'rejected') return role;
      return rejected('unavailable', 'the Task executor role is not readable');
    }
    const reused = await findReusable(ctx, workspace, task, structuredClone(role.value));
    if (reused !== null && 'status' in reused) return reused;
    // The project's rules and the executor seat, read in this attempt so a retried commit judges fresh ones.
    let rules: MemberRuleFactsV1 | null = null;
    if (deps.autonomyRules !== undefined && deps.allocation !== undefined) {
      const projectRef = { projectId: ctx.projectId };
      const view = await deps.autonomyRules.read(ctx, { projectRef });
      if (view.status !== 'ready') {
        return view.status === 'rejected' ? view : rejected('unavailable', 'the autonomy rules are not readable');
      }
      const seat = await deps.allocation.readAllocationForCommit(ctx, { projectRef, duty: 'executor' });
      if (seat.status !== 'ready') {
        return seat.status === 'rejected' ? seat : rejected('unavailable', 'the executor seats are not readable');
      }
      const set = view.value.set;
      rules = {
        view: view.value,
        // a set never written reads as revision 0 and is guarded as absent
        setGuard: { refKey: canonicalJson(set.ref as unknown as JsonValue),
          expectedRevision: set.revision === 0 ? null : set.revision },
        counts: { holders: seat.value.allocation?.holders.length ?? 0,
          reservations: seat.value.allocation?.reservations.length ?? 0,
          open: openLimitOf(seat.value.limits, 'executor') },
        allocationGuard: seat.value.allocationGuard,
      };
    }
    return {
      status: 'ready',
      facts: {
        kind: resolved.kind, workspace: structuredClone(workspace), caller: resolved.caller, actionInput,
        guards: resolved.guards, goal: resolved.goal, reused,
        ...(resolved.ceiling === undefined ? {} : { ceiling: structuredClone(resolved.ceiling) }),
        ...(resolved.delegation === undefined ? {} : { delegation: structuredClone(resolved.delegation) }),
        rules,
      },
    };
  }

  /**
   * The verdict and the guards it rests on. A matching rule (L37) is the policy's third layer; it is matched with
   * this attempt's clock, so an expiry between the read and the commit is judged at the commit. The commit guards the
   * rule set it was judged against, matched or not, and the executor seat when the matched rule's executor limit
   * counted it.
   */
  function decideRequest(facts: RequestFacts): { decision: RequestDecision; ruleGuards: RecordGuard[] } {
    if (facts.kind === 'host_pick') return { decision: { kind: 'needs_decision' }, ruleGuards: [] };
    if (facts.reused !== null) {
      return { decision: { kind: 'reused', session: structuredClone(facts.reused) }, ruleGuards: [] };
    }
    const rules = facts.rules;
    const matchedRule = rules === null ? null : matchAutonomyRule({
      action: 'create_member', tool: 'create_member', objects: [{ kind: 'goal', goalRef: facts.goal.ref }],
      rules: rules.view.rules, now: deps.now(), catalog: null, delegation: facts.delegation ?? null, roleCeiling: null,
      createMemberAuthorized: facts.kind === 'work' ? facts.ceiling?.createMember === true : true,
      duty: 'executor', counts: rules.counts, newReservations: 1,
    });
    // `create_member` is the two-verdict action of the one autonomy table.
    const verdict = decisionActionPolicy({
      autonomy: facts.goal.settings.autonomy, action: 'create_member', actorClass: 'system', countedNext: null, cap: 0,
      matchedRule, ...(rules === null ? {} : { ruleSetRevision: rules.view.set.revision }),
    }) as 'needs_decision' | 'automatic_notice';
    const ruleGuards = rules === null ? []
      : [rules.setGuard, ...(matchedRule?.limits?.open?.executor === undefined ? [] : [rules.allocationGuard])];
    return { decision: { kind: verdict }, ruleGuards };
  }

  /** The accepted write: `member.request` at revision 1 with the caller's command id, through the shared executor. */
  async function writeAccepted(
    ctx: CoreCallContext, input: MemberRequestInputV1, workspace: WorkspaceScope,
    task: TaskTriple, acknowledgement: SessionMessageRef | null, ref: OperationRef,
  ): Promise<
    | { replayed: false; record: MemberOperationRecordV1; facts: RequestFacts; decision: RequestDecision }
    | { replayed: true; record: MemberOperationRecordV1 }
    | CoreRejection
  > {
    let facts: RequestFacts | null = null;
    let decision: RequestDecision | null = null;
    let ruleGuards: RecordGuard[] = [];
    let built: MemberOperationRecordV1 | null = null;
    const result = await executeWriteCommand<RequestFacts, RequestDecision, CoreRejection, AcceptedEventV1,
      { ref: OperationRef; revision: number }>(deps.records, {
      operation: REQUEST_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: input.commandId,
      fingerprintInput: requestFingerprintInput(input, workspace, task, acknowledgement),
      read: async () => {
        const read = await readMemberRequestFacts(ctx, input, workspace, task, acknowledgement);
        if (read.status === 'ready') facts = read.facts;
        return read;
      },
      decide: (readFacts) => {
        const decided = decideRequest(readFacts);
        decision = decided.decision;
        ruleGuards = decided.ruleGuards;
        return { decision: decided.decision };
      },
      build: (_decision, keys) => {
        const readFacts = facts!;
        const record = newMemberRecord({
          ref, workspaceId: readFacts.workspace.workspaceId, at: now(),
          actionInput: { ...readFacts.actionInput, fingerprint: keys.fingerprint },
        });
        built = record;
        return {
          guards: [{ refKey: operationRefKey(ref), expectedRevision: null }, ...readFacts.guards, ...ruleGuards],
          records: [encodeMemberRecord(record)],
          events: [acceptedEvent(deps, record)],
          claims: [],
        };
      },
      // A rule-set change between the read and the commit re-runs the read, the match and the policy, so the request
      // is judged by the rules that hold at its commit (a revoked rule gives the factory card); no other guard retries.
      retryable: { guard: (key) => facts !== null && facts.kind !== 'host_pick' && facts.rules !== null
        && key === facts.rules.setGuard.refKey },
      result: {
        eventType: 'MemberCreationAccepted',
        schemaVersion: 1,
        decode: (event) => memberCreationAcceptedCodec.decode(event),
        validate(event, _receipt, keys) {
          if (operationRefKey(event.operationRef) !== operationRefKey(ref)) return 'the event records another operation';
          if (event.revision !== 1) return 'the event records another revision';
          if (event.action.input.commandId !== input.commandId) return 'the event records another command';
          if (event.action.input.fingerprint !== keys.fingerprint) return 'the event records another input';
          return event.action.progress.stage === 'accepted' ? null : 'the event records another stage';
        },
        project: (event) => ({ ref: event.operationRef, revision: event.revision }),
      },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
    if (!result.replayed) {
      return { replayed: false, record: built!, facts: facts!, decision: decision! };
    }
    // A replay only projects the current operation; it never decides or writes a
    // later stage.
    const current = await readMemberOperation(ref);
    if (current === null) return rejected('unavailable', 'the committed member request has no operation');
    if (!('action' in current)) return current;
    return { replayed: true, record: current };
  }

  type CreationOutcome =
    | { kind: 'done'; session: SessionRef; proofReceipt?: DecisionApplicationReceiptV1 }
    | { kind: 'pending' }
    | { kind: 'failed'; code: string; reason: string; detail?: CapacityAtCapDetailV1 }
    | CoreRejection;

  /** One progress write through the shared executor; a replay answers the current operation, never a rebuilt one. */
  async function writeStage(
    ctx: CoreCallContext,
    command: { operation: string; commandId: string; fingerprintInput: JsonValue },
    current: MemberOperationRecordV1,
    stage: MemberStage,
    makeNext: (at: string) => MemberOperationRecordV1,
    guards: readonly RecordGuard[],
  ): Promise<WriteResult<MemberOperationRecordV1>> {
    let built: MemberOperationRecordV1 | null = null;
    const result = await executeWriteCommand<MemberOperationRecordV1, null, CoreRejection, DecidedEventV1,
      { ref: OperationRef; revision: number }>(deps.records, {
      operation: command.operation,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: command.commandId,
      fingerprintInput: command.fingerprintInput,
      read: () => Promise.resolve({ status: 'ready' as const, facts: current }),
      decide: () => ({ decision: null }),
      build: () => {
        const next = makeNext(now());
        built = next;
        return {
          guards: [{ refKey: operationRefKey(current.ref), expectedRevision: current.revision }, ...guards],
          records: [encodeMemberRecord(next)],
          events: [decidedEvent(deps, next)],
          claims: [],
        };
      },
      result: {
        eventType: 'MemberCreationDecided',
        schemaVersion: 1,
        decode: (event) => memberCreationDecidedCodec.decode(event),
        validate(event) {
          if (operationRefKey(event.operationRef) !== operationRefKey(current.ref)) {
            return 'the event records another operation';
          }
          if (event.revision !== current.revision + 1) return 'the event records another revision';
          return event.action.progress.stage === stage ? null : 'the event records another stage';
        },
        project: (event) => ({ ref: event.operationRef, revision: event.revision }),
      },
    });
    const answer = writeAnswer(result);
    if (answer.status === 'rejected') return answer;
    if (!answer.replayed) return { ...answer, value: built! };
    const read = await readMemberOperation(current.ref);
    if (read === null) return rejected('unavailable', 'the committed member operation is missing');
    if (!('action' in read)) return read;
    return { ...answer, value: read };
  }

  async function lineInputOf(
    ctx: CoreCallContext, operation: MemberOperationRecordV1, ceiling?: MemberDelegationCeilingV1,
  ): Promise<MemberLineCreationInputV1 | CoreRejection> {
    const caller = operation.action.input.caller;
    // 121-109: an executor line an adviser builds takes the Host's executor grant (tools, write scope), not the
    // adviser's own read-only envelope; like a secretary-built line it carries no ceiling and may not create members.
    let coordinatorBuilt = caller.kind === 'secretary_query';
    if (caller.kind === 'work') {
      const card = await deps.sessions.readSession(systemContext(ctx), caller.session, 'project');
      if (card.status !== 'ready') {
        return card.status === 'rejected' ? card : rejected('unavailable', 'the member caller line could not be read');
      }
      const duty = await deps.duty(card.value.record.role, systemContext(ctx));
      if (duty.status !== 'ready') {
        return duty.status === 'rejected' ? duty : rejected('unavailable', 'the member caller duty could not be read');
      }
      coordinatorBuilt = duty.value === 'adviser';
    }
    let delegationCeiling = coordinatorBuilt ? undefined : ceiling;
    if (caller.kind === 'work' && !coordinatorBuilt && delegationCeiling === undefined) {
      const read = await readWorkCaller(ctx, caller);
      if ('status' in read) return read;
      delegationCeiling = read.ceiling;
    }
    const role = await deps.executorRole(ctx, {
      workspace: operation.action.input.workspace, task: operation.action.input.scope.task,
    });
    if (role.status !== 'ready') {
      if (role.status === 'rejected') return role;
      return rejected('unavailable', 'the Task executor role is not readable');
    }
    return {
      commandId: childCommandIdOf(operation.ref),
      duty: 'executor',
      scope: { kind: 'task', task: structuredClone(operation.action.input.scope.task) },
      reason: operation.action.input.reason,
      provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: structuredClone(role.value),
      ...(delegationCeiling === undefined ? {} : { delegationCeiling: structuredClone(delegationCeiling) }),
      ...(coordinatorBuilt ? { secretaryCreated: true as const } : {}),
      parentOperation: structuredClone(operation.ref),
    };
  }

  async function runCreation(
    ctx: CoreCallContext, operation: MemberOperationRecordV1, requireProof: boolean, recovery: boolean,
    ceiling?: MemberDelegationCeilingV1,
  ): Promise<CreationOutcome> {
    // D-18: the adviser this create notifies; set only on the secretary path, by the check below.
    let adviserToNotify: SessionRef | null = null;
    // L42: the ONE create/dispatch path re-reads the responsible adviser before dispatching, so a changed or absent
    // adviser refuses instead of dispatching on the earlier read (request, approved card and Host recovery alike).
    if (operation.action.input.caller.kind === 'secretary_query') {
      const task = operation.action.input.scope.task;
      const window = await readGoalPlanWindow(deps.records, goalRefFor(task.projectId, task.goalId));
      if (window.status !== 'ready' && window.code !== 'not_found') return rejected(window.code, window.reason);
      const adviser = await responsibleAdviserOf(ctx, task, window.status === 'ready' ? window.plan : null);
      if (adviser !== null && 'status' in adviser) return adviser;
      if (adviser === null) return rejected('invalid', 'no_responsible_adviser');
      adviserToNotify = adviser;
    }
    const input = await lineInputOf(ctx, operation, ceiling);
    if ('status' in input) return input;
    let line;
    try {
      line = await deps.lines.ensureLine(systemContext(ctx), input);
    } catch (error) {
      return rejected('unavailable', `the member line creation did not complete: ${messageOf(error)}`);
    }
    if (line.status === 'capacity_blocked' || line.status === 'rejected') {
      const detail = line.status === 'capacity_blocked' ? line.detail! : undefined;   // the one narrowing
      const code = line.status === 'capacity_blocked' ? 'capacity' : line.code;
      const reason = line.status === 'capacity_blocked'
        ? `at_cap: ${line.detail!.duty} has ${line.detail!.holders} holder(s) and ${line.detail!.reservations} reservation(s) against open limit ${line.detail!.open}`
        : line.reason;
      if (recovery) {
        // The recovery keeps the original child and the creating stage; only the refusal fact is written back.
        const written = await writeStage(
          ctx, stageCommand(operation.ref, operation.revision + 1, 'creating'), operation, 'creating',
          (at) => advanced(operation, at, { kind: 'refused', refusal: { code, reason } }),
          [],
        );
        if (written.status === 'rejected') return written;
        return { kind: 'failed', code, reason, ...(detail === undefined ? {} : { detail }) };
      }
      const written = await writeStage(
        ctx, stageCommand(operation.ref, operation.revision + 1, 'rejected'), operation, 'rejected',
        (at) => advanced(operation, at, { kind: 'rejected', refusal: { code, reason } }),
        [],
      );
      if (written.status === 'rejected') return written;
      return { kind: 'failed', code, reason, ...(detail === undefined ? {} : { detail }) };
    }
    if (line.status === 'accepted') return { kind: 'pending' };
    if (adviserToNotify !== null) {
      // One `notify` per operation (终稿 :1821): the request id is the operation's, so a replay, an approval or a
      // recovery re-sends the same identity and the mailbox restores its receipt (mailbox-send.ts:353–:356). It is sent
      // before `done`: only `creating` resumes, so a crash in between resends instead of losing it. A changed
      // adviser on recovery meets the first notice's identity (`idempotency_conflict`): the first notice stands.
      const notice = await deps.messages.sendMessage(systemContext(ctx), {
        input: { recipient: plainSessionRef(adviserToNotify), intent: 'notify',
          text: `秘书新建了执行线：任务 ${operation.action.input.scope.task.taskId}，执行线 ${line.session.sessionId}。` },
        meta: { requestId: `member:${operation.ref.operationId}`, expected: [] },
      });
      if (notice.status !== 'committed'
        && !(notice.status === 'rejected' && notice.code === 'idempotency_conflict')) return notice;
    }
    let proofReceipt: DecisionApplicationReceiptV1 | null = null;
    if (requireProof) {
      const receipt = await creationReceipt(ctx.projectId, childCommandIdOf(operation.ref));
      if ('status' in receipt) return receipt;
      proofReceipt = receipt;
    }
    const written = await writeStage(
      ctx, stageCommand(operation.ref, operation.revision + 1, 'done'), operation, 'done',
      (at) => advanced(operation, at, { kind: 'created', session: line.session }),
      [],
    );
    if (written.status === 'rejected') return written;
    return proofReceipt === null
      ? { kind: 'done', session: structuredClone(line.session) }
      : { kind: 'done', session: structuredClone(line.session), proofReceipt };
  }

  async function requestResultOf(operation: MemberOperationRecordV1): Promise<MemberRequestResultV1> {
    const progress = operation.action.progress;
    if (progress.stage === 'done') {
      if (progress.outcome === null) return rejected('unavailable', 'a done member operation has no outcome');
      if (progress.outcome.kind === 'reused') {
        return { status: 'reused', session: structuredClone(progress.outcome.session), operation: structuredClone(operation.ref) };
      }
      const receipt = await creationReceipt(operation.ref.projectId, childCommandIdOf(operation.ref));
      if ('status' in receipt) return receipt;
      return {
        status: 'created', session: structuredClone(progress.outcome.session),
        operation: structuredClone(operation.ref), proofReceipt: receipt,
      };
    }
    if (progress.stage === 'awaiting_decision') {
      const cardKey = progress.decision?.cardKey ?? null;
      if (cardKey === null) return rejected('unavailable', 'the member card has no key');
      return { status: 'needs_decision', cardKey, operation: structuredClone(operation.ref) };
    }
    if (progress.stage === 'creating' || progress.stage === 'accepted') {
      return { status: 'pending', operation: structuredClone(operation.ref) };
    }
    if (progress.stage === 'rejected') {
      const refusal = progress.lastRefusal;
      return refusal === null
        ? rejected('source_stale', 'the member request is rejected without a recorded refusal')
        : rejected(coreErrorOf(refusal.code), refusal.reason);
    }
    return rejected('source_stale', 'the member request is stale');
  }

  async function requestMember(ctx: CoreCallContext, rawInput: MemberRequestInputV1): Promise<MemberRequestResultV1> {
    const scopeError = memberScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(rawInput) || !nonEmpty(rawInput.commandId)) {
      return rejected('invalid', 'a member request requires a non-empty commandId');
    }
    const input = structuredClone(rawInput);
    if (input.duty !== 'executor') return rejected('invalid', 'a member request must create an executor');
    if (!isRecord(input.scope) || input.scope.kind !== 'task') {
      return rejected('invalid', 'a member request scope must be a task');
    }
    const task = input.scope.task;
    const acknowledgementProblemText = acknowledgementProblem(ctx, input.acknowledgement);
    if (acknowledgementProblemText !== null) return rejected('invalid', acknowledgementProblemText);
    const acknowledgement = input.acknowledgement ?? null;
    const workspace = workspaceOf(ctx);
    const identityKey = commandIdentity({
      operation: REQUEST_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: input.commandId,
    });
    const ref: OperationRef = {
      aggregateType: 'CoreOperation', projectId: ctx.projectId, operationId: memberOperationId(identityKey),
    };

    const accepted = await writeAccepted(ctx, input, workspace, task, acknowledgement, ref);
    if ('status' in accepted) return accepted;
    if (accepted.replayed) return requestResultOf(accepted.record);
    const current = accepted.record;
    const facts = accepted.facts;
    const decision = accepted.decision;

    if (decision.kind === 'reused') {
      const written = await writeStage(
        ctx, stageCommand(current.ref, current.revision + 1, 'done'), current, 'done',
        (at) => advanced(current, at, { kind: 'reused', session: decision.session }),
        facts.guards,
      );
      if (written.status === 'rejected') return written;
      if (written.replayed) return requestResultOf(written.value);
      return {
        status: 'reused', session: structuredClone(decision.session), operation: structuredClone(current.ref),
      };
    }

    const child = stableSessionCreationIdentity(
      MEMBER_SYSTEM_ACTOR, ctx.projectId, childCommandIdOf(current.ref)).operationRef;
    if (decision.kind === 'needs_decision') {
      const cardKey = decisionSourceKey({ kind: 'member_creation', operationRef: current.ref });
      const written = await writeStage(
        ctx, stageCommand(current.ref, current.revision + 1, 'awaiting_decision'), current, 'awaiting_decision',
        (at) => advanced(current, at, { kind: 'awaiting_decision', cardKey, createChild: child }),
        facts.guards,
      );
      if (written.status === 'rejected') return written;
      if (written.replayed) return requestResultOf(written.value);
      return { status: 'needs_decision', cardKey, operation: structuredClone(current.ref) };
    }

    const noticeItemKey = `member:${current.ref.operationId}`;
    const written = await writeStage(
      ctx, stageCommand(current.ref, current.revision + 1, 'creating'), current, 'creating',
      (at) => advanced(current, at, { kind: 'creating', createChild: child, noticeItemKey }),
      facts.guards,
    );
    if (written.status === 'rejected') return written;
    if (written.replayed) return requestResultOf(written.value);
    return await finishCreation(ctx, written.value, true, facts.ceiling);
  }

  async function finishCreation(
    ctx: CoreCallContext, operation: MemberOperationRecordV1, requireProof: boolean,
    ceiling?: MemberDelegationCeilingV1,
  ): Promise<MemberRequestResultV1> {
    const outcome = await runCreation(ctx, operation, requireProof, false, ceiling);
    if (!('kind' in outcome)) return outcome;
    if (outcome.kind === 'done') {
      return {
        status: 'created', session: structuredClone(outcome.session), operation: structuredClone(operation.ref),
        proofReceipt: outcome.proofReceipt!,
      };
    }
    if (outcome.kind === 'pending') return { status: 'pending', operation: structuredClone(operation.ref) };
    return { status: 'rejected', code: coreErrorOf(outcome.code), reason: outcome.reason,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) };
  }

  async function readDecisionFacts(
    operation: MemberOperationRecordV1, verdict: 'approve' | 'reject',
  ): Promise<{ status: 'ready'; facts: DecisionFacts } | CoreRejection> {
    if (verdict === 'reject') return { status: 'ready', facts: { operation, plan: null } };
    let window;
    try {
      window = await readGoalPlanWindow(deps.records, goalRefFor(operation.action.input.scope.task.projectId, operation.action.input.scope.task.goalId));
    } catch (error) {
      return rejected('unavailable', `the adopted Plan could not be read: ${messageOf(error)}`);
    }
    // No adopted Plan means the stored Task has left the Plan; the decision itself answers stale.
    if (window.status !== 'ready' && window.code === 'not_found') {
      return { status: 'ready', facts: { operation, plan: null } };
    }
    if (window.status !== 'ready') return rejected(window.code, window.reason);
    return { status: 'ready', facts: { operation, plan: window.plan } };
  }

  async function doneDecision(operation: MemberOperationRecordV1):
    Promise<Awaited<ReturnType<MemberDecisionPortV1['applyMemberDecision']>>> {
    const progress = operation.action.progress;
    if (progress.outcome === null) return rejected('unavailable', 'a done member operation has no outcome');
    const receipt = await creationReceipt(operation.ref.projectId, childCommandIdOf(operation.ref));
    if ('status' in receipt) return receipt;
    return {
      status: 'done', session: structuredClone(progress.outcome.session),
      operation: structuredClone(operation.ref), receipt,
    };
  }

  function rejectedDecision(operation: MemberOperationRecordV1): {
    status: 'rejected'; operation: OperationRef; code: CoreError; reason: string;
  } {
    const refusal = operation.action.progress.lastRefusal;
    return {
      status: 'rejected', operation: structuredClone(operation.ref),
      code: coreErrorOf(refusal?.code ?? 'invalid'), reason: refusal?.reason ?? 'the member request was rejected',
    };
  }

  async function applyMemberDecision(ctx: CoreCallContext, rawInput: MemberDecisionInputV1):
    Promise<Awaited<ReturnType<MemberDecisionPortV1['applyMemberDecision']>>> {
    const scopeError = memberScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(rawInput) || !nonEmpty(rawInput.commandId)) {
      return rejected('invalid', 'a member decision requires a non-empty commandId');
    }
    const input = structuredClone(rawInput);
    const operationProblem = checkShape(OperationRefShape, input.operation, 'stored');
    if (operationProblem !== null) return rejected('invalid', `the member decision requires ${operationProblem}`);
    if (input.operation.aggregateType !== 'CoreOperation') {
      return rejected('invalid', 'a member decision requires a CoreOperation ref');
    }
    if (input.verdict !== 'approve' && input.verdict !== 'reject') {
      return rejected('invalid', 'a member decision is approve or reject');
    }
    const answerProblem = checkShape(SessionMessageRefShape, input.answer, 'stored');
    if (answerProblem !== null) return rejected('invalid', `the member answer is invalid: ${answerProblem}`);
    if (input.answer.projectId !== ctx.projectId
      || (ctx.workspaceId !== undefined && input.answer.workspaceId !== ctx.workspaceId)) {
      return rejected('forbidden', 'the member answer belongs to another workspace');
    }

    async function completeDecision(decided: MemberOperationRecordV1):
      Promise<Awaited<ReturnType<MemberDecisionPortV1['applyMemberDecision']>>> {
      const stage = decided.action.progress.stage;
      if (stage === 'done') return doneDecision(decided);
      if (stage === 'rejected') return rejectedDecision(decided);
      if (stage !== 'creating') return { status: 'stale', operation: structuredClone(decided.ref) };
      const outcome = await runCreation(ctx, decided, true, false);
      if (!('kind' in outcome)) return outcome;
      if (outcome.kind === 'pending') {
        return rejected('busy', 'the member child creation is still pending; the Host start-up recovery continues it');
      }
      if (outcome.kind === 'done') {
        return {
          status: 'done', session: structuredClone(outcome.session), operation: structuredClone(decided.ref),
          receipt: outcome.proofReceipt!,
        };
      }
      return { status: 'rejected', code: coreErrorOf(outcome.code), reason: outcome.reason,
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) };
    }

    let built: MemberOperationRecordV1 | null = null;
    let current: MemberOperationRecordV1 | null = null;
    const result = await executeWriteCommand<DecisionFacts, DecisionChoice,
      CoreRejection | { status: 'stale'; operation: OperationRef }, DecidedEventV1,
      { ref: OperationRef; revision: number }>(deps.records, {
      operation: DECIDE_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: input.commandId,
      fingerprintInput: {
        operation: input.operation, verdict: input.verdict, answer: input.answer,
      } as unknown as JsonValue,
      read: async () => {
        const loaded = await readMemberOperation(input.operation);
        if (loaded === null) return rejected('unavailable', 'the member operation does not exist');
        if (!('action' in loaded)) return loaded;
        current = loaded;
        return readDecisionFacts(loaded, input.verdict);
      },
      decide: (facts) => {
        const progress = facts.operation.action.progress;
        if (progress.stage !== 'awaiting_decision') {
          return { refuse: { status: 'stale' as const, operation: structuredClone(facts.operation.ref) } };
        }
        if (input.verdict === 'reject') return { decision: { kind: 'reject' as const, guards: [] } };
        const task = facts.operation.action.input.scope.task;
        const plan = facts.plan;
        // The stored Task is stale when its adopted Plan is gone or no longer names it.
        const inPlan = plan !== null && plan.goalRef.projectId === task.projectId
          && plan.goalRef.goalId === task.goalId
          && plan.tasks.some((candidate) => candidate.taskId === task.taskId);
        if (!inPlan) return { decision: { kind: 'stale' as const, guards: plan === null ? [] : [planGuard(plan)] } };
        return { decision: { kind: 'creating' as const, guards: [planGuard(plan)] } };
      },
      build: (choice) => {
        const before = current!;
        const next = advanced(before, now(), {
          kind: 'decided',
          answer: choice.kind === 'reject' ? 'reject' : 'approve',
          stale: choice.kind === 'stale',
          answerRef: structuredClone(input.answer),
        });
        built = next;
        return {
          guards: [{ refKey: operationRefKey(before.ref), expectedRevision: before.revision }, ...choice.guards],
          records: [encodeMemberRecord(next)],
          events: [decidedEvent(deps, next)],
          claims: [],
        };
      },
      result: {
        eventType: 'MemberCreationDecided',
        schemaVersion: 1,
        decode: (event) => memberCreationDecidedCodec.decode(event),
        validate(event, receipt) {
          if (operationRefKey(event.operationRef) !== operationRefKey(input.operation)) {
            return 'the event records another operation';
          }
          // A replay validates the original event against the versions its own
          // receipt committed, never against the operation's current revision.
          const committed = receipt.versions.find(entry => entry.refKey === operationRefKey(event.operationRef));
          if (committed === undefined) return 'the receipt carries no such operation version';
          if (event.revision !== committed.revision) return 'the event records another revision';
          if (event.action.progress.decision?.answer !== input.verdict) return 'the event records another answer';
          return null;
        },
        project: (event) => ({ ref: event.operationRef, revision: event.revision }),
      },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
    if (!result.replayed) return completeDecision(built!);
    // A replay projects the committed operation only: it never decides again and
    // never enters the child line, which belongs to the first commit or the
    // Host's start-up recovery.
    const read = await readMemberOperation(input.operation);
    if (read === null) return rejected('unavailable', 'the committed member operation is missing');
    if (!('action' in read)) return read;
    const stage = read.action.progress.stage;
    if (stage === 'done') return doneDecision(read);
    if (stage === 'rejected') return rejectedDecision(read);
    return stage === 'stale'
      ? { status: 'stale', operation: structuredClone(read.ref) }
      : rejected('busy', 'the member child creation is still pending; the Host start-up recovery continues it');
  }

  type MemberLookup = { status: 'ready'; records: MemberOperationRecordV1[] } | CoreRejection;
  async function lookupMemberOperations(ctx: CoreCallContext, goalRef: GoalRef): Promise<MemberLookup> {
    let page;
    try {
      page = await readAllOrdered(deps.records, {
        index: CORE_OPERATION_MEMBER_BY_GOAL_LOOKUP,
        values: [goalRef.projectId, ctx.workspaceId ?? '', goalRef.goalId],
        direction: 'asc',
      });
    } catch (error) {
      // The ordered read reports failures as a returned result; a throw is only a
      // store read error.
      return rejected('unavailable', messageOf(error));
    }
    // A missing lookup window is an empty collection; every other returned
    // failure is unavailable, whatever store code it carries.
    if (page.status !== 'ready') {
      return page.code === 'not_found'
        ? { status: 'ready', records: [] }
        : rejected('unavailable', page.reason);
    }
    const records: MemberOperationRecordV1[] = [];
    for (const encoded of page.value.records) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded' || (decoded.value.action as { kind: string }).kind !== 'member_create') {
        return rejected('unavailable', 'a member operation of this Goal is damaged');
      }
      records.push(decoded.value as unknown as MemberOperationRecordV1);
    }
    return { status: 'ready', records };
  }

  async function resumePendingMemberCreations(ctx: CoreCallContext): Promise<ReadResult<{
    resumed: readonly { operation: OperationRef; child: OperationRef; session: SessionRef }[];
    left: readonly { operation: OperationRef; code: string; reason: string }[];
  }>> {
    const scopeError = memberScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    let goals;
    try {
      goals = await readGoalsByWorkspaceCreated(deps.records, {
        projectId: ctx.projectId, workspaceId: ctx.workspaceId!,
      });
    } catch (error) {
      return rejected('unavailable', `the workspace Goals could not be read: ${messageOf(error)}`);
    }
    if (goals.status !== 'ready') return rejected(goals.code, goals.reason);
    const resumed: { operation: OperationRef; child: OperationRef; session: SessionRef }[] = [];
    const left: { operation: OperationRef; code: string; reason: string }[] = [];
    for (const goal of goals.goals) {
      const found = await lookupMemberOperations(ctx, goal.ref);
      if (found.status === 'rejected') return found;
      for (const record of found.records) {
        if (record.action.progress.stage !== 'creating' || record.action.progress.createChild === null) continue;
        const outcome = await runCreation(ctx, record, false, true);
        if (!('kind' in outcome)) {
          left.push({ operation: structuredClone(record.ref), code: outcome.code, reason: outcome.reason });
          continue;
        }
        if (outcome.kind === 'done') {
          resumed.push({
            operation: structuredClone(record.ref), child: structuredClone(record.action.progress.createChild),
            session: structuredClone(outcome.session),
          });
        } else if (outcome.kind === 'pending') {
          left.push({ operation: structuredClone(record.ref), code: 'busy',
            reason: 'the member child creation is still pending' });
        } else {
          left.push({ operation: structuredClone(record.ref), code: outcome.code, reason: outcome.reason });
        }
      }
    }
    return { status: 'ready', value: { resumed, left } };
  }

  async function readPendingMemberCards(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<readonly PendingMemberCardV1[]>> {
    const scopeError = memberScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(input) || !isRecord(input.goalRef) || input.goalRef.aggregateType !== 'Goal'
      || input.goalRef.projectId !== ctx.projectId || !nonEmpty(input.goalRef.goalId)) {
      return rejected('invalid', 'readPendingMemberCards requires the bound GoalRef');
    }
    const found = await lookupMemberOperations(ctx, input.goalRef);
    if (found.status === 'rejected') return found;
    const cards: PendingMemberCardV1[] = [];
    for (const record of found.records) {
      if (record.action.progress.stage !== 'awaiting_decision') continue;
      cards.push({
        task: structuredClone(record.action.input.scope.task),
        operation: structuredClone(record.ref),
        source: sourceOf(record),
      });
    }
    return { status: 'ready', value: cards };
  }

  async function readMemberRequestCommit(ctx: CoreCallContext, input: { commandId: string }):
    Promise<{ status: 'committed' } | { status: 'missing' } | { status: 'unavailable'; reason: string }> {
    const identityKey = commandIdentity({
      operation: REQUEST_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: input.commandId,
    });
    const read = await lookupCommittedReceiptByIdentity(deps.commitIdentities, identityKey);
    if (read.status === 'found') return { status: 'committed' };
    if (read.status === 'missing') return { status: 'missing' };
    return { status: 'unavailable', reason: read.reason ?? 'the member request receipt is unavailable' };
  }

  /**
   * L4: the read-only committed-receipt lookup for `create_member`. It rebuilds
   * the write's own R2 identity from the Kernel-recorded arguments and the
   * original Run provenance, never from the reconcile caller's ctx.
   */
  const lookupToolCommit: ToolCommitLookup = async (
    _ctx: CoreCallContext, input: ToolCommitLookupInput,
  ): Promise<ToolCommitLookupResult> => {
    if (input.toolName !== 'create_member') return toolCommitLookupUnknownTool(input.toolName);
    const args = input.arguments;
    if (!isRecord(args)) return { status: 'undetermined', reason: 'invalid_arguments' };
    try {
      const scope = args['scope'];
      if (!isRecord(scope) || scope['kind'] !== 'task' || !isRecord(scope['task'])) {
        return { status: 'undetermined', reason: 'invalid_arguments' };
      }
      const rawTask = scope['task'];
      const task: TaskTriple = {
        projectId: rawTask['projectId'] as string,
        goalId: rawTask['goalId'] as string,
        taskId: rawTask['taskId'] as string,
      };
      const acknowledgement = args['acknowledgement'];
      const origin = input.origin;
      const session = { projectId: origin.sessionRef.projectId, sessionId: origin.sessionRef.sessionId };
      const run = { aggregateType: 'Run' as const, projectId: origin.runRef.projectId,
        goalId: origin.runRef.goalId, runId: origin.runRef.runId };
      const workspace = { projectId: origin.runRef.projectId, workspaceId: origin.workspaceId };
      const request: MemberRequestInputV1 = {
        commandId: toolCommitRequestId(input),
        caller: { kind: 'work', actor: agentActorOf(session, run), session, run },
        duty: 'executor',
        scope: { kind: 'task', task },
        reason: args['reason'] as string,
        ...(acknowledgement === undefined ? {} : { acknowledgement: acknowledgement as SessionMessageRef }),
      };
      const inputProblem = memberCreateInputProblem({
        input: {
          workspace, caller: request.caller, duty: request.duty, scope: request.scope, reason: request.reason,
          acknowledgement: request.acknowledgement ?? null,
          commandId: request.commandId, fingerprint: '0'.repeat(64),
        },
      });
      if (inputProblem !== null) return { status: 'undetermined', reason: 'invalid_arguments' };
      const keys = commandKeys({
        operation: REQUEST_OPERATION,
        scope: { projectId: origin.runRef.projectId, workspaceId: origin.workspaceId },
        principal: principalIdentity({ kind: 'work_run', runRef: run }),
        commandId: request.commandId,
        fingerprintInput: requestFingerprintInput(request, workspace, task, request.acknowledgement ?? null),
      });
      return toolCommitLookupResult(await deps.records.lookupCommit(keys));
    } catch {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
  };

  return {
    request: { requestMember, resumePendingMemberCreations, readPendingMemberCards, readMemberRequestCommit },
    decision: { applyMemberDecision },
    lookupToolCommit,
  };
}
