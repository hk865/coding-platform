/**
 * PL-32 (spec §15.4, v4 §15-32): an executor's own report lets go of only that
 * Task.
 *
 * A's real Work Run sends M (`send_session_message`, `action_request`,
 * `waitAfterSend: true`) to the adviser and yields. The Host's own consumer
 * claims the adviser's planning Query and holds it at the one model request.
 * While that Query is unanswered, B's real Work Run claims and completes on its
 * own line. The row reads M, the held Query and B's Run through public routes.
 *
 * The deviation arm must not read a yielded Run as a platform deviation, and no
 * Goal-wide wait may be introduced: that is the named mutation.
 */
import { afterEach, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { heartbeatUntilModel, readPlanningQuery, settleHost } from '../helpers/IV-host-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { satisfyPLTask } from '../helpers/PL-workflow-fixture.js';
import {
  createPLAdviserLine, createPLLine, openPLConsumptionWorld, seedPLSenderPlan, sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

it('PL-32: a yielded executor opens the adviser Query, M stays waiting and B still runs', async () => {
  const world = await openPLConsumptionWorld({ label: 'pl32' });
  worlds.push(world);
  await settleHost(world);
  const goal = world.goals.first;
  const seeded = await seedPLSenderPlan(world, { goal, label: 'pl32', taskIds: ['pl32-a', 'pl32-b'] });
  const adviser = await createPLAdviserLine(world, 'pl32-adviser');
  const [a, b] = seeded.tasks;
  if (a === undefined || b === undefined) throw new Error('PL-32: the Plan needs two Tasks');

  // The adviser's Query will be built and held at its one model request.
  const gate = await world.gates.modelRequest(adviser);
  const m = await sendPLActionWait(world, {
    goal, session: seeded.line, sessionTaskId: a.taskId, recipient: adviser.ref,
    text: 'PL32: the executor reports a wrong premise and lets go', label: 'pl32',
  });
  const held = await heartbeatUntilModel(world, gate);

  // M still waits; the Host opened the intervention planning Query and has no answer.
  const message = await readS7BMessage(world, m.message.ref);
  expect(message.response, 'M keeps its one open wait').toBeNull();
  expect(message.waitAfterSend).toBe(true);
  const query = await readPlanningQuery(world, m.message.ref);
  expect(query, 'the Host consumed M into the adviser Query').not.toBeNull();
  expect(query?.job.job.status, 'the Query is held unanswered').not.toBe('answered');
  expect(query?.job.job.answerRefs ?? [], 'the held Query has no answer').toHaveLength(0);

  // B runs on its own line while A stays yielded.
  const bLine = await createPLLine(world, { label: 'pl32-b-line', role: S6A_WORK_ROLE, tasks: [b] });
  await world.scripted.script(bLine, [{ kind: 'text', text: 'PL32 B finished while A waits' }]);
  const bRun = await satisfyPLTask(world, goal, b.taskId, bLine, 'pl32-b');
  const bRead = (await world.post('executions/read', plain(S6A_SCOPE, bRun))).body as
    { status?: string; value?: { run?: { outcome?: string } } };
  expect(bRead.status).toBe('ready');
  expect(bRead.value?.run?.outcome, 'B is not stopped by A').toBe('completed');

  // M is still the same open wait after B ran.
  const after = await readS7BMessage(world, m.message.ref);
  expect(after.response).toBeNull();

  // Cleanup: answer the held Query so the world closes with no held model call.
  await world.scripted.script(adviser, [{ kind: 'text', text: 'PL32: no plan change' }]);
  gate.release();
  await held.settled;
}, 120_000);
