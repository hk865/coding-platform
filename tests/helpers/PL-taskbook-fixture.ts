/**
 * PL P6 fixture: a real Host world whose settings directory is a real external
 * `mkdtemp` directory, so `plans/apply` can export taskbooks outside the
 * workspace. It composes the frozen helpers only:
 * `withConfiguredHost` (`S7C-member-fixture.ts:147`) around the real Host
 * factory, `openS6AHostWorld` (`S6A-host-fixture.ts:446`), `governS6B`
 * (`S6B1-fixture.ts:62`), `s6aCardsWorkspace` (`S6A-cards-fixture.ts:178`),
 * `createS6BLine`/`adoptS6BPlan` (`S6B1-fixture.ts:88`/`:71`), `plain`,
 * `checkConfiguration`, `OPERATOR`, `S6A_SCOPE`, `S6A_WORK_ROLE`.
 *
 * No record is written, no store is read and no ctx/Host/Runtime is fabricated.
 * The isolation variant sets every registered workspace root to
 * `<settingsDirectory>/taskbooks`, the real path the export-root check must
 * refuse without writing.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite, plain,
} from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { committedValue, readyValue } from './S6A-memory-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding } from './S6A-request-fixture.js';
import { bindingOf, checkConfiguration } from './S7A-fixture.js';
import { consumerOf } from './PL-forms-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';

type HostFactory = typeof import('../../src/app/host.js').createLocalWorkbenchHost;

export type PLTaskbookOptions = {
  /** Extra Host runtime bindings/profiles the caller's lines need (same shape as `openS6AHostWorld`). */
  extraBindings?: readonly S6AExtraBinding[];
  /**
   * Isolation variant: every registered workspace root becomes
   * `<settingsDirectory>/taskbooks`, so the export root equals the workspace
   * root and the batch must fail before writing anything.
   */
  isolation?: boolean;
  /** The trusted check configuration (default: the S7A passing static check). */
  checks?: TrustedCheckConfiguration;
};

export type PLTaskbookWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly settingsDirectory: string;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  /** `plans/propose` + `plans/apply` of `draft` (default: `oneStageDraft`). */
  adopt(input?: { label?: string; draft?: PlanRevisionDraft }): Promise<{
    proposalRef: PlanProposalRef; proposalRevision: number; plan: PlanRevisionSnapshot;
  }>;
  /** The same two writes for a caller-built draft. */
  proposeAndAdopt(input: { label: string; draft: PlanRevisionDraft }): Promise<{
    proposalRef: PlanProposalRef; proposalRevision: number; plan: PlanRevisionSnapshot;
  }>;
  /** The `notices` of `main/read` and `decisions/queue`, in that order. */
  readNotices(input?: { goal?: GoalRef }): Promise<{
    main: readonly Record<string, unknown>[]; queue: readonly Record<string, unknown>[];
  }>;
  /** `goals/read`'s active plan revision (read, never inferred). */
  readActivePlan(): Promise<{ plan: PlanRevisionSnapshot | null; revision: number | null }>;
  /** `decisions/candidate-card` for one proposal. */
  readCandidateCard(proposalRef: PlanProposalRef): Promise<unknown>;
  /** `workspaces/registration`'s project/workspace revisions. */
  readWorkspaceRegistration(): Promise<{ project: number; workspace: number }>;
  /** Real `node:fs/promises` read of an absolute path or one under the settings directory. */
  readFile(path: string): Promise<string>;
  /** The absolute expected taskbook path for one stage (spec §5.3.4). */
  taskbookPath(input: { stageId: string; planId: string; planRevision: number }): string;
  close(): Promise<void>;
};

/** One stage, one required work task and one stage gate; the shape PL-46/47/G-08 adopt. */
export function oneStageDraft(goal: GoalRef, planId = 'pl-taskbook-plan'): PlanRevisionDraft {
  return twoStageDraft(goal, planId, { secondStage: false });
}

/**
 * PL-14's two-stage Plan: the first stage's required work plus a stage-scope
 * gate; the second stage's `plan_only` placeholder with a `sizeClass`.
 * `ag2bPlanDraft` (`AG2b-collaboration-fixture.ts:372`) cannot express stages or
 * a stage gate, so this is a caller-built draft sent through the public
 * `plans/propose` route — never a store write.
 */
