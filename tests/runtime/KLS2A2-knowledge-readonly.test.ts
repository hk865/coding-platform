/**
 * KLS-2a-2 rows H4 and H5 (level 1): a Work Run reads `.workbench/` but cannot write it. Both are real Host Work
 * Runs with a scripted model on a real git root, and the seed's public `architecture/adopt-initial` has written
 * `.workbench/architecture.json` first. H4 is the AG2b Host (`openHostScenario`, startup grant `read`/`write`).
 * H5 is a Host started from a command-line file whose startup binding also grants `shell` (ruling G3: every Work
 * Run, not only the local workbench grant), so its commands run in the real bubblewrap sandbox
 * (`CODING_AGENT_BWRAP_PATH`). The checks are the tool results the next model request carries and the files on disk.
 * The builder's rows after the code review (D5, D7, D8) sit beside H4 on the same scenario.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ModelRequest, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_SECRET_VALUE, AG2B_SECRET_VAR, AG2B_WORK_INSTRUCTION,
  AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, ag2bChecksConfiguration, seedAG2bWorkGraph, startCliHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, publicDirectory, selectWork, tempDir } from '../helpers/A2-restart-fixture.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { cleanupScenarios, openHostScenario, performs } from '../scenarios/harness.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';

const SKILLS_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
const hosts: AG2bHost[] = [];
afterEach(async () => {
  for (const started of hosts.splice(0)) await started.host.close().catch(() => undefined);
  await cleanupScenarios();
});

/** The tool result the Runtime served the model for `callId` (the first request that carries it). */
function resultOf(requests: readonly ModelRequest[], callId: string): ToolResult | undefined {
  for (const request of requests) {
    for (const message of request.messages) if (message.role === 'tool' && message.callId === callId) return message.result;
  }
  return undefined;
}

const exitCodeOf = (result: ToolResult | undefined): unknown =>
  (result?.output.find(part => part.kind === 'json') as { value?: { exitCode?: unknown } } | undefined)?.value?.exitCode;

/** The AG2b work binding from a command-line startup file, with `shell` and whole-workspace process access added. */
async function startShellHost(replies: readonly ScriptedReply[]): Promise<AG2bHost> {
  const root = await tempDir('kls2a2-h5-ws-');
  await initGitWorkspace(root);
  const actor: WorkbenchActor = { kind: 'human', id: 'kls2a2-h5-operator' };
  const host = await startCliHost({
    publicDir: await publicDirectory(), root, tempPrefix: 'kls2a2-h5', scope: AG2B_SCOPE, actor, at: AG2B_AT,
    workspaceName: 'KLS-2a-2 shell workspace', files: {}, readPrefixes: ['.'],
    bindings: [{
      id: 'ag2b-work-binding', label: 'KLS-2a-2 work runtime with shell', scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
      configurationRevision: 'kls2a2-h5-work@1',
      model: { revision: 'kls2a2-h5-model@1', provider: 'deepseek', model: 'kls2a2-scripted-work',
        secretEnvironmentVariable: AG2B_SECRET_VAR },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) },
        tools: ['read', 'write', 'shell'], writeScope: ['.'], shellWorkspaceAccess: 'all_except_denied',
        skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] }, systemInstruction: AG2B_WORK_INSTRUCTION,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      },
    }],
    queryProfiles: [],
    checks: ag2bChecksConfiguration({ actor }),
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
    kernelStore: { adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store' },
    secret: { variable: AG2B_SECRET_VAR, value: AG2B_SECRET_VALUE },
    replies,
  });
  hosts.push(host);
  await seedAG2bWorkGraph(host);
  return host;
}

it('H4 a Work Run\'s file tools are refused a write under .workbench/ and still read architecture.json', async () => {
  const h = await openHostScenario({ gitWorkspace: true, script: { replies: [
    { kind: 'calls', calls: [{ callId: 'kls2a2-h4-write', name: 'edit',
      args: { mode: 'create', path: '.workbench/x.txt', newText: 'x\n' } }] },
    { kind: 'calls', calls: [{ callId: 'kls2a2-h4-read', name: 'read', args: { path: '.workbench/architecture.json' } }] },
    { kind: 'text', text: 'KLS-2a-2 H4 done' },
  ] } });
  await h.advance(h.select('kls2a2-h4'), { stopBefore: performs('open_checks') });
  const requests = h.modelRequests();
  expect(resultOf(requests, 'kls2a2-h4-write')).toMatchObject({ status: 'error', error: { code: 'permission_denied' } });
  expect(existsSync(join(h.root, '.workbench', 'x.txt'))).toBe(false);
  expect(resultOf(requests, 'kls2a2-h4-read')).toMatchObject({ status: 'success', output: expect.arrayContaining([
    { kind: 'text', text: readFileSync(join(h.root, '.workbench', 'architecture.json'), 'utf8') }]) });
}, 180_000);

