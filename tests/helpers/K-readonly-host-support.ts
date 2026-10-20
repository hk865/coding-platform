/**
 * K slice part B, item B/DB: a REAL `createLocalWorkbenchHost` whose workspace
 * switch (`allowReadonlyCommands`) and explicit runtime binding are ordinary
 * trusted startup facts.
 *
 * The KB-08 Runtime test used a local factory (`realReadonlyHost`) that applied
 * the D-SWITCH narrowing itself, so it could not detect a Host that fails to
 * narrow the Work-side resolution. This helper starts the production
 * `createLocalWorkbenchHost`, seeds the ordinary AG2b work graph through the
 * public HTTP routes and lets the test drive a real read-only Work with the
 * `workflow/driver-start` route — the narrowing then comes only from the Host.
 *
 * It reuses the AG2b seed/HTTP helpers (read-only imports); it never edits them.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME } from './host-page.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_QUERY_INSTRUCTION, AG2B_QUERY_PROFILE_ID,
  AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_SECRET_VALUE, AG2B_SECRET_VAR,
  AG2B_WORK_INSTRUCTION, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, ag2bChecksConfiguration, readPageToken,
  writeAG2bWorkspace, type AG2bHost,
} from './AG2b-collaboration-fixture.js';

export type KReadonlyRealHostOptions = {
  readonly replies: readonly ScriptedReply[];
  /** The workspace switch; false is the D-SWITCH narrowing under test. */
  readonly allowReadonlyCommands: boolean;
  /** The explicit binding tool grant; defaults to the tool under test. */
  readonly tools?: readonly string[];
  /** The explicit grant field; defaults to the L18 whole-workspace grant. */
  readonly readonlyCommandAccess?: boolean;
};

const toolsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));

/**
 * Start the real Host over one SQLite ledger + Kernel store and a controlled
 * scripted Work provider. The work binding always LISTS
 * `run_readonly_command` with `readonlyCommandAccess: 'all_except_denied'`; only
 * the Host's `allowReadonlyCommands` switch decides whether it survives.
 */
export async function startKReadonlyRealHost(options: KReadonlyRealHostOptions): Promise<AG2bHost & { close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'k-ro-real-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'k-ro-real-db-'));
  const publicDir = await mkdtemp(join(tmpdir(), 'k-ro-real-public-'));
  await writeAG2bWorkspace(root);
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'),
    `<meta name="${PLATFORM_TOKEN_META_NAME}" content="__PLATFORM_TOKEN__">`);
  const actor: WorkbenchActor = { kind: 'human', id: 'k-ro-real-operator' };
  const scripted = createScriptedModel(options.replies);
  const queryScripted = createScriptedModel([]);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: AG2B_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => context.model.includes('scripted-query') ? queryScripted.client : scripted.client,
  });
  const tools = [...(options.tools ?? ['read', 'run_readonly_command'])];
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [
      {
        id: 'k-ro-real-work-binding', label: 'K readonly real Host work binding', scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
        configurationRevision: 'k-ro-real-work@1',
        model: { revision: 'k-ro-real-work-model@1', provider: 'deepseek', model: 'k-ro-real-scripted-work',
          secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) },
          tools,
          writeScope: [],
          skills: { resourceRoot: toolsRoot, enabledIds: [] },
          systemInstruction: AG2B_WORK_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
          ...(options.readonlyCommandAccess === false ? {} : { readonlyCommandAccess: 'all_except_denied' as const }),
        },
      },
      {
        id: 'k-ro-real-query-binding', label: 'K readonly real Host query binding', scope: AG2B_SCOPE, role: AG2B_QUERY_ROLE,
        configurationRevision: 'k-ro-real-query@1',
        model: { revision: 'k-ro-real-query-model@1', provider: 'deepseek', model: 'k-ro-real-scripted-query',
          secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: ['read'], writeScope: [], skills: { resourceRoot: toolsRoot, enabledIds: [] },
          systemInstruction: AG2B_QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
    ],
    queryProfiles: [{
      id: AG2B_QUERY_PROFILE_ID, label: 'K readonly real Host consultation', scope: AG2B_SCOPE,
      runtimeBindingId: 'k-ro-real-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1000000, deadline: null } }],
  };
  const checks = ag2bChecksConfiguration({ actor, command: 'true' });
  const host: LocalWorkbenchHost = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor,
    workspaces: [{ scope: AG2B_SCOPE, name: 'K readonly real Host workspace', root, workspaceRevision: 1,
      readPrefixes: ['.'], allowReadonlyCommands: options.allowReadonlyCommands }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'k-ro-real-kernel', storeKey: 'k-ro-real-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtimeConfiguration: runtime,
    workflow,
    checks,
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