export function twoStageDraft(goal: GoalRef, planId = 'pl-taskbook-two-stage',
  options: { secondStage?: boolean } = {}): PlanRevisionDraft {
  const second = options.secondStage !== false;
  const stages = [
    { stageId: 'stage-one', title: 'Stage one', description: 'The first stage.' },
    ...(second ? [{ stageId: 'stage-two', title: 'Stage two', description: 'The next stage.' }] : []),
  ];
  const nextTasks: PlanRevisionDraft['tasks'] = second ? [{
    taskId: 'stage-next', stageId: 'stage-two', title: 'Stage two outline',
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'stage-two' }, executionIntent: 'plan_only',
    sizeClass: 'medium',
  }] : [];
  const tasks: PlanRevisionDraft['tasks'] = [
      {
        taskId: 'stage-work', stageId: 'stage-one', title: 'Stage one work',
        requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'stage', stageId: 'stage-one' }, executionIntent: 'request_execution',
        estimatedLines: 10,
      },
      {
        taskId: 'stage-gate', title: 'Stage one gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'stage-one' },
      },
      ...nextTasks,
  ];
  const draft: PlanRevisionDraft = {
    schemaVersion: 2,
    planId,
    planRevision: 1,
    goalId: goal.goalId,
    stages,
    tasks,
    assignments: [{ taskId: 'stage-work', role: S6A_WORK_ROLE.templateId, instruction: 'Do the stage one work.' }],
    obligations: [{
      obligationId: 'stage-obligation', title: 'Stage one is delivered', requirementLevel: 'required',
      taskIds: ['stage-work', 'stage-gate'],
      verificationRequirements: [{
        requirementId: 'stage-check', requirementLevel: 'required', kind: 'static',
        description: 'The stage one check passes.',
      }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    taskRelations: [],
    inputRequirements: [],
  };
  return draft;
}


/**
 * One adviser/reviewer line's Host inputs: a runtime binding, its query
 * profile (so `consumeIdle` serves the line) and the Workflow binding of the
 * same role. `bindingOf` is the frozen S7A builder.
 */
export function lineBinding(
  id: string,
  role: ReturnType<typeof platformRoleProfile>['template'],
  label: string,
): S6AExtraBinding {
  const roleBinding = {
    schemaVersion: 1 as const, bindingId: id, templateId: role.templateId,
    templateRevision: role.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template',
  };
  return {
    binding: bindingOf(id, role, label, ['read']),
    workflow: {
      workspace: S6A_SCOPE, sessionRole: role, roleBinding,
      budget: { tokenBudget: 1_000_000, deadline: null },
    },
    queryProfile: {
      id, label, scope: S6A_SCOPE, runtimeBindingId: id,
      sessionRole: role, roleBinding, runtimeBudget: AG2B_RUNTIME_BUDGET,
      budget: { maxTokens: null, deadline: null }, consumerId: AG2B_CONSUMER_ID,
    },
  };
}

/** Open the world; the caller closes it (a setup failure closes it here). */
export async function openPLTaskbookWorld(options: PLTaskbookOptions = {}): Promise<PLTaskbookWorld> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 'pl-taskbook-'));
  const isolation = options.isolation === true;
  // A caller's line that answers a system round needs the Host's real consume loop.
  const consumerProfileId = options.extraBindings?.find(extra => extra.queryProfile !== undefined)?.queryProfile?.id;
  if (isolation) await mkdir(join(settingsDirectory, 'taskbooks'), { recursive: true });

  const configure = (original: HostFactory): HostFactory => async hostOptions => {
    const next = { ...hostOptions, settings: { settingsDirectory } };
    if (isolation) {
      next.workspaces = next.workspaces.map(workspace => ({
        ...workspace, root: join(settingsDirectory, 'taskbooks'),
      }));
    }
    return await original(next);
  };

  const world = await withConfiguredHost(
    () => openS6AHostWorld({ backend: 'memory',
      extraHostOptions: { checks: options.checks ?? checkConfiguration({ ...OPERATOR, kind: 'human' }),
        ...(consumerProfileId === undefined ? {}
          : { inputConsumers: [consumerOf(consumerProfileId, 'pl-taskbook')] }) },
      ...(options.extraBindings === undefined ? {} : { extraBindings: options.extraBindings }) }),
    configure);
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await governS6B(world, main, world.goals);
    const goal = world.goals.first;
    // The one work task of `oneStageDraft`/`twoStageDraft`; the triple is a public
    // input shape, not a value read back from a store.
    const tasks: TaskTriple[] = [{ projectId: goal.projectId, goalId: goal.goalId, taskId: 'stage-work' }];

    const proposeAndAdopt: PLTaskbookWorld['proposeAndAdopt'] = async input => {
      const proposed = committedValue<{ ref: PlanProposalRef; revision: number }>(
        await main.post('plans/propose', graphWrite(S6A_SCOPE, {
          goalRef: goal, basedOn: null, draft: input.draft,
          reason: { text: `PL taskbook ${input.label}`, sources: [] },
        }, `pl-taskbook-propose-${input.label}`)), `the proposal ${input.label}`);
      committedValue(await main.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
      }, `pl-taskbook-apply-${input.label}`)), `the adoption ${input.label}`);
      const plan = await main.activePlan(goal);
      if (plan === null) throw new Error(`PL taskbook: ${goal.goalId} has no Plan after ${input.label}`);
      return { proposalRef: proposed.ref, proposalRevision: proposed.revision, plan };
    };

    const taskbookPath: PLTaskbookWorld['taskbookPath'] = input => join(
      settingsDirectory, 'taskbooks',
      encodeURIComponent(goal.projectId), encodeURIComponent(S6A_SCOPE.workspaceId),
      encodeURIComponent(goal.goalId),
      `goal-${encodeURIComponent(goal.goalId)}__plan-${encodeURIComponent(input.planId)}`
      + `__stage-${encodeURIComponent(input.stageId)}__rev-${String(input.planRevision)}.md`);

    return {
      world, main, settingsDirectory, goal, tasks,
      proposeAndAdopt,
      async adopt(input = {}) {
        return await proposeAndAdopt({
          label: input.label ?? 'adopt',
          draft: input.draft ?? oneStageDraft(goal, `pl-taskbook-${input.label ?? 'adopt'}`),
        });
      },
      async readNotices(input = {}) {
        const target = input.goal ?? goal;
        const mainPage = readyValue<{ notices: Record<string, unknown>[] }>(
          await main.route('main/read', { goalId: target.goalId, cursor: null }), 'main/read');
        const queue = readyValue<{ notices: Record<string, unknown>[] }>(
          await main.route('decisions/queue', {
            workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
            goalRef: target, sections: ['notices'], page: { limit: 100 },
          }), 'decisions/queue');
        return { main: mainPage.notices, queue: queue.notices };
      },
      async readActivePlan() {
        const value = readyValue<{ goal: { activePlanRevision: { planId: string } | null } }>(
          await main.route('goals/read', goal), 'goals/read');
        const plan = await main.activePlan(goal);
        // The Goal pointer names the active PlanRevision ref (no revision field);
        // the adopted plan's own revision is what "advances".
        const pointerMatches = value.goal.activePlanRevision?.planId === plan?.planId;
        return { plan, revision: pointerMatches ? (plan?.planRevision ?? null) : null };
      },
      async readCandidateCard(proposalRef) {
        return await main.route('decisions/candidate-card', { goalRef: goal, proposalRef });
      },
      async readWorkspaceRegistration() {
        const value = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
          await main.route('workspaces/registration', {
            projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
          }), 'workspaces/registration');
        return { project: value.project.revision, workspace: value.workspace.revision };
      },
      async readFile(path) {
        return await readFile(isAbsolute(path) ? path : join(settingsDirectory, path), 'utf8');
      },
      taskbookPath,
      async close() {
        try { await world.close(); } finally { await rm(settingsDirectory, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    await rm(settingsDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Re-exported so a scenario sets up a line with the same public step. */
export { createS6BLine, writeFile };
