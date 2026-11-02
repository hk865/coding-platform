/**
 * FX-7C1-01, the shared S7C world: one real Host with the full configuration at open time, a Goal with an adopted
 * three-task module Plan, the duty lines, the first task's real claim, one input message and one ended Query.
 * Only public steps are used (routes, governance, lines, Workflow, messages, Query); no store read and no record.
 * The first task is driven to a real claim; a start that stops on the missing bwrap keeps that claim (started: false).
 * The member service is part C's factory over the real records/identity/session/line/request/duty/secretary-run ports.
 * Callers close their own instance; this file closes only when setup fails.
 */
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import * as hostModule from '../../src/app/host.js';
import * as memoryStore from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteStore from '../../src/core/record-store/sqlite-record-store.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RecordCommitIdentityPort, StoreResult } from '../../src/core/record-store/ports.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RawArtifactRecord } from '../../src/core/record-store/body-ports.js';
import * as runtimeConfigurationModule from '../../src/app/runtime-configuration.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { createMemberService, type MemberServiceV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { createSecretaryQueryRun } from '../../src/core/work-graph/tasks/secretary-query-run.js';
import { createDutyRecipient } from '../../src/core/work-graph/sessions/duty-recipient.js';
import { createLineCreation } from '../../src/business/workflow/line-creation.js';
import { createSessionChooser } from '../../src/business/workflow/session-chooser.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { advanceUntil, driveWorkflow, readExecution, readQuery } from './A2-restart-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AHostWorldOptions, type S6AToolCall } from './S6A-host-fixture.js';
import {
  S6A_AT, S6A_SCRIBE_ROLE, S6A_SCOPE,
  type S6ABackend, type S6ASession,
} from './S6A-request-fixture.js';
import { createS6BLine, governS6B, holdS6BRequestRound, type S6BHeldRound } from './S6B1-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { sessionOf } from './S7A-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';

const ADVISER_ROLE = platformRoleProfile('adviser').template;
const EXECUTOR_ROLE = platformRoleProfile('executor').template;
type LegacyRole = Extract<RoleConfigurationRef, { kind: 'legacy_template' }>;
/** The creator line: writeScope [] and createMember true, a distinct Role so the executor Role can differ. */
const CREATOR_ROLE: LegacyRole = { kind: 'legacy_template', templateId: 's7c-creator', templateRevision: '1' };
/** The service's executorRole: writeScope ['.'] and createMember true; distinct from the no-create executor. */
export const S7C1_CREATE_ROLE: LegacyRole = { kind: 'legacy_template', templateId: 's7c-executor', templateRevision: '1' };
const CREATE_ROLE = S7C1_CREATE_ROLE;
const MEMBER_TOOL_NAMES = ['create_member', 'request_rework', 'request_recheck', 'withdraw_session_message'] as const;

/** The `openConsumeHostWorld` wrapper: mutate the configuration before the real factory, restore on every path. */
const HOST_FACTORY = hostModule.createLocalWorkbenchHost;
let configuredWorkflow: WorkflowHostConfiguration | undefined;

/**
 * L1-14 (M-admission): the test-owned Host grant flag. The fixture reads it on every runtime resolution, so a test
 * can model the Host narrowing its grant after a real preparation without touching the live Host's state; the
 * configuration revision never changes (the same shape K3-19's read-only narrowing uses).
 */
export type S7C1HostGrant = { createMember: boolean };

const BINDINGS_FACTORY = runtimeConfigurationModule.createWorkbenchRuntimeHostBindings;

