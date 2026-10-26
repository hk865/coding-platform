/**
 * K3 group 4: the ONE real `needs_decision` review-card world.
 *
 * It starts from the frozen S5 decision fixture, adopts a real second Plan
 * revision for Goal B with five extra work tasks through the real Plan owner,
 * and creates each `needs_decision` record through the ONE real blocked-Run
 * path plus the real `settleReview{review_unavailable}` owner. No review item,
 * draft, record, card or answer is hand-encoded.
 *
 * `openK3ReviewCardWorld` also builds the real review owner, the card source
 * (the caller may set its `pageLimit`, K3-20) and the decision read model over
 * the same records port. The next card/answer lanes import this one copy.
 */
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedCommit, EncodedDomainEvent, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import type {
  CollaborationChange, CollaborationDriver, CollaborationSnapshot,
} from '../../src/app/collaboration-driver.js';
import type { DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { KernelCommandReader, WorkspaceFileReader } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import type { PlanRevisionDraft, PlanRevisionRef, RuntimeTask } from '../../src/contracts/plan.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRecognizer } from '../../src/core/work-graph/model/command-recognition-contracts.js';
import type { KernelCommandFactV1 } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import type { DecisionActionsPort } from '../../src/business/workflow/decision-actions.js';
import { createDecisionActions, type DecisionApplicationAdapter } from '../../src/business/workflow/decision-actions.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { DecisionCardSourcePort, DecisionReadPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow, readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';
import { createCommandRerunRequestApplicationAdapter } from '../../src/business/workflow/decision-actions.js';
import {
  createCommandRerunRequestCardSource, createDecisionReadModel, createUnknownCallReviewCardSource,
} from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { readKernelCommandFacts as readProductionKernelCommandFacts } from '../../src/core/agent-runtime/context-assembler.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import {
  GOAL_B, PLAN_B2, T, WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture,
} from './S5-decision-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';
import { readToolSeam } from './K3-tool-seams.js';

/** The five extra work tasks the real Plan adoption adds to Goal B (K3-20). */
export const K3_REVIEW_TASKS = ['k3-20-a', 'k3-20-b', 'k3-20-c', 'k3-20-d', 'k3-20-e'] as const;

export type K3ReviewCardWorld = {
  kind: 'memory' | 'sqlite';
  fixture: S5DecisionFixture;
  records: S5DecisionFixture['records'];
  tasks: readonly string[];
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  /** K3 L19a: the real CommandRerunRequest owner over the SAME records. */
  commandRerun: ReturnType<typeof createCommandRerunRequestService>;
  /** The Kernel command text the fixture's narrow reader serves per callId. */
  kernelCommands: Map<string, KernelCommandFactV1>;
  /** The whole card/page reader (UCR + CRR sources). */
  cardSources: DecisionCardSourcePort[];
  /** K3 L19a: the request-card source (the UCR source stays `cardSource`). */
  commandRerunCardSource: DecisionCardSourcePort;
  decisions: ReturnType<typeof createDecisionMessageService>;
  /** The world's ONE real session mailbox (decision messages are written here). */
  mailbox: ReturnType<typeof createSessionMailbox>;
  decisionActions: DecisionActionsPort;
  applicationReceipt: (ctx: CoreCallContext, cursor: CommitCursor) => Promise<DecisionApplicationReceiptV1 | null>;
  /** K3-17 fault injection: fail the NEXT ③ commit (not ② or ①), with its rejection reason. */
  failNextApplicationCommit(reason?: string): void;
  /** K3-17 fault injection: fail the NEXT ③ receipt read. */
  failNextApplicationRead(): void;
  cardSource: DecisionCardSourcePort;
  readModel: DecisionReadPort;
  /**
   * F-100: the SAME real Goal settings owner the decision coordinator uses, over
   * the world's ONE records port. Its public `readGoalSettings`/`setGoalSettings`
   * reads and writes are how a row changes Goal CONTENT between ① and ②.
   */
  goalSettings: ReturnType<typeof createGoalSettingsService>;
  /**
   * A real review record for `taskId`. Default: the real blocked Run plus the
   * real `settleReview{review_unavailable}` -> `needs_decision`; `autoSettled`:
   * the real read-only Run that settles `resolved` at creation.
   */
  createRecord(taskId: string, options?: { autoSettled?: boolean }): Promise<UnknownCallReviewV1>;
  close(): Promise<void>;
};

