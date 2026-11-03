/**
 * W-B (start ruling §5): the fixed W4 catalog world (root/src/src/a/src/a/x/docs), its
 * L1/L2/L4 lines and three `src` responsibility links. State comes only from
 * public steps; the pin is only the public current-revision read. The composition
 * root still builds the catalog with records only, so each test file installs the
 * `catalogRevisionModule` mock: it delegates to the REAL factory with the REAL
 * records and the real plan/directory/duty readers (G5's binding, one level early).
 */
import { randomUUID } from 'node:crypto';
import type { AdoptInitialArchitectureInput, ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CatalogRepairOpV1, NoteDraftV1, ResponsibilityMoveV1 } from '../../src/contracts/note.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { ArchitectureBaselineRevisionRef } from '../../src/contracts/governance.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import type { createTargetPlatform } from '../../src/composition/create-platform.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { CatalogRevisionDependencies } from '../../src/core/work-graph/architecture/revision-planner.js';
import type { RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { CatalogPlanFactsPort, CatalogPlanFactsV1, CatalogResponsibilityPort } from '../../src/core/work-graph/model/catalog-revision-ports.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { RecordGuard } from '../../src/core/record-store/ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import {
  readCanonicalTaskFacts, readGoalPlanWindow, readGoalsByProject, taskClosureOf,
} from '../../src/core/work-graph/tasks/plan-readers.js';
import { encodeSessionRecord, sessionAggregateRefKey, sessionWorkLinkRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { roleLineCommitContribution } from '../../src/core/work-graph/sessions/role-scope-commit.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { rejected } from '../../src/contracts/core/rejections.js';
import { encodeSessionResponsibilityChangedEvent } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { eventIdOf } from '../../src/core/work-graph/sessions/trusted-context.js';
import { committed, ready } from './S1-runtime-scenario-fixture.js';
import type { Backend } from './S8D-platform-fixture.js';

export const S8C_AT = '2026-10-17T00:00:00.000Z';

/** The live capabilities the mocked factory reads at call time; the world fills it after the build. */
type CatalogAccess = {
  projectId: string;
  catalog: ArchitectureCatalogPort | null;
  sessionDirectory: SessionDirectoryPort | null;
  readRoleSpec: RoleConfigurationPort['readRoleSpec'] | null;
  signal: AbortSignal;
};
let live: CatalogAccess | null = null;

export type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

function moduleOf(projectId: string, moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: `Own ${moduleId}`, paths, interfaces: [] };
}

/** `root`/`src`/`src/a`/`src/a/x`/`docs`, each with its directory and the declared containment tree. */
export function s8cCatalog(projectId: string): AdoptInitialArchitectureInput['catalog'] {
  const ref = (moduleId: string) => ({ projectId, moduleId });
  return {
    requireDag: true, dependencies: [],
    modules: ['root', 'src', 'src/a', 'src/a/x', 'docs'].map(moduleId =>
      moduleOf(projectId, moduleId, moduleId === 'root' ? ['.'] : [moduleId])),
    containment: { parentOf: [
      { parent: ref('root'), child: ref('src') }, { parent: ref('src'), child: ref('src/a') },
      { parent: ref('src/a'), child: ref('src/a/x') }, { parent: ref('root'), child: ref('docs') },
    ] },
  };
}

/** The planner's task-facts port over the real plan readers. */
function taskFactsPort(): CatalogPlanFactsPort {
  return {
    async read(store, projectId) {
      const goals = await readGoalsByProject(store, projectId);
      if (goals.status !== 'ready') return goals;
      const plans: CatalogPlanFactsV1[] = [];
      for (const goal of goals.goals) {
        const window = await readGoalPlanWindow(store, goal.ref);
        if (window.status !== 'ready') return window;
        if (window.plan === null) {
          plans.push({ goalRef: goal.ref, revision: window.goal.revision, planRef: null, tasks: [] });
          continue;
        }
        const facts = await readCanonicalTaskFacts(store, goal.ref, window.plan);
        if (facts.status !== 'ready') return facts;
        const plan = window.plan;
        plans.push({ goalRef: goal.ref, revision: window.goal.revision, planRef: plan.ref,
          tasks: plan.tasks.map(task => ({
            taskId: task.taskId,
            moduleIds: task.scope.kind === 'module' ? [task.scope.moduleRef] : [],
            closure: taskClosureOf(plan, facts.value, task.taskId).cause ?? 'open',
          })) });
      }
      return { status: 'ready', value: { plans, watermark: goals.readThrough } };
    },
  };
}

/** The responsibility port: the directory's own cards (records + links) and the one commit builder. */
function responsibilityPort(access: CatalogAccess): CatalogResponsibilityPort {
  return {
    async readFacts(_records, ctx, scope) {
      const directory = access.sessionDirectory;
      const catalog = access.catalog;
      if (directory === null || catalog === null) {
        return { status: 'rejected', code: 'unavailable', reason: 'the Session directory or catalog is not bound' };
      }
      const current = await catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (current.status !== 'ready' || current.value.catalog === null) return current.status === 'ready'
        ? { status: 'rejected', code: 'unavailable', reason: 'the current revision has no catalog' } : current;
      const activeRevision = current.value.catalog.ref.revision;
      const page = await directory.findSessions(ctx, { workspace: scope, includeArchived: false,
        page: { limit: 200 } });
      if (page.status !== 'ready') return page;
      const sessions = new Map<string, SessionRecord>();
      const links = new Map<string, SessionWorkLink>();
      const guards: RecordGuard[] = [];
      for (const card of page.value.items) {
        sessions.set(card.record.ref.sessionId, card.record);
        guards.push({ refKey: sessionAggregateRefKey(card.record.ref), expectedRevision: card.record.revision });
        for (const link of card.links) {
          links.set(canonicalKey(link.ref), link);
          guards.push({ refKey: sessionWorkLinkRefKey(link.ref), expectedRevision: link.revision });
        }
      }
      return { status: 'ready', value: { sessions, links, guards, activeRevision } };
    },
    contribution(input) {
      const projectId = input.projectId;
      const events = [];
      for (const [index, material] of input.events.entries()) {
        const source = input.sessions.find(session => session.ref.sessionId === material.closed.sessionId);
        const closed = input.links.find(entry => canonicalKey(entry.link) === canonicalKey(material.closed))?.next;
        const opened = material.opened === null ? null
          : input.links.find(entry => canonicalKey(entry.link) === canonicalKey(material.opened!))?.next ?? null;
        if (source === undefined || closed === null || closed === undefined
          || material.closed.target.kind !== 'module') {
          return { ok: false, rejection: rejected('invalid', 'the responsibility event has no source, link or basis') };
        }
        const basis = { kind: 'module' as const, moduleRef: material.closed.target.ref,
          catalogRevision: input.catalogRevision };
        events.push(encodeSessionResponsibilityChangedEvent({
          eventId: eventIdOf(input.identityKey, `responsibility:${index}`), eventType: 'SessionResponsibilityChanged',
          schemaVersion: 1, occurredAt: input.occurredAt, projectId: source.ref.projectId,
          workspaceId: source.workspaceId, mode: material.opened === null ? 'drop' : 'transfer', source,
          destination: material.opened === null ? null : source, closed, opened,
          openedBound: material.openedBound, archiveStep: null, basis,
        }));
      }
      return roleLineCommitContribution({
        projectRef: { projectId }, records: input.sessions.map(encodeSessionRecord),
        guards: input.guards, links: input.links, claimChanges: input.claimChanges,
        bindings: input.bindings, events, allocation: null,
      }, null);
    },
  };
}

/** The `vi.mock` factory for `catalog-service.js`: the real service with the real capabilities. */
export async function catalogRevisionModule(importOriginal: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const actual = await importOriginal() as {
    createArchitectureCatalogService: (stores: { records: GoalRecordTransactionPort; revision?: unknown }) => ArchitectureCatalogPort;
  };
  const access: CatalogAccess = {
    get projectId() { return live?.projectId ?? ''; },
    get catalog() { return live?.catalog ?? null; },
    get sessionDirectory() { return live?.sessionDirectory ?? null; },
    get readRoleSpec() { return live?.readRoleSpec ?? null; },
    get signal() { return live?.signal ?? new AbortController().signal; },
  };
  return { ...actual,
    createArchitectureCatalogService: (stores: { records: GoalRecordTransactionPort; revision?: unknown }) =>
      actual.createArchitectureCatalogService({ ...stores,
        revision: revisionDeps(stores.records as GoalRecordTransactionPort & RecordLookupPort, access) }) };
}

/** One record-store/G5 capability set: the real task facts, responsibility and duty readers. */
function revisionDeps(records: GoalRecordTransactionPort & RecordLookupPort,
  access: CatalogAccess): CatalogRevisionDependencies {
  const duty = createSessionDutyResolver({
    readRoleSpec: (ctx, input) => access.readRoleSpec === null
      ? Promise.resolve({ status: 'rejected', code: 'unavailable', reason: 'the RoleSpec read is not bound' })
      : access.readRoleSpec(ctx, input),
    configuration: undefined,
  });
  return { records, now: () => S8C_AT, eventId: () => randomUUID(),
    taskFacts: taskFactsPort(),
    responsibility: responsibilityPort(access), duty };
}

/** Standalone binding for the restored old delete rows: the real service over their fixture's records. */
export function catalogRevisionDeps(platform: Platform, ctx: CoreCallContext,
  records: GoalRecordTransactionPort & RecordLookupPort): CatalogRevisionDependencies {
  return revisionDeps(records, { projectId: ctx.projectId, catalog: platform.architecture,
    sessionDirectory: platform.sessions,
    readRoleSpec: (callCtx, input, options) => platform.roles.readRoleSpec(callCtx, input, options),
    signal: ctx.signal });
}

/** Binds the module factory to a platform the caller built (the old delete fixtures do this). */
export function bindCatalogRevision(platform: Platform, scope: WorkspaceScope, signal?: AbortSignal): void {
  live = { projectId: scope.projectId, catalog: platform.architecture, sessionDirectory: platform.sessions,
    readRoleSpec: (ctx, input, options) => platform.roles.readRoleSpec(ctx, input, options),
    signal: signal ?? new AbortController().signal };
}

export type S8CWorld = Awaited<ReturnType<typeof openS8CCatalogWorld>>;

/** The fixed W-B world: W4 catalog, L1/L2/L4 lines and their three `src` responsibility links. */
export async function openS8CCatalogWorld(backend: Backend = 'memory', projectId = 's8c-catalog') {
  const { openCatalogWorld } = await import('./S8B-catalog-steps.js');
  // The world's Host is the S8D fixture's one human operator; naming it here is
  // what lets a row use the real `lines/pin` owner (the Host's operator write)
  // to raise the Workspace revision.
  const base = await openCatalogWorld(backend, projectId,
    { operatorActor: { kind: 'human', id: `${projectId}-operator` } });
  const { platform, ctx, scope } = base;
  bindCatalogRevision(platform, scope, ctx.signal);
  let steps = 0;
  const id = (name: string) => `${projectId}-${name}-${++steps}`;
  const scopePins = async (): Promise<VersionPin[]> => {
    const read = ready(await platform.projects.readWorkspaceRegistration(ctx, scope));
    return [{ ref: read.project.ref, revision: read.project.revision },
      { ref: read.workspace.ref, revision: read.workspace.revision }];
  };
  const workspacePin = async (): Promise<VersionPin> => {
    const read = ready(await platform.projects.readWorkspaceRegistration(ctx, scope));
    return { ref: read.workspace.ref, revision: read.workspace.revision };
  };  const currentCatalogPin = async (): Promise<ArchitectureCatalogPinV1> => {
    const read = ready(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }));
    return { catalogRef: read.catalog!.ref, baseline: { ref: read.baseline.ref, digest: read.baseline.contentDigest } };
  };
  const newLine = async (role: RoleConfigurationRef): Promise<SessionRecord> => {
    const result = await platform.runtime.createSession(ctx, {
      workspace: scope, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: id('session'), expected: [] },
    });
    if (result.status !== 'completed') throw new Error(`sessions/create: ${JSON.stringify(result)}`);
    return result.value;
  };
  const link = async (session: SessionRecord, moduleId: string) => {
    const sessionRef: SessionRef = { projectId: scope.projectId, sessionId: session.ref.sessionId };
    const target = { kind: 'module' as const, ref: { projectId: scope.projectId, moduleId } };
    const card = ready(await platform.sessions.readSession(ctx, sessionRef));
    const ref = responsibleLinkRef(sessionRef, target);
    const existing = card.links.find(entry => canonicalKey(entry.ref) === canonicalKey(ref));
    return committed(await platform.sessions.linkSessionWork(ctx, {
      meta: { requestId: id('link'), expected: [
        { ref: card.record.ref, revision: card.record.revision },
        { ref, revision: existing?.revision ?? 0 },
      ] },
      input: { sessionRef, target, relation: 'responsible', active: true },
    }));
  };
  const reviseCommand = async (input: { ops: CatalogRepairOpV1[]; responsibilityMoves?: ResponsibilityMoveV1[];
    reason?: string; requestId?: string }) => ({
    meta: { requestId: input.requestId ?? id('revise'), expected: await scopePins() },
    input: { expected: await currentCatalogPin(), ops: input.ops,
      responsibilityMoves: input.responsibilityMoves ?? [],
      reason: input.reason ?? 's8c catalog revision' },
  });
  const revise = async (input: Parameters<typeof reviseCommand>[0]) =>
    platform.architecture.reviseArchitectureCatalog(ctx, await reviseCommand(input));
  /** The REAL `lines/pin` owner as the Host's operator: adding one existing line writes the Workspace snapshot. */
  const pinLine = async (line: SessionRecord) => committed(await platform.lineSettings.setLinePins(ctx, {
    meta: { requestId: id('pins'), expected: [await workspacePin()] },
    input: { workspace: scope, add: [{ projectId: scope.projectId, sessionId: line.ref.sessionId }], remove: [] },
  }));
  const note = async (moduleId: string): Promise<string> => {
    const draft: NoteDraftV1 = { kind: 'pitfall', topic: 's8c anchor', conclusion: `about ${moduleId}`,
      body: 'body', anchor: { kind: 'module', moduleId }, extraAnchors: [], facts: [], basisFiles: [],
      structural: false, replaces: [], contradicts: [], coexistWith: [] };
    const result = await platform.notes.writeNote(ctx, { commandId: id('note'), note: draft,
      expectedPointerRevision: null, goalId: null });
    if (result.status === 'rejected') throw new Error(`notes/write: ${JSON.stringify(result)}`);
    return result.noteId;
  };
  const readNote = async (noteId: string) => ready(await platform.notes.readNote(ctx, { noteId }));
  /** The same project, a second registered workspace, and the public Goal/Plan entries bound to it. */
  const openWorkspace = async (workspaceId: string) => {
    const target: CoreCallContext = { ...ctx, workspaceId,
      materialReader: ctx.materialReader.kind === 'host'
        ? { ...ctx.materialReader, workspaceId }
        : ctx.materialReader };
    const targetScope: WorkspaceScope = { projectId: scope.projectId, workspaceId };
    const [project] = await scopePins();
    committed(await platform.projects.registerWorkspace(target, {
      meta: { requestId: id(`register-${workspaceId}`), expected: [
        project!, { ref: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId }, revision: 0 }] },
      input: { workspace: targetScope } }));
    const targetPins = async (): Promise<VersionPin[]> => {
      const read = ready(await platform.projects.readWorkspaceRegistration(target, targetScope));
      return [{ ref: read.project.ref, revision: read.project.revision },
        { ref: read.workspace.ref, revision: read.workspace.revision }];
    };
    const goalPin = async (goal: GoalRef) =>
      ({ ref: goal, revision: ready(await platform.plans.queryGoal(target, goal)).goal.revision });
    return {
      ctx: target, scope: targetScope,
      goal: async (goalId: string): Promise<GoalRef> => committed(await platform.goals.createGoal(target, {
        meta: { requestId: id(`goal-${workspaceId}`), expected: await targetPins() },
        input: { goalId, workspace: targetScope, objective: `Plan the modules of ${goalId}` } })).ref,
      propose: async ({ goal, draft, basedOn = null }: { goal: GoalRef; draft: PlanRevisionDraft;
        basedOn?: PlanRevisionRef | null }) => platform.plans.proposePlan(target, {
        meta: { requestId: id(`propose-${workspaceId}`), expected: [await goalPin(goal)] },
        input: { goalRef: goal, basedOn, draft, reason: { text: 'a plan over the catalog', sources: [] },
          requestRef: null, replaces: null } }),
      apply: async (proposal: PlanProposal) => platform.plans.applyPlanChange(target, {
        meta: { requestId: id(`apply-${workspaceId}`), expected: [await goalPin(proposal.goalRef)] },
        input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } }),
    };
  };

  await base.adoptInitial({ baselineId: `${projectId}-baseline`, description: 'S8C W-B catalog',
    constraints: [], catalog: s8cCatalog(scope.projectId) });
  await base.governance();
  const l1 = await newLine(platformRoleProfile('executor').template);
  const l2 = await newLine(platformRoleProfile('adviser').template);
  const l4 = await newLine(platformRoleProfile('scribe').template);
  const links = { l1: await link(l1, 'src'), l2: await link(l2, 'src'), l4: await link(l4, 'src') };
  return {
    platform, ctx, scope, pin: currentCatalogPin, revise, reviseCommand, pinLine, link, note, readNote, openWorkspace,
    links, lines: { l1, l2, l4 },
    goal: (goalId: string): Promise<GoalRef> => base.goal(goalId),
    propose: base.propose, apply: base.apply,
    readSession: async (session: SessionRecord) => ready(await platform.sessions.readSession(ctx,
      { projectId: scope.projectId, sessionId: session.ref.sessionId })),
    readRevision: async (ref: ArchitectureBaselineRevisionRef) => ready(await platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref } })),
    close: async () => { live = null; await base.close(); },
  };
}
