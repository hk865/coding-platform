/**
 * RL-20 (`7d2-start-rulings.v4.md:8858`, read per `later-rows-merged.md:211–:212`; v4 `:5738` "RL-20's reclaim half is
 * O2's"; write-tests brief `tests-7d2-o4b2.txt:56–:86`; o4b2 ruling 13): archiving the project-scope adviser moves the
 * project scope to the least loaded same-duty line in the archive commit; at the retained open cap exactly one idle
 * line, the one with the earliest activity, is reclaimed; the duty's last unarchived line is never reclaimed (the open
 * is the capacity refusal); 24 hours idle archive no adviser (decision 91), while the executor's one-day rule still
 * runs. The behaviour is all O2b's; O4b-2 touches none of it, so the row is green on the O4b-2 start point and its
 * named mutation is checked on O2b's code (brief `:58`, `:92`).
 *
 * World: `openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK], extraHostOptions:
 * { scribeReminderPeriodMs: 25 } })` (the Host idle cycle; not the project world, whose too-long adviser hands itself
 * off and takes a seat, o2b Q22). The fixed clock moves only here: `+1,000 ms` between the prior's steps, so the lines'
 * `createdAt` (their `lastActivityAt` without an activity record) are ordered L4 < L3 < L2.
 * - Lp: the opening adviser, holding only the project link.
 * - goal 2's one Plan: `rl20-l2` (the platform adviser role) and `rl20-lx` (the world's Work role).
 * - The workspace's trusted check (a Host input, as `tests/helpers/S7B-V-fixture.ts:26–:27`): the world registers
 *   none, and without one a normally ended Run leaves its Task `verifying` (brief `:73`, checked on the start point).
 *   With it each real Run below is checked and its Task satisfied (lead ruling 11-05 on reply 0.2).
 * - Lx: a Work line (`sessions/create`, executor) linked to `rl20-lx`, whose one real Run is driven to its end.
 * - L4: `role-lines/open` adviser on region `src/a`; L3, opened after L4: on region `docs`. Both idle, burden 1.
 * - L2: `role-lines/open` adviser on `[]` (burden 0), linked to `rl20-l2`, its Run claimed and prepared and stopped
 *   before `start` (a `starting` + `authorized` Run, precedent `S7D2-admission-world.ts:215`).
 * Reads: `sessions/read`, `role-lines/allocation`, `sessions/find`, `decisions/queue`; `role-lines/read` is O5b-R2's
 * (merged `:286`) and is not read.
 *
 * Three sentences of the frozen row are read per o4b2 ruling 13 (brief `:60–:63`): the withdrawn `project_scope_moved`
 * reason becomes "the same commit": L2's new project link's `since` equals Lp's project link's `until`; the claim
 * writes occupancy, so L2 is occupied and not idle, and still receives the project scope; "the executor's 24h row is
 * unchanged" reads as Lx archived after one day, which also shows the 24-hour pass really ran (L3's sentence is not
 * green by default).
 *
 * Expected (by hand): (2) the scope goes to L2, burden 0 < 1 (ties by sessionId only); (3) at `open.adviser = 3` with
 * holders `{L2, L3, L4}` the open of L5 commits after one reclaim: L2 is occupied, L3 and L4 idle, L4 the earliest
 * `lastActivityAt` (= `createdAt`); (6) at +24h L3 stays `active` with `archivedAt: null`, Lx is `archived`; (8) with
 * L3 the duty's only unarchived line and `open.adviser = 1` the open answers `{status:'rejected',code:'capacity',
 * reason:'at_cap: adviser has 1 holder(s) and 0 reservation(s) against open limit 1',detail:{duty:'adviser',
 * holders:1,reservations:0,open:1,episode:null}}` (v4 :8858; `episode` null: a person's `role-lines/open` is no
 * platform automatic add), no card, no new line; (9) L3 stays `active`, `archivedAt: null`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { RoleLineAllocationReportV1 } from '../../src/contracts/role-lines.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { ag2bChecksConfiguration } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { refOf } from '../helpers/S6A-host-fixture.js';
import { S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { cancelS7AGoal } from '../helpers/S7A-fixture.js';
import {
  openS7D2RoleLineWorld, openTargetsOf, S7D2_ADVISER_WORK, S7D2_PROJECT_TARGET, type S7D2RoleLineWorld,
} from '../helpers/S7D2-role-line-world.js';

const worlds: S7D2RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const STEP_MS = 1_000;
const AT_CAP_ONE = 'at_cap: adviser has 1 holder(s) and 0 reservation(s) against open limit 1';

const ids = (lines: readonly (S6ASession | SessionRef)[]): string[] => lines.map(line => refOf(line).sessionId).sort();
const holderIds = (allocation: RoleLineAllocationReportV1): string[] =>
  allocation.duties.adviser.holders.map(holder => holder.session.sessionId).sort();
/** The card's responsible links on the project target, open or closed. */
const projectLinks = (card: SessionCard): SessionWorkLink[] =>
  card.links.filter(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'project');

