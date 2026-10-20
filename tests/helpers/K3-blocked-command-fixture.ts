/**
 * K3 L19a/B2-01/B2-17: ONE real blocked-command world.
 *
 * The Kernel command facts are NOT a port double. Opening the world starts a
 * REAL Work Run through the production Runtime with a scripted model whose
 * `shell` call is served by §5.1's stand-in (`shellSeam`, blocks until the test
 * closes the world). The Host's own classifier then reads the Kernel Turn, the
 * production review-draft reader builds the item list (call id, positions,
 * arguments), the operator attestation (RUN-22) writes the record, and a real
 * `settle_review{review_unavailable}` produces the `needs_decision` card.
 * `②`'s command facts come from the production `readKernelCommandFacts` over the
 * SAME Kernel store; only the workspace file CONTENT is injected, with real
 * sha256 digests.
 *
 * `openK3BlockedReviewServices` exposes the same owner/answer chain over an
 * EXISTING `K3ReviewCardWorld` so the L19a prefix row also reaches its records
 * through real Runs (injected Run-id generator, real claim → prepare → startRun
 * → classifier/draft/RUN-22 → real answer).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { WorkspaceFile } from '../../src/core/workspace/ports.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { DecisionActionsPort } from '../../src/business/workflow/decision-actions.js';
import {
  createCommandRerunRequestApplicationAdapter, createDecisionActions, type DecisionApplicationAdapter,
} from '../../src/business/workflow/decision-actions.js';
import type { KernelCommandFactV1 } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  readCanonicalTaskFacts, readGoalPlanWindow, readTaskClosure,
} from '../../src/core/work-graph/tasks/plan-readers.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { readKernelCommandFacts } from '../../src/core/agent-runtime/context-assembler.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { readK3ReviewCard, settleK3Review } from './K3-proposal-round.js';
import { openRealRunHarness, type K3_35RealRunHarness } from './K3-35-continuation-fixture.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from './K3-review-card-fixture.js';
import { createRuntimeHostDouble, createScriptedModel } from './B2-runtime-fixture.js';
import { mailboxToolSeam, shellSeam } from './K3-tool-seams.js';
import { GOAL_B, PLAN_B2, T, WORKSPACE } from './S5-decision-fixture.js';

/**
 * One scripted Kernel call. `command` is the shell command; `name`/`args`
 * override the tool for the injected non-process (platform) seam.
 */
export type CommandSpec = {
  command?: string;
  cwd?: string | null;
  name?: string;
  args?: Record<string, unknown>;
};
export type Commands = Record<string, CommandSpec>;

export type K3BlockedCommandWorld = {
  world: K3ReviewCardWorld;
  /** The same owner, wired with the L19a reads (production Kernel reader + workspace double). */
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  decisionActions: DecisionActionsPort;
  /** Every workspace path read through the injected `readWorkspace`, in order. */
  readPaths: string[];
  /** Every Kernel-fact call, in order. */
  kernelCalls: string[][];
  /** The real review item per scripted call id, read from the Kernel. */
  items: ReadonlyMap<string, UnknownCallReviewItemV1>;
  /** The real `needs_decision` record the seed produced. */
  record: UnknownCallReviewV1;
  /** The real claim that minted the seeded Run (a real `TaskClaimPort` claim). */
  claim: TaskClaim;
  /** The seeded real Run's snapshot as read after the Host classifier (RUN-20). */
  run: RunSnapshot;
  /** Add another real blocked Run of `taskId`; returns its real `needs_decision` record. */
  createNeedsDecision(taskId: string, commands: Commands): Promise<UnknownCallReviewV1>;
  answer(record: UnknownCallReviewV1, optionId: string,
    options?: { requestId?: string; text?: string }): Promise<UnknownCallReviewV1>;
  /**
   * Start a prepared value through the SAME real Runtime that seeded the world.
   * The Run is read from the shared records; a cancelled/ended Run is refused by
   * the production driver before any Host/Kernel call.
   */
  startPrepared(prepared: PreparedTaskExecution,
    input?: { consumerId?: string; requestId?: string }): Promise<ReadResult<TaskExecutionRecord>>;
  close(): Promise<void>;
};

