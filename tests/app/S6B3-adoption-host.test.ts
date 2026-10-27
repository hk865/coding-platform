/**
 * Rows 35b and 36b: the Host's `initialization.adopt` over the platform's real adoption owner. 35b is the storage half
 * (the registered bundle, receipt replay, a new submission, stale writes, and a file-level crash after each parent
 * write on SQLite); 36b is the installed confirmation port. Every state comes from the S6B3 fixture's public steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalKey, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { WorkspaceScope as Scope } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import type { RegisteredCommandCheck } from '../../src/contracts/verification.js';
import {
  initializationAdoptionOperationId, type InitializationAdoptStageV1,
  type InitializationAdoptionReadV1, type InitializationAdoptionRef,
} from '../../src/contracts/initialization-adoption.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  callS6B3LateRoute, callS6B3PublishedOwner, configureS6B3SecondWorkspace, crashS6B3Host, disposeS6B3SettingsWrapper,
  holdS6B3AdoptionGate, holdS6B3DraftAnswer, holdS6B3PreparedGoalAnswer, installS6B3SettingsSpy, openS6B3World,
  readReady, releaseS6B3DraftAnswer, settingsWithChecks, valueOf, type S6B3World,
} from '../helpers/S6B3-fixture.js';

// The stage gates need the barrier's two module mocks; each passes the real backend through unchanged.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.inMemoryBarrierModule(importOriginal);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.sqliteBarrierModule(importOriginal);
});

type Answer = { ref: QueryJobAnswerRef; digest: string };
type Row = { world: S6B3World; scope: Scope; goals: { ref: GoalRef; revision: number }[]; answers: Answer[] };
type Mark = InitializationAdoptionReadV1['stages'][number];

const CHECK: RegisteredCommandCheck = {
  checkId: 's6b3-host-check', kind: 'static', command: 'node --test', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
};
const setupWith = (checks: RegisteredCommandCheck[]): InitialPlanningSetupV2 => ({
  architecture: { baselineId: 's6b3-host-baseline', description: 'the adoption host rows', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [] } },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 },
  checks,
});
const STAGES = ['admission', 'freeze', 'architecture', 'policy_install', 'policy_activate', 'checks', 'propose', 'apply'] as const;

let restoreSettings: (() => void) | undefined;
// `restoreMocks:true` restores every spy before each test, so the world must find the wrapper installed per test.
beforeEach(() => { restoreSettings = installS6B3SettingsSpy(); });
afterEach(async () => {
  await disposeS6B3SettingsWrapper();
  restoreSettings?.();
  restoreSettings = undefined;
});

/** One prepared-goal Answer per `setups` entry (Goal 1, Goal 2 of the second workspace), each released and read back. */
async function inRow(backend: 'memory' | 'sqlite', name: string, setups: InitialPlanningSetupV2[],
  body: (row: Row) => Promise<void>, staticChecks?: true): Promise<void> {
  const world = await openS6B3World({ backend, mainGoals: 'none', ...(staticChecks ? { staticChecks } : {}) });
  try {
    const second = await configureS6B3SecondWorkspace(world, { name, goals: 2 });
    const scope = { projectId: second.scope.projectId, workspaceId: second.scope.workspaceId };
    const answers: Answer[] = [];
    for (const [index, setup] of setups.entries()) {
      const goal = second.goals[index];
      if (goal === undefined) throw new Error('the second workspace has too few Goals');
      const released = await (await holdS6B3PreparedGoalAnswer(world, { scope, goal: goal.ref, setup })).release();
      const saved = (released['value'] as { answer?: { ref: QueryJobAnswerRef; answer: { answer: string } } }).answer;
      if (saved === undefined) throw new Error('the released prepared answer was not saved');
      answers.push({ ref: saved.ref, digest: sha256Hex(saved.answer.answer) });
    }
    await body({ world, scope, goals: second.goals.map(goal => ({ ref: goal.ref, revision: goal.revision })), answers });
  } finally {
    await world.close();
  }
}

