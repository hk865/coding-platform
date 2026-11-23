/**
 * 暂缓领取的 owner（设计 3.3、3.10；重裁 5），和动作请求共用的问答轮准入（3.1，lead 裁定 1）。
 *
 * 准入（派活、叫停、暂缓、点名撤共用一处）：调用方是问答轮（做事轮不派活、不叫停、不暂缓），解析出的这一轮不是只读副本、
 * 不是秘书请求轮（请求轮的动作准入随工具接，Q7c），职责是秘书或参谋，并且负责这个目标——参谋认目标的负责链接（区域参谋
 * 不收），秘书认目标或项目的负责链接；提交守这一轮的版本（QueryRun、Session）和收下它的那条链接的版本。授予在挂工具时核。
 *
 * 暂缓的写：放（问答轮；书记原因由平台按操作号放）、点名撤（放的线或这个目标任一秘书、参谋；书记原因只认负责参谋，
 * Q7b 读法只读不守）、你撤全部（配置的操作者）。每次一条 `executeWriteCommand`，事件 `TaskClaimHoldChanged`；同一来源
 * 已放着、要撤的已撤是原样回，不写。动作请求和领取顺带改暂缓时在它们自己的提交里经 `state/task-claim-hold.ts` 改。
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { RunRefShape, SessionMessageRefShape, TaskTripleShape } from '../../../contracts/data-format-refs.js';
import type { RuntimeTask } from '../../../contracts/plan.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import { isAutomationActor, type QueryRoundActorV1 } from '../../../contracts/task-requeue.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type {
  ClaimHoldPort, ClaimHoldResultV1, ClaimHoldWriteV1, ScribeStopInputV1,
} from '../model/action-request-contracts.js';
import type { QueryRoundPort, QueryRoundV1 } from '../model/query-round-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { commandKeys, executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import { goalRefFor } from '../persistence/commit-compiler.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { readOwnerRecord, type OwnerRecordRead } from '../persistence/owner-record-read.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { readRequestRounds } from '../queries/request-rounds-read.js';
import { decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import {
  holdAwaitsCursor, nextTaskClaimHold, placeHoldReason, releaseAllHoldReasons, releaseHoldReason, taskClaimHoldRefOf,
  type HoldReleasedByV1, type NewHoldReasonV1, type PendingTaskClaimHoldV1, type TaskClaimHoldV1,
} from '../state/task-claim-hold.js';
import {
  TASK_CLAIM_HOLD_BY_PROJECT_LOOKUP, taskClaimHoldChangedCodec, taskClaimHoldCodec, type TaskClaimHoldChanged,
} from './claim-record-codecs.js';
import { operatorProblem } from './execution-entry-service.js';
import { readGoalPlanWindow, readOpenResponsibilityLines } from './plan-readers.js';
import type { ResponsibilityRecipientPort } from './responsibility-recipient.js';
import { isolatedWriteOf } from './trusted-context.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { readActionRequestRecord } from './action-request-codecs.js';
import { lineAgentIdOf } from '../model/tool-commit-arguments.js';
import type { ActionRequestRequesterV1 } from '../state/action-request.js';

type HostActor = { kind: 'human' | 'system'; id: string };

export type ClaimHoldDependencies = {
  /** 请求轮的动作准入要读请求的当前归属（`readRequestRounds` 的有序窗口）。 */
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  queryRounds: QueryRoundPort;
  duty: SessionDutyReadPort;
  /** 书记原因点名撤：负责这块的参谋（`technical` 读法，同书记审查认的那位）。 */
  recipients: Pick<ResponsibilityRecipientPort, 'resolveResponsibilityRecipient'>;
  /** 配置的操作者（你撤全部）。 */
  operatorActor?: HostActor;
  now: () => string;
  eventId: () => string;
};

// -------------------------------------------------------------------------- //
// 问答轮的动作准入（③④ 共用）                                                  //
// -------------------------------------------------------------------------- //

export type ActionRoundAdmissionV1 = {
  round: QueryRoundV1;
  duty: 'secretary' | 'adviser';
  /** 这一轮的版本 + 收下它的那条负责链接的版本（请求轮是请求事实的守卫，另见 `readRequestOwner`）。 */
  guards: RecordGuard[];
  /** 秘书请求轮自己的请求根；别的轮 `null`。动作请求和暂缓的原因据此认来源（转手仍按请求根）。 */
  requestRoot: QueryJobRef | null;
};

/** 调用方是问答轮、不是只读副本：派活、叫停、暂缓、点名撤共同的前两条。`resolveQueryRound` 自己先拒一切非
 *  `query_run`（做事轮在那里就是 `forbidden`），这里不再单列做事轮那一支。给了工具名就核这一轮冻结的授予
 * （Q1a）：没授予就是 `forbidden`，理由照冻结原文。 */