// KLS-2a-2 after the code review: the Kernel compares the write-denied prefix without case, so `.WORKBENCH/x` is
// refused as under `.workbench/` and nothing named `.WORKBENCH` appears in the root.
it('KLS2A2-D5 a Work Run\'s file tool is refused a write under .WORKBENCH/ as under .workbench/', async () => {
  const h = await openHostScenario({ gitWorkspace: true, script: { replies: [
    { kind: 'calls', calls: [{ callId: 'kls2a2-d5-write', name: 'edit',
      args: { mode: 'create', path: '.WORKBENCH/x', newText: 'x\n' } }] },
    { kind: 'text', text: 'KLS-2a-2 D5 done' },
  ] } });
  await h.advance(h.select('kls2a2-d5'), { stopBefore: performs('open_checks') });
  expect(resultOf(h.modelRequests(), 'kls2a2-d5-write')).toMatchObject({ status: 'error', error: { code: 'permission_denied' } });
  expect(readdirSync(h.root)).not.toContain('.WORKBENCH');
  // On a case-insensitive root a write that slipped through would land in `.workbench/x`.
  expect(existsSync(join(h.root, '.workbench', 'x'))).toBe(false);
}, 180_000);

// The read-and-write-denied prefixes (the project store `.workbench/local` among them) are compared without case as
// well: a read of `.WORKBENCH/local/x` is refused exactly as `.workbench/local/x` is.
it('KLS2A2-D7 a Work Run\'s file tool is refused a read under .WORKBENCH/local/ as under .workbench/local/', async () => {
  const h = await openHostScenario({ gitWorkspace: true, script: { replies: [
    { kind: 'calls', calls: [{ callId: 'kls2a2-d7-local', name: 'read', args: { path: '.workbench/local/x' } }] },
    { kind: 'calls', calls: [{ callId: 'kls2a2-d7-local-upper', name: 'read', args: { path: '.WORKBENCH/local/x' } }] },
    { kind: 'text', text: 'KLS-2a-2 D7 done' },
  ] } });
  await h.advance(h.select('kls2a2-d7'), { stopBefore: performs('open_checks') });
  const requests = h.modelRequests();
  const refused = { status: 'error', error: { code: 'permission_denied' } };
  expect(resultOf(requests, 'kls2a2-d7-local')).toMatchObject(refused);
  expect(resultOf(requests, 'kls2a2-d7-local-upper')).toMatchObject(refused);
}, 180_000);

// `.git` is refused to a Work Run's file tools by the Kernel's policy for its exact name; the write-denied prefixes
// add it without case, so `.GIT/hooks/x` (the hooks directory on a case-insensitive root) is refused too.
it('KLS2A2-D8 a Work Run\'s file tool is refused a write under .GIT/hooks/ as under .git/hooks/', async () => {
  const h = await openHostScenario({ gitWorkspace: true, script: { replies: [
    { kind: 'calls', calls: [{ callId: 'kls2a2-d8-git', name: 'edit',
      args: { mode: 'create', path: '.git/hooks/kls2a2-d8', newText: 'x\n' } }] },
    { kind: 'calls', calls: [{ callId: 'kls2a2-d8-git-upper', name: 'edit',
      args: { mode: 'create', path: '.GIT/hooks/x', newText: 'x\n' } }] },
    { kind: 'text', text: 'KLS-2a-2 D8 done' },
  ] } });
  await h.advance(h.select('kls2a2-d8'), { stopBefore: performs('open_checks') });
  const requests = h.modelRequests();
  const refused = { status: 'error', error: { code: 'permission_denied' } };
  expect(resultOf(requests, 'kls2a2-d8-git')).toMatchObject(refused);
  expect(resultOf(requests, 'kls2a2-d8-git-upper')).toMatchObject(refused);
  // On a case-insensitive root a write that slipped through would land in `.git/hooks/x`.
  expect(readdirSync(h.root)).not.toContain('.GIT');
  expect(existsSync(join(h.root, '.git', 'hooks', 'kls2a2-d8'))).toBe(false);
  expect(existsSync(join(h.root, '.git', 'hooks', 'x'))).toBe(false);
}, 180_000);

it('H5 a Work Run\'s shell cannot write .workbench/ in the real sandbox and still reads architecture.json', async () => {
  const host = await startShellHost([
    { kind: 'calls', calls: [{ callId: 'kls2a2-h5-write', name: 'shell', args: { command: 'printf x > .workbench/x.txt' } }] },
    { kind: 'calls', calls: [{ callId: 'kls2a2-h5-read', name: 'shell', args: { command: 'cat .workbench/architecture.json' } }] },
    { kind: 'text', text: 'KLS-2a-2 H5 done' },
  ]);
  await driveWorkflow(host, selectWork('kls2a2-h5'), { stopBefore: 'open_checks' });
  const requests = host.scripted.requests;
  expect(exitCodeOf(resultOf(requests, 'kls2a2-h5-write'))).toBeGreaterThan(0);
  expect(existsSync(join(host.root, '.workbench', 'x.txt'))).toBe(false);
  expect(resultOf(requests, 'kls2a2-h5-read')).toMatchObject({ status: 'success', output: expect.arrayContaining([
    { kind: 'text', text: readFileSync(join(host.root, '.workbench', 'architecture.json'), 'utf8') },
    { kind: 'json', value: expect.objectContaining({ exitCode: 0 }) }]) });
}, 180_000);