function narrowedBindingsFactory(original: typeof BINDINGS_FACTORY,
  grant: S7C1HostGrant): typeof BINDINGS_FACTORY {
  return (configuration, dependencies, narrowing) => {
    const base = original(configuration, dependencies, narrowing);
    const narrowed = (result: Awaited<ReturnType<RuntimeHostBindings['resolveConfiguration']>>) =>
      grant.createMember || result.status !== 'ready'
        ? result : { ...result, value: { ...result.value, createMember: false } };
    return {
      ...base,
      async resolveConfiguration(ctx, input) { return narrowed(await base.resolveConfiguration(ctx, input)); },
      ...(base.resolveQueryConfiguration === undefined ? {} : { async resolveQueryConfiguration(ctx, input) {
        return narrowed(await base.resolveQueryConfiguration!(ctx, input)); } }),
      ...(base.resolveRoleConfiguration === undefined ? {} : { async resolveRoleConfiguration(ctx, input) {
        return narrowed(await base.resolveRoleConfiguration!(ctx, input)); } }),
    };
  };
}

function configuredHostFactory(original: typeof HOST_FACTORY,
  hostGrant: S7C1HostGrant | undefined): typeof HOST_FACTORY {
  return async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    const work = configuration?.bindings.find(binding => binding.id === 's6a-work-binding');
    const template = hostOptions.workflow?.bindings[0];
    if (configuration === undefined || work === undefined || template === undefined) {
      throw new Error('S7C: the Host was opened without its work builder binding or Workflow template');
    }
    // The creator line: writeScope [] and createMember true; only already-registered tools.
    work.role = structuredClone(CREATOR_ROLE);
    work.grant = { ...work.grant, createMember: true, tools: ['read', 'create_member'],
      hostTemplate: { templateId: CREATOR_ROLE.templateId, revision: CREATOR_ROLE.templateRevision,
        digest: work.grant.hostTemplate!.digest } };
    const workflowBindings = [...hostOptions.workflow!.bindings];
    workflowBindings[0] = { ...template, sessionRole: structuredClone(CREATOR_ROLE),
      roleBinding: { ...template.roleBinding, bindingId: 's6a-work-binding', templateId: CREATOR_ROLE.templateId,
        templateRevision: CREATOR_ROLE.templateRevision } };
    const addBinding = (id: string, role: LegacyRole, instruction: string,
      grant: Partial<WorkbenchRuntimeBinding['grant']>) => {
      const binding = structuredClone(work);
      binding.id = id; binding.label = `S7C ${id}`; binding.role = structuredClone(role); binding.configurationRevision = `${id}@1`;
      binding.model = { ...binding.model, revision: `${id}-model@1`, model: `s7c-scripted-${id}` };
      binding.grant = { ...binding.grant, ...grant,
        hostTemplate: { templateId: role.templateId, revision: role.templateRevision, digest: binding.grant.hostTemplate!.digest },
        systemInstruction: instruction };
      configuration.bindings.push(binding);
      workflowBindings.push({ ...structuredClone(template), sessionRole: structuredClone(role),
        roleBinding: { ...template.roleBinding, bindingId: id, templateId: role.templateId, templateRevision: role.templateRevision } });
    };
    // The adviser caller carries the four new tool names; it starts no Run here (L1's tool-bearing Run).
    addBinding('s7c-adviser-binding', ADVISER_ROLE, 'S7C trusted adviser guidance', { createMember: true,
      tools: [...MEMBER_TOOL_NAMES] });
    // The service's executorRole: createMember true and writeScope ['.'], so a Work child's ['.'] is outside the [] ceiling.
    addBinding('s7c-create-binding', CREATE_ROLE, 'S7C trusted creator-ceiling executor guidance', { createMember: true,
      tools: ['read'], writeScope: ['.'] });
    // The no-create executor for M-admission: the same scope, no createMember grant.
    addBinding('s7c-executor-binding', EXECUTOR_ROLE, 'S7C trusted module executor guidance', { tools: ['read'],
      writeScope: ['.'] });
    hostOptions.workflow = { ...hostOptions.workflow!, bindings: workflowBindings };
    configuredWorkflow = hostOptions.workflow;
    const noCreate = configuration.bindings.find(binding => binding.id === 's7c-executor-binding')!;
    const { createMember: _absent, ...grant } = noCreate.grant;
    noCreate.grant = grant;
    if (hostGrant === undefined) return await original(hostOptions);
    const bindings = BINDINGS_FACTORY;
    Object.defineProperty(runtimeConfigurationModule, 'createWorkbenchRuntimeHostBindings', {
      value: narrowedBindingsFactory(bindings, hostGrant), configurable: true, writable: true });
    try { return await original(hostOptions); }
    finally { Object.defineProperty(runtimeConfigurationModule, 'createWorkbenchRuntimeHostBindings',
      { value: bindings, configurable: true, writable: true }); }
  };
}

