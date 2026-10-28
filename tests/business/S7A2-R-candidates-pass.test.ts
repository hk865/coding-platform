/**
 * R-candidates, pass part (book `:723`; SR3 (a), 〔L5〕, 〔a-12〕): the release step's selection, its single owner call and
 * the pass's own skip carry, driven through the real `advanceWork` on both backends.
 *
 * Composition: one real ledger — the same public `createTaskClaimFixture` call the C1 pattern makes, with the full
 * message schema set (its `lookups` carry `s7a2-release-by-*`) and the note schemas (`CurrentPointer`), so the one store
 * serves both the candidate page and the dispatch basis — the real Runtime start that keeps the sending Run
 * running/entered, the real mailbox and dispatch-basis owners, R's own `createMessageReleaseOwner`, and the real
 * `createWorkflow` with that owner injected as `messageRelease`. Every message is a real send and every approval the
 * real `releaseMessage`; the plan move is the real Plan owner's propose + apply. No store read is an assertion.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { sameJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { SessionMailboxDependencies, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalSettingsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createMaterialRecordReaders, QUERY_RUN_RECORD_SCHEMA } from '../../src/core/work-graph/materials/record-readers.js';
import { createRecipientExecutions } from '../../src/core/work-graph/sessions/recipient-executions.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox, createMessageWriteOwner } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createMessageReleaseOwner } from '../../src/core/work-graph/communication/message-release.js';
import { createDispatchBasisReader } from '../../src/core/work-graph/tasks/dispatch-basis.js';
import { createGoalPointerFacts } from '../../src/core/work-graph/views/pointer-facts.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS, SESSION_MESSAGE_RELEASED_EVENT_TYPE, sessionMessageRefKey,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_ACTIVITY_SCHEMAS } from '../../src/core/work-graph/sessions/session-activity.js';
import { NOTE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/note-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { DISPATCH_COUNTER_SCHEMAS } from '../../src/core/work-graph/persistence/dispatch-counter-codecs.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { sessionActivityRefOf } from '../../src/core/work-graph/sessions/session-activity.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import {
  QUERY_RUN_BY_SESSION_LOOKUP, SLICE1_LOOKUP_INDEXES, WORK_EXECUTION_BY_SESSION_LOOKUP,
} from '../../src/core/work-graph/model/session-facts-contracts.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowPort } from '../../src/business/workflow/ports.js';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceInternal,
} from '../../src/business/workflow/contracts.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { mailboxDependencies, ready, committed } from '../helpers/S5-queue-support.js';
import type { AdvanceValue } from '../helpers/A2-restart-fixture.js';

const AT = '2026-10-28T00:00:00.000Z';
const SESSION_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const unsupported = async (reason: string) => ({ status: 'rejected' as const, code: 'unsupported' as const, reason });

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const one of opened.splice(0)) await one.close().catch(() => undefined); });

type ReleaseRecords = Parameters<typeof createMessageReleaseOwner>[0]['records'];

/** The one real ledger and every owner this row drives; all of them are built over the fixture's ONE records port. */
async function ledger(kind: 'memory' | 'sqlite') {
  const fixture = await createTaskClaimFixture(kind, {
    records: [...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
      ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...SESSION_ACTIVITY_SCHEMAS.records, QUERY_RUN_RECORD_SCHEMA,
      ...NOTE_RECORD_SCHEMAS.records, ...DISPATCH_COUNTER_SCHEMAS.records],
    events: [...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...SESSION_ACTIVITY_SCHEMAS.events, ...DECISION_RECORD_SCHEMAS.events],
    lookups: [...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
      ...(EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? []), ...(MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []),
      ...SLICE1_LOOKUP_INDEXES.filter((index) =>
        index.name === WORK_EXECUTION_BY_SESSION_LOOKUP || index.name === QUERY_RUN_BY_SESSION_LOOKUP)],
  });
  const claim = committed(await fixture.service.claimTask(fixture.ctx,
    await fixture.buildRequest({ requestId: 's7a2-pass-claim' })));
  let tick = 0;
  const now = () => new Date(Date.parse(AT) + (++tick) * 1000).toISOString();
  let seq = 0;
  const eventId = () => `s7a2-pass-event-${++seq}`;
  const newId = () => `s7a2-pass-id-${++seq}`;
  const records = fixture.records;
  const bodies = kind === 'sqlite' ? createSqliteRawArtifactStore(join(fixture.directory, 's7a2-pass-bodies.sqlite'))
    : new RawArtifactBodyStore();
  const { authority } = createMaterialRecordReaders(records);
  const executions = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });

  // The trusted Host grant the real Runtime start and the mailbox admission both re-check.
  const hostTemplate: PreparedTaskManifestV1['hostTemplate'] = {
    templateId: 'builder', revision: '1', digest: sha256Hex('s7a2-pass-trusted-host-template') };
  const configurationRevision = 's7a2-pass-host-config@1';
  const hostPermissions = { policyRevision: fixture.roleBinding.policyRevision,
    tools: [...SESSION_MAILBOX_TOOL_NAMES], writeScope: [] as string[] };
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== claim.sessionRef.projectId || ctx.workspaceId !== claim.workspaceId
      || !sameJson(input.sessionRole, SESSION_ROLE) || !sameJson(input.hostTemplate, hostTemplate)
      || !sameJson(input.run.ref, claim.runRef) || !sameJson(input.permissions, hostPermissions)
      || input.configurationRevision !== configurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'the pass Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: input.configurationRevision,
      permissions: structuredClone(hostPermissions), hostTemplate: structuredClone(hostTemplate) } };
  };
  // The real Runtime start: the scripted model's first request stays held, so the sending Run is running/entered.
  const steps = await createS2BRuntimeSteps({ base: fixture, bodies, ctx: fixture.ctx, directory: fixture.directory,
    scope: fixture.scope, now, setClock: () => undefined, eventId, newId, consumerId: 's7a2-pass-runtime',
    withMailbox: true, host: { configurationRevision, permissions: hostPermissions, hostTemplate } });
  const handle = await steps.start(claim, { at: AT, replies: [{ kind: 'text', text: 'S7A2 pass held request' }],
    tools: [...SESSION_MAILBOX_TOOL_NAMES] });
  await handle.entered;
  const run = ready(await executions.readExecution(fixture.ctx, claim.runRef)).run;
  const workspaceId = run.workspaceSnapshot.workspaceId;

  /**
   * The shared S5 builder is the one copy of "assemble the mailbox dependency bag". This row only rebinds the ports
   * and the Host grant its own ledger carries (the shared builder's admission belongs to the S5 world).
   */
  function depsOver(over: ReleaseRecords = records as unknown as ReleaseRecords): SessionMailboxDependencies {
    const common = mailboxDependencies({ records: over, bodies, now, newId } as unknown as S5DecisionFixture);
    delete common.duties;
    return {
      ...common,
      records: over as unknown as SessionMailboxDependencies['records'], now, newId,
      systemActor: { kind: 'system', id: 's7a2-pass-system' },
      runtimeAdmission: { bodies, authorizeConfiguration },
      recipientExecutions: createRecipientExecutions({
        sessions: createSessionFactsService({ records: over as never }), executions, records: over as never }),
      dispatchBasis: createDispatchBasisReader({ records: over as never,
        pointer: createGoalPointerFacts({ records: over as never }) }),
    };
  }
  const mailbox = createSessionMailbox(depsOver());
  /** R's own release owner over `over` (the fixture's one ordered store, or a wrapping port). */
  function releaseOver(over: ReleaseRecords = records as unknown as ReleaseRecords) {
    const dependencies = depsOver(over);
    return createMessageReleaseOwner({
      records: over, writes: createMessageWriteOwner(dependencies),
      dispatchBasis: dependencies.dispatchBasis!, now,
    });
  }
  const ctxHost: CoreCallContext = {
    projectId: claim.sessionRef.projectId, workspaceId,
    principal: { kind: 'host', actor: { kind: 'human', id: 's7a2-pass-host' } },
    materialReader: { kind: 'host', projectId: claim.sessionRef.projectId, workspaceId,
      actor: { kind: 'human', id: 's7a2-pass-host' } },
    signal: new AbortController().signal,
  };
  const ctxWork: CoreCallContext = {
    projectId: claim.sessionRef.projectId, workspaceId,
    principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef }, signal: new AbortController().signal,
  };
  const goalSettings = createGoalSettingsService({ records, now, newId, operatorActor: { kind: 'human', id: 's7a2-pass-host' } });
  const plans = fixture.plans;

  /** `every_step`: a new agent `action_request` awaits the person instead of releasing itself at send. */
  async function awaitEveryStep(): Promise<void> {
    committed(await goalSettings.setGoalSettings(ctxHost, {
      input: { goalRef: fixture.goalRef, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: 's7a2-pass-autonomy', expected: [await fixture.goalPin()] },
    }));
  }
  async function basis() {
    return ready(await createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) })
      .readDispatchFacts(ctxHost, { goalRef: fixture.goalRef })).values;
  }
  /** One real agent `action_request` (`expected` is the read taken just before), then the person's real approval. */
  async function approvedRequest(label: string, expected: Awaited<ReturnType<typeof basis>>): Promise<SessionMessage> {
    const sent = committed(await mailbox.sendMessage(ctxWork, {
      input: { recipient: fixture.sessions.second, text: `S7A2 pass ${label}`,
        intent: 'action_request', needsReply: true, expected },
      meta: { requestId: `s7a2-pass-send-${label}`, expected: [] },
    }));
    return committed(await mailbox.releaseMessage(ctxHost, {
      input: { messageRef: sent.ref, allow: true },
      meta: { requestId: `s7a2-pass-approve-${label}`, expected: [] },
    }));
  }
  /** The real Plan owner: `proposePlan` then `applyPlanChange` moves the Goal's Plan to its next revision. */
  async function movePlan(label: string): Promise<void> {
    const graph = ready(await plans.queryTaskGraph(ctxHost, { goalRef: fixture.goalRef }));
    const plan = graph.plan;
    const draft = { schemaVersion: 2 as const, planId: `s7a2-pass-${label}`, planRevision: plan.planRevision + 1,
      goalId: fixture.goalRef.goalId, stages: plan.stages, tasks: plan.tasks,
      ...(plan.assignments === undefined ? {} : { assignments: plan.assignments }),
      obligations: plan.obligations, taskHierarchy: plan.taskHierarchy, executionDag: plan.executionDag };
    const proposed = committed(await plans.proposePlan(ctxHost, {
      meta: { requestId: `s7a2-pass-propose-${label}`, expected: [await fixture.goalPin()] },
      input: { goalRef: fixture.goalRef, basedOn: plan.ref, draft,
        reason: { text: `S7A2 pass ${label} plan move`, sources: [] } } }));
    committed(await plans.applyPlanChange(ctxHost, {
      meta: { requestId: `s7a2-pass-apply-${label}`, expected: [await fixture.goalPin()] },
      input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }));
  }
  /** The real Workflow over these owners, with R's release owner injected (the one member L publishes). */
  function workflowWith(overrides: Partial<WorkflowDependencies> = {}): WorkflowPort {
    const dependencies: WorkflowDependencies = {
      tasks: createGoalService({ records, now, eventId }).tasks,
      plans,
      sessions: fixture.sessionsPort,
      claims: createTaskClaimService({ records, now, newId, roles }),
      executions,
      runtime: {
        capabilities: () => unsupported('the pass never reads capabilities'),
        createSession: () => unsupported('the pass never creates a Session'),
        readSessionHistory: () => unsupported('the pass never reads Session history'),
        readExecutionHistory: () => unsupported('the pass never reads execution history'),
        readTaskExecutionHistory: () => unsupported('the pass never reads task history'),
        prepareExecution: () => unsupported('the pass stops before prepare'),
        startRun: () => unsupported('the pass stops before start'),
        observeRun: () => unsupported('the pass never observes'),
      } as unknown as WorkflowDependencies['runtime'],
      evidence: {
        openVerification: () => unsupported('no checks'), readVerification: () => unsupported('no checks'),
        beginCheck: () => unsupported('no checks'), recordCheckResult: () => unsupported('no checks'),
        finalizeChecks: () => unsupported('no checks'),
      } as unknown as WorkflowDependencies['evidence'],
      checks: { runRegisteredCheck: () => unsupported('no checks') } as unknown as WorkflowDependencies['checks'],
      sourceAuthority: createSourceAuthorityReader({ authority }),
      configuration: { consumerId: 's7a2-pass-consumer',
        bindings: [{ workspace: fixture.scope, sessionRole: SESSION_ROLE,
          roleBinding: fixture.roleBinding, budget: fixture.budget }] },
      goalSettings: goalSettings as unknown as GoalSettingsPort,
      messages: mailbox as unknown as NonNullable<WorkflowDependencies['messages']>,
      messageRelease: releaseOver(),
      now,
      ...overrides,
    };
    return createWorkflow(dependencies);
  }
  const select = (): WorkflowAdvanceInput =>
    ({ schemaVersion: 1, goalRef: fixture.goalRef, flowId: 's7a2-pass', sessionHint: null, kind: 'select_work' });
  opened.push({ async close() { await steps.close(); if ('close' in bodies) await bodies.close(); await fixture.close(); } });
  return { fixture, records, mailbox, releaseOver, plans, ctxHost, basis, approvedRequest, movePlan,
    awaitEveryStep, workflowWith, select };
}
type Pass = Awaited<ReturnType<typeof ledger>>;

