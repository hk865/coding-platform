/**
 * H's one shared scene (AH-30): the real memory/SQLite backend seam (A4) and the owner assembly over the world's real
 * platform owners. No receipt, basis, duty or record is built here.
 */
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { createSecretaryHandoffFacts } from '../../src/core/work-graph/views/secretary-handoff-facts.js';
import {
  createSecretaryArchiveService, createSessionHandoffAdvanceService,
  type SecretaryArchiveAdvanceDependencies, type SessionHandoffAdvanceDependencies,
} from '../../src/core/work-graph/sessions/session-handoff-service.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { readSecretaryHandoffBasis } from '../../src/core/work-graph/tasks/secretary-handoff-basis.js';
import type { S6AHostWorldOptions } from './S6A-host-fixture.js';
import type { S6ASession } from './S6A-request-fixture.js';
import type { openS6B2World } from './S6B2-fixture.js';

export type S6B2Backend = {
  records: SecretaryArchiveAdvanceDependencies['records'] & Parameters<typeof createSecretaryHandoffFacts>[0]['records'];
  commitIdentities: SessionHandoffAdvanceDependencies['commitIdentities'];
};
export type S6B2Captured = { backend: S6B2Backend | null };
export type S6B2World = Awaited<ReturnType<typeof openS6B2World>>;
export type S6B2WorldValue = S6B2World['world'];

/** The platform's real duty resolver over a Session's own role facts (the same one the owner rows reuse). */
export const s6b2Duty = createSessionDutyResolver({
  readRoleSpec: async () => ({ status: 'not_found' }), configuration: undefined,
});

type InMemoryModule = typeof import('../../src/core/record-store/in-memory-record-store.js');
type SqliteModule = typeof import('../../src/core/record-store/sqlite-record-store.js');

/** A4: one real backend shared by the platform and the test; `hold` adds the commit barrier around the factory. */
async function seal(captured: S6B2Captured, actual: InMemoryModule | SqliteModule, backend: 'memory' | 'sqlite',
  hold: boolean) {
  const barrier = await import('./S6A-commit-barrier.js');
  const held = hold
    ? await (backend === 'memory' ? barrier.inMemoryBarrierModule(async () => actual)
      : barrier.sqliteBarrierModule(async () => actual)) : actual;
  const create = (options: never) => {
    const built = backend === 'memory'
      ? (held as InMemoryModule).createInMemoryRecordBackend(options)
      : (held as SqliteModule).createSqliteRecordBackend(options);
    captured.backend = built as unknown as S6B2Backend;
    return built;
  };
  return backend === 'memory'
    ? { ...held, createInMemoryRecordBackend: create } : { ...held, createSqliteRecordBackend: create };
}

export const sealInMemory = (captured: S6B2Captured, actual: InMemoryModule, hold = false) =>
  seal(captured, actual, 'memory', hold);
export const sealSqlite = (captured: S6B2Captured, actual: SqliteModule, hold = false) =>
  seal(captured, actual, 'sqlite', hold);

export function s6b2Backend(captured: S6B2Captured): S6B2Backend {
  if (captured.backend === null) throw new Error('the test did not capture the platform backend');
  return captured.backend;
}

/**
 * A2: the real store's commit fails at its own named point for the named identity prefix. `once` fails the `nth`
 * matching commit (default the first) and lets every other through; `always` fails every match. The platform still
 * produces every fact it records; `restore` puts the real commit back on every path.
 */
export function s6b2FailCommit(records: S6B2Backend['records'], input: {
  prefix: string; nth?: number; mode?: 'once' | 'always';
}) {
  const real = records.commit;
  const seen = { count: 0 };
  records.commit = async (prepared) => {
    if (prepared.identityKey.startsWith(input.prefix)) {
      seen.count += 1;
      if ((input.mode ?? 'once') === 'always' || seen.count === (input.nth ?? 1)) {
        throw new Error(`S6B2: the ${input.prefix} commit failed${input.mode === 'always' ? '' : ' once'}`);
      }
    }
    return await real(prepared);
  };
  return { seen, restore: () => { records.commit = real; } };
}
/** The one opened-world list each file closes in `afterAll`, so every row opens the same way. */
export async function s6b2Workspace(world: S6B2WorldValue) {
  const { s6aCardsWorkspace } = await import('./S6A-cards-fixture.js');
  const { governS6B } = await import('./S6B1-fixture.js');
  const ws = s6aCardsWorkspace(world, world.scope);
  await governS6B(world, ws, world.goals);
  return ws;
}

