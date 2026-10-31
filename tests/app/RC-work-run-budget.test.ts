/** RC work-run budget: the Host setting through the real routes and real Work Runs, read publicly. */
import { afterEach, describe, expect, it } from 'vitest'; import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path';
import { cleanupRestart, driveWorkflow, readExecution, tempDir } from '../helpers/A2-restart-fixture.js'; import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js'; import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js'; import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import type { HostSettingsSnapshot } from '../../src/app/host-settings-types.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); await cleanupRestart(); });
const OLD_SETTINGS = JSON.stringify({ schemaVersion: 1, models: [], selection: {}, workspaces: [] });

it('RC-1 a new Host runs its first Work Run at the 400000000 default and snapshots it', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' }); worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'rc-1', taskIds: ['rc-1-work'], role: S6A_WORK_ROLE.templateId })).tasks;
  const line = await createS6BLine(main, { label: 'rc-1-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const session = await sessionOf(world, line); await world.scripted.script(session, [{ kind: 'text', text: 'RC rc-1 work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-1', sessionHint: session.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const runRef = await main.taskRun(goal, tasks[0]!.taskId); expect(runRef).not.toBeNull();
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(400_000_000);
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-1 snapshot').workRunTokenBudget).toEqual({ saved: null, effective: 400_000_000, max: 600_000_000 });
}, 120_000);

it('RC-2 a save changes the next Run without a restart and leaves the earlier Run at 400000000', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' }); worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'rc-2', taskIds: ['rc-2-a', 'rc-2-b'], role: S6A_WORK_ROLE.templateId })).tasks;
  const firstLine = await createS6BLine(main, { label: 'rc-2-a-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const firstSession = await sessionOf(world, firstLine); await world.scripted.script(firstSession, [{ kind: 'text', text: 'RC rc-2-a work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-2-a', sessionHint: firstSession.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const first = await main.taskRun(goal, tasks[0]!.taskId); expect(first).not.toBeNull();
  expect((await readExecution(world.ag2b, first!)).run.budget.tokenBudget).toBe(400_000_000);
  expect(await world.settings('run-budget/save', { workRunTokenBudget: 600_000_000 })).toMatchObject({ status: 'ready' });
  const secondLine = await createS6BLine(main, { label: 'rc-2-b-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[1]!.taskId }] });
  const secondSession = await sessionOf(world, secondLine); await world.scripted.script(secondSession, [{ kind: 'text', text: 'RC rc-2-b work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-2-b', sessionHint: secondSession.ref, kind: 'select_work', taskId: tasks[1]!.taskId }, { stopBefore: 'open_checks' });
  const second = await main.taskRun(goal, tasks[1]!.taskId); expect(second).not.toBeNull();
  expect((await readExecution(world.ag2b, second!)).run.budget.tokenBudget).toBe(600_000_000);
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-2 snapshot').workRunTokenBudget).toEqual({ saved: 600_000_000, effective: 600_000_000, max: 600_000_000 });
  expect((await readExecution(world.ag2b, first!)).run.budget.tokenBudget).toBe(400_000_000);
}, 150_000);

it('RC-3 SQLite only: a saved 500000000 survives a Host reopen on the same database and settings directory', async () => {
  const settingsDirectory = await tempDir('rc-3-settings-');
  const world = await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { settings: { settingsDirectory } } }); worlds.push(world);
  expect(await world.settings('run-budget/save', { workRunTokenBudget: 500_000_000 })).toMatchObject({ status: 'ready' });
  await world.reopen();
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-3 snapshot').workRunTokenBudget).toEqual({ saved: 500_000_000, effective: 500_000_000, max: 600_000_000 });
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'rc-3', taskIds: ['rc-3-work'], role: S6A_WORK_ROLE.templateId })).tasks;
  const line = await createS6BLine(main, { label: 'rc-3-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const session = await sessionOf(world, line); await world.scripted.script(session, [{ kind: 'text', text: 'RC rc-3 work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-3', sessionHint: session.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const runRef = await main.taskRun(goal, tasks[0]!.taskId); expect(runRef).not.toBeNull();
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(500_000_000);
}, 150_000);

it('RC-4 saving null restores the 400000000 default for the snapshot and the next Run', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' }); worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'rc-4', taskIds: ['rc-4-work'], role: S6A_WORK_ROLE.templateId })).tasks;
  expect(await world.settings('run-budget/save', { workRunTokenBudget: 600_000_000 })).toMatchObject({ status: 'ready' });
  expect(await world.settings('run-budget/save', { workRunTokenBudget: null })).toMatchObject({ status: 'ready' });
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-4 snapshot').workRunTokenBudget).toEqual({ saved: null, effective: 400_000_000, max: 600_000_000 });
  const line = await createS6BLine(main, { label: 'rc-4-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const session = await sessionOf(world, line); await world.scripted.script(session, [{ kind: 'text', text: 'RC rc-4 work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-4', sessionHint: session.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const runRef = await main.taskRun(goal, tasks[0]!.taskId); expect(runRef).not.toBeNull();
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(400_000_000);
}, 120_000);

describe('rejects: a Work Run token budget outside 1…600000000 or not an integer', () => {
  it.each([600_000_001, 0, 1.5, '600000000'])('rejects %j with an invalid range reason and changes neither the file nor the effective value', async (value) => {
    const settingsDirectory = await tempDir('rc-5-settings-');
    const file = join(settingsDirectory, 'host-settings.json'); await writeFile(file, OLD_SETTINGS);
    const beforeBytes = await readFile(file, 'utf8');
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } }); worlds.push(world);
    const rejected = await world.settings('run-budget/save', { workRunTokenBudget: value as unknown as number });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
    const reason = rejected.status === 'rejected' ? rejected.reason : '';
    expect(reason).toMatch(/\b1\b/); expect(reason).toContain('600000000'); expect(reason).toMatch(/integer/i);
    expect(await readFile(file, 'utf8')).toBe(beforeBytes);
    expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-5 snapshot').workRunTokenBudget).toEqual({ saved: null, effective: 400_000_000, max: 600_000_000 });
  }, 120_000);
});

it('RC-6 a private settings file with workRunTokenBudget 600000001 refuses startup', async () => {
  const settingsDirectory = await tempDir('rc-6-settings-');
  await writeFile(join(settingsDirectory, 'host-settings.json'), JSON.stringify({ schemaVersion: 1, models: [], selection: {}, workspaces: [], workRunTokenBudget: 600_000_001 }));
  await expect(openS6AHostWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } })).rejects.toThrow('the private host settings file could not be loaded');
}, 120_000);

it('RC-7 an old private settings file without the field starts at the default and runs at 400000000', async () => {
  const settingsDirectory = await tempDir('rc-7-settings-');
  await writeFile(join(settingsDirectory, 'host-settings.json'), OLD_SETTINGS);
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } }); worlds.push(world);
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the RC-7 snapshot').workRunTokenBudget).toEqual({ saved: null, effective: 400_000_000, max: 600_000_000 });
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'rc-7', taskIds: ['rc-7-work'], role: S6A_WORK_ROLE.templateId })).tasks;
  const line = await createS6BLine(main, { label: 'rc-7-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const session = await sessionOf(world, line); await world.scripted.script(session, [{ kind: 'text', text: 'RC rc-7 work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'rc-rc-7', sessionHint: session.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const runRef = await main.taskRun(goal, tasks[0]!.taskId); expect(runRef).not.toBeNull();
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(400_000_000);
}, 120_000);