/** The public adopt body for Answer `index` on its Goal, and the operation locator the platform derives from it. */
function submission(row: Row, index: number, commandId: string) {
  const answer = row.answers[index] as Answer;
  const goal = row.goals[index] as Row['goals'][number];
  const body = { commandId, source: { kind: 'prepared_goal' as const, answerRef: answer.ref },
    expectedAnswerDigest: answer.digest, expectedGoal: goal };
  const ref: InitializationAdoptionRef = { aggregateType: 'InitializationAdoption', projectId: row.scope.projectId,
    operationId: initializationAdoptionOperationId({ ...row.scope, source: body.source, expectedGoal: goal }) };
  return { body, ref };
}

/** Brief §6(a)'s child of each stage over this row's values: a stage with no owner keeps its label and the hash of its
 *  saved input (the checks entry: of its port argument); an owner stage keeps that owner's identity and fingerprint. */
function childrenOf(row: Row, { body, ref }: ReturnType<typeof submission>, read: InitializationAdoptionReadV1) {
  const op = ref.operationId;
  const { projectId, workspaceId } = row.scope;
  const { actor } = row.world.host.humanContext().principal as { actor: { kind: string; id: string } };
  const digest = (value: unknown) => sha256Hex(canonicalKey(value));
  const labelled = (stage: string, material: unknown) =>
    ({ commandId: `${op}/${stage}`, identityKey: `${op}/${stage}`, fingerprint: digest(material) });
  const owned = (prefix: string, stage: string, material: object) => ({ commandId: `${op}/${stage}`,
    identityKey: prefix + canonicalKey({ projectId, actor, idempotencyKey: `${op}/${stage}` }),
    fingerprint: digest({ schemaVersion: 1, ...material }) });
  const [admission, freeze, , , , checks, propose, apply] = read.stages as readonly [Mark, Mark, Mark, Mark, Mark, Mark, Mark, Mark];
  const project = admission.pins.project;
  const { architecture, policy } = apply.pins as { architecture: unknown; policy: { digest: string } };
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId, policyId: op, revision: 1 };
  const setup = setupWith([CHECK]);
  const proposal = (propose.result as { receipt: { value: unknown } }).receipt.value as PlanProposal;
  const saved = checks.savedInput as { source: unknown; previous: unknown };
  return [
    labelled('admission', admission.savedInput),
    labelled('freeze', freeze.savedInput),
    owned('architecture-catalog-adopt:', 'architecture', { commandType: 'AdoptInitialArchitecture', projectId, workspaceId,
      ...setup.architecture, expected: { project, workspace: (admission.savedInput as { workspacePin: unknown }).workspacePin } }),
    owned('completion-policy-install:', 'policy-install', { commandType: 'InstallCompletionPolicy', projectId, policyId: op,
      contentRevision: 1, content: setup.completionPolicy, actor, expected: [{ ref: policyRef, revision: 0 }, project] }),
    owned('completion-policy-activate:', 'policy-activate', { commandType: 'ActivateCompletionPolicy', projectId,
      target: { ref: policyRef, digest: policy.digest }, actor,
      expected: [project, { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] }),
    labelled('checks', { scope: row.scope, source: saved.source, previous: saved.previous }),
    owned('plan-propose:', 'propose', { commandType: 'PlanProposeInitial', projectId, workspaceId, actor,
      answerRef: body.source.answerRef, reason: { text: 'initialization adoption', sources: [] },
      requestId: `${op}/propose`, expected: [], source: body.source }),
    owned('plan-apply:', 'apply', { commandType: 'PlanApply', projectId, workspaceId, proposalRef: proposal.ref,
      expectedProposalRevision: proposal.revision, decisionRefs: [], governancePins: { architecture, policy } }),
  ];
}

