/**
 * W-A (8C G3): the real Host world of a staged `repair` note.
 *
 * State comes only from public steps: `openS6AHostWorld` builds the Host,
 * `governS6B` the pointers, `createGoal`/`adoptS6BPlan`/`createS6BLine` the
 * Goal/Plan/Tasks/line, the scripted Work Run calls the real `edit` and
 * `record_note` tools, and the real Workflow runs `open_checks`/`run_check`/
 * `finalize_checks`; the `finalize_checks` step and the `repair_approval`
 * answer both reach the platform's OWN repair activator. Only the fault rows
 * open a second, fault-injecting activator with one production dependency
 * replaced. The commit observer is captured by a delegating wrapper (A3/A4)
 * that returns the real object and only counts (or drops a RunActivity record
 * for the missing-footprint rows). Reads are public routes/owners; a repair pin
 * comes from the public architecture read. No store is asserted on and no pin,
 * receipt, round or context is built by hand.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import * as commitObserverModule from '../../src/composition/commit-observer.js';
import * as decisionServiceModule from '../../src/core/work-graph/communication/decision-service.js';
import type { DecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import type { GoalRecordTransactionPort, PreparedCommit } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import {
  createRepairActivationService, footprintProblem, type RepairActivationDependencies, type RepairActivationService,
} from '../../src/core/work-graph/notes/activate-repair.js';
import { catalogPinOf } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { CatalogRepairOpV1, NoteDraftV1, RepairInputV1 } from '../../src/contracts/note.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple, RunRef, RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { WorkflowStepReceipt, WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { checkConfiguration, S7A_REPLY_TOOLS } from './S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_SCRIBE_ROLE, S6A_SCRIBE_ROLE_BINDING, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING,
  type S6ASession } from './S6A-request-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { ag2bPlanDraft } from './AG2b-collaboration-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { catalogRevisionDeps } from './S8C-catalog-world.js';
import { sessionOf } from './S7A-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';

type HostFactory = typeof import('../../src/app/host.js').createLocalWorkbenchHost;

/** The Work binding's real write/shell grant, as the PL readings world configures it. */
function configuredHostFactory(original: HostFactory): HostFactory {
  return async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    const work = configuration?.bindings.find(binding => binding.id === 's6a-work-binding');
    if (configuration === undefined || work === undefined) {
      throw new Error('S8C: the Host was opened without its Work binding');
    }
    work.grant = {
      ...work.grant,
      tools: [...new Set([...work.grant.tools, 'shell'])],
      writeScope: ['.'],
      shellWorkspaceAccess: 'all_except_denied',
    };
    return await original(hostOptions);
  };
}

const FAIL_FLAG = '.s8c-repair-check-fails';

/** The A3 commit counter around the platform's own observed `records.commit`. */
export type RepairCommits = { reset(): void; count(): number; identities(): readonly string[] };

let commits: { count: number; identities: string[] } = { count: 0, identities: [] };

export const repairCommits: RepairCommits = {
  reset: () => { commits = { count: 0, identities: [] }; },
  count: () => commits.count,
  identities: () => [...commits.identities],
};

export type S8CStagedRepair = {
  noteId: string; version: number; pin: ArchitectureCatalogPinV1; task: TaskTriple; run: RunRef;
  openChecks: WorkflowAdvanceInput;
};

/** A staged repair written while the Run is still running (R5c). */
export type S8CHeldRepair = {
  readonly noteId: string;
  readonly version: number;
  /** Lets the held model request go; resolves once the Run ended and the Workflow reached `open_checks`. */
  release(): Promise<S8CStagedRepair>;
};

export type S8CRepairOutcome = {
  staged: S8CStagedRepair; receipts: WorkflowStepReceipt[];
  finalize: Extract<WorkflowStepReceipt, { kind: 'finalize_checks' }>;
  /** The Workflow's next step (after the FAIL: its automatic requeue) left unperformed. */
  next: WorkflowAdvanceInput | null;
};

