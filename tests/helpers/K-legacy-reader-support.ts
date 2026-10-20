/**
 * Slice K part A, group W (KE4, KA-12): a real Host whose Kernel Store
 * registration holds only the current workspace entry, never the predecessor's
 * adapter.
 *
 * `tests/helpers/AG2b-collaboration-fixture.ts` writes the predecessor adapter
 * as a current entry, so this helper boots the same public Host over the same
 * ledger/workspace files as `startAG2bHost` but through a startup file whose
 * `kernelStores` registers a fresh current Kernel file for the workspace only.
 * The predecessor's adapter (`ag2b-kernel`) is therefore absent: L4 step 5's
 * "another adapter" cause, where the close answers `unsupported` and the history
 * read of the predecessor is honestly refused.
 *
 * The startup file is trusted Host-managed data, parsed by `src/app/main.ts`,
 * never request or model input. Scripted model replies only; no real model is
 * called.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { tempDir } from './A2-restart-fixture.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_QUERY_INSTRUCTION, AG2B_QUERY_PROFILE_ID, AG2B_QUERY_ROLE,
  AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_SECRET_VAR, AG2B_SECRET_VALUE, AG2B_WORK_INSTRUCTION,
  AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, ag2bChecksConfiguration, readPageToken, type AG2bHost,
} from './AG2b-collaboration-fixture.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';

/** The current entry the fallback successor Session is created on. */
export const K_CURRENT_ADAPTER = 'k-legacy-current';
export const K_CURRENT_STORE_KEY = 'k-legacy-current-store';

export type KLegacyReaderOverrides = {
  /** The same workspace root the predecessor Host used. */
  root: string;
  /** The same ledger directory the predecessor Host used. */
  database: string;
  replies?: readonly ScriptedReply[];
  actor?: WorkbenchActor;
  checkCommand?: string;
  /** The fresh current Kernel store file the successor Session is created on. */
  currentDatabasePath?: string;
  /** The predecessor adapter is never registered on this start. */
  predecessorRegistration?: 'absent';
};

/**
 * One real Host over the same files, with only the current workspace entry
 * registered. The returned shape matches `AG2bHost`, so the existing route
 * helpers (`post`, `answer`, `readExecution`, `driveChecked`) work as they do
 * for the other KA-12 cases.
 */
export async function startKLegacyReaderHost(publicDir: string, overrides: KLegacyReaderOverrides): Promise<AG2bHost> {
  const { root, database } = overrides;
  const configDir = await tempDir('k-legacy-config-');
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const actor: WorkbenchActor = overrides.actor ?? { kind: 'human', id: 'ag2b-operator' };
  const scripted = createScriptedModel(overrides.replies ?? []);
  const queryScripted = createScriptedModel([]);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: AG2B_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => context.model.includes('scripted-query') ? queryScripted.client : scripted.client,
  });
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [
      {
        id: 'ag2b-work-binding', label: 'K legacy-reader work runtime', scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
        configurationRevision: 'ag2b-work-host@1',
        model: { revision: 'ag2b-work-model@1', provider: 'deepseek', model: 'ag2b-scripted-work', secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) },
          tools: ['read', 'write', 'find_related_sessions', 'read_session_card', 'send_session_message'],
          writeScope: ['.'], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: AG2B_WORK_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
      {
        id: 'ag2b-query-binding', label: 'K legacy-reader query runtime', scope: AG2B_SCOPE, role: AG2B_QUERY_ROLE,
        configurationRevision: 'ag2b-query-host@1',
        model: { revision: 'ag2b-query-model@1', provider: 'deepseek', model: 'ag2b-scripted-query', secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: AG2B_QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
    ],
    queryProfiles: [{
      id: AG2B_QUERY_PROFILE_ID, label: 'K legacy-reader consultation', scope: AG2B_SCOPE,
      runtimeBindingId: 'ag2b-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1_000_000, deadline: null } }],
  };
  const checks = ag2bChecksConfiguration({ actor,
    ...(overrides.checkCommand === undefined ? {} : { command: overrides.checkCommand }) });
  const configPath = join(configDir, 'workbench.json');
  await writeFile(configPath, JSON.stringify({
    sqliteDirectory: database,
    actor,
    workspaces: [{ scope: AG2B_SCOPE, name: 'K legacy-reader project', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: {
      entries: [{ adapterId: K_CURRENT_ADAPTER, storeKey: K_CURRENT_STORE_KEY, workspace: AG2B_SCOPE,
        databasePath: overrides.currentDatabasePath ?? join(database, 'kernel-next.sqlite') }],
    },
    runtime,
    workflow,
    checks,
  }));
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({
    ...loaded,
    publicDir,
    now: () => AG2B_AT,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === AG2B_SECRET_VAR ? AG2B_SECRET_VALUE : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, publicDir, actor, scripted, queryScripted };
}
