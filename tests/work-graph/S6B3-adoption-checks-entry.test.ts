/**
 * The narrow checks entry: the own-copy half runs the real `createHostSettings` on its own directory, with the real
 * Host facts, the saved Answer and the one allowed builder stand-in; the L-half rows below run on memory and SQLite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as hostSettingsModule from '../../src/app/host-settings.js';
import { createHostSettings, type HostSettingsAssembly, type HostSettingsCallbacks,
  type HostSettingsPrivateSnapshot, type HostSettingsWorkspaceFacts } from '../../src/app/host-settings.js';
import type { ChecksAdoptionEntryPort } from '../../src/app/host-settings-types.js';
import type { SettingsResponse } from '../../src/app/host-settings-types.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type { QueryJobAnswerRef, QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import type { RegisteredCommandCheck } from '../../src/contracts/verification.js';
import type {
  ChecksConfigurationPinV1, InitializationAdoptResultV1, InitializationAdoptionReadV1, InitializationAdoptionRef,
} from '../../src/contracts/initialization-adoption.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { parseInitialPlanningResponseV2 } from '../../src/contracts/initial-planning-parse.js';
import { readBootstrap, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  callS6B3LateRoute, callS6B3PublishedOwner, configureS6B3SecondWorkspace, disposeS6B3SettingsWrapper,
  holdS6B3PreparedGoalAnswer, installS6B3SettingsSpy, openS6B3World, settingsWithChecks,
} from '../helpers/S6B3-fixture.js';

// The commit gates need the barrier's two module mocks; one real start commit is held while the Answer is released.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.inMemoryBarrierModule(importOriginal);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.sqliteBarrierModule(importOriginal);
});

const childTuple = (suffix: string) => ({
  commandId: `s6b3-checks/${suffix}`,
  identityKey: `s6b3-checks/${suffix}`,
  fingerprint: sha256Hex(`s6b3 checks child ${suffix}`),
});

/** The one check the real saved Answer carries, hand-written here: every checks expectation uses this literal. */
const CHECK: RegisteredCommandCheck = {
  checkId: 's6b3-check-unit', kind: 'static', command: 'node --test', cwd: '.', timeoutMs: 120_000, taskIds: 'all',
};
const CHECKS: readonly RegisteredCommandCheck[] = [CHECK];
/** Hand-computed: sha256 of `canonicalJson(CHECKS)`, never produced by the production hash at expectation time. */
const CHECKS_DIGEST = 'ef0d04caa2b29b980c4cbb0545e3264e9181ef2f7123014d8069c9c62650f9c8';

type SavedAnswer = {
  ref: QueryJobAnswerRef;
  digest: string;
  checks: readonly RegisteredCommandCheck[];
};

type EntryInput = Parameters<ChecksAdoptionEntryPort['applyChecksForAdoption']>[1];

type SettingsPort = Awaited<ReturnType<typeof createHostSettings>> & ChecksAdoptionEntryPort;

type ChecksHarness = {
  settings: SettingsPort;
  directory: string;
  notifyCount(): number;
  snapshots(): HostSettingsPrivateSnapshot[];
  armNotifyFailure(): void;
  armReadOnlyAfterNotify(): void;
  source(checksRevision: number, answer?: SavedAnswer): ChecksConfigurationPinV1;
};

let world: Awaited<ReturnType<typeof openS6B3World>>;
let scope: CoreScope;
let goals: readonly GoalRef[];
let answer: SavedAnswer;
let emptyAnswer: SavedAnswer;
let bootstrapFacts: Awaited<ReturnType<typeof readBootstrap>>;
let workspaceFacts: HostSettingsWorkspaceFacts;
const temporary: string[] = [];
/** The real Host's own settings ports, captured at each start by the delegating wrapper on the factory. */
const hostPorts = new Map<string, SettingsPort>();

const setupFor = (target: CoreScope, checks: RegisteredCommandCheck[], label: string): InitialPlanningSetupV2 => ({
  architecture: {
    baselineId: `s6b3-checks-baseline-${label}`,
    description: 'the checks-entry acceptance architecture',
    constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{
      ref: { projectId: target.projectId, moduleId: `s6b3-checks-module-${label}` },
      name: `s6b3 checks module ${label}`,
      responsibility: 'own the narrow checks entry',
      paths: ['src'],
      interfaces: [],
    }] },
  },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 },
  checks,
});

