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
    expect(result.reads).toEqual(['package.json', 'sub/package.json']);
  });

  it('does not go a third level', async () => {
    const files = {
      'package.json': pkg({ a: 'npm run b', b: 'npm run c', c: 'tool deep' }),
    };
    const result = await expand('npm run a', files);
    // a and b are each an entry; b's body names `npm run c`, but c is level 3.
    expect(result.expansions.map(entry => entry.action)).toEqual(['npm run a', 'npm run b']);
    expect(result.expansions[1]?.actions.map(action => action.text)).toEqual(['npm run c']);
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
  it('reads one file per distinct directory and at most maxFiles (the rest are absent)', async () => {
    const files: Files = {};
    for (const dir of ['a', 'b', 'c', 'd', 'e']) files[`${dir}/package.json`] = pkg({ [dir]: `tool ${dir}` });
    const result = await expand(
      'cd a && npm run a; cd ../b && npm run b; cd ../c && npm run c; cd ../d && npm run d; cd ../e && npm run e',
      files, '.', 4);
    expect(result.reads).toEqual(['a/package.json', 'b/package.json', 'c/package.json', 'd/package.json']);
    expect(result.expansions).toHaveLength(4);
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

  it('marks a failed read as unavailable with no actions and never throws', async () => {
    // The pure input/output case keeps the original hand-written failure reason.
    const result = await expandWithLiteralReader('npm run build', {});
    expect(result.expansions).toEqual([{
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable', reason: 'missing package.json' },
    }]);
  });

  it('keeps the per-entry basis unavailable when the real package.json is moved away', async () => {
    const workspace = await openRealWorkspace({ files: { 'package.json': pkg({ build: 'tool a' }) } });
    workspaces.push(workspace);
    await rm(join(workspace.root, 'package.json'));
    const result = await expandOn(workspace, 'npm run build');
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]).toMatchObject({
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable' },
    });
  });

  it('marks a non-JSON package.json unavailable', async () => {
    const result = await expand('npm run build', { 'package.json': 'not json' });
    expect(result.expansions[0]?.basis).toMatchObject({ status: 'unavailable' });
    expect(result.expansions[0]?.actions).toEqual([]);
  });

  it('clips scriptText to 2,048 UTF-8 bytes but keys come from the untruncated body', async () => {
    const command = `tool ${'x'.repeat(3_000)}`;
    const files = { 'package.json': pkg({ build: command }) };
    const result = await expand('npm run build', files);
    const entry = result.expansions[0]!;
    expect(Buffer.byteLength(entry.scriptText, 'utf8')).toBeLessThanOrEqual(2_048);
    const words = ['tool', 'x'.repeat(3_000)];
    expect(entry.actions).toEqual([{ text: words.join(' '), sha256: keyOf(words) }]);
  });
});