describe('RL-20: the project scope moves on archive, one idle line is reclaimed, the last line never', () => {
  /*
   * Named mutation (v4 :8858): "Archive the only line" — the tree guards it twice, `role-line-maintenance.ts:637`
   * (`lines.value.length < 2`) and `role-line-reclaim.ts:56` (`lastUnarchivedOfDuty`); with both removed step (8)
   * reclaims L3 and opens the new line: the step-(8) `toEqual` (the capacity refusal) and step (9)'s L3 `active`
   * turn red. Removing only one of the two leaves the row green (the other still stops it), so the mutation opens
   * both (written as `S7D2-RL-13.test.ts:170–:175`). Goal 2 is cancelled before step (8) so L3, holding the project
   * scope, has no Task in progress and is idle; otherwise the mutation would be stopped by "not idle" (DR7d2O4b :27).
   */
  it('RL-20 (memory): Lp archived -> L2 holds the project scope; at the cap L4 is reclaimed; 24h archives no adviser;'
    + ' the last line is refused, not reclaimed', async () => {
    const world = await openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK],
      extraHostOptions: { scribeReminderPeriodMs: 25 } });
    worlds.push(world);
    const host = world.world;
    const tick = (): void => { host.clock.advance(STEP_MS); };
    const second = host.goals.second;

    // Prior 1: Lp holds only the project link.
    const lp = world.lines.adviser;
    expect(openTargetsOf(await world.readCard(lp))).toEqual([S7D2_PROJECT_TARGET]);
    tick();

    // Prior 2: goal 2's one Plan.
    const { tasks } = await adoptPLMixedPlan(host, { goal: second, label: 'rl20', tasks: [
      { taskId: 'rl20-l2', role: PL_ADVISER_ROLE.templateId },
      { taskId: 'rl20-lx', role: S6A_WORK_ROLE.templateId }] });
    const [l2Task, lxTask] = tasks;
    // The workspace's trusted check (a Host input), so a normally ended Run's Task is checked and satisfied.
    host.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
      actor: host.ag2b.actor, command: 'true' }) });
    tick();

    // Prior 3: Lx's one real Run, driven to its end.
    const lx = await world.createWorkLine('rl20-lx');
    valueOf((await world.link({ line: lx, target: { kind: 'task', ref: lxTask! }, requestId: 'rl20-lx-task' })).result,
      'committed', 'the Lx Task link');
    await host.scripted.script(lx, [{ kind: 'text', text: 'RL-20: Lx done' }]);
    await driveWorkflow(host.ag2b, { schemaVersion: 1, goalRef: second, flowId: 'rl20-lx', sessionHint: lx.ref,
      kind: 'select_work', taskId: lxTask!.taskId });
    expect(await host.scripted.pending(lx)).toBe(0);
    tick();

    // Prior 4: L4 (region src/a), then L3 (region docs); both idle, burden 1.
    const l4 = await world.lineOf('rl20-l4', (await world.open({ duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: world.modules.child }], requestId: 'rl20-l4' })).result);
    tick();
    const l3 = await world.lineOf('rl20-l3', (await world.open({ duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: world.modules.other }], requestId: 'rl20-l3' })).result);
    tick();

    // Prior 5: L2 (burden 0) with a Run stopped before its start: `starting` + `authorized`.
    const l2 = await world.lineOf('rl20-l2', (await world.open({ duty: 'adviser', scope: [], requestId: 'rl20-l2' }))
      .result);
    valueOf((await world.link({ line: l2, target: { kind: 'task', ref: l2Task! }, requestId: 'rl20-l2-task' })).result,
      'committed', 'the L2 Task link');
    await host.scripted.script(l2, [{ kind: 'text', text: 'RL-20: L2 done' }]);
    const prepared = await driveWorkflow(host.ag2b, { schemaVersion: 1, goalRef: second, flowId: 'rl20-l2',
      sessionHint: l2.ref, kind: 'select_work', taskId: l2Task!.taskId }, { stopBefore: 'start' });
    const start: WorkflowAdvanceInput | null = prepared.at(-1)?.next ?? null;
    if (start === null || start.kind !== 'perform' || start.operation.kind !== 'start') {
      throw new Error(`RL-20: L2's Run did not stop before its start: ${JSON.stringify(prepared.at(-1))}`);
    }
    tick();

    // (1) `sessions/archive` Lp. (2) Lp archived, its project link closed; L2 holds the project scope from the same
    // commit (`since` = Lp's `until`); L3 and L4 have no project link.
    await world.archive(lp, 'rl20-lp');
    const lpCard = await world.readCard(lp);
    expect(lpCard.record.lifecycle).toBe('archived');
    const lpLinks = projectLinks(lpCard);
    expect(lpLinks).toHaveLength(1);
    expect(lpLinks[0]!.until).not.toBeNull();
    const l2Project = projectLinks(await world.readCard(l2));
    expect(l2Project.map(link => ({ target: link.ref.target, until: link.until })))
      .toEqual([{ target: S7D2_PROJECT_TARGET, until: null }]);
    expect(l2Project[0]!.since).toEqual(lpLinks[0]!.until);
    expect(projectLinks(await world.readCard(l3))).toEqual([]);
    expect(projectLinks(await world.readCard(l4))).toEqual([]);
    tick();

    // (3) At the retained cap 3 the open of L5 reclaims exactly L4 and commits.
    const before = await world.allocation();
    expect(holderIds(before)).toEqual(ids([l2, l3, l4]));
    expect(before.duties.adviser.reservations).toEqual([]);
    await world.setOpen('adviser', 3, 'rl20-cap-3');
    const opened = (await world.open({ duty: 'adviser', scope: [], requestId: 'rl20-l5' })).result;
    expect(opened).toMatchObject({ status: 'committed' });
    const l5 = await world.lineOf('rl20-l5', opened);
    expect((await world.readCard(l4)).record.lifecycle).toBe('archived');
    expect((await world.readCard(l3)).record.lifecycle).toBe('active');
    expect((await world.readCard(l2)).record.lifecycle).toBe('active');
    const after = await world.allocation();
    expect(holderIds(after)).toEqual(ids([l2, l3, l5]));
    expect(after.duties.adviser.reservations).toEqual([]);

    // (4) Past 24 hours. (5) L2's Run is started and driven to its end (before step 7 archives L2; DR7d2O4b :26),
    // one `workflow/advance` (its maintenance page runs first), then one Host idle pass. Lx is still active before.
    expect((await world.readCard(lx)).record.lifecycle).toBe('active');
    host.clock.advance(86_400_001);
    await driveWorkflow(host.ag2b, start);
    expect(await host.scripted.pending(l2)).toBe(0);
    await world.main.route('workflow/advance', { schemaVersion: 1, goalRef: second, flowId: 'rl20-advance',
      sessionHint: null, kind: 'select_work' });
    const settled = host.consumeBarrier();
    host.clock.advance(25);
    await settled;

    // (6) No adviser idle archive at 24h (decision 91); the executor's one-day rule ran: Lx is archived.
    expect((await world.readCard(l3)).record).toMatchObject({ lifecycle: 'active', archivedAt: null });
    expect((await world.readCard(lx)).record.lifecycle).toBe('archived');

    // (7) Archive L5, then L2: the project scope ends on L3, the duty's only unarchived line; cap 1; goal 2 cancelled
    // (its gate Task would keep L3, holding the project scope, busy).
    await world.archive(l5, 'rl20-l5');
    await world.archive(l2, 'rl20-l2');
    expect(projectLinks(await world.readCard(l3)).filter(link => link.until === null)
      .map(link => link.ref.target)).toEqual([S7D2_PROJECT_TARGET]);
    const last = await world.allocation();
    expect(holderIds(last)).toEqual(ids([l3]));
    expect(last.duties.adviser.reservations).toEqual([]);
    await world.setOpen('adviser', 1, 'rl20-cap-1');
    await cancelS7AGoal(host, second);

    // (8) The open at the cap with L3 the last line: the capacity refusal, no card, no reclaim, no new line.
    const goal1 = { kind: 'goal' as const, ref: host.goals.first };
    const cardsBefore = await world.cards();
    const goal1Before = ids((await world.findByTarget(goal1)).map(card => card.record.ref));
    expect((await world.open({ duty: 'adviser', scope: [{ kind: 'goal', goalRef: host.goals.first }],
      requestId: 'rl20-last' })).result).toEqual({ status: 'rejected', code: 'capacity', reason: AT_CAP_ONE,
      detail: { duty: 'adviser', holders: 1, reservations: 0, open: 1, episode: null } });
    expect(await world.cards()).toEqual(cardsBefore);
    const refused = await world.allocation();
    expect(holderIds(refused)).toEqual(ids([l3]));
    expect(refused.duties.adviser.reservations).toEqual([]);
    expect(ids((await world.findByTarget(goal1)).map(card => card.record.ref))).toEqual(goal1Before);

    // (9) L3 stays active.
    expect((await world.readCard(l3)).record).toMatchObject({ lifecycle: 'active', archivedAt: null });
  }, 300_000);
});
