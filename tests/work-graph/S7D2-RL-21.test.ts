/**
 * RL-21 (`7d2-start-rulings.v4.md:8859`, §6.1 `:6175–:6186`; the four lines of `later-rows-merged.md:213`; drafts
 * O5a-05 and O5a-06, `7d2-drill-rulings.draft.md:170–:171`; write-tests brief `tests-7d2-o5a2.txt:49–:81`): a
 * secretary's `create_member` creates an executor line only under a responsible adviser of the Goal or the task's
 * region; without one the call is `invalid/no_responsible_adviser` with zero writes and the task reads "waiting for an
 * adviser"; with one the line E is S's (`creator` S, `openedBy: 'secretary_create'`), the adviser gets one notice per
 * operation, and the executor's open cap refuses the next line with its detail. Neither the creator nor the person
 * stands in for the adviser.
 *
 * World (o5a2 rulings 18, 21, 22, 24): O1b's role-line world, memory, with `create_member` merged into the S6A
 * secretary binding (`extraBindings`, as `tests/helpers/S7D2-rules-world.ts:56`). Its Host runs the request driver
 * (`tests/helpers/S7D2-role-line-world.ts:317–:323`); the three opening lines hold only a project link.
 * - The Plan: `plans/propose` + `plans/apply` on G (`adoptS6BPlan`) with T = `rl21-t` and T2 = `rl21-t2`, both on
 *   the world's Work role. `plans/apply` starts no Goal driver, so no Run moves and no adviser is allocated.
 * - S: `sessions/create` of a second S6A secretary (`createSecretary`; a person is its creator).
 * - A round: S's scripted model calls `create_member` once and answers; `requests/submit` names S as recipient and
 *   the request driver claims it; a bounded wait until the round has ended. Each round has its own callId and
 *   commandId; the next round is submitted after the last one ended.
 * - A: `role-lines/open` adviser on goal G, whose open responsible link to G is written by the open itself.
 *
 * Expected (by hand):
 * - (1) G has no responsible link and T has `moduleRef: null` (a goal-scope task), so the resolver's goal arm and its
 *   technical arm both read no adviser; with `asker: null` there is no creator arm, so the answer is the person and
 *   the call is `{status:'rejected', code:'invalid', reason:'no_responsible_adviser'}` (v4 `:6069–:6085`, `:5350–:5386`).
 * - (2) the task read's `display.adviserWait` is exactly `waiting for an adviser` on hover and on the detail summary
 *   (v4 `:6028–:6037`); (3) after A it is `null`: T's technical read falls back to the Goal and finds A.
 * - (4) the same call creates E; one `member_create` row; one notify in A's inbox (TS-20; drill rulings `:1821`).
 *   The replay is the request's: the same commandId and body answer the first submit's `requestRoot` and write no
 *   operation and no notice (o5a2 ruling 29). The owner's own receipt replay has no public entry and is not proved.
 * - (7) only E holds an executor seat; at `open.executor = 1` the call for T2 is refused before any line or notice
 *   with `at_cap: executor has 1 holder(s) and 0 reservation(s) against open limit 1` (v4 `:6093`) and the detail
 *   `{duty:'executor', holders:1, reservations:0, open:1, episode:null}` (v4 `:6182`; a secretary's member is no
 *   platform add, so no episode).
 * Reads: `role-lines/operations`, `sessions/find`, `sessions/read`, `graph/hover`, `graph/detail`, `messages/inbox`,
 * `role-lines/allocation`, `decisions/queue`. Not asserted (brief `:81`): the goal owners, the stored line name,
 * `role-lines/read`, other workspaces, the notice text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GraphHoverReadV1, NodeDetailV1, TaskHoverV1 } from '../../src/contracts/work-line.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6ASubmitInput } from '../helpers/S6A-host-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { openS7D2RoleLineWorld, openTargetsOf, type S7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';

const worlds: S7D2RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const AT_CAP_ONE = 'at_cap: executor has 1 holder(s) and 0 reservation(s) against open limit 1';

/** The `member_create` rows `role-lines/operations` lists in the main workspace. */
async function memberCreateRows(handle: S7D2RoleLineWorld): Promise<number> {
  return (await handle.operations()).filter(row => row.action === 'member_create').length;
}

