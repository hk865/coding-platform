/**
 * B2-15 (L19a replay, item 11 second row): the SAME Kernel call replayed after
 * `package.json` changes returns the ORIGINAL result, with no second
 * recognizer/package read and no second owner write.
 *
 * The entry is the public `runCodingAgent` over a real Kernel Session store, a
 * real `shell` definition (the per-file §5.1 stand-in seam is installed below)
 * and the REAL `before_tool` shell gate (`w.hook`) built from the real blocked
 * record and CRR owner. The first Run blocks a `shell` call through an
 * EXPANSION ONLY (the call is `prisma migrate deploy`, the stored command is
 * `cd app && npm run db:migrate`, and `app/package.json` expands the script to
 * `prisma migrate deploy`; the call's own direct action is not one of the stored
 * actions), so the row cannot pass by a direct-action match. The Kernel records
 * the `hook_blocked` ToolResult. Re-running the SAME execution identity
 * resumes/replays the recorded Turn (`resumeCodingAgentInternal` ->
 * RecoveryCoordinator `terminal`) instead of re-executing the call.
 *
 * The second row is the no-write `request_command_rerun` result
 * (`not_blocked`): the real tool runs in the Kernel, records its result, and
 * the same identity replay returns it with no CRR commit/receipt.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appConfigSchema, ProviderRegistry, runCodingAgent,
  type HookPort, type RunState, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../vendor/coding-agent/dist/public-api.js';
import type { ToolCall } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { openB2BlockedWorld, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real seeded Run
// uses it; this file's Kernel runs must install the same mock themselves).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const SKILL_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
const FILES = {
  'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
};

const worlds: B2BlockedWorld[] = [];
const temps: string[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
  for (const root of temps.splice(0)) await rm(root, { recursive: true, force: true });
});

type KernelHarness = {
  model: ScriptedModel;
  sessionId: string;
  run(identity: { runId: string; turnId: string }, extra?: {
    controlHooks?: readonly HookPort[];
  }): Promise<Awaited<ReturnType<typeof runCodingAgent>>>;
};

async function kernelHarness(replies: readonly ScriptedReply[], options: {
  enabledNames: readonly string[];
  additionalTools?: (workspace: WorkspaceSandbox) => readonly ToolDefinition[];
  hostAuthorizedTools?: readonly string[];
}): Promise<KernelHarness> {
  const root = await mkdtemp(path.join(tmpdir(), 'b2-15-replay-'));
  temps.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: 'deepseek', model: 'b2-15-local', options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: [...options.enabledNames] },
    storage: { databasePath: path.join(root, 'session.sqlite') },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ['coding-safety'] },
    memory: { provider: 'empty' },
  });
  const model = createScriptedModel(replies);
  const providerRegistry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model.client,
  });
  const sessionId = `b2-15-${String(temps.length)}`;
  return {
    model,
    sessionId,
    run: (identity, extra = {}) => runCodingAgent({
      config, workspaceRoot, sessionId, providerRegistry,
      secretSource: { get: () => 'b2-15-synthetic-key' },
      input: 'B2-15 replay fixture input',
      executionIdentity: identity,
      ...(options.additionalTools === undefined ? {} : { additionalTools: options.additionalTools }),
      ...(options.hostAuthorizedTools === undefined ? {} : { hostAuthorizedTools: options.hostAuthorizedTools }),
      ...(extra.controlHooks === undefined ? {} : { controlHooks: extra.controlHooks }),
    }),
  };
}

/** The Kernel's recorded ToolResult for one call (toolBatch, then transcript). */
function resultOf(state: RunState, callId: string): ToolResult {
  const call = state.toolBatch?.calls.find(candidate => candidate.requestedCall.callId === callId);
  if (call?.result != null) return call.result as ToolResult;
  const entry = state.transcript.find(candidate => candidate.kind === 'tool_result' && candidate.callId === callId);
  if (entry?.kind === 'tool_result') return entry.result as ToolResult;
  throw new Error(`B2-15: the Kernel recorded no ToolResult for ${callId}`);
}

