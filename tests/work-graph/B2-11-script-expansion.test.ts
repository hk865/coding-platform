/**
 * B2-11 (spec §5.2, L19a "脚本展开"): the one pure expansion helper.
 *
 * The original command is parsed by the production detailed parser; the
 * `package.json` bodies are REAL files read through the production workspace
 * reader (F-021). The absolute-`cd` and injected-failure shapes stay pure
 * input/output cases (the production reader rejects absolute paths). Comparison
 * keys are computed here with `node:crypto`, never with the product's own
 * helpers.
 */
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseShellActionsDetailed } from '../../src/core/work-graph/state/command-normalization.js';
import { BLOCKED_COMMAND_MAX_FILE_BYTES, expandShellScripts } from '../../src/core/work-graph/tasks/command-expansion.js';
import { openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const keyOf = (words: string[]): string => sha(JSON.stringify(words));
const digestOf = (content: string): string => sha(content);

type Files = Record<string, string>;

const workspaces: RealWorkspace[] = [];
afterEach(async () => { for (const workspace of workspaces.splice(0)) await workspace.close(); });

/** F-021: the real `WorkspaceToolsPort.readWorkspace` over the test's real files. */
async function expandOn(workspace: RealWorkspace, command: string, cwd = '.', maxFiles = 4) {
  const parsed = parseShellActionsDetailed(command);
  if (parsed.status !== 'parsed') throw new Error(`expected parsed: ${parsed.reason}`);
  const reads: string[] = [];
  const result = await expandShellScripts({
    actions: parsed.actions, cwd, maxFiles,
    readFile: async path => {
      reads.push(path);
      const read = await workspace.readWorkspace(workspace.ctx, {
        workspace: workspace.workspace, path, maxBytes: BLOCKED_COMMAND_MAX_FILE_BYTES,
        version: { kind: 'working_tree' },
      });
      return read.status === 'ready'
        ? { content: read.value.content, digest: read.value.digest }
        : { status: 'unavailable' as const, reason: read.reason };
    },
  });
  return { ...result, reads };
}

async function expand(command: string, files: Files, cwd = '.', maxFiles = 4) {
  const workspace = await openRealWorkspace({ files });
  workspaces.push(workspace);
  return await expandOn(workspace, command, cwd, maxFiles);
}

/**
 * A pure input/output case: the production workspace reader only accepts a
 * normalized RELATIVE path, so an absolute `cd` cannot be served by real files.
 */
async function expandWithLiteralReader(command: string, files: Files, cwd = '.', maxFiles = 4) {
  const parsed = parseShellActionsDetailed(command);
  if (parsed.status !== 'parsed') throw new Error(`expected parsed: ${parsed.reason}`);
  const reads: string[] = [];
  const result = await expandShellScripts({
    actions: parsed.actions, cwd, maxFiles,
    readFile: async path => {
      reads.push(path);
      const content = files[path];
      return content === undefined
        ? { status: 'unavailable' as const, reason: `missing ${path}` }
        : { content, digest: digestOf(content) };
    },
  });
  return { ...result, reads };
}

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: 'app', scripts });