export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const blockedSkills = async (directory: string): Promise<string> => {
  const root = join(directory, 'k3-blocked-skills');
  await mkdir(join(root, 'b2-trusted-skill'), { recursive: true });
  await writeFile(join(root, 'b2-trusted-skill', 'skill.json'), JSON.stringify({
    schemaVersion: 1, id: 'b2-trusted-skill', title: 'K3 blocked trusted skill', kind: 'instruction',
    priority: 10, contentFile: 'content.md' }));
  await writeFile(join(root, 'b2-trusted-skill', 'content.md'), 'K3_BLOCKED_SKILL');
  return root;
};

/** A trusted Host configuration grant (test input, documented shape). */
function blockedHost(input: {
  scripted: ReturnType<typeof createScriptedModel>;
  runRef: RunRef;
  role: import('../../src/contracts/core/identity.js').RoleConfigurationRef;
  scope: WorkspaceScope;
  directory: string;
  skillRoot: string;
  tools: readonly string[];
}) {
  const base = createRuntimeHostDouble({
    runRefs: new Set([canonicalJson(input.runRef as unknown as JsonValue)]), scripted: input.scripted,
    root: input.directory, skillRoot: input.skillRoot, scope: input.scope, role: input.role,
    tools: [...input.tools], writeScope: ['.'],
  });
  return {
    async resolveConfiguration(ctx: CoreCallContext,
      request: Parameters<typeof base.resolveConfiguration>[1]) {
      const result = await base.resolveConfiguration(ctx, request);
      if (result.status !== 'ready') return result;
      return { ...result, value: { ...result.value, shellWorkspaceAccess: 'all_except_denied' as const } };
    },
  };
}

/** The tools a scripted batch names, always including the ordinary read/shell. */
function toolNamesOf(commands: Commands): string[] {
  const names = new Set<string>(['read', 'shell']);
  for (const spec of Object.values(commands)) names.add(spec.name ?? 'shell');
  return [...names];
}

const platformToolNames = new Set([mailboxToolSeam.name]);

/**
 * An EMPTY mailbox port double for a platform-tool Run: the injected blocking
 * tool is served by §5.1's seam, so the mailbox only has to answer the input
 * supply's reads with an empty page. No message is fabricated.
 */
function emptyMailbox(): SessionMailboxPort {
  const page = async () => ({ status: 'ready' as const,
    value: { items: [], nextCursor: null, sourceCursor: 'c0000000000' as never } });
  return {
    readInbox: page, readOutbox: page, readRoutedReplies: page,
    async readMessage() { return { status: 'rejected', code: 'not_found', reason: 'the platform seam reads no message' }; },
    async readMessageBody() { return { status: 'rejected', code: 'not_found', reason: 'the platform seam reads no body' }; },
    async sendMessage() { throw new Error('the platform seam never sends'); },
    async ackMessage() { throw new Error('the platform seam never acks'); },
    async respondMessage() { throw new Error('the platform seam never responds'); },
  } as unknown as SessionMailboxPort;
}

/** The blocking stand-in for one scripted call's tool. */
function seamFor(name: string) {
  if (name === 'shell') return shellSeam;
  if (platformToolNames.has(name)) return mailboxToolSeam;
  throw new Error(`K3 blocked fixture: no §5.1 seam for tool ${name}`);
}

/**
 * One task claim through the REAL claim owner. `options.newId` is an injected
 * dependency: its FIRST allocation is the Run id (the claim owner's order), so
 * a test can mint two Runs with a shared 8-character prefix.
 */
