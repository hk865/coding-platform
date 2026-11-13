/**
 * W-C (8C G4/G5): the proposal world. State comes from public steps only: the real
 * staff Work world opened by `openS7C1World`, the real `propose_architecture_revision`
 * Work tool (the frozen adapter over the proposal owner), the real freeze/apply/read
 * owner the composition builds, the real decision coordinator with the
 * `structural_proposal` application row, the real card read model with the
 * `structural_proposal` source, the public catalog revision owner and `sessions/link`.
 *
 * G5 composes all of that in `createTargetPlatform`; this fixture no longer supplies a
 * second application row, a card source or a schema-merged store. Two delegating
 * wrappers (A3/A4) only capture what the rows observe: the composition's one proposal
 * owner (for the service-level freeze/apply rows and `lastApply`) and the commit
 * observer (an `ArchitectureProposal` commit count; KLS-2b dropped the one-shot catalog
 * window hook). Every wrapper returns the real object and the real result; no record, pin or
 * context is hand-made. DR G4-06/07/08: the tool part is `openS7C1World`'s adviser
 * line; the project scope is the scope it actually returned.
 */
import { vi } from 'vitest';
import * as commitObserverModule from '../../src/composition/commit-observer.js';
import * as proposalServiceModule from '../../src/core/work-graph/architecture/proposal-service.js';
import type { ArchitectureProposalBatchRef, ArchitectureProposalBatchV1,
  ArchitectureProposalRef, ApplyBatchResult, ProposalResult, ProposeArchitectureRevisionInputV1 } from '../../src/contracts/architecture-proposal.js';
import type { ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionAnnotationV1, DecisionSourceV1, UserDecisionBodyV1 } from '../../src/contracts/goal-decisions.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { canonicalJson, canonicalKey, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { ArchitectureProposalService } from '../../src/core/work-graph/architecture/proposal-service.js';
import type { ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_RUNTIME_BUDGET, graphWrite } from './AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6AExtraBinding, type S6ASession } from './S6A-request-fixture.js';
import { openS7C1World, jsonOf, type S7C1World } from './S7C-member-fixture.js';
import { sessionOf } from './S7A-fixture.js';
import { createS6BLine } from './S6B1-fixture.js';
import { roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1 } from '../../src/contracts/role-spec.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1 }
  from '../../src/contracts/human-role-collaboration.js';
import { COORDINATION_POLICY_REVISION_SCHEMA_ID, PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID }
  from '../../src/core/work-graph/configuration/role-record-codecs.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import { fileURLToPath } from 'node:url';

import { committed, ready } from './S1-runtime-scenario-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type ToolCallScript = { callId: string; name: string; args: Record<string, unknown> };

const PROPOSE_TOOL = 'propose_architecture_revision';


