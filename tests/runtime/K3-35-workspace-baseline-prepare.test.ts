/**
 * K3-35 (四) (L5, L13, L20): a workspace whose working tree differs from HEAD in
 * more than 2,000 files still prepares; its recorded start baseline is
 * `unavailable/too_many_changes`.
 *
 * The Run is a real public claim on the registered workspace, prepared through
 * the production Runtime (the real Run/Role readers and context assembler) over
 * that workspace made genuinely dirty; the manifest is read back through the
 * public prepared-manifest reader. No record is hand-written.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPreparedManifest, WORKSPACE_BASELINE_CONTENT_TYPE } from '../../src/core/agent-runtime/execution-preparation.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { K3_35_TASK_ID, openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { PLAN_B2 } from '../helpers/S5-decision-fixture.js';

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** A registered work tree whose working tree differs from HEAD in >2000 paths. */
async function dirtyRegisteredWorkspace(root: string): Promise<void> {
  for (let index = 0; index < 2001; index += 1) {
    await writeFile(join(root, `untracked-${String(index).padStart(4, '0')}.txt`), 'x\n');
  }
}

describe('K3-35 (四) workspace baseline capacity', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline for a >2000-change workspace', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const harness = await openRealRunHarness(world, { gitWorkspace: true });
    await dirtyRegisteredWorkspace(world.fixture.base.directory);
    const session = await world.fixture.createS5Session(`k3-35-baseline-session-${kind}`);
    const claim = await harness.claimRun({ requestId: `k3-35-baseline-claim-${kind}`, planRef: PLAN_B2,
      taskId: K3_35_TASK_ID, sessionRef: session });
    const { prepared, started } = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'text', text: 'K3-35 baseline' }]),
      tools: [], writeScope: ['.'], blockOnShell: false, prepareViaRuntime: true });
    try {
      const loaded = await loadPreparedManifest(world.fixture.bodies, prepared);
      if (loaded.status !== 'ready') throw new Error(`manifest: ${loaded.status}`);
      expect(loaded.value.manifest.workspaceBaseline).toEqual({
        status: 'unavailable', reason: 'too_many_changes', detail: expect.any(String),
      });
      expect(WORKSPACE_BASELINE_CONTENT_TYPE).toBe('application/vnd.platform.workspace-baseline+json');
    } finally {
      await started;
    }
  });
});