/** Release one real prepared-goal Answer and read its saved text and setup back from the route result. */
async function saveAnswer(target: Awaited<ReturnType<typeof openS6B3World>>, readScope: CoreScope,
  goalRef: GoalRef, checks: RegisteredCommandCheck[], label: string): Promise<SavedAnswer> {
  const held = await holdS6B3PreparedGoalAnswer(target, { scope: readScope, goal: goalRef, setup: setupFor(readScope, checks, label) });
  const body = await held.release();
  const value = body['value'] as Record<string, unknown> | undefined;
  const saved = value?.['answer'] as Record<string, unknown> | undefined;
  const ref = saved?.['ref'] as QueryJobAnswerRef | undefined;
  const formal = saved?.['answer'] as Record<string, unknown> | undefined;
  const text = formal?.['answer'];
  if (ref === undefined || typeof text !== 'string') throw new Error('the released answer was not saved');
  const parsed = parseInitialPlanningResponseV2(text);
  if (parsed.status !== 'parsed' || parsed.response.kind !== 'plan' || parsed.response.setup === undefined)
    throw new Error('the saved initial-plan Answer carries no setup');
  return { ref, digest: sha256Hex(text), checks: parsed.response.setup.checks };
}

async function hostFacts(): Promise<HostSettingsWorkspaceFacts> {
  const registration = (await world.host.post('workspaces/registration', plain(scope, scope))).body as ReadResult<{ project: { revision: number }; workspace: { revision: number } }>;
  if (registration.status !== 'ready') throw new Error('the workspace registration was not ready');
  const snapshot = await world.host.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error('the Host settings snapshot was not ready');
  const facts = snapshot.value.workspaces.find(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
  if (facts === undefined) throw new Error('the opened workspace is missing from the Host settings snapshot');
  return {
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    name: facts.name,
    root: facts.root,
    workspaceRevision: registration.value.workspace.revision,
    modelId: facts.modelId,
    writeAllowed: facts.writeAllowed,
    commandsAllowed: facts.commandsAllowed,
  };
}

/** One real factory on its own directory; its assembly is the real Host registration/snapshot facts, the saved Answer
 *  read plus the production parser, the real `workspaces/open` restore and the real bootstrap read. */
async function createHarness(options: {
  directory?: string;
  adoption?: boolean;
} = {}): Promise<ChecksHarness> {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 's6b3-checks-entry-'));
  temporary.push(directory);
  const facts = workspaceFacts;
  const assembly: HostSettingsAssembly = {
    listWorkspaces: () => [structuredClone(facts)],
    readCheckProposal: async (readScope, answerRef) => {
      const read = (await world.host.post('queries/answer', plain(readScope, answerRef))).body as ReadResult<QueryJobAnswerSnapshot>;
      if (read.status !== 'ready') {
        return read.status === 'not_found'
          ? { status: 'rejected', code: 'not_found', reason: 'the saved initial-plan Answer was not found in this scope' }
          : { status: 'rejected', code: 'unavailable', reason: 'the saved initial-plan Answer could not be read' };
      }
      const text = read.value.answer.answer;
      const parsed = parseInitialPlanningResponseV2(text);
      if (parsed.status !== 'parsed' || parsed.response.kind !== 'plan' || parsed.response.setup === undefined) {
        return { status: 'rejected', code: 'not_found', reason: 'the saved Answer carries no initial-plan setup proposal' };
      }
      const checks = parsed.response.setup.checks;
      if (!Array.isArray(checks))
        return { status: 'rejected', code: 'invalid', reason: 'the saved Answer setup checks are malformed' };
      return { status: 'ready', value: {
        answerRef: structuredClone(answerRef), answerDigest: sha256Hex(text), checks: structuredClone(checks),
      } };
    },
    openWorkspace: async request => {
      const opened = await world.host.settings('workspaces/open', request);
      return opened.status === 'ready'
        ? { status: 'ready', value: { scope: opened.value.scope } }
        : opened as SettingsResponse<never>;
    },
    bootstrap: () => bootstrapFacts,
    secretConfigured: () => false,
  };

  let notifyCount = 0;
  let failNextNotify = false;
  let readOnlyAfterNotify = false;
  const snapshots: HostSettingsPrivateSnapshot[] = [];
  const adoption: NonNullable<HostSettingsCallbacks['adoption']> = {
    // The one allowed stand-in: the settings backend never computes or compares the revision recipe; the checks are
    // the real ones.
    buildConfiguration: input => ({
      configurationRevision: 'host-settings-checks:s6b3-checks-entry',
      workspace: { aggregateType: 'Workspace', projectId: input.scope.projectId, workspaceId: input.scope.workspaceId },
      executor: { kind: 'human', id: 's6b3-checks-entry' },
      permissionRevision: 's6b3-checks-entry-permission',
      sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied',
      deniedPrefixes: ['.git'],
      checks: [...input.checks],
    }),
    // The own-copy rows never read the installed configuration; only the real Host's published read confirms it.
    confirmInstalledChecks: async () => {
      throw new Error('S6B3: the own-copy factory must not answer the installed confirmation');
    },
  };
  const callbacks: HostSettingsCallbacks = {
    async onConfigurationChanged(snapshot) {
      notifyCount += 1;
      snapshots.push(snapshot);
      if (failNextNotify) {
        failNextNotify = false;
        throw new Error('S6B3: the checks notify fails before the real callback');
      }
      if (readOnlyAfterNotify) {
        readOnlyAfterNotify = false;
        await chmod(directory, 0o500);
      }
    },
    ...(options.adoption === false ? {} : { adoption }),
  };
  const settings = await createHostSettings({ settingsDirectory: directory, assembly }, callbacks);
  const base = notifyCount;
  return {
    settings,
    directory,
    notifyCount: () => notifyCount - base,
    snapshots: () => [...snapshots],
    armNotifyFailure: () => { failNextNotify = true; },
    armReadOnlyAfterNotify: () => { readOnlyAfterNotify = true; },
    source(checksRevision, saved = answer) {
      return {
        // The settings backend never compares this field; the builder above is the only consumer of the pinned source.
        configurationRevision: 'host-settings-checks:s6b3-checks-entry',
        contentDigest: sha256Hex(canonicalJson(saved.checks as unknown as JsonValue)),
        checksRevision,
        settings: { answerRef: structuredClone(saved.ref), answerDigest: saved.digest },
      };
    },
  };
}

