/**
 * B2-07 / L19a: the `command_rerun_request` card through the REAL request
 * owner, review record and card source. The card appears at the highest
 * autonomy (the source never consults it), carries exactly the three fixed
 * options in order, is answerable only by the human, shows the Kernel's FULL
 * blocked command and the request's stored `match` plus this alias's declared
 * forms — never a re-expansion.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandRerunRequestCardFacts } from '../../src/core/work-graph/tasks/command-rerun-request-card.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunFromContinuation, requestRerunOf } from '../helpers/B2-crr-world.js';
import { countWorkspaceReads, openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
const realWorkspaces: RealWorkspace[] = [];
afterEach(async () => {
  for (const workspace of realWorkspaces.splice(0)) await workspace.close();
  for (const world of worlds.splice(0)) await world.close();
});

describe('B2-07: the command_rerun_request card', () => {
  it.each(['memory', 'sqlite'] as const)('B2-07 (%s): an exact rerun request produces the waiting_answer card with the three fixed options in order, at the highest autonomy', async (kind) => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    // The Goal's autonomy is already the highest the fixture seeds; the request
    // card source does not read it at all (asserted by the produced card).
    expect(world.fixture.goals.B.autonomy).toBeDefined();
    const record = await blockedRecord(world, 'k3-20-a', 'b2-07',
      [{ callId: 'k3-07-call-1', command: CRR_COMMAND }]);
    // F-008: one hand-computed blocked command (the single Kernel shell call),
    // asserted independently of the helper's internal count.
    expect(record.items).toHaveLength(1);
    expect(record.blockedCommands).toHaveLength(1);
    // F-008: the request comes from a SECOND real Run after the reviewed one
    // (the explicit continuation path; the other B2 rows keep the default).
    const request = await requestRerunFromContinuation(world, record, 'b2-07-request');
    expect(request.runRef.runId).not.toBe(record.ref.runId);
    expect(request.reviewRef.runId).toBe(record.ref.runId);
    const card = await crrCardOf(world);
    // The full card text exactly as the UCR card's object label carries it. The
    // prefix names the REVIEWED Run, never the continuation Run that requested.
    const fullText = [
      `#1@${record.ref.runId.slice(0, 8)}`,
      `原命令：${CRR_COMMAND}`,
      `这次请求：${CRR_COMMAND}`,
      `命中：${CRR_COMMAND}`,
      '原因：the migration must really run',
      // L19a's fixed sentence, written out from the spec (never imported).
      '平台按文字和静态解析认出改写；没认出的，agent 要注明以后才请求。允许只放行这一种写法。',
    ].join('\n');

    expect(card.state).toBe('waiting_answer');
    expect(card.actions).toEqual(['answer']);
    expect(card.readOnly).toBe(false);
    expect(card.options).toEqual([
      { id: 'allow_rerun', label: '允许重跑', effect: 'apply' },
      { id: 'deny', label: '不允许', effect: 'apply' },
      { id: 'deny_final', label: '不允许，也别再问', effect: 'apply' },
    ]);
    expect(card.source.kind).toBe('command_rerun_request');
    expect(card.source.pins).toEqual([
      { ref: request.ref, revision: 1 },
      { ref: record.ref, revision: record.revision },
      { ref: GOAL_B, revision: expect.any(Number) },
    ]);
    expect(card.objects).toEqual([{ kind: 'aggregate', pin: { ref: request.ref, revision: 1 },
      label: fullText }]);
    const facts = commandRerunRequestCardFacts({ request, review: record,
      goal: world.fixture.goals.B.snapshot,
      blockedCommandText: CRR_COMMAND, aliasRequests: [request], taskActive: true });
    expect(facts.summary).toBe(fullText);
    expect(card.objects[0]).toEqual({ kind: 'aggregate', pin: { ref: request.ref, revision: 1 },
      label: fullText });
  }, 120_000);

  it('B2-07/B2-15: a declared rewrite shows the fixed wording and the stored declared form, never a re-expansion', async () => {
    const world = await openK3ReviewCardWorld('sqlite', { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-07-declared',
      [{ callId: 'k3-07-call-2', command: CRR_COMMAND }]);
    const declaredCommand = `${CRR_COMMAND} --force`;
    const request = await requestRerunOf(world, record, 'b2-07-declared-request', declaredCommand,
      'the force form is the real rerun', { review: record.runRef.runId, alias: 1 });
    expect(request.match.kind).toBe('declared');
    expect(request.declaredForms).toHaveLength(1);
    expect(request.declaredForms[0]!.text).toBe(declaredCommand);
    const card = await crrCardOf(world);
    const fullText = [
      `#1@${record.runRef.runId.slice(0, 8)}`,
      `原命令：${CRR_COMMAND}`,
      `这次请求：${declaredCommand}`,
      '命中：agent 注明是改写',
      `注明过的写法：${declaredCommand}`,
      '原因：the force form is the real rerun',
      // L19a's fixed sentence, written out from the spec (never imported).
      '平台按文字和静态解析认出改写；没认出的，agent 要注明以后才请求。允许只放行这一种写法。',
    ].join('\n');
    // The card is the pure projection of the stored record: no field changes.
    const facts = commandRerunRequestCardFacts({ request, review: record, goal: world.fixture.goals.B.snapshot,
      blockedCommandText: CRR_COMMAND,
      aliasRequests: [request], taskActive: true });
    expect(facts.summary).toBe(fullText);
    expect(facts.objects[0]).toEqual({ kind: 'aggregate', pin: { ref: request.ref, revision: 1 },
      label: fullText });
    expect(card.objects).toEqual([{ kind: 'aggregate', pin: { ref: request.ref, revision: 1 },
      label: fullText }]);
    expect(facts.source.key).toBe(card.source.key);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('B2-07/B2-15 (%s): a stored package.json expansion is kept, never re-read when the card is read', async (kind) => {
    // F-097/F-021: ONE real workspace reader, counted, wired into the WORLD'S
    // OWN CRR owner (not a second owner built in the test). The request's
    // expansion comes from the real package.json; the public card read must not
    // touch the reader again.
    const workspace = await openRealWorkspace({
      workspace: { aggregateType: 'Workspace', ...WORKSPACE_SCOPE },
      files: { 'package.json': JSON.stringify({ scripts: { build: CRR_COMMAND } }) },
    });
    realWorkspaces.push(workspace);
    const counted = countWorkspaceReads(workspace.readWorkspace);
    const world = await openK3ReviewCardWorld(kind, {
      realKernelCommandFacts: true,
      commandRecognizer: createCommandRecognizer({ readWorkspace: counted }),
    });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-b', 'b2-07-stored',
      [{ callId: 'k3-07-call-5', command: CRR_COMMAND }]);
    const command = 'npm run build';
    const request = await requestRerunOf(world, record, 'b2-07-stored-request', command,
      'the build script is the real rerun');
    // The one real package.json expansion of this command, through the world's
    // own owner and the production recognizer.
    expect(counted.paths).toEqual(['package.json']);
    expect(request.match).toMatchObject({ kind: 'action', action: { text: command },
      viaScript: { scriptName: 'build', dir: '.' } });
    expect(request.reviewRef.runId).toBe(record.ref.runId);

    // The workspace changes AFTER the request is recorded. A fresh expansion
    // would now see `echo changed`; the card must keep the stored match.
    await writeFile(join(workspace.root, 'package.json'),
      JSON.stringify({ scripts: { build: 'echo changed' } }), 'utf8');

    const card = await crrCardOf(world);
    // Zero new workspace reads: the public card read projects the stored record.
    expect(counted.paths).toEqual(['package.json']);
    expect(card.objects).toHaveLength(1);
    const label = card.objects[0]?.label ?? '';
    expect(label).toContain(`原命令：${CRR_COMMAND}`);
    expect(label).toContain(`这次请求：${command}`);
    expect(label).toContain(`命中：${command}`);
    expect(label).not.toContain('echo changed');
    // The stored request still holds the original match through the public read.
    const reread = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
    expect(reread).toMatchObject({ status: 'ready',
      value: { match: { kind: 'action', action: { text: command } } } });
  }, 120_000);

  it('B2-07: the queue advertises the source as available and the card stays in waiting_answer', async () => {
    const world = await openK3ReviewCardWorld('sqlite', { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-b', 'b2-07-queue',
      [{ callId: 'k3-07-call-3', command: CRR_COMMAND }]);
    await requestRerunOf(world, record, 'b2-07-queue-request');
    const card = await crrCardOf(world);
    if (world.commandRerunCardSource.readByKey === undefined) throw new Error('no direct read');
    const direct = await world.commandRerunCardSource.readByKey(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, source: card.source });
    expect(direct).toMatchObject({ status: 'ready', value: { state: 'waiting_answer',
      source: { kind: 'command_rerun_request' } } });
  }, 120_000);
});
