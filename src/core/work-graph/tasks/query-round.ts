/**
 * 问答轮可信身份的一处读链（`model/query-round-contracts.ts`）和它的解析器 `resolveQueryRound`。
 *
 * 读链两段，规划解析器（`planning-query-run.ts`）和这里共用同一份：
 * - `readRoundExecution`：QueryRun 单条读 → 已进入的执行状态 → QueryJob 意图 → 按 `bundleRef`/`inputDigest` 绑定的
 *   manifest。它从不把字段抄到 QueryRun 上。
 * - `readRoundSessionDuty`：本轮 Session 记录和它的角色读出的职责。
 * 两段的读序和拒绝原文就是规划解析器原来那几行，搬到这里不改一字。
 *
 * `resolveQueryRound` 只读身份、不准入，所以它不依赖邮箱（规划解析器依赖邮箱，邮箱又要用这里，反过来会成环）。
 * 文件放在 `tasks/`：它读 `queries/` 和 `sessions/`，`communication/` 可以依赖 `tasks/`，反过来不行。
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { SessionRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import { isPos } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { QueryRoundPort, QueryRoundV1 } from '../model/query-round-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { QueryExecutionDependencies } from '../queries/contracts.js';
import { loadQueryManifest } from '../queries/query-execution.js';
import { decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';

export type QueryRoundDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
  duties: SessionDutyReadPort;
  /** manifest 从这个原始正文存储读（Query 执行用的同一个）。 */
  bodies: QueryExecutionDependencies['bodies'];
};

const unavailable = (reason: string): CoreRejection => rejected('unavailable', reason);

/**
 * 共用读链的第一段：QueryRun 单条读、它已进入的执行状态、QueryJob 的 `intent.execution`、按
 * `prepared.bundleRef`/`inputDigest` 绑定的 manifest。不在是 `notFound`，没进入是 `notEntered`，读失败是 `failed`。
 */
export async function readRoundExecution(
  deps: Pick<QueryRoundDependencies, 'records' | 'bodies'>, queryRunRef: QueryRunRef,
) {
  const runRead = await readOwnerRecord({ store: deps.records,
    refKey: canonicalJson(queryRunRef as unknown as JsonValue),
    decode: decodeQueryRunSnapshotRecord, readError: unavailable });
  if (!runRead.ok) {
    return 'notFound' in runRead
      ? { status: 'notFound' as const }
      : { status: 'failed' as const, rejection: runRead.rejection };
  }
  const run = runRead.value;
  const execution = run.run.executionState;
  if (execution === undefined || execution.phase !== 'entered' || execution.prepared === null) {
    return { status: 'notEntered' as const, run };
  }
  const jobRead = await readOwnerRecord({ store: deps.records,
    refKey: canonicalJson(run.run.queryJobRef as unknown as JsonValue),
    decode: decodeQueryJobSnapshot, readError: unavailable });
  if (!jobRead.ok) {
    return 'notFound' in jobRead
      ? { status: 'failed' as const, rejection: unavailable('the round QueryJob is not stored') }
      : { status: 'failed' as const, rejection: jobRead.rejection };
  }
  const job = jobRead.value;
  const bound = await loadQueryManifest(deps.bodies, { queryRunRef,
    bundleRef: execution.prepared.bundleRef, inputDigest: execution.prepared.inputDigest });
  if (bound.status !== 'ready') {
    return { status: 'failed' as const,
      rejection: unavailable(`the round manifest cannot be read: ${'reason' in bound ? bound.reason : bound.status}`) };
  }
  return { status: 'read' as const, run, execution, job: job.job, manifest: bound.value.manifest };
}

export type RoundExecutionRead = Extract<Awaited<ReturnType<typeof readRoundExecution>>, { status: 'read' }>;

