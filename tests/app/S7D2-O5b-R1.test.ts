/**
 * O5b-R1 (`7d2-start-rulings.v4.md:6753`; the eleven suffixes `:6247–:6250`, person-only before the owner `:6308`,
 * the route table `:6410–:6433`; O5b start rulings 15, 35, 36, 40, 46; write-tests brief `tests-7d2-o5b1.txt`
 * "O5b-R1"): the eleven 7D2 role-line suffixes are published once, every one `forbidden` for a system caller (reads
 * included) and `405` for a non-POST; `role-lines/open` takes a reviewer and refuses an executor; `initialization/adopt`
 * stays and there is no `plan_adoption` route; the person's `goals/adviser-queue/reorder` and `…/assign` commit and
 * replay with the first receipt, `assign` refuses a destination that is not an adviser line, and a JSON body's extra
 * keys (`operationRef`, `kind`) never reach the owner.
 *
 * Worlds (memory only: no storage rule here, rule sheet S3):
 * - Steps 1, 2, 4, 5 and step 3's "published" cells and its `role-lines/read` read share one O1b role-line world
 *   (`openS7D2RoleLineWorld`, tests/helpers/S7D2-role-line-world.ts), in declaration order.
 * - Step 3's queue writes and step 6 share one O4a queue world (ruling 46; RL-04's prior,
 *   `tests/work-graph/S7D2-RL-04.test.ts:46–:56`): advisers A and B hold three small goals each, the open adviser cap is
 *   set to their two lines, and the confirmed drafts g7, g8 wait in the queue in confirmation order.
 *
 * The bodies (brief step 1, one lawful body per suffix): the two reads carry `{workspace}`, `goals/adviser-queue` `{}`,
 * `autonomy-rules` `{projectRef}`, every write a `graphWrite`. The revoke/update bodies name a rule id no step created
 * (`r1-no-rule`): the system cells are refused before any owner runs, and the person cells assert only that the route
 * is published, so the owner's own answer to an unknown rule is not this row's.
 *
 * Expected (by hand from the frozen lines): step 1 `{status:'rejected',code:'forbidden',reason:'only the person may
 * call this route'}` (`src/app/core-routes.ts:875–:876`); step 2 HTTP 405 with `{status:'rejected',code:'invalid',
 * reason:'use POST for core routes'}` (`src/app/server.ts:438`); step 3 never the unpublished 404 (`server.ts:441`);
 * step 4 reviewer `committed`, executor `{status:'rejected',code:'invalid',reason:'role_line_duty'}`; step 5
 * `plan_adoption` is the unpublished 404. The queue: reorder `[G8, G7]` at `Q0.revision + 1` (`reorderGoals` is a
 * permutation with the revision plus one, `src/core/work-graph/state/goal-adviser-queue.ts:45–:57`; book `:541`); a
 * replay is `{status:'committed', replayed:true, cursor:<the first cursor>}` (ruling 40); the assign to the opening
 * secretary `{status:'rejected',code:'invalid',reason:'the destination Session is not an adviser line'}` with queue
 * and links unchanged (ruling 35); the person's assign to A commits beyond A's three (book `:531`), leaving `[G8]`; the
 * assign to B with the extra keys commits like one without them, leaving `[]` (rulings 15, 36).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalAdviserQueueV1 } from '../../src/contracts/role-lines.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { openS7D2RoleLineWorld, type S7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const SUFFIXES = ['role-lines/open', 'role-lines/change-scope', 'goals/adviser-queue', 'goals/adviser-queue/reorder',
  'goals/adviser-queue/assign', 'autonomy-rules', 'autonomy-rules/create', 'autonomy-rules/revoke',
  'autonomy-rules/update', 'role-lines/read', 'role-lines/operations'] as const;
type Suffix = (typeof SUFFIXES)[number];

const WORKSPACE = { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId };
const unpublished = (suffix: string) => ({ code: 'not_found', reason: `unpublished core route ${suffix}` });
/** The two-field SessionRef of a line, as a person's body names it. */
const pairOf = (line: S6ASession): SessionRef => ({ projectId: line.ref.projectId, sessionId: line.ref.sessionId });

