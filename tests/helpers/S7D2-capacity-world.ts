/**
 * O3b's capacity world (`7d2-start-rulings.v4.md` §11 `:8876`, re-based by the write-tests brief
 * `tests-7d2-o3b.txt:27–:33`, lead Q13, plan A): RL-11 and RL-16 (1), (3), (6) run on it. It extends O1b's region
 * world (`openS7D2RegionWorld`, tests/helpers/S7D2-role-line-world.ts) with the adviser Work binding
 * `S7D2_ADVISER_WORK`, `propose_role_split` merged into that binding (`S6A-request-fixture.ts` `mergeTools`), and
 * `scribeReminderPeriodMs: 25` on every Host start (the Host idle cycle). Every step is a public route or a scripted
 * Work Run calling the real tool:
 * - `line`: `role-lines/open` of an adviser on a scope; `newGoal`: `goals/create`; `autonomy`: `goals/settings/set`
 *   at the goal's `goals/read` revision;
 * - `plan`: one Plan on one goal (`plans/propose` + `plans/apply`, `adoptPLMixedPlan`; a goal adopts once), each
 *   Task assigned to its line's role and linked to that line (`sessions/link`);
 * - `split`: one Work Run of a line on one of its Tasks (`workflow/advance`, `runS7D2Work`) whose model calls
 *   `propose_role_split {move, reason}` once and then answers a text; `toolResult` reads that call's tool message
 *   (its `result.status` and JSON block) from the requests the Runtime served the line's model;
 * - `busy`: one person `inquiry` to each line (`messages/send`, `sendS7A2PersonMessage`), so it is not idle;
 * - reads: `decisions/queue` (`queue`; the project subject's cards are in it without a goal), `decisions/card`,
 *   `decisions/answer` (`answer`: the card's own pins), the project notices (`notices`), `projects/role-limits`;
 *   `idle` waits for one Host idle pass (`tests/app/S7A-host-gates.test.ts:59–:62`).
 * No record, context or store is read or written; a route that answers anything but its success throws naming the
 * answer, except `answer`, which hands the body back as the route returned it.
 */
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { DecisionSourceV1, GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RoleLimitsViewV1, RoleScopeV1 } from '../../src/contracts/role-lines.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, NoticeItemV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan } from './PL-consumption-fixture.js';

