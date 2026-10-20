/**
 * Slice 4C RW-1 (rework item 1): `record_note` must be in the production Host
 * grant, under the SAME condition as the mailbox tools (write-enabled
 * workspace), so a real executor Work Run can write a note.
 *
 * Part 1 pins the exported `localWorkbenchGrant` directly (the real function the
 * Host's `buildRuntimeConfiguration` uses). Part 2 starts a real
 * `createLocalWorkbenchHost` whose Work binding grant IS `localWorkbenchGrant`
 * (no injected `tools` override): the executor Work Run's model request carries
 * `record_note`, the Run's `record_note` tool call completes, the note commits
 * and is read back through the public `notes/list` route.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createLocalWorkbenchHost, localWorkbenchGrant, type LocalWorkbenchHost, type WorkbenchWorkspaceConfig,
} from '../../src/app/host.js';
import type { HostSettingsStoredModel } from '../../src/app/host-settings.js';
import {
  LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_ROLE_BINDING, type WorkbenchRuntimeConfiguration,
} from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { WorkbenchActor, NotesListResponse } from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME } from '../helpers/host-page.js';
import { ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_SECRET_VALUE, AG2B_SECRET_VAR,
  AG2B_WORK_TASK_ID, ag2bChecksConfiguration, corePost, plain, readPageToken, seedAG2bWorkGraphThrough,
  writeAG2bWorkspace, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';

const scope = { projectId: 's4c-rw1-project', workspaceId: 's4c-rw1-workspace' };
const model: HostSettingsStoredModel = { id: 's4c-rw1', label: 'RW-1 model', provider: 'deepseek', model: 'deepseek-flash' };
const workspaceOf = (writePrefixes?: string[]): WorkbenchWorkspaceConfig => ({ scope, name: 'RW-1 workspace',
  root: '/workspace', workspaceRevision: 1, readPrefixes: ['.'], ...(writePrefixes === undefined ? {} : { writePrefixes }) });

describe('S4C RW-1 localWorkbenchGrant', () => {
  it('RW-1 a write-enabled workspace grants record_note with the mailbox tools', () => {
    const grant = localWorkbenchGrant(workspaceOf(['.']), model);
    expect(grant.tools).toContain('record_note');
    expect(grant.tools).toContain('write');
    expect(grant.tools).toContain('send_session_message');
  });

  it('RW-1 a workspace with no write prefix does not grant record_note (same condition as the mailbox tools)', () => {
    const grant = localWorkbenchGrant(workspaceOf([]), model);
    expect(grant.tools).not.toContain('record_note');
    expect(grant.tools).not.toContain('write');
    expect(grant.tools).not.toContain('send_session_message');
  });
});

/**
 * A real `createLocalWorkbenchHost` over SQLite whose Work binding grant is
 * produced by the production `localWorkbenchGrant` for a write-enabled
 * workspace (no test-supplied `tools` list). The scripted provider is the
 * Host-internal controlled-provider seam.
 */