export async function s6b2Accept(world: S6B2WorldValue, input: {
  commandId: string; source: SessionRef; target?: SessionRef; tasks?: readonly TaskTriple[];
  trigger?: 'manual' | 'too_long'; actor?: 'human' | 'system';
}) {
  const target = input.target === undefined ? { kind: 'create' as const, duty: 'secretary' as const }
    : { kind: 'existing' as const, session: input.target };
  const accepted = await world.platform.sessionHandoff.acceptHandoff(
    input.actor === 'system' ? world.systemContext() : world.humanContext(),
    { commandId: input.commandId, workspace: { ...world.scope }, source: input.source,
      trigger: input.trigger ?? 'manual', assignments: [{ target, tasks: [...(input.tasks ?? [])] }] });
  if (accepted.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
  return accepted.value.operation;
}

export function s6b2Scene() {
  const opened: S6B2World[] = [];
  /** `extraHostOptions` keeps the Host options the older rows pass; `options` adds the world's own setup. */
  async function openScene(backend: 'memory' | 'sqlite', extraHostOptions?: S6AHostWorldOptions['extraHostOptions'],
    options: Omit<S6AHostWorldOptions, 'backend' | 'extraHostOptions'> = {}) {
    const { openS6B2World } = await import('./S6B2-fixture.js');
    const openedWorld = extraHostOptions === undefined
      ? await openS6B2World({ backend, ...options })
      : await openS6B2World({ backend, ...options, extraHostOptions });
    opened.push(openedWorld);
    return openedWorld;
  }
  return {
    open: openScene,
    async closeAll() { await Promise.all(opened.splice(0).map(openedWorld => openedWorld.close())); },
  };
}

/**
 * The request-scene steps of the carrier rows, imported late: a test's backend mock factory imports this module, and a
 * static import of the app host here would re-enter that factory before it returns.
 */
async function carrierSteps() {
  const [{ readQuery }, { AG2B_CONSUMER_ID, plain }, { claimWithSecretaryProfile }, { S6A_SCOPE }] = await Promise.all([
    import('./A2-restart-fixture.js'), import('./AG2b-collaboration-fixture.js'),
    import('./request-claim-steps.js'), import('./S6A-request-fixture.js'),
  ]);
  return { readQuery, AG2B_CONSUMER_ID, plain, claimWithSecretaryProfile, scope: S6A_SCOPE };
}

/** Claim (when needed) and prepare one carrier round, reading its frozen manifest through the public route. */
async function prepareCarrierRound(world: S6B2WorldValue, round: QueryJobRef, session: S6ASession, id: string) {
  const { readQuery, plain, claimWithSecretaryProfile, scope } = await carrierSteps();
  if ((await readQuery(world.ag2b, round)).run.run.executionState === undefined) {
    const claimed = await claimWithSecretaryProfile(world, round, session, `${id}-claim`);
    if (claimed['status'] !== 'committed') throw new Error(`S6B2: ${id} was not claimed: ${JSON.stringify(claimed)}`);
  }
  const run = (await readQuery(world.ag2b, round)).run.ref;
  const prepared = (await world.post('queries/prepare', plain(scope, {
    queryRunRef: run, requestId: `${id}-prepare`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`S6B2: ${id} was not prepared: ${JSON.stringify(prepared)}`);
  const opened = (await world.post('materials/open', plain(scope, {
    ref: prepared.value.bundleRef, usage: 'historical_explanation',
  }))).body as ReadResult<{ body: string }>;
  if (opened.status !== 'ready') throw new Error(`S6B2: ${id} has no frozen manifest: ${JSON.stringify(opened)}`);
  return { run, prepared: prepared.value, manifest: JSON.parse(opened.value.body) as PreparedQueryManifestV1 };
}

/**
 * The shared public prefix of the understanding-carrier rows: two Goal requests routed to the secretary, the hand-off
 * accepted and advanced to the understanding stage, that round's first attempt held before the Kernel and the Host
 * crashed, then the round prepared again at the frozen live grant set. The close and each row's own gate stay at the
 * caller.
 */
export async function s6b2UnderstandingCarrier(world: S6B2WorldValue, secretary: S6ASession, label: string) {
  const { AG2B_CONSUMER_ID, plain, scope } = await carrierSteps();
  for (const [index, goal] of [world.goals.first, world.goals.second].entries()) {
    const pending = await world.submit({ commandId: `${label}-goal-${index}`, goalId: goal.goalId,
      text: `S6B2 ${label} ${index}` });
    if (pending.status !== 'queued') throw new Error(`S6B2: the ${label} request was refused`);
    const routed = await world.route({ commandId: `${label}-goal-${index}-route`, round: pending.round, to: secretary });
    if (routed.status !== 'routed') throw new Error(`S6B2: the ${label} request was not routed: ${JSON.stringify(routed)}`);
  }
  const operation = await s6b2Accept(world, { commandId: `${label}-accept`, source: secretary.ref,
    trigger: 'too_long', actor: 'system' });
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the Workflow publishes no handoff composite');
  const advanced = await owner.advance(world.systemContext(), { operation });
  if (advanced.status !== 'ready' || advanced.value.stage !== 'understanding') {
    throw new Error(`S6B2: the handoff did not reach understanding: ${JSON.stringify(advanced)}`);
  }
  const record = await world.platform.sessions.getSessionOperation(world.systemContext(), operation);
  const carrier = record.status === 'ready' && record.value.action.kind === 'handoff'
    ? record.value.action.progress.understanding.at(-1)?.round : null;
  if (carrier === null || carrier === undefined) throw new Error('S6B2: the handoff appended no round');
  // The first attempt lands its entry and the Host crashes there; the recovery opens a new pending attempt.
  const first = await prepareCarrierRound(world, carrier, secretary, `${label}-first`);
  const entry = await world.gates.beforeKernel(secretary);
  world.post('queries/start', plain(scope, { prepared: first.prepared, consumerId: AG2B_CONSUMER_ID,
    requestId: `${label}-first-start` })).catch(() => undefined);
  await entry.reached;
  await world.crash();
  const second = await prepareCarrierRound(world, carrier, secretary, `${label}-second`);
  const grants = second.manifest.request?.understandingGrants;
  if (grants?.length !== 2 || grants[0]?.goalId !== world.goals.first.goalId
    || grants[1]?.goalId !== world.goals.second.goalId) {
    throw new Error(`S6B2: the recovery prepared the wrong live grants: ${JSON.stringify(grants)}`);
  }
  return { operation, carrier, ...second };
}

export function s6b2Facts(world: S6B2WorldValue, captured: S6B2Captured,
  records: S6B2Backend['records'] = s6b2Backend(captured).records) {
  return createSecretaryHandoffFacts({ records, requests: world.platform.requestFacts,
    sessions: world.platform.sessions, duty: s6b2Duty });
}

export function s6b2Transfers(world: S6B2WorldValue, captured: S6B2Captured,
  records: S6B2Backend['records'] = s6b2Backend(captured).records) {
  return createSessionResponsibilityService({ records, lookups: records,
    basis: createSessionResponsibilityBasisReader(records), now: () => world.clock.now() });
}

export function s6b2Basis(records: S6B2Backend['records']) {
  return (session: SessionRef, scope: WorkspaceScope) =>
    readSecretaryHandoffBasis(records as never, scope, session, 625_000);
}

type AdvanceOptions = {
  records?: S6B2Backend['records'];
  coverage?: ReturnType<typeof s6b2Facts>;
  transfers?: ReturnType<typeof s6b2Transfers>;
  basis?: SessionHandoffAdvanceDependencies['basis'];
  requests?: SessionHandoffAdvanceDependencies['requests'];
  archive?: SessionHandoffAdvanceDependencies['archive'];
};

export function s6b2Advance(world: S6B2WorldValue, captured: S6B2Captured, options: AdvanceOptions = {}) {
  const backend = s6b2Backend(captured);
  const records = options.records ?? backend.records;
  return createSessionHandoffAdvanceService({ records, commitIdentities: backend.commitIdentities,
    operations: world.platform.sessions, coverage: options.coverage ?? s6b2Facts(world, captured, records),
    basis: options.basis ?? s6b2Basis(records), requests: options.requests ?? world.platform.requestRounds,
    transfers: options.transfers ?? s6b2Transfers(world, captured, records),
    archive: options.archive ?? world.platform.sessions,
    duty: s6b2Duty, now: () => world.clock.now() });
}

export function s6b2Archive(world: S6B2WorldValue, captured: S6B2Captured,
  records: S6B2Backend['records'] = s6b2Backend(captured).records) {
  return createSecretaryArchiveService({ records, commitIdentities: s6b2Backend(captured).commitIdentities,
    operations: world.platform.sessions, requests: { ...world.platform.requestRounds,
      readRequest: world.platform.requestFacts.readRequest },
    archive: world.platform.sessions, checkArchiveCondition: s6b2Facts(world, captured, records).checkArchiveCondition,
    duty: s6b2Duty, now: () => world.clock.now() });
}

/**
 * The real manual archive chain through the published owners: `sessionArchive.acceptArchive` accepts and the
 * Workflow's published `manualArchive` drives the operation. With `failFinalCommit` the real final archive step's own
 * commit fails once (A2), so the real owner answers partial and the caller observes that window and resumes it.
 */
export async function s6b2ManualArchiveChain(world: S6B2WorldValue, captured: S6B2Captured, label: string,
  options: { failFinalCommit?: boolean } = {}) {
  const { seedS6BArchiveSource } = await import('./S6B1-fixture.js');
  const seeded = await seedS6BArchiveSource(await s6b2Workspace(world), label);
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the Workflow publishes no handoff composite');
  const records = s6b2Backend(captured).records;
  const fault = options.failFinalCommit === true ? s6b2FailCommit(records, { prefix: 's1-archive-step:' }) : null;
  try {
    const accepted = await world.platform.sessionArchive.acceptArchive(world.humanContext(), {
      commandId: `s6b2-archive-chain-${label}`, source: seeded.source,
      choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    if (accepted.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
    const driven = await owner.manualArchive(world.humanContext(), { operation: accepted.value.operation });
    if (driven.status !== 'ready') throw new Error(`manual archive failed: ${JSON.stringify(driven)}`);
    const record = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    if (record.status !== 'ready' || record.value.action.kind !== 'secretary_archive') {
      throw new Error(`archive operation read failed: ${JSON.stringify(record)}`);
    }
    return { world, seeded, operation: accepted.value.operation, driven: driven.value,
      saved: record.value.action.progress.archiveRequest?.savedInput };
  } finally {
    fault?.restore();
  }
}
