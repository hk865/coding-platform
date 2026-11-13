/**
 * E38-R11, E38-R12 (e38-spec.md §3.3, §4, §7 R11/R12; e38-tests-brief.md "段 C 的行"): the executor's task section
 * and the reviewer's candidate text carry a task's `plannedFiles` row only when the plan wrote a list.
 *
 * R11 takes the brief's second way (public steps; the brief allows one of two). `taskPayload(plan, record, graph)`
 * (`src/core/agent-runtime/context-fact-text.ts:231`) types `record` as the whole `TaskExecutionRecord`
 * (`src/core/work-graph/model/execution-read-contracts.ts:25–:33`: Run, attempt, outbox, Plan, Session, lease and
 * read watermark, all required), so a "minimal" record without a type assertion is a full Run and claim. Instead the
 * PL workflow world adopts one Plan through `plans/propose` + `plans/apply` (`adoptPLPlanDraft`), each Task runs one
 * real Work Run on a line of its own (`satisfyPLTask`: claim, start, one scripted text reply, stopped before
 * `open_checks`; every step is awaited, so there is no background window), and the task section is read back from
 * that Run's model request in the line's scripted request log (the reading of `A-01-review-tool.test.ts:73–:75`).
 * The listed Task is module `s6a-core` (`plSkeletonDraft`'s module work, the G-01 module cell); the unlisted Task is
 * a stage-1 Task of the same Plan.
 *
 * R12 follows A-01's world: `openPLReviewWorld` and the public steps of `openPLReviewCandidateWorld`
 * (PL-forms-fixture.ts:269–:345, whose candidate is fixed, so the steps are written here): governance, one adopted
 * Plan, one `plans/propose` candidate that changes its work Task only by adding `plannedFiles`, the goal driver's
 * `planreview:` round on the reviewer line, and the reviewer's model input read as A-01 `:73–:81` does.
 *
 * Expected literals are the spec's: §4 `context.task.plannedFiles` = `plannedFiles（预计要改的文件，只是提示，不是限制）: `
 * with the paths joined by `, ` (§3.3), right after the `module: ` row; the reviewer row `plannedFiles: <路径, 路径>`.
 */
import { describe, expect, it } from 'vitest';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { awaitPlanningAnswer, heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { openPLReviewWorld } from '../helpers/PL-forms-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plSkeletonDraft, satisfyPLTask,
} from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, sessionOf } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';

const PLANNED = ['src/a.ts', 'src/b.ts'];

/** One model request's input text: every string content joined (A-01 `:73–:75`). */
const inputText = (request: ModelRequest): string => request.messages.map(message =>
  'content' in message && typeof message.content === 'string' ? message.content : '').join('\n');

/** The task section's rows of `taskId`: from `task: <title> (<taskId>)` to `failure: null`, its first and last rows
 *  (context-fact-text.ts:257, :271). Not found is a broken world, never the row's red. */
function taskSection(input: string, taskId: string): string[] {
  const rows = input.split('\n');
  const start = rows.findIndex(row => row.startsWith('task: ') && row.endsWith(` (${taskId})`));
  const end = start < 0 ? -1 : rows.indexOf('failure: null', start);
  if (start < 0 || end < 0) throw new Error(`E38-R11: the Work input has no task section of ${taskId}: ${input}`);
  return rows.slice(start, end + 1);
}

