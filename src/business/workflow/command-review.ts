/**
 * HANDOFF 121-112: the platform's one step after the scribe's long-command
 * review round ends. The scribe already looked at the facts and, on `normal`,
 * kept its note through `record_note` in the same round; this step only does
 * what the conclusion asks of the platform:
 *
 * - `normal`: the Host looks again after `nextReviewInMs`; nobody is disturbed.
 * - `adviser`: the platform stops the command's Run (the stop is reversible,
 *   the command can be run again, and the scribe has read the facts), then
 *   tells the responsible adviser. With no adviser line nobody would handle
 *   what comes after a stop, so the command is not stopped: the person is told
 *   there is no responsible adviser and stops it if they want to (121-111:
 *   record the reversible risk rather than act).
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
import type { GoalRef } from '../../contracts/ledger.js';
import type { RuntimeTask } from '../../contracts/plan.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../contracts/role-lines.js';
import type { SessionMessageSendInputV1 } from '../../core/work-graph/model/communication-contracts.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES } from '../../core/work-graph/sessions/message-record-codecs.js';
import type {
  CommandReviewAnswerV1, CommandReviewConclusionV1, CommandReviewSubjectV1,
} from '../../contracts/scribe-review.js';
import { truncateUtf8 } from '../../contracts/utf8.js';
import { asRejection } from './consultation.js';
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
  Pick<WorkflowDependencies, 'controls' | 'executions' | 'messages' | 'plans' | 'recipients' | 'runtime' | 'commandReview'>;

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
  const adviser = await commandAdviserOf(ctx, ports, subject, goalRef);
  if (adviser !== null && 'status' in adviser) return adviser;
  if (adviser === null) {
    const refused = await tellHuman(`书记审查：${answer.reason}。没有负责的参谋，平台没有停这条命令：`
      + `${previewOf(subject)}，需要时可以停掉。`);
    return refused ?? reviewApplied('adviser');
  }
  if (ports.messages === undefined) return rejected('unsupported', 'the mailbox is not wired');
  // The reviewed command already ended: nothing of it is left to stop (`not_running`), the adviser is still told.
  const stopped = deps.isCommandRunning(subject.commandKey)
    ? await stopCommandRun(ctx, ports, subject, `${operationId}:cancel`) : 'not_running';
  if (typeof stopped !== 'string') return stopped;
  // D-18: the adviser's notice is a `notify`; no round is opened for it.
  const where = subject.run.kind === 'run' ? `任务 ${subject.run.taskId}` : `问答轮 ${subject.run.queryRunRef.runId}`;
  // The reason has no bound of its own (121-111); the message keeps its existing 16 KiB bound by truncation.
  const notice: SessionMessageSendInputV1['input'] = { recipient: adviser, intent: 'notify', goalRef,
    text: truncateUtf8(`请知悉（不需要回复）：书记审查认为${where}的命令异常，命令已经停下。`
      + `命令：${previewOf(subject)}，已跑 ${minutesOf(subject)} 分钟。原因：${answer.reason}`,
    SESSION_MESSAGE_MAX_TEXT_BYTES) };
  const sent = await ports.messages.sendMessage(ctx, { input: notice, meta: { requestId: `${operationId}:adviser`, expected: [] } });
  if (sent.status !== 'committed') return sent;
  return reviewApplied('adviser');
}

/**
 * Stop the command's round the way any platform stop does. A Query round: `runtime.cancelQuery` (QSTOP's stop).
 * A Work Run: one durable `cancel` pinned to the Run revision just read, then delivered to the live handle; a Run
 * already being cancelled is only delivered again, and a moved revision is returned so the next close-out retries.
 * An ended round is `not_running`, not a refusal.
 */
async function stopCommandRun(ctx: CoreCallContext, ports: CommandReviewPorts, subject: CommandReviewSubjectV1,
  requestId: string): Promise<'stopping' | 'not_running' | CoreRejection> {
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
  if (run.status === 'ended') return 'not_running';
  let intentRef = run.controlState?.desiredState === 'cancelled' ? run.controlState.intentRef : null;
  if (intentRef === null) {
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