const validInput = (harness: ChecksHarness, childSuffix = '1'): EntryInput => ({
  scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
  source: harness.source(1),
  child: childTuple(childSuffix),
  previous: null,
});

const savedChecks = async (harness: ChecksHarness) => {
  const settings = harness.settings;
  return await settings.readSavedChecks(world.host.humanContext(), { scope });
};

const apply = async (harness: ChecksHarness, input: EntryInput) =>
  await harness.settings.applyChecksForAdoption(world.host.humanContext(), input);

/** The real Host's own settings port, captured at its start: the saved and installed reads the deferred rows use. */
const hostPort = (target: Awaited<ReturnType<typeof openS6B3World>>): SettingsPort => {
  const port = hostPorts.get(target.settingsDirectory);
  if (port === undefined) throw new Error('the real Host published no settings port for this world');
  return port;
};
const savedState = async (target: Awaited<ReturnType<typeof openS6B3World>>, readScope: CoreScope) =>
  await hostPort(target).readSavedChecks(target.host.humanContext(), { scope: readScope });
const installedState = async (target: Awaited<ReturnType<typeof openS6B3World>>, readScope: CoreScope) =>
  await hostPort(target).confirmInstalledChecks(target.host.humanContext(), { scope: readScope });

let restoreSettings: (() => void) | undefined;
/** Install the fixture's one delegating wrapper for this test and extend it to keep the real Host's settings port. */
function installSettingsWrapper(): void {
  restoreSettings?.();
  restoreSettings = installS6B3SettingsSpy();
  const spy = hostSettingsModule.createHostSettings as unknown as {
    getMockImplementation(): ((options: Parameters<typeof createHostSettings>[0], callbacks: HostSettingsCallbacks) => Promise<SettingsPort>) | undefined;
    mockImplementation(implementation: (options: Parameters<typeof createHostSettings>[0], callbacks: HostSettingsCallbacks) => Promise<SettingsPort>): void;
  };
  const inner = spy.getMockImplementation();
  if (inner === undefined) throw new Error('the settings wrapper published no implementation to extend');
  spy.mockImplementation(async (options, callbacks) => {
    const made = await inner(options, callbacks);
    const directory = options.settingsDirectory;
    if (directory === undefined) throw new Error('S6B3: the real Host started without a settings directory');
    hostPorts.set(directory, made);
    return made;
  });
}

