/**
 * PL-46 (spec §5.3.4, §6.4.3): the taskbook markdown, its relative path, real
 * writes under an external settings root and the real-path workspace isolation.
 *
 * Every expectation is a literal from the spec or a hand-built example: the
 * exact path, the rendered pieces and the file's own bytes on disk. Nothing is
 * read back from a production constant.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import {
  renderTaskbookMarkdown, taskbookRelativePath,
} from '../../src/core/work-graph/views/taskbook-markdown.js';
import {
  exportBooks, exportTaskbook, exportTaskbooksForPlan,
} from '../../src/app/taskbook-export.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';

const SCOPE = { projectId: 'p', workspaceId: 'w', goalId: 'g' };

const INSTRUCTION = 'Read the parser input.\n'
  + 'Tokenize it, then build the tree.\n'
  + '\n'
  + 'Keep the error text unchanged.';

afterEach(cleanupRestart);

/**
 * Two stages, three tasks: `t1` declares its stage on the task, `t3` only on
 * its module scope, `t2` belongs to the other stage. One dependency and one
 * obligation shared by `t1` and `t3`.
 */
function twoStagePlan(planId = 'plan-one'): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId,
    planRevision: 1,
    goalId: 'g',
    stages: [
      { stageId: 'build', title: 'Build stage', description: 'Build the thing.' },
      { stageId: 'ship', title: 'Ship stage', description: 'Ship the thing.' },
    ],
    tasks: [
      {
        taskId: 't1',
        stageId: 'build',
        title: 'Implement parser',
        requirementLevel: 'required',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'stage', stageId: 'build' },
        estimatedLines: 12,
      },
      {
        taskId: 't2',
        stageId: 'ship',
        title: 'Publish release',
        requirementLevel: 'required',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'stage', stageId: 'ship' },
        estimatedLines: 5,
      },
      {
        taskId: 't3',
        title: 'Wire parser module',
        requirementLevel: 'optional',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'module', stageId: 'build', moduleRef: 'mod-a' },
      },
    ],
    assignments: [
      { taskId: 't1', role: 'executor', instruction: INSTRUCTION },
      { taskId: 't3', role: 'executor', instruction: 'Wire the module.' },
    ],
    obligations: [{
      obligationId: 'o1',
      title: 'Parser accepts input',
      requirementLevel: 'required',
      taskIds: ['t1', 't3'],
      verificationRequirements: [{
        requirementId: 'r1',
        requirementLevel: 'required',
        kind: 'check',
        description: 'the integration check passes',
      }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: {
      dependsOn: [{ taskId: 't3', dependsOnId: 't1', requires: { kind: 'artifact', label: 'parser API' } }],
    },
  };
}

describe('PL-46 a: taskbook markdown', () => {
  it('renders the stage and its own tasks with the whole instruction', () => {
    const markdown = renderTaskbookMarkdown(twoStagePlan(), 'build');

    expect(markdown).not.toBeNull();
    const text = markdown ?? '';
    expect(text).toContain('# Build stage');
    expect(text).toContain('Build the thing.');
    expect(text).toContain('- Stage: build');
    expect(text).toContain('- Plan: plan-one');
    expect(text).toContain('- Plan revision: 1');
    expect(text).toContain('## Implement parser');
    expect(text).toContain('- Task: t1');
    expect(text).toContain('- Scope: stage:build');
    expect(text).toContain('- Estimated lines: 12');
    expect(text).toContain('## Wire parser module');
    expect(text).toContain('- Task: t3');
    expect(text).toContain('- Scope: module:build/mod-a');
    expect(text).toContain('- Estimated lines: 未预估');
    expect(text).toContain('- t1 (parser API)');
    expect(text).toContain('Parser accepts input');
    expect(text).toContain('the integration check passes');
    expect(text).toContain(INSTRUCTION);
  });

  it('excludes the other stage and returns null for a stage that is not there', () => {
    const text = renderTaskbookMarkdown(twoStagePlan(), 'build') ?? '';

    expect(text).not.toContain('Publish release');
    expect(text).not.toContain('Ship stage');
    expect(renderTaskbookMarkdown(twoStagePlan(), 'nowhere')).toBeNull();
  });
});

describe('PL-46 b: taskbook relative path', () => {
  it('uses the exact documented path and one encoded segment per id', () => {
    expect(taskbookRelativePath({
      projectId: 'p 1',
      workspaceId: 'w/2',
      goalId: 'g:3',
      stageId: 's 4',
      planId: 'plan/5',
      planRevision: 7,
    })).toBe('p%201/w%2F2/g%3A3/goal-g%3A3__plan-plan%2F5__stage-s%204__rev-7.md');
  });
});

describe('PL-46 c: real writes', () => {
  it('writes one stage, overwrites its own file and writes one file per stage', async () => {
    const settings = await realpath(await tempDir('pl46-settings-'));
    const taskbookRoot = join(settings, 'taskbooks');
    const plan = twoStagePlan();
    const expectedPath = join(taskbookRoot, 'p/w/g/goal-g__plan-plan-one__stage-build__rev-1.md');

    const first = await exportTaskbook({ root: taskbookRoot, plan, stageId: 'build', scope: SCOPE });
    expect(first.status).toBe('written');
    if (first.status !== 'written') throw new Error('the first export was not written');
    expect(first.path).toBe(expectedPath);
    const firstText = await readFile(first.path, 'utf8');
    expect(firstText).toContain('# Build stage');
    expect(firstText).toContain('- Stage: build');
    expect(firstText).toContain('- Plan: plan-one');
    expect(firstText).toContain('- Plan revision: 1');
    expect(firstText).toContain('## Implement parser');
    expect(firstText).toContain('- Task: t1');
    expect(firstText).toContain(INSTRUCTION);

    await writeFile(first.path, 'half-written', 'utf8');
    const again = await exportTaskbook({ root: taskbookRoot, plan, stageId: 'build', scope: SCOPE });
    expect(again.status).toBe('written');
    if (again.status === 'written') expect(again.path).toBe(expectedPath);
    const rewritten = await readFile(expectedPath, 'utf8');
    expect(rewritten).not.toBe('half-written');
    expect(rewritten).toContain('# Build stage');
    expect(rewritten).toContain(INSTRUCTION);
    expect((await readdir(join(taskbookRoot, 'p/w/g'))).filter((name) => name.endsWith('.md')))
      .toEqual(['goal-g__plan-plan-one__stage-build__rev-1.md']);

    const everyStage = await exportTaskbooksForPlan({
      root: settings, workspaceRoots: [], plan, scope: SCOPE,
    });
    expect(everyStage.map((result) => result.status)).toEqual(['written', 'written']);
    expect((await readdir(join(settings, 'taskbooks', 'p/w/g')))
      .filter((name) => name.endsWith('.md')).sort())
      .toEqual([
        'goal-g__plan-plan-one__stage-build__rev-1.md',
        'goal-g__plan-plan-one__stage-ship__rev-1.md',
      ]);
    const stageIds = ['build', 'ship'] as const;
    for (const [index, result] of everyStage.entries()) {
      expect(result.status).toBe('written');
      if (result.status !== 'written') continue;
      const stageId = stageIds[index]!;
      const text = await readFile(result.path, 'utf8');
      expect(text).toContain(`- Stage: ${stageId}`);
      expect(text).toContain('- Plan revision: 1');
      if (stageId === 'build') {
        expect(text).toContain('## Implement parser');
        expect(text).toContain(INSTRUCTION);
        expect(text).not.toContain('## Publish release');
      } else {
        expect(text).toContain('## Publish release');
        expect(text).not.toContain('## Implement parser');
      }
    }
  });
});

describe('PL-46 d: export-root isolation', () => {
  it('writes nothing when the settings directory is the workspace and probes missing', async () => {
    const workspace = await realpath(await tempDir('pl46-workspace-'));
    const plan = twoStagePlan();

    const results = await exportTaskbooksForPlan({
      root: workspace, workspaceRoots: [workspace], plan, scope: SCOPE,
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.reason).toBe(`the taskbook root is inside the workspace ${workspace}`);
      }
    }
    expect(await readdir(workspace)).toEqual([]);
    await expect(stat(join(workspace, 'taskbooks')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const probe = await exportBooks({ root: workspace, plan, scope: SCOPE });
    expect(probe.status).toBe('ready');
    if (probe.status === 'ready') {
      expect(probe.stages.map((stage) => stage.state)).toEqual(['missing', 'missing']);
    }
  });
});

describe('PL-46 e: one plan id per file', () => {
  it('does not overwrite another plan id at the same stage and revision', async () => {
    const settings = await realpath(await tempDir('pl46-two-plans-'));
    const taskbookRoot = join(settings, 'taskbooks');

    const first = await exportTaskbook({
      root: taskbookRoot, plan: twoStagePlan('plan-a'), stageId: 'build', scope: SCOPE,
    });
    const second = await exportTaskbook({
      root: taskbookRoot, plan: twoStagePlan('plan-b'), stageId: 'build', scope: SCOPE,
    });
    expect(first.status).toBe('written');
    expect(second.status).toBe('written');
    if (first.status !== 'written' || second.status !== 'written') return;
    expect(first.path).not.toBe(second.path);
    expect(await readFile(first.path, 'utf8')).not.toBe(await readFile(second.path, 'utf8'));
    expect((await readdir(join(taskbookRoot, 'p/w/g'))).filter((name) => name.endsWith('.md')))
      .toHaveLength(2);
  });
});
