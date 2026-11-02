/**
 * PL-47 (spec §5.3.4, §6.4.3, G-08): a real file-system failure and the probe's
 * four states. The failure is a real regular file where the export root should
 * be, and the probe reads the real file's bytes; nothing is mocked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdir, readFile, realpath, stat, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import {
  exportBooks, exportTaskbooksForPlan,
} from '../../src/app/taskbook-export.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';

const SCOPE = { projectId: 'p', workspaceId: 'w', goalId: 'g' };

afterEach(cleanupRestart);

function oneStagePlan(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: 'plan1',
    planRevision: 1,
    goalId: 'g',
    stages: [{ stageId: 's1', title: 'Stage one', description: 'One stage.' }],
    tasks: [{
      taskId: 't1',
      stageId: 's1',
      title: 'Do the work',
      requirementLevel: 'required',
      taskKind: 'work',
      disposition: 'active',
      phase: 'pending',
      scope: { kind: 'stage', stageId: 's1' },
      estimatedLines: 3,
    }],
    assignments: [{ taskId: 't1', role: 'executor', instruction: 'Do it carefully.' }],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

/** Hand-built from §5.3.4's file name, with the ids this file uses. */
function expectedPath(settingsDirectory: string): string {
  return join(
    settingsDirectory,
    'taskbooks',
    'p/w/g/goal-g__plan-plan1__stage-s1__rev-1.md',
  );
}

describe('PL-47 a: a real file where the taskbook directory should be', () => {
  it('fails every stage and the probe reports missing, not not_configured', async () => {
    const settings = await realpath(await tempDir('pl47-settings-'));
    const workspace = await realpath(await tempDir('pl47-workspace-'));
    await writeFile(join(settings, 'taskbooks'), 'not a directory', 'utf8');
    const plan = oneStagePlan();

    const results = await exportTaskbooksForPlan({
      root: settings, workspaceRoots: [workspace], plan, scope: SCOPE,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('failed');
    if (results[0]?.status === 'failed') expect(results[0].reason).not.toBe('');
    expect(await readFile(join(settings, 'taskbooks'), 'utf8')).toBe('not a directory');

    const probe = await exportBooks({ root: settings, plan, scope: SCOPE });
    expect(probe).toEqual({
      status: 'ready',
      stages: [{ state: 'missing', stageId: 's1', path: expectedPath(settings) }],
    });
  });
});

describe('PL-47 b: probe states', () => {
  it('is missing when the path metadata is readable but the file bytes are not', async () => {
    const settings = await realpath(await tempDir('pl47-unreadable-'));
    const plan = oneStagePlan();
    const path = expectedPath(settings);
    // A directory stats as a much larger object; only an actual read is refused.
    await mkdir(path, { recursive: true });

    expect(await exportBooks({ root: settings, plan, scope: SCOPE })).toEqual({
      status: 'ready',
      stages: [{ state: 'missing', stageId: 's1', path }],
    });
  });

  it('is not_configured without a settings directory', async () => {
    expect(await exportBooks({ root: null, plan: oneStagePlan(), scope: SCOPE }))
      .toEqual({ status: 'not_configured' });
  });

  it('is missing, incomplete and written from the real file', async () => {
    const settings = await realpath(await tempDir('pl47-probe-'));
    const plan = oneStagePlan();
    const path = expectedPath(settings);

    expect(await exportBooks({ root: settings, plan, scope: SCOPE })).toEqual({
      status: 'ready',
      stages: [{ state: 'missing', stageId: 's1', path }],
    });

    const exported = await exportTaskbooksForPlan({
      root: settings, workspaceRoots: [], plan, scope: SCOPE,
    });
    expect(exported[0]?.status).toBe('written');

    const realBytes = (await stat(path)).size;
    expect(realBytes).toBeGreaterThan(0);
    expect(await exportBooks({ root: settings, plan, scope: SCOPE })).toEqual({
      status: 'ready',
      stages: [{ state: 'written', stageId: 's1', path, bytes: realBytes }],
    });

    await writeFile(path, 'x', 'utf8');
    const short = await exportBooks({ root: settings, plan, scope: SCOPE });
    expect(short.status).toBe('ready');
    if (short.status !== 'ready') return;
    const stage = short.stages[0];
    expect(stage?.state).toBe('incomplete');
    if (stage?.state === 'incomplete') {
      expect(stage.actualBytes).toBe(1);
      expect(stage.expectedBytes).toBeGreaterThan(1);
    }
  });
});
