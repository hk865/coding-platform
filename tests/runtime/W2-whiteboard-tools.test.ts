/**
 * W2 whiteboard tool-adapter contract (Stage 1 skeleton).
 *
 * The suite never starts a model and never mocks the tool: it builds the REAL
 * `createWhiteboardTools` handle against a recording `PlanTaskPort` and executes
 * the production handlers directly with trusted Kernel-shaped `ToolCall`s. It
 * records the exact accepted call so the adapter boundary is observed, not
 * assumed. These cases prove the ADAPTER contract only; they do not claim the
 * formal Plan production wiring exists.
 *
 * The phase-1 handler deliberately does NOT call the port and returns a typed
 * `execution_failed`/unsupported rejection. Schema, unknown-permission-field,
 * callId-identity, fixed-scope, effect-class and pre-commit cancellation cases
 * are GREEN; any case that needs the real plan read/write (typed result, port
 * recording, post-commit late cancel, snapshot-across-await) is RED for exactly
 * that explicit reason and is frozen for the implementation phase.
 */
import { describe, expect, it } from 'vitest';
import { createWhiteboardTools, WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlanProposal, PlanProposalRef, PlanTaskPort, TaskGraph } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { ToolCall, ToolDefinition, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const PROJECT_ID = 'w2-tool-project';
const WORKSPACE_ID = 'w2-tool-workspace';
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'w2-goal' };
const RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_REF.goalId, runId: 'w2-run' };
const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'w2-binding', templateId: 'w2-template',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'w2-policy',
};
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: 'w2-plan' };
const PROPOSAL_REF: PlanProposalRef = {
  aggregateType: 'PlanProposal', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, proposalId: 'w2-proposal',
};

const signal = () => new AbortController().signal;
const cursor = (n: number): CommitCursor => `c${String(n).padStart(10, '0')}` as CommitCursor;

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}

function trustedContext(signalValue: AbortSignal): CoreCallContext {
  return {
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    principal: { kind: 'work_run', runRef: structuredClone(RUN_REF), roleBinding: structuredClone(ROLE_BINDING) },
    materialReader: { kind: 'run', requester: structuredClone(RUN_REF) },
    signal: signalValue,
  };
}

function proposeArgs(): Record<string, unknown> {
  return {
    basedOn: { ...PLAN_REF },
    draft: structuredClone(DRAFT),
    reason: { text: 'split the remaining future task', sources: [] },
    expected: [],
  };
}
function applyArgs(): Record<string, unknown> {
  return { proposalRef: { ...PROPOSAL_REF }, expectedProposalRevision: 1, expected: [] };
}

/** Recording PlanTaskPort: the adapter must reach this SAME port in phase 2. */
type Recorded = {
  queryGoal: Array<{ ctx: CoreCallContext; ref: GoalRef }>;
  queryTaskGraph: Array<{ ctx: CoreCallContext; input: unknown }>;
  queryReadyTasks: Array<{ ctx: CoreCallContext; input: unknown }>;
  proposePlan: Array<{ ctx: CoreCallContext; request: unknown }>;
  applyPlanChange: Array<{ ctx: CoreCallContext; request: unknown }>;
};

