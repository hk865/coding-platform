/**
 * HANDOFF 121-112: the platform's one step after the scribe's long-command
 * review round ends. The scribe already looked at the facts and, on `normal`,
 * kept its note through `record_note` in the same round; this step only does
 * what the conclusion asks of the platform:
 *
 * - `normal`: the Host looks again after `nextReviewInMs`; nobody is disturbed.
 * - `adviser`: the platform acts on the command's real object. A Work Run first
 *   places the scribe's `scribe_stop` hold (the Task is not automatically
 *   reworked until the adviser has looked), then stops the Run, then opens one
 *   `command_stop` round for the responsible adviser. A Query round only stops
 *   that Query, with no hold. A command that already ended is not stopped and
 *   keeps no hold (the one this close-out placed is released once the fixed
 *   `:hold`/`:cancel`/`:round` receipts show that it did not submit the stop and
 *   the Run carries no cancel of anyone else's).
 *   With no adviser line nobody would handle what comes after a stop, so the
 *   command is not stopped: the person is told there is no responsible adviser
 *   and stops it if they want to (121-111: record the reversible risk rather
 *   than act).
 * - `human`: the person gets one notice; the command keeps running (the person
 *   stops it if they want to).
 * - no conclusion (the round ended without a parsable answer, or was stopped):
 *   the person gets one notice that the command keeps running.
 *
 * Every effect carries the fixed identity of the review (`commandKey` +
 * `reviewSeq`), so a repeated close-out replays it instead of acting twice.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection, WriteResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { RuntimeTask } from '../../contracts/plan.js';
import { systemRoundContext, systemRoundRequestId, type SystemRoundV1 } from '../../contracts/plan-round.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../contracts/role-lines.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../contracts/task-requeue.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES } from '../../core/work-graph/sessions/message-record-codecs.js';
import { controlIntentRefFor } from '../../core/work-graph/tasks/control-service.js';
import { sentSystemRoundRef } from '../../core/work-graph/tasks/plan-lineage.js';
import type {
  CommandReviewAnswerV1, CommandReviewConclusionV1, CommandReviewSubjectV1,
} from '../../contracts/scribe-review.js';
import { truncateUtf8 } from '../../contracts/utf8.js';
import { asRejection } from './consultation.js';
import { systemRoundSendInput } from './plan-round.js';
import type { WorkflowDependencies } from './ports.js';

/** The platform facts and effects the Workflow ports do not carry. */
export type CommandReviewDeps = {
  /**
   * Whether the Runtime's running-command registry still lists exactly this command (`runningCommandKey`: its round
   * and call). A round may run later commands after the reviewed one ended; only the reviewed one may be stopped.
   */
  isCommandRunning(commandKey: string): boolean;
  /** The one project-notice writer (`notifyProject`). */
  notifyProject(input: NotifyProjectInputV1): Promise<WriteResult<ProjectNoticeV1>>;
  /** The Host's memory of the next review of a command that is still running; an ended command is forgotten. */
  scheduleNext(subject: CommandReviewSubjectV1, nextReviewInMs: number): void;
};

export type CommandReviewPorts =
  Pick<WorkflowDependencies,
    'claimHolds' | 'controls' | 'executions' | 'messages' | 'plans' | 'recipients' | 'runtime' | 'commandReview'>;

/** A project notice summary is at most 512 UTF-8 bytes (`ProjectNotice@1`); the command is cut to 80 code points. */
const NOTICE_MAX_BYTES = 512;
const previewOf = (subject: CommandReviewSubjectV1): string => [...subject.commandPreview].slice(0, 80).join('');
const minutesOf = (subject: CommandReviewSubjectV1): string => String(Math.floor(subject.elapsedMs / 60_000));