export type S8CRepairWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  readonly line: S6ASession;
  readonly link: SessionWorkLinkRef;
  readonly owner: RepairActivationService;
  /** The platform's own record port the activation owner reads through. */
  readonly records: RepairActivationDependencies['records'];
  /** An owner over the same dependencies, with A3 wrappers when a row needs one. */
  createFaultOwner(overrides?: { records?: RepairActivationDependencies['records'];
    observation?: RepairActivationDependencies['observation'] }): RepairActivationService;
  pin(): Promise<ArchitectureCatalogPinV1>;
  writeRepair(input: { taskId?: string; ops: CatalogRepairOpV1[];
    moves?: RepairInputV1['responsibilityMoves'];
    /** One leading real `shell` call in the same model turn (the R5 `incomplete` footprint). */
    shell?: boolean }): Promise<S8CStagedRepair>;
  /**
   * The same write with the Run held at its next model request after the real
   * `record_note` call committed: the Run is running, the note is staged, and
   * the Workflow has not opened a bound check round. `release()` lets the
   * request go and resolves with the staged handle once the Workflow reaches
   * `open_checks`.
   */
  writeRepairHeld(input: { taskId?: string; ops: CatalogRepairOpV1[];
    moves?: RepairInputV1['responsibilityMoves'] }): Promise<S8CHeldRepair>;
  /** The real check PASS (no flag file), driven to `complete_task` and left unperformed. */
  pass(staged: S8CStagedRepair): Promise<S8CRepairOutcome>;
  /** The real check FAIL (flag file), driven to the automatic rework and left unperformed. */
  fail(staged: S8CStagedRepair): Promise<S8CRepairOutcome>;
  /** The public `verification/reverify`: a successor round on the same Run. */
  reverify(failed: S8CRepairOutcome, reason?: string): Promise<void>;
  /** The real `plans/propose`/`plans/apply` ending a Task (cancel/supersede). */
  endTask(taskId: string, disposition: 'cancelled' | 'superseded'): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** The one `repair_approval` card the real `decisions/queue` shows for the Goal. */
  readRepairCard(): Promise<DecisionCardV1>;
  /** The person's real `decisions/answer` for `card`, taking the current card's own source pins. */
  answerRepairCard(card: DecisionCardV1, optionId: 'approve' | 'reject', requestId: string): Promise<ResolveDecisionReadV1>;
  readNote(noteId: string): Promise<Record<string, unknown>>;
  readCatalog(): Promise<number>;
  /** The current catalog's module ids, from the same public architecture read as `readCatalog`. */
  readModules(): Promise<readonly string[]>;
  close(): Promise<void>;
};

async function pinOf(world: S6AHostWorld): Promise<ArchitectureCatalogPinV1> {
  const read = await world.platform.architecture.readArchitectureRevision(world.humanContext(),
    { selection: { kind: 'current' } });
  if (read.status !== 'ready') throw new Error(`S8C: the current architecture is not readable: ${JSON.stringify(read)}`);
  return catalogPinOf(read.value);
}

