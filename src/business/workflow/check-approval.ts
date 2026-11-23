/**
 * G8B B1：平台自动采用一份带新检查的计划时，新检查由不是作者的 agent 批准。
 *
 * 三处自动采用点（秘书的小改动、干预第 11 阶段、PL 目标循环）共用请批 `request`：没有新检查照旧采用；有就先选批准者、
 * 跑改动前的事实，全部失败才发批准轮 `checkreview:`，其余交人。批准轮的收尾 `settle` 由平台落实结论（批了就以平台
 * 身份采用，Host 装检查），三条来路都一样。Host 装检查时读结论用 `checkReviewConclusionOf`，和这里同一个读法。
 */
import { checkApprovalNoticeText, checkReviewAnswerProblem, parseCheckReviewAnswer,
  type CheckApprovalNoticeCaseV1, type CheckBaselineV1, type CheckReviewAnswerV1, type CheckReviewApproverDutyV1, type CheckReviewAuthorDutyV1,
  type CheckReviewSubjectV1 } from '../../contracts/check-review.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { GoalRef, GoalSnapshot } from '../../contracts/ledger.js';
import { checkReviewRequestIdOf, checkReviewSubjectOfText, systemRoundContext, type SystemRoundV1 } from '../../contracts/plan-round.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import { interventionPlanningQueryRefs, type QueryJobAnswerRef } from '../../contracts/query-job.js';
import { proposedCheckSplit } from '../../contracts/verification.js';
import type { SessionMailboxPort } from '../../core/work-graph/model/communication-contracts.js';
import { reviewQueryEnded, type ReviewQueryReads } from '../../core/work-graph/model/evidence-contracts.js';
import type { PlanProposal } from '../../core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../core/work-graph/queries/contracts.js';
import { candidateSourceLineOf, hostContextIn, sentSystemRoundRef } from '../../core/work-graph/tasks/plan-lineage.js';
import { PROPOSE_RETRIED_CODES } from './intervention.js';
import type { WorkflowDependencies } from './ports.js';
import { autoAdoptCandidate, automationContext, ownedInWorkspace, type Owned } from './workflow.js';

/** 请批的四种结果：照旧采用、等批准轮、交人、发批准轮。 */
export type CheckApprovalRequestV1 =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'person'; reason: string }
  | { kind: 'send'; round: SystemRoundV1; recipient: SessionRef; text: string }
  /**
   * lead 11-17 裁定 2：批准轮全部批了、收尾还没采用上。PL 先立原来的采用前取消围栏（`cancelBeforeAdoption`），收尾的
   * 采用等围栏成立后才过 owner 的 `busy` 守卫；其余两处照等。
   */
  | { kind: 'approved' };

/** B1a：一张表。秘书写的由参谋批，参谋写的由审阅者批；表外（执行者、书记、读不到）交人（Q4）。 */
export function approverDutyOf(author: PlatformDutyV1 | null): CheckReviewApproverDutyV1 | null {
  return author === 'secretary' ? 'adviser' : author === 'adviser' ? 'reviewer' : null;
}

/** 批准轮的结论：没发、还没答完、或答了（答案可能读不出）。 */
export type CheckReviewConclusionV1 =
  | { status: 'not_sent' }
  | { status: 'waiting' }
  | { status: 'decided'; subject: CheckReviewSubjectV1; recipient: SessionRef; answeredBy: SessionRef | null;
    answerRef: QueryJobAnswerRef | null; answer: CheckReviewAnswerV1 | null };

export type CheckReviewReads = {
  messages: Pick<SessionMailboxPort, 'readHostSendMessageRef' | 'readMessage'>;
  queries: ReviewQueryReads;
};

const sameSession = (left: SessionRef | null, right: SessionRef): boolean =>
  left !== null && left.projectId === right.projectId && left.sessionId === right.sessionId;

/** 批了：答案读得出、是收件线答的、每条都是 approve。Workflow 的收尾和 Host 装检查都按它判。 */
export function checkReviewApproved(conclusion: CheckReviewConclusionV1): conclusion is Extract<CheckReviewConclusionV1,
  { status: 'decided' }> & { answer: CheckReviewAnswerV1; answerRef: QueryJobAnswerRef; answeredBy: SessionRef } {
  return conclusion.status === 'decided' && conclusion.answer !== null && conclusion.answerRef !== null
    && sameSession(conclusion.answeredBy, conclusion.recipient)
    && conclusion.answer.verdicts.every(verdict => verdict.decision === 'approve');
}