/** Install one complete-configuration Host factory for one real Host start (open or reopen), then restore it. */
export async function withConfiguredHost<T>(run: () => Promise<T>,
  configure: (original: typeof HOST_FACTORY) => typeof HOST_FACTORY): Promise<T> {
  const original = HOST_FACTORY;
  Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
    { value: configure(original), configurable: true, writable: true });
  try { return await run(); }
  finally { Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
    { value: original, configurable: true, writable: true }); }
}

async function openConfiguredHost(options: S6AHostWorldOptions, hostGrant?: S7C1HostGrant): Promise<S6AHostWorld> {
  return await withConfiguredHost(() => openS6AHostWorld(options),
    original => configuredHostFactory(original, hostGrant));
}

/** The platform publishes `records` only; the same backend's identity port is captured from its factory. */
type CapturedBackend = { commitIdentities: RecordCommitIdentityPort };
let capturedBackend: CapturedBackend | undefined;

function captureBackend<T extends { commitIdentities: RecordCommitIdentityPort }>(backend: T): T {
  capturedBackend = backend;
  return backend;
}

const MEMORY_FACTORY = memoryStore.createInMemoryRecordBackend;
const SQLITE_FACTORY = sqliteStore.createSqliteRecordBackend;

/** The platform builds its backend inside a Host start; capture it for the start the callback runs. */
export async function withS7CCapturedBackend<T>(run: () => Promise<T>): Promise<T> {
  const memorySpy = vi.spyOn(memoryStore, 'createInMemoryRecordBackend')
    .mockImplementation(options => captureBackend(MEMORY_FACTORY(options)));
  const sqliteSpy = vi.spyOn(sqliteStore, 'createSqliteRecordBackend')
    .mockImplementation(options => captureBackend(SQLITE_FACTORY(options)));
  try {
    return await run();
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
}

const recordOf = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};

function moduleDraft(goal: GoalRef): PlanRevisionDraft {
  const draft = ag2bPlanDraft(['s7c-m1', 's7c-m2', 's7c-n1']);
  return {
    ...draft, planId: 's7c-plan', goalId: goal.goalId,
    stages: [{ stageId: 's7c-stage', title: 'S7C stage' }],
    tasks: draft.tasks.map(task => task.taskKind === 'work' ? { ...task, scope: { kind: 'module',
      stageId: 's7c-stage', moduleRef: task.taskId === 's7c-n1' ? 's6a-ui' : 's6a-core' } } : task),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: (assignment.taskId === 's7c-m1' ? CREATOR_ROLE : CREATE_ROLE).templateId,
      instruction: `S7C ${assignment.taskId}` })),
  };
}