/** One lawful body per suffix (see the header). */
function bodyOf(suffix: Suffix, h: S7D2RoleLineWorld): unknown {
  switch (suffix) {
    case 'role-lines/open':
      return graphWrite(S6A_SCOPE, { duty: 'reviewer', scope: [{ kind: 'project' }] }, 'r1-probe-open');
    case 'role-lines/change-scope':
      return graphWrite(S6A_SCOPE, { session: pairOf(h.lines.scribe), scope: [{ kind: 'project' }] },
        'r1-probe-change-scope');
    case 'goals/adviser-queue': return plain(S6A_SCOPE, {});
    case 'goals/adviser-queue/reorder':
      return graphWrite(S6A_SCOPE, { expectedRevision: 0, order: [] }, 'r1-probe-reorder');
    case 'goals/adviser-queue/assign':
      return graphWrite(S6A_SCOPE, { goalRef: h.goal, adviser: pairOf(h.lines.adviser), expectedRevision: 0 },
        'r1-probe-assign');
    case 'autonomy-rules': return plain(S6A_SCOPE, { projectRef: { projectId: S6A_SCOPE.projectId } });
    case 'autonomy-rules/create':
      return graphWrite(S6A_SCOPE, { actions: ['create_member'], scope: [{ kind: 'project' }], limits: { open: {} },
        expiresAt: null, approvedFrom: null }, 'r1-probe-rule-create');
    case 'autonomy-rules/revoke':
      return graphWrite(S6A_SCOPE, { ruleId: 'r1-no-rule', expectedRevision: 1 }, 'r1-probe-rule-revoke');
    case 'autonomy-rules/update':
      return graphWrite(S6A_SCOPE, { ruleId: 'r1-no-rule', expectedRevision: 1, expiresAt: null },
        'r1-probe-rule-update');
    case 'role-lines/read': return plain(S6A_SCOPE, { workspace: WORKSPACE });
    case 'role-lines/operations': return plain(S6A_SCOPE, { workspace: WORKSPACE });
  }
}

describe('O5b-R1 (memory): the eleven suffixes on the role-line world', () => {
  let h: S7D2RoleLineWorld;
  beforeAll(async () => { h = await openS7D2RoleLineWorld({ backend: 'memory' }); }, 300_000);
  afterAll(async () => { await h?.close(); });

  /*
   * Named mutation (v4 :6760): `role-lines/read`'s binding without `personEntry` -> the `role-lines/read` cell answers
   * `ready` instead of `forbidden`; its `toEqual` is red.
   */
  it.each(SUFFIXES)('step 1: a system caller of %s is forbidden before the owner runs', async (suffix) => {
    expect(await h.world.dispatch(suffix, h.world.systemContext(), bodyOf(suffix, h)))
      .toEqual({ status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' });
  }, 120_000);

  it.each(SUFFIXES)('step 2: a GET of %s is 405', async (suffix) => {
    const response = await fetch(new URL(`/api/real/core/${suffix}`, h.world.base),
      { method: 'GET', headers: { [PLATFORM_TOKEN_HEADER]: h.world.token } });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ status: 'rejected', code: 'invalid', reason: 'use POST for core routes' });
  }, 120_000);

  /*
   * Named mutation (v4 :6760): drop `'role-lines/read'` from `CORE_ROUTE_SPECS` -> the `role-lines/read` cell answers
   * HTTP 404 `unpublished core route role-lines/read`: its two assertions, and the `role-lines/read` read below, red.
   */
  it.each(SUFFIXES)('step 3: %s is published (a person POST is not the unpublished 404)', async (suffix) => {
    const answer = await h.world.post(suffix, bodyOf(suffix, h));
    expect(answer.httpStatus).not.toBe(404);
    expect(answer.body).not.toMatchObject(unpublished(suffix));
  }, 120_000);

  it('step 3: role-lines/read answers ready with the three opening lines', async () => {
    const answer = await h.world.post('role-lines/read', plain(S6A_SCOPE, { workspace: WORKSPACE }));
    expect(answer.body).toMatchObject({ status: 'ready', value: { rows: expect.any(Array) } });
    const rows = (answer.body as { value: { rows: { row: { key: SessionRef } }[] } }).value.rows;
    expect(rows.map(entry => entry.row.key.sessionId)).toEqual(expect.arrayContaining(
      [h.lines.secretary.ref.sessionId, h.lines.adviser.ref.sessionId, h.lines.scribe.ref.sessionId]));
  }, 120_000);

  it('step 4: role-lines/open takes a reviewer and refuses an executor with invalid/role_line_duty', async () => {
    expect((await h.open({ duty: 'reviewer', scope: [{ kind: 'project' }], requestId: 'r1-reviewer' })).result)
      .toMatchObject({ status: 'committed' });
    expect((await h.open({ duty: 'executor', scope: [{ kind: 'project' }], requestId: 'r1-executor' })).result)
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'role_line_duty' });
  }, 120_000);

  it('step 5: initialization/adopt stays; there is no plan_adoption route', async () => {
    const adopt = await h.world.post('initialization/adopt', plain(S6A_SCOPE, {}));
    expect(adopt.httpStatus).not.toBe(404);
    expect(adopt.body).not.toMatchObject(unpublished('initialization/adopt'));
    const planAdoption = await h.world.post('plan_adoption', plain(S6A_SCOPE, {}));
    expect(planAdoption.httpStatus).toBe(404);
    expect(planAdoption.body).toEqual({ status: 'rejected', ...unpublished('plan_adoption') });
  }, 120_000);
});

