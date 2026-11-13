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
 *
 * 7D2 JIA-7 (121-109, MVP-BEHAVIOR:327): an adviser-built executor line takes the Host's executor grant, not the
 * adviser's own envelope: tools and write scope come from the executor binding, `createMember` stays false (a further
 * delegation is a separate act), and the record carries no `delegationCeiling`. That row is EXPECTED RED today at
 * `:109`: the member service still stores the adviser's envelope. Once that assertion is green (the package landed),
 * the child would still sit outside its `[]` ceiling and the pre-claim authorization would refuse it, so
 * `select_work` would answer `suggest_member`, not `responsible_task`; the rest of the row names that landed shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimOf, jsonOf, openS7C1World, startS7C1ToolLine, S7C1_CREATE_ROLE,
  type S7C1World } from '../helpers/S7C-member-fixture.js';

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
    // Hold the module line's first Run so the executor caller line is the only free line with the
    // creator Role; otherwise the selector reuses the module line and never reaches the caller script.
    world = await openS7C1World({ firstRun: 'held' });
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    // Task n1's executor binding grants writeScope ['.']; the creator's envelope freezes [].
    const task = world.tasks[2]!;
    const line = await startS7C1ToolLine(world, { task, caller: 'work' });
    const caller = world.lines.work;
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

  it('JIA-7: an adviser-built executor line takes the Host executor grant', async () => {
    // The child's own executor binding grants the whole workspace and both file tools; 121-109 says an
    // adviser-built executor line takes exactly this grant, not the adviser's read-only envelope.
    world = await openS7C1World({ configure: configuration => {
      const binding = configuration.bindings.find(entry => entry.id === 's7c-create-binding');
      if (binding === undefined) throw new Error('JIA-7: the create binding is missing');
      binding.grant = { ...binding.grant, tools: ['read', 'write'] };
    } });
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    const task = world.tasks[2]!;
    await startS7C1ToolLine(world, { task });
    const adviser = world.lines.adviser;
    if (adviser === null) throw new Error('JIA-7: the world has no adviser line');
    const created = jsonOf(await world.world.scripted.requests(adviser), 's7c-tool-call') as MemberRequestResultV1;
    if (created.status !== 'created') throw new Error(`JIA-7: no child: ${JSON.stringify(created)}`);
    const child = await world.world.readSession(created.session);
    // 121-109: no ceiling (the executor grant is the whole grant) and no member-creation right.
    expect(child.record.delegationCeiling).toBeUndefined();
    expect(child.record.secretaryCreated).toBe(true);
    // `pickBasisRank` names the winner's deciding key against a runner-up; fewer than two candidates is
    // `none` (`S7C1-P-rank.test.ts:8`). Add one idle line with the same executor Role and no responsible
    // link, so the child's task link is the first key that actually decides.
    const runnerUp = await sessionOf(world.world, await createS6BLine(world.main, {
      label: 'jia-adviser-runner-up', role: S7C1_CREATE_ROLE }));
    expect(runnerUp.ref).not.toEqual(child.record.ref);
    // The same handle `sessionOf` builds for a created line, over this child's public read.
    const childLine: S6ASession = { label: 'jia-adviser-child', ref: child.record.ref,
      aggregateRef: child.record.ref, role: structuredClone(child.record.role), createdAt: child.record.createdAt };

    // The child's own Run writes the file the Host grant allows, then answers.
    await world.world.scripted.script(childLine, [
      { kind: 'calls', calls: [{ callId: 'jia-adviser-write', name: 'edit', args: {
        mode: 'create', path: 'jia-adviser.txt', newText: 'jia\n' } }] },
      { kind: 'text', text: 'JIA-7 answer' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    // MVP-BEHAVIOR:320's first selection key: the child holds the Task's responsible link while the
    // other idle executor line does not, so the child wins on `responsible_task`.
    const steps = await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
      flowId: 'jia-adviser-line', sessionHint: childLine.ref, kind: 'select_work', taskId: task.taskId },
    { stopBefore: 'open_checks', receipts });
    expect(steps[0]?.pick).toMatchObject({ rank: 'responsible_task', incomplete: [], candidates: 2 });
    const claim = receipts.find(receipt => receipt.kind === 'claim_task');
    if (claim === undefined || claim.result.status !== 'committed') {
      throw new Error(`JIA-7: the child was not claimed: ${JSON.stringify(receipts)}`);
    }
    const execution = await readExecution(world.world.ag2b, claimOf(receipts));
    expect(execution.session.ref).toEqual(child.record.ref);
    expect(execution.run.envelope?.permissions).toMatchObject({
      writeScope: ['.'], createMember: false, tools: ['read', 'write'],
    });
    // Run ended normally; a Run's end is not a Task/Goal completion (AGENTS rule 4).
    expect(execution.run).toMatchObject({ status: 'ended', outcome: 'completed' });

    const file = await world.world.post('files/read', plain(S6A_SCOPE, {
      workspace: { aggregateType: 'Workspace' as const, ...S6A_SCOPE },
      path: 'jia-adviser.txt', maxBytes: 4096, version: { kind: 'working_tree' as const },
    }));
    expect(file.body).toMatchObject({ status: 'ready', value: { path: 'jia-adviser.txt', content: 'jia\n' } });
  });
});
