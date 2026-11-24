import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { bootE3N, onMain, quietPage, textOf, thread, waitFor } from './helpers/E3N-page.js';
import {
  openRun, runRows, stepObject, stepOfVerb, stepVerbs,
} from './helpers/E3U-run-steps-page.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';

/**
 * E3U 1A row ② (ui-batches 155): one secretary turn in the S6A host world runs
 * `run_readonly_command` through the real `queries/claim` → `queries/prepare` →
 * `queries/start` path (the P1S S2 recipe). Main's conversation for the round
 * and Plan's conversation for the same Goal both draw that round's Run block;
 * expanded, each has a 运行命令 step naming the command. The page reads the
 * real route (`executions/steps`); nothing here constructs a reply.
 *
 * The two pages are separate rows: the Plan row compares with the command the
 * Main row read (or the command's own first line when it runs alone).
 */

let world: S6AHostWorld | undefined;
let mainCommand = 'echo e3u-readonly';
afterAll(async () => { await world?.close(); }, 180_000);

const COMMAND = 'echo e3u-readonly';
const ANSWER = JSON.stringify({ schemaVersion: 1, body: 'E3U row ②: the round is done', ideas: [], goalCardDrafts: [] });
const GOAL = '?goal=' + S6A_GOAL_1.goalId;

/** The round's command step as the page drew it (its object is the command's first line). */
function commandStep(root: ReturnType<typeof thread>): string {
  const step = stepOfVerb(root!, '运行命令');
  expect(step, 'a 运行命令 step').toBeDefined();
  return stepObject(step!);
}

beforeAll(async () => {
  world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'run_readonly_command'] });
  await ensureProjectPointers(world);
  const a = await world.createSecretary('a');
  await world.scripted.script(a, [
    { kind: 'calls', calls: [{ callId: 'e3u-readonly-call', name: 'run_readonly_command', args: { command: COMMAND } }] },
    { kind: 'text', text: ANSWER },
  ]);
  const submitted = await world.submit({ commandId: 'e3u-readonly-submit', goalId: S6A_GOAL_1.goalId,
    text: 'E3U row ②: run one read-only command' });
  if (submitted.status !== 'queued') throw new Error(`E3U row ②: the request was not queued: ${JSON.stringify(submitted)}`);
  expect(await claimWithSecretaryProfile(world, submitted.round, a, 'e3u-readonly-claim')).toMatchObject({ status: 'committed' });
  const prepared = await prepareAttempt(world, submitted.round, 'e3u-readonly-prepare');
  expect(await start(world, prepared, 'e3u-readonly-start')).toMatchObject({ status: 'ready' });
  await world.waitForRequest(submitted.requestRoot, (view) => view.rounds[0]?.status === 'ended', 'E3U row ②: the round ended');
}, 180_000);

describe('E3U 1A row ② the secretary read-only command on Main and Plan', () => {
  it('the Main round block shows one 运行命令 step naming the command', async () => {
    await onMain(world!, async (page): Promise<void> => {
      const conversation = thread(page.root);
      expect(conversation, 'Main\'s conversation').toBeDefined();
      await waitFor(() => runRows(conversation!).length > 0);
      const mainRun = runRows(conversation!)[0]!;
      /* The round ran one command and read/edited nothing: the block is wired and says so. */
      expect(textOf(mainRun)).toContain('运行命令 1 次');
      await openRun(conversation!);
      await waitFor(() => stepVerbs(conversation!).includes('运行命令'));
      expect(stepVerbs(conversation!)).toContain('运行命令');
      mainCommand = commandStep(conversation);
      expect(mainCommand).toContain(COMMAND);
    }, { search: GOAL });
  }, 180_000);

  it('the Plan same round shows the same 运行命令 step', async () => {
    const plan = await bootE3N(world!, 'Plan', { search: GOAL });
    try {
      await quietPage(plan.log);
      const conversation = thread(plan.page.root);
      expect(conversation, 'Plan\'s conversation').toBeDefined();
      await waitFor(() => runRows(conversation!).length > 0);
      const planRun = runRows(conversation!)[0]!;
      expect(textOf(planRun)).toContain('运行命令 1 次');
      await openRun(conversation!);
      await waitFor(() => stepVerbs(conversation!).includes('运行命令'));
      expect(stepVerbs(conversation!)).toContain('运行命令');
      /* The same round's same step, not merely a drawn Plan page. */
      expect(commandStep(conversation)).toBe(mainCommand);
    } finally {
      await plan.page.restore();
    }
  }, 180_000);
});
