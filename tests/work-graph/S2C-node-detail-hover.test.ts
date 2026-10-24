/**
 * 2C-30 (LE6): `graph/hover` reads the whole node set of one Goal.
 *
 * Real services build the catalog (M with the declared child M-sub, and N), the
 * Plan, the Sessions and their links and the claimed Runs; the executed-files
 * port is injected "有" (2C-30's hand-written list). `owners` is compared
 * against the same moment's `lines/list`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionDutyReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import { failingIndexRead, nodeReaderOf, openNodeFixture, scriptedExecutedFiles, type NodeFixture } from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };
const stageNode = (fixture: NodeFixture) => ({ kind: 'stage' as const, planRef: fixture.planRef, stageId: 'stage-1' });

describe.each(['memory', 'sqlite'] as const)('2C-30 graph hover (%s)', (kind) => {
  it('2C-30 never-ran terminal, owners vs lines/list, group/module counts and the file mapping', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const l1 = await fixture.createSession('l1');
    const l2 = await fixture.createSession('l2');
    await fixture.link(l1, fixture.tasks['task-a']!, 'responsible', true);
    await fixture.link(l2, fixture.tasks['task-d']!, 'responsible', true);
    const r1 = await fixture.claim('task-a', l1);
    const r2 = await fixture.claim('task-d', l2);

    const files = { availability: 'available' as const, possiblyIncomplete: false, sourceCursor: null,
      files: [
        { runRef: r1.runRef, path: 'm/a.ts', certainty: 'definite' as const },
        { runRef: r1.runRef, path: 'm/b.ts', certainty: 'possible' as const },
        { runRef: r2.runRef, path: 'm/b.ts', certainty: 'definite' as const },
        { runRef: r2.runRef, path: 'm/c.ts', certainty: 'possible' as const },
      ] };
    const { reader, line } = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles(files) });

    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));

    // never-ran cancelled/superseded carry their label; running tasks do not.
    const byId = new Map(hover.value.tasks.map((task) => [task.task.taskId, task]));
    expect(byId.get('task-cancel')?.display.neverRanTerminal).toBe('cancelled');
    expect(byId.get('task-super')?.display.neverRanTerminal).toBe('superseded');
    expect(byId.get('task-a')?.display.neverRanTerminal).toBeNull();

    // owners equal the same moment's lines/list for key/duty/name/status.
    const list = await line.listWorkLines(fixture.ctx, { workspace: fixture.scope });
    expect(list.status).toBe('ready');
    if (list.status !== 'ready') throw new Error(JSON.stringify(list));
    const ownerA = byId.get('task-a')!.owners;
    expect(ownerA).toHaveLength(1);
    const rowA = list.value.rows.find((row) => row.key.sessionId === l1.sessionId);
    expect(rowA).toBeDefined();
    expect({ key: ownerA[0]!.key, duty: ownerA[0]!.duty, name: ownerA[0]!.name, status: ownerA[0]!.status })
      .toEqual({ key: rowA!.key, duty: rowA!.duty, name: rowA!.name, status: rowA!.status });

    // group counts: the goal has 5 live tasks (A, B, C, D, sub) and 2 never-ran.
    const goalGroup = hover.value.groups.find((group) => group.node.kind === 'goal')!;
    expect(goalGroup.tasks).toEqual({ status: 'exact', value: 6 });
    expect(goalGroup.neverRanTerminal).toEqual({ status: 'exact', value: 2 });
    expect(goalGroup.workingLines).toEqual({ status: 'exact', value: 2 });

    // modules: M contains the declared child M-sub; N is separate.
    const moduleM = hover.value.modules.find((module) => module.module.moduleId === 'M')!;
    const moduleSub = hover.value.modules.find((module) => module.module.moduleId === 'M-sub')!;
    const moduleN = hover.value.modules.find((module) => module.module.moduleId === 'N')!;
    expect(moduleM.unfinishedTasks).toEqual({ status: 'exact', value: 4 });
    expect(moduleSub.unfinishedTasks).toEqual({ status: 'exact', value: 1 });
    expect(moduleN.unfinishedTasks).toEqual({ status: 'exact', value: 1 });
    expect(moduleM.maintainer).toEqual({ status: 'none' });

    // files: dedup by path, definite if any Run is definite, UTF-8 byte order.
    expect(moduleM.files).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: [
        { path: 'm/a.ts', certainty: 'definite', runs: [r1.runRef] },
        { path: 'm/b.ts', certainty: 'definite', runs: [r1.runRef, r2.runRef] },
        { path: 'm/c.ts', certainty: 'possible', runs: [r2.runRef] },
      ] });
    expect(moduleM.changedByLines).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: { status: 'exact', value: 2 } });

    // GraphHoverReadV1.files: by path, the Tasks that changed it.
    expect(hover.value.files).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: [
        { path: 'm/a.ts', tasks: [fixture.tasks['task-a']!] },
        { path: 'm/b.ts', tasks: [fixture.tasks['task-a']!, fixture.tasks['task-d']!] },
        { path: 'm/c.ts', tasks: [fixture.tasks['task-d']!] },
      ] });

    // possiblyIncomplete: the file list stays, the changed-line count is partial.
    const partial = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles({ ...files, possiblyIncomplete: true }) });
    const second = await partial.reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') throw new Error(JSON.stringify(second));
    const moduleMPartial = second.value.modules.find((module) => module.module.moduleId === 'M')!;
    expect(moduleMPartial.files).toMatchObject({ availability: 'available', possiblyIncomplete: true, value: [
      { path: 'm/a.ts' }, { path: 'm/b.ts' }, { path: 'm/c.ts' },
    ] });
    expect(moduleMPartial.changedByLines).toEqual({ availability: 'available', possiblyIncomplete: true, sourceCursor: null,
      value: { status: 'partial', atLeast: 2, reason: '执行改过的文件可能不全' } });
  });

  it('2C-30 changedByLines maps the writing Runs claiming Sessions, not the current task owners', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const writer = await fixture.createSession('writer');
    // No responsible link at all: only the claim ties the writer to task-a. The
    // current task owners would give zero file-changing lines.
    const written = await fixture.claim('task-a', writer);
    const { reader } = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles({
      availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      files: [{ runRef: written.runRef, path: 'm/a.ts', certainty: 'definite' }] }) });
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));
    const moduleM = hover.value.modules.find((module) => module.module.moduleId === 'M')!;
    expect(moduleM.changedByLines).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: { status: 'exact', value: 1 } });
  });

  it('2C-30 the goal owners are the secretary lines whose latest Query is this Goal (L20)', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const steward = { kind: 'legacy_template' as const, templateId: 'steward', templateRevision: '1' };
    const forGoal = await fixture.createSession('sec-goal', steward);
    const noQuery = await fixture.createSession('sec-none', steward);
    await fixture.claimQuery(forGoal, fixture.goalRef, 'for-goal');
    const { reader } = nodeReaderOf(fixture, { dutyByRole: { steward: 'secretary' } });
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));
    const goalGroup = hover.value.groups.find((group) => group.node.kind === 'goal')!;
    // Not every workspace secretary: only the one whose latest Query targets this Goal.
    expect(goalGroup.owners.map((owner) => owner.key.sessionId)).toEqual([forGoal.sessionId]);
    expect(goalGroup.owners[0]!.name.source).toBe('secretary_ordinal');
    expect(noQuery.sessionId).not.toBe(forGoal.sessionId);
  });

  it('2C-30 the participants section is populated for goal, stage and module nodes', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const owner = await fixture.createSession('owner');
    const helper = await fixture.createSession('helper');
    await fixture.link(owner, fixture.tasks['task-a']!, 'responsible', true);
    await fixture.link(helper, fixture.tasks['task-a']!, 'participates', true);
    await fixture.claim('task-a', owner);
    const { reader } = nodeReaderOf(fixture);

    const goal = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef,
      node: { kind: 'goal', ref: fixture.goalRef }, section: 'participants', page });
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready' || goal.value.section !== 'participants') throw new Error(JSON.stringify(goal));
    expect(goal.value.items.map((item) => item.key.sessionId).sort()).toEqual([helper.sessionId, owner.sessionId].sort());
    expect(goal.value.items.map((item) => item.via).sort()).toEqual(['participates', 'responsible']);

    const stage = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef,
      node: stageNode(fixture), section: 'participants', page });
    expect(stage.status).toBe('ready');
    if (stage.status !== 'ready' || stage.value.section !== 'participants') throw new Error(JSON.stringify(stage));
    expect(stage.value.items.map((item) => item.key.sessionId).sort()).toEqual([helper.sessionId, owner.sessionId].sort());

    const module = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef,
      node: { kind: 'module', ref: fixture.moduleRef('M') }, section: 'participants', page });
    expect(module.status).toBe('ready');
    if (module.status !== 'ready' || module.value.section !== 'participants') throw new Error(JSON.stringify(module));
    expect(module.value.items.map((item) => item.key.sessionId)).toEqual([owner.sessionId]);
    expect(module.value.items[0]!.via).toBe('responsible');
  });

  it('2C-30 a failed canonical task-facts read is propagated, not an empty Run set', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const records = failingIndexRead(fixture.records, 'r3c-run-by-goal', 'injected task-facts failure');
    const { reader } = nodeReaderOf({ ...fixture, records });
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('rejected');
    if (hover.status !== 'rejected') throw new Error(JSON.stringify(hover));
    expect(hover.reason).toContain('injected task-facts failure');
  });

  it('2C-30 duty resolution and the shared line assembly happen once per read', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const sessions = await Promise.all(['d1', 'd2', 'd3'].map((id) => fixture.createSession(id)));
    const taskIds = ['task-a', 'task-b', 'task-d'];
    for (let index = 0; index < sessions.length; index += 1) {
      await fixture.link(sessions[index]!, fixture.tasks[taskIds[index]!]!, 'responsible', true);
      await fixture.claim(taskIds[index]!, sessions[index]!);
    }
    let dutyCalls = 0;
    const dutyFor: SessionDutyReadPort = async () => {
      dutyCalls += 1;
      return { status: 'ready', value: 'executor' };
    };
    const { reader } = nodeReaderOf(fixture, { dutyFor });
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));
    // All three Sessions share one role: one duty resolution for the whole read.
    expect(dutyCalls).toBe(1);
  });
});
