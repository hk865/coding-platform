import { ControlReworkDisposition } from '../../src/control/control-engine/rework-disposition.js';
/**
 * 共享夹具：真实账本 + 真实 ControlEngine + **真实** VerificationOpenIssues 投影 + 真实驱动。
 *
 * 为什么问题不自己拼：未处置问题的形状、时效标注与结构化失败事实都由 VerificationEngine 的
 * 只读投影（VerificationOpenIssues）产出。夹具只负责把「一轮真实的 FAIL 轮次」按
 * CommandCheckProvider 真正持久化的形状写进真实 journal 目录，然后把**产品同一个**投影当作
 * ReworkIssueReadPort 交给组合根，再把读取的材料传入驱动。因此这里验证的是「真投影 → 真编译器 → 真受理入口 → 真账本」，
 * 而不是测试自己拼出来的问题对象。
 */
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { ReworkIssueReadPort } from '../../src/harness/rework-composition.js';
import type { CommandCheckRecord } from '../../src/contracts/verification-service.js';
import type { VerificationRoundCoverage, VerificationRoundRecord } from '../../src/contracts/verification-round.js';
import type { VerificationRoundScope } from '../../src/contracts/verification-context.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../src/contracts/artifact.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { VerificationJournal } from '../../src/control/verification-engine/verification-journal.js';
import { VerificationOpenIssues } from '../../src/control/verification-engine/verification-open-issues.js';
import { digest } from '../../src/control/verification-engine/verification-input.js';

export const ROUND_STARTED_AT = '2026-09-10T00:04:00.000Z';
export const ROUND_ENDED_AT = '2026-09-10T00:04:05.000Z';

export type JournalPort = {
  journal: VerificationJournal;
  port: ReworkIssueReadPort;
};

/**
 * 真实的未处置问题出口。投影只经一个**间接**的 ledger 取 Goal 的当前 active revision，
 * 因此 harness 重启（同一文件上的新 ledger 实例）之后仍然是同一份投影语义。
 */
export function reworkIssuesPort(input: {
  directory: string;
  current: () => Pick<StateLedger, 'load'>;
}): JournalPort {
  const journal = new VerificationJournal(input.directory);
  const projection = new VerificationOpenIssues({
    journal,
    disposition: new ControlReworkDisposition({ load: (ref: Parameters<StateLedger['load']>[0]) => input.current().load(ref) } as never),
  });
  return { journal, port: (request) => projection.openIssues(request) };
}

/**
 * 打开一个已初始化（从磁盘重建）的问题出口。重启路径用它证明问题由**持久事实**重建，
 * 而不是内存里的对象幸存下来。
 */
export async function openJournalPort(input: {
  directory: string;
  current: () => Pick<StateLedger, 'load'>;
}): Promise<JournalPort> {
  const result = reworkIssuesPort(input);
  await result.journal.init();
  return result;
}

export type FailRoundInput = {
  journal: VerificationJournal;
  scope: VerificationRoundScope;
  plan: PlanRevisionSnapshot;
  sourceDigest: string;
  /**
   * RC-01：result 取 'PASS' 表示"这一轮在当前 revision 上重验通过"。它存在的唯一理由是把
   * 「历史证据失效」与「问题已被处置（重验通过）」分开取证：只有重验通过的 FAIL 才不再是
   * 未处置问题，因此必须有办法造出这条真实形态的轮次记录。
   */
  check: { checkId: string; command: string; obligationId: string; requirementId: string; kind: 'static' | 'dynamic'; result?: 'PASS' | 'FAIL' | 'INCONCLUSIVE' };
  /**
   * true 表示这一轮引用了检查身份、但**没有**留下检查记录：投影因此给出"该要求没有产生结论"
   * （failure.result = null）。边界 (a) 必须拒绝这种失败要求作为自动返工的依据。
   */
  withoutCheckRecord?: boolean;
  /** 该轮已接纳的证据身份（必须与账本里真实 submitEvidence 的 evidenceId 一致）。 */
  evidenceId: string;
  requestId: string;
  roundId?: string;
};

/**
 * 追加一轮真实的工具 FAIL 轮次。字段与 CommandCheckProvider 真正持久化的两处形状一致：
 *   - 轮次记录：materialIdentity 冻结 plan/run/来源摘要，coverage 给出逐条要求结论；
 *   - 检查记录：progress 的 report_stored 阶段携带 category／result／artifactRef。
 * 报告正文只在有读取端口时才读，本夹具不注入读取端口，投影会如实记下"执行细节取不到"的缺口。
 */
