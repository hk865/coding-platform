/**
 * WP2 group A, I-2: the formal message-duties facts adapter
 * (spec §2.1, §4.1, L1–L3). Entry E4: the real `createMessageDutiesFactsAdapter`
 * over real Role/Session facts. §5.3 doubles are used only where the real
 * dependencies cannot produce the shape under test: the M03 read failures, the
 * M02 guard conflicts/dedupe (the real resolver owns its guard list) and the
 * M02 resolved-fact conflicts (a real `resolved` result always agrees with the
 * Session pin; a legacy `s3.1` revision is not a parseable binding revision).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext, CorePrincipal } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { coordinationPolicyContentDigest,
  type CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1 } from '../../src/contracts/role-spec.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createMessageDutiesFactsAdapter,
  type MessageDutiesAdapterDependencies } from '../../src/core/work-graph/configuration/message-duties-adapter.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { T, openS5DecisionFixture, type S5DecisionFixture, type S5FixtureKind, type S5Records } from '../helpers/S5-decision-fixture.js';
import { wp2LegacyDuty, wp2RoleContent } from '../helpers/WP2-duties-fixture.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

type Roles = ReturnType<typeof createRoleConfigurationService>;
type Sessions = ReturnType<typeof createSessionDirectory>;

type Harness = {
  base: S5DecisionFixture;
  records: S5Records;
  roles: Roles;
  sessions: Sessions;
  adapter: MessageDutiesFactsPort;
  ctx: CoreCallContext;
};

function hostActor(ctx: CoreCallContext): Extract<CorePrincipal, { kind: 'host' }>['actor'] {
  if (ctx.principal.kind !== 'host') throw new Error('the WP2 duties harness requires a Host context');
  return ctx.principal.actor;
}

async function openHarness(kind: S5FixtureKind = 'memory'): Promise<Harness> {
  const base = await openS5DecisionFixture(kind);
  fixtures.push(base);
  const roles = createRoleConfigurationService({ records: base.records, now: base.now, eventId: base.newId });
  const sessions = createSessionDirectory({ records: base.records, lookups: base.records });
  const adapter = createMessageDutiesFactsAdapter({ roles, sessions, legacyDuty: wp2LegacyDuty });
  return { base, records: base.records, roles, sessions, adapter, ctx: base.ctx };
}

function roleBinding(templateId: string, templateRevision: string) {
  return { schemaVersion: 1 as const, bindingId: `binding-${templateId}-${templateRevision}`,
    templateId, templateRevision, bindingVersion: 1, policyRevision: 'wp2-policy' };
}

async function installRoleSpec(h: Harness, roleId: string, content: RoleSpecContentV1, revision = 1): Promise<RoleSpecPinV1> {
  const actor = hostActor(h.ctx);
  const id = `wp2-${roleId}-${revision}`;
  const installed = await h.roles.installRoleSpec(h.ctx, {
    commandId: `${id}-install`, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    identity: { projectId: h.ctx.projectId, actor, idempotencyKey: `${id}-install` },
    correlationId: id, submittedAt: T,
    payload: { roleId, revision, content, contentDigest: roleSpecContentDigest(content, roleId, revision) },
  });
  if (installed.status !== 'committed') throw new Error(`role install failed: ${JSON.stringify(installed)}`);
  const pin: RoleSpecPinV1 = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await h.roles.activateRoleSpec(h.ctx, {
    commandId: `${id}-activate`, commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    identity: { projectId: h.ctx.projectId, actor, idempotencyKey: `${id}-activate` },
    aggregateId: roleId, expectedRevision: 1, correlationId: id, submittedAt: T, payload: { target: pin },
  });
  if (activated.status !== 'committed') throw new Error(`role activation failed: ${JSON.stringify(activated)}`);
  return pin;
}

/** Seeds the exact active role matrix that makes the real resolver `resolved`. */
async function seedRoleMatrix(h: Harness, roleId: string, pin: RoleSpecPinV1): Promise<void> {
  const policyId = `wp2-policy-${roleId}`;
  const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const, projectId: h.ctx.projectId, policyId, revision: 1 };
  const policy: CoordinationPolicyContentV1 = {
    schemaVersion: 1, budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { [roleId]: pin }, coordinator: { roleId, note: 'Coordinate' } },
  };
  const activeRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId: h.ctx.projectId };
  await h.base.seedCommit([
    { refKey: canonicalJson(policyRef), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1,
        content: policy, contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: T }) },
    { refKey: canonicalJson(activeRef), schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: activeRef, revision: 1, projectId: h.ctx.projectId, activeRevision: policyRef }) },
  ]);
}