function namedKind(value: AdvanceValue): string | null {
  return value.next === null || value.next.kind !== 'perform' ? null : value.next.operation.kind;
}
function releaseRequestOf(value: AdvanceValue) {
  if (value.next === null || value.next.kind !== 'perform' || value.next.operation.kind !== 'release_message') return null;
  return value.next.operation.request as { messageRef: SessionMessage['ref']; approvalRevision: number };
}
const perform = (pass: Pass, kindRequest: { messageRef: SessionMessage['ref']; approvalRevision: number }):
WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: pass.fixture.goalRef, flowId: 's7a2-pass', sessionHint: null,
  kind: 'perform', operation: { kind: 'release_message', request: kindRequest } });

describe.each(['memory', 'sqlite'] as const)('R-candidates pass (%s)', kind => {
  it('a blocked item does not stop the next page: the page-2 message is the one named', async () => {
    const pass = await ledger(kind);
    const workflow = pass.workflowWith();
    await pass.awaitEveryStep();
    const first = await pass.basis();
    // Page 1 of the Goal's candidate read: 100 approved action_requests, all pinned to the basis read just before.
    const pageOne: string[] = [];
    for (let index = 0; index < 100; index += 1) pageOne.push((await pass.approvedRequest(`p1-${index}`, first)).ref.messageId);
    // One real plan move: every page-1 pin differs from the Goal's current three values, so all 100 are blocked.
    await pass.movePlan('move');
    const moved = await pass.basis();
    expect(moved).not.toEqual(first);
    const pageTwo = await pass.approvedRequest('p2', moved);
    // The page limit is 100, so the ONLY selectable item sits on page 2: the selection walks the `nextCursor`.
    const value = ready(await workflow.advanceWork(pass.ctxHost, pass.select()));
    expect(value.state).toBe('advance');
    const request = releaseRequestOf(value);
    expect(request).not.toBeNull();
    expect(request!.messageRef).toEqual(pageTwo.ref);
    expect(request!.approvalRevision).toBe(pageTwo.approvalRevision);
    expect(pageOne).not.toContain(request!.messageRef.messageId);
  });

  it('a pass with nothing releasable names no release step', async () => {
    const pass = await ledger(kind);
    const workflow = pass.workflowWith();
    await pass.awaitEveryStep();
    const value = ready(await workflow.advanceWork(pass.ctxHost, pass.select()));
    expect(namedKind(value)).not.toBe('release_message');
  });

  it('a refused release comes back as the owner\'s own waiting, never as a throw', async () => {
    const pass = await ledger(kind);
    const workflow = pass.workflowWith();
    await pass.awaitEveryStep();
    const approved = await pass.approvedRequest('late-proof', await pass.basis());
    const request = releaseRequestOf(ready(await workflow.advanceWork(pass.ctxHost, pass.select())));
    expect(request).not.toBeNull();
    expect(request!.messageRef).toEqual(approved.ref);
    // The item is staled after the selection read it: the perform's release is refused as `revision_conflict`.
    await pass.movePlan('refuse');
    const value = ready(await workflow.advanceWork(pass.ctxHost, perform(pass, request!)));
    // The owner's own waiting, never a throw: the loop reads a throw as a handler failure and backs off.
    expect(value.state).toBe('waiting');
    expect(value.next).toBeNull();
    expect(value.receipt).toMatchObject({ kind: 'release_message',
      result: { status: 'rejected', code: 'revision_conflict' } });
    expect(value.reason).toMatch(/^revision_conflict: /);
    expect(await pass.mailbox.readMessage(pass.ctxHost, approved.ref))
      .toMatchObject({ status: 'ready', value: { release: 'approved' } });
  });

  it('an activity-only conflict is not stale, and the pass\'s own skip keeps it out of the same pass', async () => {
    const pass = await ledger(kind);
    const workflow = pass.workflowWith();
    await pass.awaitEveryStep();
    const approved = await pass.approvedRequest('skip', await pass.basis());
    const request = releaseRequestOf(ready(await workflow.advanceWork(pass.ctxHost, pass.select())));
    expect(request).not.toBeNull();
    // An activity-only conflict: every commit that would write the release is refused on the recipient's activity
    // record, so R2's bound is spent on it (`book-7a.md:389–:391`, R2-B-06). The pins are untouched.
    const real = pass.records;
    const conflicting = {
      ...real,
      async commit(batch: Parameters<typeof real.commit>[0]) {
        if (batch.events.some(event => event.eventType === SESSION_MESSAGE_RELEASED_EVENT_TYPE)) {
          // The ONE retryable key is the recipient's `SessionActivity` record (`message-release.ts:110`, rule 6).
          return { status: 'rejected' as const, code: 'revision_conflict' as const,
            reason: 'the recipient activity record moved',
            current: [{ refKey: canonicalRefKey(sessionActivityRefOf(pass.fixture.sessions.second)), revision: 2 }] };
        }
        return real.commit(batch);
      },
    } as unknown as ReleaseRecords;
    const confined = pass.workflowWith({ messageRelease: pass.releaseOver(conflicting) });
    const value = ready(await confined.advanceWork(pass.ctxHost, perform(pass, request!)));
    expect(value.state).toBe('waiting');
    expect(value.reason).toMatch(/^revision_conflict: /);
    // Still `approved`, and the very next candidate page still reads NO block reason — never `stale_pins`.
    expect(await pass.mailbox.readMessage(pass.ctxHost, approved.ref))
      .toMatchObject({ status: 'ready', value: { release: 'approved' } });
    const page = ready(await pass.releaseOver().readReleaseCandidates(pass.ctxHost,
      { scope: pass.fixture.scope, goalRef: pass.fixture.goalRef, after: null, limit: 100 }));
    expect(page.items.map(item => item.blockedReason)).toEqual([null]);
    // The Host driver's own carry (never a public input) keeps this advance from naming the same item.
    const skip: WorkflowAdvanceInternal = { releaseSkip: [sessionMessageRefKey(approved.ref)] };
    const skipped = ready(await workflow.advanceWork(pass.ctxHost, pass.select(), skip));
    expect(namedKind(skipped)).not.toBe('release_message');
  });
});
