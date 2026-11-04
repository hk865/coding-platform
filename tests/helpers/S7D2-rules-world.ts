/**
 * O3b's rules world (`7d2-start-rulings.v4.md` §11 `:8878`; the write-tests brief `tests-7d2-o3b.txt:34`, lead Q14):
 * the world RL-15 and RL-17 run on. It extends `openS7C1World` (tests/helpers/S7C-member-fixture.ts), which already
 * governs the project, and adds through public steps only:
 * - the three callers of `create_member`: E = the S7C no-create executor line (`s7c-executor-binding`; this world's
 *   `configure` gives its grant the `create_member` tool and no `createMember`), Q = the S7C adviser line
 *   (`s7c-adviser-binding`, `createMember: true`), S = a secretary request round (`holdS6BRequestRound`) whose
 *   binding gets `create_member` merged through `extraBindings` (the precedent `S7D1-project-card-world.ts:107`);
 * - a new goal G with one adopted Plan of the caller's Tasks (`plans/propose` + `plans/apply`; an optional
 *   precise-input dependency), G set `every_step` (`goals/settings/set`), and an adviser line opened on G
 *   (`role-lines/open`; `later-rows-merged.md:217`: a secretary's member needs a responsible adviser);
 * - the four autonomy-rule routes (`autonomy-rules`, `autonomy-rules/create|revoke|update`, v4 `:6421–:6424`) and
 *   the limits write (`projects/role-limits/set`).
 * Work Runs call the real tool through `askS7D2Member` (tests/helpers/S7D2-role-line-world.ts). No record, context
 * or store is touched; a route the tree does not publish answers its HTTP error, which a write step throws naming
 * the status and body, never reading it as a business answer. Callers close their own instance.
 */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { ag2bPlanDraft, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { secretaryAnswer } from './S6A-history-fixture.js';
import { S6A_SCOPE, type S6ABackend, type S6AHttpAnswer } from './S6A-request-fixture.js';
import { holdS6BRequestRound } from './S6B1-fixture.js';
import { committed, setS7AAutonomy } from './S7A-fixture.js';
import { jsonOf, openS7C1World, type S7C1World } from './S7C-member-fixture.js';
import { readS7D1Limits, setS7D1Limits } from './S7D1-allocation-world.js';
import { openS7D2Line } from './S7D2-role-line-world.js';

export type S7D2RulesTask = { taskId: string; role: string };

export type S7D2RulesWorld = S7C1World & {
  /** G: the new every-step goal with the adopted Plan of `tasks`. */
  readonly g: GoalRef;
  readonly gTask: (taskId: string) => TaskTriple;
  /** The adviser line `role-lines/open` opened on G. */
  readonly gAdviser: SessionRef;
  /** `autonomy-rules/<suffix>` (`''` is the plain read) as the person; answers the HTTP answer unchanged. */
  rules(suffix: '' | 'create' | 'revoke' | 'update', input: unknown, requestId?: string): Promise<S6AHttpAnswer>;
  /** The `autonomy-rules` view; throws naming the answer when it is not ready. */
  readRules(): Promise<{ set: { revision: number }; rules: Array<{ ref: { ruleId: string }; revision: number }
    & Record<string, unknown>> }>;
  /** `projects/role-limits/set` of the open levels at the current limits revision; must commit. */
  setOpen(open: Record<string, number>, commandId: string): Promise<void>;
  /** S: one real secretary request round on G whose model calls `create_member` for `memberTask`; the tool result. */
  secretaryMember(memberTask: TaskTriple, label: string): Promise<MemberRequestResultV1>;
};

export async function openS7D2RulesWorld(options: { backend?: S6ABackend; tasks: readonly S7D2RulesTask[];
  dependsOn?: PlanRevisionDraft['executionDag']['dependsOn'] }): Promise<S7D2RulesWorld> {
  const s7c = await openS7C1World({ backend: options.backend ?? 'memory',
    extraBindings: [{ binding: { id: 's6a-secretary-binding' } as WorkbenchRuntimeBinding, mergeTools: ['create_member'] }],
    configure: configuration => {
      const executor = configuration.bindings.find(binding => binding.id === 's7c-executor-binding');
      if (executor === undefined) throw new Error('S7D2 rules: the S7C executor binding is missing');
      executor.grant = { ...executor.grant, tools: [...executor.grant.tools, 'create_member'] };
    } });
  const { world, main } = s7c;
  try {
    const g = (await main.createGoal('s7d2-rules-g', 'S7D2 rules goal G')).ref;
    const taskIds = options.tasks.map(task => task.taskId);
    const draft: PlanRevisionDraft = { ...ag2bPlanDraft(taskIds), planId: 's7d2-rules-plan', goalId: g.goalId,
      assignments: options.tasks.map(task => ({ taskId: task.taskId, role: task.role, instruction: `S7D2 ${task.taskId}` })),
      executionDag: { dependsOn: structuredClone([...(options.dependsOn ?? [])]) } };
    const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: g, basedOn: null, draft, reason: { text: 'S7D2 rules plan', sources: [] } }, 's7d2-rules-propose')),
    'the G Plan proposal');
    committed(await main.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
      expectedProposalRevision: proposed.revision, decisionRefs: [] }, 's7d2-rules-apply')), 'the G Plan adoption');
    await setS7AAutonomy(world, g, 'every_step');
    const adviser = committed<{ session: SessionRef | null }>((await openS7D2Line(world, { duty: 'adviser',
      scope: [{ kind: 'goal', goalRef: g }], requestId: 's7d2-rules-g-adviser' })).result, 'the adviser line on G');
    if (adviser.session === null) throw new Error('S7D2 rules: the adviser line on G has no Session');
    const rules: S7D2RulesWorld['rules'] = async (suffix, input, requestId) => await world.post(
      suffix === '' ? 'autonomy-rules' : `autonomy-rules/${suffix}`,
      suffix === '' ? plain(S6A_SCOPE, input) : graphWrite(S6A_SCOPE, input, requestId ?? `s7d2-rules-${suffix}`));
    return { ...s7c, g, gAdviser: adviser.session, rules,
      gTask: taskId => ({ projectId: g.projectId, goalId: g.goalId, taskId }),
      async readRules() {
        const answer = await rules('', { projectRef: { projectId: S6A_SCOPE.projectId } });
        const body = answer.body as { status?: string; value?: unknown };
        if (body.status !== 'ready') throw new Error(`S7D2 rules: autonomy-rules answered HTTP ${String(answer.httpStatus)}: ${JSON.stringify(body)}`);
        return body.value as Awaited<ReturnType<S7D2RulesWorld['readRules']>>;
      },
      async setOpen(open, commandId) {
        const limits = await readS7D1Limits(world);
        committed((await setS7D1Limits(world, { open }, limits.revision, commandId)).body, `the limits ${commandId}`);
      },
      async secretaryMember(memberTask, label) {
        const callId = `${label}-create-member`;
        const held = await holdS6BRequestRound(world, { label, goalId: g.goalId, replies: () => [
          { kind: 'calls', calls: [{ callId, name: 'create_member', args: { duty: 'executor',
            scope: { kind: 'task', task: memberTask }, reason: `S7D2 ${label}` } }] },
          { kind: 'text', text: secretaryAnswer({ body: `S7D2 ${label} answer` }) },
        ] }, async round => round.secretary);
        return jsonOf(await world.scripted.requests(held.value), callId) as MemberRequestResultV1;
      } };
  } catch (error) {
    await s7c.close().catch(() => undefined);
    throw error;
  }
}