import { S6A_SCOPE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { jsonOf } from './S7C-member-fixture.js';
import { readS7D1Limits } from './S7D1-allocation-world.js';
import {
  linkS7D2Scopes, openS7D2RegionWorld, runS7D2Work, S7D2_ADVISER_WORK, type S7D2RegionWorld,
} from './S7D2-role-line-world.js';

export type S7D2DecisionSection = 'waiting_answer' | 'answered_pending_application' | 'history';
export type S7D2AnswerBody = { optionId: string; text: string; annotations: readonly { objectKey: string; text: string }[] };

export type S7D2CapacityWorld = S7D2RegionWorld & {
  /** `role-lines/open {duty:'adviser', scope}` as the person; the Session it names. */
  line(label: string, scope: readonly RoleScopeV1[]): Promise<S6ASession>;
  /** `goals/create` of a new goal in the main workspace. */
  newGoal(goalId: string): Promise<GoalRef>;
  /** `goals/settings/set` of the autonomy at the goal's current revision. */
  autonomy(goal: GoalRef, autonomy: GoalAutonomyV1, requestId: string): Promise<void>;
  /** One adopted Plan on `goal`: each Task assigned to its line's role and linked to that line. */
  plan(goal: GoalRef, label: string, tasks: readonly { taskId: string; line: S6ASession }[]): Promise<TaskTriple[]>;
  /** One Work Run of `line` on `task` whose model calls `propose_role_split` once, then answers a text. */
  split(input: { line: S6ASession; task: TaskTriple; callId: string; move: readonly RoleScopeV1[]; label: string }):
    Promise<void>;
  /** The tool message the Runtime served `line`'s model for `callId`: its `result.status` and its JSON block. */
  toolResult(line: S6ASession, callId: string): Promise<{ status: string; json: unknown }>;
  /** One person `inquiry` to each line (`label` names them apart); the messages as `messages/read` returns them. */
  busy(lines: readonly (S6ASession | SessionRef)[], label: string): Promise<SessionMessage[]>;
  /** `decisions/queue` of the main workspace with the card sections named (one page of 100). */
  queue(sections: readonly S7D2DecisionSection[]): Promise<DecisionQueueReadV1>;
  /** `decisions/card` of one source. */
  card(source: DecisionSourceV1): Promise<DecisionCardV1>;
  /** `decisions/answer` on `card` with its own pins; the route's body as returned. */
  answer(card: DecisionCardV1, body: S7D2AnswerBody, requestId: string): Promise<unknown>;
  /** The `project_notice` and `member_created` notices of the main workspace (one page of 100). */
  notices(): Promise<NoticeItemV1[]>;
  /** `projects/role-limits` of the world's project. */
  limits(): Promise<RoleLimitsViewV1>;
  /** One real Host idle pass (the world's `scribeReminderPeriodMs: 25`). */
  idle(): Promise<void>;
};

/** The region world plus the capacity steps (see the header). Memory or SQLite. */
export async function openS7D2CapacityWorld(options: { backend: S6ABackend }): Promise<S7D2CapacityWorld> {
  const region = await openS7D2RegionWorld({ backend: options.backend,
    extraBindings: [S7D2_ADVISER_WORK,
      { binding: { id: S7D2_ADVISER_WORK.binding.id } as WorkbenchRuntimeBinding, mergeTools: ['propose_role_split'] }],
    extraHostOptions: { scribeReminderPeriodMs: 25 } });
  const host = region.world;
  const route = async <T>(suffix: string, input: unknown, what: string): Promise<T> =>
    valueOf<T>(await region.main.route(suffix, input), 'ready', what);
  return {
    ...region,
    async line(label, scope) {
      return await region.lineOf(label, (await region.open({ duty: 'adviser', scope, requestId: label })).result);
    },
    async newGoal(goalId) {
      return (await region.main.createGoal(goalId)).ref;
    },
    async autonomy(goal, autonomy, requestId) {
      const read = await route<{ goal: { revision: number } }>('goals/read', goal, `the goal ${goal.goalId}`);
      valueOf(await region.main.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: goal, autonomy,
        waitForGoalRef: null }, requestId, [{ ref: goal, revision: read.goal.revision }])), 'committed',
      `the ${autonomy} setting of ${goal.goalId}`);
    },
    async plan(goal, label, tasks) {
      const roleOf = (line: S6ASession): string => {
        if (line.role.kind !== 'legacy_template') throw new Error(`S7D2 capacity: ${line.label} has no template role`);
        return line.role.templateId;
      };
      const adopted = await adoptPLMixedPlan(host, { goal, label,
        tasks: tasks.map(task => ({ taskId: task.taskId, role: roleOf(task.line) })) });
      for (const [index, task] of tasks.entries()) {
        await linkS7D2Scopes(host, { line: task.line, targets: [{ kind: 'task', ref: adopted.tasks[index]! }],
          label: `${label}-${task.taskId}` });
      }
      return [...adopted.tasks];
    },
    async split(input) {
      await runS7D2Work(host, { line: input.line, goal: { aggregateType: 'Goal', projectId: input.task.projectId,
        goalId: input.task.goalId }, task: input.task, label: input.label, replies: [
        { kind: 'calls', calls: [{ callId: input.callId, name: 'propose_role_split',
          args: { move: structuredClone([...input.move]), reason: `S7D2 ${input.label}` } }] },
        { kind: 'text', text: `S7D2 ${input.label} done` },
      ] });
    },
    async toolResult(line, callId) {
      const requests = await host.scripted.requests(line);
      for (const request of requests) {
        const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
        if (message === undefined || message.role !== 'tool') continue;
        return { status: (message.result as { status: string }).status, json: jsonOf(requests, callId) };
      }
      throw new Error(`S7D2 capacity: no model request of ${line.label} carries the tool result ${callId}`);
    },
    async busy(lines, label) {
      const sent: SessionMessage[] = [];
      for (const [index, line] of lines.entries()) {
        sent.push(await sendS7A2PersonMessage(host, { label: `${label}-${String(index)}`,
          recipient: 'ref' in line ? line.ref : line }));
      }
      return sent;
    },
    queue: sections => route<DecisionQueueReadV1>('decisions/queue', { workspace: { ...S6A_SCOPE },
      sections: [...sections], page: { limit: 100 } }, 'the decision queue'),
    card: source => route<DecisionCardV1>('decisions/card', { source }, `the ${source.kind} card`),
    async answer(card, body, requestId) {
      return await region.main.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
        selection: { kind: 'option', optionId: body.optionId }, text: body.text,
        annotations: structuredClone([...body.annotations]) }, requestId, card.source.pins));
    },
    async notices() {
      const read = await route<DecisionQueueReadV1>('decisions/queue', { workspace: { ...S6A_SCOPE },
        sections: ['notices'], categories: ['project_notice', 'member_created'], page: { limit: 100 } }, 'the notices');
      if (read.nextCursor !== null) throw new Error('S7D2 capacity: more than 100 notices');
      return read.notices;
    },
    limits: () => readS7D1Limits(host),
    async idle() {
      const settled = host.consumeBarrier();
      host.clock.advance(25);
      await settled;
    },
  };
}