/** Spec M01 literal five-template table; deliberately NOT derived from role-profiles.ts. */
const LEGACY_TEMPLATE_DUTIES: readonly { templateId: string; templateRevision: string; duty: PlatformDutyV1 }[] = [
  { templateId: 'platform-executor', templateRevision: 's3.1', duty: 'executor' },
  { templateId: 'platform-secretary', templateRevision: 's3.1', duty: 'secretary' },
  { templateId: 'platform-adviser', templateRevision: 's3.1', duty: 'adviser' },
  { templateId: 'platform-scribe', templateRevision: 's3.1', duty: 'scribe' },
  { templateId: 'platform-reviewer', templateRevision: 's3.1', duty: 'reviewer' },
];

describe('M01 the Session fixed role facts decide the single duty', () => {
  it('M01 each of the five legacy platform templates resolves to its exact duty', async () => {
    const h = await openHarness();
    for (const row of LEGACY_TEMPLATE_DUTIES) {
      const role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }> =
        { kind: 'legacy_template', templateId: row.templateId, templateRevision: row.templateRevision };
      const sessionRef = await h.base.createS5Session(`m01-${row.duty}`, role);
      const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
        sessionRef, roleBinding: roleBinding(row.templateId, row.templateRevision),
      });
      expect(result).toMatchObject({ status: 'ready', value: { duties: [row.duty], independentReview: false } });
    }
  });

  it('M01 an unknown or wrong-version legacy template only defaults to executor', async () => {
    const h = await openHarness();
    const badTemplates: readonly Extract<RoleConfigurationRef, { kind: 'legacy_template' }>[] = [
      { kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's9.9' },
      { kind: 'legacy_template', templateId: 'platform-unknown', templateRevision: 's3.1' },
    ];
    for (const bad of badTemplates) {
      const sessionRef = await h.base.createS5Session(`m01-bad-${bad.templateId}-${bad.templateRevision}`, bad);
      const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
        sessionRef, roleBinding: roleBinding(bad.templateId, bad.templateRevision),
      });
      expect(result).toMatchObject({ status: 'ready', value: { duties: ['executor'] } });
    }
  });

  it('M01 a valid role spec without a platformDuty only defaults to executor', async () => {
    const h = await openHarness();
    const roleId = 'wp2-no-duty';
    const pin = await installRoleSpec(h, roleId, wp2RoleContent());
    const sessionRef = await h.base.createS5Session('m01-no-duty', { kind: 'role_spec', pin });
    const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toMatchObject({ status: 'ready', value: { duties: ['executor'] } });
  });

  it('M01 a pinned role spec resolves its platformDuty through the real resolver and pin read', async () => {
    const h = await openHarness();
    const roleId = 'wp2-pinned';
    const content = wp2RoleContent('scribe');
    const pin = await installRoleSpec(h, roleId, content);
    await seedRoleMatrix(h, roleId, pin);
    const sessionRef = await h.base.createS5Session('m01-pinned', { kind: 'role_spec', pin });
    const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toMatchObject({ status: 'ready', value: { duties: ['scribe'], independentReview: false } });
  });
});