const DRAFT: PlanRevisionDraft = {
  schemaVersion: 2, planId: 'w2-next-plan', planRevision: 2, goalId: GOAL_REF.goalId,
  stages: [], tasks: [
    { taskId: 'future', title: 'future work', taskKind: 'work', requirementLevel: 'required',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'gate', title: 'required check', taskKind: 'gate', requirementLevel: 'required',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ], assignments: [{ taskId: 'future', role: 'builder', instruction: 'Implement the remaining work' }],
  obligations: [{ obligationId: 'delivery', title: 'delivery', requirementLevel: 'required',
    taskIds: ['future', 'gate'], verificationRequirements: [{ requirementId: 'test',
      requirementLevel: 'required', kind: 'test', description: 'Validate the delivery' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  taskRelations: [{ fromTaskId: 'future', toTaskId: 'gate', kind: 'coordination', note: 'advisory only' }],
  inputRequirements: [{ requirementId: 'source', consumerTaskId: 'future', kind: 'artifact', artifactRef: {
    kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 4,
    source: { kind: 'workspace', refId: WORKSPACE_ID, revision: '1' },
  } }],
};
const PROPOSAL: PlanProposal = { kind: 'candidate_v2', ref: PROPOSAL_REF, revision: 1,
  schemaVersion: 2, goalRef: GOAL_REF, basedOn: PLAN_REF, draft: DRAFT,
  reason: { text: 'split the remaining future task', sources: [] }, status: 'candidate', issues: [] };
const PLAN: PlanRevisionSnapshot = { ...DRAFT, ref: { ...PLAN_REF, planId: DRAFT.planId },
  revision: 1, goalRef: GOAL_REF, acceptedAt: '2026-09-26T00:00:00.000Z',
  effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT_ID,
    policyId: 'policy', revision: 1 }, digest: 'b'.repeat(64) },
  effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT_ID,
    baselineId: 'architecture', revision: 1 }, digest: 'c'.repeat(64) },
};
const TASK_GRAPH: TaskGraph = { plan: PLAN, tasks: [], sourceCursor: cursor(1) };

function recordingPlans(): { plans: PlanTaskPort; recorded: Recorded } {
  const recorded: Recorded = {
    queryGoal: [], queryTaskGraph: [], queryReadyTasks: [], proposePlan: [], applyPlanChange: [],
  };
  const plans: PlanTaskPort = {
    async queryGoal(ctx, ref) { recorded.queryGoal.push({ ctx, ref }); return { status: 'not_found' }; },
    async readPlanProposal() { return { status: 'ready', value: PROPOSAL }; },
    async proposePlan(ctx, request) {
      recorded.proposePlan.push({ ctx, request });
      return { status: 'committed', value: PROPOSAL, replayed: false, cursor: cursor(1) };
    },
    async applyPlanChange(ctx, request) {
      recorded.applyPlanChange.push({ ctx, request });
      return { status: 'committed', value: PLAN, replayed: false, cursor: cursor(2) };
    },
    async queryTaskGraph(ctx, input) {
      recorded.queryTaskGraph.push({ ctx, input });
      return { status: 'ready', value: TASK_GRAPH };
    },
    async queryReadyTasks(ctx, input) {
      recorded.queryReadyTasks.push({ ctx, input });
      return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: cursor(3) } };
    },
    async readTaskInput() { return { status: 'not_found' }; },
  };
  return { plans, recorded };
}

function buildTools(options: {
  plans?: PlanTaskPort;
  context?: CoreCallContext;
  requestIdForCall?: (call: Readonly<ToolCall>) => string;
} = {}) {
  const recording = recordingPlans();
  const requestIds: string[] = [];
  const handle = createWhiteboardTools({
    plans: options.plans ?? recording.plans,
    context: options.context ?? trustedContext(signal()),
    goalRef: GOAL_REF,
    requestIdForCall: options.requestIdForCall ?? (call => {
      requestIds.push(call.callId);
      return `w2:${GOAL_REF.goalId}:${call.name}:${call.callId}`;
    }),
  });
  const definitions = handle.create(null as unknown as WorkspaceSandbox);
  const byName = (name: string): ToolDefinition => {
    const definition = definitions.find(candidate => candidate.name === name);
    if (definition === undefined) throw new Error(`missing tool ${name}`);
    return definition;
  };
  return { handle, definitions, byName, recorded: recording.recorded, plans: recording.plans, requestIds };
}

function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}