function repairDraftOf(pin: ArchitectureCatalogPinV1, ops: CatalogRepairOpV1[],
  moves: RepairInputV1['responsibilityMoves']): NoteDraftV1 {
  return { kind: 'repair', topic: `s8c-${ops.map(op => op.op).join('-')}`, conclusion: 'S8C repair',
    anchor: { kind: 'module', moduleId: 's6a-core' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'S8C repair body',
    repair: { pin, ops, responsibilityMoves: moves } } as NoteDraftV1;
}

function repairReceiptOf(receipts: readonly WorkflowStepReceipt[], kind: WorkflowStepReceipt['kind']):
Extract<WorkflowStepReceipt, { kind: typeof kind }> | undefined {
  return receipts.find((receipt): receipt is Extract<WorkflowStepReceipt, { kind: typeof kind }> => receipt.kind === kind);
}

/** One scripted model turn for a repair: an optional leading `shell`, then `record_note`. */
async function scriptRepair(world: S8CRepairWorld, pin: ArchitectureCatalogPinV1, noteCall: string,
  input: { ops: CatalogRepairOpV1[]; moves?: RepairInputV1['responsibilityMoves']; shell?: boolean }): Promise<void> {
  const calls = [
    ...(input.shell === true ? [{ callId: `${noteCall}-shell`, name: 'shell',
      args: { command: 'printf s8c > s8c-shell.txt' } }] : []),
    { callId: noteCall, name: 'record_note', args: { op: 'write',
      ...repairDraftOf(pin, input.ops, input.moves ?? []) } },
  ];
  await world.world.scripted.script(world.line, [
    { kind: 'calls', calls },
    { kind: 'text', text: 'S8C repair written' },
  ]);
}

type ScriptedToolMessage = { role: string; callId?: string; result?: unknown };

/** The real write receipt of the scripted `record_note` call, read from a model request's messages. */
function stagedWriteIn(messages: readonly ScriptedToolMessage[], noteCall: string) {
  const tool = messages.find(message => message.role === 'tool' && message.callId === noteCall);
  const write = tool?.role === 'tool'
    ? (tool.result as unknown as { output?: { kind: string; value?: { write?: { status?: string; noteId?: string; version?: number } } }[] })
      .output?.find(block => block.kind === 'json')?.value?.write : undefined;
  if (write?.status !== 'staged' || write.noteId === undefined || write.version === undefined) {
    throw new Error(`S8C: the repair write did not stage: ${JSON.stringify(tool)}`);
  }
  return { noteId: write.noteId, version: write.version };
}

async function stagedWriteOf(world: S8CRepairWorld, noteCall: string) {
  const requests = await world.world.scripted.requests(world.line);
  return stagedWriteIn(requests.at(-1)?.messages ?? [], noteCall);
}

function startedRunOf(receipts: readonly WorkflowStepReceipt[]): RunRef | undefined {
  const start = receipts.find((receipt): receipt is Extract<WorkflowStepReceipt, { kind: 'start' }> =>
    receipt.kind === 'start');
  return start !== undefined && start.result.status === 'ready' ? start.result.value.run.ref : undefined;
}

function openChecksOf(steps: readonly { next: WorkflowAdvanceInput | null }[]): WorkflowAdvanceInput {
  const openChecks = steps.at(-1)?.next;
  if (openChecks === undefined || openChecks === null || openChecks.kind !== 'perform'
    || openChecks.operation.kind !== 'open_checks') {
    throw new Error(`S8C: the Run did not reach open_checks: ${JSON.stringify(steps.at(-1))}`);
  }
  return openChecks;
}

/** A selected Task's Work Run to `open_checks`: the real `edit` then the real `record_note`. */
async function writeRepair(world: S8CRepairWorld, label: string,
  input: { taskId?: string; ops: CatalogRepairOpV1[]; moves?: RepairInputV1['responsibilityMoves']; shell?: boolean }) {
  const pin = await world.pin();
  const task = world.tasks.find(candidate => candidate.taskId === (input.taskId ?? world.tasks[0]!.taskId));
  if (task === undefined) throw new Error(`S8C: no such task ${String(input.taskId)}`);
  const noteCall = `s8c-note-${label}`;
  await scriptRepair(world, pin, noteCall, input);
  const claim = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId: `s8c-${label}`, sessionHint: world.line.ref, kind: 'select_work', taskId: task.taskId }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(world.world.ag2b, claim, { stopBefore: 'open_checks', receipts });
  const openChecks = openChecksOf(steps);
  const run = startedRunOf(receipts);
  if (run === undefined) throw new Error('S8C: the Run did not start');
  const write = await stagedWriteOf(world, noteCall);
  return { noteId: write.noteId, version: write.version, pin, task, run, openChecks };
}

/**
 * The same write while the Run is held at its next model request. The first
 * held request is the turn that calls `record_note`; the second is the turn
 * after its tool result, so the note is staged while the Run is still running
 * and no check round binds it yet.
 */
async function writeRepairHeld(world: S8CRepairWorld, label: string,
  input: { taskId?: string; ops: CatalogRepairOpV1[]; moves?: RepairInputV1['responsibilityMoves'] }): Promise<S8CHeldRepair> {
  const pin = await world.pin();
  const task = world.tasks.find(candidate => candidate.taskId === (input.taskId ?? world.tasks[0]!.taskId));
  if (task === undefined) throw new Error(`S8C: no such task ${String(input.taskId)}`);
  const noteCall = `s8c-note-${label}`;
  await scriptRepair(world, pin, noteCall, input);
  const claim = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId: `s8c-${label}`, sessionHint: world.line.ref, kind: 'select_work', taskId: task.taskId }, 'claim_task');
  const first = await world.world.gates.modelRequest(world.line);
  const second = await world.world.gates.modelRequest(world.line);
  const receipts: WorkflowStepReceipt[] = [];
  const driving = driveWorkflow(world.world.ag2b, claim, { stopBefore: 'open_checks', receipts });
  // The caller may fail before `release()` (for example on the queue read); the
  // abandoned drive still settles at close, so keep its rejection handled.
  driving.catch(() => undefined);
  await first.reached;
  first.release();
  const heldRequest = await second.reached;
  let write: { noteId: string; version: number };
  try {
    // The held request itself already carries the tool result; the scripted
    // request log only records a request once the model serves it.
    write = stagedWriteIn((heldRequest as unknown as { messages: ScriptedToolMessage[] }).messages, noteCall);
    // The Run is running, so its ref comes from the public Task graph, not from the start receipt.
    const graph = await world.main.route('tasks/query', { goalRef: world.goal }) as
      { status?: string; value?: { tasks?: Array<{ ref?: { taskId?: string }; execution?: RunRef | null }> } };
    const row = graph.status === 'ready'
      ? graph.value?.tasks?.find(candidate => candidate.ref?.taskId === task.taskId) : undefined;
    const running = row?.execution ?? null;
    if (running === null) throw new Error(`S8C: the held Run is not shown on the Task: ${JSON.stringify(graph)}`);
    return {
      noteId: write.noteId,
      version: write.version,
      release: async () => {
        second.release();
        const steps = await driving;
        return { noteId: write.noteId, version: write.version, pin, task, run: startedRunOf(receipts) ?? running,
          openChecks: openChecksOf(steps) };
      },
    };
  } catch (error) {
    second.release();
    await driving.catch(() => undefined);
    throw error;
  }
}