/**
 * 一份候选这一版的批准轮结论，只读：`scope` 是目标所在的工作区（发送方）。消息落在收件线的工作区，Query 跟着目标。
 * 答案只认这一轮提交工具写的 `check_review` 形状，而且要答 `subject` 里的每一条。
 */
export async function checkReviewConclusionOf(ctx: CoreCallContext, reads: CheckReviewReads,
  input: { scope: WorkspaceScope; proposalId: string; revision: number }): Promise<ReadResult<CheckReviewConclusionV1>> {
  const requestId = checkReviewRequestIdOf(input.proposalId, input.revision);
  const sent = await sentSystemRoundRef(reads.messages, input.scope, requestId, ctx.signal);
  if (sent.status === 'not_found') return { status: 'ready', value: { status: 'not_sent' } };
  if (sent.status !== 'ready') return sent;
  const message = await reads.messages.readMessage(hostContextIn(ctx, sent.value.workspaceId), sent.value);
  if (message.status !== 'ready') return message;
  const read = await reads.queries.readQueryJob(ctx, interventionPlanningQueryRefs(sent.value, input.scope.workspaceId).queryJobRef);
  if (read.status === 'not_found') return { status: 'ready', value: { status: 'waiting' } };
  if (read.status !== 'ready') return read;
  const job = read.value.job.job;
  if (!reviewQueryEnded(job)) return { status: 'ready', value: { status: 'waiting' } };
  const subject = checkReviewSubjectOfText(job.intent.question);
  const recipient = message.value.recipient;
  // 平台自己发的批准轮，题头和收件线都是平台写的；读不出就是没有结论（交人），不猜。
  if (subject === null || !('sessionId' in recipient)) return { status: 'ready', value: { status: 'not_sent' } };
  const answerRef = job.answerRefs.at(-1) ?? null;
  const answeredBy = read.value.run.run.executionState?.sessionRef ?? null;
  let answer: CheckReviewAnswerV1 | null = null;
  const execution = job.intent.execution;
  if (answerRef !== null && execution.kind === 'intervention_planning' && execution.answerShape === 'check_review') {
    const stored = await reads.queries.readQueryAnswer(ctx, answerRef);
    if (stored.status !== 'ready') return stored;
    const parsed = parseCheckReviewAnswer(stored.value.answer.answer);
    if (parsed.status === 'parsed' && checkReviewAnswerProblem(subject, parsed.answer) === null) answer = parsed.answer;
  }
  return { status: 'ready', value: { status: 'decided', subject, recipient, answeredBy, answerRef, answer } };
}

/** createWorkflow 用自己的闭包构造它（同 `claimIntervention` 的传法）。 */
export type CheckApprovalDependencies = {
  workflow: Pick<WorkflowDependencies, 'checks' | 'checkApproval' | 'plans' | 'sessions' | 'sessionDuty' | 'messages'
    | 'requests' | 'send' | 'consultations' | 'readCandidateCard' | 'latestAgentCandidate'>;
  /** 这个目标里这一职责的批准线（参谋：`adviserOf`；审阅者：`reviewLineOf`）；没有是 `null`。 */
  approverLineOf(owned: Owned, goal: GoalSnapshot, duty: CheckReviewApproverDutyV1): Promise<SessionRef | null | CoreRejection>;
  /**
   * 发过的批准轮的状态（`sentRoundOf` + `sentRoundStateOf`）：还在跑 `pending`；答完、收尾没做完 `answered`；
   * 收尾做完 `ended`。
   */
  sentRoundState(owned: Owned, goalRef: GoalRef, requestId: string):
    Promise<'not_sent' | 'pending' | 'answered' | 'ended' | CoreRejection>;
};

