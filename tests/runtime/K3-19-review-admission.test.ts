/**
 * K3 U5 / R4 (L13) and L20: the review/proposal round's fixed tools at the
 * start admission, reached through the REAL path.
 *
 * The positive precondition is a real review (or proposal) Run: a real
 * pending-review record from the shared blocked-Run fixture, the public
 * `claimTask` review claim (`claimK3ReviewRound`), the production
 * `prepareExecution` and the production Runtime's `startRun` (all inside the
 * shared helper). The prepare's `reviewPurpose` branch derives the phase's
 * exact fixed set and an empty write scope from the trusted purpose, so
 * admission must ADMIT the Run: the positive half of R4/L13/L20.
 *
 * F-033 (rejects:): a review round is claimed but NOT entered through the
 * public claim; then the Host's read-only command switch is turned off (a
 * runtime configuration change that does NOT change `configurationRevision`)
 * and the REAL production composition runs the Workflow's UR3a re-drive. The
 * re-drive does not consult `reviewCapability`; only the two admission sites
 * refuse: the prepared-manifest entry re-admission (`create-platform.ts`
 * `createAuthorizeConfiguration`) and the start admission
 * (`execution-driver.ts`). The two rows narrow the Host read at the one site
 * each row proves, so the other admission (and the unchanged configuration
 * version) cannot mask the named refusal.
 *
 * The inconsistent combinations the real path cannot produce (an ordinary
 * prepared manifest under a review purpose, a mixed-phase manifest, a set
 * missing/extra a tool, a non-empty write scope) are a pure input -> output
 * test of `reviewRoundAdmissionProblem` in
 * `tests/contracts/review-admission.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { k3_35Configuration, K3_35_HOST_REVISION } from '../helpers/K3-35-runtime.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld,
  reachK3AwaitingProposal, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { GOAL_B, PLAN_B2, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file: the real blocked Run's one
// call must be held by the seam, exactly as the other K3 real-Run tests do.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

// A4 (the backend/body-store factory seam): the production composition must
// share the test world's ONE real backend and body store, so the memory world
// (and the SQLite one, by directory) is reopened by the SAME production
// platform. Nothing else is wrapped.
const shared = vi.hoisted(() => ({
  active: false,
  backend: undefined as unknown,
  mergeBase: undefined as unknown,
  options: [] as unknown[],
  backends: [] as unknown[],
  bodies: [] as unknown[],
}));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  type Schemas = { records: readonly { schemaId: string }[]; events: readonly { eventType: string; schemaVersion: number }[];
    lookups?: readonly { name: string }[] };
  const merge = (left: Schemas, right: Schemas): Schemas => {
    const records = [...left.records];
    for (const record of right.records) if (!records.some(e => e.schemaId === record.schemaId)) records.push(record);
    const events = [...left.events];
    for (const event of right.events) if (!events.some(e => e.eventType === event.eventType
      && e.schemaVersion === event.schemaVersion)) events.push(event);
    const lookups = [...(left.lookups ?? [])];
    for (const lookup of right.lookups ?? []) if (!lookups.some(e => e.name === lookup.name)) lookups.push(lookup);
    return { records, events, lookups };
  };
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.active) {
      if (shared.backend !== undefined) {
        return shared.backend as ReturnType<typeof actual.createInMemoryRecordBackend>;
      }
      const merged = shared.mergeBase === undefined ? options.schemas
        : merge(options.schemas as unknown as Schemas, shared.mergeBase as Schemas);
      const backend = actual.createInMemoryRecordBackend({ ...options, schemas: merged as never });
      shared.backend = backend;
      return backend;
    }
    const backend = actual.createInMemoryRecordBackend(options);
    shared.backends.push(backend);
    shared.options.push(options);
    return backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  class SharedBodyStore extends actual.RawArtifactBodyStore {
    constructor(...args: ConstructorParameters<typeof actual.RawArtifactBodyStore>) {
      super(...args);
      if (shared.active && shared.bodies.length > 0) return shared.bodies[shared.bodies.length - 1] as never;
      shared.bodies.push(this);
    }
  }
  return { ...actual, RawArtifactBodyStore: SharedBodyStore };
});

const worlds: K3ReviewCardWorld[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  shellSeam.release();
  shared.active = false;
  shared.backend = undefined;
  shared.mergeBase = undefined;
  shared.options.length = 0;
  shared.backends.length = 0;
  shared.bodies.length = 0;
  for (const world of worlds.splice(0)) await world.close();
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function openWorld(kind: 'memory' | 'sqlite' = 'memory'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  return world;
}

/** The real entry fact: admission passed and the production Runtime entered the Run. */
function expectEntered(run: RunSnapshot): void {
  // An entered, in-flight Run is `running`; the V2 authorization slot is the
  // entry phase the shared helper itself waits for.
  expect(run.status).toBe('running');
  expect(run.executionAuthorization).toMatchObject({ schemaVersion: 2, phase: 'entered' });
}

