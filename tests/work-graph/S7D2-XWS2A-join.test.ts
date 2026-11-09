/**
 * XWS2A rows XA-01–XA-06 and XA-13: the second workspace's join, its exploration, the project's one catalog and
 * the join's own proposal window. The world is `tests/helpers/XWS2A-world.ts`; every state is reached through a
 * public step (the Host settings route, the scripted model's tool call, the person's `decisions/answer`).
 *
 * Each header names the mutation that must make the row red (`xws2a-tests.frozen.md` §1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { queryJobRefOfRun } from '../helpers/S7D2-coldstart-world.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  openS7D2RoleLineWorld, startLinesOf, type S7D2RoleLineWorld,
} from '../helpers/S7D2-role-line-world.js';
import {
  XWS2A_COARSE_QUESTION, XWS2A_MODULE_ID, XWS2A_MODULE_RAW_PATH, openXWS2AWorld, xws2aJoinRef,
  xws2aSecondPath, type XWS2AJoinRow, type XWS2AWorld,
} from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function opened(): Promise<XWS2AWorld> {
  const world = await openXWS2AWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

const joinOf = async (world: XWS2AWorld): Promise<XWS2AJoinRow> => {
  const join = await world.join();
  if (join === null) throw new Error('XWS2A: the second workspace has no workspace_join row');
  return join;
};

const coldStartRow = async (world: S7D2RoleLineWorld | XWS2AWorld): Promise<XWS2AJoinRow> => {
  const rows = await world.operations();
  const row = rows.find(candidate => candidate.action === 'role_line'
    && candidate.operation.operationId === `cold_start:${P}`);
  if (row === undefined || row.action !== 'role_line') throw new Error('XWS2A: no cold_start row');
  return row;
};

/** The project-wide `sessions/find` (no target, no role: the project arm). */
async function projectSessions(world: XWS2AWorld): Promise<SessionCard[]> {
  const read = await world.base.main.route('sessions/find', {
    workspace: { projectId: P }, includeArchived: false, page: { limit: 100 },
  }) as ReadResult<SessionPage<SessionCard>>;
  return valueOf<SessionPage<SessionCard>>(read, 'ready', 'the project-wide session find').items;
}