async function finish(world: S8CRepairWorld, staged: S8CStagedRepair,
  outcome: 'PASS' | 'FAIL'): Promise<S8CRepairOutcome> {
  if (outcome === 'FAIL') await writeFile(join(world.world.root, FAIL_FLAG), 'fail\n');
  else await rm(join(world.world.root, FAIL_FLAG), { force: true });
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(world.world.ag2b, staged.openChecks,
    { stopBefore: outcome === 'PASS' ? 'complete_task' : 'requeue_task', receipts });
  const finalize = repairReceiptOf(receipts, 'finalize_checks');
  if (finalize === undefined) throw new Error(`S8C: the Workflow did not finalize the check round: ${JSON.stringify(steps.at(-1))}`);
  return { staged, receipts, finalize: finalize as Extract<WorkflowStepReceipt, { kind: 'finalize_checks' }>,
    next: steps.at(-1)?.next ?? null };
}

async function goalRevision(world: S8CRepairWorld): Promise<number> {
  const read = await world.main.route('goals/read', world.goal) as { status?: string; value?: { goal?: { revision?: number } } };
  if (read.status !== 'ready' || read.value?.goal?.revision === undefined) {
    throw new Error(`S8C: the Goal is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.goal.revision;
}

async function repairGoalControl(world: S8CRepairWorld, command: 'pause' | 'resume'): Promise<void> {
  const revision = await goalRevision(world);
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: world.goal.projectId, goalId: world.goal.goalId };
  const body = await world.main.post('goals/control', graphWrite(S6A_SCOPE,
    { goalRef: world.goal, control: command, reason: null }, `s8c-${command}-${world.goal.goalId}`,
    [{ ref: world.goal, revision }, { ref: phaseRef, revision: 0 }]));
  const answer = body as { status?: string };
  if (answer.status !== 'committed') throw new Error(`S8C: goals/control ${command} did not commit: ${JSON.stringify(body)}`);
}

async function endTask(world: S8CRepairWorld, taskId: string, disposition: 'cancelled' | 'superseded'): Promise<void> {
  const plan = await world.main.activePlan(world.goal);
  if (plan === null) throw new Error('S8C: the Goal has no active Plan');
  const draft = { ...structuredClone(plan), goalId: plan.goalRef.goalId,
    planId: `${plan.planId}-s8c-end-${taskId}`, planRevision: plan.planRevision + 1,
    tasks: plan.tasks.map(task => task.taskId === taskId ? { ...task, disposition } : { ...task }) };
  const proposed = await world.main.post('plans/propose', graphWrite(world.main.scope, {
    goalRef: world.goal, basedOn: plan.ref, draft, reason: { text: `S8C end ${taskId}`, sources: [], affectedTaskIds: [taskId] },
  }, `s8c-end-${taskId}-propose`, [{ ref: world.goal, revision: await goalRevision(world) }])) as
    { status?: string; value?: { ref: unknown; revision: number; issues?: unknown[] } };
  if (proposed.status !== 'committed' || proposed.value === undefined) {
    throw new Error(`S8C: the ending proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await world.main.post('plans/apply', graphWrite(world.main.scope, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `s8c-end-${taskId}-apply`, [{ ref: world.goal, revision: await goalRevision(world) }])) as { status?: string };
  if (applied.status !== 'committed') throw new Error(`S8C: the ending adoption failed: ${JSON.stringify(applied)}`);
}

/** `plans/propose`+`apply` of the AG2b draft with every work Task declaring the `s6a-core` module. */
async function adoptModulePlan(main: S6ACardsWorkspace, goal: GoalRef, label: string, taskIds: readonly string[]) {
  const stage = { stageId: `s8c-${label}-stage`, title: `S8C ${label} stage` };
  const base = ag2bPlanDraft(taskIds);
  const draft = { ...base, planId: `s8c-plan-${label}`, goalId: goal.goalId, stages: [stage],
    tasks: base.tasks.map(task => task.taskKind === 'work'
      ? { ...task, stageId: stage.stageId, scope: { kind: 'module' as const, stageId: stage.stageId, moduleRef: 's6a-core' } }
      : task) };
  const goalPin = { ref: goal, revision: 1 };
  const proposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `S8C plan ${label}`, sources: [] },
  }, `s8c-plan-${label}-propose`, [goalPin])) as { status?: string; value?: { ref: unknown; revision: number } };
  if (proposed.status !== 'committed' || proposed.value === undefined) {
    throw new Error(`S8C: the plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `s8c-plan-${label}-apply`, [goalPin])) as { status?: string };
  if (applied.status !== 'committed') throw new Error(`S8C: the plan adoption failed: ${JSON.stringify(applied)}`);
  return taskIds.map(taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId }));
}

/** The trusted check that FAILs while the flag file exists: a real static command. */
function repairChecks() {
  return { ...checkConfiguration({ kind: 'human', id: OPERATOR.id }), configurationRevision: 's8c-repair-check@1',
    checks: [{ checkId: 's8c-repair-check', kind: 'static' as const,
      command: `node -e "process.exit(require('node:fs').existsSync('${FAIL_FLAG}')?1:0)"`,
      cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const }] };
}

/** Remove the real `RunActivity` records (and their cursor bindings) from a prepared commit. */
function withoutRunActivity(commit: PreparedCommit): PreparedCommit {
  const removed = new Set(commit.records.filter(record => record.schemaId.startsWith('RunActivity@'))
    .map(record => record.refKey));
  if (removed.size === 0) return commit;
  const { commitCursorBindings, ...rest } = commit;
  return { ...rest, records: commit.records.filter(record => !removed.has(record.refKey)),
    ...(commitCursorBindings === undefined ? {}
      : { commitCursorBindings: commitCursorBindings.filter(binding => !removed.has(binding.refKey)) }) };
}

/** Open W-A: one or two real Tasks, the line, the catalog, and the captured owner. */
export async function openS8CRepairWorld(options: { label: string; tasks?: readonly string[];
  backend?: 'memory' | 'sqlite';
  /** Drop the Run's activity record at its real end commit, leaving the missing-footprint state. */
  dropRunActivity?: boolean;
  /** Give the Work binding the Host's real `shell` grant (writeScope `['.']`, sandboxed workspace). */
  shell?: boolean }): Promise<S8CRepairWorld> {
  const tasks = options.tasks ?? ['t1'];
  let captured: GoalRecordTransactionPort & RecordLookupPort | null = null;
  let decisionOwner: DecisionMessageService | null = null;
  const realObserve = commitObserverModule.observeRecordCommits;
  const observeSpy = vi.spyOn(commitObserverModule, 'observeRecordCommits').mockImplementation(async (backend, observer) => {
    const observed = await realObserve(backend, observer);
    const realCommit = observed.records.commit;
    const dropActivity = options.dropRunActivity === true;
    const counting = { ...observed.records, commit: async (input: PreparedCommit) => {
      const prepared = dropActivity ? withoutRunActivity(input) : input;
      commits.count += 1; commits.identities.push(prepared.identityKey);
      return await realCommit(prepared);
    } } as typeof observed.records;
    captured = counting as unknown as GoalRecordTransactionPort & RecordLookupPort;
    return { ...observed, records: counting };
  });
  const realDecision = decisionServiceModule.createDecisionMessageService;
  const decisionSpy = vi.spyOn(decisionServiceModule, 'createDecisionMessageService').mockImplementation(deps => {
    const real = realDecision(deps);
    decisionOwner = real;
    return real;
  });
  let world: S6AHostWorld;
  const openHost = () => openS6AHostWorld({ backend: options.backend ?? 'memory',
    extraBindings: [{ binding: S7A_REPLY_TOOLS.binding, mergeTools: ['record_note'] }],
    extraHostOptions: { checks: repairChecks() } });
  try {
    world = options.shell === true
      ? await withConfiguredHost(openHost, original => configuredHostFactory(original))
      : await openHost();
  } finally {
    observeSpy.mockRestore();
    decisionSpy.mockRestore();
  }
  if (captured === null || decisionOwner === null) throw new Error('S8C: the platform did not build the captured owner');
  await world.setResumeOnStartup(false);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`s8c-${options.label}`, `S8C repair ${options.label}`)).ref;
  const taskRefs = await adoptModulePlan(main, goal, options.label, tasks);
  const created = await createS6BLine(main, { label: `s8c-${options.label}`, role: S6A_WORK_ROLE, tasks: taskRefs });
  const line = await sessionOf(world, created);
  const card = await world.readSession(line.ref);
  const link = card.links.find(entry => entry.until === null && entry.ref.relation === 'responsible');
  if (link === undefined) throw new Error('S8C: the line has no open responsible link');
  await mkdir(join(world.root, 'src'), { recursive: true });
  const records = captured as GoalRecordTransactionPort & RecordLookupPort;
  const dependenciesOf = (
    recordsPort: RepairActivationDependencies['records'],
    observation: RepairActivationDependencies['observation'],
  ): RepairActivationDependencies => ({
    records: recordsPort, observation,
    decisionMessages: {
      // G4 owns the `repair_approval` arm of DecisionSourceV1; bind the real
      // owner now with the object shape G4 will admit.
      readDecisionMessagePin: (ctx, input) =>
        (decisionOwner as DecisionMessageService).readDecisionMessagePin(ctx,
          { source: input.source as unknown as Parameters<DecisionMessageService['readDecisionMessagePin']>[1]['source'] }),
    },
    // The real task-facts, responsibility and duty readers the production
    // composition hands the planner; a `remove_module` activation needs them.
    catalogRevision: catalogRevisionDeps(world.platform, world.humanContext(),
      recordsPort as Parameters<typeof catalogRevisionDeps>[2]),
    now: () => world.clock.now(), eventId: () => randomUUID(), newId: () => randomUUID(),
  });
  // Normal rows use the one platform activator the composition built and the
  // Workflow's finalize / the answer path already trigger.
  const owner = world.platform.repairs;
  const handle = {
    world, main, goal, tasks: taskRefs, line, link: link.ref, owner, records,
    // Fault-location rows only: the same production owner with ONE dependency
    // replaced, built outside the platform so the fault is observable.
    createFaultOwner: (overrides: { records?: RepairActivationDependencies['records'];
      observation?: RepairActivationDependencies['observation'] } = {}) => createRepairActivationService(
      dependenciesOf(overrides.records ?? records, overrides.observation ?? world.platform.architecture)),
    pin: () => pinOf(world),
    writeRepair: (input: { taskId?: string; ops: CatalogRepairOpV1[]; moves?: RepairInputV1['responsibilityMoves'];
      shell?: boolean }) =>
      writeRepair(handle as unknown as S8CRepairWorld, `${options.label}-${String(repairSeq++)}`, input),
    writeRepairHeld: (input: { taskId?: string; ops: CatalogRepairOpV1[];
      moves?: RepairInputV1['responsibilityMoves'] }) =>
      writeRepairHeld(handle as unknown as S8CRepairWorld, `${options.label}-held-${String(repairSeq++)}`, input),
    pass: (staged: S8CStagedRepair) => finish(handle as unknown as S8CRepairWorld, staged, 'PASS'),
    fail: (staged: S8CStagedRepair) => finish(handle as unknown as S8CRepairWorld, staged, 'FAIL'),
    reverify: async (failed: S8CRepairOutcome, reason?: string) => {
      // The successor round's own check: the PASS target is the flag's absence
      // BEFORE the successor round freezes its source (a later removal would be
      // `frozen_source_changed`).
      await rm(join(world.root, FAIL_FLAG), { force: true });
      const result = failed.finalize.result;
      if (result.status !== 'committed') throw new Error('S8C: the FAIL round did not commit');
      const round = result.value.snapshot;
      if (round === undefined || round.status !== 'finalized') throw new Error('S8C: the FAIL round is not finalized');
      const refusal = { aggregateType: 'TaskReworkRefusal' as const, projectId: round.ref.projectId,
        goalId: round.ref.goalId, taskId: round.ref.taskId, operation: 'reverify' as const, subjectId: round.ref.roundId };
      const body = await handle.main.post('verification/reverify', graphWrite(S6A_SCOPE, {
        predecessorRoundRef: round.ref, reason: reason ?? 'S8C successor round' },
      `s8c-reverify-${round.ref.roundId}`, [{ ref: round.ref, revision: round.revision }, { ref: refusal, revision: 0 }]));
      const answer = body as { status?: string; code?: string; reason?: string };
      if (answer.status !== 'committed') throw new Error(`S8C: verification/reverify failed: ${JSON.stringify(answer)}`);
    },
    endTask: (taskId: string, disposition: 'cancelled' | 'superseded') =>
      endTask(handle as unknown as S8CRepairWorld, taskId, disposition),
    pause: () => repairGoalControl(handle as unknown as S8CRepairWorld, 'pause'),
    resume: () => repairGoalControl(handle as unknown as S8CRepairWorld, 'resume'),
    readRepairCard: async () => {
      const card = (await handle.main.readCards(handle.goal))
        .find(entry => entry.source.kind === 'repair_approval');
      if (card === undefined) throw new Error('S8C: the repair_approval card is missing');
      return card;
    },
    answerRepairCard: async (card: DecisionCardV1, optionId: 'approve' | 'reject', requestId: string) => {
      const saved = await handle.main.route('decisions/card', { source: card.source }) as
        { status?: string; value?: DecisionCardV1 };
      if (saved.status !== 'ready' || saved.value === undefined) {
        throw new Error(`S8C: the card is not readable: ${JSON.stringify(saved)}`);
      }
      const body = await handle.main.post('decisions/answer', graphWrite(handle.main.scope, {
        source: saved.value.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
      }, requestId, saved.value.source.pins)) as { status?: string; value?: ResolveDecisionReadV1 };
      if (body.status !== 'ready' || body.value === undefined) {
        throw new Error(`S8C: the answer ${requestId} is not ready: ${JSON.stringify(body)}`);
      }
      return body.value;
    },
    readNote: async (noteId: string) => {
      const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
      if (read.status !== 'ready') throw new Error(`S8C: note ${noteId} is not readable: ${JSON.stringify(read)}`);
      return read.value as unknown as Record<string, unknown>;
    },
    readCatalog: async () => {
      const read = await world.platform.architecture.readArchitectureRevision(world.humanContext(),
        { selection: { kind: 'current' } });
      if (read.status !== 'ready') throw new Error(`S8C: the catalog is not readable: ${JSON.stringify(read)}`);
      return read.value.catalog.ref.revision;
    },
    readModules: async () => {
      const read = await world.platform.architecture.readArchitectureRevision(world.humanContext(),
        { selection: { kind: 'current' } });
      if (read.status !== 'ready') throw new Error(`S8C: the catalog is not readable: ${JSON.stringify(read)}`);
      return read.value.catalog.catalog.modules.map(module => module.ref.moduleId);
    },
    close: async () => { await world.close(); },
  };
  return handle as unknown as S8CRepairWorld;
}

let repairSeq = 0;

/**
 * R9's two cross-Goal readers: a second real Goal with a work Task and a scribe
 * Task, both claimed through the public `platform.claims.claimTask`. The
 * contexts carry the RunRefs and RoleBindings the claim returned/persisted.
 */
export type S8COtherGoalReaders = {
  readonly goal: GoalRef;
  /** A real Work Run of the other Goal, claimed on `taskId`. */
  workCtx(taskId: string): Promise<CoreCallContext>;
  /** A real scribe Work Run of the other Goal. */
  scribeCtx(): Promise<CoreCallContext>;
};

export async function openS8COtherGoalReaders(world: S8CRepairWorld): Promise<S8COtherGoalReaders> {
  const main = world.main;
  const scope = main.scope;
  const goal = (await main.createGoal(`s8c-${world.goal.goalId}-r9-other`, 'S8C R9 other goal')).ref;
  const base = ag2bPlanDraft(['t1', 't2']);
  const draft = { ...base, planId: `s8c-r9-other-${world.goal.goalId}`, goalId: goal.goalId,
    tasks: [...base.tasks, { taskId: 't3', title: 'S8C R9 other scribe review',
      requirementLevel: 'required' as const, taskKind: 'work' as const, disposition: 'active' as const,
      phase: 'pending' as const, scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const }],
    assignments: [...(base.assignments ?? []), { taskId: 't3', role: S6A_SCRIBE_ROLE.templateId,
      instruction: 'S8C R9 other scribe review' }],
    obligations: base.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, 't3'] })) };
  const goalPin = { ref: goal, revision: 1 };
  const proposed = await main.post('plans/propose', graphWrite(scope, {
    goalRef: goal, basedOn: null, draft, reason: { text: 'S8C R9 other plan', sources: [] },
  }, `s8c-r9-other-propose-${goal.goalId}`, [goalPin])) as
    { status?: string; value?: { ref: unknown; revision: number } };
  if (proposed.status !== 'committed' || proposed.value === undefined) {
    throw new Error(`S8C R9: the other Goal's Plan was not proposed: ${JSON.stringify(proposed)}`);
  }
  const applied = await main.post('plans/apply', graphWrite(scope, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `s8c-r9-other-apply-${goal.goalId}`, [goalPin])) as { status?: string };
  if (applied.status !== 'committed') throw new Error(`S8C R9: the other Goal's Plan was not adopted: ${JSON.stringify(applied)}`);
  const plan = await main.activePlan(goal);
  if (plan === null) throw new Error('S8C R9: the other Goal has no adopted Plan');
  const planRef = plan.ref;
  const triples = (taskIds: readonly string[]): TaskTriple[] =>
    taskIds.map(taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId }));
  const workLines = new Map<string, { ref: SessionRef }>();
  for (const taskId of ['t1', 't2'] as const) {
    workLines.set(taskId, await createS6BLine(main, { label: `r9-other-work-${taskId}-${goal.goalId}`,
      role: S6A_WORK_ROLE, tasks: triples([taskId]) }));
  }
  const scribeLine = await createS6BLine(main, { label: `r9-other-scribe-${goal.goalId}`, role: S6A_SCRIBE_ROLE,
    tasks: triples(['t3']) });

  function contextOf(runRef: RunRef, roleBinding: RoleBindingRefV1): CoreCallContext {
    return { projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'work_run', runRef, roleBinding },
      materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal };
  }

  async function claim(line: { ref: SessionRef }, taskId: string, roleBinding: RoleBindingRefV1,
    requestId: string): Promise<CoreCallContext> {
    const card = await world.world.readSession(line.ref);
    const goalRead = await main.route('goals/read', goal) as { status?: string; value?: { goal?: { revision?: number } } };
    const registration = await main.route('workspaces/registration',
      { projectId: scope.projectId, workspaceId: scope.workspaceId }) as
      { status?: string; value?: { workspace?: { revision?: number } } };
    if (goalRead.status !== 'ready' || goalRead.value?.goal?.revision === undefined) {
      throw new Error(`S8C R9: the other Goal is not readable: ${JSON.stringify(goalRead)}`);
    }
    if (registration.status !== 'ready' || registration.value?.workspace?.revision === undefined) {
      throw new Error(`S8C R9: the workspace is not registered: ${JSON.stringify(registration)}`);
    }
    const result = await world.world.platform.claims.claimTask(world.world.humanContext(), {
      input: { goalRef: goal, planRef, taskId, sessionRef: line.ref, roleBinding,
        budget: { tokenBudget: 1_000_000, deadline: null } },
      meta: { requestId, expected: [
        { ref: goal, revision: goalRead.value.goal.revision },
        { ref: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
          revision: registration.value.workspace.revision },
        { ref: { aggregateType: 'Session', projectId: scope.projectId, sessionId: line.ref.sessionId },
          revision: card.record.revision },
      ] },
    }) as { status?: string; value?: { runRef?: RunRef } };
    if (result.status !== 'committed' || result.value?.runRef === undefined) {
      throw new Error(`S8C R9: the ${taskId} Run was not claimed: ${JSON.stringify(result)}`);
    }
    return contextOf(result.value.runRef, roleBinding);
  }

  return {
    goal,
    workCtx: taskId => {
      const line = workLines.get(taskId);
      if (line === undefined) throw new Error(`S8C R9: no work line for ${taskId}`);
      return claim(line, taskId, S6A_WORK_ROLE_BINDING, `s8c-r9-work-${taskId}`);
    },
    scribeCtx: () => claim(scribeLine, 't3', S6A_SCRIBE_ROLE_BINDING, 's8c-r9-scribe'),
  };
}

/** A raw `footprintProblem` call for the pure rows (the same predicate the owner uses). */
export { footprintProblem, plain };