async function resolveActionRound(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'queryRounds'>, action: string, grantTool?: string,
): Promise<{ status: 'ready'; value: QueryRoundV1 } | CoreRejection> {
  const resolved = await deps.queryRounds.resolveQueryRound(ctx);
  if (resolved.status !== 'ready') return resolved;
  const round = resolved.value;
  if (round.readOnlyCopy) return rejected('forbidden', `a read-only copy may not ${action}`);
  if (grantTool !== undefined && !round.grantedToolNames.includes(grantTool)) {
    return rejected('forbidden', '这一轮没有授予这个动作');
  }
  return resolved;
}

/** 参谋认目标的负责链接；秘书认目标或项目的负责链接（项目范围的秘书管这个项目里所有目标）。 */
async function responsibleLinkOf(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'records' | 'duty'>, goalRef: GoalRef, session: SessionRef,
  duty: 'secretary' | 'adviser',
): Promise<ReadResult<SessionWorkLink | null>> {
  const ownLink = (lines: readonly { session: SessionRef; link: SessionWorkLink; duty: string }[]) => lines.find((line) =>
    line.duty === duty && line.session.projectId === session.projectId && line.session.sessionId === session.sessionId)?.link
    ?? null;
  const onGoal = await readOpenResponsibilityLines(deps.records, ctx, { goalRef }, deps.duty);
  if (onGoal.status !== 'ready') return onGoal;
  const goalLink = ownLink(onGoal.value);
  if (goalLink !== null || duty === 'adviser') return { status: 'ready', value: goalLink };
  const onProject = await readOpenResponsibilityLines(deps.records, ctx, { projectScope: goalRef.projectId }, deps.duty);
  if (onProject.status !== 'ready') return onProject;
  return { status: 'ready', value: ownLink(onProject.value) };
}

/** 准入：前两条，加职责是秘书或参谋、负责这个目标；给了工具名再核这一轮冻结的授予。 */
export async function admitActionRound(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'records' | 'queryRounds' | 'duty'>, goalRef: GoalRef,
  action: string, grantTool?: string,
): Promise<{ status: 'ready'; value: ActionRoundAdmissionV1 } | CoreRejection> {
  const resolved = await resolveActionRound(ctx, deps, action, grantTool);
  return resolved.status !== 'ready' ? resolved : admitResolvedRound(ctx, deps, goalRef, resolved.value, action);
}

/** 秘书请求轮的当前归属：请求根、请求生效的目标、现在的主人、最后一轮的版本，和这次读到的全部请求事实守卫。 */
async function readRequestOwner(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'records'>, round: QueryRoundV1,
): Promise<{ status: 'ready'; requestRoot: QueryJobRef; goalId: string | null; owner: SessionRef | null;
  tail: { ref: QueryJobRef; revision: number }; guards: RecordGuard[] } | CoreRejection> {
  // 请求根是 `resolveQueryRound` 已经读到的同一条 QueryJob 上的事实，这里不再按同一个键重读一遍。
  const requestRoot = round.requestRoot;
  if (requestRoot === null) return rejected('unavailable', 'the request round QueryJob names no request root');
  const facts = await readRequestRounds(deps.records, ctx, { requestRoot });
  if (facts.status !== 'ready') return notReadyRejection(facts, 'the request facts');
  const tail = facts.value.tail;
  return { status: 'ready', requestRoot: { ...requestRoot }, goalId: facts.value.effectiveGoalId,
    owner: facts.value.owner, tail: { ref: { ...tail.ref }, revision: tail.revision }, guards: [...facts.value.guards] };
}

/**
 * 放下暂缓和叫停受理共用的来源解析（设计 3.3）：优先请求根（请求轮自己的，或来源消息自带的请求根），
 * 否则记这一轮的来源消息。读不到来源消息是 `unavailable`，不当成没有来源。
 */
export type HoldSourceV1 = {
  requestRoot: QueryJobRef | null;
  sourceMessage: QueryRoundV1['sourceMessageRef'];
};

export async function holdSourceOf(
  ctx: CoreCallContext, records: Pick<ClaimHoldDependencies, 'records'>,
  round: Pick<QueryRoundV1, 'sourceMessageRef'>, requestRoot: QueryJobRef | null,
): Promise<{ status: 'ready'; value: HoldSourceV1 } | CoreRejection> {
  const requestRootOf = (value: QueryJobRef | null) => value === null ? null : { ...value };
  if (requestRoot !== null) {
    return { status: 'ready', value: { requestRoot: requestRootOf(requestRoot),
      sourceMessage: round.sourceMessageRef === null ? null : { ...round.sourceMessageRef } } };
  }
  const source = round.sourceMessageRef;
  if (source === null) return { status: 'ready', value: { requestRoot: null, sourceMessage: null } };
  const read = await storedMessageRequestRoot(records.records, source);
  if (!read.ok) return 'rejection' in read ? read.rejection
    : rejected('unavailable', 'the round source message is not stored');
  return { status: 'ready', value: { requestRoot: requestRootOf(read.value), sourceMessage: { ...source } } };
}