it('K3-19 R4/L13: a real review-phase Run (public claim + production prepare/start) is admitted', async () => {
  const world = await openWorld();
  const record = await createK3PendingReview(world);
  const round = await claimK3ReviewRound(world, record, { phase: 'review' });

  expect(round.run.purpose).toEqual({
    kind: 'unknown_call_review', reviewRef: record.ref, phase: 'review', round: 1,
  });
  expectEntered(round.run);

  // The admitted Run reaches its model: the Runtime's own completed end.
  const ended = await endK3RunCompleted(world, round.claim);
  expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
});

it('K3-19 L20: a real proposal-phase Run (public claim + production prepare/start) is admitted', async () => {
  const world = await openWorld();
  // The public chain to a proposal round: blocked Run -> review_unavailable ->
  // safer_method answer -> real proposal claim/prepare/start.
  const state = await reachK3AwaitingProposal(world);

  expect(state.run.purpose).toEqual({
    kind: 'unknown_call_review', reviewRef: state.proposalRecord.ref, phase: 'proposal', round: 1,
  });
  expectEntered(state.run);

  const ended = await endK3RunCompleted(world, state.claim);
  expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
});

// -------------------------------------------------------------------------- //
// F-033 rejects: the prepare/start admission after the read-only switch is off
// -------------------------------------------------------------------------- //

const REVIEW_RUNTIME_TOOLS = ['read', 'run_readonly_command'] as const;
const ADMISSION_NOW = '2026-10-20T00:00:00.000Z';

type AdmissionHost = {
  /** One entry per Host configuration read; `narrow` when the read-only switch is off. */
  reads: { revision: string; readonlyCommandAccess: 'all_except_denied' | null }[];
  /** The read-only switch is off from the `at`-th read onwards (1-based). */
  at: number;
};

/**
 * The production composition over the SAME world backend (A4/A8 only). The
 * Host configuration is `k3_35Configuration` with only `readonlyCommandAccess`
 * narrowed from one read on; its `configurationRevision` never changes.
 *
 * Memory: the platform is created FIRST so its one memory backend (with the
 * full production schema set) is the backend the world opens through the A4
 * seam. SQLite: the world owns the directory and the platform opens the same
 * ledger/bodies files.
 */
