/**
 * Rework 1 item 3 (B2-11, L19a): the pure script-expansion helper.
 *
 * F-021: the `readFile` under test is the REAL production workspace reader over
 * files written into a real temp root; two pure input/output cases (an injected
 * failure and an absolute `cd`) stay constructed because the production reader
 * only accepts normalized relative paths. The digests come from `node:crypto`
 * over the literal `JSON.stringify(words)`; the product's own helpers are never
 * used to compute an expectation.
 *
 * The rows: two directories' same-named script each expand; each expansion
 * level is its own entry with its own `basis` (never folded); a 2,048-byte cut
 * of `scriptText` sets the record's `truncated`; a read failure keeps the
 * per-entry `basis: unavailable`; at most `maxFiles` distinct files are read.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseShellActionsDetailed } from '../../src/core/work-graph/state/command-normalization.js';
import { BLOCKED_COMMAND_MAX_FILE_BYTES, expandShellScripts } from '../../src/core/work-graph/tasks/command-expansion.js';
import { openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const keyOf = (words: string[]): string => sha(JSON.stringify(words));
const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

function actionsOf(command: string) {
  const parsed = parseShellActionsDetailed(command);
  if (parsed.status !== 'parsed') throw new Error(`expected parsed, got ${parsed.reason}`);
  return parsed.actions;
}

const workspaces: RealWorkspace[] = [];
afterEach(async () => { for (const workspace of workspaces.splice(0)) await workspace.close(); });

/**
 * F-021: the expansion's `readFile` is the REAL `WorkspaceToolsPort.readWorkspace`
 * over files written into a real temp directory. `reads` counts the real read
 * attempts through the production reader.
 */
async function reader(files: Record<string, string>) {
  const workspace = await openRealWorkspace({ files });
  workspaces.push(workspace);
  const reads: string[] = [];
  const readFile = async (path: string) => {
    reads.push(path);
    const read = await workspace.readWorkspace(workspace.ctx, {
      workspace: workspace.workspace, path, maxBytes: BLOCKED_COMMAND_MAX_FILE_BYTES,
      version: { kind: 'working_tree' },
    });
    return read.status === 'ready'
      ? { content: read.value.content, digest: read.value.digest }
      : { status: 'unavailable' as const, reason: read.reason };
  };
  return { readFile, reads };
}

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ scripts });

