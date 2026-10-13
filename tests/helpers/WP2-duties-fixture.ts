/** WP2 F-D: real pinned roles, newly created Sessions and authorized entered Work.
 * S5 supplies its accepted scope/plan checkpoint only. No role, Session, Run or
 * duties result is rewritten. The initial coordination matrix is governance
 * fixture data, following C2-runtime-platform-fixture; role changes use owners.
 */
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1 } from '../../src/contracts/role-spec.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { RoleBindingFactsPort, RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import type { MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { GOAL_A, GOAL_REVISION, PLAN_A1, T, WORKSPACE_REVISION, openS5DecisionFixture,
  type S5FixtureKind, type S5Records } from './S5-decision-fixture.js';

export const WP2_DUTIES: readonly PlatformDutyV1[] = ['secretary', 'adviser', 'scribe', 'executor', 'reviewer'];
export const WP2_ROLE_ID = 'wp2-member';

/** Exact composition-side legacy template comparison; no prefix inference. */
export function wp2LegacyDuty(role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>): PlatformDutyV1 | undefined {
  return WP2_DUTIES.find(duty => {
    const template = platformRoleProfile(duty).template;
    return role.templateId === template.templateId && role.templateRevision === template.templateRevision;
  });
}

/** §2.1's frozen seam. Injection keeps the fixture independent of implementation. */
export type WP2DutiesAdapterFactory = (deps: {
  roles: RoleBindingFactsPort & Pick<RoleConfigurationPort, 'readRoleSpec'>;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  legacyDuty: typeof wp2LegacyDuty;
}) => MessageDutiesFactsPort;

export function wp2RoleContent(duty?: PlatformDutyV1): RoleSpecContentV1 {
  return {
    schemaVersion: 1, ...(duty === undefined ? {} : { platformDuty: duty }),
    label: 'WP2 member', purpose: 'Read formal duties and send authorized user messages',
    responsibility: ['human_decision_support'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the accepted Task' }], optionalMaterials: [],
    permissions: { tools: ['read', ...USER_DECISION_TOOL_NAMES], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the actual result' }],
    exit: { success: 'Report the result', stop: 'Stop if unauthorized', handoff: 'Preserve references' },
  };
}

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`WP2 fixture expected ready: ${JSON.stringify(result)}`);
  return result.value;
}
function committed<T>(result: WriteResult<T>) {
  if (result.status !== 'committed') throw new Error(`WP2 fixture expected committed: ${JSON.stringify(result)}`);
  return result;
}

/** Reusable by PI's production composition: installs and activates via real ports. */
export async function installWP2Role(
  roles: Pick<RoleConfigurationPort, 'installRoleSpec' | 'activateRoleSpec'>,
  ctx: CoreCallContext, duty: PlatformDutyV1, revision = 1, roleId = WP2_ROLE_ID, projectRevision = 1,
): Promise<RoleSpecPinV1> {
  if (ctx.principal.kind !== 'host') throw new Error('WP2 role installation requires Host');
  const content = wp2RoleContent(duty);
  const id = `wp2-role-${roleId}-${revision}`;
  const installed = await roles.installRoleSpec(ctx, {
    commandId: `${id}-install`, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    identity: { projectId: ctx.projectId, actor: ctx.principal.actor, idempotencyKey: `${id}-install` },
    correlationId: id, submittedAt: T,
    payload: { roleId, revision, content, contentDigest: roleSpecContentDigest(content, roleId, revision) },
  });
  if (installed.status !== 'committed') throw new Error(`WP2 role install: ${JSON.stringify(installed)}`);
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await roles.activateRoleSpec(ctx, {
    commandId: `${id}-activate`, commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    identity: { projectId: ctx.projectId, actor: ctx.principal.actor, idempotencyKey: `${id}-activate` },
    aggregateId: roleId, expectedRevision: projectRevision, correlationId: id, submittedAt: T, payload: { target: pin },
  });
  if (activated.status !== 'committed') throw new Error(`WP2 role activation: ${JSON.stringify(activated)}`);
  return pin;
}

