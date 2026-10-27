/**
 * The Host owner of `initialization/adopt`. One person's call accepts the adoption (or replays or
 * continues it), freezes its inputs and runs as many of the eight stages as complete; a stop answers `pending`. The
 * route table binds `adopt` through `createPlatformCoreRouteBindings`'s optional sixth parameter, so a Host that builds
 * no adoption owner answers `unsupported`.
 *
 * Every stage runs `read → resume → (its open before-mark | its stopped mark under a newer generation | saveBefore)
 * → its child owner → saveAfter`. J's operation owner writes the record and forms every stored result; this owner
 * only supplies the write inputs and calls each child owner under that owner's own identity. A pre-read or a parent
 * write that does not complete ends the call with the unpersisted `stopped` answer.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { CommandMeta } from '../contracts/core/identity.js';
import { rejected } from '../contracts/core/rejections.js';
import type { ReadResult, WriteResult } from '../contracts/core/results.js';
import { commandIdentityKey } from '../contracts/command-event.js';
import { canonicalKey, sameJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import type { CompletionPolicyRevisionRef, ProjectCompletionPolicyActiveSnapshot } from '../contracts/governance.js';
import type { InitialPlanningSetupV2 } from '../contracts/initial-planning.js';
import { parseInitialPlanningResponseV2 } from '../contracts/initial-planning-parse.js';
import {
  INITIALIZATION_ADOPT_STAGES, type AdoptionPinSetV1, type AdoptionSaveAfterInputV1, type AdoptionStageProgressV1,
  type AdoptionStageResultV1, type AdoptionStageWriteResultV1, type AdoptionWriteIdentityV1,
  type ChecksConfigurationPinV1, type ChecksConfirmationV1, type InitializationAdoptFailureV1,
  type InitializationAdoptInputV1, type InitializationAdoptResultV1, type InitializationAdoptStageV1,
  type InitializationAdoptionReadV1, type InitializationAdoptionRef,
} from '../contracts/initialization-adoption.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type {
  CompletionPolicyConfigurationPort, ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import type {
  ChecksConfirmationPort, ChecksEntryPort, InitializationAdoptionPort, SavedChecksReadPort, SettingsSerialGatePort,
} from '../core/work-graph/model/initialization-adoption-contracts.js';
import type { PlanProposal, PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import { trustedContext, type HostActor } from '../core/work-graph/sessions/trusted-context.js';
import { initialAnswerProposeFingerprint } from '../core/work-graph/tasks/initial-plan.js';
import { RETRYABLE_CODES } from '../core/work-graph/tasks/initialization-adoption-service.js';
import { asWriteRejection } from '../core/work-graph/tasks/plan-result-helpers.js';
import { createHostCoreCallContext } from './core-call-context.js';
import type { ChecksAdoptionHostCallbacks } from './host-settings.js';

export interface InitializationAdoptionHostPort {
  /** One call: accept (or replay/continue), the stored freeze, then as many stages as complete; a stop is `pending`. */
  adopt(ctx: CoreCallContext, input: InitializationAdoptInputV1): Promise<InitializationAdoptResultV1>;
  read(ctx: CoreCallContext,
    input: { operationRef: InitializationAdoptionRef }): Promise<ReadResult<InitializationAdoptionReadV1>>;
}

export type InitializationAdoptionDependencies = {
  operations: InitializationAdoptionPort;        // J's accept/resume/read/saveBefore/saveAfter
  checks: ChecksEntryPort;                        // J's narrow entry
  savedChecks: SavedChecksReadPort;               // J's saved settings state (source, checks, child)
  settingsGate: SettingsSerialGatePort;           // J's one settings queue
  confirmChecks: ChecksConfirmationPort;          // the platform's read over the installed configurations
  plans: Required<Pick<PlanTaskPort,
    'proposeInitialPlanFromAnswer' | 'applyPlanChange' | 'readInitialPlanAnswerFacts' | 'readPlanProposal'>>;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision' | 'adoptInitialArchitecture'>;
  policies: Required<Pick<CompletionPolicyConfigurationPort,
    'installCompletionPolicy' | 'activateCompletionPolicy' | 'readCurrentCompletionPolicy'>>;
  registration: Pick<ProjectRegistrationPort, 'readWorkspaceRegistration'>;
  leaseOwned: boolean;                            // the Host's instance-lease fact; false → adopt is busy before accept
  /** The one configuration-revision recipe: the Host passes the same builder to the settings object and here, and
   *  stage 5 builds its source pin with it. */
  buildConfiguration: ChecksAdoptionHostCallbacks['buildConfiguration'];
};

