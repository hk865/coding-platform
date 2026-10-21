/**
 * Group X (slice 2C) — the 2C-25 scale fixture (LE5).
 *
 * What it builds and through which public calls:
 *  - One real Memory or SQLite backend through `openLineFixture`
 *    (`createTaskClaimFixture` governance/roles/plan + the Session lifecycle,
 *    completion, execution-entry, model-request, Query, message, control,
 *    line-settings, anomaly, evidence and bootstrap schemas).
 *  - 5,000 Sessions through the real `SessionDirectoryPort.admitSessionCreation`
 *    + `recordSessionCreated` (with provenance and role), nothing through the
 *    record store directly, except amendment A2's Run seed described below.
 *  - 1,100 active line heads: 100 with a real `starting` Run (a real
 *    `TaskClaimPort.claimTask` on a task of the 100-task `gScaleWork` goal) and
 *    1,000 idle (X, R, W, Z and the supporting Sessions among them). 50 active
 *    continuation predecessors, 100 active `readonly_copy` Sessions (each a
 *    real consultation copy whose QueryRun is `answered`), 2,750 archived heads,
 *    500 archived continuation predecessors, 500 archived copies.
 *  - X: 2,099 real `linkSessionWork` `participates` links + 1 open `responsible`
 *    task link, crossing the old 2,000-link card capacity.
 *  - R: a `missing`-retired head that sent 2,500 real mailbox messages
 *    (`sendMessage`) whose last two, in `session-message-by-sender` refKey
 *    order, received a real `respondMessage` reply.
 *  - W: 30 real anomaly anchors written by `recordSessionAnomaly` (through the
 *    fixture's `writeAnchors`) over 30 one-run tasks, with 29 picker Runs
 *    seeded at the storage boundary (named exception below) so exactly the
 *    refKey-last anchor stays unclaimed.
 *  - Z: responsible for `T*`; one real claim/fail Run on `T*` plus 2,999
 *    `RunSnapshot@1` records seeded at the storage boundary (named exception
 *    below), so `queryTaskGraph` reads 3,000 Runs of `T*`'s goal as the shared
 *    cost.
 *  - The real 2A decision queue (`decisionReadsOver`) and the real undelivered
 *    from `createSessionMailbox`, both rebuilt from the line's counting wrapper
 *    (P12), are wired so the reader paths are the production ones.
 *
 * FIXTURE EXCEPTIONS (lead ruling 2026-10-15, item 14). Only two kinds of data
 * in this file are written at the storage boundary:
 *   1. the 29 picker `RunSnapshot@1` records for W, and
 *   2. the 2,999 `RunSnapshot@1` records for Z (on top of Z's one real claim).
 * They stay raw for the same reason as 2A's exceptions 3-4 (coordinator ruling,
 * 2A QA-17): the public path is quadratic here - driving 2,999 real
 * claim/fail/requeue cycles and 29 real picker Runs would multiply the fixture
 * cost far beyond what the measurement needs, while the records are written in
 * shapes today's codecs decode. Everything else - the 5,000 Sessions, their
 * provenance, links and archives, X, R and W's real Runs/anchors/messages, the
 * copies and the goal/plan set - goes through the public services. (The trusted
 * scope/governance seed lives in the shared `createTaskClaimFixture`, not in
 * this file; see the group report.)
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/core/work-graph/model/claim-contracts.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import type { SessionDutyReadPort, WorkLineReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type { WorkLineReaderDeps, WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { sessionAnomalyRefKey } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import {
  createWorkLineReader,
} from '../../src/core/work-graph/views/work-line-reader.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { completedEvent, crashedEvent, L_HOST } from './S2C-L-runs-support.js';
import { decisionReadsOver, openLineFixture, type LineFixture } from './S2C-L-line-support.js';
import { preparationHost, prepareTaskForReal, type ClaimFixtureKind } from './task-claim-fixture.js';

/**
 * P9: only the 2C-25 scale work uses this timeout. The daily small world uses
 * the runner's own timeouts.
 */