async function claimBlockedRun(
  world: K3ReviewCardWorld, options: { taskId: string; sessionRef: SessionRef;
    label: string; newId: () => string; requeueRef?: import('../../src/contracts/task-requeue.js').TaskRequeueRef },
  roles: ReturnType<typeof createRoleConfigurationService>, sequence: { value: number }, now: () => string,
): Promise<TaskClaim> {
  const fixture = world.fixture;
  const ctx = fixture.ctx;
  const goal = await fixture.b2.base.plans.queryGoal(ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`K3 blocked fixture: the Goal is not readable: ${JSON.stringify(goal)}`);
  const card = await fixture.b2.base.sessionsPort.readSession(ctx, options.sessionRef);
  if (card.status !== 'ready') throw new Error(`K3 blocked fixture: the Session is not readable: ${JSON.stringify(card)}`);
  const claims = createTaskClaimService({ records: fixture.records, roles, now, newId: options.newId });
  const claimed = await claims.claimTask(ctx, {
    input: {
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: options.taskId, sessionRef: options.sessionRef,
      roleBinding: fixture.b2.base.roleBinding, budget: fixture.b2.base.budget,
      ...(options.requeueRef === undefined ? {} : { requeueRef: options.requeueRef }),
    },
    meta: { requestId: `k3-blocked-claim-${options.label}-${String(++sequence.value)}`, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: WORKSPACE, revision: fixture.workspace.revision },
      { ref: plainSessionRefToAggregate(options.sessionRef), revision: card.value.record.revision },
    ] },
  });
  if (claimed.status !== 'committed') {
    throw new Error(`K3 blocked fixture: the claim of ${options.taskId} failed: ${JSON.stringify(claimed)}`);
  }
  return claimed.value;
}

/**
 * Run ONE real Work Run whose scripted call(s) are served by §5.1's stand-in,
 * classify the crashed Turn with the production classifier, read the production
 * review draft and attest it (RUN-22), then settle it to a `needs_decision`
 * record. Returns the record, the real items, the claim and the Run snapshot.
 */