type Failure = InitializationAdoptFailureV1;
type Frozen = Pick<AdoptionStageProgressV1, 'child' | 'savedInput' | 'pins'>;
/** An after-write's branch and outcome; the identity fields are added by the stage driver. */
type After = AdoptionSaveAfterInputV1 extends infer Write
  ? Write extends unknown ? Omit<Write, keyof AdoptionWriteIdentityV1> : never : never;
/** A frozen owner call: the owner's exact input and meta, plus the actor of its first call (recovery material). */
type OwnerCall = { kind?: string; input: never; meta: CommandMeta; actor: HostActor };
type Digested = { ref: never; revision: number; contentDigest: string };
type ChecksInput =
  | { kind: 'apply'; source: ChecksConfigurationPinV1; previous: ChecksConfigurationPinV1 }
  | { kind: 'reuse'; source: null; previous: ChecksConfigurationPinV1; basis: 'no_setup_governance_complete' };
type ChecksFacts =
  | { ok: true; pin: ChecksConfigurationPinV1; child: Frozen['child'] | null; installed: ChecksConfirmationV1 }
  | { ok: false; failure: Failure };

const L_REASON = { text: 'initialization adoption', sources: [] };
const NONE: AdoptionStageResultV1 = { kind: 'none' };
const MOVED: Failure = { code: 'revision_conflict', reason: 'the adoption operation moved during this call' };
const CHECKS_MOVED: Failure = { code: 'revision_conflict', reason: 'the installed checks no longer match the adopted checks' };

const failureOf = (read: ReadResult<unknown>, reason: string): Failure => {
  const { code, reason: why } = asWriteRejection(read, reason);
  return { code, reason: why };
};
const advanceAfter = (outcome: 'skipped' | 'reused' | 'installed', result: AdoptionStageResultV1 = NONE): After =>
  ({ branch: 'advance', outcome, result });
const stop = (failure: Failure, result: AdoptionStageResultV1 = NONE,
  outcome: 'failed' | 'not_saved' | 'saved_unconfirmed' = 'failed'): After =>
  ({ branch: 'stop', outcome, result, failure: { code: failure.code, reason: failure.reason },
    // J's own set decides which failed stops are retryable (its after-write refuses any other).
    retryable: outcome === 'failed' && RETRYABLE_CODES.has(failure.code) });
const ledgerResult = (label: string, written: { value: unknown; cursor: string }): AdoptionStageResultV1 =>
  ({ kind: 'ledger', receipt: { commandId: label, cursor: written.cursor as never, value: written.value as JsonValue } });
/** A ledger child's answer: its committed receipt advances the stage, its rejection stops it. */
const ledger = (label: string, written: WriteResult<unknown>): After =>
  written.status === 'committed' ? advanceAfter('installed', ledgerResult(label, written)) : stop(written);
/** A stage that calls an owner freezes that owner's own receipt identity and fingerprint. The owners
 *  export no recipe, so each caller repeats its owner's fingerprint material and names it. */
const ownerChild = (label: string, prefix: string, projectId: string, actor: HostActor, fingerprint: string) =>
  ({ commandId: label, identityKey: prefix + commandIdentityKey({ projectId, actor, idempotencyKey: label }), fingerprint });
/** A stage that calls no owner freezes its label and the hash of its saved input (the checks entry: of its port
 *  argument). */
const noOwnerChild = (label: string, savedInput: unknown) =>
  ({ commandId: label, identityKey: label, fingerprint: sha256Hex(canonicalKey(savedInput)) });