export const S2C_SCALE_TIMEOUT_MS = 1_800_000;

/** Fixture sizes. Every default is today's scale value; the daily file passes small ones. */
export type ScaleFixtureOptions = {
  /** Total active line heads. Default 1,100. */
  activeHeads?: number;
  /** Active heads that get a real `starting` Run. Default 100. */
  startingHeads?: number;
  /** Active continuation pairs (one predecessor + one successor head each). Default 50. */
  activePairs?: number;
  /** Active `readonly_copy` Sessions. Default 100. */
  activeCopies?: number;
  /** Archived line heads. Default 2,750. */
  archivedHeads?: number;
  /** Archived continuation pairs (only the successor is a head). Default 500. */
  archivedPairs?: number;
  /** Archived `readonly_copy` Sessions. Default 500. */
  archivedCopies?: number;
  /** X's distinct `participates` links. Default 2,099. */
  xParticipates?: number;
  /** Extra modules linked to X as open `responsible` targets. Default 0. */
  xResponsibleModules?: number;
  /** Tasks in the goal the starting heads claim. Default 100. */
  workTasks?: number;
  /** Messages R sends; the last two in refKey order are replied to. Default 2,500. */
  rMessages?: number;
  /** W's written anchors; all but the refKey-last are picked up. Default 30. */
  wAnchors?: number;
  /** Z's seeded historical Runs (plus the one real claim/fail). Default 2,999. */
  zRuns?: number;
  /** Seam I: width of the 200-wide read loops. Default 200. */
  lookupPageLimit?: number;
  /** Seam I: width of the 100-wide read loops. Default 100. */
  listPageLimit?: number;
  /**
   * A controlled clock for the archive writes (one value per archived Session,
   * in archive order). Absent keeps today's real clock.
   */
  archiveClock?: (index: number) => string;
};

/** The backend-independent shape of the workspace, exported for the test. */
export type ScaleFixture = {
  kind: ClaimFixtureKind;
  f: LineFixture;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  /** The four long-history line heads. */
  x: SessionRef; r: SessionRef; w: SessionRef; z: SessionRef;
  /** The 2,750 archived line heads (the expected `lines/archived` rows). */
  archivedHeads: SessionRef[];
  /** The 1,100 active line heads and the 100 active copies, for diagnostics. */
  activeHeads: SessionRef[];
  activeCopies: SessionRef[];
  activeSuccessors: SessionRef[];
  activePredecessors: SessionRef[];
  /** The real production-shaped reader (real undelivered/anomaly/queue factories). */
  reader: WorkLineReadPort;
  /** A reader over an arbitrary records surface and budget. */
  readerWith(records: WorkLineStore, budget?: number): WorkLineReadPort;
  /** The reader dependencies. */
  deps: WorkLineReaderDeps;
  close(): Promise<void>;
};