describe('M02 conflicting duty, identity and guard facts are rejected', () => {
  // The three "a resolved ... disagrees" shapes here are unreachable through the
  // real `resolveRoleBindingFacts`, so §5.3's failure-shape double is the only
  // seam that can produce them:
  //   - a legacy Session's fixed revision is `s3.1`, which
  //     `roleSpecRevisionFromBinding` rejects as non-decimal, so the real
  //     resolver answers `inadmissible` and the duty conflict is never reached;
  //   - a `role_spec` Session's adapter checks `roleBinding` against the Session
  //     pin before the resolver, and the resolver derives `resolved.spec` from
  //     the very same `RoleSpecRevision` ref, so a real `resolved` result always
  //     agrees with the pin.  A seeded disagreement makes the resolver answer
  //     `inadmissible` first.
  // The real dependencies drive every other read and guard assertion.
  it('M02 a resolved role duty that disagrees with the legacy template duty is forbidden', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('secretary').template;
    const sessionRef = await h.base.createS5Session('m02-duty-conflict', template);
    const resolved = {
      status: 'ready' as const,
      value: { status: 'resolved' as const, roleId: 'platform-secretary',
        revision: { aggregateType: 'RoleSpecRevision' as const, projectId: h.ctx.projectId,
          roleId: 'platform-secretary', revision: 1 },
        spec: wp2RoleContent('adviser') },
    };
    const adapter = createMessageDutiesFactsAdapter({
      roles: {
        resolveRoleBindingFacts: async () => ({ result: resolved, guards: [] }),
        readRoleSpec: async () => { throw new Error('the legacy path must not read a role spec'); },
      },
      sessions: h.sessions,
      legacyDuty: wp2LegacyDuty,
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'the explicit Host duty disagrees with the resolved Role duty' });
  });

  it('M02 a stored Session identity that differs from the request is forbidden', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('scribe').template;
    const sessionRef = await h.base.createS5Session('m02-identity', template);
    const realRead = h.sessions.readSession.bind(h.sessions);
    const adapter = createMessageDutiesFactsAdapter({
      roles: h.roles,
      sessions: {
        readSession: async (ctx, ref) => {
          const result = await realRead(ctx, ref);
          if (result.status !== 'ready') return result;
          const card = structuredClone(result.value);
          card.record.ref = { ...card.record.ref, sessionId: 'wp2-other-session' };
          return { status: 'ready', value: card };
        },
      },
      legacyDuty: wp2LegacyDuty,
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('M02 two guards on the same key with different versions are rejected', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('executor').template;
    const sessionRef = await h.base.createS5Session('m02-guard-conflict', template);
    const adapter = createMessageDutiesFactsAdapter({
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: {
          status: 'absent', roleId: 'platform-executor', reason: 'no matrix' } },
          guards: [{ refKey: 'wp2-guard-key', expectedRevision: 1 },
            { refKey: 'wp2-guard-key', expectedRevision: 2 }] }),
        readRoleSpec: async () => { throw new Error('the legacy path must not read a role spec'); },
      },
      sessions: h.sessions,
      legacyDuty: wp2LegacyDuty,
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  it('M02 the real resolver and the Session fact return the complete merged guard set, one entry per refKey', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('executor').template;
    const sessionRef = await h.base.createS5Session('m02-guard-complete', template);
    // The real resolver and the real Session read drive the whole fact; no
    // internal collaborator is replaced. The complete guard set is specified
    // independently, not by uniqueness: for this legacy Session the resolver
    // reads the (absent) active coordination policy and the role active pointer
    // in one window (`role-memory-service.ts` phase A), and the adapter then
    // appends the Session's own CAS guard from the creating command's Session
    // ref at its fresh revision 1. §4.1 step 3/5: every original role guard and
    // the Session guard must enter the commit, in this exact order and with
    // these exact expected revisions.
    const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready duties fact');
    expect(result.value.guards).toEqual([
      { refKey: canonicalJson({ aggregateType: 'ProjectCoordinationPolicyActive', projectId: h.ctx.projectId }),
        expectedRevision: null },
      { refKey: canonicalJson({ aggregateType: 'ProjectRoleSpecActive', projectId: h.ctx.projectId,
        roleId: template.templateId }), expectedRevision: null },
      { refKey: canonicalJson({ aggregateType: 'Session', ...sessionRef }), expectedRevision: 1 },
    ]);
    expect(result.value.duties).toEqual(['executor']);
  });

  it('M02 a resolver guard that repeats the Session guard merges to one entry with the correct revision', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('executor').template;
    const sessionRef = await h.base.createS5Session('m02-guard-merge', template);
    const sessionKey = canonicalJson({ aggregateType: 'Session', ...sessionRef });
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: {
          status: 'absent', roleId: template.templateId, reason: 'no matrix' } },
          guards: [
            { refKey: sessionKey, expectedRevision: 1 },
            { refKey: 'wp2-merged-guard', expectedRevision: 5 },
            { refKey: 'wp2-merged-guard', expectedRevision: 5 },
          ] }),
        readRoleSpec: async () => { throw new Error('the legacy path must not read a role spec'); },
      },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready duties fact');
    // The Session guard arrives once from the resolver and once from the
    // Session facts; the merged set keeps each refKey exactly once with the
    // correct expectedRevision (duplicate resolver guards are also collapsed).
    expect(result.value.guards).toEqual([
      { refKey: sessionKey, expectedRevision: 1 },
      { refKey: 'wp2-merged-guard', expectedRevision: 5 },
    ]);
  });

  it('M02 a resolved role spec that disagrees with the Session fixed pin is forbidden', async () => {
    const h = await openHarness();
    const roleId = 'wp2-pin-conflict';
    const pin = await installRoleSpec(h, roleId, wp2RoleContent('scribe'));
    const sessionRef = await h.base.createS5Session('m02-pin-conflict', { kind: 'role_spec', pin });
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: {
          status: 'resolved', roleId, revision: pin.ref, spec: wp2RoleContent('adviser') } }, guards: [] }),
        readRoleSpec: h.roles.readRoleSpec.bind(h.roles),
      },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'the resolved Role facts disagree with the Session fixed pin' });
  });

  it('M02 a resolved revision that names another role is forbidden', async () => {
    const h = await openHarness();
    const roleId = 'wp2-revision-role-conflict';
    const content = wp2RoleContent('scribe');
    const pin = await installRoleSpec(h, roleId, content);
    const sessionRef = await h.base.createS5Session('m02-revision-role', { kind: 'role_spec', pin });
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: {
          status: 'resolved', roleId, revision: { ...pin.ref, roleId: 'wp2-other-role' }, spec: content } }, guards: [] }),
        readRoleSpec: h.roles.readRoleSpec.bind(h.roles),
      },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'the resolved Role facts disagree with the Session fixed pin' });
  });

  it('M02 a Role binding that does not name the Session fixed role is forbidden', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('scribe').template;
    const sessionRef = await h.base.createS5Session('m02-binding-mismatch', template);
    const result = await h.adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding('platform-adviser', 's3.1'),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('M02 a Session outside the bound project scope is forbidden before any read', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('executor').template;
    const sessionRef = await h.base.createS5Session('m02-scope', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => { throw new Error('scope must be checked first'); },
        readRoleSpec: async () => { throw new Error('scope must be checked first'); },
      },
      sessions: { readSession: async () => { throw new Error('scope must be checked first'); } },
    });
    const result = await adapter.readMessageDutiesFacts({ ...h.ctx, projectId: 'other-project' }, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});