describe('XWS2A: the second workspace joins the project', () => {
  it('XA-01 exactly one workspace_join row is born at coarse_split and its exploration is in the second workspace', async () => {
    const world = await opened();
    const join = await world.waitJoin(candidate => candidate !== null, 'the workspace_join row');
    expect(join.operation).toEqual(xws2aJoinRef(P, world.second.scope.workspaceId));
    expect(join.action).toBe('role_line');
    expect(join.actionPhase).toBe('coarse_split');
    expect(join.route).toBe('split');
    expect(['accepted', 'running']).toContain(join.phase);

    const explored = await world.waitJoin(candidate => (candidate?.explorations ?? []).length >= 1,
      "the join's coarse-split exploration");
    const entry = (explored.explorations ?? [])[0]!;
    expect(entry.queryRunRef.workspaceId).toBe(world.second.scope.workspaceId);

    // The first workspace's read carries no coarse-split join row (XA-02's negative, here in the same row).
    const main = await world.operations();
    expect(main.filter(row => row.action === 'role_line' && row.actionPhase === 'coarse_split')).toEqual([]);
  }, 120_000);

  it('XA-02 the first workspace births start_lines, three lines and a waiting cold start, never a join', async () => {
    const world = await openS7D2RoleLineWorld({ backend: 'memory' });
    worlds.push(world);
    const rows = await world.operations();
    const start = startLinesOf(rows);
    expect(start).not.toBeNull();
    expect(start!.steps.map(step => step.key)).toEqual(['secretary', 'adviser', 'scribe']);
    expect(start!.steps.map(step => step.state)).toEqual(['done', 'done', 'done']);
    const cold = await coldStartRow(world);
    expect(cold.actionPhase).toBe('candidates');
    expect(rows.some(row => row.action === 'role_line'
      && row.operation.operationId.startsWith('workspace_join:'))).toBe(false);

    const lines = await world.findByTarget({ kind: 'project', ref: { projectId: P } });
    const templates = lines.map(card => card.record.role.kind === 'legacy_template' ? card.record.role.templateId : null);
    expect(templates).toHaveLength(3);
    expect(templates).toEqual(expect.arrayContaining([S6A_SECRETARY_ROLE.templateId,
      PL_ADVISER_ROLE.templateId, S6A_SCRIBE_ROLE.templateId]));
  }, 120_000);

  it('XA-03 the join exploration Query belongs to the second workspace and has no Goal', async () => {
    const world = await opened();
    const join = await world.waitCoarseAnswered();
    const entry = (join.explorations ?? []).find(candidate => candidate.segment === 'coarse_split')!;
    expect(entry.queryRunRef.workspaceId).toBe(world.second.scope.workspaceId);
    const job = await world.query(queryJobRefOfRun(entry.queryRunRef));
    expect(job.job.job.intent.projectId).toBe(P);
    expect(job.job.job.intent.workspaceId).toBe(world.second.scope.workspaceId);
    expect(job.job.job.goalId).toBeNull();
    expect(job.job.job.intent.execution.kind).toBe('role_exploration');
  }, 120_000);

  it('XA-04 "please act" is a Host action_request to the main adviser, stored in the main workspace', async () => {
    const world = await opened();
    await world.waitCoarseAnswered();
    const inbox = await world.inbox(world.adviser);
    const action = inbox.filter(message => message.intent === 'action_request');
    expect(action).toHaveLength(1);
    expect((action[0]!.recipient as SessionRef).sessionId).toBe(world.adviser.ref.sessionId);
    expect(action[0]!.ref.workspaceId).toBe(S6A_SCOPE.workspaceId);
    expect(await world.messageText(action[0]!)).toBe(XWS2A_COARSE_QUESTION);
  }, 120_000);

  it('XA-05 an approved module joins the project catalog once, with the second workspace path prefix', async () => {
    const world = await opened();
    await world.approveCoarse();
    const main = await world.catalog(S6A_SCOPE);
    const second = await world.catalog(world.second.scope);
    // One catalog: the same revision read from either workspace context.
    expect(second.catalog.ref).toEqual(main.catalog.ref);
    const modules = main.catalog.catalog.modules;
    const added = modules.find(module => module.ref.moduleId === XWS2A_MODULE_ID);
    expect(added).toBeDefined();
    expect(added!.paths).toContain(xws2aSecondPath(world.second.scope.workspaceId, XWS2A_MODULE_RAW_PATH));
    const firstModule = modules.find(module => module.ref.moduleId === 'src');
    expect(firstModule!.paths).toEqual(['src']);
  }, 120_000);

  it('XA-06 the region adviser lands on second-mod and no second secretary or scribe line opens', async () => {
    const world = await opened();
    const holders = (await world.base.allocation()).duties.adviser.holders.length;
    await world.base.setOpen('adviser', holders + 2, 'xws2a-adviser-seats');
    await world.approveCoarse();
    const regionScope = (row: { scope: readonly { kind: string; moduleRef?: ModuleRef }[] }): boolean =>
      row.scope.some(scope => scope.kind === 'region' && scope.moduleRef?.moduleId === XWS2A_MODULE_ID);
    await waitFor(() => world.roleLines(), rows => rows.some(row => row.row.duty === 'adviser'
      && regionScope(row)), 'the second-mod region adviser line');

    const rows = await world.roleLines();
    const adviser = rows.filter(row => row.row.duty === 'adviser');
    expect(adviser).toHaveLength(2);
    expect(adviser.filter(regionScope)).toHaveLength(1);
    expect(rows.filter(row => row.row.duty === 'secretary')).toHaveLength(1);
    expect(rows.filter(row => row.row.duty === 'scribe')).toHaveLength(1);
    // The one secretary and scribe are the opening project lines, not a line of the second workspace.
    expect(rows.filter(row => row.row.duty === 'secretary' || row.row.duty === 'scribe')
      .every(row => row.scope.every(scope => scope.kind === 'project'))).toBe(true);
    expect(await projectSessions(world)).toHaveLength(4);
  }, 120_000);

  it('XA-13 the join proposals window guards the join record, not the cold start', async () => {
    const world = await opened();
    const before = await coldStartRow(world);
    expect(before.actionPhase).toBe('candidates');
    const hold = world.holdJoinProposals();
    const holders = (await world.base.allocation()).duties.adviser.holders.length;
    await world.base.setOpen('adviser', holders + 2, 'xws2a-proposal-seats');
    await world.approveCoarse();
    await hold.reached;
    // The region Query is submitted in the proposals-phase commit; script it before the next pass claims it.
    const regionLine = await world.scriptRegionProposal();
    hold.release();
    // The proposal read the join's open window, so it waits for the join's batch instead of freezing alone.
    // A window that selected the cold start would read it closed (it is still at candidates) and freeze immediately.
    await waitFor(async () => await world.base.world.scripted.requests(regionLine),
      requests => requests.some(request => request.messages.some(message =>
        message.role === 'tool' && message.callId === 'xws2a-region')), 'the region proposal result');
    const proposal = jsonOf(await world.base.world.scripted.requests(regionLine), 'xws2a-region') as { status: string };
    expect(proposal.status).toBe('pending_batch');
    const join = await world.waitProposals();
    expect(join.actionPhase).toBe('proposals');
    expect(join.batchRefs ?? []).toHaveLength(1);
    // The window's operation is the join's own operation (the batch froze while the cold start's revision stayed
    // where it was: a guard fixed to the cold-start ref with the join revision would conflict here).
    const region = (join.explorations ?? []).find(entry => entry.segment === 'region')!;
    // The region line's stored origin is the join this exploration belongs to, not its own creation operation.
    expect(region.operationRef).toEqual(xws2aJoinRef(P, world.second.scope.workspaceId));
    // The join's region line says it was opened by the join, never a borrowed cold start.
    const regionCard = await world.base.world.readSession(region.sessionRef);
    expect(regionCard.roleFacts?.openedBy).toBe('workspace_join');
    const after = await coldStartRow(world);
    // The cold start's record did not move (still at its first phase) while the join's proposal batch froze.
    expect(after.actionPhase).toBe(before.actionPhase);
    expect(after.phase).toBe(before.phase);
    const card = (await world.cards()).find(candidate => candidate.source.kind === 'structural_proposal'
      && candidate.state === 'waiting_answer');
    expect(card).toBeDefined();
  }, 180_000);
});