beforeAll(async () => {
  world = await openS6B3World({ backend: 'memory', mainGoals: 'none' });
  const second = await configureS6B3SecondWorkspace(world, { name: 's6b3-checks-entry', goals: 2 });
  scope = { projectId: second.scope.projectId, workspaceId: second.scope.workspaceId };
  goals = second.goals.map(goal => goal.ref);
  const goal = goals[0];
  const otherGoal = goals[1];
  if (goal === undefined || otherGoal === undefined) throw new Error('the second workspace has no Goals');
  answer = await saveAnswer(world, scope, goal, [...CHECKS], 'unit');
  emptyAnswer = await saveAnswer(world, scope, otherGoal, [], 'empty');
  bootstrapFacts = await readBootstrap(world.host.ag2b);
  workspaceFacts = await hostFacts();
});

afterAll(async () => {
  await disposeS6B3SettingsWrapper();
  restoreSettings?.();
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
  await world.close();
});

describe('the narrow checks entry (row 36a, own copy)', () => {
  it('saves the real saved-Answer checks with the frozen child and one new save revision', async () => {
    const harness = await createHarness();
    const result = await apply(harness, validInput(harness));
    expect(result).toMatchObject({ status: 'saved', value: { contentDigest: CHECKS_DIGEST } });
    expect(result.status === 'saved' ? result.value.configuration.checks : null).toEqual(CHECKS);
    expect(result.status === 'saved' ? result.value.settings : null).toEqual({
      answerRef: answer.ref, answerDigest: answer.digest,
    });
    expect(await savedChecks(harness)).toMatchObject({ status: 'ready', value: {
      source: { answerRef: answer.ref, answerDigest: answer.digest },
      checks: CHECKS, checksRevision: 1, child: childTuple('1'),
    } });
    expect(harness.notifyCount()).toBe(1);
  });

  it('answers unsupported when the optional adoption callbacks are absent', async () => {
    const harness = await createHarness({ adoption: false });
    const result = await apply(harness, validInput(harness));
    expect(result).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'unsupported' } });
    expect(await harness.settings.confirmInstalledChecks(world.host.humanContext(), { scope }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(harness.notifyCount()).toBe(0);
  });

  describe('rejects: a malformed or replaced input writes nothing', () => {
    it.each([
      ['a child commandId that is empty',
        (input: EntryInput) => ({ ...input, child: { ...input.child, commandId: '' } })],
      ['a child fingerprint that is not a sha256',
        (input: EntryInput) => ({ ...input, child: { ...input.child, fingerprint: 'not-a-fingerprint' } })],
      ['a source pin with a negative checks revision',
        (input: EntryInput) => ({ ...input, source: { ...input.source, checksRevision: -1 } })],
    ])('refuses %s before any read', async (_name, change) => {
      const harness = await createHarness();
      const result = await apply(harness, change(validInput(harness)));
      expect(result).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'invalid' } });
      expect(harness.notifyCount()).toBe(0);
      expect(await savedChecks(harness)).toEqual({ status: 'not_found' });
    });

    it('refuses a proposal source that another source replaced with revision_conflict', async () => {
      const harness = await createHarness();
      const input = validInput(harness);
      const replaced: ChecksConfigurationPinV1 = {
        ...input.source,
        settings: { answerRef: input.source.settings!.answerRef, answerDigest: sha256Hex('a replaced saved answer') },
      };
      const result = await apply(harness, { ...input, source: replaced });
      expect(result).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'revision_conflict' } });
      expect(harness.notifyCount()).toBe(0);
      expect(await savedChecks(harness)).toEqual({ status: 'not_found' });
    });
  });

  it('keeps the saved file and child when notify fails (saved_unconfirmed)', async () => {
    const harness = await createHarness();
    harness.armNotifyFailure();
    const result = await apply(harness, validInput(harness));
    expect(result).toMatchObject({ status: 'saved_unconfirmed' });
    const saved = await savedChecks(harness);
    expect(saved).toMatchObject({ status: 'ready', value: {
      checks: CHECKS, checksRevision: 1, child: childTuple('1'),
    } });
  });

  it('rolls the descriptor back and never notifies on a real persist failure', async () => {
    const harness = await createHarness();
    const mode = (await stat(harness.directory)).mode & 0o777;
    await chmod(harness.directory, 0o500);
    try {
      const result = await apply(harness, validInput(harness));
      expect(result).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'unavailable' } });
      expect(harness.notifyCount()).toBe(0);
      expect(await savedChecks(harness)).toEqual({ status: 'not_found' });
    } finally {
      await chmod(harness.directory, mode);
    }
  });

  it('recovers the same child without a second persist (the save revision does not grow)', async () => {
    const harness = await createHarness();
    const input = validInput(harness);
    expect((await apply(harness, input)).status).toBe('saved');
    const first = await savedChecks(harness);
    expect(first).toMatchObject({ status: 'ready', value: { checksRevision: 1 } });
    const second = await apply(harness, input);
    expect(second.status).toBe('saved');
    const after = await savedChecks(harness);
    expect(after).toMatchObject({ status: 'ready', value: { checksRevision: 1, child: childTuple('1') } });
    expect(harness.notifyCount()).toBe(2);
  });

  it('serializes two concurrent narrow saves: the second one sees the first save', async () => {
    const harness = await createHarness();
    const firstInput = validInput(harness, 'concurrent-a');
    const secondInput = { ...validInput(harness, 'concurrent-b'), source: harness.source(2) };
    const [first, second] = await Promise.all([apply(harness, firstInput), apply(harness, secondInput)]);
    expect(first).toMatchObject({ status: 'saved' });
    expect(second).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'revision_conflict' } });
    expect(harness.notifyCount()).toBe(1);
    expect(await savedChecks(harness)).toMatchObject({
      status: 'ready', value: { checksRevision: 1, child: childTuple('concurrent-a') },
    });
  });

  it('does not let one concurrent save failure roll back the other descriptor', async () => {
    const harness = await createHarness();
    harness.armReadOnlyAfterNotify();
    const firstInput = validInput(harness, 'concurrent-survivor');
    const secondInput = {
      ...validInput(harness, 'concurrent-failing'),
      source: harness.source(2),
      previous: harness.source(1),
    };
    try {
      const [first, second] = await Promise.all([apply(harness, firstInput), apply(harness, secondInput)]);
      expect(first).toMatchObject({ status: 'saved' });
      expect(second).toMatchObject({ status: 'not_saved', rejection: { status: 'rejected', code: 'unavailable' } });
      expect(harness.notifyCount()).toBe(1);
      expect(await savedChecks(harness)).toMatchObject({
        status: 'ready', value: { checksRevision: 1, child: childTuple('concurrent-survivor') },
      });
    } finally {
      await chmod(harness.directory, 0o700);
    }
  });

  it('parses an old settings file with no checksChild as a direct approval (child null, revision 0)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 's6b3-checks-old-'));
    temporary.push(directory);
    // A settings file written before the adoption child fields existed: the real approval shape, no child, no counter.
    await writeFile(join(directory, 'host-settings.json'), JSON.stringify({
      schemaVersion: 1,
      models: [],
      selection: {},
      workspaces: [{
        scope, name: workspaceFacts.name, root: workspaceFacts.root,
        writeAllowed: true, commandsAllowed: true,
        checks: answer.checks,
        checksSource: { answerRef: answer.ref, answerDigest: answer.digest },
      }],
    }));
    const harness = await createHarness({ directory });
    expect(harness.snapshots().at(-1)?.checks).toMatchObject([{
      scope, checks: CHECKS, answerRef: answer.ref, answerDigest: answer.digest,
      child: null, checksRevision: 0,
    }]);
    expect(await savedChecks(harness))
      .toMatchObject({ status: 'ready', value: { checksRevision: 0, child: null, checks: CHECKS } });
  });

  it('keeps an approved empty array through the private snapshot and a real reopen', async () => {
    const harness = await createHarness();
    const approved = await harness.settings.call('checks/approve', {
      scope, answerRef: emptyAnswer.ref, checks: [],
    });
    expect(approved.status).toBe('ready');
    const snapshot = harness.snapshots().at(-1);
    expect(snapshot?.checks).toMatchObject([{
      scope, checks: [], answerRef: emptyAnswer.ref, answerDigest: emptyAnswer.digest,
      child: null, checksRevision: 1,
    }]);

    // A new factory on the same directory is the real reopen: parse the file, restore the workspace, notify.
    const reopened = await createHarness({ directory: harness.directory });
    expect(reopened.snapshots().at(-1)?.checks).toMatchObject([{
      scope, checks: [], answerRef: emptyAnswer.ref, answerDigest: emptyAnswer.digest,
      child: null, checksRevision: 1,
    }]);
    expect(await savedChecks(reopened))
      .toMatchObject({ status: 'ready', value: { checks: [], checksRevision: 1, child: null } });
  });
});