export type CheckApproval = {
  request(owned: Owned, input: { candidate: PlanProposal; goal: GoalSnapshot; authorDuty: PlatformDutyV1 | null }):
    Promise<CheckApprovalRequestV1 | CoreRejection>;
  /** PL 那一处：作者先由 `candidateSourceLineOf` 读出，职责用 Workflow 现成的解析器换。 */
  requestForCandidate(owned: Owned, input: { candidate: PlanProposal; goal: GoalSnapshot }):
    Promise<CheckApprovalRequestV1 | CoreRejection>;
  /** 秘书小改动和干预第 11 阶段自己发出批准轮（PL 走驱动的 `send_system_round`）。 */
  send(owned: Owned, approval: Extract<CheckApprovalRequestV1, { kind: 'send' }>): Promise<CoreRejection | null>;
  /** B1e：批准轮的收尾。`answered` 说明答案能读出（来源按“已答”关掉）。 */
  settle(owned: Owned, input: { record: QueryJobRecord }):
    Promise<{ answered: boolean } | CoreRejection>;
};

export function createCheckApproval(deps: CheckApprovalDependencies): CheckApproval {
  const { workflow } = deps;
  /** 一份候选一版已经交人：本进程里不再重跑改动前的事实（重启后最多再跑一次）。 */
  const toPerson = new Map<string, Extract<CheckApprovalRequestV1, { kind: 'person' }>>();
  const notReady = (result: { status: string; code?: string; reason?: string }, what: string): CoreRejection =>
    result.status === 'rejected' ? result as CoreRejection : rejected('unavailable', `${what} could not be read`);

  /** 一份候选一版的请知悉身份：主语是目标，操作号带候选和版本（两种共用一个身份，见 `projectNoticeIdentity`）。 */
  const noticeKeyOf = (owned: Owned, goalRef: GoalRef, candidateRef: PlanProposal['ref'], revision: number) => ({
    projectRef: { projectId: owned.projectId }, subject: { kind: 'goal' as const, goalRef },
    operation: { aggregateType: 'CoreOperation' as const, projectId: owned.projectId,
      operationId: `check-approval:${candidateRef.proposalId}:${String(revision)}` } });

  /**
   * 主对话里的一行请知悉（B1g），主语是这个目标，链到这份候选；重做返回原记录。同一份候选同一版已经写过另一种
   * （`idempotency_conflict`）就以先写的为准，不出第二行（lead 11-17 裁定 4）。
   */
  async function tell(owned: Owned, input: { candidateRef: PlanProposal['ref']; revision: number; goal: GoalSnapshot;
    authorDuty: CheckReviewAuthorDutyV1; kind: 'check_approved' | 'check_to_person'; notice: CheckApprovalNoticeCaseV1 },
  ): Promise<CoreRejection | null> {
    const port = workflow.checkApproval;
    if (port === undefined) return rejected('unsupported', 'the check approval notice is not wired');
    const written = await port.notifyProject({ ...noticeKeyOf(owned, input.goal.ref, input.candidateRef, input.revision),
      kind: input.kind,
      summary: checkApprovalNoticeText({ authorDuty: input.authorDuty, objective: input.goal.objective, notice: input.notice }),
      objects: [{ kind: 'aggregate', pin: { ref: input.candidateRef, revision: input.revision }, label: 'candidate' }] });
    return written.status === 'committed' || written.code === 'idempotency_conflict' ? null : written;
  }

  async function request(owned: Owned, input: { candidate: PlanProposal; goal: GoalSnapshot;
    authorDuty: PlatformDutyV1 | null }): Promise<CheckApprovalRequestV1 | CoreRejection> {
    const { candidate, goal } = input;
    const proposed = candidate.checks ?? [];
    if (proposed.length === 0) return { kind: 'none' };
    const key = `${candidate.ref.proposalId}:${String(candidate.revision)}`;
    const decided = toPerson.get(key);
    if (decided !== undefined) return decided;
    const person = (reason: string): CheckApprovalRequestV1 => {
      const value = { kind: 'person' as const, reason };
      toPerson.set(key, value);
      return value;
    };
    const port = workflow.checkApproval;
    // 没接上批检查的口：照 G8A，交人。
    if (port === undefined) return person('the check approval is not wired');
    // lead 11-17 裁定 4：这份候选这一版已经交过人（重启后内存缓存没了），沿用那次的结论，不再重跑改动前的事实。
    const earlier = await port.readNotice({ ...noticeKeyOf(owned, goal.ref, candidate.ref, candidate.revision),
      kind: 'check_to_person' });
    if (earlier.status !== 'ready') return notReady(earlier, 'the check approval notice');
    if (earlier.value !== null && earlier.value.kind === 'check_to_person') {
      return person('this candidate version was already left to the person');
    }
    // 1. 新检查：和已装的比；一条新的都没有就照旧采用。
    const installed = await port.installedChecks({ projectId: candidate.ref.projectId, workspaceId: candidate.ref.workspaceId });
    if (installed.status !== 'ready') return notReady(installed, 'the installed checks');
    const { added } = proposedCheckSplit(installed.value ?? [], proposed);
    if (added.length === 0) return { kind: 'none' };
    // 2. 批准者按作者的职责选；表外的作者交人，不出请知悉（Q4：G8A 的候选卡已列出检查）。先看这一步，因为请知悉
    // 要写作者是谁。
    const approverDuty = approverDutyOf(input.authorDuty);
    if (approverDuty === null || (input.authorDuty !== 'secretary' && input.authorDuty !== 'adviser')) {
      return person(`a plan written by ${input.authorDuty ?? 'an unknown line'} has no agent approver`);
    }
    const authorDuty: CheckReviewAuthorDutyV1 = input.authorDuty;
    const told = { candidateRef: candidate.ref, revision: candidate.revision, goal, authorDuty };
    // 3. 拒绝（Q3）：`taskIds: "all"` 的检查管到这个工作区所有目标，超出批准者看的这一份计划，交人。
    const allTasks = added.filter(check => check.taskIds === 'all').map(check => check.checkId);
    if (allTasks.length > 0) {
      const refused = await tell(owned, { ...told, kind: 'check_to_person', notice: { kind: 'all_tasks', checkIds: allTasks } });
      return refused ?? person('a new check covers every task of the workspace');
    }
    const checkIds = added.map(check => check.checkId);
    // 4. 已经发过：还在跑或收尾没做完就等；收尾做完了候选还是候选（交人了，或批了没采用上），交人。
    const requestId = checkReviewRequestIdOf(candidate.ref.proposalId, candidate.revision);
    const state = await deps.sentRoundState(owned, goal.ref, requestId);
    if (typeof state !== 'string') return state;
    if (state === 'pending') return { kind: 'pending' };
    if (state === 'ended') return person('the check review ended without adopting the plan');
    if (state === 'answered') {
      // 答完、收尾还没采用上：批了就告诉调用方，PL 先立采用前的取消围栏；没批就等收尾交人。
      if (workflow.messages === undefined || workflow.consultations === undefined) return { kind: 'pending' };
      const read = await checkReviewConclusionOf(owned.ctx, { messages: workflow.messages,
        queries: workflow.consultations.queries }, { scope: { projectId: candidate.ref.projectId,
        workspaceId: candidate.ref.workspaceId }, proposalId: candidate.ref.proposalId, revision: candidate.revision });
      if (read.status !== 'ready') return notReady(read, 'the check review conclusion');
      return checkReviewApproved(read.value) ? { kind: 'approved' } : { kind: 'pending' };
    }
    const recipient = await deps.approverLineOf(owned, goal, approverDuty);
    if (recipient !== null && 'status' in recipient) return recipient;
    // 没有批准线就交人，不为此开新线。
    if (recipient === null) {
      const refused = await tell(owned, { ...told, kind: 'check_to_person',
        notice: { kind: 'no_approver', checkIds, approverDuty } });
      return refused ?? person(`the Goal has no ${approverDuty} line to approve the checks`);
    }
    // 5. 改动前的事实：这一刻工作区主线根目录的内容；有一条不是“失败”就交人。没接上运行器就是都没跑成。
    const run = workflow.checks.runCheckBaseline;
    const baselines: CheckBaselineV1[] = [];
    for (const check of run === undefined ? [] : added) {
      const ran = await run!(automationContext(owned), { check, workspace: { aggregateType: 'Workspace',
        projectId: candidate.ref.projectId, workspaceId: candidate.ref.workspaceId } });
      if (ran.status !== 'ready') return notReady(ran, 'the check baseline');
      baselines.push(ran.value);
    }
    const notFailed = run === undefined ? added.map(check => ({ checkId: check.checkId, outcome: 'not_started' as const }))
      : baselines.filter(baseline => baseline.outcome !== 'failed');
    if (notFailed.length > 0) {
      const refused = await tell(owned, { ...told, kind: 'check_to_person', notice: { kind: 'baseline', baselines: notFailed } });
      return refused ?? person('a new check does not fail on the workspace before this change');
    }
    const subject: CheckReviewSubjectV1 = { proposalRef: { ...candidate.ref }, proposalRevision: candidate.revision,
      goalRef: { ...goal.ref }, authorDuty, approverDuty, baselines };
    return { kind: 'send', round: { kind: 'check_review', goalRef: goal.ref, subject }, recipient, text: requestId };
  }

  return {
    request,

    async requestForCandidate(owned, input) {
      if ((input.candidate.checks ?? []).length === 0) return { kind: 'none' };
      const messages = workflow.messages;
      const requests = workflow.requests;
      if (messages === undefined || requests === undefined) return request(owned, { ...input, authorDuty: null });
      const author = await candidateSourceLineOf(owned.ctx, { messages, requests }, input.candidate);
      if (author.status !== 'ready') return notReady(author, 'the candidate author line');
      let authorDuty: PlatformDutyV1 | null = null;
      if (author.value.session !== null && workflow.sessionDuty !== undefined) {
        const session = await workflow.sessions.readSession(owned.ctx, author.value.session, 'project');
        if (session.status !== 'ready') return notReady(session, 'the candidate author line');
        const duty = await workflow.sessionDuty(session.value.record.role, owned.ctx);
        if (duty.status !== 'ready') return notReady(duty, 'the candidate author duty');
        authorDuty = duty.value === 'unknown' ? null : duty.value;
      }
      return request(owned, { ...input, authorDuty });
    },

    async send(owned, approval) {
      if (workflow.send === undefined) return rejected('unsupported', 'the system-round send is not wired');
      const sent = await workflow.send(systemRoundContext({ projectId: owned.projectId, workspaceId: owned.workspaceId },
        owned.ctx.signal), { round: approval.round, recipient: approval.recipient, text: approval.text });
      return sent.status === 'rejected' ? sent : null;
    },

    async settle(owned, input) {
      const subject = checkReviewSubjectOfText(input.record.job.job.intent.question);
      if (subject === null) return rejected('invalid', 'the check review round names no subject');
      if (workflow.messages === undefined || workflow.consultations === undefined) {
        return rejected('unsupported', 'the check review reads (mailbox and Query) are not wired');
      }
      const goalOwned = ownedInWorkspace(owned, subject.proposalRef.workspaceId);
      // 结论和 Host 装检查时读的是同一个（`checkReviewConclusionOf`）。
      const read = await checkReviewConclusionOf(goalOwned.ctx, { messages: workflow.messages,
        queries: workflow.consultations.queries }, { scope: { projectId: subject.proposalRef.projectId,
        workspaceId: subject.proposalRef.workspaceId }, proposalId: subject.proposalRef.proposalId,
      revision: subject.proposalRevision });
      if (read.status !== 'ready') return notReady(read, 'the check review conclusion');
      const conclusion = read.value;
      const answer = conclusion.status === 'decided' ? conclusion.answer : null;
      // 拒绝（安全）：批了就装检查、采用计划，只有被请的那条线能批（同书记审查的规则）。
      if (conclusion.status === 'decided' && answer !== null
        && !sameSession(conclusion.answeredBy, conclusion.recipient)) {
        return rejected('forbidden', 'the check review answer was not given by the line the round was sent to');
      }
      const goalRead = await workflow.plans.queryGoal(goalOwned.ctx, subject.goalRef);
      if (goalRead.status !== 'ready') return notReady(goalRead, 'the check review Goal');
      const goal = goalRead.value.goal;
      const told = { candidateRef: subject.proposalRef, revision: subject.proposalRevision, goal,
        authorDuty: subject.authorDuty };
      const checkIds = subject.baselines.map(baseline => baseline.checkId);
      // 本轮的采用：固定请求号，回执只认这一轮自己的（指纹不含 `expected`）。
      const adoption = {
        input: { proposalRef: { ...subject.proposalRef }, expectedProposalRevision: subject.proposalRevision, decisionRefs: [] },
        meta: { requestId: `${checkReviewRequestIdOf(subject.proposalRef.proposalId, subject.proposalRevision)}:adopt`,
          expected: [{ ref: goal.ref, revision: goal.revision },
            { ref: subject.proposalRef, revision: subject.proposalRevision }] },
      };
      // lead 11-17 裁定 1：批了的，先查本轮自己的采用回执。本轮已经采用上（之后写请知悉失败、或进程在两步之间退出），
      // 补写同身份的请知悉，写上了才关来源。只凭“候选已被采用”不补：那可能是人先采用的。
      if (checkReviewApproved(conclusion) && workflow.checkApproval !== undefined) {
        const receipt = await workflow.checkApproval.lookupPlanChange(automationContext(goalOwned), adoption);
        if (receipt.status === 'committed') {
          const refused = await tell(goalOwned, { ...told, kind: 'check_approved',
            notice: { kind: 'approved', checkIds, approverDuty: subject.approverDuty } });
          return refused ?? { answered: true };
        }
        // 拒绝（lead 11-17 19:2x 第 1 条）：回执读不出来不等于“不是本轮采用”，原样返回、来源留着，下一次重做再查。
        if (receipt.status !== 'not_found') return receipt;
      }
      /** 这一版候选已经结束（人先采用了、被替换、目标取消）：不采用、不出请知悉。采用前和采用被拒后都按它判。 */
      const candidateEnded = async (): Promise<boolean | CoreRejection> => {
        const proposal = await workflow.plans.readPlanProposal(goalOwned.ctx, subject.proposalRef);
        if (proposal.status !== 'ready') return notReady(proposal, 'the check review candidate');
        return proposal.value.status !== 'candidate' || proposal.value.revision !== subject.proposalRevision;
      };
      const endedBefore = await candidateEnded();
      if (endedBefore !== false) return endedBefore === true ? { answered: answer !== null } : endedBefore;
      if (!checkReviewApproved(conclusion)) {
        const verdicts = answer === null ? checkIds.map(checkId => ({ checkId, reason: '没有给出能读的回答' }))
          : answer.verdicts.filter(verdict => verdict.decision === 'to_person');
        const refused = await tell(goalOwned, { ...told, kind: 'check_to_person',
          notice: { kind: 'not_approved', verdicts, approverDuty: subject.approverDuty } });
        return refused ?? { answered: answer !== null };
      }
      // 全部批了：以 Workflow 的自动化身份走普通的采用，Host 在采用包装里读这一轮的结论装检查（B1f）。
      // 2.5a A13：这一处也经同一个包装，在装检查与采用之前判一次；命中或来源读不全都留作候选卡，不采用。
      const adopted = await autoAdoptCandidate(goalOwned, workflow, adoption);
      if (adopted.status === 'adopted') {
        const refused = await tell(goalOwned, { ...told, kind: 'check_approved',
          notice: { kind: 'approved', checkIds, approverDuty: subject.approverDuty } });
        return refused ?? { answered: true };
      }
      if (adopted.status !== 'refused') return { answered: answer !== null };
      // 另一轮能变的拒绝原样返回，Host 下一轮用同一身份重做（同书记审查的约定）。
      if (PROPOSE_RETRIED_CODES.has(adopted.result.code)) return adopted.result;
      // lead 11-17 19:2x 第 2 条：读到候选之后、采用之前人可能抢先采用，owner 回 invalid。再按同一条规则看一次：已经
      // 结束（本轮没有采用回执，所以是别人采用的）就安静退出，不出“没采用上，交你决定”。
      const endedAfter = await candidateEnded();
      if (endedAfter !== false) return endedAfter === true ? { answered: true } : endedAfter;
      const refused = await tell(goalOwned, { ...told, kind: 'check_to_person',
        notice: { kind: 'not_adopted', checkIds, approverDuty: subject.approverDuty, reason: adopted.result.reason } });
      return refused ?? { answered: true };
    },
  };
}
