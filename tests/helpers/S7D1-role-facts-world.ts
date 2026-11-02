/**
 * FX-7D1-01b: the creator chain `G3-facts` reads. Line A is a person's `sessions/create` with the executor creation
 * intent; line E is created by A's real Work Run through 7C's `create_member`; A is then fully handed off to S, S is
 * partially handed off to P, S is archived and reactivated, and P reuses E with the same `create_member` entry.
 * Every fact is the platform's own: the Host is configured once before its start (A's Work binding carries
 * `create_member` and `createMember`), and the registration commits are observed through `holdAfter`, never read
 * from a store. `sessions/archive` and `sessions/reactivate` are the real routes; `driveS6BHandoff` is the real
 * handoff driver. The test file installs the commit barrier's two `vi.mock`s.
 */
import type { SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { HandoffProgressV1 } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { byIdentityPrefix, commitBarrier } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { governS6B, seedS6BHandoffLines } from './S6B1-fixture.js';
import { driveS6BHandoff } from './S6B2-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { linkTask } from './S7C-handoff-fixture.js';
import { jsonOf, withConfiguredHost } from './S7C-member-fixture.js';
import { sessionOf, setS7AAutonomy } from './S7A-fixture.js';
import { archiveS7D1Session, reactivateS7D1Session } from './S7D1-allocation-world.js';

const MEMBER_REASON = 'S7D1 role-facts chain';
const chainLineOf = (label: string, ref: SessionRef, operation: OperationRef) => ({ label, ref, operation });

/**
 * Run `run` while the next Session registration is held after its real commit: the platform's own commit comes
 * back as the observable, and the caller then continues unchanged.
 */
export async function heldRegistration<T>(label: string, run: () => Promise<T>):
Promise<{ value: T; commit: PreparedCommit }> {
  const hold = commitBarrier.holdAfter(byIdentityPrefix('session-register:'), label);
  try {
    const pending = run();
    const raced = await Promise.race([
      hold.reached.then(commit => ({ kind: 'commit' as const, commit })),
      pending.then(value => ({ kind: 'value' as const, value })),
    ]);
    if (raced.kind !== 'commit') throw new Error(`S7D1: ${label} finished without a registration commit`);
    hold.release();
    return { value: await pending, commit: raced.commit };
  } finally {
    hold.release();
  }
}

/** A's Work binding is the real one; one Host start with its tools, `createMember` widened and the request driver on. */
async function openConfiguredWorld(backend: S6ABackend): Promise<S6AHostWorld> {
  return await withConfiguredHost(() => openS6AHostWorld({
    backend, extraHostOptions: { requestDriver: 'on' },
  }), original => async hostOptions => {
    const work = hostOptions.runtimeConfiguration?.bindings.find(binding => binding.id === 's6a-work-binding');
    if (work === undefined) throw new Error('S7D1: the Host has no work runtime binding');
    work.grant = { ...work.grant, createMember: true,
      tools: [...new Set([...work.grant.tools, 'create_member'])] };
    return await original(hostOptions);
  });
}

export type S7D1RoleFactsChain = {
  readonly world: S6AHostWorld;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  readonly A: S6ASession;
  readonly E: S6ASession;
  readonly S: S6ASession;
  readonly P: S6ASession;
  readonly member: {
    readonly created: Extract<MemberRequestResultV1, { status: 'created' }>;
    readonly reused: Extract<MemberRequestResultV1, { status: 'reused' }>;
  };
  /** The real registration commits, as `holdAfter` returned them: A, E, the full successor and the partial one. */
  readonly registrations: { readonly A: PreparedCommit; readonly E: PreparedCommit;
    readonly full: PreparedCommit; readonly partial: PreparedCommit };
  readonly handoffs: {
    /** `createOperation` is the successor's real create operation, read back from the handoff's saved progress. */
    readonly full: { readonly operation: OperationRef; readonly createOperation: OperationRef;
      readonly successor: SessionRef; readonly progress: HandoffProgressV1 };
    readonly partial: { readonly operation: OperationRef; readonly successor: SessionRef;
      readonly progress: HandoffProgressV1 };
  };
  readonly archive: { readonly session: SessionRef };
  readonly reactivate: { readonly session: SessionRef };
  readonly close: () => Promise<void>;
};

/** Open one configured world and build the whole chain; closes it only when setup fails. */
export async function seedS7D1RoleFactsChain(options: { backend: S6ABackend }): Promise<S7D1RoleFactsChain> {
  const world = await openConfiguredWorld(options.backend);
  try {
    const main: S6ACardsWorkspace = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = world.goals.first;
    const { tasks } = await seedS6BHandoffLines(main, goal, 's7d1-facts');
    await setS7AAutonomy(world, goal, 'after_plan_confirmation');

    // A: the person's executor line, with the intent's creator deliberately not the trusted actor.
    const createA = await heldRegistration('S7D1 A registration', () => main.route('sessions/create', {
      workspace: { ...S6A_SCOPE }, role: S6A_WORK_ROLE, recommendedRefs: [],
      initialLinks: tasks.map(task => ({ target: { kind: 'task' as const, ref: task },
        relation: 'responsible' as const })),
      meta: { requestId: 's7d1-facts-a', expected: [] },
      creation: { duty: 'executor' as const, scope: { kind: 'project' as const }, reason: 'start_lines',
        creator: { kind: 'human' as const, id: 's7d1-person' } },
    }));
    const aValue = valueOf<{ ref: SessionAggregateRef }>(createA.value, 'completed', 'the A line');
    const aOperation = isRecord(createA.value) ? createA.value['operationRef'] : null;
    if (!isRecord(aOperation)) throw new Error('S7D1: the A line has no creation operation');
    const A = await sessionOf(world, chainLineOf('s7d1-A',
      { projectId: aValue.ref.projectId, sessionId: aValue.ref.sessionId }, aOperation as unknown as OperationRef));

    // E: A's real Work Run calls the real create_member for the Plan's third task.
    await world.scripted.script(A, [
      { kind: 'calls', calls: [{ callId: 's7d1-member-call', name: 'create_member',
        args: { duty: 'executor', scope: { kind: 'task', task: tasks[2]! }, reason: MEMBER_REASON } }] },
      { kind: 'text', text: 'S7D1 member created' },
    ]);
    const createE = await heldRegistration('S7D1 E registration', () => driveWorkflowMember(world, A, goal, tasks[0]!));
    const created = jsonOf(await world.scripted.requests(A), 's7d1-member-call') as MemberRequestResultV1;
    if (created.status !== 'created') throw new Error(`S7D1: the member was not created: ${JSON.stringify(created)}`);
    const E = await sessionOf(world, chainLineOf('s7d1-E', created.session, created.operation));

    // The full handoff of A to its created successor S: every A task moves, A is archived.
    const acceptedFull = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's7d1-facts-full', workspace: { ...S6A_SCOPE }, source: A.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [...tasks] }],
    });
    if (acceptedFull.status !== 'committed') {
      throw new Error(`S7D1: the full handoff was refused: ${JSON.stringify(acceptedFull)}`);
    }
    const fullOperation = acceptedFull.value.operation;
    const fullDrive = await heldRegistration('S7D1 full successor registration',
      () => driveS6BHandoff(world, { operation: fullOperation }));
    // With the request driver on, the create child's own admission answers `accepted`: the first drive stops on
    // "the create child is still accepted" and the held registration commit completes it, so the drive resumes once.
    const fullDriveValue = fullDrive.value.progress?.successor === null
      ? await driveS6BHandoff(world, { operation: fullOperation }) : fullDrive.value;
    const fullProgress = fullDriveValue.progress;
    const fullSuccessor = fullProgress?.successor ?? null;
    if (fullProgress === null || fullSuccessor === null) throw new Error('S7D1: the full handoff made no successor');
    // The registration's create operation is the handoff assignment's saved `createOperation`, not the handoff.
    const fullAction = fullDriveValue.operation.action;
    if (fullAction.kind !== 'handoff') throw new Error('S7D1: the full handoff read-back is not a handoff');
    const fullCreateOperation = fullAction.progress.assignments[0]?.createOperation ?? null;
    if (fullCreateOperation === null) throw new Error('S7D1: the full handoff saved no create operation');
    const S = await sessionOf(world, chainLineOf('s7d1-S', fullSuccessor, fullCreateOperation));

    // The partial handoff of S to P: one task moves, S keeps the rest and is not archived.
    const acceptedPartial = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's7d1-facts-partial', workspace: { ...S6A_SCOPE }, source: S.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [tasks[1]!] }],
    });
    if (acceptedPartial.status !== 'committed') {
      throw new Error(`S7D1: the partial handoff was refused: ${JSON.stringify(acceptedPartial)}`);
    }
    const partialOperation = acceptedPartial.value.operation;
    const partialDrive = await heldRegistration('S7D1 partial successor registration',
      () => driveS6BHandoff(world, { operation: partialOperation }));
    const partialDriveValue = partialDrive.value.progress?.successor === null
      ? await driveS6BHandoff(world, { operation: partialOperation }) : partialDrive.value;
    const partialProgress = partialDriveValue.progress;
    const partialSuccessor = partialProgress?.successor ?? null;
    if (partialProgress === null || partialSuccessor === null) {
      throw new Error('S7D1: the partial handoff made no successor');
    }
    const P = await sessionOf(world, chainLineOf('s7d1-P', partialSuccessor, partialOperation));

    // Setup: close S's open responsible Task links through the shared `linkTask`. With the request driver on, the
    // Host's own lifecycle queue completes the partial handoff's archive once the last link closes; reactivate the
    // line, make the ruled ordinary archive later than that handoff, then reactivate the same line.
    for (let closes = 0; closes < 100; closes += 1) {
      const card = await world.readSession(S.ref);
      const target = card.links.find(candidate => candidate.ref.relation === 'responsible'
        && candidate.until === null && candidate.ref.target.kind === 'task')?.ref.target;
      if (target === undefined || target.kind !== 'task') break;
      await linkTask(world, card, target.ref, false,
        `s7d1-line-close-${S.ref.sessionId}-${String(closes)}`);
    }
    await driveS6BHandoff(world, { operation: partialOperation });
    if ((await world.readSession(S.ref)).record.lifecycle === 'archived') {
      await reactivateS7D1Session(world, S.ref, 'S7D1 reactivate before the ordinary archive');
    }
    world.clock.advance(60_000);
    await archiveS7D1Session(world, S.ref, 'contact');
    await reactivateS7D1Session(world, S.ref, 'S7D1 reactivate');

    // P reuses E through the same real create_member entry; the reused path writes no registration.
    await world.scripted.script(P, [
      { kind: 'calls', calls: [{ callId: 's7d1-reuse-call', name: 'create_member',
        args: { duty: 'executor', scope: { kind: 'task', task: tasks[2]! }, reason: MEMBER_REASON } }] },
      { kind: 'text', text: 'S7D1 member reused' },
    ]);
    await driveWorkflowMember(world, P, goal, tasks[1]!);
    const reused = jsonOf(await world.scripted.requests(P), 's7d1-reuse-call') as MemberRequestResultV1;
    if (reused.status !== 'reused') throw new Error(`S7D1: the member was not reused: ${JSON.stringify(reused)}`);

    return {
      world, goal, tasks, A, E, S, P,
      member: { created, reused },
      registrations: { A: createA.commit, E: createE.commit, full: fullDrive.commit, partial: partialDrive.commit },
      handoffs: {
        full: { operation: fullOperation, createOperation: fullCreateOperation,
          successor: fullSuccessor, progress: fullProgress },
        partial: { operation: partialOperation, successor: partialSuccessor, progress: partialProgress },
      },
      archive: { session: S.ref },
      reactivate: { session: S.ref },
      close: () => world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The real Workflow advance of one Work Run, stopped before its checks; the model's own tool call does the rest. */
async function driveWorkflowMember(world: S6AHostWorld, line: S6ASession, goal: GoalRef, task: TaskTriple) {
  return await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `s7d1-facts-${line.label}`,
    sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'open_checks' });
}