/**
 * 一条已存消息带的请求根（设计 3.3：转手的信带着同一个请求根）：读这条消息，取它的 `requestRoot`（没有是 `null`）。
 * 放暂缓、叫停受理、领取推暂缓失效和原请求反馈共用这一份读；读不到、没存下由调用方各自处理：放暂缓按原拒绝
 * （`unavailable`），领取侧不证明失效。
 */
export async function storedMessageRequestRoot(
  store: Pick<GoalRecordTransactionPort, 'readMany'>, message: SessionMessageRef,
): Promise<OwnerRecordRead<QueryJobRef | null>> {
  const read = await readOwnerRecord({ store, refKey: canonicalKey(message), decode: decodeSessionMessageRecord,
    readError: (reason) => rejected('unavailable', `the source message cannot be read: ${reason}`) });
  return read.ok ? { ok: true, value: read.value.requestRoot } : read;
}

/**
 * 请求轮的准入：这一轮必须是请求当前的秘书（按请求事实的当前归属版本守）；别的轮照旧认负责链接。
 * `placingSession` 只给点名撤用：放的线就是这一轮时，请求归属本身已经是撤权依据，任务在另一个目标也不再另要目标职责。
 */
async function admitResolvedRound(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'records' | 'duty'>, goalRef: GoalRef, round: QueryRoundV1,
  action: string, placingSession?: SessionRef | null,
): Promise<{ status: 'ready'; value: ActionRoundAdmissionV1 } | CoreRejection> {
  const duty = round.duty;
  if (duty !== 'secretary' && duty !== 'adviser') return rejected('forbidden', `only a secretary or adviser line may ${action}`);
  if (goalRef.projectId !== round.scope.projectId) return rejected('forbidden', 'the Task belongs to another project');
  if (round.requestRound) {
    if (duty !== 'secretary') return rejected('forbidden', `only the request's secretary may ${action}`);
    const current = await readRequestOwner(ctx, deps, round);
    if (current.status !== 'ready') return current;
    const owner = current.owner;
    if (owner === null || canonicalKey(owner) !== canonicalKey(round.session)) {
      return rejectedWithNonEmptyCurrent('revision_conflict', 'the request owner changed since that revision',
        [{ ref: current.tail.ref, revision: current.tail.revision }]);
    }
    const guards = [...round.guards, ...current.guards];
    // 请求轮管的是这条请求的目标；任务在另一个目标上时，项目范围的负责链接是唯一的跨目标依据，守它。
    // 点名撤自己放下的原因时例外：请求当前归属已经核过，放置线的撤权不要求再去证明目标职责。
    const placedHere = placingSession !== undefined && placingSession !== null
      && canonicalKey(placingSession) === canonicalKey(round.session);
    if (current.goalId !== goalRef.goalId && !placedHere) {
      const link = await responsibleLinkOf(ctx, deps, goalRef, round.session, duty);
      if (link.status !== 'ready') return notReadyRejection(link, 'the responsibility links');
      if (link.value === null) {
        return rejected('forbidden', `the caller line is not responsible for this Goal; it may not ${action}`);
      }
      guards.push({ refKey: canonicalKey(link.value.ref), expectedRevision: link.value.revision });
    }
    return { status: 'ready', value: { round, duty, guards, requestRoot: current.requestRoot } };
  }
  const link = await responsibleLinkOf(ctx, deps, goalRef, round.session, duty);
  if (link.status !== 'ready') return notReadyRejection(link, 'the responsibility links');
  if (link.value === null) {
    return rejected('forbidden', `the caller line is not responsible for this Goal; it may not ${action}`);
  }
  return { status: 'ready', value: { round, duty, guards: [...round.guards,
    { refKey: canonicalKey(link.value.ref), expectedRevision: link.value.revision }], requestRoot: null } };
}

/**
 * 问答轮请求者的 actor（Q10a）：按线派生的 agent 号（`lineAgentIdOf`，和这条线做事轮的 agent 同号）加这一轮的 QueryRun。
 * 动作请求和返工请求的请求者都经这一处取。
 */
export function queryRoundActorOf(round: Pick<QueryRoundV1, 'session' | 'run'>): QueryRoundActorV1 {
  return { kind: 'agent', id: lineAgentIdOf(round.session), queryRunRef: { ...round.run } };
}