export async function applyCommandReview(
  /** A Host context in the command's workspace (the Workflow's automation actor). */
  ctx: CoreCallContext,
  ports: CommandReviewPorts,
  input: {
    subject: CommandReviewSubjectV1;
    answer: CommandReviewAnswerV1 | null;
    /** The scribe line the round was sent to, and the Session that entered the answered Query. */
    recipient: SessionRef;
    answeredBy: SessionRef | null;
    /** The `scr:` review message this close-out serves; the scribe hold records it as its basis. */
    sourceMessage: SessionMessageRef;
  },
): Promise<{ status: 'ready'; value: { applied: CommandReviewConclusionV1 | 'no_answer' } } | CoreRejection> {
  const deps = ports.commandReview;
  if (deps === undefined) return rejected('unsupported', 'the command review step is not wired');
  const { subject, answer } = input;
  // Safety: a conclusion can stop a command; only the scribe line the round was sent to may give it.
  if (answer !== null && (input.answeredBy === null || input.answeredBy.projectId !== input.recipient.projectId
    || input.answeredBy.sessionId !== input.recipient.sessionId)) {
    return rejected('forbidden', 'the review answer was not given by the scribe line the round was sent to');
  }
  const operationId = `command-review:${subject.commandKey}:${String(subject.reviewSeq)}`;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: subject.projectId, goalId: subject.goalId };
  const tellHuman = async (summary: string): Promise<CoreRejection | null> => {
    const written = await deps.notifyProject({ projectRef: { projectId: subject.projectId },
      subject: { kind: 'goal', goalRef }, kind: 'command_review', summary: truncateUtf8(summary, NOTICE_MAX_BYTES),
      operation: { aggregateType: 'CoreOperation', projectId: subject.projectId, operationId } });
    return written.status === 'committed' ? null : written;
  };
  const reviewApplied = (applied: CommandReviewConclusionV1 | 'no_answer') => ({ status: 'ready' as const, value: { applied } });

  if (answer === null) {
    const refused = await tellHuman(`书记没给结论，命令继续跑：${previewOf(subject)}，已 ${minutesOf(subject)} 分钟。`);
    return refused ?? reviewApplied('no_answer');
  }
  if (answer.conclusion === 'normal') {
    deps.scheduleNext(subject, answer.nextReviewInMs!);   // the parse requires it on `normal`
    return reviewApplied('normal');
  }
  if (answer.conclusion === 'human') {
    const refused = await tellHuman(`书记审查：${answer.reason}。命令：${previewOf(subject)}，平台没有停它，需要时可以停掉。`);
    return refused ?? reviewApplied('human');
  }
  if (ports.messages === undefined) return rejected('unsupported', 'the mailbox is not wired');
  const scope = { projectId: subject.projectId, workspaceId: subject.workspaceId };
  const round: SystemRoundV1 = { kind: 'command_stop', goalRef, subject };
  const roundId = systemRoundRequestId(round);
  if (roundId.status !== 'ready') return roundId;
  // 0. The `cmdstop:` receipt is the "already sent" fact; a repeated close-out replays it and sends nothing again.
  // It comes before the adviser read: an adviser who left after the round went out must not turn into "not stopped".
  const sentBefore = await sentSystemRoundRef(ports.messages, scope, roundId.value, ctx.signal);
  if (sentBefore.status === 'ready') return reviewApplied('adviser');
  if (sentBefore.status !== 'not_found') return asRejection(sentBefore, 'the sent command stop round');
  const adviser = await commandAdviserOf(ctx, ports, subject, goalRef);
  if (adviser !== null && 'status' in adviser) return adviser;
  if (adviser === null) {
    const refused = await tellHuman(`书记审查：${answer.reason}。没有负责的参谋，平台没有停这条命令：`
      + `${previewOf(subject)}，需要时可以停掉。`);
    return refused ?? reviewApplied('adviser');
  }
  // 1. Only the reviewed command's own state decides whether the platform may stop the Run (`runningCommandKey`).
  const running = deps.isCommandRunning(subject.commandKey);
  const work = subject.run.kind === 'run';
  let actuality: 'stopped' | 'ended';
  if (subject.run.kind === 'query') {
    // Query: only that round is stopped; a Task hold and its later release do not apply.
    const stopped = running ? await stopCommandRun(ctx, ports, deps, subject, `${operationId}:cancel`) : 'not_running';
    if (typeof stopped !== 'string') return stopped;
    actuality = stopped === 'not_running' ? 'ended' : 'stopped';
  } else {
    const taskRef: TaskTriple = { projectId: subject.projectId, goalId: subject.goalId, taskId: subject.run.taskId };
    const claimHolds = ports.claimHolds;
    if (claimHolds === undefined) {
      return rejected('unsupported', 'the claim holds are not wired; the command was not stopped');
    }
    // 2. The hold this operation placed, read back by its fixed `:hold` identity when the command already stopped.
    // `not_found` is "no hold", not a failed read; any other non-ready read is returned as-is. A reason this operation
    // already withdrew counts as none: an earlier pass settled on `ended`, and a later cancel does not change that.
    let holdReasonId: string | null = null;
    if (running) {
      const placed = await claimHolds.placeScribeStop(ctx, {
        input: { taskRef, reason: '书记判命令异常，等参谋看', sourceMessage: input.sourceMessage,
          run: subject.run.runRef, operationId: `${operationId}:hold` },
        meta: { requestId: `${operationId}:hold`, expected: [] },
      });
      if (placed.status !== 'committed' && placed.status !== 'unchanged') return placed;
      holdReasonId = placed.value.reasonId;
    } else {
      const hold = await claimHolds.readHold(ctx, { taskRef });
      if (hold.status === 'ready') {
        holdReasonId = hold.value.reasons.find(reason => reason.kind === 'scribe_stop' && reason.state === 'held'
          && reason.placedBy.kind === 'platform' && reason.placedBy.operationId === `${operationId}:hold`)?.id ?? null;
      } else if (hold.status !== 'not_found') {
        return asRejection(hold, 'the claim hold');
      }
    }
    // 3. The deterministic cancel intent is the "this operation stopped it" fact. The cancel reason string and the
    // Run's control pointer are never parsed for it: a newer intent may have replaced the pointer.
    const controls = ports.controls;
    if (controls === undefined) return rejected('unsupported', 'the Run control is not wired; the command was not stopped');
    const ours = await controls.readControl(ctx,
      controlIntentRefFor(WORKFLOW_AUTOMATION_ACTOR, scope, `${operationId}:cancel`));
    // 4. A committed intent is not submitted again; a still-queued one is delivered once. Without it, a close-out that
    // placed its hold asks `stopCommandRun`, which judges the command again just before the cancel: an ended command
    // leaves the Run's other commands alone (G1), and a cancel already on the Run is the stop (the hold stays).
    if (ours.status === 'ready') {
      if (ours.value.status === 'queued') {
        const deliver = ports.runtime.deliverControl;
        if (deliver === undefined) {
          return rejected('unsupported', 'the Run control is not wired; the command was not stopped');
        }
        const delivered = await deliver.call(ports.runtime, ctx, { intentRef: ours.value.ref });
        if (delivered.status !== 'ready') return asRejection(delivered, 'the cancel delivery');
      }
      actuality = 'stopped';
    } else if (ours.status !== 'not_found') {
      return asRejection(ours, 'the cancel intent');
    } else if (holdReasonId !== null) {
      const stopped = await stopCommandRun(ctx, ports, deps, subject, `${operationId}:cancel`);
      if (typeof stopped !== 'string') return stopped;
      actuality = stopped === 'not_running' ? 'ended' : 'stopped';
    } else {
      actuality = 'ended';
    }
    // 5. This operation placed no effective stop, so it takes back its own hold; the round says so plainly.
    if (actuality === 'ended' && holdReasonId !== null) {
      const released = await claimHolds.release(ctx, {
        input: { taskRef, reasonId: holdReasonId, note: '命令先结束了，没有硬停' },
        meta: { requestId: `${operationId}:hold-release`, expected: [] },
      });
      if (released.status !== 'committed' && released.status !== 'unchanged') return released;
    }
  }
  // 6. One `command_stop` planning round for the responsible adviser (Work carries its Task, Query does not).
  const text = commandStopText({ roundId: roundId.value, subject, answer, actuality, work });
  const request = systemRoundSendInput({ round, recipient: adviser, text,
    ...(subject.run.kind === 'run'
      ? { taskRef: { projectId: subject.projectId, goalId: subject.goalId, taskId: subject.run.taskId } } : {}) });
  if (request.status !== 'ready') return request;
  const sent = await ports.messages.sendMessage(systemRoundContext(scope, ctx.signal), request.value);
  if (sent.status !== 'committed') return sent;
  return reviewApplied('adviser');
}

