/**
 * RL-17 (`7d2-start-rulings.v4.md:8855`; book `:1320`, §3.9 item 2 layer 5): an out-of-bounds action answers
 * `{status:'needs_decision', cardKey}` in the same turn; only the action and its dependents stop, with no suspension
 * and no timeout release. A regression row for O3b (lead Q18): the 7C member card and O3a's policy already serve it.
 *
 * World: `openS7D2RulesWorld` (tests/helpers/S7D2-rules-world.ts), memory, no rule. G is `every_step`; one adopted
 * Plan: T0 (E's own Task), T1 (the member Task, the `s7c-executor` Role so no line is reusable), T2 (a precise-input
 * dependency on T1's output, `plans/propose` + `plans/apply`; its own responsible line, so only the dependency stops
 * it) and T3 (independent, its own responsible line); both lines through `sessions/create`. E = the S7C `s6a-work-binding` line (`createMember: true`, `create_member` in its tools; lead Q18).
 * The world's default `select_work` picks T0's checks first, so step (4) names each Task explicitly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { S7C1_CREATE_ROLE } from '../helpers/S7C-member-fixture.js';
import { askS7D2Member } from '../helpers/S7D2-role-line-world.js';
import { openS7D2RulesWorld, type S7D2RulesWorld } from '../helpers/S7D2-rules-world.js';

const worlds: S7D2RulesWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

/** `workflow/advance` of `select_work` for one named Task of G, stopped before the Run's checks. */
async function advance(world: S7D2RulesWorld, taskId: string, flowId: string): Promise<void> {
  await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.g, flowId, sessionHint: null,
    kind: 'select_work', taskId }, { stopBefore: 'open_checks' });
}

describe('RL-17: an out-of-bounds action answers at once and stops only itself and its dependents', () => {
  /* Named mutation (v4 :8855): suspend the turn (the tool call does not answer at once): E's second scripted reply
     is not consumed and its Run does not end, so `askS7D2Member` (it checks every reply is used) and the
     `pending`/two-request assertions turn red. */
  it('E’s create_member on T1 answers needs_decision in the turn; T3 runs, T1 and T2 wait past every timeout', async () => {
    const world = await openS7D2RulesWorld({ tasks: [{ taskId: 'rl17-t0', role: 's7c-creator' },
      ...['rl17-t1', 'rl17-t2', 'rl17-t3'].map(taskId => ({ taskId, role: 's7c-executor' }))],
    dependsOn: [{ taskId: 'rl17-t2', dependsOnId: 'rl17-t1', requires: { kind: 'output-contract', label: 'rl17-t1-output' } }] });
    worlds.push(world);
    const t3Line = await sessionOf(world.world, await createS6BLine(world.main, { label: 'rl17-t3', role: S7C1_CREATE_ROLE,
      tasks: [world.gTask('rl17-t3')] }));
    // lead ruling 11-04 18:0x on reply 7.2: T2 has a responsible line of its own, like T3, so only its precise-input
    // dependency on T1 keeps it from dispatching (F11).
    const t2Line = await sessionOf(world.world, await createS6BLine(world.main, { label: 'rl17-t2', role: S7C1_CREATE_ROLE,
      tasks: [world.gTask('rl17-t2')] }));
    const runOf = (taskId: string) => world.main.taskRun(world.g, taskId);

    // (1)–(2) the real tool on E's Work Run: the call answers in the same turn and the Run's next reply is used.
    const asked = await askS7D2Member(world.world, { caller: world.lines.work, goal: world.g,
      callerTask: world.gTask('rl17-t0'), memberTask: world.gTask('rl17-t1'), label: 'rl17-e' });
    expect(asked).toMatchObject({ status: 'needs_decision', cardKey: expect.any(String) });
    expect(await world.world.scripted.pending(world.lines.work)).toBe(0);
    expect(await world.world.scripted.requests(world.lines.work)).toHaveLength(2);
    // (3) the card in `decisions/queue` carries the tool's `cardKey`.
    const cardKey = asked.status === 'needs_decision' ? asked.cardKey : null;
    const card = (await world.main.readCards(world.g)).find(candidate => candidate.source.kind === 'member_creation');
    expect(card?.source.key).toBe(cardKey);

    // (4) T3 advances; T1 and T2 do not dispatch.
    await world.world.scripted.script(t3Line, [{ kind: 'text', text: 'RL-17 T3 done' }]);
    await world.world.scripted.script(t2Line, [{ kind: 'text', text: 'RL-17 T2 done' }]);
    for (const taskId of ['rl17-t1', 'rl17-t2', 'rl17-t3']) await advance(world, taskId, `rl17-${taskId}`);
    expect(await runOf('rl17-t3')).not.toBeNull();
    expect([await runOf('rl17-t1'), await runOf('rl17-t2')]).toEqual([null, null]);

    // (5)–(6) seven days later (past every former timeout) nothing was released and nothing applied.
    world.world.clock.advance(604_800_000);
    for (const taskId of ['rl17-t1', 'rl17-t2']) await advance(world, taskId, `rl17-${taskId}-later`);
    expect(ready(await world.main.route('decisions/card', { source: card!.source }), 'the member card'))
      .toMatchObject({ state: 'waiting_answer', application: null });
    expect([await runOf('rl17-t1'), await runOf('rl17-t2')]).toEqual([null, null]);
  });
});
