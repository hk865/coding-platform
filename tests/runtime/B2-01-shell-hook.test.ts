/**
 * B2-01 (L19a "在哪拦", the example table row by row) at the public
 * `before_tool` seam: the real `skip_as_done` record with its real
 * `blockedCommands`, the real CRR owner/read port, the shared recognizer and
 * the exported shell hook. The binding is the same three-field projection the
 * preparation writes; the Kernel's contract turns `block` into a `hook_blocked`
 * tool result (no sandbox, no scope), so no direct sandbox is started here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { nextCall, openB2BlockedWorld, runHook, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';
import type { ToolCall } from '../../vendor/coding-agent/dist/public-api.js';


// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: B2BlockedWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const FILES = {
  'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy', 'migrate:prod': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'migrate:prod': 'prisma migrate deploy' } }),
};

async function world(kind: 'memory' | 'sqlite', command?: string,
  files: Record<string, string> = FILES): Promise<B2BlockedWorld> {
  const opened = await openB2BlockedWorld(kind, {
    files, ...(command === undefined ? {} : { command }),
  });
  worlds.push(opened);
  return opened;
}
const shell = (command: string, cwd?: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command, ...(cwd === undefined ? {} : { cwd }) } });

const WHERE = (runId: string) => `#1@${runId.slice(0, 8)}`;
const TAIL = '要再跑，先用 `request_command_rerun` 写明原因，等人允许。平台没认出来的改写，也要用 `rewriteOf` 注明以后再请求。';

describe.each(['memory', 'sqlite'] as const)('B2-01 blocked rows (%s)', kind => {
  it.each([
    ['npm run db:migrate', '其中的 npm run db:migrate'],
    ['bash -c "cd app && npm run db:migrate"', '其中的 npm run db:migrate'],
    ['FOO=1 npm run db:migrate 2>&1 | tee log', '其中的 npm run db:migrate'],
    ['npx prisma migrate deploy', '其中的 prisma migrate deploy'],
    ['prisma migrate deploy', '其中的 prisma migrate deploy'],
    ['./node_modules/.bin/prisma migrate deploy', '其中的 prisma migrate deploy'],
    ['npm run migrate:prod', '其中的 npm run migrate:prod'],
  ])('B2-01: %s is blocked with the fixed action text', async (command, clause) => {
    const w = await world(kind);
    const result = await runHook(w.hook, shell(command));
    expect(result).toEqual({ point: 'before_tool', kind: 'block',
      reason: `平台拦下了这条命令：${clause} 是 ${WHERE(w.record.ref.runId)} 的一部分（核对以后处置是“跳过”）。${TAIL}` });
  });

  it('B2-01: a whitespace-only difference and a different cwd block (whole-text exact)', async () => {
    const w = await world(kind);
    const exact = `平台拦下了这条命令：${WHERE(w.record.ref.runId)}（核对以后处置是“跳过”）。${TAIL}`;
    // Same command text, other cwd: (A) never compares cwd.
    expect(await runHook(w.hook, shell('cd  app &&  npm run db:migrate', 'elsewhere'))).toEqual({
      point: 'before_tool', kind: 'block', reason: exact });
    // A single whole-text rewrite that no action compares to still does not
    // block unless the text itself normalizes to a stored command; proof that
    // exact is on the NORMALISED text: the action hit above already blocked it.
    expect(await runHook(w.hook, shell('cd app && npm run db:migrate'))).toEqual({
      point: 'before_tool', kind: 'block', reason: exact });
  });

  it('B2-01: the not-blocked rows run', async () => {
    const w = await world(kind);
    for (const command of ['cd app', 'git status', "echo 'npm run db:migrate'"]) {
      expect(await runHook(w.hook, shell(command)), command).toEqual({ point: 'before_tool', kind: 'continue' });
    }
  });

  it('B2-01: an extra argument is not recognised statically', async () => {
    const w = await world(kind);
    expect(await runHook(w.hook, shell('npm run db:migrate -- --force'))).toEqual({ point: 'before_tool', kind: 'continue' });
  });

  it('B2-01: an UNPARSED stored command keeps one whole-normalized action', async () => {
    // `tool 'unterminated` fails the parse (an unmatched quote), so ② cannot
    // write parsed actions and falls back to the ONE whole command text. This
    // command reaches ONLY that fallback; no parsed command stands in for it.
    const w = await world(kind, "tool 'unterminated", {});
    expect(w.record.blockedCommands).toHaveLength(1);
    expect(w.record.blockedCommands[0]!.actions).toEqual([
      { text: "tool 'unterminated", sha256: expect.any(String) },
    ]);
    expect(w.record.blockedCommands[0]!.reviewRunId).toBe(w.record.ref.runId);
  });

  it('B2-01: an ALL-IRRELEVANT stored command keeps one whole-normalized action', async () => {
    // `  echo   hi  ` parses with no relevant action at all, so ② falls back to
    // the ONE whole-normalized text (`echo hi`). Picking a normal command would
    // not hit this fallback (it would carry its own parsed action).
    const w = await world(kind, '  echo   hi  ', {});
    expect(w.record.blockedCommands).toHaveLength(1);
    expect(w.record.blockedCommands[0]!.actions).toEqual([
      { text: 'echo hi', sha256: expect.any(String) },
    ]);
    expect(w.record.blockedCommands[0]!.reviewRunId).toBe(w.record.ref.runId);
  });
});
