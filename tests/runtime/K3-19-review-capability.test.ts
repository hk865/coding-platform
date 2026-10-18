/**
 * K3 U5 / R3 (L13): the Runtime `reviewCapability` read-only query.
 *
 * It answers whether the review/proposal round for one workspace+Role could
 * register the real `run_readonly_command` tool: the Host switch is on, the
 * whole workspace is readable and `ProcessSandbox.probe` succeeds with EXACTLY
 * the read-only options the real tool is built with (D-PROBE). It selects the
 * binding by Role and never resolves the model. The sandbox capability is the
 * same KE6 stand-in the K read-only entry uses; no host process runs.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type {
  ReadonlyCommandAccessInput, RuntimeExecutionDependencies,
} from '../../src/core/agent-runtime/execution-contracts.js';
import { createB2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';

/** R3: the binding's session Role the capability input must carry. */
const REVIEW_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };

const sandbox = vi.hoisted(() => ({
  available: true as boolean,
  /** Every read-only `ProcessSandbox.probe` option object, in call order. */
  probes: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      sandbox.probes.push(options ?? {});
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

afterEach(() => { sandbox.available = true; sandbox.probes = []; });

type HostFacts = {
  access: 'all_except_denied' | null;
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
};

async function runtimeWith(input: { facts: HostFacts; wholeWorkspaceRead?: boolean }) {
  const fixture = await createB2RuntimeFixture({ kind: 'memory' });
  const base = fixture.rebuildDeps();
  const deps: RuntimeExecutionDependencies = {
    ...base,
    readonlyCommandAccess: async (access: ReadonlyCommandAccessInput) => {
      // R3: the capability carries the binding's Role; the Host selects by it.
      expect(access.role).toEqual(REVIEW_ROLE);
      expect(access.workspace).toEqual(fixture.scope);
      return input.facts;
    },
    workspaceHost: {
      ...base.workspaceHost,
      async authorize(ctx, workspace) {
        const current = await base.workspaceHost.authorize(ctx, workspace);
        if (current.status !== 'ready') return current;
        return { ...current, value: { ...current.value, allowsRead: () => input.wholeWorkspaceRead !== false } };
      },
    },
  };
  return { fixture, runtime: createAgentRuntime(deps) };
}

it('K3-19 reviewCapability is available and probes with the real read-only command options', async () => {
  const { fixture, runtime } = await runtimeWith({ facts: {
    access: 'all_except_denied', processSandboxOptions: { readOnlyPaths: ['/opt/k3'], executablePath: '/usr/bin:/bin' } } });
  try {
    const result = await runtime.port.reviewCapability?.(fixture.ctx, { workspace: fixture.scope, role: REVIEW_ROLE });
    expect(result).toEqual({ status: 'available' });
    expect(sandbox.probes).toHaveLength(1);
    expect(sandbox.probes[0]).toMatchObject({
      workspaceMode: 'read_only', readOnlyPaths: ['/opt/k3'], executablePath: '/usr/bin:/bin',
    });
  } finally { await fixture.close(); }
});

it('K3-19 reviewCapability is unavailable when the Host switch is off and never probes', async () => {
  const { fixture, runtime } = await runtimeWith({ facts: { access: null, processSandboxOptions: {} } });
  try {
    const result = await runtime.port.reviewCapability?.(fixture.ctx, { workspace: fixture.scope, role: REVIEW_ROLE });
    expect(result?.status).toBe('unavailable');
    expect(result !== undefined && result.status === 'unavailable' ? result.reason.length : 0).toBeGreaterThan(0);
    expect(sandbox.probes).toEqual([]);
  } finally { await fixture.close(); }
});

it('K3-19 reviewCapability is unavailable when the read grant is not the whole workspace', async () => {
  const { fixture, runtime } = await runtimeWith({
    facts: { access: 'all_except_denied', processSandboxOptions: {} }, wholeWorkspaceRead: false });
  try {
    const result = await runtime.port.reviewCapability?.(fixture.ctx, { workspace: fixture.scope, role: REVIEW_ROLE });
    expect(result?.status).toBe('unavailable');
    expect(sandbox.probes).toEqual([]);
  } finally { await fixture.close(); }
});

it('K3-19 reviewCapability is unavailable when the sandbox probe fails', async () => {
  sandbox.available = false;
  const { fixture, runtime } = await runtimeWith({ facts: { access: 'all_except_denied', processSandboxOptions: {} } });
  try {
    const result = await runtime.port.reviewCapability?.(fixture.ctx, { workspace: fixture.scope, role: REVIEW_ROLE });
    expect(result?.status).toBe('unavailable');
    expect(sandbox.probes).toHaveLength(1);
  } finally { await fixture.close(); }
});

it('K3-19 reviewCapability never resolves the model, so a Host whose resolution would fail still answers available', async () => {
  const fixture = await createB2RuntimeFixture({ kind: 'memory' });
  const base = fixture.rebuildDeps();
  let resolveCalls = 0;
  const deps: RuntimeExecutionDependencies = {
    ...base,
    readonlyCommandAccess: async () => ({ access: 'all_except_denied' as const, processSandboxOptions: {} }),
    // A missing API key / unregistered provider rejects here; the capability
    // must not read it (R3: a missing key never settles `review_unavailable`).
    host: {
      ...base.host,
      async resolveConfiguration() {
        resolveCalls += 1;
        return { status: 'rejected' as const, code: 'unsupported' as const, reason: 'no configured secret' };
      },
    },
    workspaceHost: {
      ...base.workspaceHost,
      async authorize(ctx, workspace) {
        const current = await base.workspaceHost.authorize(ctx, workspace);
        if (current.status !== 'ready') return current;
        return { ...current, value: { ...current.value, allowsRead: () => true } };
      },
    },
  };
  const runtime = createAgentRuntime(deps);
  try {
    const result = await runtime.port.reviewCapability?.(fixture.ctx, { workspace: fixture.scope, role: REVIEW_ROLE });
    expect(result).toEqual({ status: 'available' });
    expect(resolveCalls).toBe(0);
  } finally { await fixture.close(); }
});