/**
 * The body of a `command_stop` round: the request id, the frozen subject, the stop actuality, the command and how
 * long it ran, and the scribe's reason last (it may hold newlines). The actuality is one of the two stable facts this
 * close-out proved, never "is it still running now"; the reason has no bound of its own, so the whole body keeps the
 * mailbox's existing text bound by truncation.
 */
function commandStopText(input: {
  roundId: string; subject: CommandReviewSubjectV1; answer: CommandReviewAnswerV1;
  actuality: 'stopped' | 'ended'; work: boolean;
}): string {
  let actuality: string;
  if (input.work) {
    actuality = input.actuality === 'stopped'
      ? '停止实况：平台已取消这条命令所在的运行，任务上留了书记原因的暂缓，自动返工等你看过再走。'
      : '停止实况：命令已经自己结束了，平台没有硬停，任务上没有留书记原因。';
  } else {
    actuality = input.actuality === 'stopped'
      ? '停止实况：平台已停掉这条命令所在的问答轮。'
      : '停止实况：命令已经自己结束了，平台没有硬停。';
  }
  return truncateUtf8([
    input.roundId,
    `subject: ${canonicalJson(input.subject as unknown as JsonValue)}`,
    actuality,
    `命令：${previewOf(input.subject)}；已跑 ${minutesOf(input.subject)} 分钟。`,
    `书记的理由：${input.answer.reason}`,
  ].join('\n'), SESSION_MESSAGE_MAX_TEXT_BYTES);
}