function adapterWith(h: Harness, overrides: Partial<MessageDutiesAdapterDependencies>): MessageDutiesFactsPort {
  return createMessageDutiesFactsAdapter({
    roles: overrides.roles ?? h.roles,
    sessions: overrides.sessions ?? h.sessions,
    legacyDuty: overrides.legacyDuty ?? wp2LegacyDuty,
  });
}

const absentResolution = { status: 'ready' as const,
  value: { status: 'absent' as const, roleId: 'wp2-absent', reason: 'no role matrix' } };

describe('M03 role, Session and role-spec read failures never become a default duty', () => {
  it('M03 a throwing role resolver is unavailable and never reads the Session', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('secretary').template;
    const sessionRef = await h.base.createS5Session('m03-resolver-throw', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => { throw new Error('role facts exploded'); },
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => { throw new Error('the Session must not be read after a resolver throw'); } },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    // The exact public reason proves the resolver failure was returned, not a
    // later Session-read failure: a Session read would carry the other message.
    expect(result).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'the Role binding facts could not be resolved' });
  });

  it('M03 a rejected role resolution is returned unchanged', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('secretary').template;
    const sessionRef = await h.base.createS5Session('m03-resolver-rejected', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'rejected', code: 'forbidden',
          reason: 'the role facts are not readable' }, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => { throw new Error('must not read the Session'); } },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toEqual({ status: 'rejected', code: 'forbidden', reason: 'the role facts are not readable' });
  });

  it('M03 a not_ready role resolution is returned unchanged', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('secretary').template;
    const sessionRef = await h.base.createS5Session('m03-resolver-not-ready', template);
    const notReady = { status: 'not_ready' as const, observed: null,
      required: { kind: 'platform' as const, cursor: makeCommitCursor(9) } };
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: notReady, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => { throw new Error('must not read the Session'); } },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toEqual(notReady);
  });

  it('M03 an inadmissible role binding is forbidden before the legacy duty is reached', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('secretary').template;
    const sessionRef = await h.base.createS5Session('m03-inadmissible', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: { status: 'ready', value: {
          status: 'inadmissible', roleId: template.templateId,
          reasons: [{ code: 'role_binding_not_admissible', roleId: template.templateId,
            detail: 'role_not_registered', message: 'the role is not registered' }] } }, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => { throw new Error('must not read the Session'); } },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'the Role binding is inadmissible for message duties' });
  });

  it('M03 a missing Session stays not_found', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('scribe').template;
    const sessionRef = await h.base.createS5Session('m03-session-missing', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: absentResolution, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => ({ status: 'not_found' }) },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('M03 a not_ready Session read is returned unchanged', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('scribe').template;
    const sessionRef = await h.base.createS5Session('m03-session-not-ready', template);
    const notReady = { status: 'not_ready' as const, observed: null,
      required: { kind: 'platform' as const, cursor: makeCommitCursor(11) } };
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: absentResolution, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => notReady },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toEqual(notReady);
  });

  it('M03 a throwing Session read is unavailable', async () => {
    const h = await openHarness();
    const template = platformRoleProfile('scribe').template;
    const sessionRef = await h.base.createS5Session('m03-session-throw', template);
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: absentResolution, guards: [] }),
        readRoleSpec: async () => { throw new Error('must not read a role spec'); },
      },
      sessions: { readSession: async () => { throw new Error('the Session read exploded'); } },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(template.templateId, template.templateRevision),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('M03 a throwing fixed role-spec read is unavailable', async () => {
    const h = await openHarness();
    const roleId = 'wp2-spec-throw';
    const pin = await installRoleSpec(h, roleId, wp2RoleContent('adviser'));
    const sessionRef = await h.base.createS5Session('m03-spec-throw', { kind: 'role_spec', pin });
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: absentResolution, guards: [] }),
        readRoleSpec: async () => { throw new Error('the fixed role spec exploded'); },
      },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('M03 a missing fixed role-spec read stays not_found', async () => {
    const h = await openHarness();
    const roleId = 'wp2-spec-missing';
    const pin = await installRoleSpec(h, roleId, wp2RoleContent('adviser'));
    const sessionRef = await h.base.createS5Session('m03-spec-missing', { kind: 'role_spec', pin });
    const adapter = adapterWith(h, {
      roles: {
        resolveRoleBindingFacts: async () => ({ result: absentResolution, guards: [] }),
        readRoleSpec: async () => ({ status: 'not_found' }),
      },
    });
    const result = await adapter.readMessageDutiesFacts(h.ctx, {
      sessionRef, roleBinding: roleBinding(roleId, '1'),
    });
    expect(result).toEqual({ status: 'not_found' });
  });
});