export type S7C1World = {
  readonly backend: S6ABackend;
  readonly world: S6AHostWorld;
  readonly main: ReturnType<typeof s6aCardsWorkspace>;
  readonly goal: GoalRef;
  readonly plan: Awaited<ReturnType<ReturnType<typeof s6aCardsWorkspace>['activePlan']>>;
  readonly tasks: readonly { projectId: string; goalId: string; taskId: string }[];
  readonly lines: { module: S6ASession; work: S6ASession; noCreate: S6ASession; adviser: S6ASession | null;
    scribe: S6ASession; fixed: S6ASession };
  readonly secretary: S6ASession;
  /** The first `s6a-core` task's real claim; `started` is false only when the start stopped on the missing bwrap. */
  readonly run: { readonly runRef: RunRef; readonly started: boolean };
  /** The ended Query round (its request and Query read). */
  readonly query: S6BHeldRound['request'];
  readonly queryRead: Awaited<ReturnType<typeof readQuery>>;
  /** Part C's member service over the real Host ports. */
  readonly member: MemberServiceV1;
  /**
   * L1-22: start m1 and hold it at its model request (`firstRun: 'deferred'`); after this the Goal-scope
   * selection skips the running m1 and reaches n1. A no-op for `'held'` (already held) and `'ended'`.
   */
  readonly holdFirst: () => Promise<void>;
  /** A real close and reopen on the same directory, with the same configured bindings. */
  readonly reopen: () => Promise<void>;
  readonly close: () => Promise<void>;
};

function claimOf(receipts: readonly WorkflowStepReceipt[]) {
  const claim = receipts.find(receipt => receipt.kind === 'claim_task');
  if (claim === undefined || claim.result.status !== 'committed') {
    throw new Error('S7C: the first s6a-core task was not claimed');
  }
  return claim.result.value.runRef;
}

/** The answer message both M rows send from the module line. */
export async function answerOf(target: S7C1World, label: string): Promise<SessionMessageRef> {
  const sent = valueOf<{ ref: SessionMessageRef }>((await target.world.post('messages/send',
    graphWrite(S6A_SCOPE, { recipient: target.lines.module.ref, text: `S7C ${label}`, intent: 'notify' },
      `s7c-answer-${label}`))).body, 'committed', `the ${label} answer`);
  return sent.ref;
}

/** The Host-pick card; the optional acknowledgement is the existing request input. */
export async function memberCardOf(target: S7C1World, commandId: string, reason: string,
  acknowledgement?: SessionMessageRef) {
  const result = await target.member.request.requestMember(target.world.humanContext(), {
    commandId, caller: { kind: 'host_pick' }, duty: 'executor',
    scope: { kind: 'task', task: target.tasks[0]! }, reason,
    ...(acknowledgement === undefined ? {} : { acknowledgement }),
  });
  if (result.status !== 'needs_decision') throw new Error(`S7C: no card: ${JSON.stringify(result)}`);
  return result;
}

/** L1-22: the first Task's Run state when the world returns (`ended`: the existing row; the other two hold m1). */
export type S7C1FirstRun = 'ended' | 'held' | 'deferred';