/**
 * Stop the command's round the way any platform stop does. A Query round: `runtime.cancelQuery` (QSTOP's stop).
 * A Work Run: read the Run, then judge the reviewed command again, then one durable `cancel` pinned to the revision
 * just read, delivered to the live handle; a moved revision is returned so the next close-out retries. A cancel
 * already on the Run (anyone's, ended or not) is the stop: delivered again while the Run runs, never released
 * (c3rv ruling P4-3: the scribe judged it abnormal, so the adviser looks before the automatic rework). An ended Run
 * or an ended command is `not_running`, not a refusal. Known limit (lead 11-24, c3qc): the command registry lives in
 * the Host's memory, while the cancel is a durable write on the Run. Only the synchronous record store keeps the
 * judgement and that commit from interleaving, and what stops is the whole Run (design :589).
 */
async function stopCommandRun(ctx: CoreCallContext, ports: CommandReviewPorts, deps: CommandReviewDeps,
  subject: CommandReviewSubjectV1, requestId: string): Promise<'stopping' | 'stopped' | 'not_running' | CoreRejection> {
  if (subject.run.kind === 'query') {
    if (ports.runtime.cancelQuery === undefined) {
      return rejected('unsupported', 'the Query stop is not wired; the command was not stopped');
    }
    const cancelled = await ports.runtime.cancelQuery(ctx, { queryRunRef: subject.run.queryRunRef });
    return cancelled.status === 'ready' ? cancelled.value.stop : asRejection(cancelled, 'the Query stop');
  }
  const deliver = ports.runtime.deliverControl;
  if (ports.controls === undefined || deliver === undefined) {
    return rejected('unsupported', 'the Run control is not wired; the command was not stopped');
  }
  const read = await ports.executions.readExecution(ctx, subject.run.runRef);
  if (read.status !== 'ready') return asRejection(read, 'the command Run');
  const run = read.value.run;
  let intentRef = run.controlState?.desiredState === 'cancelled' ? run.controlState.intentRef : null;
  if (intentRef !== null && run.status === 'ended') return 'stopping';
  if (intentRef === null) {
    // The command may have ended, and the Run started another, since the close-out began: only this command is stopped.
    if (run.status === 'ended' || !deps.isCommandRunning(subject.commandKey)) return 'not_running';
    const submitted = await ports.controls.submitControl(ctx, {
      input: { runRef: run.ref, kind: 'cancel', reason: 'the scribe review judged this command abnormal' },
      meta: { requestId, expected: [{ ref: run.ref, revision: run.revision }] },
    });
    if (submitted.status !== 'committed') return submitted;
    intentRef = submitted.value.intent.ref;
  }
  const delivered = await deliver.call(ports.runtime, ctx, { intentRef });
  return delivered.status === 'ready' ? 'stopping' : asRejection(delivered, 'the cancel delivery');
}

/**
 * The adviser responsible for that part (121-112): the narrowest region adviser of the Task's module, else the
 * Goal's (a Query round has no Task: the Goal's) — the one L35 read, `technical`, no asker. `null` is none; a failed
 * read is returned, never "no adviser".
 */
async function commandAdviserOf(ctx: CoreCallContext, ports: CommandReviewPorts,
  subject: CommandReviewSubjectV1, goalRef: GoalRef): Promise<SessionRef | null | CoreRejection> {
  if (ports.recipients === undefined) return null;
  let scope: RuntimeTask['scope'] | undefined;
  if (subject.run.kind === 'run') {
    const taskId = subject.run.taskId;
    const graph = await ports.plans.queryTaskGraph(ctx, { goalRef });
    if (graph.status !== 'ready') return asRejection(graph, 'the Task graph');
    scope = graph.value.plan.tasks.find(task => task.taskId === taskId)?.scope;
  }
  const resolved = await ports.recipients.resolveResponsibilityRecipient(ctx, { projectId: subject.projectId, goalRef,
    moduleRef: scope?.kind === 'module' ? { projectId: subject.projectId, moduleId: scope.moduleRef } : null,
    kind: 'technical', asker: null });
  if (resolved.status !== 'ready') return asRejection(resolved, 'the responsible adviser');
  return resolved.value.kind === 'human' ? null : resolved.value.session;
}
