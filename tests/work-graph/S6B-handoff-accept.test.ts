/**
 * `handoff.accept` through the platform's handoff owner on the request world's real lines (rows 2 and 4): each refusal
 * in its order, with the public Session reads of the source and the existing targets the same before and after and no
 * accept commit reaching the store (counted on the commit barrier, A3); then the storage rules on both backends —
 * the source pinned at the revision the accept read (a claim that moves it while the commit waits ends in a revision
 * conflict, the same command then commits), the receipt replay, another input under the same command, and the one
 * unfinished operation per source read through its lookup.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import * as hostModule from '../../src/app/host.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { HandoffAcceptInputV1 } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import { graphWrite, plain, writeAG2bWorkspace } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  openS6ARequestWorld, S6A_PLAIN_ROLE, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_SECRETARY_ROLE, type S6ABackend,
  type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { createS6BLine, governS6B, seedS6BHandoffLines } from '../helpers/S6B1-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6ARequestWorld[] = [];
const roots: string[] = [];
afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });
afterAll(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** Another project whose workspace has the request world's workspace id. */
const OTHER = { projectId: 's6b-other-project', workspaceId: S6A_SCOPE.workspaceId };

/**
 * The request world whose Host also configures `OTHER`'s workspace, with its own root and Kernel store (Host inputs,
 * A8): a delegating spy adds both to the options the world builds, as `openS6ATwoWorkspaceWorld` does.
 */
async function openWithOtherProject(options: { backend: S6ABackend }): Promise<S6ARequestWorld> {
  const root = await mkdtemp(join(tmpdir(), 's6b-other-ws-'));
  roots.push(root);
  await writeAG2bWorkspace(root);
  const real = hostModule.createLocalWorkbenchHost;
  const spy = vi.spyOn(hostModule, 'createLocalWorkbenchHost').mockImplementation(async hostOptions => {
    const entries = hostOptions.kernelStores?.entries ?? [];
    return real({ ...hostOptions,
      workspaces: [...hostOptions.workspaces, { scope: { ...OTHER }, name: 'S6B other project', root, workspaceRevision: 1,
        readPrefixes: ['.'] }],
      kernelStores: { entries: [...entries, { adapterId: 's6b-kernel-other', storeKey: 's6b-kernel-store-other',
        workspace: { ...OTHER }, databasePath: join(dirname(entries[0]!.databasePath), 'kernel-other.sqlite') }] } });
  });
  try { return await openS6ARequestWorld(options); } finally { spy.mockRestore(); }
}

/** A trusted Host context of `OTHER` for its own Host person. */
const otherContext = () => createHostCoreCallContext({ scope: OTHER, actor: { kind: 'human', id: 's6b-other-operator' },
  signal: new AbortController().signal });

/** `OTHER` created and registered through the routes by its own Host person, and one line there. */
async function otherProjectLine(world: S6ARequestWorld): Promise<SessionRef> {
  const project = { aggregateType: 'Project', projectId: OTHER.projectId };
  expect(await world.dispatch('projects/create', otherContext(), graphWrite(OTHER, { projectId: OTHER.projectId },
    's6b-other-project', [{ ref: project, revision: 0 }]))).toMatchObject({ status: 'committed' });
  expect(await world.dispatch('workspaces/register', otherContext(), graphWrite(OTHER, { workspace: OTHER }, 's6b-other-workspace',
    [{ ref: project, revision: 1 }, { ref: { aggregateType: 'Workspace', ...OTHER }, revision: 0 }]))).toMatchObject({ status: 'committed' });
  await world.settleDetached();
  const created = await world.dispatch('sessions/create', otherContext(), plain(OTHER, { workspace: OTHER, role: S6A_SECRETARY_ROLE,
    recommendedRefs: [], initialLinks: [], meta: { requestId: 's6b-other-line', expected: [] } })) as { status: string; value: { ref: SessionRef } };
  expect(created.status).toBe('completed');
  return { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
}

/** A world with the governance, goal 1's Plan, a source line responsible for three tasks and an idle target line. */
async function handoffWorld(backend: S6ABackend, open = openS6ARequestWorld) {
  const world = await open({ backend });
  worlds.push(world);
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, ws, world.goals);
  return { world, ws, lines: await seedS6BHandoffLines(ws, world.goals.first) };
}
type Target = HandoffAcceptInputV1['assignments'][number]['target'];
const accept = (commandId: string, source: SessionRef, assignments: { target: Target; tasks: unknown[] }[],
  change: object = {}) => ({ commandId, workspace: { ...S6A_SCOPE }, source, trigger: 'manual', assignments, ...change }) as HandoffAcceptInputV1;