async function seedBlockedRun(
  world: K3ReviewCardWorld, harness: K3_35RealRunHarness,
  options: {
    taskId: string;
    commands: Commands;
    label: string;
    /** Injected Run-id generator; absent mints a random UUID. */
    newId?: () => string;
    requeueRef?: import('../../src/contracts/task-requeue.js').TaskRequeueRef;
  },
  sequence: { value: number },
  reviews: ReturnType<typeof createUnknownCallReviewService>,
  now: () => string,
): Promise<{ record: UnknownCallReviewV1; items: Map<string, UnknownCallReviewItemV1>; claim: TaskClaim; run: RunSnapshot;
  runtime: ReturnType<typeof createAgentRuntime> }> {
  const fixture = world.fixture;
  const records = fixture.records;
  const kernelStores = harness.kernelStores;
  const next = (): number => { sequence.value += 1; return sequence.value; };
  const label = options.label;
  // A real claim (formal TaskClaimPort) over the shared ledger; the Run id may
  // be injected (item 11's shared-prefix row).
  const session = await fixture.createS5Session(`k3-blocked-session-${label}-${String(next())}`);
  let allocation = 0;
  const claimIds = (): string => {
    allocation += 1;
    if (allocation === 1) return options.newId?.() ?? randomUUID();
    return `k3-blocked-claim-id-${label}-${String(allocation)}`;
  };
  const claimRoles = createRoleConfigurationService({ records, now,
    eventId: () => `k3-blocked-claim-event-${label}-${String(next())}` });
  const claim = await claimBlockedRun(world, {
    taskId: options.taskId, sessionRef: session, label, newId: claimIds,
    ...(options.requeueRef === undefined ? {} : { requeueRef: options.requeueRef }),
  }, claimRoles, sequence, now);
  const sessionCard = await fixture.b2.base.sessionsPort.readSession(fixture.ctx, session);
  if (sessionCard.status !== 'ready') throw new Error(`K3 blocked fixture: Session read failed: ${JSON.stringify(sessionCard)}`);
  const role = sessionCard.value.record.role;
  const scripted = createScriptedModel([{ kind: 'calls', calls: Object.entries(options.commands).map(([callId, spec]) => ({
    callId, name: spec.name ?? 'shell',
    args: spec.args ?? { command: spec.command ?? '',
      ...(spec.cwd === undefined || spec.cwd === null ? {} : { cwd: spec.cwd }) },
  })) }]);
  const skillRoot = await blockedSkills(fixture.base.directory);
  const host = blockedHost({ scripted, runRef: claim.runRef, role, scope: fixture.base.scope,
    directory: fixture.base.directory, skillRoot, tools: toolNamesOf(options.commands) });
  const executions = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now,
    eventId: () => `k3-blocked-role-event-${String(next())}` });
  const sessions = createSessionDirectory({ records, lookups: records });
  const materialReaders = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: fixture.bodies, authority: materialReaders.authority, now });
  const sessionOperations = createSessionOperations({ sessions, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const graphHistory = createGraphExecutionHistoryReader({ executions, history: activity });
  const eventId = (): string => `k3-blocked-runtime-event-${String(next())}`;
  const newId = (): string => `k3-blocked-runtime-id-${String(next())}`;
  const entryDeps = { records, reads: executions, roles, bodies: fixture.bodies,
    authorizeConfiguration: (async (ctx, input) => {
      const configured = await host.resolveConfiguration(ctx, { runRef: input.run.ref,
        role: input.sessionRole, roleResolution: input.roleResolution });
      if (configured.status !== 'ready') return configured;
      const value = configured.value;
      const template = input.sessionRole.kind === 'legacy_template' ? value.hostTemplate : null;
      if (value.configurationRevision !== input.configurationRevision
        || JSON.stringify(input.permissions) !== JSON.stringify({ policyRevision: input.run.roleBinding.policyRevision,
          tools: [...value.tools], writeScope: [...value.writeScope] })
        || JSON.stringify(template) !== JSON.stringify(input.hostTemplate)) {
        return { status: 'rejected', code: 'forbidden', reason: 'the trusted Host double does not grant this configuration' };
      }
      return { status: 'ready', value: { configurationRevision: value.configurationRevision,
        permissions: structuredClone(input.permissions), hostTemplate: template } };
    }) as AuthorizeConfiguration,
    now, eventId, newId };
  const entry = createExecutionEntryService(entryDeps);
  const modelRequests = createModelCallService(entryDeps);
  const workspaceHost = {
    async resolveRoot(scope: WorkspaceScope) {
      return scope.projectId === fixture.base.scope.projectId && scope.workspaceId === fixture.base.scope.workspaceId
        ? { status: 'ready' as const, value: { root: fixture.base.directory, workspaceRevision: fixture.workspace.revision } }
        : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown workspace scope' };
    },
    async authorize() {
      return { status: 'ready' as const, value: { subjectKey: 'k3-blocked-host', permissionRevision: 'k3-blocked@1',
        allowsRead: () => true } };
    },
  };
  // The platform (non-process) tool is registered through the production
  // SessionMailbox factory the test replaces with §5.1's blocking seam; the
  // dependency objects are never read by the stand-in.
  const platformTool = Object.values(options.commands).some(spec => spec.name !== undefined && spec.name !== 'shell');
  const runtime = createAgentRuntime({
    claims: fixture.b2.base.makeService(records), executions, entry,
    historyWriter: createExecutionHistoryService({ records, now, eventId }),
    modelRequests, roles, plans: fixture.b2.base.plans, sessions, materials, bodies: fixture.bodies,
    activity, graphHistory, sessionOperations, kernelStores, workspaceHost,
    sourceAuthority: () => createSourceAuthorityReader({ authority: materialReaders.authority }),
    host, kernel, now, newId,
    commandRecognizer: createCommandRecognizer({}),
    // F-071: prepare REQUIRES the Task review reader; it is the SAME real
    // UnknownCallReview owner this world's reads/answers use, never an empty
    // ready value. `seedBlockedRun` already receives that owner.
    unknownCallReviews: reviews,
    // The matching REQUIRED port: a non-empty blocked binding reads the Task's
    // CRRs through this same world owner (no silent empty result).
    commandRerunRequests: world.commandRerun,
    readTaskClosure: async (_ctx: CoreCallContext, task: TaskTriple) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    ...(platformTool ? { messages: emptyMailbox(), decisionMessages: emptyMailbox() } : {}),
  } as unknown as Parameters<typeof createAgentRuntime>[0]);
  const prepared = await runtime.port.prepareExecution(fixture.ctx, { runRef: claim.runRef,
    requestId: `k3-blocked-prepare-${String(next())}` });
  if (prepared.status !== 'ready') throw new Error(`K3 blocked fixture: prepare failed: ${JSON.stringify(prepared)}`);
  for (const spec of Object.values(options.commands)) seamFor(spec.name ?? 'shell').arm();
  const running = runtime.port.startRun(fixture.ctx, { prepared: prepared.value,
    consumerId: 'k3-blocked-consumer', requestId: `k3-blocked-start-${String(next())}` });
  let settled: unknown = undefined;
  running.then(result => { settled = result; }, error => { settled = error; });
  // The Kernel dispatches a batch's calls in order; only the first handler is
  // entered before the crash. Every declared call of the turn is still a real
  // Kernel fact and the classifier lists the unresolved ones.
  const first = Object.values(options.commands)[0];
  const watched = first === undefined ? undefined : seamFor(first.name ?? 'shell');
  const expectedCalls = first === undefined ? 0 : 1;
  const deadline = Date.now() + 15_000;
  while ((watched?.calls.length ?? 0) < expectedCalls) {
    if (settled !== undefined) {
      const failure = settled as { status?: string; value?: { run?: { status?: string; outcome?: string | null; terminalPayload?: unknown } } };
      throw new Error(`K3 blocked fixture: the Run ended before the tool call (${String(failure.status)}/${String(failure.value?.run?.status)}/${String(failure.value?.run?.outcome)}/${String(scripted.calls())})`);
    }
    if (Date.now() > deadline) {
      throw new Error(`K3 blocked fixture: the stand-in seam saw ${String(watched?.calls.length ?? 0)} of ${String(expectedCalls)} calls`);
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  void running.catch(() => undefined);
  // Recognition is the K3-35 fixture's ONE Host chain, never a second copy:
  // RUN-20 (`reconcile.reconcileRun`) and the public RUN-22 (`resolveUnknownRun`)
  // read the production draft with the real `lookupToolCommit`/`captureWorkspace`
  // over the SAME world store (SQLite or the world's ONE memory backend).
  const created = await harness.createRecord(claim);
  const reads = createRunStateReader({ records });
  const afterRecord = await reads.readExecution(fixture.ctx, claim.runRef);
  if (afterRecord.status !== 'ready') throw new Error('K3 blocked fixture: the reconciled Run is not readable');
  const pending = await reviews.readReview(fixture.ctx, { runRef: claim.runRef });
  if (pending.status !== 'ready') throw new Error(`K3 blocked fixture: the record is not readable: ${JSON.stringify(pending)}`);
  // An all-platform record is already `needs_decision` (undetermined); a Run
  // with process items still needs the real `settle_review{review_unavailable}`.
  const record = created.status === 'needs_decision'
    ? created
    : await settleK3Review(world, pending.value, { cause: 'review_unavailable' });
  if (record.status !== 'needs_decision') {
    throw new Error(`K3 blocked fixture: the record settled to ${record.status}, not needs_decision`);
  }
  const items = new Map<string, UnknownCallReviewItemV1>();
  for (const item of record.items) items.set(item.callId, item);
  return { record, items, claim, run: afterRecord.value.run, runtime };
}

/**
 * The production owner/read/answer chain over an EXISTING world. `seed` runs one
 * more real blocked Run of the Task; `answer` resolves a card through the real
 * decision coordinator (① + ② + ③).
 */
export type K3BlockedReviewServices = {
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  decisionActions: DecisionActionsPort;
  readPaths: string[];
  kernelCalls: string[][];
  answer(record: UnknownCallReviewV1, optionId: string,
    options?: { requestId?: string; text?: string }): Promise<UnknownCallReviewV1>;
  seed(options: {
    taskId: string; commands: Commands; label: string; runId?: string;
    requeueRef?: import('../../src/contracts/task-requeue.js').TaskRequeueRef;
  }): Promise<{ record: UnknownCallReviewV1; items: Map<string, UnknownCallReviewItemV1>;
    claim: TaskClaim; run: RunSnapshot; runtime: ReturnType<typeof createAgentRuntime> }>;
  /** Change the clock used by every later seed/answer of this world (A8). */
  setNow(next: () => string): void;
};

export async function openK3BlockedReviewServices(
  world: K3ReviewCardWorld,
  files: Record<string, string> = {},
  options: { now?: () => string } = {},
): Promise<K3BlockedReviewServices> {
  let now = options.now ?? ((): string => T);
  const clock = (): string => now();
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store',
    workspace: world.fixture.base.scope,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const readPaths: string[] = [];
  const kernelCalls: string[][] = [];
  const readWorkspace = {
    readWorkspace: async (_ctx: CoreCallContext, input: {
      path: string; maxBytes: number;
    }): Promise<{ status: 'ready'; value: WorkspaceFile }
      | { status: 'rejected'; code: 'not_found'; reason: string }> => {
      readPaths.push(input.path);
      const content = files[input.path];
      if (content === undefined) {
        return { status: 'rejected', code: 'not_found', reason: `no such workspace file: ${input.path}` };
      }
      return { status: 'ready', value: {
        path: input.path, content, digest: sha256Of(content), sizeBytes: Buffer.byteLength(content, 'utf8'),
        digestBasis: 'raw_bytes', version: { kind: 'working_tree' }, readAt: T,
      } };
    },
  };
  // The PRODUCTION Kernel command reader over the REAL Kernel store; the
  // counting wrapper is the only test addition (B2-16/B2-17 read accounting).
  const realKernelFacts = async (
    ctx: CoreCallContext,
    input: Parameters<typeof readKernelCommandFacts>[2],
  ): Promise<ReadResult<ReadonlyMap<string, KernelCommandFactV1>>> => {
    kernelCalls.push(input.calls.map(call => call.callId));
    return readKernelCommandFacts({ kernelStores, kernel }, ctx, input);
  };
  const reads = createRunStateReader({ records: world.fixture.records });
  // ONE harness (and so ONE platform once a record is recognized) per world:
  // every `seed` call of this world recognizes through it. The clock is the
  // caller's A8 input (default `T`), the same one the blocked Run's Runtime uses.
  const harness = await openRealRunHarness(world, { now: clock });
  const closeWorld = world.close.bind(world);
  let closed = false;
  world.close = async () => {
    if (closed) return;
    closed = true;
    try { await harness.closeUnion(); } finally { await closeWorld(); }
  };
  let sequence = 0;
  const reviews = createUnknownCallReviewService({
    records: world.fixture.records,
    reads,
    readAnswerText: async (ctx, { source }) => {
      const read = await world.decisions.readDecisionAnswer(ctx, { source });
      if (read.status !== 'ready') return read;
      return { status: 'ready', value: read.value.body === null ? null : read.value.body.text };
    },
    taskProjection: async (_ctx, task) => {
      const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
      const window = await readGoalPlanWindow(world.fixture.records, goalRef);
      if (window.status !== 'ready') return window;
      if (window.plan === null) return { status: 'rejected', code: 'not_found', reason: 'no active Plan' };
      return readCanonicalTaskFacts(world.fixture.records, goalRef, window.plan, task.taskId);
    },
    readKernelCommandFacts: realKernelFacts,
    readWorkspace,
    now: clock,
    eventId: () => `k3-blocked-review-${String(++sequence)}`,
  });
  const goalSettings = createGoalSettingsService({ records: world.fixture.records, now: clock,
    newId: () => `k3-blocked-decision-${String(++sequence)}`, operatorActor: world.fixture.operatorActor });
  const reviewAdapter: DecisionApplicationAdapter = {
    async apply(ctx, { answerRef, source, selection, requestId, expected }) {
      const result = await reviews.applyDisposition(ctx, {
        input: { source, selection, decisionMessageRef: answerRef },
        meta: { requestId, expected },
      });
      return { status: 'ready', value: { action: result, receipt: null } };
    },
  };
  const decisionActions = createDecisionActions({
    goalSettings,
    decisionMessages: {
      answerDecision: world.decisions.answerDecision.bind(world.decisions),
      readDecisionAnswer: world.decisions.readDecisionAnswer.bind(world.decisions),
      recordDecisionApplication: world.decisions.recordDecisionApplication.bind(world.decisions),
    },
    applicationReceipt: world.applicationReceipt,
    decisionApplications: { unknown_call_review: reviewAdapter,
      command_rerun_request: createCommandRerunRequestApplicationAdapter(world.commandRerun) },
  });
  const answer = async (record: UnknownCallReviewV1, optionId: string,
    answerOptions: { requestId?: string; text?: string } = {}): Promise<UnknownCallReviewV1> => {
    const { card } = await readK3ReviewCard(world, record);
    const result = await decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId },
        text: answerOptions.text ?? '', annotations: [] },
      meta: { requestId: answerOptions.requestId ?? `k3-blocked-answer-${optionId}-${String(++sequence)}`,
        expected: card.source.pins },
    });
    if (result.status !== 'ready' || result.value.state !== 'applied') {
      throw new Error(`K3 blocked-command fixture: the answer did not apply: ${JSON.stringify(result)}`);
    }
    const action = result.value.action;
    if (action === null || action.status !== 'committed') {
      throw new Error(`K3 blocked-command fixture: the disposition did not commit: ${JSON.stringify(action)}`);
    }
    return action.value as unknown as UnknownCallReviewV1;
  };
  const seedSequence = { value: sequence };
  const seed: K3BlockedReviewServices['seed'] = async options => {
    const seeded = await seedBlockedRun(world, harness, {
      taskId: options.taskId, commands: options.commands, label: options.label,
      ...(options.runId === undefined ? {} : { newId: () => options.runId as string }),
      ...(options.requeueRef === undefined ? {} : { requeueRef: options.requeueRef }),
    }, seedSequence, reviews, clock);
    sequence = seedSequence.value;
    return seeded;
  };
  return { reviews, decisionActions, readPaths, kernelCalls, answer, seed,
    setNow: next => { now = next; } };
}