describe('B2-11 expandShellScripts runner forms', () => {
  it.each([
    ['npm run build', 'build'],
    ['npm run-script build', 'build'],
    ['npm test', 'test'],
    ['npm start', 'start'],
    ['npm stop', 'stop'],
    ['npm restart', 'restart'],
    ['pnpm run build', 'build'],
    ['yarn run build', 'build'],
  ])('%s expands scripts.%s', async (command, scriptName) => {
    const body = 'prisma migrate deploy';
    const result = await expand(command, { 'package.json': pkg({ [scriptName]: body }) });
    expect(result.expansions).toEqual([{
      action: command,
      scriptName,
      scriptText: body,
      actions: [{ text: body, sha256: keyOf(['prisma', 'migrate', 'deploy']) }],
      basis: { path: 'package.json', digest: digestOf(pkg({ [scriptName]: body })) },
    }]);
    expect(result.truncated).toBe(false);
  });

  it('does not expand a runner with extra arguments (the spec example -- --force)', async () => {
    const files = { 'package.json': pkg({ 'db:migrate': 'prisma migrate deploy' }) };
    const result = await expand('npm run db:migrate -- --force', files);
    expect(result.expansions).toEqual([]);
    expect(result.reads).toEqual([]);
  });

  it('does not expand bare pnpm X / yarn X or a non-runner', async () => {
    const files = { 'package.json': pkg({ build: 'tool x' }) };
    for (const command of ['pnpm build', 'yarn build', 'tool x']) {
      const result = await expand(command, files);
      expect(result.expansions, command).toEqual([]);
    }
  });

  it('never expands pre/post automatically and does not expand the fixed scripts as names', async () => {
    const files = { 'package.json': pkg({ build: 'tool x', prebuild: 'prep', postbuild: 'postp' }) };
    const result = await expand('npm run build', files);
    expect(result.expansions[0]?.actions).toEqual([{ text: 'tool x', sha256: keyOf(['tool', 'x']) }]);
    expect(result.expansions[0]?.actions).not.toContainEqual({ text: 'prep', sha256: keyOf(['prep']) });
    expect(result.expansions[0]?.actions).not.toContainEqual({ text: 'postp', sha256: keyOf(['postp']) });
  });

  it('leaves an action with no such script unexpanded (one read, no entry)', async () => {
    const files = { 'package.json': pkg({ other: 'tool z' }) };
    const result = await expand('npm run build', files);
    expect(result.expansions).toEqual([]);
    expect(result.reads).toEqual(['package.json']);
  });
});

describe('B2-11 expandShellScripts levels and dirs', () => {
  it('expands the same script name independently in two directories', async () => {
    const files = {
      'app/package.json': pkg({ build: 'tsc -p app' }),
      'other/package.json': pkg({ build: 'tsc -p other' }),
    };
    const result = await expand('cd app && npm run build; cd ../other && npm run build', files);
    expect(result.expansions).toHaveLength(2);
    expect(result.expansions.map(entry => [entry.action, entry.scriptName, entry.basis])).toEqual([
      ['npm run build', 'build', { path: 'app/package.json', digest: expect.any(String) }],
      ['npm run build', 'build', { path: 'other/package.json', digest: expect.any(String) }],
    ]);
    expect(result.expansions[0]!.actions).toEqual([{ text: 'tsc -p app', sha256: keyOf(['tsc', '-p', 'app']) }]);
    expect(result.expansions[1]!.actions).toEqual([{ text: 'tsc -p other', sha256: keyOf(['tsc', '-p', 'other']) }]);
    expect(result.truncated).toBe(false);
  });

  it('gives each level its own expansion entry with its own basis (two levels)', async () => {
    // Rework 1 item 3: the nested runner is its own `expansions` entry, keyed by
    // its directory, never folded into the outer entry.
    const files = {
      'package.json': pkg({ build: 'cd sub && npm run inner' }),
      'sub/package.json': pkg({ inner: 'tool b' }),
    };
    const result = await expand('npm run build', files);
    expect(result.expansions).toHaveLength(2);
    expect(result.expansions[0]).toMatchObject({
      action: 'npm run build', scriptName: 'build',
      actions: [{ text: 'npm run inner', sha256: keyOf(['npm', 'run', 'inner']) }],
      basis: { path: 'package.json' },
    });
    expect(result.expansions[1]).toMatchObject({
      action: 'npm run inner', scriptName: 'inner',
      actions: [{ text: 'tool b', sha256: keyOf(['tool', 'b']) }],
      basis: { path: 'sub/package.json' },
    });
    // Each level's own body is kept verbatim on its own entry.
    expect(result.expansions[0]).toMatchObject({ scriptText: 'cd sub && npm run inner' });
    expect(result.expansions[1]).toMatchObject({ scriptText: 'tool b' });
    expect(result.reads).toEqual(['package.json', 'sub/package.json']);
  });

  it('does not go a third level', async () => {
    const files = {
      'package.json': pkg({ a: 'npm run b', b: 'npm run c', c: 'tool deep' }),
    };
    const result = await expand('npm run a', files);
    // a and b are each an entry; b's body names `npm run c`, but c is level 3.
    expect(result.expansions.map(entry => entry.action)).toEqual(['npm run a', 'npm run b']);
    expect(result.expansions[1]?.actions).toEqual([{ text: 'npm run c', sha256: keyOf(['npm', 'run', 'c']) }]);
    expect(result.reads).toEqual(['package.json']);
  });

  it('uses cwd plus the static cd dirs, and does not expand a null dirs action', async () => {
    const files = { 'app/package.json': pkg({ 'db:migrate': 'prisma migrate deploy' }) };
    const result = await expand('cd app && npm run db:migrate', files);
    expect(result.expansions).toEqual([{
      action: 'npm run db:migrate', scriptName: 'db:migrate', scriptText: 'prisma migrate deploy',
      actions: [{ text: 'prisma migrate deploy', sha256: keyOf(['prisma', 'migrate', 'deploy']) }],
      basis: { path: 'app/package.json', digest: digestOf(files['app/package.json']!) },
    }]);
    expect(result.reads).toEqual(['app/package.json']);

    const noDirs = await expand('cd $ROOT && npm run db:migrate', files);
    expect(noDirs.expansions).toEqual([]);
    expect(noDirs.reads).toEqual([]);
  });

  it('applies an absolute cd as an absolute directory', async () => {
    const files = { '/abs/package.json': pkg({ build: 'tool a' }) };
    const result = await expandWithLiteralReader('cd /abs && npm run build', files);
    expect(result.reads).toEqual(['/abs/package.json']);
    expect(result.expansions[0]?.basis).toMatchObject({ path: '/abs/package.json' });
  });
});