async function openAdmissionWorld(kind: 'memory' | 'sqlite', input: {
  at: number; scripted: ReturnType<typeof createScriptedModel>;
}): Promise<{ world: K3ReviewCardWorld; platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  host: AdmissionHost }> {
  const host: AdmissionHost = { reads: [], at: input.at };
  let directory = '';
  let revision = 0;
  const runtimeHost = {
    async resolveConfiguration() {
      const full = k3_35Configuration([...REVIEW_RUNTIME_TOOLS], [], input.scripted.client);
      const narrow = host.reads.length + 1 >= host.at;
      const { readonlyCommandAccess: _granted, ...rest } = full;
      host.reads.push({ revision: full.configurationRevision,
        readonlyCommandAccess: narrow ? null : 'all_except_denied' });
      return { status: 'ready' as const, value: narrow ? { ...rest } : full };
    },
  };
  const workspace = {
    async resolveRoot(requested: { projectId: string; workspaceId: string }) {
      if (requested.projectId !== WORKSPACE_SCOPE.projectId
        || requested.workspaceId !== WORKSPACE_SCOPE.workspaceId) {
        return { status: 'rejected' as const, code: 'not_found' as const,
          reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready' as const, value: { root: directory, workspaceRevision: revision } };
    },
    async authorize() {
      return { status: 'ready' as const, value: { subjectKey: 'k3-19-admission-host',
        permissionRevision: K3_35_HOST_REVISION, allowsRead: () => true } };
    },
  };
  const consumerId = `k3-19-admission-${kind}`;
  const build = async (storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string },
    kernelPath: string) => await createTargetPlatform({
    storage, workspace,
    sourcePolicyFor: async () => ({ root: directory, permissionRevision: K3_35_HOST_REVISION,
      allowsRead: () => true }),
    runtime: runtimeHost as never,
    kernelStores: { entries: [{ adapterId: 's5-kernel', storeKey: 's5-kernel-store',
      workspace: WORKSPACE_SCOPE, databasePath: kernelPath }] },
    operatorActor: { kind: 'system', id: 'k3-19-admission-host' },
    now: () => ADMISSION_NOW,
  });
  let platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  let world: K3ReviewCardWorld;
  if (kind === 'memory') {
    // One throwaway world supplies the fixture-only schemas (`TrustedScopeSeeded`)
    // the production composition does not register; the A4 seam then opens ONE
    // memory backend with the union, used by the platform and the real world.
    shared.active = false;
    shared.backends.length = 0;
    shared.options.length = 0;
    const probe = await openK3ReviewCardWorld('memory');
    shared.mergeBase = (shared.options[shared.options.length - 1] as { schemas: unknown }).schemas;
    await probe.close();
    shared.active = true;
    shared.backend = undefined;
    shared.bodies.length = 0;
    const startDirectory = await mkdtemp(join(tmpdir(), 'k3-19-admission-'));
    temporaryDirectories.push(startDirectory);
    platform = await build({ kind: 'memory' }, join(startDirectory, 's5-kernel.sqlite'));
    world = await openK3ReviewCardWorld('memory');
    shared.active = false;
  } else {
    world = await openK3ReviewCardWorld('sqlite');
    directory = world.fixture.base.directory;
    revision = world.fixture.workspace.revision;
    platform = await build({ kind: 'sqlite', directory }, join(directory, 's5-kernel.sqlite'));
  }
  worlds.push(world);
  directory = world.fixture.base.directory;
  revision = world.fixture.workspace.revision;
  const f = world.fixture;
  platform.registerWorkflowBinding({ consumerId, binding: {
    workspace: WORKSPACE_SCOPE,
    sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
    roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget,
  } });
  return { world, platform, host };
}

/** The real public review claim (TASK-03r) that is NOT prepared or started. */
async function claimUnenteredReviewRound(world: K3ReviewCardWorld) {
  const f = world.fixture;
  const record = await createK3PendingReview(world);
  const session = await f.createS5Session(`k3-19-admission-${f.newId()}`);
  const claim = await f.claimRun({ requestId: `k3-19-admission-claim-${f.newId()}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' } });
  const current = await world.reviews.readReview(f.ctx, { ref: record.ref });
  if (current.status !== 'ready') throw new Error(JSON.stringify(current));
  expect(current.value.activeRound).toMatchObject({ runRef: claim.runRef, phase: 'review', round: 1 });
  return { record, claim };
}

/** Workflow UR3a: the claimed-but-unentered round selects `prepare` with the same claim. */
async function prepareOf(platform: Awaited<ReturnType<typeof createTargetPlatform>>,
  ctx: CoreCallContext, taskId: string, flowId: string) {
  const selected = await platform.workflow.advanceWork(ctx, { schemaVersion: 1, goalRef: GOAL_B,
    flowId, sessionHint: null, taskId, kind: 'select_work' });
  expect(selected, JSON.stringify(selected)).toMatchObject({ status: 'ready', value: {
    state: 'advance', next: { kind: 'perform', operation: { kind: 'prepare' } } } });
  if (selected.status !== 'ready' || selected.value.next === null
    || selected.value.next.kind !== 'perform') throw new Error(JSON.stringify(selected));
  return selected.value.next;
}

const ADMISSION_REFUSAL = 'the review round permissions are not admitted: readonly_command_access_not_full';

describe('rejects: the review-round prepared-manifest entry admission after the read-only switch is off', () => {
  it.each(['memory', 'sqlite'] as const)('F-033 (%s): the entry admission refuses; the version is unchanged and no model runs', async kind => {
    const scripted = createScriptedModel([{ kind: 'text', text: 'must never run' }]);
    // Read 1 = prepare, read 2 = the driver's own start admission (still full),
    // read 3 = the entry's `createAuthorizeConfiguration` (narrow).
    const environment = await openAdmissionWorld(kind, { at: 3, scripted });
    const { world, platform, host } = environment;
    const { claim } = await claimUnenteredReviewRound(world);
    const prepare = await prepareOf(platform, world.fixture.ctx, claim.task.taskId,
      `k3-19-prepare-${kind}`);
    const prepared = await platform.workflow.advanceWork(world.fixture.ctx, prepare);
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready', value: {
      state: 'advance', next: { kind: 'perform', operation: { kind: 'start' } } } });
    if (prepared.status !== 'ready' || prepared.value.next === null
      || prepared.value.next.kind !== 'perform') throw new Error(JSON.stringify(prepared));
    const started = await platform.workflow.advanceWork(world.fixture.ctx, prepared.value.next);
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: {
      state: 'waiting',
      receipt: { kind: 'start', result: { status: 'rejected', code: 'forbidden',
        reason: ADMISSION_REFUSAL } } } });
    // The version check cannot explain the refusal: every Host read carries the
    // same configurationRevision; only the read-only grant narrowed.
    expect(host.reads).toHaveLength(3);
    expect(host.reads.every(read => read.revision === K3_35_HOST_REVISION)).toBe(true);
    expect(host.reads[2]).toEqual({ revision: K3_35_HOST_REVISION, readonlyCommandAccess: null });
    // Zero model calls: the refusal is before the provider.
    expect(scripted.calls()).toBe(0);
  });
});

describe('rejects: the review-round start admission after the read-only switch is off', () => {
  it.each(['memory', 'sqlite'] as const)('F-033 (%s): the execution-driver admission refuses; the version is unchanged and no model runs', async kind => {
    const scripted = createScriptedModel([{ kind: 'text', text: 'must never run' }]);
    // Read 1 = prepare (full), read 2 = the driver's own start admission
    // (narrow) — the driver refuses before the entry re-admission.
    const { world, platform, host } = await openAdmissionWorld(kind, { at: 2, scripted });
    const { claim } = await claimUnenteredReviewRound(world);
    const prepare = await prepareOf(platform, world.fixture.ctx, claim.task.taskId,
      `k3-19-start-${kind}`);
    const prepared = await platform.workflow.advanceWork(world.fixture.ctx, prepare);
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'ready', value: {
      state: 'advance', next: { kind: 'perform', operation: { kind: 'start' } } } });
    if (prepared.status !== 'ready' || prepared.value.next === null
      || prepared.value.next.kind !== 'perform') throw new Error(JSON.stringify(prepared));
    const started = await platform.workflow.advanceWork(world.fixture.ctx, prepared.value.next);
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: {
      state: 'waiting',
      receipt: { kind: 'start', result: { status: 'rejected', code: 'forbidden',
        reason: ADMISSION_REFUSAL } } } });
    expect(host.reads).toHaveLength(2);
    expect(host.reads.every(read => read.revision === K3_35_HOST_REVISION)).toBe(true);
    expect(host.reads[1]).toEqual({ revision: K3_35_HOST_REVISION, readonlyCommandAccess: null });
    expect(scripted.calls()).toBe(0);
  });
});
