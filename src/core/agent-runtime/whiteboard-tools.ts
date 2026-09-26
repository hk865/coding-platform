/**
 * W2 whiteboard plan tool adapter.
 *
 * The factory has the SAME `{ names, create }` shape as the frozen
 * `coordinationTools` seam on `observed-model-run.ts` and as
 * `communication-tools.ts`, so the Host can assemble it without changing any
 * Kernel type. `context` and `goalRef` are trusted, already-bound values: the
 * model never supplies a principal, scope, Role, generation, grant, requestId
 * or author. `requestIdForCall` receives the Kernel-dispatched
 * `ToolCall.callId` plus the bound Run/operation; the model never supplies a
 * requestId and two real calls are never collapsed by hashing their arguments.
 *
 * The factory snapshots the trusted context and Goal once, at creation time.
 * Every handler validates its strict argument schema, clones the accepted
 * arguments before the first await, forwards the ORIGINAL Kernel `AbortSignal`,
 * and then calls the SAME `PlanTaskPort` the Host reads/writes through. This
 * file is a thin adapter: the W1 service owns the plan structure, the
 * future-only rules and the Agent authorization. It must never become a second
 * plan engine, a Host or an identity provider.
 *
 * Domain outcomes are preserved verbatim in the JSON output: a `ready` read and
 * a `committed` write keep their full `ReadResult`/`WriteResult` (including
 * `value`, `cursor`, `replayed`, `not_ready`, and the rejection
 * `code`/`reason`/`current`). A typed rejection is never turned into a fake
 * success, and a write that already committed is never reported as
 * "not committed" because the signal changed afterwards.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../contracts/plan.js';
import type { PlanChangeReason, PlanProposalRef, PlanTaskPort } from '../work-graph/tasks/plan-contracts.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

/**
 * Fixed production tool names. The Host authorization list (B2 envelope/Host
 * grant/RoleSpec) must be intersected with these exact names; an alias with the
 * same meaning must never be registered. Declaring a name here grants nothing.
 */
export const WHITEBOARD_TOOL_NAMES = [
  'query_task_graph',
  'query_ready_tasks',
  'propose_future_plan',
  'apply_future_plan',
] as const;

export type WhiteboardToolName = (typeof WHITEBOARD_TOOL_NAMES)[number];

export type WhiteboardToolsConfig = {
  /** The SAME W1 service that serves the Host; the adapter adds no plan rules. */
  plans: PlanTaskPort;
  /** Trusted, already-bound context. Snapshotted at factory creation; never model JSON. */
  context: CoreCallContext;
  /** Trusted Host-bound Goal. The model cannot choose or widen it. */
  goalRef: GoalRef;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
};

export type WhiteboardToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

// --------------------------------------------------------------------------
// Typed Kernel results. A platform-state write changes no workspace file, so
// `effects` never claims a changed path. The full domain result is kept in the
// JSON output for every outcome, including typed rejections.
// --------------------------------------------------------------------------

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}

function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}

function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects(),
  };
}

/** A real domain rejection: keep `code`/`reason`/`current` in the output. */
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}

function cancelled(callId: string, reason: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: [], effects: noneEffects() };
}

/** A domain `cancelled` rejection also keeps the full typed result. */
function cancelledResult(callId: string, reason: string, result: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: outputValue(result), effects: noneEffects() };
}

/** `ready` keeps the whole `ReadResult`, never only `value`. */
function mapRead(callId: string, result: ReadResult<unknown>): ToolResult {
  if (result.status === 'ready') return success(callId, result);
  if (result.status === 'not_found') return rejectedResult(callId, result, 'the requested plan record does not exist');
  if (result.status === 'not_ready') return rejectedResult(callId, result, 'the requested plan read is not ready');
  if (result.code === 'cancelled') return cancelledResult(callId, result.reason, result);
  return rejectedResult(callId, result, result.reason);
}

/** `committed` keeps the whole `WriteResult`, including `cursor`/`replayed`. */
function mapWrite(callId: string, result: WriteResult<unknown>): ToolResult {
  if (result.status === 'committed') return success(callId, result);
  if (result.code === 'cancelled') return cancelledResult(callId, result.reason, result);
  return rejectedResult(callId, result, result.reason);
}

// --------------------------------------------------------------------------
// Strict model-facing schemas. The goal is bound by config, so it is never an
// argument. Identity/permission/authority fields are rejected as unknown keys.
// The draft/reason payloads stay opaque here: `plan-validation.ts` and the plan
// service are the single owners of plan structure and W1 future-only rules.
// --------------------------------------------------------------------------