/** The items of the adviser's inbox whose intent is `notify`. */
async function notifyCount(handle: S7D2RoleLineWorld, adviser: S6ASession): Promise<number> {
  return (await inboxOf(handle.world, adviser.ref)).filter(item => item.intent === 'notify').length;
}

const memberCards = (cards: readonly DecisionCardV1[]): DecisionCardV1[] =>
  cards.filter(card => card.source.kind === 'member_creation');

/** T's task object in `graph/hover` of G. */
async function hoverTaskOf(handle: S7D2RoleLineWorld, task: TaskTriple): Promise<TaskHoverV1> {
  const hover = valueOf<GraphHoverReadV1>((await handle.world.post('graph/hover',
    plain(S6A_SCOPE, { goalRef: handle.goal }))).body, 'ready', 'graph/hover of G');
  const found = hover.tasks.find(row => row.task.taskId === task.taskId);
  if (found === undefined) throw new Error(`RL-21: graph/hover has no ${task.taskId}: ${JSON.stringify(hover.tasks)}`);
  return found;
}

type RL21Round = { result: MemberRequestResultV1; submit: S6ASubmitInput; requestRoot: unknown };

/**
 * One secretary request round on S: the scripted model calls `create_member` for `task` once, then answers; the
 * directed submit is claimed by the request driver; a bounded wait until the round ended. Answers the tool's JSON
 * block, the submit's input and its `requestRoot`.
 */
async function secretaryRound(handle: S7D2RoleLineWorld, secretary: S6ASession,
  input: { callId: string; task: TaskTriple }): Promise<RL21Round> {
  const host = handle.world;
  await host.scripted.script(secretary, [
    { kind: 'calls', calls: [{ callId: input.callId, name: 'create_member',
      args: { duty: 'executor', scope: { kind: 'task', task: input.task }, reason: 'RL-21' } }] },
    { kind: 'text', text: secretaryAnswer({ body: 'RL-21 answer' }) },
  ]);
  const submit: S6ASubmitInput = { commandId: `${input.callId}-submit`, goalId: handle.goal.goalId,
    text: `RL-21 ${input.callId}`, recipient: secretary };
  const submitted = await host.submit(submit);
  if (submitted.status !== 'queued') throw new Error(`RL-21: ${input.callId} was not queued: ${JSON.stringify(submitted)}`);
  await host.waitForRequest(submitted.requestRoot, view => view.rounds[0]?.status === 'ended', `the round ${input.callId}`);
  const left = await host.scripted.pending(secretary);
  if (left !== 0) throw new Error(`RL-21: the round ${input.callId} left ${String(left)} scripted replies`);
  return { result: jsonOf(await host.scripted.requests(secretary), input.callId) as MemberRequestResultV1, submit,
    requestRoot: submitted.requestRoot };
}

