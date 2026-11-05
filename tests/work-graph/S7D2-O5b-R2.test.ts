/**
 * O5b-R2 (`7d2-start-rulings.v4.md:6754`; write-tests brief `tests-7d2-o5b1.txt` "O5b-R2"): `role-lines/read` gives
 * one row per line with the stored name before 2C's fallback, the effective scope array, the creator contact, the
 * `unassigned` standby, the seat, `running_cap` and the O2 `position`; `role-lines/operations` gives one row per
 * `role_line`/`member_create` operation with the d16 fields; a replay reads the same rows. Also the read halves the
 * earlier rows handed over: RL-13 "only `role-lines/read` shows the burden" (`later-rows-merged.md:202`), RL-14
 * "a literal `unknown`, never a region, never shown as one region is enough" (`:204`), RL-20 "L2 holds the project
 * scope, Lp is archived" (`:211`), O5a-2 ruling 16's goal-group `owners` (start ruling 21) and the split line's
 * `openedBy` (start rulings 19, 39). No database read: only public routes (rule sheet F7).
 *
 * Worlds (memory only, S3; one new world per cell, R2-b/c/f-goal/i continue R2-a's):
 * - `openS7D2RoleLineWorld` (O1b): the three opening lines, each with one project link, created by the platform
 *   (`start_lines`); G is `handle.goal`. R2-g adds `S7D2_ADVISER_WORK` explicitly (start ruling 38).
 * - `openS7D2RegionWorld`: adviser A on region `src` (children `src/a`, `src/b`); `observation` gives RL-14's three
 *   unknown inputs.
 * - `openS7D2RunningWorld` (A1b): adviser running cap 4, three occupants; the Query held at its model gate fills it.
 * - `openS7D2CapacityWorld` (O3b): the region world with the adviser Work binding and `propose_role_split`.
 *
 * Expected (by hand from the frozen lines):
 * - R2-a: the stored name `{source:'stored_name', primary:'R2 参谋', ordinal:null, extraCount:0, tasks:[],
 *   goalRef:null, complete:true}` (v4 :5861–:5862); no stored name (opening adviser) and a blank name (stored as
 *   null) are not `stored_name`. The blank-name adviser is opened on `scope: []` (the brief names no scope; an
 *   empty scope claims nothing).
 * - R2-b: the opening adviser `[{kind:'project'}]`, `{kind:'platform'}`; the person's goal line `[{kind:'goal',
 *   goalRef:G}]`, `{kind:'human', actor:<the test's own human ctx actor>}` (`roleFactsOf`'s fallback).
 * - R2-c: every line `listWorkLines` lists with a duty is a holder: `seat.status:'held'`, `since` a cursor string.
 * - R2-d: the reactivated secretary: duty `secretary`, own `standby` with reason `unassigned`, `scope:[]`,
 *   `position:[]`, no open responsible link (decision 120-3 item 1; start ruling 18).
 * - R2-e: the waiting Work line's `runningCap` is `'running_cap'`, the entered Query line's `null`.
 * - R2-f: goal position by `goalPositionOf` from G's public facts (`desiredState`, no phase, no screening,
 *   `adviserLinks:[]`): `{inProgress: desiredState === 'active', shareable:false, candidates:[]}`; a project-only
 *   adviser `[]` (v4 :5929); the opening scribe `[{kind:'scribe', scope:{kind:'project'}, current:0}]` (no note
 *   written); the region adviser one `region` position on `src` with `region`/`descend` and an integer burden >= 0;
 *   the three unknowns `observation_failed`, `ownership_ambiguous`, `containment_unknown` (`regionPositionOf`).
 * - R2-g: the open's `role_line` row: `completed`/`done`, one step `{key:'line', duty:'adviser', state:'done'}`,
 *   `result:{status:'done', reason:null}`, no cold-start field (v4 :5976–:5978 keeps O1a's optionality); the
 *   `member_create` row `completed`, `stage:'done'`, `outcome:{kind:'created', session}`, `noticeItemKey`
 *   `member:<operationId>` (v4 :6153); a replay changes neither read.
 * - R2-h: with Lp archived the only same-duty active line is L2, so L2's scope has `{kind:'project'}`.
 * - R2-i: G's goal group `owners` names the goal's responsible adviser line (G first adopts one Plan, which the
 *   hover needs; after the R2-f read).
 * - R2-j: the line `propose_role_split` split off: `openedBy:'agent_proposal'`, creator the calling line (session),
 *   and `role-lines/read`'s `creator` the session contact of that still-active line.
 * R2-d's card and R2-j's `roleFacts` do not need `role-lines/read` and run before it, so the start point shows them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { LineBriefV1 } from '../../src/contracts/work-line.js';
import type { SessionCard, SessionCreateOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import type { RoleLineReadResultV1, RoleLineReadV1 } from '../../src/core/work-graph/views/role-line-read.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7D2RunningWorld } from '../helpers/S7D2-admission-world.js';
import { openS7D2CapacityWorld } from '../helpers/S7D2-capacity-world.js';
import {
  askS7D2Member, openS7D2RegionWorld, openS7D2RoleLineWorld, S7D2_ADVISER_WORK, S7D2_MODULE_IDS,
  type S7D2ObservationVariant,
} from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: { close(): Promise<void> }[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const WORKSPACE = { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId };
const SRC = { projectId: S6A_SCOPE.projectId, moduleId: S7D2_MODULE_IDS.region };

type Poster = { post(suffix: string, body: unknown): Promise<{ httpStatus: number; body: unknown }> };
type SplitRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

/** `role-lines/read` of the main workspace as the person; the body as returned. */
async function linesBody(world: Poster): Promise<unknown> {
  return (await world.post('role-lines/read', plain(S6A_SCOPE, { workspace: WORKSPACE }))).body;
}
const rowsOf = (body: unknown): readonly RoleLineReadV1[] =>
  valueOf<RoleLineReadResultV1>(body, 'ready', 'role-lines/read').rows;