const planRevisionRefSchema = z.object({
  aggregateType: z.literal('PlanRevision'),
  projectId: z.string().min(1),
  planId: z.string().min(1),
}).strict();

const planProposalRefSchema = z.object({
  aggregateType: z.literal('PlanProposal'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  proposalId: z.string().min(1),
}).strict();

/**
 * Caller-visible W1 version pins. The plan service `normalizeCallerPlanPins`
 * remains the owner of the accepted subset and of the exact conflict
 * semantics; this schema only keeps the same five accepted ref shapes strict so
 * a model cannot smuggle an unknown identity/permission field inside a pin.
 */
const projectPinRefSchema = z.object({
  aggregateType: z.literal('Project'), projectId: z.string().min(1),
}).strict();
const workspacePinRefSchema = z.object({
  aggregateType: z.literal('Workspace'), projectId: z.string().min(1), workspaceId: z.string().min(1),
}).strict();
const goalPinRefSchema = z.object({
  aggregateType: z.literal('Goal'), projectId: z.string().min(1), goalId: z.string().min(1),
}).strict();
const versionPinSchema = z.object({
  ref: z.union([projectPinRefSchema, workspacePinRefSchema, goalPinRefSchema, planRevisionRefSchema, planProposalRefSchema])
    .describe('One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal.'),
  revision: z.number().int().min(0)
    .describe('The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record.'),
}).strict();

const schemas: Record<WhiteboardToolName, z.ZodType> = {
  query_task_graph: z.object({
    planRef: planRevisionRefSchema.optional(),
    atLeastCursor: z.string().min(1).optional(),
  }).strict(),
  query_ready_tasks: z.object({
    roleIds: z.array(z.string().min(1)).optional(),
    includeBlocked: z.boolean(),
    page: z.object({
      limit: z.number().int().min(1).max(200),
      cursor: z.string().min(1).optional(),
      atLeastCursor: z.string().min(1).optional(),
    }).strict(),
  }).strict(),
  // Agent `proposePlan` is a v2 future revision based on the current accepted
  // plan (`basedOn` is never null); the plan service re-checks that.
  propose_future_plan: z.object({
    basedOn: planRevisionRefSchema
      .describe('The current accepted PlanRevisionRef this v2 future revision is based on; never null for an Agent proposal.'),
    draft: z.record(z.string(), z.unknown()).describe(
      `PlanRevisionDraft (schemaVersion: 2); build it from the current Plan returned by query_task_graph and edit only what the revision needs.
Top level: planId; planRevision; goalId (the bound Goal's goalId); stages: {stageId,title,description?}[]; tasks: RuntimeTask[]; assignments?: {taskId,role,instruction}[]; obligations: {obligationId,title,requirementLevel,taskIds,verificationRequirements:{requirementId,requirementLevel,kind,description}[]}[]; taskHierarchy: {parentOf:{parentTaskId,childTaskId}[]}; executionDag: {dependsOn:{taskId,dependsOnId,requires:{kind:'output-contract'|'artifact'|'decision'|'environment-revision'|'gate-result',label}}[]}; taskRelations?: {fromTaskId,toTaskId,kind:'coordination'|'expected_dependency',note}[]; inputRequirements?: {requirementId,consumerTaskId,kind:'artifact',artifactRef}[].
RuntimeTask: {taskId,stageId?,title,requirementLevel:'required'|'optional',taskKind:'work'|'gate',disposition:'active'|'deferred'|'cancelled'|'superseded',phase:'pending'|'ready'|'running'|'verifying'|'blocked'|'satisfied'|'failed',scope:{kind:'goal'}|{kind:'stage',stageId}|{kind:'module',stageId,moduleRef},executionIntent?:'plan_only'|'request_execution',replacedByTaskId?}. executionIntent is the adopted orchestration intent only: 'plan_only' records the intent now (assignment, obligations/acceptance, dependencies and exact inputs may all be omitted; the node is never claimable even after an assignment is later added); 'request_execution' asks this node to run and must already carry exactly one legal role/instruction assignment (acceptance may still be missing). It is not a Role grant, budget, ready signal, Run state or completion judgement. State the intent explicitly on every NEW work node; when editing an existing node that already carries executionIntent, preserve it or explicitly change 'plan_only' to 'request_execution' — omitting the field is invalid and cannot silently activate a node.
Copy the current Plan's known fields, then drop accepted/compiler metadata that is not part of a draft: ref, revision, goalRef, acceptedAt, effectiveCompletionPolicy, effectiveArchitectureBaseline, taskStateBasis; omit origin/reviewAdmissionProtocol unless reproducing them is required. The plan service owns semantic validation (explicit-intent branches, assignment completeness, obligations, DAG/hierarchy legality, future-only rules); this adapter does not restate it.`,
    ),
    reason: z.record(z.string(), z.unknown())
      .describe('PlanChangeReason: { text, sources }.'),
    expected: z.array(versionPinSchema)
      .describe('The exact W1 version pins the caller saw; omit a pin rather than guessing a fresh revision.'),
  }).strict(),
  // Agent `applyPlanChange` adopts only its own W2 candidate with
  // `decisionRefs=[]`; the adapter supplies that empty list, the model cannot.
  apply_future_plan: z.object({
    proposalRef: planProposalRefSchema
      .describe('Your own candidate_v2 proposal ref; the plan service refuses another Run/author candidate.'),
    expectedProposalRevision: z.number().int().min(1)
      .describe('The exact revision of proposalRef, as read.'),
    expected: z.array(versionPinSchema)
      .describe('The exact W1 version pins the caller saw; omit a pin rather than guessing a fresh revision.'),
  }).strict(),
};

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

function isReadTool(name: WhiteboardToolName): boolean {
  return name === 'query_task_graph' || name === 'query_ready_tasks';
}

type QueryTaskGraphArgs = { planRef?: PlanRevisionRef; atLeastCursor?: string };
type QueryReadyTasksArgs = {
  roleIds?: string[];
  includeBlocked: boolean;
  page: { limit: number; cursor?: string; atLeastCursor?: string };
};
type ProposeArgs = {
  basedOn: PlanRevisionRef;
  draft: PlanRevisionDraft;
  reason: PlanChangeReason;
  expected: VersionPin[];
};
type ApplyArgs = {
  proposalRef: PlanProposalRef;
  expectedProposalRevision: number;
  expected: VersionPin[];
};

type PreparedWhiteboardCall = {
  plans: PlanTaskPort;
  name: WhiteboardToolName;
  callId: string;
  /** Strictly parsed and cloned before the first await. */
  args: unknown;
  /** Snapshotted trusted context carrying the real Kernel signal. */
  context: CoreCallContext;
  /** Derived from the real callId + bound Run/operation, never from args. */
  requestId: string;
  /** Snapshotted trusted Goal. */
  goalRef: GoalRef;
};

/**
 * The thin forwarder. It calls the SAME `PlanTaskPort` methods the Host uses
 * and maps each real domain result back without dropping fields. The W1 service
 * still owns every plan rule and the Agent authorization; the adapter supplies
 * only the trusted Goal, the bound context and the callId-derived requestId.
 */
async function dispatch(prepared: PreparedWhiteboardCall): Promise<ToolResult> {
  const { plans, name, callId, args, context, requestId, goalRef } = prepared;
  switch (name) {
    case 'query_task_graph': {
      const input = args as QueryTaskGraphArgs;
      const result = await plans.queryTaskGraph(context, {
        goalRef,
        ...(input.planRef === undefined ? {} : { planRef: input.planRef }),
        ...(input.atLeastCursor === undefined ? {} : { atLeastCursor: input.atLeastCursor as CommitCursor }),
      });
      return mapRead(callId, result);
    }
    case 'query_ready_tasks': {
      const input = args as QueryReadyTasksArgs;
      const result = await plans.queryReadyTasks(context, {
        goalRef,
        ...(input.roleIds === undefined ? {} : { roleIds: [...input.roleIds] }),
        includeBlocked: input.includeBlocked,
        page: {
          limit: input.page.limit,
          ...(input.page.cursor === undefined ? {} : { cursor: input.page.cursor }),
          ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor as CommitCursor }),
        },
      });
      return mapRead(callId, result);
    }
    case 'propose_future_plan': {
      const input = args as ProposeArgs;
      const result = await plans.proposePlan(context, {
        input: { goalRef, basedOn: input.basedOn, draft: input.draft, reason: input.reason },
        meta: { requestId, expected: input.expected },
      });
      return mapWrite(callId, result);
    }
    case 'apply_future_plan': {
      const input = args as ApplyArgs;
      const result = await plans.applyPlanChange(context, {
        // The adapter, not the model, supplies the empty Agent decisionRefs.
        input: { proposalRef: input.proposalRef, expectedProposalRevision: input.expectedProposalRevision, decisionRefs: [] },
        meta: { requestId, expected: input.expected },
      });
      return mapWrite(callId, result);
    }
    default:
      return failure(callId, 'execution_failed', `whiteboard tool ${name} is not recognized`);
  }
}

