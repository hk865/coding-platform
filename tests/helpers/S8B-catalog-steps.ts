/**
 * Public steps for the module rule on plans and the catalog pin on plan candidates. Every state comes from a public step
 * (a platform owner, a Runtime step, a scripted model); nothing is written by hand or checked by reading the store; each
 * version pin a step sends comes from a public read just before it; a step that misses its state throws. Sources: the
 * platform world is tests/helpers/S8D-platform-fixture.ts plus three Host inputs (rule sheet A8: a Kernel store, a query
 * runtime over a scripted model, a secretary profile port) passed by a delegating spy on `createTargetPlatform`;
 * `activatePolicy` and `runInitialAnswer` are tests/work-graph/R5b-initial-plan.test.ts's steps; the Agent world is
 * tests/helpers/W2-whiteboard-fixture.ts, whose plan writes pin the Goal (the plan owner checks the rest of the scope).
 * Barrier and cleanup: the test file installs tests/helpers/S6A-commit-barrier.ts's two `vi.mock` lines and resets the
 * barrier in `afterEach` before closing its worlds. A held adoption promise must be awaited in `finally` after
 * releasing its hold, before closing the world. `reset()` releases holds but does not drain those calls.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import * as platformModule from '../../src/composition/create-platform.js';
import type {
  AdoptInitialArchitectureInput, ArchitectureCatalogPinV1, ModuleDefinition,
} from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CompletionPolicyContentV1 } from '../../src/contracts/governance.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import type { ProjectRegistrationPort } from '../../src/core/work-graph/configuration/project-bootstrap-contracts.js';
import type { PlanProposal, ProposedPlanRequestV1 } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SecretaryProfilePort, SecretaryProfileV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { B2_AT } from './B2-execution-fixture.js';
import { createScriptedModel, digestOf, type ScriptedModel } from './B2-runtime-fixture.js';
import { byIdentityPrefix, commitBarrier } from './S6A-commit-barrier.js';
import { committed, ready } from './S1-runtime-scenario-fixture.js';
import { fixture as platformFixture, type Backend, type PlatformFixture } from './S8D-platform-fixture.js';
import { createW2WhiteboardFixture, type W2WhiteboardFixture } from './W2-whiteboard-fixture.js';

export { BACKENDS, type Backend } from './S8D-platform-fixture.js';
type Platform = PlatformFixture['platform'];

/** The policy `governance()` activates: a draft's verification kinds and an answer's check kinds name `static`. */
export const S8B_POLICY: CompletionPolicyContentV1 = { schemaVersion: 1, requirementKinds: ['static'],
  minimumRequiredRequirementsPerObligation: 1 };
/** The one module of the Agent world's catalog (tests/helpers/task-claim-fixture.ts, its default bootstrap module). */
export const R4C_MODULE = 'r4c-claim-work';

/** The project and workspace version pins, from the public registration read. */
async function scopePinsOf(projects: Pick<ProjectRegistrationPort, 'readWorkspaceRegistration'>, ctx: CoreCallContext,
  scope: WorkspaceScope): Promise<VersionPin[]> {
  const read = ready(await projects.readWorkspaceRegistration(ctx, scope));
  return [{ ref: read.project.ref, revision: read.project.revision },
    { ref: read.workspace.ref, revision: read.workspace.revision }];
}

