/**
 * INT U1 rows (run sheet §4.5): the adviser and secretary see the person's words to
 * other lines, latest three, without a wake. W1 is red on the base (no section);
 * mutation: the adviser recipe does not read them. W2/W3 are the secretary, limit and
 * order; W4 proves the words open no round.
 */
import { afterEach, expect, it } from 'vitest';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { adoptPLTwoStageSkeleton, openPLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { withConfiguredHost } from '../helpers/S7C-member-fixture.js';
import { heartbeatUntil, settleHost, waitForResponse } from '../helpers/IV-host-fixture.js';
import { withS6AWorkProfile } from '../helpers/S7B2-consumable-sessions.js';
import { listed } from '../helpers/S7B-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { firstPlan } from '../helpers/S7B-V-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { intAwaitPlanning, intSendPerson, intUserInputs } from '../helpers/INT-world.js';

const HEADING = '## What the person said directly to other lines';
const E_WORDS = '导出时别动旧格式';
const A_WORDS = '按刚才说的改计划';
const closers: Array<() => Promise<void>> = [];
/** One `##` section of the first model input. */
function sectionOf(input: string, heading: string): string {
  const lines = input.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) return '';
  const rest = lines.slice(at + 1);
  const end = rest.findIndex(line => line.startsWith('#'));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}
type Opened = Awaited<ReturnType<typeof openPLWorkflowWorld>>;
type Line = Awaited<ReturnType<typeof sessionOf>>;

async function openWorld(label: string): Promise<{ opened: Opened; adviser: Line; executor: Line }> {
  // The shared Work profile (S7B2-consumable-sessions.ts:203) is not in the PL workflow world; install it for the
  // one start so the executor line E really consumes its own messages.
  const opened = await withConfiguredHost(() => openPLWorkflowWorld({ label }), withS6AWorkProfile);
  closers.push(opened.close);
  await adoptPLTwoStageSkeleton(opened.main, opened.goal, { label });
  const adviser = await createPLAdviserLine(opened.world, `${label}-adviser`);
  const executor = await sessionOf(opened.world, await createS6BLine(s6aCardsWorkspace(opened.world, S6A_SCOPE),
    { label: `${label}-executor`, role: S6A_WORK_ROLE }));
  await settleHost(opened.world);
  return { opened, adviser, executor };
}

async function toExecutor(opened: Opened, executor: Line, id: string, texts: readonly string[]): Promise<void> {
  for (const [index, text] of texts.entries()) {
    await opened.world.scripted.script(executor, [{ kind: 'text' as const, text: `INT ${id} ${text}` }]);
    const sent = await intSendPerson(opened.world, { id: `${id}-e${String(index)}`, recipient: executor.ref,
      text, goal: opened.goal });
    // E really handles it and answers in public before the adviser's next round reads the words.
    const handled = await waitForResponse(opened.world, sent.ref, 24);
    expect(handled.response, 'the executor answered the person message').not.toBeNull();
    opened.world.clock.advance(1_000);
  }
}

async function adviserInput(opened: Opened, adviser: Line, id: string): Promise<string> {
  await opened.world.scripted.script(adviser, [{ kind: 'text', text: firstPlan({ label: `int-${id}`,
    taskId: `int-${id}-task`, role: S6A_WORK_ROLE.templateId }) }]);
  const sent = await intSendPerson(opened.world, { id: `${id}-a`, recipient: adviser.ref, text: A_WORDS,
    goal: opened.goal });
  await intAwaitPlanning(opened.world, sent.ref, 16);
  return await roundInput(opened, adviser);
}

/** The first user input of the adviser round that carries the person's own words. */
async function roundInput(opened: Opened, adviser: Line): Promise<string> {
  const requests = await heartbeatUntil(opened.world, () => opened.world.scripted.requests(adviser),
    list => list.some(request => request.messages.some(message => message.role === 'user')), 16);
  return requests.at(-1)?.messages.find(message => message.role === 'user')?.content ?? '';
}

afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-W1 the adviser input carries the executor\'s words, except its own', async () => {
  const { opened, adviser, executor } = await openWorld('int-w1');
  await toExecutor(opened, executor, 'w1', [E_WORDS]);
  const input = await adviserInput(opened, adviser, 'w1');
  expect(input, 'the section heading').toContain(HEADING);
  expect(input, 'the executor\'s words').toContain(E_WORDS);
  expect(sectionOf(input, '## Question'), 'its own message is in Question').toContain(A_WORDS);
  expect((input.split(A_WORDS).length - 1), 'and appears nowhere else').toBe(1);
}, 180_000);

it('INT-W2 the secretary input carries both lines\' words', async () => {
  const { opened, adviser, executor } = await openWorld('int-w2');
  await toExecutor(opened, executor, 'w2', [E_WORDS]);
  await adviserInput(opened, adviser, 'w2');
  const secretary = await opened.world.createSecretary('int-w2-secretary');
  await opened.world.scripted.script(secretary, [{ kind: 'text', text: 'INT-W2 secretary answer' }]);
  const submitted = await opened.world.submit({ commandId: 'int-w2-request', goalId: opened.goal.goalId,
    text: 'INT-W2 what did they ask', continues: null, recipient: secretary });
  if (submitted.status !== 'queued') throw new Error(`INT-W2: ${JSON.stringify(submitted)}`);
  if ((await claimWithSecretaryProfile(opened.world, submitted.round, secretary,
    'int-w2-claim'))['status'] !== 'committed') throw new Error('INT-W2: the secretary claim failed');
  const prepared = await prepareAttempt(opened.world, submitted.round, 'int-w2-prepare');
  if ((await start(opened.world, prepared, 'int-w2-start'))['status'] !== 'ready') {
    throw new Error('INT-W2: the secretary round did not start');
  }
  await opened.world.waitForRequest(submitted.requestRoot, view => view.rounds.some(round =>
    round.status === 'ended'), 'the W2 secretary round');
  const input = intUserInputs(await opened.world.scripted.requests(secretary)).at(-1) ?? '';
  expect(input, 'the executor\'s words').toContain(E_WORDS);
  expect(input, 'the adviser\'s words').toContain(A_WORDS);
}, 180_000);

it('INT-W3 the adviser sees only the latest three words, oldest first', async () => {
  const { opened, adviser, executor } = await openWorld('int-w3');
  await toExecutor(opened, executor, 'w3', ['INT-W3 一', 'INT-W3 二', 'INT-W3 三', 'INT-W3 四']);
  const input = await adviserInput(opened, adviser, 'w3');
  expect(input).toContain(HEADING);
  expect(input, '二 is listed').toContain('INT-W3 二');
  expect(input, '三 is listed').toContain('INT-W3 三');
  expect(input, '四 is listed').toContain('INT-W3 四');
  expect(input.indexOf('INT-W3 二'), '二 before 三').toBeLessThan(input.indexOf('INT-W3 三'));
  expect(input.indexOf('INT-W3 三'), '三 before 四').toBeLessThan(input.indexOf('INT-W3 四'));
  expect(input, 'the oldest falls off').not.toContain('INT-W3 一');
}, 180_000);

it('INT-W4 words to another line never open a round on the adviser', async () => {
  const { opened, adviser, executor } = await openWorld('int-w4');
  const before = (await opened.world.scripted.requests(adviser)).length;
  await opened.world.scripted.script(executor, [{ kind: 'text', text: 'INT-W4 executor answer' }]);
  const sent = await intSendPerson(opened.world, { id: 'w4-e', recipient: executor.ref, text: E_WORDS,
    goal: opened.goal });
  // Wait until E has handled and answered it: the row is about what E's handling leaves on other lines.
  const handled = await waitForResponse(opened.world, sent.ref, 24);
  expect(handled.response, 'the executor answered the person message').not.toBeNull();
  const inbox = await listed(opened.world, 'inbox', adviser);
  expect(inbox.some(message => message.originalRef !== null
    && message.originalRef.messageId === sent.ref.messageId), 'no copy of the words in the adviser inbox').toBe(false);
  expect((await opened.world.scripted.requests(adviser)).length, 'no adviser turn').toBe(before);
}, 180_000);