/** One instance per row; `adviser: false` opens without the adviser line (the L1 host-pick row). */
export async function openS7C1World(options: { backend?: S6ABackend; adviser?: boolean; firstRun?: S7C1FirstRun;
  /** L1-14's mutable Host grant; absent keeps the fixture's fixed grants. */ hostGrant?: S7C1HostGrant } = {}): Promise<S7C1World> {
  const backend = options.backend ?? 'memory';
  const adviser = options.adviser ?? true;
  const firstRun = options.firstRun ?? 'ended';
  const world = await withS7CCapturedBackend(() => openConfiguredHost({ backend, scribe: true }, options.hostGrant));
  try {
    world.clock.set(S6A_AT);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = (await main.createGoal('s7c-goal', 'S7C member world')).ref;
    const draft = moduleDraft(goal);
    const proposed = valueOf<{ ref: unknown; revision: number }>(await main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: null, draft, reason: { text: 'S7C module plan', sources: [] },
    }, 's7c-plan-propose')), 'committed', 'the Plan proposal');
    valueOf(await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, 's7c-plan-apply')), 'committed', 'the Plan adoption');
    const plan = await main.activePlan(goal);
    if (plan === null) throw new Error('S7C: the Goal has no adopted Plan');
    const tasks = ['s7c-m1', 's7c-m2', 's7c-n1'].map(taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId }));

    const moduleLine = await sessionOf(world, await createS6BLine(main, {
      label: 's7c-module', role: CREATOR_ROLE, tasks: [tasks[0]!, tasks[1]!] }));
    const workLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-work', role: CREATOR_ROLE }));
    const noCreateLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-no-create', role: EXECUTOR_ROLE }));
    const adviserLine = adviser
      ? await sessionOf(world, await createS6BLine(main, { label: 's7c-adviser', role: ADVISER_ROLE })) : null;
    const scribeLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-scribe', role: S6A_SCRIBE_ROLE }));
    const fixedLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-fixed', role: EXECUTOR_ROLE }));
    const secretary = await world.createSecretary('s7c-secretary');

    world.scripted.script(moduleLine, [{ kind: 'text', text: 'S7C first Work answer' }]);
    const claimInput = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7c-first',
      sessionHint: moduleLine.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    let started = false;
    let deferredStart: WorkflowAdvanceInput | null = null;
    let releaseFirst: (() => Promise<void>) | null = null;
    /** Start the first Run and keep its drive pending at the real model request (the existing holdRun pattern). */
    const holdFirstRun = async (start: WorkflowAdvanceInput): Promise<void> => {
      const gate = await world.gates.modelRequest(moduleLine);
      const drive = driveWorkflow(world.ag2b, start, { stopBefore: 'open_checks', receipts });
      try {
        await Promise.race([gate.reached, drive]);
        started = true;
        releaseFirst = async () => { gate.release(); await drive; };
      } catch (error) {
        gate.release();
        await drive.catch(() => undefined);
        releaseFirst = null;
        if (!/ENOENT|bwrap/.test(String(error))) throw error;
      }
    };
    if (firstRun === 'deferred') {
      // The row claims, starts and holds m1 with `holdFirst` just before its Goal-scope pass; until then the
      // module line stays free, so the row's named pass on m2 can use it.
      deferredStart = claimInput;
    } else if (firstRun === 'held') {
      await holdFirstRun(claimInput);
    } else {
      try {
        await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'open_checks', receipts });
        started = true;
      } catch (error) {
        if (!/ENOENT|bwrap/.test(String(error))) throw error;
      }
    }
    const run = {
      get runRef(): RunRef { return claimOf(receipts); },
      get started(): boolean { return started; },
    };
    const holdFirst = async (): Promise<void> => {
      if (firstRun !== 'deferred') return;
      const start = deferredStart;
      deferredStart = null;
      if (start !== null) await holdFirstRun(start);
    };

    const sent = await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: moduleLine.ref, text: 'S7C input', intent: 'inquiry', needsReply: false,
    }, 's7c-input'));
    if (recordOf(sent.body)['status'] !== 'committed') throw new Error(`S7C: the input message did not commit: ${JSON.stringify(sent)}`);

    const held: { round?: S6BHeldRound['request'] } = {};
    await holdS6BRequestRound(world, { label: 's7c-query', goalId: goal.goalId }, async round => { held.round = round.request; });
    const queryRound = held.round;
    if (queryRound === undefined) throw new Error('S7C: the Query round did not open');
    const queryRead = await readQuery(world.ag2b, queryRound.round);

    const member = createS7C1MemberService(world);

    return { backend, world, main, goal, plan, tasks, secretary, run, query: queryRound, queryRead, member, holdFirst,
      lines: { module: moduleLine, work: workLine, noCreate: noCreateLine, adviser: adviserLine, scribe: scribeLine,
        fixed: fixedLine }, reopen: () => withConfiguredHost(() => world.reopen(),
          original => configuredHostFactory(original, options.hostGrant)),
      close: async () => {
        try {
          if (releaseFirst !== null) await releaseFirst();
        } finally {
          await world.close();
        }
      } };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The member owner over the current Host's real ports. A crash/reopen replaces the Host and its platform, so the
 * recovery row builds a new instance through this factory instead of reusing the instance bound to the old Host.
 */