/** 问答轮那一臂的请求者（`AGENT_REQUESTER_FIELD`）：这一轮的 actor、线的 Session、QueryRun、职责。 */
export function queryRoundRequesterOf(actor: QueryRoundActorV1, session: SessionRef, duty: 'secretary' | 'adviser'):
  Extract<ActionRequestRequesterV1, { kind: 'query_run' }> {
  return { kind: 'query_run', actor: { ...actor, queryRunRef: { ...actor.queryRunRef } }, session: { ...session },
    queryRun: { ...actor.queryRunRef }, duty };
}

/**
 * 返工、重验的问答轮口（2.8，Q7a 照参谋那条）：只收负责这个目标的参谋的规划轮。前几条同派活的准入（问答轮、非副本、非
 * 秘书请求轮、负责这个目标——参谋只认目标链接），再要职责是参谋、形状是 `plan_round`。各条 forbidden 都改写成同一句
 * （含 `adviser planning round`，后面带原因），读不出的照原样。授予在挂工具时核（Q1a）。
 */
export async function admitPlanningRework(
  ctx: CoreCallContext, deps: Pick<ClaimHoldDependencies, 'records' | 'queryRounds' | 'duty'>, goalRef: GoalRef,
  action: string,
): Promise<{ status: 'ready'; value: ActionRoundAdmissionV1 } | CoreRejection> {
  const planningRefusal = (detail: string) =>
    rejected('forbidden', `only an adviser planning round responsible for this Goal may ${action} (${detail})`);
  const admitted = await admitActionRound(ctx, deps, goalRef, action);
  if (admitted.status !== 'ready') return admitted.code === 'forbidden' ? planningRefusal(admitted.reason) : admitted;
  if (admitted.value.duty !== 'adviser') return planningRefusal(`this is a ${admitted.value.duty} line`);
  if (admitted.value.round.shape !== 'plan_round') return planningRefusal('this round is not a planning round');
  return admitted;
}

// -------------------------------------------------------------------------- //
// 共用的读                                                                    //
// -------------------------------------------------------------------------- //

/** 读不出的不当真：`not_found`、`not_ready` 也是这次读不到。 */
export function notReadyRejection(read: Exclude<ReadResult<unknown>, { status: 'ready' }>, what: string): CoreRejection {
  return read.status === 'rejected' ? read : rejected('unavailable', `${what} cannot be read`);
}

/** 一个任务的暂缓记录（不存在是 `null`）和提交守它的那一条（不存在时守“仍不存在”）。 */
export async function readTaskClaimHold(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, task: TaskTriple,
): Promise<{ status: 'ready'; hold: TaskClaimHoldV1 | null; guard: RecordGuard } | CoreRejection> {
  const refKey = canonicalKey(taskClaimHoldRefOf(task));
  const read = await readOwnerRecord({ store: records, refKey, decode: taskClaimHoldCodec.decode,
    readError: (message) => rejected('unavailable', `the claim hold cannot be read: ${message}`) });
  if ('rejection' in read) return read.rejection;
  const hold = 'notFound' in read ? null : read.value;
  return { status: 'ready', hold, guard: { refKey, expectedRevision: hold?.revision ?? null } };
}

/**
 * §2.8/T37、S-2：一个项目的全部暂缓记录，按项目索引分页读到底（暂缓记录的工作区是任务所属 Goal 的，项目秘书可以
 * 给另一工作区的任务放）。请求反馈再按各原因的完整请求根筛，不另扫计划里的任务。解不开的记录是 `unavailable`，
 * 不当成没有。
 */
