/**
 * K3 U5 / R3 (L13): the production `reviewCapability` binding lookup.
 *
 * It exercises the real `createWorkbenchRuntimeHostBindings` factory (the same
 * one `createLocalWorkbenchHost` installs for a serializable runtime
 * configuration) through the real composition root: `createTargetPlatform`
 * forwards `host.readonlyCommandAccess` into the Runtime, so
 * `platform.runtime.reviewCapability(ctx, { workspace, role })` selects the
 * binding by the complete workspace scope + Role exactly as a Work Run does,
 * applies the `allowReadonlyCommands` switch narrowing, and never resolves the
 * model (the configured secret is always absent here).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkbenchWorkspaceConfig } from '../../src/app/host.js';
import { readonlyCommandsDisabledScopes } from '../../src/app/host.js';
import { createHostRuntimeResolverRegistry } from '../../src/app/host-settings.js';
import { AG2B_RUNTIME_BUDGET } from '../helpers/AG2b-collaboration-fixture.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    static async probe(): Promise<unknown> {
      return { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

const at = '2026-10-20T00:00:00.000Z';
const scope = { projectId: 'k3-19-project', workspaceId: 'k3-19-workspace' };
const role: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const actor = { kind: 'human' as const, id: 'k3-19-operator' };
const ctx: CoreCallContext = {
  ...scope, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', ...scope, actor }, signal: new AbortController().signal,
};

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function root(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'k3-19-review-'));
  temporary.push(created);
  return created;
}

function configuration(workspaceRoot: string, options: { tools?: readonly string[] } = {}): WorkbenchRuntimeConfiguration {
  return {
    schemaVersion: 1,
    bindings: [{
      id: 'k3-19-binding', label: 'K3-19 review capability binding', scope, role,
      configurationRevision: 'k3-19@1',
      model: { revision: 'k3-19-model@1', provider: 'deepseek', model: 'k3-19-scripted',
        secretEnvironmentVariable: 'K3_19_SECRET' },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('K3-19 instruction') },
        tools: [...(options.tools ?? ['read', 'run_readonly_command'])],
        writeScope: [],
        skills: { resourceRoot: workspaceRoot, enabledIds: [] },
        systemInstruction: 'K3-19 instruction', deniedPrefixes: [], processSandboxOptions: {},
        materialBasis: null, readonlyCommandAccess: 'all_except_denied' as const,
      },
    }],
    queryProfiles: [],
  };
}

async function platformWith(workspaceRoot: string, enabled: boolean, options: { tools?: readonly string[] } = {}) {
  const workspaces: WorkbenchWorkspaceConfig[] = [{
    scope, name: 'K3-19 workspace', root: workspaceRoot, workspaceRevision: 1, readPrefixes: ['.'],
    ...(enabled ? {} : { allowReadonlyCommands: false }),
  }];
  const bindings = createWorkbenchRuntimeHostBindings(
    configuration(workspaceRoot, options),
    // R3: the configured secret is absent; the capability must still answer.
    { secretSource: { get: () => undefined } },
    { readonlyCommandsDisabledScopes: readonlyCommandsDisabledScopes(workspaces) },
  );
  const platform = await createTargetPlatform({
    storage: { kind: 'memory' },
    workspace: {
      async resolveRoot(requested) {
        if (requested.projectId !== scope.projectId || requested.workspaceId !== scope.workspaceId) {
          return { status: 'rejected', code: 'not_found', reason: 'unknown workspace' };
        }
        return { status: 'ready', value: { root: workspaceRoot, workspaceRevision: 1 } };
      },
      async authorize() {
        return { status: 'ready', value: { subjectKey: 'k3-19-host', permissionRevision: '1', allowsRead: () => true } };
      },
    },
    runtime: bindings,
    now: () => at,
  });
  return { platform, bindings };
}

it('K3-19 the real Host binding answers reviewCapability available for the switch-on workspace+Role without resolving the model', async () => {
  const workspaceRoot = await root();
  const { platform } = await platformWith(workspaceRoot, true);
  try {
    const result = await platform.runtime.reviewCapability?.(ctx, { workspace: scope, role });
    expect(result).toEqual({ status: 'available' });
  } finally { await platform.close(); }
});

it('K3-19 the real Host binding answers reviewCapability unavailable when the workspace switch is off', async () => {
  const workspaceRoot = await root();
  const { platform } = await platformWith(workspaceRoot, false);
  try {
    const result = await platform.runtime.reviewCapability?.(ctx, { workspace: scope, role });
    expect(result).toEqual({ status: 'unavailable', reason: 'the Host read-only command switch is off' });
  } finally { await platform.close(); }
});

it('K3-19 the real Host binding selects by Role, so a Role with no matching binding is unavailable', async () => {
  const workspaceRoot = await root();
  const { platform } = await platformWith(workspaceRoot, true);
  try {
    const otherRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
    const result = await platform.runtime.reviewCapability?.(ctx, { workspace: scope, role: otherRole });
    expect(result).toEqual({ status: 'unavailable', reason: 'the Host read-only command switch is off' });
  } finally { await platform.close(); }
});

it('K3-19 the real Host binding is unavailable when the binding does not grant run_readonly_command', async () => {
  const workspaceRoot = await root();
  const { platform } = await platformWith(workspaceRoot, true, { tools: ['read'] });
  try {
    const result = await platform.runtime.reviewCapability?.(ctx, { workspace: scope, role });
    expect(result).toEqual({ status: 'unavailable', reason: 'the Host read-only command switch is off' });
  } finally { await platform.close(); }
});

it('K3-19 A1: the real Host binding is unavailable when it grants run_readonly_command without read', async () => {
  // The bug (A1): `readonlyCommandAccess` only checked `run_readonly_command`,
  // while `reviewRoundAdmissionProblem`'s Host layer 1 also needs `read`; the
  // two must agree so the query cannot answer `available` for a grant admission
  // would reject.
  const workspaceRoot = await root();
  const { platform } = await platformWith(workspaceRoot, true, { tools: ['shell', 'run_readonly_command'] });
  try {
    const result = await platform.runtime.reviewCapability?.(ctx, { workspace: scope, role });
    expect(result).toEqual({ status: 'unavailable', reason: 'the Host read-only command switch is off' });
  } finally { await platform.close(); }
});

it('K3-19 the settings resolver registry forwards reviewCapability to the current version', async () => {
  const firstRoot = await root();
  const secondRoot = await root();
  const registry = createHostRuntimeResolverRegistry(
    createWorkbenchRuntimeHostBindings(configuration(firstRoot, { tools: ['read'] }), { secretSource: { get: () => undefined } }));
  expect(await registry.readonlyCommandAccess?.({ workspace: scope, role })).toBeNull();
  registry.install(createWorkbenchRuntimeHostBindings(configuration(secondRoot), { secretSource: { get: () => undefined } }));
  expect(await registry.readonlyCommandAccess?.({ workspace: scope, role })).toEqual({
    access: 'all_except_denied', processSandboxOptions: {},
  });
});