// Deferred to L: these rows run the real public entry and keep their business assertions; J only proves the fixture's
// named error. Every row runs on memory and SQLite, each in its own world, so no row inherits another row's commit.

type ChecksBackend = 'memory' | 'sqlite';
type DeferredWorld = {
  world: Awaited<ReturnType<typeof openS6B3World>>;
  scope: CoreScope;
  goals: readonly GoalRef[];
  goalRevision: number;
  answer: SavedAnswer;
  emptyAnswer: SavedAnswer;
};

/** The operation locator a pending or stopped reply names; the committed receipt carries none. */
function operationRefOf(reply: InitializationAdoptResultV1): InitializationAdoptionRef {
  if (reply.status !== 'pending' && reply.status !== 'stopped')
    throw new Error(`the adopt reply carries no operation ref: ${reply.status}`);
  return reply.operationRef;
}

/** The checks stage's frozen child, read through the operation owner L publishes; the test builds no child. */
async function checksMarkChild(world: Awaited<ReturnType<typeof openS6B3World>>, scope: CoreScope,
  operationRef: InitializationAdoptionRef) {
  const read = await callS6B3PublishedOwner(world, {
    owner: 'initializationAdoption.read', wave: '6b3-w3', scope,
  }, { operationRef }) as ReadResult<InitializationAdoptionReadV1>;
  if (read.status !== 'ready') throw new Error(`the adoption read did not answer ready: ${read.status}`);
  const mark = read.value.stages.find(stage => stage.stage === 'checks');
  if (mark === undefined) throw new Error('the adoption record carries no checks mark');
  return mark.child;
}

