/**
 * K3 group 2 part 3 self-tests for the shared test seams (spec §5.1 "夹具的接缝",
 * lines 1394-1401) and the WP1 fixture registration fix (lead ruling 1).
 *
 * 1. Stand-in `shell` (K3 §5.1 "替身 shell"). This file owns the `vi.hoisted`
 *    state and the `vi.mock` of
 *    `vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js` — the exact
 *    module `composition-root.js:67` and `resume-composition.js:66` import. The
 *    mock returns `shellSeam.definition(actualCreateShellToolDefinition, sandbox)`:
 *    armed → the stand-in (`name: 'shell'`, `effectClass: 'process'`, no
 *    `isolated_process`, handler blocks until `release()`), disarmed → the real
 *    definition. A later K3 test copies this `vi.hoisted` + `vi.mock` pair and
 *    arms `shellSeam` around a `HostScenario`/`openWorkRoot` Run.
 *
 * 2. `HostScenario.open({ gitWorkspace: ... })` (K3 §5.1 "git 工作区"):
 *    `initGitWorkspace` runs in the scenario's own temporary root before the
 *    first Host starts. `HostScenario.gitWorkspace` exposes the initial commit.
 *
 * 3. Long commands/ids (K3-48): no new helper. Part 2 already covers them:
 *    `tests/work-graph/K3-48-unknown-call-review-creation-budget.test.ts:19-29`
 *    builds a 512-byte callId/command/8-path item and the 513-byte callId is
 *    `tests/runtime/A2-reconcile-runtime.test.ts:920`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { gitIn } from './support/git-workspace.js';
import { cleanupScenarios, HostScenario } from './harness.js';

// --- The self-test owns the hoisted state and the module mock. -------------
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandbox: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandbox),
  };
});
seams.shellSeam = shellSeam;

afterEach(async () => {
  shellSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

// --- 1. The stand-in shell ------------------------------------------------
describe('K3 §5.1 stand-in shell', () => {
  it('keeps the shell identity while armed, blocks the handler, then delegates to the real definition', async () => {
    const sandbox = {} as never;
    const { createShellToolDefinition } = await import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js');

    shellSeam.arm();
    const armed = createShellToolDefinition(sandbox);
    expect(armed.name).toBe('shell');
    expect(armed.effectClass).toBe('process');
    expect(armed.requiredCapabilities).not.toContain('isolated_process');
    expect(armed.defaultTimeoutMs).toBe(60_000);

    let settled = false;
    const pending = armed.handler.execute({
      schemaVersion: 1, callId: 'k3-r1-shell', name: 'shell', arguments: { command: 'true' },
    } as never, { signal: new AbortController().signal } as never).then(() => { settled = true; });
    await shellSeam.waitForCall();
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
    expect(settled, 'the armed handler must block until release()').toBe(false);
    expect(shellSeam.calls.map(call => call.callId)).toEqual(['k3-r1-shell']);

    shellSeam.release();
    await pending;
    expect(settled).toBe(true);
    expect(shellSeam.enabled).toBe(false);

    const real = createShellToolDefinition(sandbox);
    expect(real.requiredCapabilities).toContain('isolated_process');
    expect(real.defaultTimeoutMs).toBe(30_000);
    expect(real.outputLimitBytes).toBe(128 * 1024);
  });
});

// --- 2. The git workspace option ------------------------------------------
describe('K3 §5.1 git workspace option', () => {
  it('commits the tracked baseline and hides the Host-denied file from git', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, workIds: null });
    expect(h.gitWorkspace).not.toBeNull();
    const info = h.gitWorkspace;
    if (info === null) throw new Error('gitWorkspace must be set');

    expect(gitIn(h.root, 'rev-parse', 'HEAD').trim()).toBe(info.commit);
    expect((gitIn(h.root, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
    expect(gitIn(h.root, 'status', '--porcelain').trim()).toBe('');
    const tracked = gitIn(h.root, 'ls-files').trim().split('\n');
    expect(tracked).toEqual(expect.arrayContaining(['src/module.ts', 'README.md']));
    expect(tracked).not.toContain('.evaluator/hidden.ts');
    expect(existsSync(join(h.root, '.evaluator', 'hidden.ts'))).toBe(true);
    expect(existsSync(join(h.root, '.git'))).toBe(true);
  });
});