const markOf = (stages: readonly AdoptionStageProgressV1[], stage: InitializationAdoptStageV1) =>
  stages[INITIALIZATION_ADOPT_STAGES.indexOf(stage)] as AdoptionStageProgressV1;
/** Stage 2's or 3's adopted or reused pin: the child receipt, or the read the reused before-mark froze. */
function governancePin(mark: AdoptionStageProgressV1 | undefined, key: 'baseline' | 'policy') {
  if (mark === undefined) return null;
  const receipt = mark.result?.kind === 'ledger' ? mark.result.receipt.value as Record<string, unknown> : null;
  // The adopted architecture is its receipt's `baseline`; the installed policy is the receipt itself.
  const pinned = (receipt === null ? (mark.savedInput as Record<string, unknown>)[key]
    : key === 'baseline' ? receipt['baseline'] : receipt) as Digested;
  return { ref: pinned.ref, revision: pinned.revision, digest: pinned.contentDigest };
}
/** The pins known before a stage's child call (admission's project and goal, then each later stage's pin). */
function knownPins(stages: readonly AdoptionStageProgressV1[]): AdoptionPinSetV1 {
  const { project, goal } = markOf(stages, 'admission').pins;
  const checks = stages[INITIALIZATION_ADOPT_STAGES.indexOf('checks')]?.savedInput as ChecksInput | undefined;
  return { project, goal, architecture: governancePin(stages[2], 'baseline'), policy: governancePin(stages[3], 'policy'),
    checks: checks === undefined ? null : checks.source ?? checks.previous };
}