async function openDeferred(backend: ChecksBackend, label: string): Promise<DeferredWorld> {
  const world = await openS6B3World({ backend, mainGoals: 'none' });
  try {
    const second = await configureS6B3SecondWorkspace(world, { name: `s6b3-checks-${label}`, goals: 2 });
    const scope = { projectId: second.scope.projectId, workspaceId: second.scope.workspaceId };
    const goals = second.goals.map(goal => goal.ref);
    const goal = goals[0];
    const otherGoal = goals[1];
    if (goal === undefined || otherGoal === undefined) throw new Error('the second workspace has no Goals');
    const goalRevision = second.goals[0]?.revision;
    if (goalRevision === undefined) throw new Error('the second workspace has no Goal revision');
    return {
      world, scope, goals, goalRevision,
      answer: await saveAnswer(world, scope, goal, [...CHECKS], `unit-${label}`),
      emptyAnswer: await saveAnswer(world, scope, otherGoal, [], `empty-${label}`),
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}

/** One real adopt call in the row's own world; the reply is L's `InitializationAdoptResultV1` unchanged. */
const adoptIn = ({ world, scope, goals, answer }: DeferredWorld) => async (options: {
  effect?: 'ok' | 'fail-notify' | 'hang-notify' | 'fail-persist'; commandId?: string;
} = {}) => {
  const save = await settingsWithChecks(world, {
    scope, answerRef: answer.ref, effect: options.effect ?? 'ok', entry: 'narrow', goal: goals[0]!,
    ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
  });
  if (save.entry !== 'narrow') throw new Error('the fixture answered the direct approval');
  return { save, reply: await save.done };
};

const deferredRows: { name: string;
  exercise(context: DeferredWorld, backend: ChecksBackend): Promise<void> }[] = [
  { name: 'saves the checks child, reports saved_unconfirmed and retries the stopped stage without a second save',
    async exercise(context, backend) {
      const { world, scope, answer } = context;
      const adoptViaRoute = adoptIn(context);
      const first = await adoptViaRoute({ effect: 'fail-notify' });
      expect(first.reply).toMatchObject({ status: 'pending', stage: 'checks', retryable: false });
      const unconfirmed = await savedState(world, scope);
      expect(unconfirmed).toMatchObject({ status: 'ready', value: {
        checks: CHECKS, checksRevision: 1, source: { answerRef: answer.ref, answerDigest: answer.digest },
      } });
      if (unconfirmed.status !== 'ready' || unconfirmed.value.child === null)
        throw new Error('the saved_unconfirmed checks child was not kept');
      const child = unconfirmed.value.child;
      expect(await checksMarkChild(world, scope, operationRefOf(first.reply))).toEqual(child);
      expect((await adoptViaRoute({ commandId: `s6b3-row1-${backend}` })).reply)
        .toMatchObject({ status: 'committed', replayed: false });
      expect(await savedState(world, scope)).toMatchObject({ status: 'ready', value: {
        checks: CHECKS, checksRevision: 1, child, source: { answerRef: answer.ref, answerDigest: answer.digest },
      } });
    } },
  { name: 'refuses a source that replaced the saved checks and writes no second time',
    async exercise(context, backend) {
      const { world, scope, emptyAnswer } = context;
      const adoptViaRoute = adoptIn(context);
      const first = await adoptViaRoute({ effect: 'fail-persist' });
      expect(first.reply).toMatchObject({ status: 'pending', stage: 'checks', retryable: false });
      expect(await savedState(world, scope)).toEqual({ status: 'not_found' });
      // A real direct approval of another saved Answer moves the saved source after the failed save.
      expect((await world.host.settings('checks/approve', {
        scope, answerRef: emptyAnswer.ref, checks: [],
      })).status).toBe('ready');
      const approved = await savedState(world, scope);
      if (approved.status !== 'ready') throw new Error('the direct approval saved no checks state');
      expect(approved).toMatchObject({ status: 'ready', value: {
        checks: [], checksRevision: 1, child: null,
        source: { answerRef: emptyAnswer.ref, answerDigest: emptyAnswer.digest },
      } });
      // A direct approval's child:null never matches the operation's frozen checks child.
      expect(await checksMarkChild(world, scope, operationRefOf(first.reply)))
        .not.toEqual(approved.value.child);
      expect((await adoptViaRoute({ commandId: `s6b3-row2-${backend}` })).reply)
        .toMatchObject({ status: 'pending', stage: 'checks', retryable: false,
          failure: { code: 'revision_conflict' } });
      expect(await savedState(world, scope)).toMatchObject({ status: 'ready', value: {
        checks: [], checksRevision: 1, child: null,
        source: { answerRef: emptyAnswer.ref, answerDigest: emptyAnswer.digest },
      } });
    } },
  { name: 'confirms the actual installation and never silently reinstalls a claimed child',
    async exercise(context, backend) {
      const { world, scope, goals, answer, goalRevision } = context;
      // The first public request's body is built once; the second submission changes only the command id.
      const body = {
        commandId: `s6b3-row4-${backend}`,
        source: { kind: 'prepared_goal', answerRef: answer.ref },
        expectedAnswerDigest: answer.digest,
        expectedGoal: { ref: goals[0]!, revision: goalRevision },
      };
      expect(await callS6B3LateRoute(world, 'initialization/adopt', '6b3-w3', plain(scope, body)))
        .toMatchObject({ status: 'committed' });
      const saved = await savedState(world, scope);
      if (saved.status !== 'ready' || saved.value.child === null)
        throw new Error('the committed checks stage kept no real child');
      const child = saved.value.child;
      const installed = await installedState(world, scope);
      expect(installed).toMatchObject({ status: 'ready', value: {
        contentDigest: CHECKS_DIGEST, settings: null, checks: CHECKS,
      } });
      // A new submission to the committed operation returns its stored result; no checks stage runs again.
      expect(await callS6B3LateRoute(world, 'initialization/adopt', '6b3-w3',
        plain(scope, { ...body, commandId: `s6b3-row4-${backend}-again` })))
        .toMatchObject({ status: 'committed' });
      expect(await installedState(world, scope)).toEqual(installed);
      expect(await savedState(world, scope)).toMatchObject({ status: 'ready', value: {
        checks: CHECKS, checksRevision: 1, child,
      } });
    } },
];

for (const backend of ['memory', 'sqlite'] as const) {
  describe(`deferred to L (6b3-w3, ${backend})`, () => {
    let row = 0;
    for (const deferred of deferredRows) {
      it(deferred.name, async () => {
        installSettingsWrapper();
        const context = await openDeferred(backend, `${backend}-${++row}`);
        try {
          await deferred.exercise(context, backend);
        } finally {
          await context.world.close();
        }
      });
    }
  });
}