export type ProposalWorld = {
  readonly staff: S7C1World;
  readonly platform: Platform;
  readonly scope: WorkspaceScope;
  readonly projectId: string;
  readonly pin: ArchitectureCatalogPinV1;
  readonly sourceLinks: readonly { link: SessionRef & { target: unknown }; linkRef: unknown }[];
  /** The executor source relations the trial world needs; `core` and `ui` are the two source links. */
  readonly executorLinks: { readonly core: unknown; readonly ui: unknown; readonly dest: unknown };
  /** One real Work Run of the adviser line, with the model-visible status of each call's tool result. */
  proposeWithStatus(calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
    responsibilityMoves?: unknown[]; reason: string }[]):
    Promise<Array<{ result: ProposalResult; toolStatus: string }>>;
  /** One real Work Run of an executor line, with the model-visible status of each call's tool result. */
  proposeAsExecutorWithStatus(calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
    responsibilityMoves?: unknown[]; reason: string }[]):
    Promise<Array<{ result: ProposalResult; toolStatus: string }>>;
  /** One real Work Run of the adviser line; each call is a real tool call of the frozen tool. */
  propose(calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
    responsibilityMoves?: unknown[]; reason: string }[]): Promise<ProposalResult[]>;
  /** One real Work Run of an executor line: the same tool, so the owner's duty check is the only change. */
  proposeAsExecutor(calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
    responsibilityMoves?: unknown[]; reason: string }[]): Promise<ProposalResult[]>;
  /** One real Work Run of the installed `role_spec` adviser line (the G5 duty-read row). */
  proposeAsRoleSpec(calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
    responsibilityMoves?: unknown[]; reason: string }[]): Promise<ProposalResult[]>;
  freezeAttempt(pin: ArchitectureCatalogPinV1, refs: readonly ArchitectureProposalRef[]):
    Promise<ReadResult<ArchitectureProposalBatchV1[]>>;
  /** The same propose command the last real tool call made: same context, same command id. */
  replayPropose(): Promise<ProposalResult>;
  apply(batchRef: ArchitectureProposalBatchRef, answerRef: SessionMessageRef):
    Promise<ApplyBatchResult<unknown>>;
  read(ref: ArchitectureProposalRef): Promise<{ proposal: unknown; batchRef: ArchitectureProposalBatchRef | null;
    cardKey: string | null }>;
  card(source: DecisionSourceV1): Promise<DecisionCardV1>;
  /** The number of `structural_proposal` cards the real queue lists (waiting/answered/history). */
  proposalCardCount(): Promise<number>;
  /** The one card whose key the proposal read returned, through the real queue/list read. */
  cardByKey(cardKey: string): Promise<DecisionCardV1>;
  /** A card read again after an answer/application (the closed projection). */
  cardBySource(source: DecisionSourceV1): Promise<DecisionCardV1>;
  answer(card: DecisionCardV1, optionId: 'approve' | 'reject', requestId: string,
    annotations?: readonly DecisionAnnotationV1[]): Promise<ResolveDecisionReadV1>;
  /** The saved answer read back through the real decision-message read. */
  readAnswer(source: DecisionSourceV1): Promise<ReadResult<{ message: SessionMessage | null;
    body: UserDecisionBodyV1 | null }>>;
  /** The last `applyArchitectureProposalBatch` result the application row saw (the row's own owner return). */
  lastApply(): ApplyBatchResult<unknown> | null;
  /** Public catalog revision (the frozen owner interface; the HTTP route is G5's). */
  revise(ops: unknown[], responsibilityMoves?: unknown[]): Promise<{ revision: number; pin: ArchitectureCatalogPinV1 }>;
  /** `ArchitectureProposal` commits observed on the real commit path; reset before one call. */
  proposalCommits(): number;
  resetProposalCommits(): void;
  readCatalog(): Promise<{ revision: number; modules: readonly ModuleDefinition[] }>;
  /** The public current-revision pin (the same read the frozen base came from). */
  currentPin(): Promise<ArchitectureCatalogPinV1>;
  close(): Promise<void>;
};

const S8C_PROJECT = 'ag2b-collab-project';

/** The real RoleSpec staff line: a role_spec adviser whose duty the proposal owner reads under the Host. */
const ROLE_SPEC_ADVISER_ID = 's8c-role-spec-adviser';
const ROLE_SPEC_ADVISER_CONTENT: RoleSpecContentV1 = {
  schemaVersion: 1, platformDuty: 'adviser', label: 'S8C RoleSpec adviser',
  purpose: 'Propose architecture revisions as a role_spec staff line', responsibility: ['planning'],
  requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan and catalog' }], optionalMaterials: [],
  permissions: { tools: ['read', 'propose_architecture_revision'], writeScope: 'none' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the proposal result' }],
  exit: { success: 'Proposal written', stop: 'Stop on a refused read', handoff: 'Keep the proposal ref' },
};
const ROLE_SPEC_ADVISER_PIN: RoleSpecPinV1 = {
  ref: { aggregateType: 'RoleSpecRevision', projectId: S6A_SCOPE.projectId,
    roleId: ROLE_SPEC_ADVISER_ID, revision: 1 },
  digest: roleSpecContentDigest(ROLE_SPEC_ADVISER_CONTENT, ROLE_SPEC_ADVISER_ID, 1),
};
const ROLE_SPEC_ADVISER_ROLE: RoleConfigurationRef = { kind: 'role_spec', pin: ROLE_SPEC_ADVISER_PIN };
const ROLE_SPEC_ADVISER_BINDING: WorkbenchRuntimeBinding = {
  id: 's8c-role-spec-adviser-binding', label: 'S8C RoleSpec adviser', scope: S6A_SCOPE,
  role: ROLE_SPEC_ADVISER_ROLE, configurationRevision: 's8c-role-spec-adviser@1',
  model: { revision: 's8c-role-spec-adviser-model@1', provider: 'deepseek',
    model: 's8c-scripted-role-spec-adviser', secretEnvironmentVariable: 'S6A_CONTROLLED_SECRET' },
  grant: { budget: AG2B_RUNTIME_BUDGET, hostTemplate: null, tools: ['read', PROPOSE_TOOL], writeScope: [],
    skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url)),
      enabledIds: [] },
    systemInstruction: 'S8C RoleSpec adviser guidance', deniedPrefixes: [],
    processSandboxOptions: {}, materialBasis: null, platformDuty: 'adviser' },
};
const ROLE_SPEC_ADVISER_BINDING_REF = {
  schemaVersion: 1 as const, bindingId: 's8c-role-spec-adviser', templateId: ROLE_SPEC_ADVISER_ID,
  templateRevision: '1', bindingVersion: 1, policyRevision: 's8c-role-spec-policy@1',
};

