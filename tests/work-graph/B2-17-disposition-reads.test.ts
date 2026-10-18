/**
 * B2-17 (spec §5.2, L19a): the ② workspace read budget.
 *
 * The counting wrapper sits on the injected `readWorkspace`; a blocked command
 * reads at most four DISTINCT `package.json` files (one per directory) and the
 * over-cap directory is never read. Each blocked command is one REAL Work Run
 * of the task whose `shell` call went through §5.1's stand-in, so the Kernel
 * command facts and the record are reachable facts.
 */
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { openK3BlockedCommandWorld, type K3BlockedCommandWorld } from '../helpers/K3-blocked-command-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3BlockedCommandWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const pkg = (script: string): string => JSON.stringify({ scripts: { [script]: `tool ${script}` } });

const appliedOf = async (blocked: K3BlockedCommandWorld, record: UnknownCallReviewV1) =>
  await blocked.answer(record, 'skip_as_done');

describe.each(['memory', 'sqlite'] as const)('B2-17 disposition workspace reads (%s)', kind => {
  it('reads one file per distinct directory, at most four, and skips the fifth', async () => {
    const files: Record<string, string> = {};
    for (const dir of ['a', 'b', 'c', 'd', 'e']) files[`/${dir}/package.json`] = pkg(dir);
    const blocked = await openK3BlockedCommandWorld(kind, {
      commands: { c1: { command:
        'cd /a && npm run a; cd /b && npm run b; cd /c && npm run c; cd /d && npm run d; cd /e && npm run e' } },
      files,
    });
    worlds.push(blocked);
    const applied = await appliedOf(blocked, blocked.record);
    expect(blocked.readPaths).toEqual([
      '/a/package.json', '/b/package.json', '/c/package.json', '/d/package.json',
    ]);
    expect(applied.blockedCommands[0]?.expansions).toHaveLength(4);
    expect(applied.blockedCommands[0]?.truncated).toBe(true);
  }, 120_000);

  it('reads a shared directory once for one blocked command', async () => {
    const blocked = await openK3BlockedCommandWorld(kind, {
      commands: { c1: { command: 'npm run a && npm run b' } },
      files: { 'package.json': JSON.stringify({ scripts: { a: 'tool a', b: 'tool b' } }) },
    });
    worlds.push(blocked);
    const applied = await appliedOf(blocked, blocked.record);
    expect(blocked.readPaths).toEqual(['package.json']);
    expect(applied.blockedCommands[0]?.expansions).toHaveLength(2);
  }, 120_000);
});