const executor: Target = { kind: 'create', duty: 'executor' };
const rejection = (code: string, reason: string) => ({ status: 'rejected', code, reason });
const nobody = { projectId: S6A_SCOPE.projectId, sessionId: 's6b-nobody' };

describe('rejects: a handoff, each refusal before anything is written', () => {
  let setup: Awaited<ReturnType<typeof handoffWorld>>;
  let other: SessionRef;
  beforeAll(async () => {
    setup = await handoffWorld('memory', openWithOtherProject);
    other = await otherProjectLine(setup.world);
  }, 120_000);

  it.each<[string, () => Promise<{ system?: boolean; input: HandoffAcceptInputV1 }>, object]>([
    ['the system asks for a manual handoff', async () => ({ system: true, input: accept('r-1', setup.lines.source.ref, [{ target: executor, tasks: [] }]) }),
      rejection('forbidden', 'a manual handoff needs the Host person')],
    ['the person asks for a too_long handoff', async () => ({ input: accept('r-2', setup.lines.source.ref, [{ target: executor, tasks: [] }], { trigger: 'too_long' }) }),
      rejection('forbidden', 'a too_long handoff needs the trusted Host system')],
    ['another workspace', async () => ({ input: accept('r-3', setup.lines.source.ref, [{ target: executor, tasks: [] }], { workspace: { ...S6A_SECOND_SCOPE } }) }),
      rejection('forbidden', "the handoff workspace is not the call's workspace")],
    ['no assignment', async () => ({ input: accept('r-4', setup.lines.source.ref, []) }), rejection('invalid', 'HandoffAction.input.assignments is invalid')],
    ['a task given twice', async () => ({ input: accept('r-5', setup.lines.source.ref, [{ target: executor, tasks: [setup.lines.tasks[0]] },
      { target: { kind: 'existing', session: setup.lines.target.ref }, tasks: [setup.lines.tasks[0]] }]) }),
    rejection('invalid', 'HandoffAction.input.assignments[1].tasks[0] repeats a task of the handoff')],
    ['the source as its own target', async () => ({ input: accept('r-6', setup.lines.source.ref, [{ target: { kind: 'existing', session: setup.lines.source.ref }, tasks: [] }]) }),
      rejection('invalid', 'HandoffAction.input.assignments[0].target is the source Session')],
    ['a source not in the workspace', async () => ({ input: accept('r-7', nobody, [{ target: executor, tasks: [] }]) }),
      rejection('not_found', "the source Session is not in the call's workspace")],
    ['a source of another project with the same workspace id', async () => ({ input: accept('r-14', other,
      [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }]) }), rejection('not_found', "the source Session is not in the call's workspace")],
    ['an archived source', async () => {
      const line = await setup.world.createWorkSession('s6b-archived');
      await setup.world.archive(line);
      return { input: accept('r-8', line.ref, [{ target: executor, tasks: [] }]) };
    }, rejection('invalid', 'the source Session is archived')],
    ['a read-only copy as source', async () => {
      const { copy } = await setup.world.makeReadonlyCopy(await setup.world.createWorkSession('s6b-copied'), 's6b-copy');
      return { input: accept('r-9', copy.ref, [{ target: executor, tasks: [] }]) };
    }, rejection('invalid', 'the source Session is a read-only copy')],
    ['an existing target not in the workspace', async () => ({ input: accept('r-10', setup.lines.source.ref, [{ target: { kind: 'existing', session: nobody }, tasks: [] }]) }),
      rejection('not_found', 'assignments[0].target is not a Session of the workspace')],
    ['a new successor of another duty', async () => ({ input: accept('r-11', setup.lines.source.ref, [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }]) }),
      rejection('invalid', "assignments[0].target's duty secretary is not the source Session's duty executor")],
    ['an existing target of another duty', async () => {
      const secretary = await setup.world.createSecretary('s6b-other-duty');
      return { input: accept('r-12', setup.lines.source.ref, [{ target: { kind: 'existing', session: secretary.ref }, tasks: [] }]) };
    }, rejection('invalid', "assignments[0].target's duty secretary is not the source Session's duty executor")],
    ['a source with no known duty', async () => {
      const noDuty = await createS6BLine(setup.ws, { label: 's6b-no-duty', role: S6A_PLAIN_ROLE });
      return { input: accept('r-13', noDuty.ref, [{ target: executor, tasks: [] }]) };
    }, rejection('invalid', 'the source Session has no known duty, so no target can share it')],
  ])('%s', async (_case, make, expected) => {
    const { system, input } = await make();
    // The source and each existing target through `sessions/read`, each in its own project's workspace.
    const sessions = () => Promise.all([input.source, ...input.assignments.flatMap(({ target }) =>
      target.kind === 'existing' ? [target.session] : [])].map(ref => setup.world.platform.sessions.readSession(
      ref.projectId === OTHER.projectId ? otherContext() : setup.world.humanContext(), ref)));
    const before = await sessions();
    let accepts = 0;
    const counter = commitBarrier.hold(commit => {
      if (byIdentityPrefix('handoff.accept:')(commit)) accepts += 1;
      return false;
    }, 'the accept commit counter');
    expect(await setup.world.platform.sessionHandoff.acceptHandoff(
      system === true ? setup.world.systemContext() : setup.world.humanContext(), input)).toEqual(expected);
    counter.release();
    expect(accepts).toBe(0);
    expect(await sessions()).toEqual(before);
  });
});