export function createInitializationAdoptionHost(deps: InitializationAdoptionDependencies): InitializationAdoptionHostPort {
  async function adopt(ctx: CoreCallContext, input: InitializationAdoptInputV1): Promise<InitializationAdoptResultV1> {
    const trusted = trustedContext(ctx, 'initialization adoption');
    if (!trusted.ok) return trusted.rejection;
    if (!deps.leaseOwned) return rejected('busy', 'this Host does not hold the instance lease');
    // J's accept checks the input and the source before it writes; its rejection is returned unchanged.
    const accepted = await deps.operations.accept(ctx, input);
    if (accepted.status !== 'accepted') return accepted;
    const { operationRef, generation } = accepted;
    const op = operationRef.operationId;
    const scope = trusted.scope;
    const actor = trusted.actor;
    const labelOf = (stage: InitializationAdoptStageV1) => `${op}/${stage.replace('_', '-')}`;
    const unpersistedStop = (failure: Failure, observed: InitializationAdoptionReadV1 | null): InitializationAdoptResultV1 =>
      ({ status: 'stopped', operationRef, observed, failure });
    // A child owner's call context is the actor its stage froze, never the record's latest principal.
    const childContext = (call: OwnerCall) => createHostCoreCallContext({ scope, actor: call.actor, signal: ctx.signal });

    /** The saved and the installed checks read together inside the caller's one gate, and the actual pin they make:
     *  a saved source rebuilt through the one builder must be what is installed. */
    async function checksFacts(): Promise<ChecksFacts> {
      const saved = await deps.savedChecks.readSavedChecks(ctx, { scope });
      const installed = await deps.confirmChecks.confirmInstalledChecks(ctx, { scope });
      if (saved.status !== 'ready' && saved.status !== 'not_found') {
        return { ok: false, failure: failureOf(saved, 'the saved checks could not be read') };
      }
      if (installed.status !== 'ready') {
        return { ok: false, failure: failureOf(installed, 'the installed checks could not be read') };
      }
      const state = saved.status === 'ready' ? saved.value : null;
      const { configurationRevision, contentDigest } = installed.value;
      if (state !== null && (contentDigest !== sha256Hex(canonicalKey(state.checks)) || configurationRevision
        !== deps.buildConfiguration({ scope, source: state.source, checks: state.checks }).configurationRevision)) {
        return { ok: false, failure: { code: 'unavailable', reason: 'the saved and installed checks differ' } };
      }
      return { ok: true, installed: installed.value, child: state?.child ?? null,
        pin: { configurationRevision, contentDigest, checksRevision: state?.checksRevision ?? 0, settings: state?.source ?? null } };
    }
    /** Branch (a) needs this operation's child and its frozen source pin; branch (b) only the original pin. */
    const checksMatch = (checks: Frozen, facts: Extract<ChecksFacts, { ok: true }>): boolean => {
      const saved = checks.savedInput as ChecksInput;
      return saved.kind === 'apply'
        ? sameJson(facts.pin, saved.source) && sameJson(facts.child, checks.child)
        : sameJson(facts.pin, saved.previous);
    };

    /** A stage with no mark: its pre-read and its frozen input, pins and child. */
    async function prepare(stage: InitializationAdoptStageV1, stages: readonly AdoptionStageProgressV1[]):
      Promise<Frozen | Failure> {
      const label = labelOf(stage);
      if (stage === 'admission') {
        const read = await deps.registration.readWorkspaceRegistration(ctx, scope);
        if (read.status !== 'ready') return failureOf(read, 'the workspace registration was not found');
        const { project, workspace } = read.value;
        const savedInput = { scope, workspacePin: { ref: workspace.ref, revision: workspace.revision } };
        return { child: noOwnerChild(label, savedInput), savedInput, pins: {
          project: { ref: project.ref, revision: project.revision },
          goal: { ref: input.expectedGoal.ref, revision: input.expectedGoal.revision },
          architecture: null, policy: null, checks: null } };
      }
      const pins = knownPins(stages);
      const freeze = stages[1]?.savedInput as { answerDigest: string; setup: InitialPlanningSetupV2 | null } | undefined;
      const setup = freeze?.setup ?? null;
      const frozen = (savedInput: object, child = noOwnerChild(label, savedInput), own = pins): Frozen =>
        ({ child, savedInput: savedInput as JsonValue, pins: own });
      switch (stage) {
        case 'freeze': {
          // The answer, binding and Goal were checked by accept and cannot move; freeze records that basis.
          const facts = await deps.plans.readInitialPlanAnswerFacts(ctx, input.source.answerRef, input.source);
          if (facts.status !== 'ready') return failureOf(facts, 'the initial plan answer was not found');
          const parsed = parseInitialPlanningResponseV2(facts.value.answerText);
          return frozen({ source: input.source, expectedAnswerDigest: input.expectedAnswerDigest,
            expectedGoal: input.expectedGoal, answerDigest: sha256Hex(facts.value.answerText),
            setup: parsed.status === 'parsed' && parsed.response.kind === 'plan' ? parsed.response.setup ?? null : null });
        }
        case 'architecture': {
          const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
          if (read.status === 'ready') {
            const { ref, revision, contentDigest } = read.value.baseline;
            return frozen({ kind: 'read', input: { selection: { kind: 'current' } }, baseline: { ref, revision, contentDigest } },
              undefined, { ...pins, architecture: { ref, revision, digest: contentDigest } });
          }
          // Only an explicit absence adopts; any other failed read stops with its own code.
          const failed = failureOf(read, 'the architecture baseline was not found');
          if (failed.code !== 'not_found' || setup === null) return failed;
          const workspacePin = (markOf(stages, 'admission').savedInput as { workspacePin: { ref: never; revision: number } })
            .workspacePin;
          const { baselineId, description, constraints, catalog } = setup.architecture;
          // catalog-service.ts adoptInitialArchitecture: the fingerprint and the identity prefix.
          return frozen({ kind: 'adopt', input: setup.architecture,
            meta: { requestId: label, expected: [pins.project, workspacePin] }, actor },
          ownerChild(label, 'architecture-catalog-adopt:', scope.projectId, actor, sha256Hex(canonicalKey({ schemaVersion: 1,
            commandType: 'AdoptInitialArchitecture', projectId: scope.projectId, workspaceId: scope.workspaceId,
            baselineId, description, constraints, catalog, expected: { project: pins.project, workspace: workspacePin } }))));
        }
        case 'policy_install': {
          const read = await deps.policies.readCurrentCompletionPolicy(ctx, { projectId: scope.projectId });
          const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId };
          if (read.status === 'ready') {
            const { policy, active } = read.value;
            return frozen({ kind: 'read', policy: { ref: policy.ref, revision: policy.revision, contentDigest: policy.contentDigest },
              active: { ref: active.ref, revision: active.revision, activeRevision: active.activeRevision },
              activePin: { ref: activeRef, revision: active.revision } },
            undefined, { ...pins, policy: { ref: policy.ref, revision: policy.revision, digest: policy.contentDigest } });
          }
          // The owner answers a project with no active pointer with its explicit `not_found` rejection:
          // only that installs; a damaged or unreadable policy stops with its own code.
          const failed = failureOf(read, 'the completion policy was not found');
          if (failed.code !== 'not_found' || setup === null) return failed;
          const absent = { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: op,
            revision: 1 }, revision: 0 };
          const content = setup.completionPolicy;
          // project-bootstrap-service.ts installCompletionPolicy: the fingerprint and the identity prefix. The owner sorts
          // its expected pins by the canonical ref, where `CompletionPolicyRevision` comes before `Project`.
          return frozen({ kind: 'install', input: { policyId: op, contentRevision: 1, content },
            meta: { requestId: label, expected: [pins.project, absent] }, active: null,
            activePin: { ref: activeRef, revision: 0 }, actor },
          ownerChild(label, 'completion-policy-install:', scope.projectId, actor, sha256Hex(canonicalKey({ schemaVersion: 1,
            commandType: 'InstallCompletionPolicy', projectId: scope.projectId, policyId: op, contentRevision: 1,
            content, actor, expected: [absent, pins.project] }))));
        }
        case 'policy_activate': {
          // The stage-3 frozen active snapshot and pin; no second active read.
          const { active, activePin } = markOf(stages, 'policy_install').savedInput as {
            active: Pick<ProjectCompletionPolicyActiveSnapshot, 'activeRevision'> | null; activePin: { ref: never; revision: number } };
          const policy = pins.policy as NonNullable<AdoptionPinSetV1['policy']>;
          if (active !== null && sameJson(active.activeRevision, policy.ref)) return frozen({ kind: 'read', active, policy });
          const target = { ref: policy.ref as CompletionPolicyRevisionRef, digest: policy.digest };
          // project-bootstrap-service.ts activateCompletionPolicy: the fingerprint and the identity prefix; in the owner's
          // canonical-ref order `Project` comes before `ProjectCompletionPolicyActive`.
          return frozen({ kind: 'activate', input: { target }, meta: { requestId: label, expected: [pins.project, activePin] }, actor },
            ownerChild(label, 'completion-policy-activate:', scope.projectId, actor, sha256Hex(canonicalKey({ schemaVersion: 1,
              commandType: 'ActivateCompletionPolicy', projectId: scope.projectId, target, actor,
              expected: [pins.project, activePin] }))));
        }
        case 'checks': {
          const facts = await deps.settingsGate.runExclusive(checksFacts);
          if (!facts.ok) return facts.failure;
          const previous = facts.pin;
          const own = { ...pins, checks: previous };
          if (setup === null) {
            return frozen({ kind: 'reuse', source: null, previous, basis: 'no_setup_governance_complete' }, undefined, own);
          }
          const settings = { answerRef: input.source.answerRef, answerDigest: (freeze as { answerDigest: string }).answerDigest };
          const source: ChecksConfigurationPinV1 = {
            configurationRevision: deps.buildConfiguration({ scope, source: settings, checks: setup.checks }).configurationRevision,
            contentDigest: sha256Hex(canonicalKey(setup.checks)), checksRevision: previous.checksRevision + 1, settings };
          // The entry has no R2 identity: its tuple is the label and the hash of the port argument without `child`.
          return frozen({ kind: 'apply', source, previous }, noOwnerChild(label, { scope, source, previous }), own);
        }
        case 'propose': {
          const answerRef = input.source.answerRef;
          return frozen({ input: { answerRef, reason: L_REASON, source: input.source }, meta: { requestId: label, expected: [] }, actor },
            ownerChild(label, 'plan-propose:', answerRef.projectId, actor, initialAnswerProposeFingerprint({
              projectId: answerRef.projectId, workspaceId: scope.workspaceId, actor, answerRef, reason: L_REASON,
              requestId: label, expected: [], source: input.source })));
        }
        default: {
          const proposal = (markOf(stages, 'propose').result as Extract<AdoptionStageResultV1, { kind: 'ledger' }>)
            .receipt.value as unknown as PlanProposal;
          const applied = { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
            governancePins: { architecture: pins.architecture, policy: pins.policy } };
          // plan-service.ts applyPlanChange (`applyFingerprint`): the fingerprint and the identity prefix.
          return frozen({ input: applied, meta: { requestId: label, expected: [pins.goal] }, actor },
            ownerChild(label, 'plan-apply:', proposal.ref.projectId, actor, sha256Hex(canonicalKey({ schemaVersion: 1,
              commandType: 'PlanApply', projectId: proposal.ref.projectId, workspaceId: proposal.ref.workspaceId, ...applied }))));
        }
      }
    }

    /** The stage's child with its frozen input; every answer becomes the after-write's branch. */
    async function runChild(stage: InitializationAdoptStageV1, mark: Frozen, stages: readonly AdoptionStageProgressV1[]):
      Promise<After> {
      const label = labelOf(stage);
      const call = mark.savedInput as unknown as OwnerCall;
      const request = { input: call.input, meta: call.meta };
      switch (stage) {
        case 'admission': case 'freeze': return advanceAfter('installed');
        case 'architecture': return call.kind === 'read' ? advanceAfter('reused')
          : ledger(label, await deps.architecture.adoptInitialArchitecture(childContext(call), request));
        case 'policy_install': return call.kind === 'read' ? advanceAfter('reused')
          : ledger(label, await deps.policies.installCompletionPolicy(childContext(call), request));
        case 'policy_activate': return call.kind === 'read' ? advanceAfter('skipped')
          : ledger(label, await deps.policies.activateCompletionPolicy(childContext(call), request));
        case 'checks': {
          const saved = mark.savedInput as ChecksInput;
          // No setup: no entry call and no write; the checks stay as they are.
          if (saved.kind === 'reuse') return advanceAfter('skipped');
          const save = await deps.checks.applyChecksForAdoption(ctx,
            { scope, source: saved.source, child: mark.child, previous: saved.previous });
          if (save.status === 'not_saved') return stop(save.rejection, { kind: 'checks', save, confirmation: null }, 'not_saved');
          if (save.status === 'saved_unconfirmed') {
            return stop({ code: 'unavailable', reason: 'the checks were saved but the installed configuration was not confirmed' },
              { kind: 'checks', save, confirmation: null }, 'saved_unconfirmed');
          }
          // Only the installed configuration, read again with the saved state in one gate, confirms the save.
          const facts = await deps.settingsGate.runExclusive(checksFacts);
          if (!facts.ok) return stop(facts.failure, { kind: 'checks', save, confirmation: null });
          return checksMatch(mark, facts) ? advanceAfter('installed', { kind: 'checks', save, confirmation: facts.installed })
            : stop(CHECKS_MOVED, { kind: 'checks', save, confirmation: null });
        }
        case 'propose': {
          const proposed = await deps.plans.proposeInitialPlanFromAnswer(childContext(call), request);
          return proposed.status === 'needs_decision'
            ? stop({ code: 'invalid', reason: proposed.questions.join('; ') }) : ledger(label, proposed);
        }
        default: {
          // Inside the stage's gate: the proposal first. A candidate is adopted only while the checks are the
          // ones stage 5 froze; an accepted one is this operation's own apply, which the owner's receipt recovers.
          const proposal = await deps.plans.readPlanProposal(childContext(call),
            (call.input as { proposalRef: PlanProposal['ref'] }).proposalRef);
          if (proposal.status !== 'ready') return stop(failureOf(proposal, 'the plan proposal was not found'));
          const status = proposal.value.status;
          if (status === 'rejected' || status === 'not_adopted') {
            return stop({ code: 'revision_conflict', reason: 'the plan proposal is no longer a candidate' });
          }
          if (status === 'candidate') {
            const facts = await checksFacts();
            if (!facts.ok) return stop(facts.failure);
            if (!checksMatch(markOf(stages, 'checks'), facts)) return stop(CHECKS_MOVED);
          }
          const applied = await deps.plans.applyPlanChange(childContext(call), request);
          if (applied.status !== 'committed') return stop(applied);
          return { branch: 'complete', outcome: 'installed', result: ledgerResult(label, applied),
            receipt: { plan: applied.value.ref, cursor: applied.cursor }, replayed: applied.replayed };
        }
      }
    }

    /** One stage: the mark arm, the child and the after-write; `null` when the stage advanced. */
    async function runStage(current: InitializationAdoptionReadV1, mark: AdoptionStageProgressV1 | undefined):
      Promise<InitializationAdoptResultV1 | null> {
      const stage = current.stage;
      const identity = (phase: 'before' | 'after') =>
        ({ commandId: `${op}:${stage}:-:${phase}:${String(generation)}`, operationRef, stage, generation });
      const written = (write: Exclude<AdoptionStageWriteResultV1, { status: 'committed' }>): Failure =>
        write.status === 'unchanged' ? MOVED : { code: write.code, reason: write.reason };
      let frozen: Frozen;
      if (mark === undefined) {
        const prepared = await prepare(stage, current.stages);
        // Nothing is written for a pre-read that did not complete; admission reports no progress.
        if ('code' in prepared) return unpersistedStop(prepared, stage === 'admission' ? null : current);
        frozen = prepared;
      } else {
        frozen = { child: mark.child, savedInput: mark.savedInput, pins: mark.pins };
      }
      // An open before-mark re-drives its own child; a stopped mark (of an older generation) is replaced first.
      if (mark === undefined || mark.outcome !== null) {
        const before = await deps.operations.saveBefore(ctx, { ...identity('before'), ...frozen });
        if (before.status !== 'committed') return unpersistedStop(written(before), current);
      }
      const after = await runChild(stage, frozen, current.stages);
      const saved = await deps.operations.saveAfter(ctx, { ...identity('after'), ...after });
      if (saved.status !== 'committed') return unpersistedStop(written(saved), current);
      return saved.value.result;
    }

    let observed: InitializationAdoptionReadV1 | null = null;
    for (;;) {
      const read = await deps.operations.read(ctx, { operationRef });
      // After accept a failed read is a stop of this drive, never a pre-accept rejection.
      if (read.status !== 'ready') return unpersistedStop(failureOf(read, 'the adoption operation was not found'), observed);
      const current = read.value;
      observed = current;
      if (current.generation !== generation) {
        return unpersistedStop({ code: 'revision_conflict', reason: 'the adoption generation moved during this call' }, current);
      }
      const mark = current.stages[current.completedSteps.length];
      // A finished operation is final; a stop of this generation is restarted only by a new authorized submission.
      if (current.result !== null && (current.result.status === 'committed' || mark?.generation === generation)) {
        return current.result;
      }
      const resumed = await deps.operations.resume(ctx, { operationRef,
        commandId: `${op}/resume:${current.stage}:${String(generation)}`,
        expected: { revision: current.revision, generation } });
      if (resumed.status !== 'pending') return resumed;
      // Stage 7 holds the one settings gate from its before-write to its after-write.
      const outcome = current.stage === 'apply'
        ? await deps.settingsGate.runExclusive(() => runStage(current, mark))
        : await runStage(current, mark);
      if (outcome !== null) return outcome;
    }
  }

  return { adopt, read: (ctx, input) => deps.operations.read(ctx, input) };
}