/** The catalog reads and the add-only revision over one catalog owner; `scopePins` reads the project and workspace pins. */
function catalogSteps(port: ArchitectureCatalogPort, ctx: CoreCallContext, scopePins: () => Promise<VersionPin[]>,
  prefix: string) {
  let revisions = 0;
  const architecture = async () => ready(await port.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
  return {
    architecture,
    /** The pin built from the public read of the current revision: a row's expected pin, never a literal. */
    async pin(): Promise<ArchitectureCatalogPinV1> {
      const read = await architecture();
      return { catalogRef: read.catalog.ref, baseline: { ref: read.baseline.ref, digest: read.baseline.contentDigest } };
    },
    /** `reviseArchitectureCatalog` (no HTTP route publishes it): the catalog as read plus one module; no removal. */
    async addModule(module: ModuleDefinition) {
      const current = await architecture();
      return committed(await port.reviseArchitectureCatalog(ctx, {
        meta: { requestId: `${prefix}-revise-${++revisions}`, expected: await scopePins() },
        input: { basedOn: { ref: current.baseline.ref, digest: current.baseline.contentDigest },
          catalog: { ...current.catalog.catalog, modules: [...current.catalog.catalog.modules, module] },
          reason: `add the module ${module.ref.moduleId}` } }));
    },
  };
}

/** `completion-policies/install` and `/activate` on an existing platform; `requestId` also names the policy. */
export async function activatePolicy(platform: Platform, ctx: CoreCallContext, content: CompletionPolicyContentV1,
  requestId: string): Promise<void> {
  const { projectId } = ctx;
  const [project] = await scopePinsOf(platform.projects, ctx, { projectId, workspaceId: ctx.workspaceId ?? '' });
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: requestId, revision: 1 };
  const installed = committed(await platform.completionPolicies.installCompletionPolicy(ctx, {
    meta: { requestId, expected: [project!, { ref: policyRef, revision: 0 }] },
    input: { policyId: requestId, contentRevision: 1, content } }));
  committed(await platform.completionPolicies.activateCompletionPolicy(ctx, {
    meta: { requestId: `${requestId}-active`, expected: [project!,
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
    input: { target: { ref: installed.ref, digest: installed.contentDigest } } }));
}

/** The initialization answer chain on an existing platform whose Runtime answers with the caller's scripted model: submit,
 * `sessions/create`, claim (refs and revisions from the two returns), prepare, start; throws when no answer is saved. */
export async function runInitialAnswer(platform: Platform, ctx: CoreCallContext, input: { requestPrefix: string;
  consumerId: string; submit: Parameters<Platform['queries']['submitQueryJob']>[1];
  session: Parameters<Platform['runtime']['createSession']>[1] }) {
  const { job, run } = committed(await platform.queries.submitQueryJob(ctx, input.submit));
  const session = await platform.runtime.createSession(ctx, input.session);
  if (session.status !== 'completed') throw new Error(`sessions/create: ${JSON.stringify(session)}`);
  committed(await platform.queries.claimQuery(ctx, {
    meta: { requestId: `${input.requestPrefix}-claim`, expected: [{ ref: job.ref, revision: job.revision },
      { ref: run.ref, revision: run.revision }, { ref: session.value.ref, revision: session.value.revision }] },
    input: { queryRunRef: run.ref, sessionRef: session.value.ref } }));
  const prepared = ready(await platform.runtime.prepareQuery(ctx,
    { queryRunRef: run.ref, requestId: `${input.requestPrefix}-prepare` }));
  const started = ready(await platform.runtime.startQuery(ctx,
    { prepared, consumerId: input.consumerId, requestId: `${input.requestPrefix}-start` }));
  const answerRef = started.answer?.ref as QueryJobAnswerRef | undefined;
  if (answerRef === undefined) throw new Error(`queries/start recorded no answer: ${JSON.stringify(started.run)}`);
  return { answerRef, started };
}

// The initialization answer's Query: the advisor role, binding and budget of tests/work-graph/R5b-initial-plan.test.ts.
const ANSWER_ROLE = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const ANSWER_BINDING = { schemaVersion: 1 as const, bindingId: 's8b-answer-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const ANSWER_BUDGET = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8,
  maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const ANSWER_INSTRUCTION = 'S8B initialization answer: trusted read-only guidance';
// Without a secretary profile a request command answers `no_secretary_binding` (shape: tests/helpers/S5-decision-fixture.ts).
const SECRETARY_ROLE = platformRoleProfile('secretary').template;
const SECRETARY: SecretaryProfileV1 = { profileId: 's8b-secretary', sessionRole: SECRETARY_ROLE,
  roleBinding: { schemaVersion: 1, bindingId: 's8b-secretary-binding', templateId: SECRETARY_ROLE.templateId,
    templateRevision: SECRETARY_ROLE.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' },
  runtimeBudget: ANSWER_BUDGET, budget: { maxTokens: null, deadline: null }, consumerId: 's8b-requests' };
const SECRETARY_KEY = canonicalJson(SECRETARY_ROLE as unknown as JsonValue);
const secretaryProfiles: SecretaryProfilePort = { forNewLine: async () => ({ status: 'ready', value: SECRETARY }),
  forSession: ({ sessionRole }) => canonicalJson(sessionRole as unknown as JsonValue) === SECRETARY_KEY ? SECRETARY : null };

/** One spy on `createTargetPlatform` at a time: a second open waits until the first platform is built. */
let opening: Promise<void> = Promise.resolve();

/** The platform world (memory or SQLite) over the S8D fixture's project and workspace `main`. No request driver runs, so
 * a submitted request round waits on record. `close()` closes the platform, then removes the Kernel store. */
export async function openCatalogWorld(backend: Backend, projectId = 's8b-catalog') {
  const kernelDirectory = await mkdtemp(join(tmpdir(), 's8b-kernel-'));
  let scripted: ScriptedModel | null = null;
  const runtime: RuntimeHostBindings = {
    resolveConfiguration: async () => ({ status: 'rejected', code: 'unsupported', reason: 'no Work execution here' }),
    async resolveQueryConfiguration() {
      if (scripted === null) return { status: 'rejected', code: 'unsupported', reason: 'no scripted answer waits' };
      return { status: 'ready', value: { configurationRevision: 's8b-answers@1',
        model: { configuration: { revision: 's8b-answers@1', provider: 'deepseek', model: 's8b-scripted',
          baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 's8b-counter' }) } },
        budget: ANSWER_BUDGET, tools: ['read'], writeScope: [], skills: { resourceRoot: kernelDirectory, enabledIds: [] },
        systemInstruction: ANSWER_INSTRUCTION,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(ANSWER_INSTRUCTION) },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } };
    },
  };
  const previous = opening;
  let opened!: () => void;
  opening = new Promise(resolve => { opened = resolve; });
  await previous;
  let spy: { mockRestore(): void } | undefined;
  let fx: PlatformFixture;
  try {
    const real = platformModule.createTargetPlatform;
    spy = vi.spyOn(platformModule, 'createTargetPlatform').mockImplementation(async options => real({
      ...options, runtime, secretaryProfiles,
      kernelStores: { entries: [{ adapterId: 's8b-kernel', storeKey: 's8b-kernel-store',
        workspace: { projectId, workspaceId: 'main' }, databasePath: join(kernelDirectory, 'kernel.sqlite') }] },
    }));
    fx = await platformFixture(backend, projectId, []);
  } catch (error) {
    await rm(kernelDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    try { spy?.mockRestore(); } finally { opened(); }
  }
  const { platform, ctx } = fx;
  let seq = 0;
  const id = (step: string) => `${projectId}-${step}-${++seq}`;
  const scopePins = () => scopePinsOf(platform.projects, ctx, fx.scope);
  const goalPin = async (goal: GoalRef) =>
    ({ ref: goal, revision: ready(await platform.plans.queryGoal(ctx, goal)).goal.revision });
  /** The request's current candidate (its head), through `plans/request-candidate`. */
  const head = async (goal: GoalRef, requestRef: QueryJobRef) =>
    ready(await platform.requestCandidates.readRequestCandidate(ctx, { goalRef: goal, requestRef })).head;
  return {
    platform, ctx, scope: fx.scope, adopt: fx.adopt, head,
    ...catalogSteps(platform.architecture, ctx, scopePins, projectId),
    /** The policy only: the catalog is `adopt`'s, so a row can propose before, between or after the two. */
    governance: () => activatePolicy(platform, ctx, S8B_POLICY, `${projectId}-policy`),
    /** A whole `architecture/adopt-initial` body as given; one initial adoption per project (this or `adopt`). */
    adoptInitial: async (input: AdoptInitialArchitectureInput) => committed(await platform.architecture
      .adoptInitialArchitecture(ctx, { meta: { requestId: id('adopt'), expected: await scopePins() }, input })),
    goal: async (goalId: string) => committed(await platform.goals.createGoal(ctx, { meta: { requestId: id('goal'),
      expected: await scopePins() }, input: { goalId, workspace: fx.scope, objective: `Plan the modules of ${goalId}` } })).ref,
    /** `requests/submit` through the request intake as the operator: an operator-initiated request root. */
    async requestRoot(goal: GoalRef) {
      const submitted = await platform.requestIntake.submitRequest(ctx, { commandId: id('request'), goalId: goal.goalId,
        text: 'Plan the module work', continues: null, recipient: null });
      if (submitted.status !== 'queued') throw new Error(`requests/submit: ${JSON.stringify(submitted)}`);
      return submitted.requestRoot;
    },
    /** `plans/propose`; `replaceHead` replaces the read head. It and `apply` answer their request: resending it replays. */
    async propose({ goal, draft, basedOn = null, requestRef, replaceHead = false, requestId }: { goal: GoalRef;
      draft: PlanRevisionDraft; basedOn?: PlanRevisionRef | null; requestRef?: QueryJobRef; replaceHead?: boolean;
      requestId?: string }) {
      let replaces: ProposedPlanRequestV1['replaces'] = null;
      if (replaceHead) {
        const current = requestRef === undefined ? null : await head(goal, requestRef);
        if (current === null) throw new Error('propose: no request head to replace');
        replaces = { proposalRef: current.ref, revision: current.revision };
      }
      const request: GraphWrite<ProposedPlanRequestV1> = {
        meta: { requestId: requestId ?? id('propose'), expected: [await goalPin(goal)] },
        input: { goalRef: goal, basedOn, draft, reason: { text: 'a plan over the catalog', sources: [] },
          requestRef: requestRef ?? null, replaces } };
      return { request, result: await platform.plans.proposePlan(ctx, request) };
    },
    /** `plans/apply` of the proposal at its read revision. */
    async apply(proposal: PlanProposal, requestId?: string) {
      const request = { meta: { requestId: requestId ?? id('apply'), expected: [await goalPin(proposal.goalRef)] },
        input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } };
      return { request, result: await platform.plans.applyPlanChange(ctx, request) };
    },
    /** `runInitialAnswer` of an `initial_coordination` Query whose scripted model replies `response`; one at a time. */
    async answer(goal: GoalRef, response: unknown) {
      const queryJobId = id('initial');
      const job: QueryJobRef = { aggregateType: 'QueryJob', ...fx.scope, queryJobId };
      const run: QueryRunRef = { aggregateType: 'QueryRun', ...fx.scope, queryJobId, runId: `${queryJobId}-run` };
      const model = createScriptedModel([{ kind: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }]);
      scripted = model;
      const { answerRef } = await runInitialAnswer(platform, ctx, {
        requestPrefix: queryJobId, consumerId: `${projectId}-answers`,
        submit: { meta: { requestId: `${queryJobId}-submit`, expected: [...await scopePins(), await goalPin(goal),
          { ref: job, revision: 0 }, { ref: run, revision: 0 }] },
        input: { queryJobId, runId: run.runId, intent: { schemaVersion: 1, intentId: queryJobId, ...fx.scope,
          goalId: goal.goalId, question: 'Read the project and propose the initial plan', focusTaskRefs: [],
          budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: queryJobId,
          execution: { kind: 'initial_coordination', roleBinding: ANSWER_BINDING, runtimeBudget: ANSWER_BUDGET } } } },
        session: { workspace: fx.scope, role: ANSWER_ROLE, recommendedRefs: [], initialLinks: [],
          meta: { requestId: `${queryJobId}-session`, expected: [] } } });
      return { answerRef, requests: model.requests };
    },
    /** The plan owner's `proposeInitialPlanFromAnswer` (no HTTP route publishes it). */
    async proposeFromAnswer(answerRef: QueryJobAnswerRef, requestId?: string) {
      const request = { meta: { requestId: requestId ?? id('propose-initial'), expected: [] },
        input: { answerRef, reason: { text: 'the initial plan from the saved answer', sources: [] } } };
      return { request, result: await platform.plans.proposeInitialPlanFromAnswer!(ctx, request) };
    },
    close: async () => { try { await fx.close(); } finally { await rm(kernelDirectory, { recursive: true, force: true }); } },
  };
}

/** The Agent world (memory or SQLite): W2's adopted Plan with no module task, a catalog of `R4C_MODULE`, an entered Work
 * Run with `propose_future_plan` / `apply_future_plan`; the catalog owner over its store; results read via `plans`, `ctx`. */
export async function openAgentWorld(backend: Backend) {
  const w2 = await createW2WhiteboardFixture(backend);
  // The bootstrap owner the world was created with, for its registration read (which mints no time or event id).
  const { projects } = createProjectBootstrapServices({ records: w2.records, now: () => B2_AT, eventId: () => 's8b-unused' });
  const proposeAsWorkRun: W2WhiteboardFixture['proposeAsWorkRun'] = async (draft, basedOn, overrides = {}) =>
    w2.proposeAsWorkRun(draft, basedOn, { ...overrides, expected: overrides.expected ?? [await w2.goalPin()] });
  const applyAsWorkRun: W2WhiteboardFixture['applyAsWorkRun'] = async (proposalRef, revision, overrides = {}) =>
    w2.applyAsWorkRun(proposalRef, revision, { ...overrides, expected: overrides.expected ?? [await w2.goalPin()] });
  return {
    scope: w2.base.scope, goalRef: w2.goalRef, planRef: w2.planRef, plans: w2.plans, ctx: w2.ctxHost,
    futureDraft: w2.futureDraft, proposeAsWorkRun, applyAsWorkRun,
    ...catalogSteps(createArchitectureCatalogService({ records: w2.records }), w2.ctxHost,
      () => scopePinsOf(projects, w2.ctxHost, w2.base.scope), 's8b-agent'),
    close: () => w2.close(),
  };
}

/** Holds the next plan adoption's prepared commit (Host or Agent, both `plan-apply:`) until `release()`. */
export function holdAdoption(label = 'plan adoption') {
  return commitBarrier.hold(byIdentityPrefix('plan-apply:'), label);
}