/** 读链冻结的那几个事实：哪条线、哪一轮、哪个工作区、准备时的目标和计划、Session 代数。 */
export function roundFactsOf(principal: Extract<CorePrincipal, { kind: 'query_run' }>, read: RoundExecutionRead):
  Pick<QueryRoundV1, 'principal' | 'session' | 'scope' | 'round' | 'run' | 'effectiveGoalId' | 'planRef' | 'sessionGeneration'> {
  const { run, execution, manifest } = read;
  return {
    principal,
    session: execution.sessionRef,
    scope: { projectId: run.ref.projectId, workspaceId: run.ref.workspaceId },
    round: run.run.queryJobRef,
    run: principal.queryRunRef,
    effectiveGoalId: manifest.goal === null ? null : manifest.goal.ref.goalId,
    planRef: manifest.focusPlan === null ? null : manifest.focusPlan.ref,
    sessionGeneration: execution.sessionGeneration,
  };
}

/** 共用读链的第二段：本轮 Session 记录和它的角色读出的职责；缺、读不到都是 `unavailable`。 */
export async function readRoundSessionDuty(
  ctx: CoreCallContext, deps: Pick<QueryRoundDependencies, 'records' | 'duties'>, sessionRef: SessionRef,
): Promise<{ status: 'ready'; session: SessionRecord; duty: PlatformDutyV1 | 'unknown' } | CoreRejection> {
  const sessionRead = await readOwnerRecord({ store: deps.records,
    refKey: sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef)),
    decode: decodeSessionRecord, readError: unavailable });
  if (!sessionRead.ok) {
    return unavailable('notFound' in sessionRead ? 'the round Session is missing'
      : `the round Session cannot be read: ${sessionRead.rejection.reason}`);
  }
  let dutyRead;
  try {
    dutyRead = await deps.duties(sessionRead.value.role, ctx);
  } catch {
    return unavailable('the round Session duty cannot be read');
  }
  if (dutyRead.status !== 'ready') return unavailable('the round Session duty cannot be read');
  return { status: 'ready', session: sessionRead.value, duty: dutyRead.value };
}

/** 问答轮身份：只读，不判谁能做什么（见文件头）。 */
async function resolveQueryRound(
  ctx: CoreCallContext, deps: QueryRoundDependencies,
): Promise<{ status: 'ready'; value: QueryRoundV1 } | CoreRejection> {
  const principal = ctx.principal;
  if (principal.kind !== 'query_run') return rejected('forbidden', 'only a running QueryRun has a query round identity');
  const read = await readRoundExecution(deps, principal.queryRunRef);
  if (read.status === 'notFound') return rejected('forbidden', 'the caller QueryRun is not the stored running round');
  if (read.status === 'failed') return read.rejection;
  if (read.status === 'notEntered') return rejected('forbidden', 'the QueryRun is not entered');
  const { run, execution, job, manifest } = read;
  // 共用解码器不判 `requestProfile` 缺、代数和 Session 引用；身份里的“是不是请求轮”和守的 Session 都靠它们。
  if (execution.requestProfile === undefined || !isPos(execution.sessionGeneration)
    || checkShape(SessionRefShape, execution.sessionRef, 'stored') !== null) {
    return unavailable('the QueryRun binding is damaged');
  }
  const line = await readRoundSessionDuty(ctx, deps, execution.sessionRef);
  if (line.status !== 'ready') return line;
  const intent = job.intent.execution;
  return { status: 'ready', value: {
    ...roundFactsOf(principal, read),
    duty: line.duty,
    requestRoot: job.requestRoot === null ? null : { ...job.requestRoot },
    shape: manifest.answerShape,
    sourceMessageRef: intent.kind === 'intervention_planning' && intent.sourceMessageRef !== undefined
      ? { ...intent.sourceMessageRef } : null,
    readOnlyCopy: line.session.provenance.kind === 'readonly_copy',
    requestRound: execution.requestProfile !== null,
    lineWorkspaceId: line.session.workspaceId,
    // The same manifest read this function already did carries the round's frozen final tool list (prepared and
    // start-verified); the action owner checks its own name against it (Q1a) without a second manifest read.
    grantedToolNames: [...manifest.promptSet.toolNames],
    guards: [
      { refKey: canonicalJson(principal.queryRunRef as unknown as JsonValue), expectedRevision: run.revision },
      { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(execution.sessionRef)),
        expectedRevision: line.session.revision },
    ],
  } };
}

export function createQueryRoundResolver(deps: QueryRoundDependencies): QueryRoundPort {
  return { resolveQueryRound: (ctx: CoreCallContext) => resolveQueryRound(ctx, deps) };
}