describe('RL-21: the secretary creates an executor line only under a responsible adviser', () => {
  /*
   * Named mutation (draft O5a-05 `7d2-drill-rulings.draft.md:170`; o5a2 ruling 23): remove the secretary caller's
   * first no-adviser rejection (the secretary branch of the request read in `member-service.ts`). The accepted
   * `member_create` operation is then written, and the second check at the top of `runCreation` still answers
   * `no_responsible_adviser`, so the tool result, the task's `sessions/find` and the task read do not change: of
   * step (1) only the "zero `member_create` rows" sentence turns red, and the row stops there. (The v4 mutation
   * "fall back to the creator" cannot red here: S's creator is a person, which the resolver's creator arm reads as no
   * Session, v4 `:5383–:5386`.)
   */
  it('RL-21 (memory): no adviser -> invalid and the task waits; after A -> E by S with one notice; at the cap ->'
    + ' capacity/at_cap with its detail', async () => {
    const handle = await openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [
      { binding: { id: 's6a-secretary-binding' } as WorkbenchRuntimeBinding, mergeTools: ['create_member'] }] });
    worlds.push(handle);
    const host = handle.world;
    const goal = handle.goal;
    const { tasks } = await adoptS6BPlan(handle.main, goal, { label: 'rl21', role: S6A_WORK_ROLE.templateId,
      taskIds: ['rl21-t', 'rl21-t2'] });
    const t = tasks[0]!;
    const t2 = tasks[1]!;
    const secretary = await host.createSecretary('rl21-s');

    // Prior: the default autonomy (direct creation), no line on G, no member operation.
    const settings = valueOf<{ settings: { autonomy: string } }>((await host.post('goals/settings',
      plain(S6A_SCOPE, { goalRef: goal }))).body, 'ready', 'goals/settings of G');
    expect(settings.settings.autonomy).toBe('after_plan_confirmation');
    expect(await handle.findByTarget(handle.targets.goal)).toEqual([]);
    expect(await memberCreateRows(handle)).toBe(0);

    // (1) T without an adviser: refused, nothing written, nothing handed to the person.
    const first = await secretaryRound(handle, secretary, { callId: 'rl21-c1', task: t });
    expect(first.result).toEqual({ status: 'rejected', code: 'invalid', reason: 'no_responsible_adviser' });
    expect(await memberCreateRows(handle)).toBe(0);
    expect(await handle.findByTarget({ kind: 'task', ref: t })).toEqual([]);
    expect(memberCards(await handle.cards())).toEqual([]);

    // (2) Both task reads carry the wait.
    const hovered = await hoverTaskOf(handle, t);
    expect(hovered.display.adviserWait).toBe('waiting for an adviser');
    const detail = valueOf<NodeDetailV1>((await host.post('graph/detail', plain(S6A_SCOPE, { goalRef: goal,
      node: { kind: 'task', ref: t, planRef: hovered.planRef }, section: 'summary',
      page: { afterCursor: null, limit: 20 } }))).body, 'ready', 'graph/detail of T');
    expect(detail.section === 'summary' ? detail.task?.display.adviserWait : detail).toBe('waiting for an adviser');

    // (3) A on G; the task read follows the resolver.
    const opened = await handle.open({ duty: 'adviser', scope: [{ kind: 'goal', goalRef: goal }],
      requestId: 'rl21-open-a' });
    expect(opened.result).toMatchObject({ status: 'committed' });
    const adviser = await handle.lineOf('rl21-a', opened.result);
    expect(openTargetsOf(await handle.readCard(adviser))).toContainEqual(handle.targets.goal);
    expect((await hoverTaskOf(handle, t)).display.adviserWait).toBeNull();

    // (4) The same call, a new identity: E, one operation, one notice; the request replay writes none.
    const second = await secretaryRound(handle, secretary, { callId: 'rl21-c2', task: t });
    expect(second.result).toMatchObject({ status: 'created' });
    if (second.result.status !== 'created') throw new Error('RL-21: E was not created');
    const member: SessionRef = second.result.session;
    expect((await handle.findByTarget({ kind: 'task', ref: t })).map(card => card.record.ref.sessionId))
      .toEqual([member.sessionId]);
    expect(await memberCreateRows(handle)).toBe(1);
    expect(await notifyCount(handle, adviser)).toBe(1);
    expect(await host.submit(second.submit)).toHaveProperty('requestRoot', second.requestRoot);
    expect(await memberCreateRows(handle)).toBe(1);
    expect(await notifyCount(handle, adviser)).toBe(1);

    // (5) E's facts and its task link.
    const card = await handle.readCard(member);
    expect(card.roleFacts).toMatchObject({ creator: { kind: 'session', ref: { projectId: secretary.ref.projectId,
      sessionId: secretary.ref.sessionId } }, openedBy: 'secretary_create' });
    expect(openTargetsOf(card)).toContainEqual({ kind: 'task', ref: t });

    // (6) Direct creation: no member card for the person.
    expect(memberCards(await handle.cards())).toEqual([]);

    // (7) At the executor open cap the call for T2 is refused with the detail, before any line or notice.
    expect((await handle.allocation()).duties.executor.holders.map(holder => holder.session.sessionId))
      .toEqual([member.sessionId]);
    await handle.setOpen('executor', 1, 'rl21-cap');
    const third = await secretaryRound(handle, secretary, { callId: 'rl21-c3', task: t2 });
    expect(third.result).toEqual({ status: 'rejected', code: 'capacity', reason: AT_CAP_ONE,
      detail: { duty: 'executor', holders: 1, reservations: 0, open: 1, episode: null } });
    expect(await handle.findByTarget({ kind: 'task', ref: t2 })).toEqual([]);
    expect(await notifyCount(handle, adviser)).toBe(1);
  });
});