function roleSpecAdviserExtra(): S6AExtraBinding {
  return {
    binding: ROLE_SPEC_ADVISER_BINDING,
    workflow: { workspace: S6A_SCOPE, sessionRole: ROLE_SPEC_ADVISER_ROLE,
      roleBinding: ROLE_SPEC_ADVISER_BINDING_REF, budget: { tokenBudget: 1_000_000, deadline: null } },
  };
}

/**
 * The real role_spec adviser line: install/activate the RoleSpec through the public
 * role owner, seed the project's coordination matrix (the one governance fact with
 * no public writer in this slice) and create the Session through `sessions/create`.
 */
async function openRoleSpecAdviserLine(platform: Platform, ctx: CoreCallContext,
  staff: S7C1World): Promise<S6ASession> {
  const projectId = S6A_SCOPE.projectId;
  const hostActor = ctx.principal.kind === 'host' ? ctx.principal.actor : { kind: 'system' as const, id: 's8c-role-spec' };
  const at = staff.world.clock.now();
  const identity = (key: string) => ({ projectId, actor: hostActor, idempotencyKey: key });
  const installed = await platform.roles.installRoleSpec(ctx, {
    commandId: 's8c-role-spec-install', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    correlationId: 's8c-role-spec', submittedAt: at, identity: identity('s8c-role-spec-install'),
    payload: { roleId: ROLE_SPEC_ADVISER_ID, revision: 1, content: ROLE_SPEC_ADVISER_CONTENT,
      contentDigest: ROLE_SPEC_ADVISER_PIN.digest },
  });
  if (installed.status !== 'committed') {
    throw new Error(`S8C proposal world: the RoleSpec install failed: ${JSON.stringify(installed)}`);
  }
  const activated = await platform.roles.activateRoleSpec(ctx, {
    commandId: 's8c-role-spec-activate', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    correlationId: 's8c-role-spec', submittedAt: at, identity: identity('s8c-role-spec-activate'),
    aggregateId: ROLE_SPEC_ADVISER_ID, expectedRevision: 1, payload: { target: ROLE_SPEC_ADVISER_PIN },
  });
  if (activated.status !== 'committed') {
    throw new Error(`S8C proposal world: the RoleSpec activation failed: ${JSON.stringify(activated)}`);
  }
  const policy: CoordinationPolicyContentV1 = {
    schemaVersion: 1, budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { [ROLE_SPEC_ADVISER_ID]: ROLE_SPEC_ADVISER_PIN },
      coordinator: { roleId: ROLE_SPEC_ADVISER_ID, note: 'Coordinate' } },
  };
  const policyId = 's8c-role-spec-policy';
  const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const, projectId, policyId, revision: 1 };
  const activeRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId };
  const eventId = 's8c-role-spec-policy-event';
  const body = {
    eventId, eventType: 'RoleSpecActivated', schemaVersion: 1, occurredAt: at,
    projectId, workspaceId: S6A_SCOPE.workspaceId, aggregateType: 'ProjectRoleSpecActive',
    aggregateId: ROLE_SPEC_ADVISER_ID, aggregateRevision: 2, causationId: 's8c-role-spec-policy',
    correlationId: 's8c-role-spec-policy', idempotencyKey: 's8c-role-spec-policy-seed', actor: hostActor,
    payload: { activeRef: { aggregateType: 'ProjectRoleSpecActive', projectId, roleId: ROLE_SPEC_ADVISER_ID },
      activeRevision: ROLE_SPEC_ADVISER_PIN.ref },
  };
  // The project coordination matrix has no public writer in this slice (the existing
  // role fixtures seed it through the records port); the registered activated event
  // only carries the commit cursor.
  const seeded = await platform.disconnect.records.commit({
    identityKey: 's8c-role-spec-policy-seed', fingerprint: 's8c-role-spec-policy-seed-v1',
    guards: [policyRef, activeRef].map(ref => ({ refKey: canonicalJson(ref as unknown as JsonValue), expectedRevision: null })),
    records: [
      { refKey: canonicalJson(policyRef as unknown as JsonValue), schemaId: COORDINATION_POLICY_REVISION_SCHEMA_ID,
        revision: 1, json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId,
          contentRevision: 1, content: policy, contentDigest: coordinationPolicyContentDigest(policy, policyId, 1),
          installedAt: at }) },
      { refKey: canonicalJson(activeRef as unknown as JsonValue), schemaId: PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID,
        revision: 1, json: JSON.stringify({ ref: activeRef, revision: 1, projectId, activeRevision: policyRef }) },
    ],
    events: [{ eventId, eventType: 'RoleSpecActivated', schemaVersion: 1, occurredAt: at, json: JSON.stringify(body) }],
    claims: [], indexGuards: [], indexChanges: [],
  });
  if (seeded.status !== 'committed') {
    throw new Error(`S8C proposal world: the coordination policy seed failed: ${JSON.stringify(seeded)}`);
  }
  return await sessionOf(staff.world, await createS6BLine(staff.main,
    { label: 's8c-role-spec-adviser', role: ROLE_SPEC_ADVISER_ROLE }));
}