export function createWhiteboardTools(config: WhiteboardToolsConfig): WhiteboardToolsHandle {
  // Freeze the trusted scope before returning the factory. The model-facing
  // schemas have no Goal field, so a caller can never rebind it, and a later
  // mutation of the caller's config object must not change this handler's
  // identity or scope.
  const fixedGoalRef: GoalRef = {
    aggregateType: 'Goal', projectId: config.goalRef.projectId, goalId: config.goalRef.goalId,
  };
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);

  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: fixedProjectId,
      ...(fixedWorkspaceId === undefined ? {} : { workspaceId: fixedWorkspaceId }),
      principal: structuredClone(fixedPrincipal),
      materialReader: structuredClone(fixedMaterialReader),
      signal,
    };
  }

  async function execute(
    name: WhiteboardToolName,
    call: Readonly<ToolCall>,
    signal: AbortSignal,
    schema: z.ZodType,
  ): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return failure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    // Isolation happens before the first await: a caller mutating its argument
    // object afterwards cannot change what was accepted.
    const parsed = schema.safeParse(call.arguments);
    if (!parsed.success) return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    let accepted: unknown;
    try {
      accepted = structuredClone(parsed.data);
    } catch {
      return failure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    // The trusted Host derives one stable requestId from the real callId and the
    // bound Run/operation. The model cannot supply one and an empty callId is
    // never signed.
    let requestId: string;
    try {
      requestId = config.requestIdForCall(call);
    } catch {
      return failure(callId, 'execution_failed', 'no trusted command identity is bound for this call');
    }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return failure(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    // Snapshot the trusted context and keep the ORIGINAL Kernel signal by
    // reference so cancellation is never lost or cloned.
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelled(callId, 'the whiteboard call was cancelled before the plan operation');
    // A failing domain call is a typed failure, never an uncaught rejection and
    // never a fabricated success. A commit that already happened is not rewritten
    // into "not committed" by a late signal change: `dispatch` never re-checks the
    // signal after the domain call returns.
    try {
      return await dispatch({ plans: config.plans, name, callId, args: accepted, context, requestId, goalRef: fixedGoalRef });
    } catch {
      // The domain call never returned, so the honest outcome is "unconfirmed":
      // a write may already be committed even though its result was lost. Never
      // claim it was not committed, and never invite a new-callId retry; the
      // same trusted request identity is what can recover the original receipt.
      const message = isReadTool(name)
        ? 'the plan read did not return a result; its outcome is unconfirmed. Re-read under the same trusted request identity instead of assuming the record is absent.'
        : 'the plan write did not return a result; its outcome is unconfirmed and it may already be committed. Do not report it as not committed and do not retry under a new callId; verify the original receipt with the same trusted request identity.';
      return failure(callId, 'execution_failed', message);
    }
  }

  const descriptions: Record<WhiteboardToolName, string> = {
    query_task_graph: 'Read the current Plan task graph for the bound Goal. Optional planRef selects a PlanRevision; optional atLeastCursor is a source cursor.',
    query_ready_tasks: 'Read the ready candidate tasks for the bound Goal. includeBlocked selects blocked rows too; roleIds filters by Role; page paginates.',
    propose_future_plan: 'Propose a v2 future Plan revision for the bound Goal. basedOn must be the current accepted PlanRevision; expected carries the exact W1 pins you saw. The plan service owns all plan and future-only rules.',
    apply_future_plan: 'Adopt your own W2 candidate proposal for the bound Goal. decisionRefs are supplied by the platform. Only a real committed plan revision is reported as success.',
  };

  function definitionFor(name: WhiteboardToolName): ToolDefinition {
    const schema = schemas[name];
    const readOnly = isReadTool(name);
    return {
      name,
      description: descriptions[name],
      inputSchema: schema,
      // A platform-state write is a non-read-only Kernel effect so the Kernel
      // permission policy and `hostAuthorizedTools` apply. It grants no
      // workspace write or process capability and reports no changed file.
      effectClass: readOnly ? 'read_only' : 'workspace_write',
      // A read-only extension tool is authorized by the Kernel policy only when
      // it registers through the read-only capability seam. `workspace_read`
      // here is that registration label, not a claim that the plan read touches
      // workspace files; the handler calls the plan service. Writes stay
      // non-read-only and are authorized by the Host `hostAuthorizedTools`
      // list, and never receive workspace write/shell.
      requiredCapabilities: readOnly ? ['workspace_read'] : [],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: readOnly,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(name, call, options.signal, schema);
        },
      },
    };
  }

  return {
    names: WHITEBOARD_TOOL_NAMES,
    create: () => WHITEBOARD_TOOL_NAMES.map((name) => definitionFor(name)),
  };
}