async function startRW1RealHost(replies: readonly ScriptedReply[]): Promise<AG2bHost & { close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 's4c-rw1-ws-'));
  const database = await mkdtemp(join(tmpdir(), 's4c-rw1-db-'));
  const publicDir = await mkdtemp(join(tmpdir(), 's4c-rw1-public-'));
  await writeAG2bWorkspace(root);
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'),
    `<meta name="${PLATFORM_TOKEN_META_NAME}" content="__PLATFORM_TOKEN__">`);
  const actor: WorkbenchActor = { kind: 'human', id: 's4c-rw1-operator' };
  const scripted = createScriptedModel(replies);
  const queryScripted = createScriptedModel([]);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: AG2B_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => context.model.includes('scripted-query') ? queryScripted.client : scripted.client,
  });
  const workspace: WorkbenchWorkspaceConfig = { scope: AG2B_SCOPE, name: 'RW-1 real Host workspace', root,
    workspaceRevision: 1, readPrefixes: ['.'], writePrefixes: ['.'] };
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 's4c-rw1-work-binding', label: 'RW-1 real Host work binding', scope: AG2B_SCOPE, role: LOCAL_WORKBENCH_ROLE,
      configurationRevision: 's4c-rw1-work@1',
      model: { revision: 's4c-rw1-model@1', provider: 'deepseek', model: 's4c-rw1-scripted-work',
        secretEnvironmentVariable: AG2B_SECRET_VAR },
      // The whole grant comes from the production function under test.
      grant: localWorkbenchGrant(workspace, model),
    }],
    queryProfiles: [],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: LOCAL_WORKBENCH_ROLE, roleBinding: LOCAL_WORKBENCH_ROLE_BINDING,
      budget: { tokenBudget: 1_000_000, deadline: null } }],
  };
  const host: LocalWorkbenchHost = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor,
    workspaces: [workspace],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 's4c-rw1-kernel', storeKey: 's4c-rw1-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtimeConfiguration: runtime,
    workflow,
    checks: ag2bChecksConfiguration({ actor }),
    publicDir,
    now: () => AG2B_AT,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === AG2B_SECRET_VAR ? AG2B_SECRET_VALUE : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return {
    host, base: address.url, token, root, database, publicDir, actor, scripted, queryScripted,
    close: async () => { await host.close(); await rm(root, { recursive: true, force: true });
      await rm(database, { recursive: true, force: true }); await rm(publicDir, { recursive: true, force: true }); },
  };
}

/** The seeded plan's assignment role must be the template the grant carries
 * (`local-workbench`); the Workflow resolves a binding by the assignment role. */
function patchPlanPropose(suffix: string, body: unknown): unknown {
  const cloned = structuredClone(body) as { request: { input: { draft?: { assignments?: { role: string }[] } } } };
  if (suffix === 'plans/propose') {
    for (const assignment of cloned.request.input.draft?.assignments ?? []) assignment.role = 'local-workbench';
  }
  return cloned;
}

async function seedRW1WorkGraph(started: AG2bHost): Promise<void> {
  await seedAG2bWorkGraphThrough(async (suffix, body) => {
    const response = await corePost(started.base, suffix, started.token, patchPlanPropose(suffix, body));
    return await response.json() as unknown;
  }, [AG2B_WORK_TASK_ID]);
}

describe('S4C RW-1 real Host executor Work Run', () => {
  it('RW-1 a real Host executor Work Run carries record_note from the production grant and commits a note read back through notes/list', async () => {
    const started = await startRW1RealHost([
      { kind: 'calls', calls: [{ callId: 'rw1-write', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'rw1-topic', conclusion: 'RW-1 conclusion',
        body: 'RW-1 body: the production grant carries record_note.',
        anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
      } }] },
      { kind: 'text', text: 'RW-1 wrote the note' },
    ]);
    try {
      await seedRW1WorkGraph(started);
      let current: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'rw1-host-flow',
        sessionHint: null, kind: 'select_work', taskId: AG2B_WORK_TASK_ID };
      for (let step = 0; step < 64; step += 1) {
        const response = await corePost(started.base, 'workflow/advance', started.token, plain(AG2B_SCOPE, current));
        const body = await response.json() as { status: string; value?: { state: string; next: WorkflowAdvanceInput | null } };
        if (body.status !== 'ready' || body.value === undefined)
          throw new Error(`RW-1 advance was not ready: ${JSON.stringify(body)}`);
        // The executor Run runs synchronously inside the Workflow `start` step:
        // the second model request is only made after the `record_note` tool
        // result was committed, so reaching it proves the tool call completed
        // and the note committed. Stop before the Workflow opens the registered
        // checks; the public readback below is this test's assertion.
        if (started.scripted.requests.length >= 2) break;
        if (body.value.state === 'completed' || body.value.next === null) break;
        current = body.value.next;
      }
      await expect.poll(() => started.scripted.requests.length, { timeout: 20_000, interval: 50,
        message: 'the real Host Work Run must reach a second model request after the record_note tool result' })
        .toBeGreaterThanOrEqual(2);
      const names = started.scripted.requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(names).toContain('record_note');

      // The write committed inside the tool call; read it back through the real
      // public `notes/list` route. The bounded poll absorbs any settlement lag.
      const readAccepted = async () => {
        const response = await corePost(started.base, 'notes/list', started.token, plain(AG2B_SCOPE,
          { goalId: AG2B_GOAL_REF.goalId, state: 'accepted', limit: 20, cursor: null }));
        const body = await response.json() as NotesListResponse;
        if (body.status !== 'ready') throw new Error(`RW-1 notes/list was not ready: ${JSON.stringify(body)}`);
        return body.value.items;
      };
      await expect.poll(readAccepted, { timeout: 20_000, interval: 100,
        message: 'the run-written note must be committed and publicly readable' }).toHaveLength(1);
      expect((await readAccepted())[0]).toMatchObject({
        kind: 'convention', topic: 'rw1-topic', conclusion: 'RW-1 conclusion', storedState: 'accepted',
        anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
      });
    } finally { await started.close(); }
  }, 120_000);
});