function moduleOf(moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId: S8C_PROJECT, moduleId }, name: moduleId, responsibility: `Own ${moduleId}`,
    paths, interfaces: [] };
}

/** The executor source relations on the two modules the S6A catalog already adopted. */
async function linkExecutor(platform: Platform, ctx: CoreCallContext, sessionRef: SessionRef,
  moduleId: string, requestId: string): Promise<unknown> {
  const card = ready(await platform.sessions.readSession(ctx, sessionRef));
  const target = { kind: 'module' as const, ref: { projectId: sessionRef.projectId, moduleId } };
  const ref = responsibleLinkRef(sessionRef, target);
  const existing = card.links.find(entry => canonicalKey(entry.ref) === canonicalKey(ref));
  committed(await platform.sessions.linkSessionWork(ctx, {
    meta: { requestId, expected: [
      { ref: card.record.ref, revision: card.record.revision },
      { ref, revision: existing?.revision ?? 0 },
    ] },
    input: { sessionRef, target, relation: 'responsible', active: true },
  }));
  const after = ready(await platform.sessions.readSession(ctx, sessionRef));
  const link = after.links.find(entry => canonicalKey(entry.ref) === canonicalKey(ref));
  if (link === undefined) throw new Error(`S8C proposal world: the executor link on ${moduleId} was not read back`);
  return link.ref;
}

type WindowPort = { isOpen: (ctx: never, input: { projectRef: { projectId: string } }) =>
  Promise<{ status: 'ready'; value: { open: boolean; operationRef: null; revision: null } }> };