describe('O5b-R1 (memory): the person reorder and assign on the queue world (steps 3 and 6, ruling 46)', () => {
  let q: S7D2QueueWorld;
  beforeAll(async () => {
    q = await openS7D2QueueWorld({ backend: 'memory', advisers: true, drafts: [
      { name: 'g7', autonomy: 'after_plan_confirmation' }, { name: 'g8', autonomy: 'after_plan_confirmation' }] });
  }, 300_000);
  afterAll(async () => { await q?.close(); });
  const assign = (body: unknown) => q.world.post('goals/adviser-queue/assign', body);

  it('the prior: at the open cap G7 and G8 wait in the queue in confirmation order', async () => {
    await q.setOpen('adviser', 2, 'r1-cap');
    expect(await q.confirm('g7')).toMatchObject({ status: 'committed' });
    expect(await q.confirm('g8')).toMatchObject({ status: 'committed' });
    const g7 = q.goalOf('g7');
    const g8 = q.goalOf('g8');
    const ids = await waitFor(() => q.queueIds(), found => found.length === 2, 'G7 and G8 in the adviser queue');
    expect(ids).toEqual([g7.goalId, g8.goalId]);
  }, 300_000);

  it('step 3 reorder: the person\'s permutation [G8, G7] commits at the next revision; a replay is the receipt',
    async () => {
      const [g7, g8] = [q.goalOf('g7'), q.goalOf('g8')];
      const q0 = await q.queue();
      const body = graphWrite(S6A_SCOPE, { expectedRevision: q0.revision, order: [g8, g7] }, 'r1-reorder');
      const first = (await q.world.post('goals/adviser-queue/reorder', body)).body as Record<string, unknown>;
      expect(first).toMatchObject({ status: 'committed', value: { revision: q0.revision + 1 } });
      expect((first['value'] as GoalAdviserQueueV1).entries.map(entry => entry.goalRef.goalId))
        .toEqual([g8.goalId, g7.goalId]);
      expect((await q.world.post('goals/adviser-queue/reorder', body)).body)
        .toMatchObject({ status: 'committed', replayed: true, cursor: first['cursor'] });
    }, 120_000);

  /*
   * Named mutation (ruling 35): the queue owner's assign without the destination duty check -> this cell's
   * `toEqual` (the `invalid` refusal) answers `committed` and G7 lands on the secretary: red.
   */
  it('step 3 assign: a person\'s assign to the opening secretary is refused; queue and links do not move',
    async () => {
      const g7 = q.goalOf('g7');
      const q1 = await q.queue();
      const f0 = await q.linesOf(g7);
      expect((await assign(graphWrite(S6A_SCOPE, { goalRef: g7, adviser: pairOf(q.lines.secretary),
        expectedRevision: q1.revision }, 'r1-assign-secretary'))).body)
        .toEqual({ status: 'rejected', code: 'invalid', reason: 'the destination Session is not an adviser line' });
      expect(await q.queue()).toEqual(q1);
      expect(await q.linesOf(g7)).toEqual(f0);
      expect(await q.goalsOf(q.lines.secretary)).not.toContain(g7.goalId);
    }, 120_000);

  it('step 3 assign: a person\'s assign of G7 to adviser A commits beyond A\'s three; a replay is the receipt',
    async () => {
      const [g7, g8] = [q.goalOf('g7'), q.goalOf('g8')];
      const a = q.advisers!.a;
      const body = graphWrite(S6A_SCOPE, { goalRef: g7, adviser: pairOf(a), expectedRevision: (await q.queue()).revision },
        'r1-assign');
      const first = (await assign(body)).body as Record<string, unknown>;
      expect(first).toMatchObject({ status: 'committed' });
      expect(await q.linesOf(g7)).toEqual([a.ref.sessionId]);
      expect(await q.queueIds()).toEqual([g8.goalId]);
      expect((await assign(body)).body).toMatchObject({ status: 'committed', replayed: true, cursor: first['cursor'] });
    }, 120_000);

  /*
   * Named mutation (ruling 36; v4 :6324–:6327): `assignGoalAdviser`'s binding spreads `request.input` again -> the
   * extra `operationRef` and `kind` reach the owner, and this cell is not `committed` (it answers `unavailable`: the
   * spread `kind: 'reorder'` overrides the owner's `'assign'`, so the write takes the reorder branch, which has no
   * `order`): its `toMatchObject` and the two reads after it are red.
   */
  it('step 6: the person\'s assign with an extra operationRef and kind commits like one without them', async () => {
    const g8 = q.goalOf('g8');
    const b = q.advisers!.b;
    const body: Record<string, unknown> = { goalRef: g8, adviser: pairOf(b), expectedRevision: (await q.queue()).revision,
      operationRef: { aggregateType: 'CoreOperation', projectId: S6A_SCOPE.projectId, operationId: 'r1-card' },
      kind: 'reorder' };
    expect((await assign(graphWrite(S6A_SCOPE, body, 'r1-card-assign'))).body).toMatchObject({ status: 'committed' });
    expect(await q.linesOf(g8)).toEqual([b.ref.sessionId]);
    expect(await q.queueIds()).toEqual([]);
  }, 120_000);
});