describe.each<S6ABackend>(['memory', 'sqlite'])('handoff.accept on %s', backend => {
  it('pins the source, replays its receipt, refuses another input and keeps one unfinished operation per source', async () => {
    const { world, lines } = await handoffWorld(backend);
    const handoff = world.platform.sessionHandoff;
    const input = accept('s6b-accept', lines.source.ref, [{ target: executor, tasks: lines.tasks.slice(0, 2) },
      { target: { kind: 'existing', session: lines.target.ref }, tasks: lines.tasks.slice(2) }]);
    // A claim moves the source while the accept's commit waits: the commit's pin no longer holds.
    const hold = commitBarrier.hold(byIdentityPrefix('handoff.accept:'), 'the accept commit');
    const first = handoff.acceptHandoff(world.humanContext(), input);
    await hold.reached;
    const card = await world.readSession(lines.source.ref);
    await world.occupy({ label: 'source', ref: lines.source.ref, aggregateRef: card.record.ref, role: card.record.role,
      createdAt: card.record.createdAt });
    hold.release();
    const moved = (await world.readSession(lines.source.ref)).record;
    expect(await first).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      current: [{ ref: moved.ref, revision: moved.revision }] });

    const committed = await handoff.acceptHandoff(world.humanContext(), input);
    expect(committed).toMatchObject({ status: 'committed', replayed: false, value: { stage: 'accepted', phase: 'accepted' } });
    if (committed.status !== 'committed') return;
    expect(await handoff.acceptHandoff(world.humanContext(), input)).toEqual({ ...committed, replayed: true });
    expect(await handoff.acceptHandoff(world.humanContext(), { ...input, assignments: input.assignments.slice(0, 1) }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await handoff.acceptHandoff(world.humanContext(), { ...input, commandId: 's6b-accept-again' })).toEqual({
      status: 'rejected', code: 'busy', reason: 'the source Session has an unfinished handoff or archive operation',
      current: [{ ref: committed.value.operation, revision: 1 }] });
  }, 120_000);
});