export async function openProposalWorld(options: { backend?: 'memory' | 'sqlite';
  batchWindow?: boolean | WindowPort; roleSpecLine?: boolean } = {}): Promise<ProposalWorld> {
  let staff: S7C1World | undefined;
  const captured: { service: ArchitectureProposalService | null } = { service: null };
  const commits = { count: 0 };
  let lastPropose: { ctx: CoreCallContext; input: ProposeArchitectureRevisionInputV1 & { commandId: string } } | null = null;
  let lastApply: ApplyBatchResult<unknown> | null = null;
  let proposalSpy: { mockRestore(): void } | undefined;
  let observerSpy: { mockRestore(): void } | undefined;
  try {
    const realCreateProposal = proposalServiceModule.createArchitectureProposalService;
    proposalSpy = vi.spyOn(proposalServiceModule, 'createArchitectureProposalService').mockImplementation(deps => {
      // The one 7D2 seam: the window port is the test's world, the factory is the real one.
      const window = options.batchWindow === true
        ? { isOpen: async () => ({ status: 'ready' as const, value: { open: true, operationRef: null, revision: null } }) }
        : typeof options.batchWindow === 'object' ? options.batchWindow : undefined;
      const withWindow = window === undefined ? deps : { ...deps, proposalBatchWindow: window };
      const real = realCreateProposal(withWindow);
      const realPropose = real.proposeArchitectureRevision.bind(real);
      const realApply = real.applyArchitectureProposalBatch.bind(real);
      captured.service = { ...real,
        proposeArchitectureRevision: (callCtx, callInput) => {
          lastPropose = { ctx: callCtx, input: callInput };
          return realPropose(callCtx, callInput);
        },
        applyArchitectureProposalBatch: async (callCtx, callInput) => {
          const result = await realApply(callCtx, callInput);
          lastApply = result;
          return result;
        } };
      return captured.service;
    });
    const realObserve = commitObserverModule.observeRecordCommits;
    observerSpy = vi.spyOn(commitObserverModule, 'observeRecordCommits').mockImplementation(async (backend, observer) => {
      if (observer === undefined) return realObserve(backend, observer);
      return realObserve(backend, {
        started: head => observer.started(head),
        committed: notice => {
          observer.committed(notice);
          if (notice.aggregates.some(aggregate => aggregate.aggregateType === 'ArchitectureProposal')) {
            commits.count += 1;
          }
        },
      });
    });
    staff = await openS7C1World({
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      ...(options.roleSpecLine === true ? { extraBindings: [roleSpecAdviserExtra()] } : {}),
      configure: (configuration) => {
        const binding = configuration.bindings.find(candidate => candidate.id === 's7c-adviser-binding');
        if (binding === undefined) throw new Error('S8C proposal world: the adviser binding is missing');
        binding.grant = { ...binding.grant, platformDuty: 'adviser',
          tools: [...(binding.grant.tools ?? []), PROPOSE_TOOL] };
        const executor = configuration.bindings.find(candidate => candidate.id === 's7c-executor-binding');
        if (executor === undefined) throw new Error('S8C proposal world: the executor binding is missing');
        executor.grant = { ...executor.grant, tools: [...(executor.grant.tools ?? []), PROPOSE_TOOL] };
      },
    });
  } finally {
    proposalSpy?.mockRestore();
    observerSpy?.mockRestore();
  }
  if (staff === undefined) throw new Error('S8C proposal world: the staff world did not open');
  const owner = captured.service;
  if (owner === null) throw new Error('S8C proposal world: the composition did not build the proposal owner');
  try {
    const platform = staff.world.platform;
    const ctx = staff.world.humanContext();
    const scope: WorkspaceScope = { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId };
    const roleSpecLine = options.roleSpecLine === true
      ? await openRoleSpecAdviserLine(platform, ctx, staff) : null;
    // The executor source relations for the move variants: two real executor lines, one each.
    const coreLink = await linkExecutor(platform, ctx, staff.lines.noCreate.ref, 's6a-core',
      's8c-proposal-link-core');
    const uiLink = await linkExecutor(platform, ctx, staff.lines.fixed.ref, 's6a-ui',
      's8c-proposal-link-ui');
    // A real destination module for the duplicate-owner variant: one public catalog revision.
    let revision = 0;
    const revise = async (ops: unknown[], responsibilityMoves: unknown[] = []) => {
      revision += 1;
      const read = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
      const expected = { catalogRef: read.catalog!.ref,
        baseline: { ref: read.baseline.ref, digest: read.baseline.contentDigest } };
      const pins = await scopePins(platform, ctx, scope);
      const result = committed(await platform.architecture.reviseArchitectureCatalog(ctx, {
        meta: { requestId: `s8c-proposal-revise-${revision}`, expected: pins },
        input: { expected, ops: ops as never, responsibilityMoves: responsibilityMoves as never,
          reason: 'S8C proposal world revision' },
      }));
      const after = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
      return { revision: after.catalog!.ref.revision, pin: { catalogRef: after.catalog!.ref,
        baseline: { ref: after.baseline.ref, digest: after.baseline.contentDigest } } };
    };
    await revise([{ op: 'add_module', module: moduleOf('s6a-dest', ['src/dest']) }]);
    const destLink = await linkExecutor(platform, ctx, staff.lines.work.ref, 's6a-dest',
      's8c-proposal-link-dest');
    const pin = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
    const basePin: ArchitectureCatalogPinV1 = { catalogRef: pin.catalog!.ref,
      baseline: { ref: pin.baseline.ref, digest: pin.baseline.contentDigest } };

    let runs = 0;
    async function proposeOn(line: S6ASession, role: RoleConfigurationRef, roleId: string,
      calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
        responsibilityMoves?: unknown[]; reason: string }[]):
      Promise<Array<{ result: ProposalResult; toolStatus: string }>> {
      const plan = await staff!.main.activePlan(staff!.goal);
      if (plan === null) throw new Error('S8C proposal world: the Goal has no active Plan');
      runs += 1;
      const taskId = `s8c-proposal-tool-${runs}`;
      const task = { taskId, title: `S8C proposal tool ${runs}`, requirementLevel: 'required' as const,
        taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
        scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const };
      const draft = draftFrom(plan, `s8c-proposal-plan-${runs}`, planDraft => ({ ...planDraft,
        tasks: [...planDraft.tasks, task],
        assignments: [...(planDraft.assignments ?? []),
          { taskId, role: (role as { templateId?: string }).templateId ?? roleId, instruction: 'S8C proposal tool line' }],
        obligations: planDraft.obligations.map(obligation => ({ ...obligation,
          taskIds: [...obligation.taskIds, taskId] })) }));
      const proposed = valueOf<{ ref: unknown; revision: number }>(await staff!.main.post('plans/propose',
        graphWrite(S6A_SCOPE, { goalRef: staff!.goal, basedOn: plan.ref, draft,
          reason: { text: `S8C proposal plan ${runs}`, sources: [] } }, `s8c-proposal-plan-${runs}`)),
      'committed', 'the proposal Plan proposal');
      valueOf(await staff!.main.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] },
      `s8c-proposal-plan-apply-${runs}`)), 'committed', 'the proposal Plan adoption');
      const scripted: ToolCallScript[] = calls.map((call, index) => ({ callId: `s8c-proposal-call-${runs}-${index}`,
        name: PROPOSE_TOOL, args: {
          baseCatalogPin: call.baseCatalogPin,
          ops: call.ops as never,
          responsibilityMoves: call.responsibilityMoves ?? [],
          reason: call.reason,
        } }));
      await staff!.world.scripted.script(line, [
        { kind: 'calls', calls: scripted as never },
        { kind: 'text', text: `S8C proposal answer ${runs}` },
      ]);
      const claimInput = await advanceUntil(staff!.world.ag2b, { schemaVersion: 1, goalRef: staff!.goal,
        flowId: `s8c-proposal-${runs}`, sessionHint: line.ref, kind: 'select_work', taskId },
      'claim_task');
      const receipts: unknown[] = [];
      await driveWorkflow(staff!.world.ag2b, claimInput, { stopBefore: 'open_checks', receipts: receipts as never });
      const requests = await staff!.world.scripted.requests(line);
      return calls.map((_call, index) => {
        const callId = `s8c-proposal-call-${runs}-${index}`;
        const delivered = requests.flatMap(request => request.messages)
          .find(message => message.role === 'tool' && message.callId === callId);
        return {
          result: jsonOf(requests, callId) as ProposalResult,
          toolStatus: delivered?.role === 'tool' ? delivered.result.status : 'not_delivered',
        };
      });
    }
    const proposeWithStatus = (calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
      responsibilityMoves?: unknown[]; reason: string }[]) => proposeOn(staff!.lines.adviser!,
      platformRoleProfile('adviser').template as RoleConfigurationRef, 'adviser', calls);
    const proposeAsExecutorWithStatus = (calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
      responsibilityMoves?: unknown[]; reason: string }[]) => proposeOn(staff!.lines.noCreate,
      platformRoleProfile('executor').template as RoleConfigurationRef, 'executor', calls);
    const propose = async (calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
      responsibilityMoves?: unknown[]; reason: string }[]) =>
      (await proposeWithStatus(calls)).map(outcome => outcome.result);
    const proposeAsExecutor = async (calls: readonly { baseCatalogPin: ArchitectureCatalogPinV1; ops: unknown[];
      responsibilityMoves?: unknown[]; reason: string }[]) =>
      (await proposeAsExecutorWithStatus(calls)).map(outcome => outcome.result);

    return {
      staff, platform, scope, projectId: scope.projectId, pin: basePin,
      proposeWithStatus, proposeAsExecutorWithStatus,
      sourceLinks: [], executorLinks: { core: coreLink, ui: uiLink, dest: destLink },
      propose,
      proposeAsExecutor,
      proposeAsRoleSpec: (calls) => {
        if (roleSpecLine === null) throw new Error('S8C proposal world: the world has no role_spec adviser line');
        return proposeOn(roleSpecLine, ROLE_SPEC_ADVISER_ROLE, ROLE_SPEC_ADVISER_ID, calls)
          .then(outcomes => outcomes.map(outcome => outcome.result));
      },
      freezeAttempt: (freezePin, refs) => owner.freezeArchitectureProposalBatch(ctx,
        { baseCatalogPin: freezePin, proposalRefs: [...refs] }),
      replayPropose: async () => {
        if (lastPropose === null) throw new Error('S8C proposal world: no proposal call to replay');
        return owner.proposeArchitectureRevision(lastPropose.ctx, lastPropose.input);
      },
      apply: (batchRef, answerRef) => owner.applyArchitectureProposalBatch(ctx,
        { batchRef, answerMessageRef: answerRef }) as Promise<ApplyBatchResult<unknown>>,
      read: async ref => ready(await platform.readArchitectureProposal(ctx, { proposalRef: ref })),
      card: async source => ready(await platform.decisions.readDecisionCard(ctx, { source })),
      proposalCardCount: async () => {
        const queue = ready(await platform.decisions.queryDecisionQueue(ctx, { workspace: scope,
          sections: ['waiting_answer', 'answered_pending_application', 'history', 'notices'],
          page: { limit: 200 } }));
        return [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
          .filter(card => card.source.kind === 'structural_proposal').length;
      },
      cardByKey: async cardKey => {
        const queue = ready(await platform.decisions.queryDecisionQueue(ctx, { workspace: scope,
          sections: ['waiting_answer', 'answered_pending_application', 'history', 'notices'],
          page: { limit: 200 } }));
        const card = [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
          .find(candidate => candidate.cardKey === cardKey);
        if (card === undefined) throw new Error(`S8C proposal world: no card ${cardKey} in the queue`);
        return card;
      },
      cardBySource: async source => ready(await platform.decisions.readDecisionCard(ctx, { source })),
      answer: async (card, optionId, requestId, annotations = []) => {
        const selection = { kind: 'option' as const, optionId };
        const body = await staff!.main.post('decisions/answer', graphWrite(S6A_SCOPE, {
          source: card.source, selection, text: '', annotations: [...annotations],
        }, requestId, [...card.source.pins]));
        return ready<ResolveDecisionReadV1>(body as ReadResult<ResolveDecisionReadV1>);
      },
      readAnswer: async source => platform.decisionMessages.readDecisionAnswer(ctx, { source }),
      lastApply: () => lastApply,
      revise,
      proposalCommits: () => commits.count,
      resetProposalCommits: () => { commits.count = 0; },
      readCatalog: async () => {
        const read = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
        return { revision: read.catalog!.ref.revision, modules: read.catalog!.catalog.modules };
      },
      currentPin: async () => {
        const read = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
        return { catalogRef: read.catalog!.ref,
          baseline: { ref: read.baseline.ref, digest: read.baseline.contentDigest } };
      },
      close: async () => {
        await staff!.close();
      },
    };
  } catch (error) {
    if (staff !== undefined) await staff.close().catch(() => undefined);
    throw error;
  }
}

async function scopePins(platform: Platform, ctx: CoreCallContext, scope: WorkspaceScope): Promise<VersionPin[]> {
  const read = ready(await platform.projects.readWorkspaceRegistration(ctx, scope));
  return [{ ref: read.project.ref, revision: read.project.revision },
    { ref: read.workspace.ref, revision: read.workspace.revision }];
}
