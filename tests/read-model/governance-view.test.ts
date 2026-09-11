import { expect, it, vi } from 'vitest';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { GovernanceRolePolicyExplanationPort } from '../../src/contracts/governance-view.js';
import { GovernanceReadModel } from '../../src/data/read-model-index/governance-view.js';
import { ROLE_SPEC_SOURCES_V1 } from '../../src/fixtures/role-spec-fixtures.js';

const scope = { projectId: 'project-a', workspaceId: 'workspace-a' };
const policyExplanation: GovernanceRolePolicyExplanationPort = {
  roleSpecPinReadiness: () => { throw Error('No role pin should be evaluated in this fixture'); },
};

function fixture(options: { incomplete?: boolean } = {}) {
  const snapshots = new Map<string, unknown>();
  const load = vi.fn(async (ref: { aggregateType: string; revision?: number }) => {
    const snapshot = snapshots.get(ref.aggregateType + ':' + (ref.revision ?? ''));
    return snapshot ? { status: 'found', snapshot } : { status: 'not_found', ref };
  });
  const events = vi.fn(async () => ({ events: [], throughCursor: 'cursor-1', hasMore: options.incomplete === true }));
  const ledger = { load, events } as unknown as Pick<StateLedger, 'load' | 'events'>;
  const view = new GovernanceReadModel({ ledger: () => ledger, defaults: {}, entryRoles: [], policyExplanation });
  return { snapshots, load, events, view };
}

it('exposes missing governance without inventing an automation grant or role matrix', async () => {
  const { view } = fixture();
  const result = await view.view(scope);
  expect(result.kinds).toHaveLength(5);
  expect(result.kinds.every(kind => kind.active === null && kind.installed.length === 0)).toBe(true);
  expect(result.automation).toBeNull();
  expect(result.roleMatrix.present).toBeNull();
  expect(result.gaps).toEqual([]);
});

it('reads the newly active canonical revision on each query without keeping another active state', async () => {
  const { view, snapshots } = fixture();
  const revision = (value: number) => ({ aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'policy-a', revision: value });
  for (const value of [1, 2]) {
    snapshots.set('ProjectCompletionPolicyActive:', { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: value, activeRevision: revision(value) });
    snapshots.set('CompletionPolicyRevision:' + value, { ref: revision(value), revision: value, contentRevision: value, contentDigest: 'digest-' + value, content: { version: value } });
    const result = await view.view(scope);
    const active = result.kinds.find(kind => kind.kind === 'CompletionPolicy')!.active!;
    expect(active.ref).toEqual(revision(value));
    expect(active.revision!.content).toEqual({ version: value });
    expect(active.activatedAt).toBeNull();
    expect(active.activatedBy).toBeNull();
  }
});

it('preserves event scan incompleteness instead of claiming complete installation history', async () => {
  const { view, events } = fixture({ incomplete: true });
  const result = await view.view(scope);
  expect(events).toHaveBeenCalledTimes(20);
  expect(result.gaps).toEqual([expect.stringContaining('20000')]);
});

it('uses the injected Control explanation for pin readiness without inventing a second admission rule', async () => {
  const { load, events } = fixture();
  const source = ROLE_SPEC_SOURCES_V1[0]!;
  const explanation = { status: 'spec_not_installed' as const, roleId: source.roleId, message: 'control-policy-result' };
  const roleSpecPinReadiness = vi.fn(() => explanation);
  const view = new GovernanceReadModel({
    ledger: () => ({ load, events }) as unknown as Pick<StateLedger, 'load' | 'events'>,
    defaults: { RoleSpecs: [source] }, entryRoles: [], policyExplanation: { roleSpecPinReadiness },
  });
  const result = await view.view(scope);
  expect(roleSpecPinReadiness).toHaveBeenCalledOnce();
  expect(result.kinds.find(kind => kind.kind === 'RoleSpecRevision')!.roleSpecs![0]!.readiness).toEqual(explanation);
});

it('keeps the displayed policy and its matrix on one revision when activation changes during a query', async () => {
  let activeReads = 0;
  const ref = (policyId: string) => ({ aggregateType: 'CoordinationPolicyRevision', projectId: scope.projectId, policyId, revision: 1 });
  const ledger = {
    events: async () => ({ events: [], throughCursor: null, hasMore: false }),
    load: async (query: { aggregateType: string; policyId?: string }) => {
      if (query.aggregateType === 'ProjectCoordinationPolicyActive') {
        // role enumeration reads A; kindView reads A; a redundant matrix read would see B.
        const policyId = ++activeReads <= 2 ? 'policy-a' : 'policy-b';
        return { status: 'found', snapshot: { ref: query, revision: activeReads, activeRevision: ref(policyId) } };
      }
      if (query.aggregateType === 'CoordinationPolicyRevision') return {
        status: 'found', snapshot: { ref: query, revision: 1, contentRevision: 1, policyId: query.policyId,
          contentDigest: query.policyId, content: { roles: { catalog: {}, coordinator: { roleId: query.policyId, note: '' } } } },
      };
      return { status: 'not_found', ref: query };
    },
  } as unknown as Pick<StateLedger, 'load' | 'events'>;
  const view = new GovernanceReadModel({ ledger: () => ledger, defaults: {}, entryRoles: [], policyExplanation });
  const result = await view.view(scope);
  expect(result.roleMatrix.policyId).toBe('policy-a');
  expect(result.roleMatrix.coordinator!.roleId).toBe('policy-a');
  expect(activeReads).toBe(2);
});