describe.each(['memory', 'sqlite'] as const)('B2-15 Kernel replay (%s)', kind => {
  it('a shell call blocked through an expansion replays the original hook_blocked result after package.json changes', async () => {
    const files = { ...FILES };
    const w = await openB2BlockedWorld(kind, { files });
    worlds.push(w);
    const callId = 'b2-15-blocked-shell';
    const h = await kernelHarness(
      [{ kind: 'calls', calls: [{ callId, name: 'shell', args: { command: 'prisma migrate deploy' } }] },
        { kind: 'text', text: 'the blocked call was recorded' }],
      { enabledNames: ['shell'] },
    );

    const first = await h.run({ runId: 'b2-15-shell-run', turnId: 'b2-15-shell-turn' }, { controlHooks: [w.hook] });
    expect(first.state.status).toBe('completed');
    const original = resultOf(first.state, callId);
    // The hook blocked through the STORED expansion (`prisma migrate deploy`) —
    // `npm run db:migrate` is the stored action and the original command's action,
    // so a direct-action-only match would have named `npm run db:migrate`.
    expect(original).toMatchObject({ status: 'error',
      error: { code: 'hook_blocked', retryable: false } });
    expect(original.output[0]).toMatchObject({ kind: 'text', text: expect.stringContaining('其中的 prisma migrate deploy') });
    // No workspace read was needed to recognise this call, so any re-parse or
    // re-read on replay would surface as a new count (0 -> >0).
    const packageReads = w.packageReads.length;
    expect(packageReads).toBe(0);
    const reviewReads = w.recordReads.length;
    const listCalls = w.listCalls.length;
    const modelCalls = h.model.calls();

    // The current package.json changes: a re-parse/re-read would see another
    // expansion (or at least consume one more read).
    files['app/package.json'] = JSON.stringify({ scripts: { 'db:migrate': 'echo changed' } });
    files['package.json'] = JSON.stringify({ scripts: { 'db:migrate': 'echo changed' } });

    // The SAME Kernel call identity is re-issued through the Kernel/Runtime path.
    const replay = await h.run({ runId: 'b2-15-shell-run', turnId: 'b2-15-shell-turn' }, { controlHooks: [w.hook] });
    expect(replay.state.status).toBe('completed');
    const replayed = resultOf(replay.state, callId);
    expect(replayed).toEqual(original);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(original));
    expect(h.model.calls()).toBe(modelCalls);
    expect(w.packageReads).toHaveLength(packageReads);
    expect(w.recordReads).toHaveLength(reviewReads);
    expect(w.listCalls).toHaveLength(listCalls);
  }, 120_000);

  it('a no-write request_command_rerun result replays through the Kernel with no second CRR write or receipt', async () => {
    const w = await openB2BlockedWorld(kind, { files: { ...FILES } });
    worlds.push(w);
    const callId = 'b2-15-no-write-tool';
    const toolName = w.tool.name;
    const h = await kernelHarness(
      [{ kind: 'calls', calls: [{ callId, name: toolName,
        args: { command: 'git status', reason: '这条不是被拦的命令' } }] },
        { kind: 'text', text: 'the no-write result was recorded' }],
      { enabledNames: [toolName], additionalTools: () => [w.tool], hostAuthorizedTools: [toolName] },
    );

    const first = await h.run({ runId: 'b2-15-tool-run', turnId: 'b2-15-tool-turn' });
    expect(first.state.status).toBe('completed');
    const original = resultOf(first.state, callId);
    expect(original).toMatchObject({ status: 'success' });
    expect(original.output[0]).toMatchObject({ kind: 'json', value: { status: 'not_blocked' } });
    expect(w.counts.crrCommits).toBe(0);
    expect(await w.listRequests(w.ctx)).toHaveLength(0);
    const modelCalls = h.model.calls();

    // Same identity replay: the Kernel reads its recorded result; the owner is
    // not called again and no receipt exists for the no-write branch.
    const replay = await h.run({ runId: 'b2-15-tool-run', turnId: 'b2-15-tool-turn' });
    expect(replay.state.status).toBe('completed');
    const replayed = resultOf(replay.state, callId);
    expect(replayed).toEqual(original);
    expect(h.model.calls()).toBe(modelCalls);
    expect(w.counts.crrCommits).toBe(0);
    expect(await w.listRequests(w.ctx)).toHaveLength(0);
    // A no-write result carries no commit cursor/receipt.
    expect(replayed).not.toHaveProperty('cursor');
    expect(replayed).not.toHaveProperty('replayed');
  }, 120_000);
});