export function createS7C1MemberService(world: S6AHostWorld): MemberServiceV1 {
  const sessionDuty = createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: configuredWorkflow });
  // The duty resolver is a Host read: a Query caller's context cannot page the Session directory.
  const duty = createDutyRecipient({
    findSessions: (_ctx, input) => world.platform.sessions.findSessions(world.systemContext(), input),
    dutyOfRole: (_ctx, role) => sessionDuty(role, world.systemContext()) });
  const identity = capturedBackend?.commitIdentities;
  if (identity === undefined) throw new Error('S7C: the real backend identity read was not captured');
  const records = world.platform.disconnect.records;
  const bodies = {
    async read(ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>> {
      const read = await world.platform.materials.openArtifact(world.systemContext(), { ref, usage: 'historical_explanation' });
      if (read.status !== 'ready') return { status: 'rejected',
        code: read.status === 'not_found' ? 'not_found' : read.status === 'rejected' && read.code === 'invalid' ? 'invalid' : 'unavailable',
        reason: read.status === 'rejected' ? read.reason : read.status };
      if (read.value.ownerRunRef === undefined || read.value.ownerRunRef === null) {
        return { status: 'rejected', code: 'invalid', reason: 'the Query material names no owner Run' };
      }
      return { status: 'ready', value: { ref: read.value.ref, body: read.value.body, sourceRefs: read.value.sourceRefs,
        origin: { kind: 'run', owner: read.value.ownerRunRef } } };
    },
  };
  const lineCreation = createLineCreation({
    sessions: { createSession: (...args) => world.platform.runtime.createSession(...args) },
    operations: { getSessionOperation: (...args) => world.platform.sessions.getSessionOperation(...args) } });
  // P's one reuse body over the Host's own real owners; the member service consumes the port, never a second filter.
  const reuse = {
    reusable: createSessionChooser({
      sessions: world.platform.sessions,
      sessionFacts: world.platform.sessionFacts,
      responsibilities: world.platform.responsibilities,
    }).reusable,
  };
  return createMemberService({ records, commitIdentities: identity,
    sessions: { findSessions: world.platform.sessions.findSessions },
    lines: { ensureLine: lineCreation.ensureLine }, requests: { ownerOf: world.platform.requestFacts.ownerOf },
    secretaryRuns: createSecretaryQueryRun({ records, duties: sessionDuty, bodies }),
    duties: duty, executions: world.platform.executions,
    // The direct seam names the one explicit Role the M rows exercise; the platform's own member owner
    // resolves the Role through the Task's served binding.
    executorRole: async () => ({ status: 'ready', value: structuredClone(CREATE_ROLE) }),
    reuse, now: world.clock.now, eventId: randomUUID });
}

/** A real tool call of the tool-bearing Work Run (what the Kernel started). */
export type S7C1ToolLine = {
  readonly work: {
    readonly runRef: RunRef;
    readonly execution: Awaited<ReturnType<typeof readExecution>>;
    readonly facts: SessionFactsV1;
    readonly call: S6AToolCall;
  };
  readonly query: {
    readonly request: S6BHeldRound['request'];
    readonly read: Awaited<ReturnType<typeof readQuery>>;
    readonly manifest: PreparedQueryManifestV1;
  };
  /** The task line's saved input message, read through `messages/read`. */
  readonly message: SessionMessage | null;
};

/** The JSON block of the tool result the Runtime served the model for the named call. */
export function jsonOf(requests: readonly ModelRequest[], callId: string): unknown {
  for (const request of requests) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message === undefined || message.role !== 'tool') continue;
    const output = (message.result as { output?: readonly { kind: string; value?: unknown }[] }).output ?? [];
    const block = output.find(candidate => candidate.kind === 'json');
    if (block !== undefined) return block.value;
  }
  throw new Error(`S7C: no model request carries the tool result ${callId}`);
}

