/**
 * M-ceiling (`book-7c.md:1357`, L37): the next preparation of a Work-created line stays inside the creator's accepted
 * permissions. The creator is FX-02's real tool-bearing Work Run; the child is created by the real `create_member`
 * tool through the real line creation, and its stored `delegationCeiling` is the creator's permissions. The child is
 * claimed through the public `claims.claimTask` and prepared through `runtime.prepareExecution`, so the refusal is
 * established directly.
 *
 * The outside arm requests a Task whose executor binding grants `['.']` outside the creator's frozen `writeScope: []`:
 * the preparation is refused before any Run starts. The named mutation is the row's: delete the writeScope containment
 * in `src/core/work-graph/tasks/pick-authorization.ts:34–36` and the outside-scope preparation becomes ready.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { jsonOf, openS7C1World, startS7C1ToolLine, type S7C1World } from '../helpers/S7C-member-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

/** Claim the child through the public owner, then prepare it; a refusal is the prepare result. */
async function prepareReceipt(target: S7C1World, child: { projectId: string; sessionId: string },
  task: TaskTriple, label: string) {
  const plan = await target.main.activePlan(target.goal);
  if (plan === null) throw new Error('S7C ceiling: the Goal has no adopted Plan');
  const registration = ready<{ workspace: { revision: number } }>(await target.main.route(
    'workspaces/registration', { projectId: target.world.scope.projectId,
      workspaceId: target.world.scope.workspaceId }), 'the workspace registration');
  const goalRead = ready<{ goal: { revision: number } }>(await target.main.route('goals/read', target.goal),
    'the Goal revision');
  const session = await target.world.readSession(child);
  const roleBinding = {
    schemaVersion: 1 as const, bindingId: 's7c-create-binding', templateId: 's7c-executor',
    templateRevision: '1', bindingVersion: 1, policyRevision: 's7c-create-binding@1',
  };
  const expected = [
    { ref: target.goal, revision: goalRead.goal.revision },
    { ref: { aggregateType: 'Workspace' as const, projectId: target.world.scope.projectId,
      workspaceId: target.world.scope.workspaceId }, revision: registration.workspace.revision },
    { ref: { aggregateType: 'Session' as const, projectId: child.projectId, sessionId: child.sessionId },
      revision: session.record.revision },
  ];
  const claimed = await target.world.platform.claims.claimTask(target.world.humanContext(), {
    input: { goalRef: target.goal, planRef: plan.ref, taskId: task.taskId,
      sessionRef: { projectId: child.projectId, sessionId: child.sessionId }, roleBinding,
      budget: { tokenBudget: 100_000, deadline: null } },
    meta: { requestId: `s7c-ceiling-claim-${label}`, expected },
  });
  if (claimed.status !== 'committed') {
    throw new Error(`S7C ceiling: the child was not claimed: ${JSON.stringify(claimed)}`);
  }
  return await target.world.platform.runtime.prepareExecution(target.world.humanContext(),
    { runRef: claimed.value.runRef, requestId: `s7c-ceiling-prepare-${label}` });
}

describe('M-ceiling: a Work-created line', () => {
  it('refuses a preparation outside the creator scope', async () => {
    world = await openS7C1World();
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    // Task n1's executor binding grants writeScope ['.']; the creator's envelope freezes [].
    const task = world.tasks[2]!;
    const line = await startS7C1ToolLine(world, { task });
    const caller = world.lines.adviser;
    if (caller === null) throw new Error('S7C ceiling: the world was opened without its adviser caller line');
    const created = jsonOf(await world.world.scripted.requests(caller), 's7c-tool-call') as MemberRequestResultV1;
    if (created.status !== 'created') throw new Error(`S7C ceiling: no child: ${JSON.stringify(created)}`);
    const permissions = line.work.execution.run.envelope?.permissions;
    if (permissions === undefined) throw new Error('S7C ceiling: the creator Run has no accepted envelope');
    expect(permissions.writeScope).toEqual([]);
    expect(permissions.createMember).toBe(true);
    const child = await world.world.readSession(created.session);
    expect(child.record.delegationCeiling).toEqual({
      tools: permissions.tools, writeScope: permissions.writeScope, createMember: permissions.createMember,
    });

    // The child's own binding grants `['.']`, outside the creator's `[]`: refused before any Run starts.
    const prepared = await prepareReceipt(world, created.session, task, 'outside');
    expect(prepared).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