const SIGNAL = new AbortController().signal;
const AT = '2026-09-24T00:00:00.000Z';
const KERNEL_STORE = { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' };
const DEFAULT_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const MAIL_PERMISSIONS = { ...L_HOST.permissions, tools: [...SESSION_MAILBOX_TOOL_NAMES] };

/** X's goal: the responsible task plus the distinct `participates` targets. */
function xTaskSpecs(participates: number): { taskId: string; title: string }[] {
  return [
    { taskId: 'x', title: 'X task' },
    ...Array.from({ length: participates }, (_value, index) => ({
      taskId: `x-p-${String(index).padStart(4, '0')}`, title: `X participates ${String(index)}`,
    })),
  ];
}

function keyOf(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}

function workContext(base: CoreCallContext, runRef: RunRef, roleBinding: RunSnapshot['roleBinding']): CoreCallContext {
  return { ...base, principal: { kind: 'work_run', runRef, roleBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: SIGNAL };
}

/** A prepared manifest with the mailbox tool grant (real entry calls, no direct records). */
async function prepareWithPermissions(
  f: LineFixture, claim: TaskClaim, run: RunSnapshot, permissions: typeof L_HOST.permissions,
): Promise<PreparedTaskExecution> {
  const real = await prepareTaskForReal(f.base, {
    bodies: f.runs.bodies, runRef: claim.runRef, now: () => AT,
    requestId: `s2c-x-prepare-${claim.runRef.runId}`,
    host: preparationHost({ configurationRevision: L_HOST.configurationRevision,
      permissions, hostTemplate: L_HOST.hostTemplate }),
  });
  return real.prepared;
}

/** The real entry owner, used only to grant the mailbox tools to R and its replier. */
async function enterWithPermissions(f: LineFixture, claim: TaskClaim,
  permissions: typeof L_HOST.permissions): Promise<void> {
  const current = await f.runs.readExecution(claim);
  const prepared = await prepareWithPermissions(f, claim, current.run, permissions);
  const pin = async () => ({ ref: claim.runRef, revision: (await f.runs.readExecution(claim)).run.revision });
  const authorized = await f.runs.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 's2c-x-mailbox' },
    meta: { requestId: `s2c-x-auth-${claim.runRef.runId}`, expected: [await pin()] } });
  if (authorized.status !== 'committed') throw new Error(`S2C-X authorize failed: ${JSON.stringify(authorized)}`);
  const kernel = { adapterId: current.session.kernel.adapterId, kernelSessionId: current.session.kernel.kernelSessionId,
    runId: `s2c-l-kernel-run-${claim.runRef.runId}`, turnId: `s2c-l-kernel-turn-${claim.runRef.runId}` };
  const begun = await f.runs.entry.beginRuntimeEntry(f.ctx, { input: { permit: authorized.value, kernel },
    meta: { requestId: `s2c-x-begin-${claim.runRef.runId}`, expected: [await pin()] } });
  if (begun.status !== 'committed') throw new Error(`S2C-X begin failed: ${JSON.stringify(begun)}`);
  const entered = await f.runs.entry.recordExecutionEntered(f.ctx, { input: {
    permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
    enteredAt: AT, kernelSource: { ...kernel, position: 3 },
    history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
    meta: { requestId: `s2c-x-entered-${claim.runRef.runId}`, expected: [await pin()] } });
  if (entered.status !== 'committed') throw new Error(`S2C-X entered failed: ${JSON.stringify(entered)}`);
}

/** The real mailbox over a records surface, with the fresh admission dependency. */
function mailboxOver(f: LineFixture, records: GoalRecordTransactionPort & RecordLookupPort,
  bodies: RawArtifactStorePort, now: () => string): SessionMailboxPort {
  let seq = 0;
  return createSessionMailbox({
    records, sessions: f.base.sessionsPort,
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now, eventId: () => `s2c-x-mail-event-${++seq}` }),
    materials: createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now }),
    systemActor: { kind: 'system', id: 's2c-x-scale' }, now, newId: () => `s2c-x-mail-id-${++seq}`,
    runtimeAdmission: { bodies, authorizeConfiguration: async (_ctx, input) => ({ status: 'ready', value: {
      configurationRevision: input.configurationRevision, permissions: input.permissions,
      hostTemplate: input.hostTemplate } }) },
  });
}

/** The reader dependencies the production composition builds (P12/L1b). */
function realDeps(f: LineFixture, records: WorkLineStore, budget: number | undefined,
  widths: { lookupPageLimit?: number | undefined; listPageLimit?: number | undefined }): WorkLineReaderDeps {
  const bodies = new RawArtifactBodyStore();
  const now = () => AT;
  const sessionFacts = createSessionFactsService({ records });
  const dutyFor: SessionDutyReadPort = async () => ({ status: 'ready', value: 'executor' });
  return {
    records,
    dutyFor,
    undeliveredRepliesFor: (lineRecords) => {
      const lineMailbox = mailboxOver(f, lineRecords, bodies, now);
      return lineMailbox.readUndeliveredReplies?.bind(lineMailbox);
    },
    sessionAnomaliesFor: (lineRecords) => createSessionAnomalyService({ records: lineRecords, lookups: lineRecords,
      sessionFacts, now }) as SessionAnomalyPort,
    plans: f.base.plans,
    decisions: decisionReadsOver(f.base, records),
    ...(budget === undefined ? {} : { historyReadBudget: budget }),
    ...(widths.lookupPageLimit === undefined ? {} : { lookupPageLimit: widths.lookupPageLimit }),
    ...(widths.listPageLimit === undefined ? {} : { listPageLimit: widths.listPageLimit }),
  };
}