describe('W2 whiteboard tool adapter', () => {
  it('publishes exactly the four frozen names with read_only reads and non-file platform writes', () => {
    const { handle, definitions, byName } = buildTools();
    expect(handle.names).toEqual([...WHITEBOARD_TOOL_NAMES]);
    expect(definitions.map(definition => definition.name)).toEqual([...WHITEBOARD_TOOL_NAMES]);
    for (const name of ['query_task_graph', 'query_ready_tasks']) {
      expect(byName(name).effectClass).toBe('read_only');
      expect(byName(name).independentReadOnly).toBe(true);
    }
    for (const name of ['propose_future_plan', 'apply_future_plan']) {
      expect(byName(name).effectClass).not.toBe('read_only');
      expect(byName(name).independentReadOnly).toBe(false);
    }
  });

  it('rejects every forbidden identity/permission/authority field instead of ignoring it', async () => {
    const { byName, recorded } = buildTools();
    const bases: Record<string, Record<string, unknown>> = {
      query_task_graph: {},
      query_ready_tasks: { includeBlocked: false, page: { limit: 10 } },
      propose_future_plan: proposeArgs(),
      apply_future_plan: applyArgs(),
    };
    const forbidden: Record<string, unknown>[] = [
      { principal: { kind: 'host', actor: { kind: 'human', id: 'x' } } },
      { runRef: RUN_REF },
      { roleBinding: ROLE_BINDING },
      { goalRef: GOAL_REF },
      { workspaceId: WORKSPACE_ID },
      { generation: 1 },
      { grant: 'forged-grant' },
      { configurationRevision: 'forged-revision' },
      { author: 'forged-author' },
      { requestId: 'forged-request' },
      { context: { projectId: PROJECT_ID } },
      { permissions: [] },
      { sender: { kind: 'host', actor: { kind: 'human', id: 'x' } } },
    ];
    for (const name of WHITEBOARD_TOOL_NAMES) {
      for (const extra of forbidden) {
        const result = await byName(name).handler.execute(
          toolCall(name, `call-${name}`, { ...bases[name], ...extra }), { signal: signal() });
        expect(result, `${name} accepted ${Object.keys(extra)[0]}`)
          .toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
      }
    }
    // Query tools additionally must not accept a caller version pin, and writes
    // must not accept Agent provenance/decision fields the Host derives.
    for (const name of ['query_task_graph', 'query_ready_tasks']) {
      const result = await byName(name).handler.execute(
        toolCall(name, `call-${name}-pin`, { ...bases[name], expected: [] }), { signal: signal() });
      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    for (const extra of [{ submittedBy: {} }, { provenance: {} }, { decisionRefs: [] }, { actor: RUN_REF }]) {
      const result = await byName('apply_future_plan').handler.execute(
        toolCall('apply_future_plan', 'call-apply-forbidden', { ...applyArgs(), ...extra }), { signal: signal() });
      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    // A nested unknown field inside a caller pin must be rejected too...
    for (const name of ['propose_future_plan', 'apply_future_plan']) {
      const nested = await byName(name).handler.execute(
        toolCall(name, `call-${name}-nested`, {
          ...bases[name],
          expected: [{ ref: { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: GOAL_REF.goalId, permissions: [] }, revision: 1 }],
        }), { signal: signal() });
      expect(nested, `${name} accepted a nested permission field`)
        .toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    // A rejected argument never reaches the domain port.
    expect(recorded.queryTaskGraph).toHaveLength(0);
    expect(recorded.queryReadyTasks).toHaveLength(0);
    expect(recorded.proposePlan).toHaveLength(0);
    expect(recorded.applyPlanChange).toHaveLength(0);
  });

  it('derives one trusted requestId from the real callId, is stable on retry and never signs an empty call', async () => {
    const { byName, requestIds, recorded } = buildTools();
    const definition = byName('query_task_graph');
    await definition.handler.execute(toolCall('query_task_graph', 'call-a', {}), { signal: signal() });
    await definition.handler.execute(toolCall('query_task_graph', 'call-a', {}), { signal: signal() });
    await definition.handler.execute(toolCall('query_task_graph', 'call-b', {}), { signal: signal() });
    expect(requestIds).toEqual(['call-a', 'call-a', 'call-b']);
    // Two different real calls are never collapsed by hashing their arguments.
    expect(new Set(requestIds).size).toBe(2);

    const beforeEmpty = recorded.queryTaskGraph.length;
    const empty = await definition.handler.execute(toolCall('query_task_graph', '', {}), { signal: signal() });
    expect(empty).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    expect(recorded.queryTaskGraph).toHaveLength(beforeEmpty);
  });

  // ---- RED cases: they need the real PlanTaskPort forwarding (phase 2). ----

  it('accepts the actual v2 draft and all five W1 pin shapes without dropping nested fields', async () => {
    const { byName, recorded } = buildTools();
    const pins: VersionPin[] = [
      { ref: { aggregateType: 'Project', projectId: PROJECT_ID }, revision: 1 },
      { ref: { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }, revision: 1 },
      { ref: GOAL_REF, revision: 2 }, { ref: PLAN_REF, revision: 1 }, { ref: PROPOSAL_REF, revision: 1 },
    ];
    expect(byName('propose_future_plan').inputSchema.safeParse({ ...proposeArgs(), expected: pins }).success).toBe(true);
    const result = await byName('propose_future_plan').handler.execute(
      toolCall('propose_future_plan', 'full-v2', { ...proposeArgs(), expected: pins }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(recorded.proposePlan[0]?.request).toMatchObject({ input: { draft: DRAFT }, meta: { expected: pins } });
  });

  it('freezes trusted context at factory time and forwards the exact Kernel AbortSignal', async () => {
    const ctx = trustedContext(signal()); const controller = new AbortController();
    const { byName, recorded } = buildTools({ context: ctx });
    ctx.projectId = 'mutated-project'; ctx.workspaceId = 'mutated-workspace';
    if (ctx.principal.kind === 'work_run') ctx.principal.runRef.runId = 'mutated-run';
    const result = await byName('query_task_graph').handler.execute(
      toolCall('query_task_graph', 'context-snapshot', {}), { signal: controller.signal });
    expect(result.status).toBe('success');
    const forwarded = recorded.queryTaskGraph[0]?.ctx;
    expect(forwarded).toMatchObject({ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      principal: { kind: 'work_run', runRef: RUN_REF } });
    expect(forwarded?.signal).toBe(controller.signal);
    controller.abort(); expect(forwarded?.signal.aborted).toBe(true);
  });

  it('preserves full typed conflict and read not_ready results instead of losing retry pins', async () => {
    const recording = recordingPlans();
    const conflict = { status: 'rejected' as const, code: 'revision_conflict' as const,
      reason: 'the goal changed', current: [{ ref: GOAL_REF, revision: 9 }] };
    const notReady = { status: 'not_ready' as const, observed: { kind: 'platform' as const, cursor: cursor(3) },
      required: { kind: 'platform' as const, cursor: cursor(5) } };
    const { byName } = buildTools({ plans: { ...recording.plans,
      async proposePlan() { return conflict; }, async queryTaskGraph() { return notReady; } } });
    const write = await byName('propose_future_plan').handler.execute(
      toolCall('propose_future_plan', 'typed-conflict', proposeArgs()), { signal: signal() });
    expect(write.status).toBe('error'); expect(outputValue(write)).toEqual(conflict);
    const read = await byName('query_task_graph').handler.execute(
      toolCall('query_task_graph', 'typed-not-ready', {}), { signal: signal() });
    expect(outputValue(read)).toEqual(notReady);
  });

  it('sends the fixed trusted Goal and the real callId requestId to one PlanTaskPort read (RED)', async () => {
    const { byName, recorded, requestIds } = buildTools();
    const args: Record<string, unknown> = { planRef: { ...PLAN_REF } };
    const result = await byName('query_task_graph').handler.execute(
      toolCall('query_task_graph', 'call-fixed', args), { signal: signal() });
    expect(result).toMatchObject({ status: 'success' });
    expect(outputValue(result)).toEqual({ status: 'ready', value: TASK_GRAPH });
    expect(recorded.queryTaskGraph).toHaveLength(1);
    expect(recorded.queryTaskGraph[0]?.input).toEqual({ goalRef: GOAL_REF, planRef: PLAN_REF });
    expect(recorded.queryTaskGraph[0]?.ctx.projectId).toBe(PROJECT_ID);
    expect(recorded.queryTaskGraph[0]?.ctx.workspaceId).toBe(WORKSPACE_ID);
    expect(requestIds).toContain('call-fixed');
  });

  it('snapshots accepted arguments before the first await; later mutation never changes the forwarded request (RED)', async () => {
    const { byName, recorded } = buildTools();
    const args = proposeArgs();
    const pending = byName('propose_future_plan').handler.execute(
      toolCall('propose_future_plan', 'call-snapshot', args), { signal: signal() });
    // Mutate the caller's object after the call started but before the adapter awaits.
    (args['reason'] as Record<string, unknown>)['text'] = 'mutated after acceptance';
    (args['draft'] as PlanRevisionDraft).tasks[0]!.title = 'mutated nested task after acceptance';
    args['expected'] = [{ ref: GOAL_REF, revision: 999 }];
    await pending;
    expect(recorded.proposePlan).toHaveLength(1);
    const request = recorded.proposePlan[0]?.request as { input: { draft: PlanRevisionDraft; reason: { text: string } }; meta: { expected: unknown[] } };
    expect(request.input.reason.text).toBe('split the remaining future task');
    expect(request.input.draft).toEqual(DRAFT);
    expect(request.meta.expected).toEqual([]);
  });

  it('forwards propose/apply to the same W1 service with the trusted requestId and returns the real receipt (RED)', async () => {
    const { byName, recorded } = buildTools();
    const propose = await byName('propose_future_plan').handler.execute(
      toolCall('propose_future_plan', 'call-propose', proposeArgs()), { signal: signal() });
    expect(propose).toMatchObject({ status: 'success' });
    expect(outputValue(propose)).toEqual({ status: 'committed', value: PROPOSAL, replayed: false, cursor: cursor(1) });
    expect(recorded.proposePlan).toHaveLength(1);
    const proposeRequest = recorded.proposePlan[0]?.request as {
      input: { goalRef: GoalRef; basedOn: PlanRevisionRef }; meta: { requestId: string };
    };
    expect(proposeRequest.input.goalRef).toEqual(GOAL_REF);
    expect(proposeRequest.meta.requestId).toBe(`w2:${GOAL_REF.goalId}:propose_future_plan:call-propose`);

    const apply = await byName('apply_future_plan').handler.execute(
      toolCall('apply_future_plan', 'call-apply', applyArgs()), { signal: signal() });
    expect(apply).toMatchObject({ status: 'success' });
    expect(outputValue(apply)).toEqual({ status: 'committed', value: PLAN, replayed: false, cursor: cursor(2) });
    expect(recorded.applyPlanChange).toHaveLength(1);
    const applyRequest = recorded.applyPlanChange[0]?.request as {
      input: { proposalRef: PlanProposalRef; decisionRefs: unknown[] }; meta: { requestId: string };
    };
    // The adapter supplies the empty Agent decisionRefs; the model cannot.
    expect(applyRequest.input.decisionRefs).toEqual([]);
    expect(applyRequest.meta.requestId).toBe(`w2:${GOAL_REF.goalId}:apply_future_plan:call-apply`);
  });

  it('cancels before the plan operation on a pre-aborted signal, but keeps a real commit after a late abort (RED)', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const preTools = buildTools();
    const pre = await preTools.byName('query_task_graph').handler.execute(
      toolCall('query_task_graph', 'call-pre', {}), { signal: aborted.signal });
    expect(pre).toMatchObject({ status: 'cancelled' });
    // A pre-commit cancellation of a WRITE must produce zero formal writes.
    for (const [name, args] of [['propose_future_plan', proposeArgs()], ['apply_future_plan', applyArgs()]] as const) {
      const cancelledWrite = await preTools.byName(name).handler.execute(
        toolCall(name, `call-pre-${name}`, args), { signal: aborted.signal });
      expect(cancelledWrite).toMatchObject({ status: 'cancelled' });
    }
    expect(preTools.recorded.proposePlan).toHaveLength(0);
    expect(preTools.recorded.applyPlanChange).toHaveLength(0);

    // Phase 2 must not turn an already-committed write into "not committed"
    // because the signal changed after the commit returned.
    const controller = new AbortController();
    const recording = recordingPlans();
    const plans: PlanTaskPort = {
      ...recording.plans,
      async proposePlan(ctx, request) {
        const committed = await recording.plans.proposePlan(ctx, request);
        controller.abort();
        return committed;
      },
    };
    const handle = createWhiteboardTools({
      plans, context: trustedContext(controller.signal), goalRef: GOAL_REF,
      requestIdForCall: call => `w2:${call.callId}`,
    });
    const definition = handle.create(null as unknown as WorkspaceSandbox)
      .find(candidate => candidate.name === 'propose_future_plan')!;
    const late = await definition.handler.execute(
      toolCall('propose_future_plan', 'call-late', proposeArgs()), { signal: controller.signal });
    // The commit already happened, so the late abort must not rewrite it.
    expect(late).toMatchObject({ status: 'success' });
    expect(recording.recorded.proposePlan).toHaveLength(1);
    expect(controller.signal.aborted).toBe(true);
  });
});