/**
 * FX-7C1-02, the tool-bearing caller: a real Work Run on FX-01's adviser caller line (the one
 * binding whose declaration carries the four member/rework tool names) and a real secretary Query
 * round on the goal. It scripts exactly one tool call and returns the refs and the public reads;
 * no configuration is patched after the Host opened. The task the Run names is moved to the adviser
 * binding through the real `plans/propose` + `plans/apply` routes, so the accepted envelope carries
 * the four names; the envelope itself is the Run's, never a test-built one. The added `s7c-tool` task
 * carries the Run on the adviser line; the optional `task` only aims the member request (the tool
 * argument) at an existing adopted-Plan Task.
 */
export async function startS7C1ToolLine(target: S7C1World,
  options: { task?: TaskTriple } = {}): Promise<S7C1ToolLine> {
  const caller = target.lines.adviser;
  if (caller === null) throw new Error('S7C tool line: the world was opened without its adviser caller line');
  const toolTask = { taskId: 's7c-tool', title: 'S7C tool line', requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const };
  const runTask = { projectId: target.goal.projectId, goalId: target.goal.goalId, taskId: toolTask.taskId };
  const requestTask = options.task === undefined ? runTask : structuredClone(options.task);
  const plan = target.plan;
  if (plan === null) throw new Error('S7C tool line: the Goal has no adopted Plan');
  const draft = draftFrom(plan, 's7c-tool-plan', draftPlan => ({ ...draftPlan,
    tasks: [...draftPlan.tasks, toolTask],
    assignments: [...(draftPlan.assignments ?? []),
      { taskId: toolTask.taskId, role: ADVISER_ROLE.templateId, instruction: 'S7C tool line' }],
    obligations: draftPlan.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, toolTask.taskId] })) }));
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: target.goal, basedOn: plan.ref, draft, reason: { text: 'S7C tool line', sources: [] },
  }, 's7c-tool-plan-propose')), 'committed', 'the tool-line Plan proposal');
  valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 's7c-tool-plan-apply')), 'committed', 'the tool-line Plan adoption');

  await target.world.scripted.script(caller, [
    { kind: 'calls', calls: [{ callId: 's7c-tool-call', name: 'create_member', args: {
      duty: 'executor', scope: { kind: 'task', task: requestTask }, reason: 'S7C tool-line member request' } }] },
    { kind: 'text', text: 'S7C tool-line answer' },
  ]);
  const gate = await target.world.gates.toolCall(caller, 'create_member');
  const receipts: WorkflowStepReceipt[] = [];
  const driven = driveWorkflow(target.world.ag2b, { schemaVersion: 1, goalRef: target.goal,
    flowId: 's7c-tool-line', sessionHint: caller.ref, kind: 'select_work', taskId: runTask.taskId },
  { stopBefore: 'open_checks', receipts });
  const call = await gate.reached;
  gate.release();
  await driven;
  const claim = claimOf(receipts);
  const execution = await readExecution(target.world.ag2b, claim);
  const factsRead = await target.world.post('sessions/facts', plain(S6A_SCOPE, caller.ref));
  const facts = valueOf<SessionFactsV1>(factsRead.body, 'ready', 'the caller line facts');
  const inbox = await target.world.post('messages/inbox', plain(S6A_SCOPE, {
    recipient: target.lines.module.ref, page: { limit: 1 } }));
  const page = valueOf<{ items: readonly SessionMessage[] }>(inbox.body, 'ready', 'the task line inbox');
  const message = page.items[0] === undefined ? null
    : valueOf<SessionMessage>((await target.world.post('messages/read', plain(S6A_SCOPE,
      page.items[0].ref))).body, 'ready', 'the task input message');

  const query = await holdS6BRequestRound(target.world, { label: 's7c-tool-query',
    goalId: target.goal.goalId }, async round => ({ request: round.request, read: round.query,
    manifest: round.manifest }));
  return { work: { runRef: claim, execution, facts, call }, query: query.value, message };
}