describe('rework 1 item 3 / B2-11 script expansion', () => {
  it('expands the same script name independently in two directories', async () => {
    const { readFile } = await reader({
      'app/package.json': pkg({ build: 'tsc -p app' }),
      'other/package.json': pkg({ build: 'tsc -p other' }),
    });
    const result = await expandShellScripts({
      actions: actionsOf('cd app && npm run build; cd ../other && npm run build'),
      cwd: '.', maxFiles: 4, readFile,
    });
    expect(result.expansions).toHaveLength(2);
    expect(result.expansions.map(entry => [entry.action, entry.scriptName, entry.basis])).toEqual([
      ['npm run build', 'build', { path: 'app/package.json', digest: expect.any(String) }],
      ['npm run build', 'build', { path: 'other/package.json', digest: expect.any(String) }],
    ]);
    expect(result.expansions[0]!.actions).toEqual([{ text: 'tsc -p app', sha256: keyOf(['tsc', '-p', 'app']) }]);
    expect(result.expansions[1]!.actions).toEqual([{ text: 'tsc -p other', sha256: keyOf(['tsc', '-p', 'other']) }]);
    expect(result.truncated).toBe(false);
  });

  it('makes each level its own entry with its own basis and never folds the inner level', async () => {
    const build = 'npm run lint && tsc';
    const { readFile } = await reader({ 'app/package.json': pkg({ build, lint: 'eslint .' }) });
    const result = await expandShellScripts({
      actions: actionsOf('cd app && npm run build'), cwd: '.', maxFiles: 4, readFile,
    });
    expect(result.expansions.map(entry => [entry.action, entry.scriptName])).toEqual([
      ['npm run build', 'build'],
      ['npm run lint', 'lint'],
    ]);
    const outer = result.expansions[0]!;
    const inner = result.expansions[1]!;
    // The outer entry carries ITS body's actions (including `npm run lint`)...
    expect(outer.actions).toEqual([
      { text: 'npm run lint', sha256: keyOf(['npm', 'run', 'lint']) },
      { text: 'tsc', sha256: keyOf(['tsc']) },
    ]);
    // ...and the inner entry carries only lint's body; it is never folded in.
    expect(inner.actions).toEqual([{ text: 'eslint .', sha256: keyOf(['eslint', '.']) }]);
    expect(outer.actions.some(action => action.sha256 === keyOf(['eslint', '.']))).toBe(false);
    expect(outer.basis).toMatchObject({ path: 'app/package.json' });
    expect(inner.basis).toMatchObject({ path: 'app/package.json' });
    expect(outer.scriptText).toBe(build);
    expect(inner.scriptText).toBe('eslint .');
  });

  it('cuts scriptText to 2,048 bytes and sets the record truncated flag; keys use the full text', async () => {
    const longWord = 'a'.repeat(3_000);
    const body = `tool ${longWord}`;
    const { readFile } = await reader({ 'package.json': pkg({ long: body }) });
    const result = await expandShellScripts({
      actions: actionsOf('npm run long'), cwd: '.', maxFiles: 4, readFile,
    });
    expect(result.truncated).toBe(true);
    expect(bytes(result.expansions[0]!.scriptText)).toBeLessThanOrEqual(2_048);
    // The comparison key comes from the untruncated body, not the cut display text.
    expect(result.expansions[0]!.actions).toEqual([{ text: `tool ${longWord}`, sha256: keyOf(['tool', longWord]) }]);
  });

  it('keeps a per-entry basis unavailable on a real read failure and never throws', async () => {
    // F-021: the failed read is the real production reader over a file that does
    // not exist in the real root.
    const { readFile } = await reader({});
    const result = await expandShellScripts({
      actions: actionsOf('cd app && npm run build'), cwd: '.', maxFiles: 4, readFile,
    });
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]).toMatchObject({
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable' },
    });
    expect(result.expansions[0]!.basis).toHaveProperty('reason');
    expect(result.truncated).toBe(false);
  });

  it('keeps the pure input/output failure shape for an injected read result', async () => {
    // The original hand-written failure reason, preserved as a pure input case.
    const result = await expandShellScripts({
      actions: actionsOf('cd app && npm run build'), cwd: '.', maxFiles: 4,
      readFile: async (path: string) => ({ status: 'unavailable' as const, reason: `no such file: ${path}` }),
    });
    expect(result.expansions).toEqual([{
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable', reason: 'no such file: app/package.json' },
    }]);
    expect(result.truncated).toBe(false);
  });

  it('reads at most maxFiles distinct package.json files and marks no expansion for the rest', async () => {
    const { readFile, reads } = await reader({
      'a/package.json': pkg({ build: 'a' }),
      'b/package.json': pkg({ build: 'b' }),
    });
    const result = await expandShellScripts({
      actions: actionsOf('cd a && npm run build; cd ../b && npm run build'),
      cwd: '.', maxFiles: 1, readFile,
    });
    expect(reads).toEqual(['a/package.json']);
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.basis).toMatchObject({ path: 'a/package.json' });
    expect(result.truncated).toBe(true);
  });

  it('does not expand a readable package.json without that script or a third level', async () => {
    const files = { 'package.json': pkg({ build: 'npm run lint', lint: 'npm run lint:deep', 'lint:deep': 'tool' }) };
    const { readFile } = await reader(files);
    const result = await expandShellScripts({
      actions: actionsOf('npm run build'), cwd: '.', maxFiles: 4, readFile,
    });
    // build + lint are levels 1/2; lint's body (`npm run lint:deep`) is entry lint's
    // own action and is NOT expanded a third time.
    expect(result.expansions.map(entry => entry.scriptName)).toEqual(['build', 'lint']);
    expect(result.expansions[1]!.actions).toEqual([{ text: 'npm run lint:deep', sha256: keyOf(['npm', 'run', 'lint:deep']) }]);
    expect(result.expansions.some(entry => entry.scriptName === 'lint:deep')).toBe(false);
  });

  it('does not expand bare pnpm/yarn or a non-static cwd', async () => {
    const { readFile } = await reader({ 'package.json': pkg({ build: 'tsc' }) });
    const bare = await expandShellScripts({
      actions: actionsOf('pnpm build'), cwd: '.', maxFiles: 4, readFile,
    });
    expect(bare.expansions).toEqual([]);
    const nonStatic = await expandShellScripts({
      actions: actionsOf('cd $DIR && npm run build'), cwd: '.', maxFiles: 4, readFile,
    });
    expect(nonStatic.expansions).toEqual([]);
  });
});