export async function readTaskClaimHoldsInProject(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>, projectId: string,
): Promise<{ status: 'ready'; holds: TaskClaimHoldV1[] } | CoreRejection> {
  let batch;
  try {
    batch = await lookupAll(records, TASK_CLAIM_HOLD_BY_PROJECT_LOOKUP, [projectId]);
  } catch (failure) {
    return storeFailureToRejection(failure);
  }
  const holds: TaskClaimHoldV1[] = [];
  for (const record of batch.items) {
    const decoded = taskClaimHoldCodec.decode(record);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the claim hold ${record.refKey} cannot be read: ${decoded.reason}`);
    }
    holds.push(decoded.value);
  }
  return { status: 'ready', holds };
}

/** 目标和它已采用计划里的这个任务；暂缓只放在计划里、启用的任务上（1.3 `hold_claim` 一行“→ 图”）。 */
async function readPlannedTask(
  records: GoalRecordTransactionPort, task: TaskTriple,
): Promise<{ status: 'ready'; goal: GoalSnapshot; task: RuntimeTask } | CoreRejection> {
  const window = await readGoalPlanWindow(records, goalRefFor(task.projectId, task.goalId));
  if (window.status !== 'ready') return window;
  const planned = window.plan?.tasks.find((candidate) => candidate.taskId === task.taskId);
  if (planned === undefined) return rejected('invalid', 'the Task is not in the accepted plan');
  if (planned.disposition !== 'active') return rejected('invalid', `the Task is not active (${planned.disposition})`);
  return { status: 'ready', goal: window.goal, task: planned };
}

export function taskRefProblem(value: unknown): string | null {
  return checkShape(TaskTripleShape, value, 'stored') === null ? null : 'taskRef must be a complete TaskTriple';
}

/** 非空理由（3.3“非空”）。 */
export function blankTextProblem(value: unknown, label = 'reason'): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? null : `${label} must be a non-empty string`;
}

/** 动作口的写请求：输入和 `meta` 先和调用方隔开（同一个 `isolatedWriteOf`）。 */
export function isolateActionWrite<T>(request: GraphWrite<T>, label: string) {
  return isolatedWriteOf<T>(request, { label, reject: (code: CoreError, reason: string) => rejected(code, reason),
    cannotIsolate: `the ${label} request cannot be isolated from the caller` });
}

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }

// -------------------------------------------------------------------------- //
// 暂缓 owner                                                                   //
// -------------------------------------------------------------------------- //

type HoldChange = {
  current: TaskClaimHoldV1 | null;
  next: PendingTaskClaimHoldV1;
  guards: RecordGuard[];
  change: HoldChangeKind;
  reasonId: string | null;
};
type HoldChangeKind = TaskClaimHoldChanged['change'];
type HoldRefusal = CoreRejection | { unchanged: ClaimHoldWriteV1 };

export function createClaimHoldService(deps: ClaimHoldDependencies): ClaimHoldPort {
  const records = deps.records;

  /** 暂缓的一次写：身份先定（原因号取这次命令的身份），读、判、写一次提交；原样回不写。 */
  async function writeHold<Facts>(ctx: CoreCallContext, input: {
    operation: string; commandId: string; fingerprintInput: JsonValue;
    read(): Promise<{ status: 'ready'; facts: Facts } | CoreRejection>;
    change(facts: Facts, keys: Keys): HoldChange | HoldRefusal;
  }): Promise<ClaimHoldResultV1> {
    const scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null };
    const principal = principalIdentity(ctx.principal);
    const keys = commandKeys({ operation: input.operation, scope, principal, commandId: input.commandId,
      fingerprintInput: input.fingerprintInput });
    const result = await executeWriteCommand<Facts, HoldChange, HoldRefusal, TaskClaimHoldChanged, ClaimHoldWriteV1>(records, {
      operation: input.operation, scope, principal, commandId: input.commandId, fingerprintInput: input.fingerprintInput,
      read: input.read,
      decide: (facts) => {
        const decided = input.change(facts, keys);
        return 'next' in decided ? { decision: decided } : { refuse: decided };
      },
      build: (change, committed) => {
        const refKey = canonicalKey(change.next.ref);
        const event: TaskClaimHoldChanged = { eventId: deps.eventId(), eventType: 'TaskClaimHoldChanged', schemaVersion: 1,
          occurredAt: deps.now(), identityKey: committed.identityKey, fingerprint: committed.fingerprint,
          change: change.change, hold: change.next.ref, revision: change.next.revision, reasonId: change.reasonId };
        return {
          guards: [...change.guards, { refKey, expectedRevision: change.current?.revision ?? null }],
          records: [taskClaimHoldCodec.encode(change.next)],
          claims: [],
          events: [taskClaimHoldChangedCodec.encode(event)],
          ...(holdAwaitsCursor(change.next) ? { commitCursorBindings: [{ refKey, field: 'reasons[].since' as const }] } : {}),
        };
      },
      result: {
        eventType: 'TaskClaimHoldChanged', schemaVersion: 1, decode: taskClaimHoldChangedCodec.decode,
        validate: (decoded, _receipt, committed) => decoded.identityKey === committed.identityKey
          && decoded.fingerprint === committed.fingerprint ? null : 'the claim hold change does not match the receipt',
        project: (decoded) => ({ hold: decoded.hold, revision: decoded.revision, reasonId: decoded.reasonId }),
      },
    });
    if (result.status === 'committed') return result;
    if (result.status === 'refused') {
      return 'unchanged' in result.refusal ? { status: 'unchanged', value: result.refusal.unchanged } : result.refusal;
    }
    return result;
  }

  /** 放一个原因的共同部分：计划里启用的任务、读暂缓、同来源原样回，否则放下（原因号取这次命令的身份）。 */
  function placed(
    facts: { goal: GoalSnapshot; hold: { hold: TaskClaimHoldV1 | null; guard: RecordGuard } }, task: TaskTriple,
    reason: Omit<NewHoldReasonV1, 'id' | 'since'>, guards: RecordGuard[], keys: Keys,
  ): HoldChange | HoldRefusal {
    const current = facts.hold.hold;
    const draft = nextTaskClaimHold(current, { ref: taskClaimHoldRefOf(task), workspaceId: facts.goal.workspaceRef.workspaceId });
    const put = placeHoldReason(draft, { ...reason, id: keys.identityKey, since: null });
    if (!put.placed) {
      return { unchanged: { hold: draft.ref, revision: current?.revision ?? 0, reasonId: put.reasonId } };
    }
    return { current, next: put.hold, guards, change: 'placed', reasonId: put.reasonId };
  }

  async function place(ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple; reason: string }>): Promise<ClaimHoldResultV1> {
    const owned = isolateActionWrite(request, 'claim hold');
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const problem = taskRefProblem(input.taskRef) ?? blankTextProblem(input.reason);
    if (problem !== null) return invalid(problem);
    const task: TaskTriple = { projectId: input.taskRef.projectId, goalId: input.taskRef.goalId, taskId: input.taskRef.taskId };
    const goalRef: GoalRef = goalRefFor(task.projectId, task.goalId);
    return writeHold(ctx, {
      operation: 'claim_hold.place', commandId: owned.requestId, fingerprintInput: { taskRef: task, reason: input.reason },
      read: async () => {
        const admission = await admitActionRound(ctx, deps, goalRef, 'hold a Task claim', 'hold_claim');
        if (admission.status !== 'ready') return admission;
        const planned = await readPlannedTask(records, task);
        if (planned.status !== 'ready') return planned;
        const hold = await readTaskClaimHold(records, task);
        if (hold.status !== 'ready') return hold;
        const source = await holdSourceOf(ctx, deps, admission.value.round, admission.value.requestRoot);
        if (source.status !== 'ready') return source;
        return { status: 'ready', facts: { admission: admission.value, goal: planned.goal, hold, source: source.value } };
      },
      change: (facts, keys) => {
        const round = facts.admission.round;
        // 守读到的目标版本：核“已采用计划里、启用”的是同一次读，之后采用新计划取消了这个任务就冲突。
        return placed(facts, task, {
          kind: 'agent',
          placedBy: { kind: 'agent', session: { ...round.session }, queryRun: { ...round.run }, duty: facts.admission.duty },
          basis: { kind: 'round', requestRoot: facts.source.requestRoot, sourceMessage: facts.source.sourceMessage,
            round: { ...round.round } },
          reason: input.reason, placedAt: deps.now(),
        }, [...facts.admission.guards, { refKey: canonicalKey(facts.goal.ref), expectedRevision: facts.goal.revision }], keys);
      },
    });
  }

  async function placeScribeStop(ctx: CoreCallContext, request: GraphWrite<ScribeStopInputV1>): Promise<ClaimHoldResultV1> {
    if (ctx.principal.kind !== 'host' || !isAutomationActor(ctx.principal.actor)) {
      return rejected('forbidden', 'only the platform automation may place a scribe stop');
    }
    const owned = isolateActionWrite(request, 'scribe stop');
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const problem = taskRefProblem(input.taskRef) ?? blankTextProblem(input.reason)
      ?? (checkShape(SessionMessageRefShape, input.sourceMessage, 'stored') === null ? null
        : 'sourceMessage must be a complete SessionMessageRef')
      ?? (checkShape(RunRefShape, input.run, 'stored') === null ? null : 'run must be a complete RunRef')
      ?? (nonEmpty(input.operationId) ? null : 'operationId must be a non-empty string');
    if (problem !== null) return invalid(problem);
    const task: TaskTriple = { projectId: input.taskRef.projectId, goalId: input.taskRef.goalId, taskId: input.taskRef.taskId };
    return writeHold(ctx, {
      operation: 'claim_hold.scribe_stop', commandId: owned.requestId,
      fingerprintInput: { taskRef: task, reason: input.reason, sourceMessage: input.sourceMessage as unknown as JsonValue,
        run: input.run as unknown as JsonValue, operationId: input.operationId },
      read: async () => {
        const planned = await readPlannedTask(records, task);
        if (planned.status !== 'ready') return planned;
        const hold = await readTaskClaimHold(records, task);
        if (hold.status !== 'ready') return hold;
        return { status: 'ready', facts: { goal: planned.goal, hold } };
      },
      // 同 `place`：守读到的目标版本，之后采用新计划取消了这个任务就冲突。
      change: (facts, keys) => placed(facts, task, {
        kind: 'scribe_stop',
        placedBy: { kind: 'platform', operationId: input.operationId },
        basis: { kind: 'scribe', sourceMessage: { ...input.sourceMessage }, run: { ...input.run } },
        reason: input.reason, placedAt: deps.now(),
      }, [{ refKey: canonicalKey(facts.goal.ref), expectedRevision: facts.goal.revision }], keys),
    });
  }

  /**
   * 点名撤的权利（重裁 5）：`agent`、`stop` 是放的线（叫停原因看请求方那条线），或这个目标任一秘书、参谋；`scribe_stop`
   * 只认负责这块的参谋（Q7b：和书记审查同一读法，只读不守）。守这一轮的版本，按目标准入的另守收下它的链接。
   */
  async function releaseRight(
    ctx: CoreCallContext, task: TaskTriple, reason: TaskClaimHoldV1['reasons'][number],
  ): Promise<{ status: 'ready'; session: SessionRef; guards: RecordGuard[] } | CoreRejection> {
    const goalRef: GoalRef = goalRefFor(task.projectId, task.goalId);
    const resolved = await resolveActionRound(ctx, deps, 'release a claim hold', 'release_hold');
    if (resolved.status !== 'ready') return resolved;
    const round = resolved.value;
    const isCaller = (session: SessionRef) => session.projectId === round.session.projectId
      && session.sessionId === round.session.sessionId;
    // 普通原因的放置线：叫停原因看请求方那条线。书记原因不按放置线撤。
    let placer: SessionRef | null = reason.kind === 'scribe_stop' ? null
      : reason.placedBy.kind === 'agent' ? reason.placedBy.session : null;
    if (reason.kind !== 'scribe_stop' && reason.placedBy.kind === 'action') {
      const request = await readActionRequestRecord(records, reason.placedBy.actionRef);
      if (request.status !== 'ready') return request;
      placer = request.record?.requester.session ?? null;
    }
    // 秘书请求轮按请求的当前归属准入（Q7c）；普通原因由当前秘书点名撤，书记原因仍只认负责参谋。
    if (round.requestRound && reason.kind !== 'scribe_stop') {
      const admitted = await admitResolvedRound(ctx, deps, goalRef, round, 'release a claim hold', placer);
      if (admitted.status !== 'ready') {
        return admitted.code === 'forbidden'
          ? rejected('forbidden', 'this line may not release a claim hold reason it did not place; only the placing line or '
            + 'this Goal\'s secretary or adviser may')
          : admitted;
      }
      return { status: 'ready', session: round.session, guards: [...admitted.value.guards] };
    }
    if (reason.kind === 'scribe_stop') {
      // 负责这块的参谋：任务的模块范围先找最窄的区域参谋，否则目标的参谋（`command-review.ts` 的同一读法）。
      const window = await readGoalPlanWindow(records, goalRef);
      if (window.status !== 'ready') return window;
      const scope = window.plan?.tasks.find((candidate) => candidate.taskId === task.taskId)?.scope;
      const adviser = await deps.recipients.resolveResponsibilityRecipient(ctx, { projectId: task.projectId, goalRef,
        moduleRef: scope?.kind === 'module' ? { projectId: task.projectId, moduleId: scope.moduleRef } : null,
        kind: 'technical', asker: null });
      if (adviser.status !== 'ready') return notReadyRejection(adviser, 'the responsible adviser');
      if (adviser.value.kind !== 'session' || !isCaller(adviser.value.session)) {
        return rejected('forbidden', 'only the responsible adviser of this part may release a scribe stop; ask that adviser or the person');
      }
      // 不变量：asker:null 时 session 臂必带参与选择的那条链接（区域参谋给它的模块链接，目标参谋给目标链接；
      // 创建者臂因 asker:null 不会出现），所以这里不需要再判一次 null。
      const link = adviser.value.link!;
      // 点名撤的提交守选中那条负责链接的版本：读和提交之间它关闭或换手，这条撤就不成立。
      return { status: 'ready', session: round.session, guards: [...round.guards,
        { refKey: canonicalKey(link.ref), expectedRevision: link.revision }] };
    }
    if (placer !== null && isCaller(placer)) return { status: 'ready', session: round.session, guards: [...round.guards] };
    const admission = await admitResolvedRound(ctx, deps, goalRef, round, 'release a claim hold');
    if (admission.status !== 'ready') {
      return admission.code === 'forbidden'
        ? rejected('forbidden', 'this line may not release a claim hold reason it did not place; only the placing line or '
          + 'this Goal\'s secretary or adviser may')
        : admission;
    }
    return { status: 'ready', session: round.session, guards: admission.value.guards };
  }

  async function releaseReason(
    ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple; reasonId: string; note?: string }>,
  ): Promise<ClaimHoldResultV1> {
    const owned = isolateActionWrite(request, 'claim hold release');
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const problem = taskRefProblem(input.taskRef) ?? (nonEmpty(input.reasonId) ? null : 'reasonId must be a non-empty string')
      ?? (input.note === undefined ? null : blankTextProblem(input.note, 'note'));
    if (problem !== null) return invalid(problem);
    const task: TaskTriple = { projectId: input.taskRef.projectId, goalId: input.taskRef.goalId, taskId: input.taskRef.taskId };
    return writeHold(ctx, {
      operation: 'claim_hold.release', commandId: owned.requestId,
      fingerprintInput: { taskRef: task, reasonId: input.reasonId, note: input.note ?? null },
      read: async () => {
        const hold = await readTaskClaimHold(records, task);
        if (hold.status !== 'ready') return hold;
        const reason = hold.hold?.reasons.find((candidate) => candidate.id === input.reasonId);
        if (hold.hold === null || reason === undefined) return rejected('not_found', 'the claim hold has no such reason');
        const right = await releaseRight(ctx, task, reason);
        if (right.status !== 'ready') return right;
        return { status: 'ready', facts: { current: hold.hold, right } };
      },
      change: (facts) => {
        const current = facts.current;
        const draft = nextTaskClaimHold(current, { ref: current.ref, workspaceId: current.workspaceId });
        const by: HoldReleasedByV1 = { kind: 'agent', session: { ...facts.right.session } };
        const released = releaseHoldReason(draft, input.reasonId, by, input.note ?? null);
        // 读时已核过有这个原因。
        if (released === null || !released.released) {
          return { unchanged: { hold: current.ref, revision: current.revision, reasonId: input.reasonId } };
        }
        return { current, next: released.hold, guards: facts.right.guards, change: 'released', reasonId: input.reasonId };
      },
    });
  }

  async function releaseAll(ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple }>): Promise<ClaimHoldResultV1> {
    const action = 'release every claim hold reason of a Task';
    if (ctx.principal.kind !== 'host') return rejected('forbidden', `only the configured operator may ${action}`);
    const operator = operatorProblem(ctx.principal.actor, deps.operatorActor, action);
    if (operator !== null) return operator;
    const actor = ctx.principal.actor;
    const owned = isolateActionWrite(request, 'claim hold release');
    if (!owned.ok) return owned.rejection;
    const problem = taskRefProblem(owned.input.taskRef);
    if (problem !== null) return invalid(problem);
    // 回执身份按 `ctx.projectId` 算，管不住实际读写的记录键：别的项目的引用在查回执、读写之前就拒。
    if (owned.input.taskRef.projectId !== ctx.projectId) {
      return rejected('forbidden', 'the Task belongs to another project; this call may not change another project\'s records');
    }
    const task: TaskTriple = { projectId: owned.input.taskRef.projectId, goalId: owned.input.taskRef.goalId,
      taskId: owned.input.taskRef.taskId };
    return writeHold(ctx, {
      operation: 'claim_hold.release_all', commandId: owned.requestId, fingerprintInput: { taskRef: task },
      read: async () => {
        const hold = await readTaskClaimHold(records, task);
        return hold.status !== 'ready' ? hold : { status: 'ready', facts: hold.hold };
      },
      change: (current) => {
        if (current === null || !current.reasons.some((reason) => reason.state === 'held')) {
          return { unchanged: { hold: taskClaimHoldRefOf(task), revision: current?.revision ?? 0, reasonId: null } };
        }
        const draft = nextTaskClaimHold(current, { ref: current.ref, workspaceId: current.workspaceId });
        const next = releaseAllHoldReasons(draft, { kind: 'person', actor: { kind: actor.kind, id: actor.id } });
        return { current, next, guards: [], change: 'released_all', reasonId: null };
      },
    });
  }

  async function readHold(ctx: CoreCallContext, input: { taskRef: TaskTriple }): Promise<ReadResult<TaskClaimHoldV1>> {
    if (!isRecord(input)) return invalid('readHold requires { taskRef }');
    const problem = taskRefProblem(input.taskRef);
    if (problem !== null) return invalid(problem);
    if (input.taskRef.projectId !== ctx.projectId) return rejected('forbidden', 'the claim hold belongs to another project');
    const read = await readTaskClaimHold(records, input.taskRef);
    if (read.status !== 'ready') return read;
    if (read.hold === null) return { status: 'not_found' };
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== read.hold.workspaceId) {
      return rejected('forbidden', 'the claim hold belongs to another workspace');
    }
    return { status: 'ready', value: read.hold };
  }

  return { place, placeScribeStop, release: releaseReason, releaseAll, readHold };
}