export async function appendFailRound(input: FailRoundInput): Promise<void> {
  const result = input.check.result ?? 'FAIL';
  const checkRequestId = 'round-check-' + input.check.checkId + '-' + input.requestId;
  const coverageEntry: VerificationRoundCoverage = {
    obligationId: input.check.obligationId,
    requirementId: input.check.requirementId,
    kind: input.check.kind,
    checkIds: [input.check.checkId],
    result,
  };
  const requestId = input.requestId;
  const roundId = input.roundId ?? digest(canonicalJson([input.scope, requestId]));
  const reportBody = canonicalJson({
    schemaVersion: 1,
    observationId: 'observation-' + input.check.checkId,
    owner: { aggregateType: 'Run', projectId: input.scope.projectId, goalId: input.scope.goalId, runId: input.scope.runId },
    // 分类沿用 CommandCheckProvider 的真实取值口径：它描述"这条检查是怎么判定出来的"，
    // 因此 PASS 与 FAIL 都是 tool_check，只有没有结论时才是 timeout（见 command-check-provider.ts）。
    category: result === 'INCONCLUSIVE' ? 'timeout' : 'tool_check',
    result,
    effects: 'known',
    execution: null,
  });
  const reportRef: ArtifactRef = {
    kind: 'artifact',
    contentType: 'application/json',
    digest: artifactBodyDigest(reportBody),
    sizeBytes: artifactBodySize(reportBody),
    source: { kind: 'artifact', refId: 'report-' + checkRequestId, revision: '1' },
  };
  const round: VerificationRoundRecord = {
    schemaVersion: 1,
    roundId,
    requestId,
    scope: input.scope,
    fingerprint: 'fingerprint-' + roundId,
    configuration: {
      schemaVersion: 1,
      version: 1,
      digest: 'configuration-' + roundId,
      checks: [
        {
          checkId: input.check.checkId,
          kind: input.check.kind,
          command: input.check.command,
          cwd: '.',
          timeoutMs: 30000,
          appliesTo: { workspaceId: input.scope.workspaceId, taskIds: [input.scope.taskId] },
        },
      ],
    },
    materialIdentity: {
      schemaVersion: 1,
      scope: input.scope,
      runRef: { aggregateType: 'Run', projectId: input.scope.projectId, goalId: input.scope.goalId, runId: input.scope.runId },
      runRevision: 1,
      runDigest: 'run-digest-' + roundId,
      planRef: input.plan.ref,
      planRevision: input.plan.planRevision,
      planDigest: 'plan-digest-' + input.plan.planId,
      taskDigest: 'task-digest-' + input.scope.taskId,
      goalRevision: 1,
      goalDigest: 'goal-digest-' + input.scope.goalId,
      workspaceRevision: 1,
      workspaceDigest: 'workspace-digest-' + input.scope.workspaceId,
      workspaceRoot: '/fixture/root',
      policyPin: input.plan.effectiveCompletionPolicy,
      baselinePin: input.plan.effectiveArchitectureBaseline,
      sourceDigest: input.sourceDigest,
      sourceProofDigest: 'proof-digest-' + roundId,
    },
    sourceProof: null,
    plan: null,
    checks: [
      {
        definition: {
          checkId: input.check.checkId,
          kind: input.check.kind,
          command: input.check.command,
          cwd: '.',
          timeoutMs: 30000,
          appliesTo: { workspaceId: input.scope.workspaceId, taskIds: [input.scope.taskId] },
        },
        requestId: checkRequestId,
        coverage: [{ obligationId: input.check.obligationId, requirementId: input.check.requirementId }],
      },
    ],
    coverage: [coverageEntry],
    status: 'completed',
    outcome: result,
    gaps: [],
    // 本夹具讲的是轮次工具结论与返工问题的关系，不涉及角色必产出：
    // null = 这条轮次记录里没有该检查的事实（RW-15 之前落盘的形状也一样）。
    roleOutputs: null,
    createdAt: ROUND_STARTED_AT,
    finishedAt: ROUND_ENDED_AT,
    aggregate: {
      artifactRef: reportRef,
      submittedAt: ROUND_ENDED_AT,
      admissions: [{ evidenceId: input.evidenceId, coverage: coverageEntry, status: 'admitted' }],
    },
    // 轮次记录的是"该轮结论落到 Control 时的相位"：PASS 轮对应 satisfied／COMPLETED。
    control: result === 'PASS' ? { taskPhase: 'satisfied', goalPhase: 'COMPLETED' } : { taskPhase: 'failed', goalPhase: 'FAILED' },
    reduction: { task: null, goal: null },
  };
  const check: CommandCheckRecord = {
    projectId: input.scope.projectId,
    workspaceId: input.scope.workspaceId,
    goalId: input.scope.goalId,
    runId: input.scope.runId,
    requestId: checkRequestId,
    fingerprint: 'fingerprint-' + checkRequestId,
    status: 'finished',
    command: input.check.command,
    kind: input.check.kind,
    timeoutMs: 30000,
    startedAt: ROUND_STARTED_AT,
    finishedAt: ROUND_ENDED_AT,
    result: null,
    lifecycle: 'lease_released',
    progress: {
      phase: 'report_stored',
      observationId: 'observation-' + input.check.checkId,
      context: {
        projectId: input.scope.projectId,
        goalId: input.scope.goalId,
        taskId: input.scope.taskId,
        planRef: input.plan.ref,
        workspaceRevision: 1,
        changeScope: { diffClass: 'code-change', changedFiles: [], writeSummary: 'fixture' },
      },
      sourceDigest: input.sourceDigest,
      artifactRef: reportRef,
      result,
      category: result === 'INCONCLUSIVE' ? 'timeout' : 'tool_check',
      effects: 'known',
    },
  };
  input.journal.rounds.push(round);
  // 持久化：重启后由 journal.init() 重建同一份问题（问题身份与失效标注重建一致）。
  await input.journal.save('round', roundId, round);
  // 只有留下检查记录的那一轮才写检查文件；journal 只认 64 位十六进制的文件名协议。
  if (input.withoutCheckRecord !== true) {
    input.journal.checks.push(check);
    await input.journal.save('check', digest(canonicalJson([input.scope, checkRequestId])), check);
  }
}