export async function openWP2DutiesFixture(
  kind: S5FixtureKind, duty: PlatformDutyV1, adapterFactory: WP2DutiesAdapterFactory,
) {
  const base = await openS5DecisionFixture(kind);
  try {
    const commits: PreparedCommit[] = [];
    const records: S5Records = {
      ...base.records,
      commit: input => { commits.push(structuredClone(input)); return base.records.commit(input); },
    };
    const roles = createRoleConfigurationService({ records, now: base.now, eventId: base.newId });
    const sessions = createSessionDirectory({ records, lookups: records });
    const pin = await installWP2Role(roles, base.ctx, duty);
    const policyId = 'wp2-duties-policy';
    const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const,
      projectId: base.ctx.projectId, policyId, revision: 1 };
    const policy: CoordinationPolicyContentV1 = {
      schemaVersion: 1, budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
      allowed: { inScopeRework: false, inScopeTesting: true },
      scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
      upgrade: { path: 'manual-decision', note: 'Host decides' },
      roles: { catalog: { [WP2_ROLE_ID]: pin }, coordinator: { roleId: WP2_ROLE_ID, note: 'Coordinate' } },
    };
    const activeRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId: base.ctx.projectId };
    await base.seedCommit([
      { refKey: canonicalJson(policyRef), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
        json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1,
          content: policy, contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: T }) },
      { refKey: canonicalJson(activeRef), schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 1,
        json: JSON.stringify({ ref: activeRef, revision: 1, projectId: base.ctx.projectId, activeRevision: policyRef }) },
    ]);
    const sessionRole: RoleConfigurationRef = { kind: 'role_spec', pin };
    const sessionRef = await base.createS5Session('wp2-pinned-member', sessionRole);
    const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'wp2-duties-binding',
      templateId: WP2_ROLE_ID, templateRevision: '1', bindingVersion: 1, policyRevision: policyId };
    const claim = await base.claimRun({ requestId: 'wp2-claim', goalRef: GOAL_A, planRef: PLAN_A1,
      taskId: 'a-work', sessionRef, roleBinding });
    const reads = createRunStateReader({ records });
    const permissions: PreparedTaskManifestV1['permissions'] = {
      policyRevision: policyId, tools: ['read', ...USER_DECISION_TOOL_NAMES], writeScope: [],
    };
    const hostRevision = 'wp2-exact-pin-host@1';
    const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
      if (ctx.projectId !== base.ctx.projectId || ctx.workspaceId !== base.ctx.workspaceId
        || canonicalJson(input.run.ref) !== canonicalJson(claim.runRef)
        || canonicalJson(input.sessionRole) !== canonicalJson(sessionRole)
        || input.configurationRevision !== hostRevision
        || canonicalJson(input.permissions) !== canonicalJson(permissions) || input.hostTemplate !== null) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host requires the exact Run, pin and grant' };
      }
      return { status: 'ready', value: { configurationRevision: hostRevision,
        permissions: structuredClone(permissions), hostTemplate: null } };
    };
    const entry = createExecutionEntryService({ records, reads, roles, bodies: base.bodies,
      authorizeConfiguration, now: base.now, eventId: base.newId, newId: base.newId });
    const execution = ready(await reads.readExecution(base.ctx, claim.runRef));
    const role = ready((await roles.resolveRoleBindingFacts(base.ctx,
      { roleBinding, declaredPermissions: permissions })).result);
    if (role.status !== 'resolved') throw new Error(`WP2 setup must resolve its real matrix: ${JSON.stringify(role)}`);
    const input = 'WP2 authorized entered Work fixture';
    const inputDigest = artifactBodyDigest(input);
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim, role, hostTemplate: null, roleBinding,
      hostConfigurationRevision: hostRevision, sessionRole,
      workspaceSnapshot: { workspaceId: claim.workspaceId, revision: WORKSPACE_REVISION },
      permissions, budget: execution.run.budget, selectedTaskInputs: [], materialBasis: null,
      materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [], sourceRefs: [], input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await base.bodies.put({ body: manifestJson, contentType: MANIFEST_CONTENT_TYPE,
      sourceRefs: [{ kind: 'workspace', refId: claim.workspaceId, revision: String(WORKSPACE_REVISION) }],
      origin: { kind: 'run', owner: claim.runRef }, requestedAt: T });
    if (stored.status !== 'ready') throw new Error(`WP2 manifest storage: ${JSON.stringify(stored)}`);
    const body = stored.value;
    const prepared: PreparedTaskExecution = { kind: 'task', claim,
      envelope: { schemaVersion: 1, envelopeId: 'wp2-duties-envelope',
        projectId: claim.task.projectId, workspaceId: claim.workspaceId, goalId: claim.task.goalId,
        taskId: claim.task.taskId, runRef: claim.runRef, attemptRef: claim.attemptRef, planRef: claim.planRef,
        roleBinding, workspaceSnapshot: manifest.workspaceSnapshot, permissions, budget: execution.run.budget,
        sourceRefs: [], bundleRef: body.ref },
      inputBinding: { schemaVersion: 1, inputDigest, manifestDigest: artifactBodyDigest(manifestJson),
        materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] } };
    const runPin = async () => ({ ref: claim.runRef, revision: ready(await reads.readExecution(base.ctx, claim.runRef)).run.revision });
    const authorized = committed(await entry.authorizeRuntimeEntry(base.ctx, {
      input: { prepared, consumerId: 'wp2-runtime' }, meta: { requestId: 'wp2-authorize', expected: [await runPin()] } }));
    const kernel = { ...execution.session.kernel, runId: 'wp2-kernel-run', turnId: 'wp2-kernel-turn' };
    const begun = committed(await entry.beginRuntimeEntry(base.ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: 'wp2-begin', expected: [await runPin()] } }));
    const entered = committed(await entry.recordExecutionEntered(base.ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
      enteredAt: T, kernelSource: { ...kernel, position: 3 },
      history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null },
    }, meta: { requestId: 'wp2-enter', expected: [await runPin()] } }));
    const work: CoreCallContext = { projectId: base.ctx.projectId, workspaceId: claim.workspaceId,
      principal: { kind: 'work_run', runRef: claim.runRef, roleBinding },
      materialReader: { kind: 'run', requester: claim.runRef }, signal: base.ctx.signal };
    const duties = adapterFactory({ roles, sessions, legacyDuty: wp2LegacyDuty });
    const materialReaders = createMaterialRecordReaders(records);
    const materials = createMaterialService({ bodies: base.bodies, authority: materialReaders.authority, now: base.now });
    const buildMailbox = (facts: MessageDutiesFactsPort = duties) => createSessionMailbox({
      records, sessions, executions: reads, roles, materials, duties: facts,
      runtimeAdmission: { bodies: base.bodies, authorizeConfiguration },
      now: base.now, newId: base.newId, systemActor: base.operatorActor,
    });
    const mailbox = buildMailbox();
    const request = (requestId: string, intent: 'notify' | 'decision_request') => ({
      input: { goalRef: GOAL_A, intent, text: 'WP2 user message',
        needsReply: intent === 'decision_request', waitAfterSend: intent === 'decision_request',
        options: intent === 'decision_request' ? [{ id: 'accept', label: 'Accept', effect: 'apply' as const }] : [], objects: [] },
      meta: { requestId, expected: [{ ref: GOAL_A, revision: GOAL_REVISION }] },
    });
    return { base, ctx: base.ctx, work, records, commits, roles, sessions, reads, entry, duties, mailbox,
      pin, roleBinding, sessionRef, claim, run: entered.value, entered, prepared, manifest,
      permissions, request, buildMailbox, snapshot: base.storeSnapshot, close: base.close,
      send: (requestId: string, intent: 'notify' | 'decision_request') => mailbox.sendUserMessage(work, request(requestId, intent)),
    };
  } catch (error) {
    await base.close();
    throw error;
  }
}

export type WP2DutiesFixture = Awaited<ReturnType<typeof openWP2DutiesFixture>>;