const readLines = async (world: Poster): Promise<readonly RoleLineReadV1[]> => rowsOf(await linesBody(world));
const findRow = (rows: readonly RoleLineReadV1[], line: SessionRef): RoleLineReadV1 | undefined =>
  rows.find(entry => entry.row.key.sessionId === line.sessionId);
function rowOf(rows: readonly RoleLineReadV1[], line: SessionRef): RoleLineReadV1 {
  const found = findRow(rows, line);
  if (found === undefined) {
    throw new Error(`O5b-R2: role-lines/read has no row for ${line.sessionId}: ${JSON.stringify(rows.map(entry => entry.row.key))}`);
  }
  return found;
}
const openResponsible = (card: SessionCard) =>
  card.links.filter(link => link.ref.relation === 'responsible' && link.until === null);
/** The split rows of `role-lines/operations`: the `role_line` rows whose one step is `split` (RL-13 `:89`). */
const splitRows = (rows: readonly RoleLineOperationReadV1[]): SplitRow[] => rows.filter((row): row is SplitRow =>
  row.action === 'role_line' && row.steps.map(step => step.key).join(',') === 'split');

describe('O5b-R2: role-lines/read and role-lines/operations', () => {
  /*
   * Named mutation (draft O5b-05): delete `deriveName`'s stored-name branch (`src/core/work-graph/views/
   * work-line-reader.ts:1839` area) -> the named line's `row.name` `toEqual` (the first R2-a expectation) is red.
   */
  it('R2-a/b/c/f(goal)/i (memory): the stored name before the fallback, scope, creator, held seats, the goal '
    + 'position and the goal group owners', async () => {
    const handle = await openS7D2RoleLineWorld({ backend: 'memory' });
    worlds.push(handle);
    const g = handle.goal;
    const named = await handle.lineOf('r2-named', (await handle.open({ duty: 'adviser',
      scope: [{ kind: 'goal', goalRef: g }], name: 'R2 参谋', requestId: 'r2-named' })).result);
    const blank = await handle.lineOf('r2-blank', (await handle.open({ duty: 'adviser', scope: [], name: '   ',
      requestId: 'r2-blank' })).result);

    const rows = await readLines(handle.world);
    // R2-a
    expect(rowOf(rows, named.ref).row.name).toEqual({ source: 'stored_name', primary: 'R2 参谋', ordinal: null,
      extraCount: 0, tasks: [], goalRef: null, complete: true });
    expect(rowOf(rows, handle.lines.adviser.ref).row.name.source).not.toBe('stored_name');
    expect(rowOf(rows, blank.ref).row.name.source).not.toBe('stored_name');

    // R2-b
    const principal = handle.world.humanContext().principal;
    if (principal.kind !== 'host') throw new Error(`O5b-R2: the human context is not a Host principal: ${principal.kind}`);
    const opening = rowOf(rows, handle.lines.adviser.ref);
    expect(opening.scope).toEqual([{ kind: 'project' }]);
    expect(opening.creator).toEqual({ kind: 'platform' });
    expect(rowOf(rows, named.ref).scope).toEqual([{ kind: 'goal', goalRef: g }]);
    expect(rowOf(rows, named.ref).creator).toEqual({ kind: 'human', actor: principal.actor });

    // R2-c: only `held` (start ruling 21).
    for (const line of [handle.lines.secretary, handle.lines.adviser, handle.lines.scribe, named]) {
      expect(rowOf(rows, line.ref).seat, line.label).toMatchObject({ status: 'held', since: expect.any(String) });
    }

    // R2-f, the goal position: `goalPositionOf` over G's public facts.
    const read = valueOf<{ goal: { desiredState: string } }>(await handle.main.route('goals/read', g), 'ready',
      'goals/read of G');
    expect(rowOf(rows, named.ref).position).toEqual([{ kind: 'goal', goalRef: g,
      position: { inProgress: read.goal.desiredState === 'active', shareable: false, candidates: [] } }]);
    expect(opening.position).toEqual([]);

    // R2-i: G's goal group owners name its adviser line. `graph/hover` needs G's task graph
    // (`node-detail-reader.ts:998–:999`), which the frozen cell does not name: G adopts one Plan here through the
    // public `plans/propose` + `plans/apply`, after the R2-f read above (G with no phase).
    await adoptPLMixedPlan(handle.world, { goal: g, label: 'r2-hover',
      tasks: [{ taskId: 'r2-hover-t', role: S6A_WORK_ROLE.templateId }] });
    const hover = valueOf<{ groups: { node: { kind: string }; owners: LineBriefV1[] }[] }>(
      await handle.main.route('graph/hover', { goalRef: g }), 'ready', 'graph/hover of G');
    const group = hover.groups.find(entry => entry.node.kind === 'goal');
    expect(group, 'graph/hover has a goal group').toBeDefined();
    expect(group!.owners.map(owner => owner.key.sessionId)).toContain(named.ref.sessionId);
  }, 300_000);

  it('R2-f scribe (memory): the opening scribe\'s project count is 0', async () => {
    const handle = await openS7D2RoleLineWorld({ backend: 'memory' });
    worlds.push(handle);
    expect(rowOf(await readLines(handle.world), handle.lines.scribe.ref).position)
      .toEqual([{ kind: 'scribe', scope: { kind: 'project' }, current: 0 }]);
  }, 300_000);

  it('R2-f region (memory): the region line shows its one region position with a burden', async () => {
    const handle = await openS7D2RegionWorld({ backend: 'memory' });
    worlds.push(handle);
    const row = rowOf(await readLines(handle.world), handle.regionAdviser.ref);
    expect(row.scope).toHaveLength(1);
    expect(row.scope[0]).toMatchObject({ kind: 'region', moduleRef: SRC });
    // Only `src`'s own position: the children the maintenance page also reads are not in this row (start ruling 37).
    expect(row.position).toHaveLength(1);
    const position = row.position[0]!;
    expect(position).toMatchObject({ kind: 'region', moduleRef: SRC });
    if (position.kind !== 'region') throw new Error(`O5b-R2: not a region position: ${JSON.stringify(position)}`);
    expect(['region', 'descend']).toContain(position.position.status);
    const burden = (position.position as { burden?: unknown }).burden;
    expect(Number.isInteger(burden) && (burden as number) >= 0, `burden ${String(burden)}`).toBe(true);
  }, 300_000);

  /*
   * Named mutation (RL-14 (e), merged :204): `regionPositionOf` reads `unknown` as `{status:'region', moduleRef,
   * burden:0}` -> all three cells' `toEqual` and `not.toBe('region')` are red; `containment_absent` shows it only here.
   */
  it.each([
    ['capture_failed', 'observation_failed'],
    ['ownership_ambiguous', 'ownership_ambiguous'],
    ['containment_absent', 'containment_unknown'],
  ] as const)('R2-f unknown (memory): observation %s reads a literal unknown (%s)', async (observation, reason) => {
    const handle = await openS7D2RegionWorld({ backend: 'memory', observation: observation as S7D2ObservationVariant });
    worlds.push(handle);
    const row = rowOf(await readLines(handle.world), handle.regionAdviser.ref);
    expect(row.position).toEqual([{ kind: 'region', moduleRef: SRC,
      position: { status: 'unknown', moduleRef: SRC, reason } }]);
    expect(row.scope).toHaveLength(1);
    expect(row.scope[0]).toMatchObject({ kind: 'region', moduleRef: SRC });
  }, 300_000);

  it('R2-d (memory): a reactivated secretary line is unassigned standby with no scope', async () => {
    const handle = await openS7D2RoleLineWorld({ backend: 'memory' });
    worlds.push(handle);
    const secretary = handle.lines.secretary;
    await handle.archive(secretary, 'r2-archive');
    await handle.reactivate(secretary, 'r2-reactivate');
    expect(openResponsible(await handle.readCard(secretary))).toEqual([]);
    const row = rowOf(await readLines(handle.world), secretary.ref);
    expect(row.row.duty).toBe('secretary');
    expect(row.row.status.own).toBe('standby');
    expect(row.row.status.ownReason.code).toBe('unassigned');
    expect(row.scope).toEqual([]);
    expect(row.position).toEqual([]);
  }, 300_000);

  it('R2-e (memory): the Work line waiting at the running cap shows running_cap, the entered Query line null',
    async () => {
      const world = await openS7D2RunningWorld({ backend: 'memory' });
      worlds.push(world);
      const queryGate = await world.world.gates.modelRequest(world.query.session);
      world.start(world.query).catch(() => undefined);
      await queryGate.reached;                                  // 3 occupants + the Query = 4: the cap is full
      const workGate = await world.world.gates.modelRequest(world.work.session);
      try {
        if (world.work.kind !== 'work') throw new Error('O5b-R2: the running world has no Work starter');
        expect(await world.start(world.work)).toEqual({ status: 'waiting', reason: 'running_cap',
          ref: world.work.runRef });
        const rows = await readLines(world.world);
        expect(rowOf(rows, world.work.session.ref).row.runningCap).toBe('running_cap');
        expect(rowOf(rows, world.query.session.ref).row.runningCap).toBeNull();
      } finally {
        queryGate.release();
        workGate.release();
      }
    }, 300_000);

  it('R2-g (memory): the role_line and member_create operation rows; a replay reads the same rows', async () => {
    const handle = await openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK] });
    worlds.push(handle);
    const g = handle.goal;
    const input = { duty: 'adviser', scope: [{ kind: 'goal' as const, goalRef: g }], name: 'R2 参谋',
      requestId: 'r2-named' };
    const first = (await handle.open(input)).result;
    const opened = valueOf<{ operation: { operationId: string } }>(first, 'committed', 'the r2-named open');
    const named = await handle.lineOf('r2-named', first);

    // The open's `role_line` row (v4 :6416; the completed shape as RL-01 and RL-13 A read it).
    expect((await handle.operations()).filter(row => row.operation.operationId === opened.operation.operationId))
      .toEqual([{ operation: opened.operation, action: 'role_line', phase: 'completed', actionPhase: 'done',
        steps: [{ key: 'line', duty: 'adviser', childOperation: expect.any(Object), state: 'done' }],
        result: { status: 'done', reason: null } }]);

    // The `member_create` row: the opening adviser's real Work Run calls the real `create_member`.
    const { tasks } = await adoptPLMixedPlan(handle.world, { goal: g, label: 'r2-member', tasks: [
      { taskId: 'r2-member-caller', role: PL_ADVISER_ROLE.templateId },
      { taskId: 'r2-member-member', role: S6A_WORK_ROLE.templateId }] });
    const member = await askS7D2Member(handle.world, { caller: handle.lines.adviser, goal: g, callerTask: tasks[0]!,
      memberTask: tasks[1]!, label: 'r2-member' });
    if (member.status !== 'created') throw new Error(`O5b-R2: create_member did not create: ${JSON.stringify(member)}`);
    const memberRows = (await handle.operations())
      .filter(row => row.operation.operationId === member.operation.operationId);
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ operation: member.operation, action: 'member_create', phase: 'completed',
      progress: { stage: 'done', outcome: { kind: 'created', session: member.session },
        noticeItemKey: `member:${member.operation.operationId}` } });

    // The replay: the same requestId and body.
    const operationsBefore = await handle.operations();
    const linesBefore = await linesBody(handle.world);
    expect((await handle.open(input)).result).toMatchObject({ status: 'committed', replayed: true });
    expect(await handle.operations()).toEqual(operationsBefore);
    expect(rowOf(await readLines(handle.world), named.ref)).toEqual(rowOf(rowsOf(linesBefore), named.ref));
  }, 300_000);

  it('R2-h (memory): with the project adviser archived, the remaining adviser line holds the project scope',
    async () => {
      const handle = await openS7D2RoleLineWorld({ backend: 'memory' });
      worlds.push(handle);
      const l2 = await handle.lineOf('r2-l2', (await handle.open({ duty: 'adviser',
        scope: [{ kind: 'goal', goalRef: handle.goal }], requestId: 'r2-l2' })).result);
      const lp = handle.lines.adviser;
      await handle.archive(lp, 'r2-lp');
      const rows = await readLines(handle.world);
      expect(findRow(rows, lp.ref)).toBeUndefined();
      expect(rowOf(rows, l2.ref).scope).toContainEqual({ kind: 'project' });
    }, 300_000);

  /*
   * Named mutation (start rulings 19, 39): delete `parentFactsOf`'s `role_line_split` arm (the split falls back to
   * `other`) -> `openedBy` reads `'platform_rule'` and the creator is the platform: the `roleFacts` `toMatchObject`
   * and the `role-lines/read` `creator` `toEqual` are both red.
   */
  it('R2-j (memory): the line propose_role_split opened is agent_proposal, created by the calling line', async () => {
    const handle = await openS7D2CapacityWorld({ backend: 'memory' });
    worlds.push(handle);
    const source = handle.regionAdviser;
    const [task] = await handle.plan(handle.goal, 'r2-split', [{ taskId: 'r2-split-t', line: source }]);
    await handle.split({ line: source, task: task!, callId: 'r2-split',
      move: [{ kind: 'region', moduleRef: handle.modules.child }], label: 'r2-split' });
    const tool = await handle.toolResult(source, 'r2-split');
    expect(tool.status).toBe('success');
    expect(tool.json).toMatchObject({ status: 'accepted' });

    const ended = await waitFor(async () => splitRows(await handle.operations()),
      rows => rows.some(row => row.phase === 'completed' || row.phase === 'failed'), 'the split to end');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ phase: 'completed' });
    const child = ended[0]!.steps[0]!.childOperation;
    if (child === null) throw new Error(`O5b-R2: the split names no child create: ${JSON.stringify(ended[0])}`);
    const line = valueOf<SessionCreateOperationRecord>(await handle.main.route('sessions/operation', child), 'ready',
      'the split child create').action.plannedSessionRef;

    const sourceRef = { projectId: source.ref.projectId, sessionId: source.ref.sessionId };
    expect((await handle.readCard(line)).roleFacts).toMatchObject({ openedBy: 'agent_proposal',
      creator: { kind: 'session', ref: sourceRef } });
    expect(rowOf(await readLines(handle.world), line).creator).toEqual({ kind: 'session', session: sourceRef });
  }, 300_000);
});