export async function openK3BlockedCommandWorld(
  kind: 'memory' | 'sqlite',
  options: {
    taskId?: string;
    /** callId -> original command/cwd (or an injected non-process tool); ONE real Run. */
    commands: Commands;
    /** workspace path -> literal file content (real sha256 digests). */
    files: Record<string, string>;
  },
): Promise<K3BlockedCommandWorld> {
  // The review world's CRR card source reads the ORIGINAL command text through
  // its Kernel-command reader. Use the PRODUCTION reader over the same real
  // `s5-kernel.sqlite` the seed below writes (the default narrow double serves
  // only hand-declared callIds); no command fact is declared by a test here.
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  const services = await openK3BlockedReviewServices(world, options.files);
  const seeded = await services.seed({
    taskId: options.taskId ?? 'k3-20-a', commands: options.commands, label: 'seed',
  });
  const items = new Map(seeded.items);
  let sequence = 0;
  const createNeedsDecision = async (taskId: string, commands: Commands): Promise<UnknownCallReviewV1> => {
    const next = await services.seed({ taskId, commands, label: `next-${String(++sequence)}` });
    for (const [callId, item] of next.items) items.set(callId, item);
    return next.record;
  };
  let starts = 0;
  // The production start of a prepared value: the driver re-reads the persisted
  // manifest and the Run, and a cancelled Run is refused before any Host call.
  const startPrepared: K3BlockedCommandWorld['startPrepared'] = (prepared, input = {}) => {
    starts += 1;
    return seeded.runtime.port.startRun(world.fixture.ctx, {
      prepared,
      consumerId: input.consumerId ?? `k3-blocked-start-consumer-${String(starts)}`,
      requestId: input.requestId ?? `k3-blocked-start-${String(starts)}`,
    });
  };
  return { world, reviews: services.reviews, decisionActions: services.decisionActions,
    readPaths: services.readPaths, kernelCalls: services.kernelCalls, items, record: seeded.record,
    claim: seeded.claim, run: seeded.run, startPrepared,
    createNeedsDecision, answer: services.answer, close: () => world.close() };
}