/**
 * The small world links X to extra modules so its open `responsible` stream
 * crosses a page at width 2 without adding a second responsible task. The
 * modules are added through the public architecture-catalog revision entry.
 */
async function addResponsibleModules(f: LineFixture, count: number,
  requestId: (name: string) => string): Promise<ModuleRef[]> {
  const projectId = f.base.scope.projectId;
  const refs: ModuleRef[] = Array.from({ length: count }, (_value, index) => ({
    projectId, moduleId: `s2c-x-link-${String(index + 1)}`,
  }));
  if (count === 0) return refs;
  const catalogService = createArchitectureCatalogService({ records: f.base.records });
  // P1-05: the baseline pin and the current catalog are the platform's values,
  // read through the public current-selection read (never the internal window).
  const current = await catalogService.readArchitectureRevision(f.ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready') throw new Error(`S2C-X catalog read failed: ${JSON.stringify(current)}`);
  const catalog = current.value.catalog.catalog;
  const existing = new Set(catalog.modules.map((module) => module.ref.moduleId));
  const added = refs.filter((ref) => !existing.has(ref.moduleId)).map((ref) => ({
    ref, name: `S2C-X link module ${ref.moduleId}`,
    responsibility: 'S2C-X open responsible-link page width', paths: [`s2c-x/${ref.moduleId}`],
    interfaces: [],
  }));
  if (added.length === 0) return refs;

  // P1-05: the Project/Workspace revisions are the platform's values, read
  // through the public registration read, not decoded from the Project record.
  const registration = await createProjectBootstrapServices({ records: f.base.records,
    now: () => AT, eventId: () => 's2c-x-registration-read' })
    .projects.readWorkspaceRegistration(f.ctx, f.base.scope);
  if (registration.status !== 'ready') throw new Error(`S2C-X registration read failed: ${JSON.stringify(registration)}`);
  const revised = await catalogService.reviseArchitectureCatalog(f.ctx, {
    input: {
      basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
      catalog: { ...catalog, modules: [...catalog.modules, ...added] },
      reason: 'S2C-X small world: responsible link page width',
    },
    meta: { requestId: requestId('catalog'), expected: [
      { ref: f.base.projectRef, revision: registration.value.project.revision },
      { ref: f.base.workspaceRef, revision: registration.value.workspace.revision },
    ] },
  });
  if (revised.status !== 'committed') throw new Error(`S2C-X catalog revision failed: ${JSON.stringify(revised)}`);
  return refs;
}

// -------------------------------------------------------------------------- //
// The builder                                                                //
// -------------------------------------------------------------------------- //

export async function buildScaleFixture(kind: ClaimFixtureKind,
  input: ScaleFixtureOptions = {}): Promise<ScaleFixture> {
  const activeHeads = input.activeHeads ?? 1_100;
  const startingHeadCount = input.startingHeads ?? 100;
  const activePairCount = input.activePairs ?? 50;
  const activeCopyCount = input.activeCopies ?? 100;
  const archivedHeadCount = input.archivedHeads ?? 2_750;
  const archivedPairCount = input.archivedPairs ?? 500;
  const archivedCopyCount = input.archivedCopies ?? 500;
  const xParticipates = input.xParticipates ?? 2_099;
  const xResponsibleModules = input.xResponsibleModules ?? 0;
  const workTaskCount = input.workTasks ?? 100;
  const rMessageCount = input.rMessages ?? 2_500;
  const wAnchorCount = input.wAnchors ?? 30;
  const zRunCount = input.zRuns ?? 2_999;
  const widths = { lookupPageLimit: input.lookupPageLimit, listPageLimit: input.listPageLimit };

  // The six named active heads plus the two pre-created base Sessions are
  // always present; the rest of `activeHeads` is filler.
  const fillerCount = activeHeads - startingHeadCount - activePairCount - 6 - 2;
  if (fillerCount < 0) throw new Error(`S2C-X activeHeads ${String(activeHeads)} is too small for its parts`);
  if (startingHeadCount > workTaskCount) throw new Error('S2C-X startingHeads exceeds workTasks');
  if (archivedHeadCount < archivedPairCount) throw new Error('S2C-X archivedHeads is smaller than archivedPairs');
  const archivedPlainCount = archivedHeadCount - archivedPairCount;

  const f = await openLineFixture(kind);
  const { scope, ctx } = f.base;
  let seq = 0;
  const requestId = (name: string): string => `s2c-x-${name}-${++seq}`;

  const workTaskSpecs = Array.from({ length: workTaskCount }, (_value, index) => ({
    taskId: `work-${String(index).padStart(3, '0')}`, title: `Scale work ${String(index)}`,
  }));
  const wTaskSpecs = Array.from({ length: wAnchorCount }, (_value, index) => ({
    taskId: `w-${String(index).padStart(2, '0')}`, title: `W anchor ${String(index)}`,
  }));

  // --- goals and their one shared task triple for continuation provenance ---
  const workGoal = await f.addGoal('x-scale-work', workTaskSpecs);
  const provGoal = await f.addGoal('x-scale-prov', [{ taskId: 'prov', title: 'Provenance task' }]);
  const provTask: TaskTriple = provGoal.tasks['prov']!;
  const xGoal = await f.addGoal('x-scale-x', xTaskSpecs(xParticipates));
  const rGoal = await f.addGoal('x-scale-r', [{ taskId: 'r', title: 'R task' }, { taskId: 'g', title: 'G task' }]);
  const wGoal = await f.addGoal('x-scale-w', wTaskSpecs);
  const zGoal = await f.addGoal('x-scale-z', [{ taskId: 'star', title: 'T star' }]);

  const continuation = (from: SessionRef): { schemaVersion: 1; kind: 'continuation'; from: SessionRef;
    reason: 'interrupted'; task: TaskTriple } =>
    ({ schemaVersion: 1, kind: 'continuation', from, reason: 'interrupted', task: provTask });

  // --- active heads ----------------------------------------------------------
  // Starting-Run lines: a real claim, no entry.
  const startingHeads: SessionRef[] = [];
  for (let index = 0; index < startingHeadCount; index += 1) {
    const head = (await f.createSession(requestId(`start-${String(index)}`))).ref;
    await f.claim(workTaskSpecs[index]!.taskId, head, workGoal);
    startingHeads.push(head);
  }

  // Active continuation pairs (P is not a head; C is the head).
  const activeSuccessors: SessionRef[] = [];
  const activePredecessors: SessionRef[] = [];
  for (let index = 0; index < activePairCount; index += 1) {
    const predecessor = (await f.createSession(requestId(`ap-${String(index)}`))).ref;
    const successor = (await f.createSession(requestId(`ac-${String(index)}`),
      { provenance: continuation(predecessor) })).ref;
    activePredecessors.push(predecessor);
    activeSuccessors.push(successor);
  }

  // The idle heads; the six named ones first.
  const x = (await f.createSession(requestId('x'))).ref;
  const r = (await f.createSession(requestId('r'))).ref;
  const w = (await f.createSession(requestId('w'))).ref;
  const z = (await f.createSession(requestId('z'))).ref;
  const replier = (await f.createSession(requestId('replier'))).ref;
  const picker = (await f.createSession(requestId('picker'))).ref;
  // The base fixture pre-creates two Sessions; they are two of the idle heads.
  const baseHeads = [f.base.sessions.first, f.base.sessions.second];
  const idleFillerHeads: SessionRef[] = [...baseHeads];
  for (let index = 0; index < fillerCount; index += 1) {
    idleFillerHeads.push((await f.createSession(requestId(`idle-${String(index)}`))).ref);
  }

  // --- X: participates links + open responsible task and module links --------
  for (let index = 0; index < xParticipates; index += 1) {
    await f.link(x, { kind: 'task', ref: xGoal.tasks[`x-p-${String(index).padStart(4, '0')}`]! }, 'participates', true);
  }
  await f.link(x, { kind: 'task', ref: xGoal.tasks['x']! }, 'responsible', true);
  for (const moduleRef of await addResponsibleModules(f, xResponsibleModules, requestId)) {
    await f.link(x, { kind: 'module', ref: moduleRef }, 'responsible', true);
  }

  // --- R: send messages, the last two answered; then retire ------------------
  const rClaim = await f.claim('r', r, rGoal);
  await enterWithPermissions(f, rClaim.claim, MAIL_PERMISSIONS);
  const gClaim = await f.claim('g', replier, rGoal);
  await enterWithPermissions(f, gClaim.claim, MAIL_PERMISSIONS);
  const rExec = await f.runs.readExecution(rClaim.claim);
  const gExec = await f.runs.readExecution(gClaim.claim);
  const mailbox = mailboxOver(f, f.base.records, f.runs.bodies, () => AT);
  const sent: { ref: SessionMessageRef; revision: number }[] = [];
  for (let index = 0; index < rMessageCount; index += 1) {
    const message = await mailbox.sendMessage(workContext(f.ctx, rClaim.runRef, rExec.run.roleBinding), {
      input: { recipient: replier, text: `S2C-X scale message ${String(index)}`, intent: 'inquiry', needsReply: true },
      meta: { requestId: requestId(`send-${String(index)}`), expected: [] } });
    if (message.status !== 'committed') throw new Error(`S2C-X send failed: ${JSON.stringify(message)}`);
    sent.push({ ref: message.value.ref, revision: message.value.revision });
  }
  sent.sort((left, right) => (keyOf(left.ref) < keyOf(right.ref) ? -1 : 1));
  for (const target of sent.slice(-2)) {
    const reply = await mailbox.respondMessage(workContext(f.ctx, gClaim.runRef, gExec.run.roleBinding), {
      input: { messageRef: target.ref, text: 'S2C-X scale reply' },
      meta: { requestId: requestId(`respond-${target.ref.messageId}`), expected: [{ ref: target.ref, revision: target.revision }] } });
    if (reply.status !== 'committed') throw new Error(`S2C-X respond failed: ${JSON.stringify(reply)}`);
  }
  await f.runs.recordResult(rClaim.claim, completedEvent(rClaim.claim, 's2c-x-r-end'));
  await f.runs.retire(r, 'missing');
  await f.runs.recordResult(gClaim.claim, completedEvent(gClaim.claim, 's2c-x-g-end'));

  // --- W: anchors, one run per task; all but the last picked up --------------
  const wRunRefs: RunRef[] = [];
  for (const task of wTaskSpecs) {
    const claim = await f.claim(task.taskId, w, wGoal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, completedEvent(claim.claim, `s2c-x-w-${task.taskId}`));
    wRunRefs.push(claim.runRef);
  }
  await f.writeAnchors(w, wRunRefs, 's2c-x-w-anchors');
  const anchors = wRunRefs.map((runRef) => ({
    runRef,
    anchorRef: { aggregateType: 'SessionAnomalyAnchor' as const, projectId: runRef.projectId,
      goalId: runRef.goalId, runId: runRef.runId },
  }));
  anchors.sort((left, right) => (sessionAnomalyRefKey(left.anchorRef) < sessionAnomalyRefKey(right.anchorRef) ? -1 : 1));
  for (const entry of anchors.slice(0, Math.max(0, anchors.length - 1))) {
    // STORAGE-BOUNDARY EXCEPTION (lead ruling 2026-10-15, item 14; same
    // reasoning as 2A exceptions 3-4): seeding the picker Runs through the
    // public claim path is quadratic for the measurement, so the record is
    // written here in the shape today's RunSnapshot@1 codec decodes.
    const baseRead = await f.base.records.readMany([keyOf(entry.runRef)]);
    if (baseRead.status !== 'ready' || baseRead.value.records[0] === undefined) throw new Error('S2C-X base W run read');
    const base = JSON.parse(baseRead.value.records[0].json) as RunSnapshot;
    const pickerRun: RunSnapshot = {
      ...base, ref: { ...base.ref, runId: `s2c-x-picker-${entry.runRef.runId}` },
      inputBinding: { ...(base.inputBinding ?? { schemaVersion: 1, inputDigest: '0'.repeat(64),
        manifestDigest: '1'.repeat(64), materialAccessRefs: [], deliveryRefs: [] }),
        anomalyAnchorRefs: [entry.anchorRef] },
      ...(base.executionHistory === undefined ? {} : { executionHistory: { ...base.executionHistory,
        sessionRef: { projectId: picker.projectId, sessionId: picker.sessionId } } }),
    };
    const committed = await f.base.commitRaw([{ refKey: keyOf(pickerRun.ref), schemaId: 'RunSnapshot@1',
      revision: pickerRun.revision, json: JSON.stringify(pickerRun) }]);
    if (committed.status !== 'committed') throw new Error(`S2C-X picker seed failed: ${JSON.stringify(committed)}`);
  }

  // --- Z: one real claim/fail on T*, then the seeded Runs ---------------------
  await f.link(z, { kind: 'task', ref: zGoal.tasks['star']! }, 'responsible', true);
  let zIds = 0;
  const zClaim = await f.claimWith('star', z, { goal: zGoal, now: () => AT,
    newId: () => (zIds++ === 0 ? 'zzz-s2c-x-star' : `s2c-x-z-aux-${String(zIds)}`) });
  await f.runs.enter(zClaim.claim);
  await f.runs.recordResult(zClaim.claim, crashedEvent(zClaim.claim, 's2c-x-z-real'));
  const zBaseRead = await f.base.records.readMany([keyOf(zClaim.runRef)]);
  if (zBaseRead.status !== 'ready' || zBaseRead.value.records[0] === undefined) throw new Error('S2C-X base Z run read');
  const zBase = JSON.parse(zBaseRead.value.records[0].json) as RunSnapshot;
  for (let index = 0; index < zRunCount; index += 1) {
    // STORAGE-BOUNDARY EXCEPTION (lead ruling 2026-10-15, item 14; same
    // reasoning as 2A exceptions 3-4): the historical Runs of Z's task exist
    // only to make queryTaskGraph's shared cost grow; driving them through real
    // claim/fail/requeue cycles is quadratic, so they are written here in the
    // shape today's RunSnapshot@1 codec decodes.
    const run: RunSnapshot = { ...zBase, ref: { ...zBase.ref, runId: `a-${String(index).padStart(5, '0')}` } };
    const committed = await f.base.commitRaw([{ refKey: keyOf(run.ref), schemaId: 'RunSnapshot@1',
      revision: run.revision, json: JSON.stringify(run) }]);
    if (committed.status !== 'committed') throw new Error(`S2C-X Z seed failed: ${JSON.stringify(committed)}`);
  }

  // --- active copies: a real consultation whose QueryRun is answered ----------
  // Only link-free filler heads are asked: a Session with X's links is refused
  // by the link-budget guard the copy consultation reads.
  const copySources = idleFillerHeads.slice(0, activeCopyCount);
  if (copySources.length < activeCopyCount) throw new Error('S2C-X activeCopies exceeds the link-free sources');
  const activeCopies: SessionRef[] = [];
  for (let index = 0; index < activeCopyCount; index += 1) {
    const asked = copySources[index]!;
    const consultation = await f.runs.beginConsultationCopy(asked, requestId(`copy-${String(index)}`));
    await f.runs.completeConsultation(consultation.queryRunRef, consultation.copy, 'answered',
      requestId(`copy-answer-${String(index)}`));
    activeCopies.push(consultation.copy);
  }

  // --- archived side: pairs + plain heads + copies ---------------------------
  const archivedOrder: SessionRef[] = [];
  const archivedHeads: SessionRef[] = [];
  for (let index = 0; index < archivedPairCount; index += 1) {
    const predecessor = (await f.createSession(requestId(`ahp-${String(index)}`))).ref;
    const successor = (await f.createSession(requestId(`ahc-${String(index)}`),
      { provenance: continuation(predecessor) })).ref;
    archivedOrder.push(predecessor, successor);
    archivedHeads.push(successor);
  }
  for (let index = 0; index < archivedPlainCount; index += 1) {
    const head = (await f.createSession(requestId(`arch-${String(index)}`))).ref;
    archivedOrder.push(head);
    archivedHeads.push(head);
  }
  for (let index = 0; index < archivedCopyCount; index += 1) {
    if (copySources.length === 0) throw new Error('S2C-X archivedCopies needs a link-free source');
    const copy = await createArchivedCopy(f, requestId(`arch-copy-${String(index)}`),
      copySources[index % copySources.length]!);
    archivedOrder.push(copy);
  }
  const archiveClock = input.archiveClock;
  if (archiveClock !== undefined) vi.useFakeTimers({ toFake: ['Date'] });
  try {
    let index = 0;
    for (const session of archivedOrder) {
      const at = archiveClock?.(index);
      if (at !== undefined) vi.setSystemTime(new Date(at));
      await f.archive(session, 'S2C-X scale archive');
      index += 1;
    }
  } finally {
    if (archiveClock !== undefined) vi.useRealTimers();
  }

  // --- shared reader wiring and the exported fixture --------------------------
  const deps = realDeps(f, f.base.records as unknown as WorkLineStore, undefined, widths);
  const fixture: ScaleFixture = {
    kind, f, ctx, scope, x, r, w, z, archivedHeads, activeCopies, activeSuccessors, activePredecessors,
    activeHeads: [...startingHeads, ...activeSuccessors, x, r, w, z, replier, picker, ...idleFillerHeads],
    reader: createWorkLineReader(deps),
    readerWith: (records, budget) => createWorkLineReader(realDeps(f, records, budget, widths)),
    deps,
    close: async () => { await f.close(); },
  };
  return fixture;
}

/** The archived `readonly_copy` Sessions: admit + register + archive (no Query). */
async function createArchivedCopy(f: LineFixture, requestId: string, asked: SessionRef): Promise<SessionRef> {
  const admitted = await f.base.sessionsPort.admitSessionCreation(f.ctx, {
    input: { workspace: f.base.scope, kernelStore: KERNEL_STORE, role: DEFAULT_ROLE,
      recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'readonly_copy', from: asked,
        messageRef: { aggregateType: 'SessionMessage', projectId: f.base.scope.projectId,
          workspaceId: f.base.scope.workspaceId, messageId: `s2c-x-arch-copy-${requestId}` } } },
    meta: { requestId: `${requestId}-admit`, expected: [] } });
  if (admitted.status !== 'committed') throw new Error(`S2C-X archived copy admission failed: ${JSON.stringify(admitted)}`);
  const registered = await f.base.sessionsPort.recordSessionCreated(f.ctx, {
    input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
      adapterId: KERNEL_STORE.adapterId, kernelSessionId: `s2c-x-arch-copy-kernel-${requestId}`,
      historyCursor: null, observedAt: AT },
    meta: { requestId: `${requestId}-register`, expected: [] } });
  if (registered.status !== 'committed') throw new Error(`S2C-X archived copy registration failed: ${JSON.stringify(registered)}`);
  return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
}