/**
 * RW-15 (rework item 1): a bodyless general-kind write is rejected by the note
 * service; the tool's envelope must stay well-formed so the Kernel accepts it
 * and the Run goes on. A second, valid write then commits. Reaching the third
 * scripted model request proves the Kernel accepted the bodyless result.
 */
describe('S4C RW-15 a model mistake must not fail the Run', () => {
  it('RW-15 a bodyless convention write is correctable, the Run continues, and only the valid note is committed', async () => {
    const started = await startRW1RealHost([
      { kind: 'calls', calls: [{ callId: 'rw15-bodyless', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'rw15-bodyless-topic', conclusion: 'RW-15 bodyless conclusion',
        anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
      } }] },
      { kind: 'calls', calls: [{ callId: 'rw15-valid', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'rw15-valid-topic', conclusion: 'RW-15 valid conclusion',
        body: 'RW-15 body: the Run continued after a bodyless write.',
        anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
      } }] },
      { kind: 'text', text: 'RW-15 wrote the valid note after correcting the bodyless one' },
    ]);
    try {
      await seedRW1WorkGraph(started);
      let current: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'rw15-host-flow',
        sessionHint: null, kind: 'select_work', taskId: AG2B_WORK_TASK_ID };
      for (let step = 0; step < 64; step += 1) {
        const response = await corePost(started.base, 'workflow/advance', started.token, plain(AG2B_SCOPE, current));
        const body = await response.json() as { status: string; value?: { state: string; next: WorkflowAdvanceInput | null } };
        if (body.status !== 'ready' || body.value === undefined)
          throw new Error(`RW-15 advance was not ready: ${JSON.stringify(body)}`);
        // Reply 3 can only be requested after the Kernel ACCEPTED the bodyless
        // tool result, so three requests prove the Run did not fail.
        if (started.scripted.requests.length >= 3) break;
        if (body.value.state === 'completed' || body.value.next === null) break;
        current = body.value.next;
      }
      await expect.poll(() => started.scripted.requests.length, { timeout: 30_000, interval: 50,
        message: 'the Run must reach three model requests: the bodyless result must not fail the Kernel' })
        .toBeGreaterThanOrEqual(3);

      const readAccepted = async () => {
        const response = await corePost(started.base, 'notes/list', started.token, plain(AG2B_SCOPE,
          { goalId: AG2B_GOAL_REF.goalId, state: 'accepted', limit: 20, cursor: null }));
        const body = await response.json() as NotesListResponse;
        if (body.status !== 'ready') throw new Error(`RW-15 notes/list was not ready: ${JSON.stringify(body)}`);
        return body.value.items;
      };
      await expect.poll(readAccepted, { timeout: 20_000, interval: 100,
        message: 'only the valid note must be committed and publicly readable' }).toHaveLength(1);
      expect((await readAccepted())[0]).toMatchObject({
        kind: 'convention', topic: 'rw15-valid-topic', conclusion: 'RW-15 valid conclusion',
        storedState: 'accepted', anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
      });
    } finally { await started.close(); }
  }, 150_000);
});
