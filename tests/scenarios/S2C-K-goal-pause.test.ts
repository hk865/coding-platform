/**
 * Slice 2C row 2C-13 (LE4, moved from LE3): a Goal pause reaches the running
 * line through the real `goals/control` route and the Host's fan-out driver; the
 * line reads `paused` with the `paused_by_goal` reason while the Goal is paused.
 *
 * Entry LE4: `openHostScenario`, `lines/list` through the real route, the Goal
 * pause through `goals/control` (`./support/control.js`). Expected values are
 * the literal §3.2 T3a and §3.9 words.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, type HostScenario } from './harness.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { createAG2bSession, AG2B_WORK_ROLE } from '../helpers/AG2b-collaboration-fixture.js';
import { goalControlled } from './support/control.js';
import { WORK_TARGET } from './support/common.js';
import { lineList, ready, requireLine } from '../helpers/S2C-K-scenario-support.js';

afterEach(cleanupScenarios);

it('2C-13 (1) a Goal pause pauses the running line with reason paused_by_goal and keeps its Session unavailable', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: {
    replies: [
      { kind: 'calls', calls: [{ callId: 's2c13-g1', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 's2c13: the paused Turn is never answered' },
    ],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      await goalControlled(h.host, 'pause', 's2c13-goal-pause');
    } } });
  await h.advance(h.select('s2c13-run1', 'ag2b-work'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;

  const list = ready(await lineList(h), 'lines/list with the Goal paused');
  const row = requireLine(list, head, 'the Goal-paused line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason.code).toBe('paused_by_goal');
  expect(row.status.bucket).toBe('standby');

  // L19: pausing the Goal does not suppress attention. The line is not empty of work; the
  // explicit attention assertion belongs to the card cases (2C-12). The line stays a line.
  expect(list.rows.length).toBe(1);
}, 240_000);

it('2C-13 (2) a Goal pause turns an idle line that owns an unfinished Task to standby paused_by_goal, not waiting_dispatch', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'text', text: '2C-13 (2): no Turn is driven' },
  ] } });
  // A real idle work Session that owns the unfinished Task through its initial link.
  const idle = await createAG2bSession(h.host, 's2c13-idle', AG2B_WORK_ROLE,
    [{ target: WORK_TARGET, relation: 'responsible' }]);

  let row = requireLine(ready(await lineList(h), 'lines/list before the Goal pause'), idle.sessionRef.sessionId,
    'the idle owned line');
  expect(row.status.own).toBe('standby');
  expect(row.status.ownReason.code).toBe('waiting_dispatch');

  await goalControlled(h.host, 'pause', 's2c13-idle-goal-pause');
  row = requireLine(ready(await lineList(h), 'lines/list after the Goal pause'), idle.sessionRef.sessionId,
    'the idle line with the Goal paused');
  expect(row.status.own).toBe('standby');
  expect(row.status.ownReason.code).toBe('paused_by_goal');
  expect(row.status.bucket).toBe('standby');
}, 240_000);

it('2C-13 (3) cancelling the Goal turns an idle line that owns an unfinished Task to standby goal_cancelled', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'text', text: '2C-13 (3): no Turn is driven' },
  ] } });
  const idle = await createAG2bSession(h.host, 's2c13-cancel-idle', AG2B_WORK_ROLE,
    [{ target: WORK_TARGET, relation: 'responsible' }]);

  await goalControlled(h.host, 'cancel', 's2c13-idle-goal-cancel');
  const row = requireLine(ready(await lineList(h), 'lines/list after the Goal cancel'), idle.sessionRef.sessionId,
    'the idle line with the Goal cancelled');
  expect(row.status.own).toBe('standby');
  expect(row.status.ownReason.code).toBe('goal_cancelled');
  expect(row.status.bucket).toBe('standby');
}, 240_000);