const adoptRoute = (row: Row, body: unknown) => callS6B3LateRoute(row.world, 'initialization/adopt', '6b3-w3', plain(row.scope, body));
const owner = (row: Row, member: 'read' | 'resume' | 'saveBefore', input: unknown) =>
  callS6B3PublishedOwner(row.world, { owner: `initializationAdoption.${member}`, wave: '6b3-w3', scope: row.scope }, input);
async function readOperation(row: Row, ref: InitializationAdoptionRef): Promise<InitializationAdoptionReadV1> {
  return readReady(await owner(row, 'read', { operationRef: ref }) as ReadResult<InitializationAdoptionReadV1>,
    'the adoption read');
}
async function readCurrent(row: Row, route: string, input: unknown): Promise<Record<string, unknown>> {
  return valueOf<Record<string, unknown>>(await callS6B3LateRoute(row.world, route, '6b3-w3',
    plain(row.scope, input)), 'ready', route);
}

describe('row 35b: P11 storage, receipt replay and the file-level crash', () => {
  it.each(['memory', 'sqlite'] as const)('a committed adoption replays, survives a new submission and refuses stale writes (%s)',
    backend => inRow(backend, `host-35b-${backend}`, [setupWith([CHECK]), setupWith([CHECK])], async row => {
      const { body, ref } = submission(row, 0, `s6b3-host-35b-${backend}`);
      const first = await adoptRoute(row, body);
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      const committed = await readOperation(row, ref);
      // accept + one before- and one after-write per stage; the stored result is the route's answer.
      expect(committed).toMatchObject({ revision: 17, generation: 1, completedSteps: STAGES, result: first });
      expect(committed.stages.map(mark => mark.outcome))
        .toEqual(['installed', 'installed', 'installed', 'installed', 'installed', 'installed', 'installed', 'installed']);
      expect(committed.stages.map(mark => mark.child)).toEqual(childrenOf(row, { body, ref }, committed));
      // The apply moved the Goal; the same submission still answers the original receipt.
      const goal = await readCurrent(row, 'goals/read', body.expectedGoal.ref) as { goal: { revision: number } };
      expect(goal.goal.revision).toBeGreaterThan(body.expectedGoal.revision);
      expect(await adoptRoute(row, body)).toEqual(first);
      expect(await adoptRoute(row, { ...body, expectedAnswerDigest: sha256Hex('another saved answer') }))
        .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      expect(await readOperation(row, ref)).toEqual(committed);
      // A new authorized submission raises the generation and keeps the stages, prefix and committed result.
      expect(await adoptRoute(row, { ...body, commandId: `${body.commandId}-2` })).toEqual(first);
      const raised = await readOperation(row, ref);
      expect(raised).toEqual({ ...committed, revision: 18, generation: 2 });
      // The old pair and a write under the old generation are refused; nothing is written.
      expect(await owner(row, 'resume', { operationRef: ref, commandId: `${body.commandId}-resume`,
        expected: { revision: committed.revision, generation: committed.generation } }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const { child, savedInput, pins } = committed.stages[0] as InitializationAdoptionReadV1['stages'][number];
      expect(await owner(row, 'saveBefore', { commandId: `${ref.operationId}:admission:-:before:1-stale`,
        operationRef: ref, stage: 'admission', generation: 1, child, savedInput, pins }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await readOperation(row, ref)).toEqual(raised);
      // A second adoption in the project reuses the governance the first one installed and never overwrites it.
      const architecture = await readCurrent(row, 'architecture/read', { selection: { kind: 'current' } });
      const next = submission(row, 1, `s6b3-host-35b-${backend}-next`);
      expect(await adoptRoute(row, next.body)).toMatchObject({ status: 'committed', replayed: false });
      expect((await readOperation(row, next.ref)).stages.map(mark => mark.outcome))
        .toEqual(['installed', 'installed', 'reused', 'reused', 'skipped', 'installed', 'installed', 'installed']);
      expect(await readCurrent(row, 'architecture/read', { selection: { kind: 'current' } })).toEqual(architecture);
    }));

  it.each(['memory', 'sqlite'] as const)('AL-06: an older call that reads a newer generation stops without a child (%s)',
    backend => inRow(backend, `host-al06-${backend}`, [setupWith([CHECK])], async row => {
      const { body, ref } = submission(row, 0, `s6b3-host-al06-${backend}`);
      let newer: unknown;
      // The older call's architecture after-write lands; its answer is held while a newer submission runs to the end.
      const gate = holdS6B3AdoptionGate(row.world, { operationRef: ref, stage: 'architecture', point: 'after-after' },
        async () => { newer = await adoptRoute(row, { ...body, commandId: `${body.commandId}-2` }); });
      const [, older] = await Promise.all([gate, adoptRoute(row, body)]);
      expect(newer).toMatchObject({ status: 'committed', replayed: false });
      const final = await readOperation(row, ref);
      // accept, three stages, the newer accept, then five stages: the older call wrote nothing after its read.
      expect(final).toMatchObject({ revision: 18, generation: 2, result: newer });
      expect(older).toEqual({ status: 'stopped', operationRef: ref, observed: final,
        failure: { code: 'revision_conflict', reason: 'the adoption generation moved during this call' } });
    }));

  it('SQLite: a Host without the instance lease answers busy before accept and writes nothing', () =>
    inRow('sqlite', 'host-35b-lease', [setupWith([CHECK])], async row => {
      const { body, ref } = submission(row, 0, 's6b3-host-35b-lease');
      await crashS6B3Host(row.world, undefined, 'keeps-lease');
      expect(row.world.host.host.reconcile.lease).toBe('held_by_other');
      expect(await adoptRoute(row, body))
        .toEqual({ status: 'rejected', code: 'busy', reason: 'this Host does not hold the instance lease' });
      expect(await owner(row, 'read', { operationRef: ref })).toEqual({ status: 'not_found' });
      const goal = await readCurrent(row, 'goals/read', body.expectedGoal.ref) as { goal: { revision: number } };
      expect(goal.goal.revision).toBe(body.expectedGoal.revision);
    }));

  it('a proposal abandoned after the propose stage stops the apply with revision_conflict (memory)', () =>
    inRow('memory', 'host-35b-abandon', [setupWith([CHECK])], async row => {
      const { body, ref } = submission(row, 0, 's6b3-host-35b-abandon');
      // While the propose after-write's answer is held, the person abandons that proposal through its public route.
      const gate = holdS6B3AdoptionGate(row.world, { operationRef: ref, stage: 'propose', point: 'after-after' }, async () => {
        const mark = (await readOperation(row, ref)).stages.find(stage => stage.stage === 'propose');
        const proposal = (mark?.result as { receipt: { value: unknown } }).receipt.value as PlanProposal;
        const goal = await readCurrent(row, 'goals/read', proposal.goalRef) as { goal: { revision: number } };
        const pins = [{ ref: proposal.ref, revision: proposal.revision }, { ref: proposal.goalRef, revision: goal.goal.revision }];
        expect((await row.world.host.post('plans/abandon',
          graphWrite(row.scope, { proposalRef: proposal.ref }, 's6b3-host-35b-abandon-plan', pins))).body)
          .toMatchObject({ status: 'committed', value: { status: 'not_adopted' } });
      });
      const [, stopped] = await Promise.all([gate, adoptRoute(row, body)]);
      expect(stopped).toMatchObject({ status: 'pending', stage: 'apply', failure: { code: 'revision_conflict' } });
      // The apply was never called: the Goal has no plan.
      expect(await readCurrent(row, 'plans/versions', { goalId: body.expectedGoal.ref.goalId, limit: 50, cursor: null }))
        .toMatchObject({ items: [] });
    }));

  // A crash after each of the 16 parent writes, and after the propose and apply children before their after-writes
  // (the stage 6 replay and AL-05).
  const boundaries: (readonly [InitializationAdoptStageV1, 'after-before' | 'after-child' | 'after-after'])[] = [
    ...STAGES.flatMap(stage => [[stage, 'after-before'], [stage, 'after-after']] as const),
    ['propose', 'after-child'], ['apply', 'after-child']];
  it.each(boundaries)('SQLite: a crash at %s %s resumes at its stage with the prefix unextended', (stage, point) =>
    inRow('sqlite', 'host-35b-crash', [setupWith([CHECK])], async row => {
      const { body, ref } = submission(row, 0, 's6b3-host-35b-crash');
      const index = STAGES.indexOf(stage);
      let held!: InitializationAdoptionReadV1;
      let recovered: unknown;
      const gate = holdS6B3AdoptionGate(row.world, { operationRef: ref, stage, point }, async () => {
        await crashS6B3Host(row.world);
        // The new Host reads the record the crash left: this stage's mark, the prefix before it, no new write.
        held = await readOperation(row, ref);
        expect(held.completedSteps).toEqual(STAGES.slice(0, point === 'after-after' ? index + 1 : index));
        expect(held.stages[index]).toMatchObject({ stage, generation: 1 });
        expect(held.stages).toHaveLength(index + 1);
        expect(await owner(row, 'resume', { operationRef: ref, commandId: `${body.commandId}-resume`,
          expected: { revision: held.revision, generation: 1 } }))
          .toMatchObject(held.result ?? { status: 'pending', retryable: false, failure: { code: 'incomplete' } });
        recovered = await adoptRoute(row, body);
      });
      const original = adoptRoute(row, body).catch(() => null);
      await gate;
      await original;
      // A replayed apply child is the recovery's own receipt; every other recovery commits its first apply.
      expect(recovered).toMatchObject({ status: 'committed', replayed: stage === 'apply' && point === 'after-child' });
      const final = await readOperation(row, ref);
      expect(final).toMatchObject({ revision: 17, generation: 1, completedSteps: STAGES, result: recovered });
      const { child, savedInput, pins } = held.stages[index] as InitializationAdoptionReadV1['stages'][number];
      expect(final.stages[index]).toMatchObject({ child, savedInput, pins });
      // The stage 6 replay: the stored proposal is the owner's one receipt for the frozen request, not a second one.
      if (stage === 'propose' && point === 'after-child') {
        const { input, meta } = savedInput as { input: unknown; meta: unknown };
        const { cursor, value } = (final.stages[index]?.result as { receipt: { cursor: string; value: unknown } }).receipt;
        expect(await callS6B3PublishedOwner(row.world, { owner: 'plans.proposeInitialPlanFromAnswer', wave: '6b3-w3',
          scope: row.scope }, { input, meta })).toEqual({ status: 'committed', replayed: true, cursor, value });
      }
    }));
});

/** Hand-computed (node, JCS + sha256) from the literals: the checks digests and the Host's revision recipe over
 *  `{answerDigest, checks}`, where each answer text is the fixture's prepared-goal reply for `host-36b`'s two Goals. */
const CHECK_DIGEST = '1d6b13e1c09d7b205793a06873870693a93a3b528f6866205bbf0ec93a0b721a';
const EMPTY_DIGEST = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const CHECK_REVISION = 'host-settings-checks:9dc6f085951e3d14';
const EMPTY_REVISION = 'host-settings-checks:a9358ab3bd8b1d21';
/** The static fallback's own checks digest (hand-computed: node, JCS + sha256), with `settings:null`. */
const STATIC_DIGEST = '18f159ebf6b97a77aa21f05a944002549d4e6fe4394714617489a3a9a7277a1c';

describe('row 36b: the installed confirmation port', () => {
  it.each(['memory', 'sqlite'] as const)('reads the actual installed configuration and writes nothing (%s)',
    backend => inRow(backend, 'host-36b', [setupWith([CHECK]), setupWith([])], async row => {
      const confirm = (scope: Scope) =>
        row.world.host.platform.confirmInstalledChecks(row.world.host.humanContext(), { scope });
      // The main scope reads the Host's static fallback: its own revision and digest, `settings:null`.
      const fallback = await confirm(row.world.mainScope);
      expect(fallback).toEqual({ status: 'ready', value: { configurationRevision: 'ag2b-checks@1',
        contentDigest: STATIC_DIGEST, settings: null, checks: [{ checkId: 'ag2b-static', kind: 'static',
          command: 'node --test', cwd: '.', timeoutMs: 30_000, taskIds: 'all' }] } });
      const none = await confirm(row.scope);
      expect(none).toEqual({ status: 'ready',
        value: { configurationRevision: null, contentDigest: null, settings: null, checks: [] } });
      const approve = async (index: number, checks: RegisteredCommandCheck[]) => {
        const save = await settingsWithChecks(row.world, { scope: row.scope,
          answerRef: (row.answers[index] as Answer).ref, effect: 'ok', checks });
        expect(await save.done).toMatchObject({ status: 'ready' });
      };
      await approve(0, [CHECK]);
      expect(await confirm(row.scope)).toEqual({ status: 'ready',
        value: { configurationRevision: CHECK_REVISION, contentDigest: CHECK_DIGEST, settings: null, checks: [CHECK] } });
      // The approved empty array replaces the configuration with a real, empty one.
      await approve(1, []);
      const empty = await confirm(row.scope);
      expect(empty).toEqual({ status: 'ready',
        value: { configurationRevision: EMPTY_REVISION, contentDigest: EMPTY_DIGEST, settings: null, checks: [] } });
      // A read writes nothing: the same answer again; the main scope still reads the static fallback.
      expect(await confirm(row.scope)).toEqual(empty);
      expect(await confirm(row.world.mainScope)).toEqual(fallback);
    }, true));

  it('no setup over the static fallback: the checks stage skips with the fallback pin and writes nothing (memory)', () =>
    inRow('memory', 'host-36b-static', [setupWith([CHECK])], async row => {
      const main: Row = { ...row, scope: row.world.mainScope };
      const installed = () => row.world.host.platform.confirmInstalledChecks(row.world.host.humanContext(),
        { scope: main.scope });
      // The no-setup answer is prepared while the governance is missing; its card 0 becomes a main-scope Goal.
      const held = await holdS6B3DraftAnswer(row.world, { scope: main.scope, label: 'host-36b-static', drafts: 2 });
      const answer = await releaseS6B3DraftAnswer(row.world, held);
      const confirmed = await callS6B3LateRoute(row.world, 'goals/confirm-draft', '6b3-w3',
        plain(main.scope, { commandId: 'host-36b-static-confirm', round: held.round, index: 0 })) as {
          value: GoalConfirmDraftReceiptV1 };
      // The second workspace's adoption completes the project's governance; the main scope keeps its static fallback.
      expect(await adoptRoute(row, submission(row, 0, 'host-36b-static-governance').body))
        .toMatchObject({ status: 'committed' });
      const fallback = await installed();
      const source = { kind: 'binding' as const, answerRef: answer.answerRef, draftIndex: 0 };
      const expectedGoal = { ref: confirmed.value.goal.ref, revision: 1 };
      expect(await adoptRoute(main, { commandId: 'host-36b-static', source,
        expectedAnswerDigest: sha256Hex(answer.answerText), expectedGoal }))
        .toMatchObject({ status: 'committed', replayed: false });
      const ref: InitializationAdoptionRef = { aggregateType: 'InitializationAdoption',
        projectId: main.scope.projectId, operationId: initializationAdoptionOperationId({ ...main.scope, source, expectedGoal }) };
      // The stage skips over the fallback and stores its actual revision and digest; the fallback itself is unchanged.
      expect((await readOperation(main, ref)).stages[STAGES.indexOf('checks')]).toMatchObject({ outcome: 'skipped',
        pins: { checks: { configurationRevision: 'ag2b-checks@1', contentDigest: STATIC_DIGEST, checksRevision: 0,
          settings: null } } });
      expect(await installed()).toEqual(fallback);
    }, true));
});
