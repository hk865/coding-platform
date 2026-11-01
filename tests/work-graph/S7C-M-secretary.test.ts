/**
 * M-secretary (book-7c.md:1355): the member request a real secretary QueryRun makes on the Goal's adopted-plan task.
 *
 * The caller context is the Runtime's own `query_run` context of a real held request round (`holdS7AQueryRound`,
 * `S7A-fixture.ts:421`); the request goes through the fixture's real member service, the real adopted Plan read, the
 * real duty resolver and the real request-owner read. Autopilot (`after_plan_confirmation`) creates the child line,
 * whose Session read back carries `secretaryCreated`; the next real preparation of that line is inspected at its
 * `prepare` receipt (the Workflow is stopped before `start`). The fixture gives that child the `createMember: true`
 * executor binding (`tests/helpers/S7C-member-fixture.ts:80-81`, `:135`), so `createMember: false` at prepare is the
 * pin's own effect: ignoring `session.secretaryCreated` in preparation makes this row read true. The same preparation
 * keeps the executor binding's own `writeScope: ['.']` (L37's contained-child arm). A world opened with
 * `adviser: false` has no responsible adviser, and a round whose request root the person has dropped has no current
 * owner.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { holdS7AQueryRound, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import type { S6BHeldRound } from '../helpers/S6B1-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

function secretaryCaller(round: S6BHeldRound) {
  return {
    kind: 'secretary_query' as const,
    session: structuredClone(round.secretary.ref),
    run: structuredClone(round.prepared.queryRunRef),
    round: structuredClone(round.request.round),
    requestRoot: structuredClone(round.request.requestRoot),
  };
}

/** The one real secretary request: the Runtime's own `query_run` context, the fixture's member service. */
async function requestAsSecretary(world: S7C1World, input: {
  label: string; task: TaskTriple; commandId: string;
  before?: (round: S6BHeldRound) => Promise<void>;
}) {
  return await holdS7AQueryRound(world.world, { label: input.label, goalId: world.goal.goalId },
    async (context, round) => {
      if (input.before !== undefined) await input.before(round);
      return await world.member.request.requestMember(context, {
        commandId: input.commandId,
        caller: secretaryCaller(round),
        duty: 'executor',
        scope: { kind: 'task', task: structuredClone(input.task) },
        reason: `S7C secretary request ${input.label}`,
      });
    });
}

async function prepareChild(world: S7C1World, child: SessionRef, task: TaskTriple, label: string) {
  const claimInput = await advanceUntil(world.world.ag2b, {
    schemaVersion: 1, goalRef: world.goal, flowId: `s7c-secretary-${label}`, sessionHint: child,
    kind: 'select_work', taskId: task.taskId,
  }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.world.ag2b, claimInput, { stopBefore: 'start', receipts });
  const prepare = receipts.find(receipt => receipt.kind === 'prepare');
  if (prepare === undefined || prepare.result.status !== 'ready') {
    throw new Error(`S7C secretary: the child did not prepare: ${JSON.stringify(receipts)}`);
  }
  return prepare.result.value;
}

describe('M-secretary: a real secretary_query caller', () => {
  it('creates the child under autopilot and stores the secretary pin', async () => {
    world = await openS7C1World();
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    const task = world.tasks[1]!;
    const result = await requestAsSecretary(world, { label: 'create', task, commandId: 's7c-secretary-create' });
    expect(result).toMatchObject({ status: 'created' });
    if (result.status !== 'created') return;
    const card = await world.world.readSession(result.session);
    expect(card.record.secretaryCreated).toBe(true);
    expect(card.record.delegationCeiling).toBeUndefined();
    expect(result.session).not.toEqual(world.lines.module.ref);
  });

  it('prepares the secretary-created line with the executor write scope', async () => {
    world = await openS7C1World();
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    // Task n1 is linked to no existing line, so the child is the only responsible line the Workflow can claim.
    const task = world.tasks[2]!;
    const result = await requestAsSecretary(world, { label: 'prepare', task, commandId: 's7c-secretary-prepare' });
    if (result.status !== 'created') throw new Error(`S7C secretary: the request did not create: ${JSON.stringify(result)}`);
    const prepared = await prepareChild(world, result.session, task, 'prepare');
    // The child's Host binding grants createMember; only the secretary pin can make this false.
    expect(prepared.envelope.permissions.createMember).toBe(false);
    expect(prepared.envelope.permissions.tools).toEqual(['read']);
    expect(prepared.envelope.permissions.writeScope).toEqual(['.']);
  });
});

describe('M-secretary: rejections', () => {
  it('rejects a world without a responsible adviser as invalid/no_responsible_adviser', async () => {
    world = await openS7C1World({ adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    const result = await requestAsSecretary(world, {
      label: 'no-adviser', task: world.tasks[1]!, commandId: 's7c-secretary-no-adviser',
    });
    expect(result).toEqual({ status: 'rejected', code: 'invalid', reason: 'no_responsible_adviser' });
  });

  it('rejects a QueryRun whose request root the person dropped as forbidden', async () => {
    world = await openS7C1World();
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    const result = await requestAsSecretary(world, {
      label: 'not-owner', task: world.tasks[1]!, commandId: 's7c-secretary-not-owner',
      before: async round => {
        const routed = await world!.world.drop({ commandId: 's7c-secretary-not-owner-drop', round: round.request.round });
        if (routed.status !== 'routed') {
          throw new Error(`S7C secretary: the request root was not dropped: ${JSON.stringify(routed)}`);
        }
      },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