function workTask(taskId: string): RuntimeTask {
  return { taskId, title: `K3 review work ${taskId}`, requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };
}

async function extendPlan(f: S5DecisionFixture): Promise<void> {
  const base = f.plans.B1;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: PLAN_B2.planId, planRevision: 2, goalId: GOAL_B.goalId,
    stages: structuredClone(base.stages),
    tasks: [...base.tasks.map(task => ({ ...task })), ...K3_REVIEW_TASKS.map(workTask)],
    assignments: [...(base.assignments ?? []).map(entry => ({ ...entry })),
      ...K3_REVIEW_TASKS.map(taskId => ({ taskId, role: 'builder', instruction: `Execute ${taskId}` }))],
    obligations: base.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, ...K3_REVIEW_TASKS],
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [],
  };
  const goal = await f.b2.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const proposed = await f.b2.base.plans.proposePlan(f.ctx, { input: {
    goalRef: GOAL_B, basedOn: base.ref, draft, reason: { text: 'K3 review card five work tasks', sources: [] },
  }, meta: { requestId: 'k3-review-card-propose', expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`the K3 review-card plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await f.b2.base.plans.applyPlanChange(f.ctx, { input: {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, meta: { requestId: 'k3-review-card-apply', expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (applied.status !== 'committed') throw new Error(`the K3 review-card plan adoption failed: ${JSON.stringify(applied)}`);
}

export async function openK3ReviewCardWorld(
  kind: 'memory' | 'sqlite',
  options: { pageLimit?: number; realKernelCommandFacts?: boolean;
    /** Optional real recognizer for the CRR owner; default is the exact-sha seam. */
    commandRecognizer?: CommandRecognizer;
    /**
     * F-072/F-073/F-100 narrow A2/A3 seam: a DELEGATING wrapper the caller
     * installs around the world's ONE real records backend before any owner is
     * built, so every owner this world builds (the CRR owner, the decision
     * coordinator, the card readers) shares the same faulting port. The wrapper
     * must delegate every other call to `records`. Absent, the world uses the
     * real backend unchanged; no existing caller's wiring changes.
     */
    wrapRecords?: (records: S5DecisionFixture['records']) => S5DecisionFixture['records'] } = {},
): Promise<K3ReviewCardWorld> {
  const fixture = await openS5DecisionFixture(kind);
  await extendPlan(fixture);
  // The ONE records backend the owners below read and commit through. With no
  // wrapper it is the fixture's own port (identity preserved).
  const records = options.wrapRecords === undefined ? fixture.records : options.wrapRecords(fixture.records);
  const reads = createRunStateReader({ records });
  // Default: a PORT DOUBLE, not a fabricated record (lead answer 3): the narrow
  // Kernel command reader serves only the command/cwd each fixture test declared
  // through `world.kernelCommands`. A callId with no declared fact is a real
  // `not_found` rejection, never a silent `echo k3-fixture` default.
  const kernelCommands = new Map<string, KernelCommandFactV1>();
  let readKernelCommandFacts: KernelCommandReader = async (_ctx, { calls }) => {
    const value = new Map<string, KernelCommandFactV1>();
    for (const call of calls) {
      const fact = kernelCommands.get(call.callId);
      if (fact === undefined) {
        return { status: 'rejected', code: 'not_found', reason: 'the Kernel command fact is not available' };
      }
      value.set(call.callId, fact);
    }
    return { status: 'ready', value };
  };
  if (options.realKernelCommandFacts === true) {
    // The production reader over the SAME Kernel store the S5 fixture writes:
    // the command/cwd comes from the real `assistant.message_completed` record,
    // never from a test-written map.
    const kernelStores = await createKernelStoreRegistry({ entries: [{
      adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: fixture.base.scope,
      databasePath: join(fixture.base.directory, 's5-kernel.sqlite'),
    }] });
    readKernelCommandFacts = (ctx, input) => readProductionKernelCommandFacts({ kernelStores, kernel }, ctx, input);
  }
  // Port double: the fixture workspace has no package.json, so expansions are
  // `unavailable` and the disposition still writes the blocked command.
  const readWorkspace: WorkspaceFileReader = {
    async readWorkspace() {
      return { status: 'rejected', code: 'not_found', reason: 'the K3 fixture has no package.json' };
    },
  };
  let sequence = 0;
  const nextSequence = (): number => { sequence += 1; return sequence; };
  let decisionReader: ReturnType<typeof createDecisionMessageService> | null = null;
  const reviews = createUnknownCallReviewService({ records, reads,
    readAnswerText: async (ctx, { source }) => {
      if (decisionReader === null) {
        return { status: 'rejected', code: 'unavailable', reason: 'the decision messages are not bound yet' };
      }
      const read = await decisionReader.readDecisionAnswer(ctx, { source });
      if (read.status !== 'ready') return read;
      return { status: 'ready', value: read.value.body === null ? null : read.value.body.text };
    },
    taskProjection: async (_ctx, task) => {
      const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
      const window = await readGoalPlanWindow(records, goalRef);
      if (window.status !== 'ready') return window;
      if (window.plan === null) return { status: 'rejected', code: 'not_found', reason: 'no active Plan' };
      return readCanonicalTaskFacts(records, goalRef, window.plan, task.taskId);
    },
    readKernelCommandFacts, readWorkspace,
    now: () => T, eventId: () => `k3-review-card-review-${String(nextSequence())}` });
  // K3 L19a: the real CommandRerunRequest owner. Its default recognizer is the
  // test's exact-sha seam over the REAL review record's blockedCommands (the
  // production recognizer is the hook's one parser/expansion; the owner is the
  // same). A row that needs action/expansion recognition passes the production
  // recognizer as an option; every existing caller keeps the default.
  const exactShaRecognizer: CommandRecognizer = async (_ctx, { records, command }) => {
    const sha = commandSha256(command);
    for (const record of records) {
      for (const blocked of record.blockedCommands) {
        if (blocked.commandSha256 === sha) {
          return { status: 'ready', value: { reviewRunId: blocked.reviewRunId, alias: blocked.alias,
            commandSha256: sha, match: { kind: 'exact', ...(blocked.actions[0] === undefined
              ? {} : { action: blocked.actions[0] }) } } };
        }
      }
    }
    return { status: 'ready', value: null };
  };
  const commandRerun = createCommandRerunRequestService({
    records,
    listTaskReviews: async (ctx, { goalRef, taskId }) => {
      const page = await reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
        filter: { goalRef, taskId }, page: { limit: 200 } });
      return page.status === 'ready' ? { status: 'ready', value: page.value.items } : page;
    },
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    recognize: options.commandRecognizer ?? exactShaRecognizer,
    now: () => T, eventId: () => `k3-review-card-crr-${String(nextSequence())}` });
  // K3 B1: the real finite-coordinator owners over the SAME records store. The
  // UCR adapter is the production wiring's ONE `unknown_call_review` row.
  const faults = { applicationCommit: [] as string[], applicationRead: 0 };
  const decisionRecords = {
    ...records,
    async lookupCommit(input: Parameters<S5DecisionFixture['records']['lookupCommit']>[0]) {
      if (faults.applicationRead > 0 && input.identityKey.startsWith('session-message-decision-application:')) {
        faults.applicationRead -= 1;
        return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected ③ receipt read failure' };
      }
      return records.lookupCommit(input);
    },
    async commit(input: Parameters<S5DecisionFixture['records']['commit']>[0]) {
      if (faults.applicationCommit.length > 0
        && input.identityKey.startsWith('session-message-decision-application:')) {
        return { status: 'rejected' as const, code: 'unavailable' as const,
          reason: faults.applicationCommit.shift() ?? 'injected ③ commit failure' };
      }
      return records.commit(input);
    },
  } as S5DecisionFixture['records'];
  const materialReaders = createMaterialRecordReaders(decisionRecords);
  const materials = createMaterialService({ bodies: fixture.bodies, authority: materialReaders.authority, now: () => T });
  let decisionSequence = 0;
  const nextDecisionId = (): string => `k3-review-card-decision-${String(++decisionSequence)}`;
  const mailboxDeps: SessionMailboxDependencies = {
    defaultInquiryDeadlineMs: 86_400_000,
    records: decisionRecords, materials, now: () => T, newId: nextDecisionId,
    systemActor: fixture.operatorActor,
    sessions: createSessionDirectory({ records: decisionRecords, lookups: fixture.records }),
    executions: createRunStateReader({ records: decisionRecords }),
    roles: createRoleConfigurationService({ records: decisionRecords, now: () => T, eventId: nextDecisionId }),
    duties: {
      async readMessageDutiesFacts() {
        return { status: 'ready' as const, value: {
          duties: [...fixture.duties], readOnlyCopy: false, independentReview: false, guards: [],
        } };
      },
    },
  };
  const mailbox = createSessionMailbox(mailboxDeps);
  const decisionSources = createDecisionSourceFacts({ records: decisionRecords,
    plans: fixture.b2.base.plans, unknownCallReviews: reviews,
    commandRerunRequests: commandRerun, readKernelCommandFacts, commandRerunExecutions: reads });
  const decisions = createDecisionMessageService({ records: decisionRecords, now: () => T, newId: nextDecisionId,
    operatorActor: fixture.operatorActor, messages: mailbox, materials,
    messageWrites: createMessageWriteOwner(mailboxDeps), sources: decisionSources });
  decisionReader = decisions;
  const applicationReceipt = async (_ctx: CoreCallContext, cursor: CommitCursor):
  Promise<DecisionApplicationReceiptV1 | null> => {
    let located;
    try { located = await decisionRecords.eventAt(cursor); } catch { return null; }
    if (located.status !== 'ready') return null;
    try {
      const parsed = JSON.parse(located.value.event.json) as { identityKey?: unknown; fingerprint?: unknown };
      if (typeof parsed.identityKey !== 'string' || parsed.identityKey.length === 0
        || typeof parsed.fingerprint !== 'string' || parsed.fingerprint.length === 0) return null;
      return { identityKey: parsed.identityKey, fingerprint: parsed.fingerprint, cursor };
    } catch { return null; }
  };
  const goalSettings = createGoalSettingsService({ records: decisionRecords, now: () => T,
    newId: nextDecisionId, operatorActor: fixture.operatorActor });
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
      answerDecision: decisions.answerDecision.bind(decisions),
      readDecisionAnswer: decisions.readDecisionAnswer.bind(decisions),
      recordDecisionApplication: decisions.recordDecisionApplication.bind(decisions),
    },
    applicationReceipt,
    decisionApplications: {
      unknown_call_review: reviewAdapter,
      command_rerun_request: createCommandRerunRequestApplicationAdapter(commandRerun),
    },
  });
  const cardSource = createUnknownCallReviewCardSource({ records, reviews,
    ...(options.pageLimit === undefined ? {} : { pageLimit: options.pageLimit }) });
  const commandRerunCardSource = createCommandRerunRequestCardSource({ records,
    requests: commandRerun, reviews, executions: reads, readKernelCommandFacts,
    ...(options.pageLimit === undefined ? {} : { pageLimit: options.pageLimit }) });
  const cardSources = [cardSource, commandRerunCardSource];
  // The production executed-files reader over the SAME records: the S5 fixture
  // registers RUN_ACTIVITY_RECORD_SCHEMAS (with the ordered
  // `s2b-run-activity-by-goal-last` index) and forwards the backend's real
  // `lookupOrdered` through its observed port (S5-decision-fixture.ts
  // `additionalSchemas`, `forwarded`, `observeRecords`).
  const readModel = createDecisionReadModel({ records, cardSources, noticeSources: [],
    conflicts: createGoalConflictAssembler({ records,
      catalog: createArchitectureCatalogService({ records }), executedFiles: createGoalExecutedFilesReader({ records }) }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)) });
  createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'k3-review-card-host', lease: 'owned', takeover: { kind: 'hl01_no_lock' } },
    now: () => T, eventId: () => `k3-review-card-event-${String(nextSequence())}` });

  const world: K3ReviewCardWorld = {
    kind, fixture, records, tasks: K3_REVIEW_TASKS, reviews, commandRerun, kernelCommands,
    cardSources, decisions, mailbox, decisionActions, goalSettings,
    applicationReceipt, cardSource, commandRerunCardSource, readModel,
    failNextApplicationCommit: (reason?: string) => {
      faults.applicationCommit.push(reason ?? 'injected ③ commit failure');
    },
    failNextApplicationRead: () => { faults.applicationRead += 1; },
    createRecord: (taskId, recordOptions) => createK3NeedsDecisionRecord(world, taskId, recordOptions),
    close: () => fixture.close(),
  };
  return world;
}

/**
 * K3 L19a/B2-08: end one Task through the real Plan owner (a new adopted
 * revision with the Task's disposition changed). No task record is hand-edited.
 */
export async function setK3TaskDisposition(
  world: K3ReviewCardWorld, taskId: string, disposition: 'active' | 'cancelled' | 'superseded',
): Promise<void> {
  const f = world.fixture;
  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error('the active Plan is not readable');
  const plan = window.plan;
  const goal = await f.b2.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(JSON.stringify(goal));
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${plan.planId}-end-${String(plan.planRevision + 1)}`, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages),
    tasks: plan.tasks.map(task => task.taskId === taskId ? { ...task, disposition } : { ...task }),
    assignments: [...(plan.assignments ?? [])].map(entry => ({ ...entry })),
    obligations: plan.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds],
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
    taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    ...(plan.schemaVersion === 2 ? {
      taskRelations: [...(plan.taskRelations ?? [])].map(relation => ({ ...relation })),
      inputRequirements: [...(plan.inputRequirements ?? [])].map(requirement => ({ ...requirement })),
    } : {}),
  };
  const proposed = await f.b2.base.plans.proposePlan(f.ctx, { input: {
    goalRef: GOAL_B, basedOn: plan.ref, draft, reason: { text: `K3 end task ${taskId}`, sources: [], affectedTaskIds: [taskId] },
  }, meta: { requestId: `k3-review-card-end-${taskId}-${String(plan.planRevision + 1)}-propose`, expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`the task-ending plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await f.b2.base.plans.applyPlanChange(f.ctx, { input: {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, meta: { requestId: `k3-review-card-end-${taskId}-${String(plan.planRevision + 1)}-apply`,
    expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (applied.status !== 'committed') throw new Error(`the task-ending plan adoption failed: ${JSON.stringify(applied)}`);
}

/**
 * The real ordinary card for `taskId`. `autoSettled: true` is the real
 * read-only Run that settles `resolved` at creation (two callers). The default
 * is the real blocked Run (`createK3PendingReview`: production claim/prepare/
 * Runtime start with §5.1's shell stand-in, the production Host RUN-20/RUN-22
 * read of that Kernel Turn, then the Runtime's own end) settled by the real
 * `settleReview{review_unavailable}` to `needs_decision`. No item, draft or
 * event is an input, and no record is hand-encoded.
 */
export async function createK3NeedsDecisionRecord(
  world: K3ReviewCardWorld, taskId: string,
  options: { autoSettled?: boolean; goalRef?: GoalRef; planRef?: PlanRevisionRef } = {},
): Promise<UnknownCallReviewV1> {
  if (!(K3_REVIEW_TASKS as readonly string[]).includes(taskId)) {
    throw new Error(`K3 review fixture: unknown task ${taskId}`);
  }
  if (options.autoSettled === true) return await createAutoSettledK3Record(world, taskId);
  // Imported lazily: `K3-proposal-round` imports this module's world, so a
  // static import would close the cycle.
  const { createK3PendingReview, settleK3Review } = await import('./K3-proposal-round.js');
  const pending = await createK3PendingReview(world, {
    taskId, label: `k3-review-card-${taskId}`,
    callId: `k3-review-card-call-${taskId}`, command: `echo ${taskId}`,
    ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
    ...(options.planRef === undefined ? {} : { planRef: options.planRef }),
  });
  const settled = await settleK3Review(world, pending, {
    cause: 'review_unavailable', requestId: `k3-review-card-unavailable-${taskId}`,
  });
  if (settled.status !== 'needs_decision') {
    throw new Error(`the real settlement produced ${settled.status}, not needs_decision`);
  }
  return settled;
}

/**
 * The auto-settled variant: a REAL Run through the shared harness. A Session is
 * claimed and entered by the production Runtime, the scripted model asks the
 * one `read` tool, the Kernel records the real Turn, and the production
 * RUN-20/RUN-22 path creates the record from that draft. The draft reader
 * observes an unresolved READ-ONLY call `no_review_needed` by the platform, so
 * the complete inventory settles `resolved` with no disposition. Nothing is
 * built here: no item, draft, terminal event or record.
 *
 * `readToolSeam` (the `read` stand-in) holds the call until `createRecord` has
 * read the in-flight draft, then it is released and the Runtime ends the Run.
 */
async function createAutoSettledK3Record(
  world: K3ReviewCardWorld, taskId: string,
): Promise<UnknownCallReviewV1> {
  // Imported lazily: the shared harness imports this module's world type and
  // the proposal-round helper chain, so a static import would close the cycle.
  const { openRealRunHarness } = await import('./K3-35-continuation-fixture.js');
  const f = world.fixture;
  const harness = await openRealRunHarness(world);
  try {
    const session = await f.createS5Session(`k3-auto-settled-${taskId}`);
    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId,
      requestId: `k3-auto-settled-claim-${taskId}` });
    // Arm before prepare so the tool registry builds the blocking `read`.
    readToolSeam.arm();
    const run = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'calls', calls: [{ callId: `k3-auto-${taskId}`,
        name: 'read', args: { path: `src/k3-auto-${taskId}.ts` } }] }]),
      tools: ['read'], writeScope: [], blockOnShell: false,
    });
    try {
      // `prepareAndStart` returns at `startRun`; the record can only be read
      // once the production entry is past authorize/begin and the Kernel call
      // is in flight, which is exactly when the seam handler is held.
      await readToolSeam.waitForCall();
      return await harness.createRecord(claim);
    } finally {
      readToolSeam.release();
      await run.started;
    }
  } finally {
    readToolSeam.release();
    await harness.closeUnion();
  }
}

/**
 * The ONE predicate behind every K3 store-fault wrapper: the batch carries a
 * committed disposition (`UnknownCallReviewChanged` whose body's `change` is
 * `disposition_applied`). Shared by the K3-17/K3-46/K3-UR7 wrappers so the
 * predicate is written once.
 */
function dispositionAppliedEvent(batch: PreparedCommit): EncodedDomainEvent | undefined {
  return batch.events.find((event) => {
    if (event.eventType !== 'UnknownCallReviewChanged') return false;
    const body = JSON.parse(event.json) as { change?: unknown };
    return body.change === 'disposition_applied';
  });
}

/**
 * The ONE commit-interception wrapper: every commit is delegated unchanged
 * except the one that carries a disposition, which the caller handles (runs the
 * real Goal pause first, rejects it with a store-failure, inspects the real
 * result, …). The caller always decides whether the real commit still runs.
 */
export function interceptDispositionCommits(
  records: K3ReviewCardWorld['records'],
  intercept: (input: {
    batch: PreparedCommit;
    event: EncodedDomainEvent;
    commit: () => Promise<StoreCommitReceipt>;
  }) => Promise<StoreCommitReceipt>,
): K3ReviewCardWorld['records'] {
  return {
    ...records,
    async commit(batch: PreparedCommit): Promise<StoreCommitReceipt> {
      const event = dispositionAppliedEvent(batch);
      if (event === undefined) return records.commit(batch);
      return intercept({ batch, event, commit: () => records.commit(batch) });
    },
  } as K3ReviewCardWorld['records'];
}

/**
 * K3-46/UR7 item 1 setup: adopt one real Plan revision whose Task order puts
 * the K3 review tasks first, so an ORDINARY advance reaches a review Task
 * before the fixture's already-running Tasks. Only the plan id, the request-id
 * prefix and the reason text differ between the two callers.
 */
export async function adoptReorderedPlan(
  world: K3ReviewCardWorld,
  options: { planId: string; requestIdPrefix: string; reasonText: string },
): Promise<void> {
  const f = world.fixture;
  const plans = f.b2.base.plans;
  const goal = await plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal read failed: ${JSON.stringify(goal)}`);
  const graph = await plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B });
  if (graph.status !== 'ready') throw new Error(`the Task graph read failed: ${JSON.stringify(graph)}`);
  const tasks = graph.value.plan.tasks;
  const review = tasks.filter(task => (K3_REVIEW_TASKS as readonly string[]).includes(task.taskId));
  const other = tasks.filter(task => !(K3_REVIEW_TASKS as readonly string[]).includes(task.taskId));
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: options.planId, planRevision: 3, goalId: GOAL_B.goalId,
    stages: structuredClone(graph.value.plan.stages),
    tasks: [...review.map(task => ({ ...task })), ...other.map(task => ({ ...task }))],
    assignments: (graph.value.plan.assignments ?? []).map(entry => ({ ...entry })),
    obligations: graph.value.plan.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds],
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await plans.proposePlan(f.ctx, { input: { goalRef: GOAL_B, basedOn: PLAN_B2, draft,
    reason: { text: options.reasonText, sources: [] } },
    meta: { requestId: `${options.requestIdPrefix}-propose`, expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`the reordered proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await plans.applyPlanChange(f.ctx, { input: {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  meta: { requestId: `${options.requestIdPrefix}-apply`, expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (applied.status !== 'committed') throw new Error(`the reordered adoption failed: ${JSON.stringify(applied)}`);
}

/**
 * The real review owner over `records` (a store-fault wrapper in the K3-46 and
 * K3-UR7 races). Only the event-id prefix differs between the callers.
 */
export function reviewServiceOver(
  world: K3ReviewCardWorld,
  records: K3ReviewCardWorld['records'],
  options: { eventIdPrefix: string },
) {
  let sequence = 0;
  return createUnknownCallReviewService({ records, reads: createRunStateReader({ records }),
    readAnswerText: async (ctx: CoreCallContext, { source }) => {
      const read = await world.decisions.readDecisionAnswer(ctx, { source });
      if (read.status !== 'ready') return read;
      return { status: 'ready', value: read.value.body === null ? null : read.value.body.text };
    },
    taskProjection: async (_ctx, task) => {
      const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
      const window = await readGoalPlanWindow(records, goalRef);
      if (window.status !== 'ready') return window;
      if (window.plan === null) return { status: 'rejected', code: 'not_found' as const, reason: 'no active Plan' };
      return readCanonicalTaskFacts(records, goalRef, window.plan, task.taskId);
    },
    now: () => world.fixture.now(), eventId: () => `${options.eventIdPrefix}${String(++sequence)}` });
}

export type K3DriverSettledWaiter = {
  /** Installed at driver creation; a change only wakes the wait. */
  onChange: (change: CollaborationChange) => void;
  /** Read once immediately; if not settled, wake on the driver's change notice, then read again. */
  waitForSettledDriver: (driver: CollaborationDriver, ctx: CoreCallContext) => Promise<CollaborationSnapshot>;
};

/**
 * The A3 change-notice wait: no sleep polling. The driver's `onChange` is
 * installed when the driver is created; every read is authoritative through
 * `driver.read`. A notice that arrives before the wait is kept until consumed;
 * `failureText` is the same bounded refusal the two polling copies raised.
 */
export function createDriverSettledWaiter(
  options: { failureText: string; timeoutMs?: number },
): K3DriverSettledWaiter {
  let notified = false;
  let waiters: (() => void)[] = [];
  const settled = (state: CollaborationSnapshot['state']): boolean =>
    state === 'waiting' || state === 'completed' || state === 'failed' || state === 'stopped';
  const nextChange = (): Promise<void> => new Promise<void>((resolve) => {
    if (notified) { notified = false; resolve(); return; }
    waiters.push(resolve);
  });
  return {
    onChange: () => {
      if (waiters.length === 0) { notified = true; return; }
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    },
    async waitForSettledDriver(driver, ctx) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiration = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(options.failureText)), options.timeoutMs ?? 10_000);
      });
      try {
        for (;;) {
          const read = await driver.read(ctx, { goalRef: GOAL_B });
          if (read.status === 'ready' && settled(read.value.state)) return read.value;
          await Promise.race([nextChange(), expiration]);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