describe('E38-R11: the executor task section', () => {
  it('puts the plannedFiles row right after module: only for the task that wrote a list', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'e38-r11' });
    try {
      const { goal, main, world } = workflow;
      const base = plSkeletonDraft(goal, { label: 'e38-r11', stageOneTaskIds: ['e38-r11-plain'],
        moduleGate: { stageId: 'pl-stage-1', moduleRef: 's6a-core', workTaskId: 'e38-r11-listed' } });
      await adoptPLPlanDraft(main, goal, { ...base, tasks: base.tasks.map(task => task.taskId === 'e38-r11-listed'
        ? { ...task, plannedFiles: [...PLANNED] } : task) }, 'e38-r11');

      /** One real Work Run of `taskId` on its own line; the task section of that Run's (only) model request. */
      const sectionOf = async (taskId: string): Promise<string[]> => {
        const line = await sessionOf(world, await createS6BLine(main, { label: taskId, role: S6A_WORK_ROLE,
          tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId }] }));
        await satisfyPLTask(world, goal, taskId, line, 'e38-r11', { stopBefore: 'open_checks' });
        const request = (await world.scripted.requests(line))[0];
        if (request === undefined) throw new Error(`E38-R11: the ${taskId} Run served no model request`);
        return taskSection(inputText(request), taskId);
      };
      const listedSection = await sectionOf('e38-r11-listed');
      const plainSection = await sectionOf('e38-r11-plain');
      const moduleRow = listedSection.findIndex(row => row.startsWith('module: '));
      if (moduleRow < 0) throw new Error(`E38-R11: the listed task section has no module: row: ${listedSection.join('\n')}`);

      /* Named mutation (cell 1): in `taskPayload` (src/core/agent-runtime/context-fact-text.ts:231) leave out the
         `context.task.plannedFiles` row, or push it after `requirementLevel: ` instead of right after `module: `;
         red at the next `expect` (the row after `module: s6a-core` is `requirementLevel: required`). */
      expect(listedSection[moduleRow + 1]).toBe('plannedFiles（预计要改的文件，只是提示，不是限制）: src/a.ts, src/b.ts');
      /* Named mutation (cell 2, the brief's): in `taskPayload` push the `context.task.plannedFiles` row even when the
         task has no `plannedFiles` (an empty join); red at the next `expect` (the unlisted section gains
         `plannedFiles（预计要改的文件，只是提示，不是限制）: `). */
      expect(plainSection.filter(row => row.includes('plannedFiles'))).toEqual([]);
    } finally { await workflow.close(); }
  }, 120_000);
});

describe('E38-R12: the reviewer candidate text', () => {
  it('carries the changed task’s plannedFiles row', async () => {
    const opened = await openPLReviewWorld({ configuration: 'no_secretary' });
    try {
      const { world, reviewer } = opened;
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = world.goals.first;
      const { plan } = await adoptS6BPlan(main, goal, {
        label: 'e38-r12', role: S6A_WORK_ROLE.templateId, taskIds: ['e38-r12-work'],
      });
      // The candidate changes only the work Task's list: a changed execution definition (plan-task-basis.ts:208–:212).
      const draft = draftFrom(plan, 'e38-r12-candidate', candidate => ({ ...candidate,
        tasks: candidate.tasks.map(task => task.taskId === 'e38-r12-work' ? { ...task, plannedFiles: [...PLANNED] } : task) }));
      const proposed = committed<{ ref: PlanProposalRef; revision: number }>(await main.post('plans/propose',
        graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: plan.ref, draft, reason: { text: 'E38-R12 candidate', sources: [] } },
          'e38-r12-candidate-propose')), 'the E38-R12 candidate');
      await opened.script([{ kind: 'calls', calls: [{
        callId: 'e38-r12-pass', name: 'submit_plan_review', args: { verdict: 'pass', findings: [] },
      }] }]);
      await startGoalDriver(world, goal, 'e38-r12-flow');

      const requestId = systemRoundRequestId({ kind: 'planreview', goalRef: goal,
        proposalId: proposed.ref.proposalId, proposalRevision: proposed.revision });
      if (requestId.status !== 'ready') throw new Error('E38-R12: the review round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (messageRef.status !== 'ready') throw new Error('E38-R12: the review round has no message ref');
      const inbox = await heartbeatUntil(world, () => listed(world, 'inbox', reviewer),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      if (!inbox.some(message => message.ref.messageId === messageRef.value.messageId)) {
        throw new Error('E38-R12: the goal driver sent no planreview: round to the reviewer line');
      }
      const reviewed = await awaitPlanningAnswer(world, messageRef.value);
      if (reviewed?.job.job.status !== 'answered') {
        throw new Error(`E38-R12: the review Query was not answered: ${JSON.stringify(reviewed?.job.job ?? null)}`);
      }
      const input = (await world.scripted.requests(reviewer)).map(inputText).find(text => text.includes('## 计划候选审阅'));
      if (input === undefined) throw new Error('E38-R12: no reviewer model request carries the candidate text');

      /* Named mutation: in the review candidate text (`reviewCandidateText`,
         src/core/agent-runtime/query-preparation.ts:119) leave out the `plannedFiles: ` row after `sizeClass`;
         red at the next `expect`. */
      expect(input).toContain('plannedFiles: src/a.ts, src/b.ts');
    } finally { await opened.close(); }
  }, 120_000);
});