describe('B2-11 expandShellScripts basis, dedupe and caps', () => {
  it('reads at most maxFiles distinct package.json files and marks no expansion for the rest', async () => {
    const files = {
      'a/package.json': pkg({ build: 'a' }),
      'b/package.json': pkg({ build: 'b' }),
    };
    const result = await expand(
      'cd a && npm run build; cd ../b && npm run build', files, '.', 1);
    expect(result.reads).toEqual(['a/package.json']);
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.basis).toMatchObject({ path: 'a/package.json' });
    expect(result.truncated).toBe(true);
  });

  it('reads a shared directory once and includes both distinct action texts', async () => {
    const files = { 'package.json': pkg({ a: 'tool a', b: 'tool b' }) };
    const result = await expand('npm run a && npm run b', files);
    expect(result.reads).toEqual(['package.json']);
    expect(result.expansions.map(entry => entry.action)).toEqual(['npm run a', 'npm run b']);
  });

  it('deduplicates repeated action text to one entry', async () => {
    const files = { 'package.json': pkg({ a: 'tool a' }) };
    const result = await expand('npm run a && npm run a', files);
    expect(result.expansions).toHaveLength(1);
  });

  it('keeps the per-entry basis unavailable when the real package.json is moved away', async () => {
    // F-021: the failed read is the real production reader over a file that was
    // really removed from the real root.
    const workspace = await openRealWorkspace({ files: { 'package.json': pkg({ build: 'tool a' }) } });
    workspaces.push(workspace);
    await rm(join(workspace.root, 'package.json'));
    const result = await expandOn(workspace, 'npm run build');
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
    const parsed = parseShellActionsDetailed('cd app && npm run build');
    if (parsed.status !== 'parsed') throw new Error(`expected parsed: ${parsed.reason}`);
    const result = await expandShellScripts({
      actions: parsed.actions, cwd: '.', maxFiles: 4,
      readFile: async (path: string) => ({ status: 'unavailable' as const, reason: `no such file: ${path}` }),
    });
    expect(result.expansions).toEqual([{
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable', reason: 'no such file: app/package.json' },
    }]);
    expect(result.truncated).toBe(false);
  });

  it('marks a non-JSON package.json unavailable', async () => {
    const result = await expand('npm run build', { 'package.json': 'not json' });
    expect(result.expansions[0]?.basis).toMatchObject({ status: 'unavailable' });
    expect(result.expansions[0]?.actions).toEqual([]);
  });

  it('cuts scriptText to 2,048 bytes and sets the record truncated flag; keys use the full text', async () => {
    const longWord = 'a'.repeat(3_000);
    const body = `tool ${longWord}`;
    const result = await expand('npm run long', { 'package.json': pkg({ long: body }) });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.expansions[0]!.scriptText, 'utf8')).toBeLessThanOrEqual(2_048);
    // The comparison key comes from the untruncated body, not the cut display text.
    expect(result.expansions[0]!.actions).toEqual([{ text: `tool ${longWord}`, sha256: keyOf(['tool', longWord]) }]);
  });
});
