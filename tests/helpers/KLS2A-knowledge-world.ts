/**
 * KLS-2a acceptance world (KLS2A1 rows; the 2b rows use it too): one real `createTargetPlatform` over one
 * real git root per workspace of the project (`initGitWorkspace`: `git init`, the tracked files, one commit).
 * The platform gets the Host's `knowledgeWorkspaces` list (main workspace first) as the platform option the
 * Host passes; `platform` is forwarded to the platform options as it is (a fault-injecting factory, a cap),
 * after the world's own defaults and before its storage, workspace bindings and workspace list.
 *
 * Public steps only: `projects.createProject`, `projects.registerWorkspace` for every workspace, a `test`
 * completion policy and Goal `kls2a-goal` (`goals.createGoal`). No architecture is adopted: every row adopts its
 * own. A Plan needs the adopted baseline, so the agent caller comes after the row's adoption:
 * `claimExecutorRun()` adopts a Plan with one executor work Task and its gate (`plans.proposePlan`,
 * `plans.applyPlanChange`), creates one executor Session (`runtime.createSession`, the platform legacy template)
 * and claims its Run (`claims.claimTask`); `ctx('work_run')` is then that real agent caller, whose duty the
 * production resolver reads from the Session's role. Files under the roots are the product's output: rows read
 * them and edit them as a person would; no store is read or written here.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { ProjectPlatform } from '../../src/composition/project-runtime.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';

const AT = '2026-11-11T00:00:00.000Z';
const OPERATOR = { kind: 'human' as const, id: 'kls2a-operator' };
const EXECUTOR_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'kls2a-executor-binding',
  templateId: 'platform-executor', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
/** The value a successful (`committed`/`completed`/`ready`) answer carries. */
type Done<R> = Extract<R, { status: 'committed' | 'completed' | 'ready' }> extends { value: infer V } ? V : never;

export type KLS2AWorld = {
  /** The main workspace's git root (the `.workbench/` of its line is directly under it). */
  root: string;
  projectId: string;
  /** The main workspace. */
  workspaceId: string;
  platform: ProjectPlatform;
  /** The world's Goal; the `work_run` caller's Run belongs to it. */
  goalRef: GoalRef;
  /** A Host call (the configured human operator) or, after `claimExecutorRun`, the real executor Run. */
  ctx(principal?: 'host' | 'work_run', workspaceId?: string): CoreCallContext;
  /** After the row's adoption: the Goal's Plan, one executor Session and its claimed Run (main workspace). */
  claimExecutorRun(): Promise<void>;
  /** The Project and Workspace pins a write declares, read through `projects.readWorkspaceRegistration`. */
  scopePins(workspaceId?: string): Promise<VersionPin[]>;
  /** `<root>/<rel>` as utf8, null when absent. */
  file(rel: string, workspaceId?: string): string | null;
  /** The plain file names directly under `<root>/<dir>`, sorted; empty when the folder is absent. */
  files(dir: string, workspaceId?: string): string[];
  /** A person's edit (or new file) at `<root>/<rel>`. */
  edit(rel: string, text: string, workspaceId?: string): void;
  close(): Promise<void>;
};

export async function openKLS2AWorld(opts: { storage?: 'memory' | 'sqlite';
  platform?: Partial<TargetPlatformOptions>;
  /** The project's workspaces, main first (default `['ws']`); each gets its own git root. */
  workspaces?: readonly string[] } = {}): Promise<KLS2AWorld> {
  const projectId = 'kls2a-project';
  const workspaces = opts.workspaces ?? ['ws'];
  const main = workspaces[0]!;
  const directory = await mkdtemp(join(tmpdir(), 'kls2a-world-'));
  const roots = new Map(workspaces.map(workspaceId => [workspaceId, join(directory, workspaceId)]));
  for (const root of roots.values()) {
    await mkdir(root, { recursive: true });
    await initGitWorkspace(root, { files: { 'src/a.ts': 'export const a = 1;\n', 'README.md': '# kls2a\n' } });
  }
  const rootOf = (workspaceId: string = main): string => {
    const root = roots.get(workspaceId);
    if (root === undefined) throw new Error(`KLS2A world: no workspace ${workspaceId}`);
    return root;
  };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      const root = requested.projectId === projectId ? roots.get(requested.workspaceId) : undefined;
      return root === undefined ? { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered' }
        : { status: 'ready', value: { root, workspaceRevision: 1 } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'kls2a-host', permissionRevision: 'kls2a-grant-1', allowsRead: () => true } };
    },
  };
  let tick = 0;
  const mainScope: WorkspaceScope = { projectId, workspaceId: main };
  let platform: ProjectPlatform | undefined;
  try {
    platform = await createTargetPlatform({
      now: () => new Date(Date.parse(AT) + (++tick) * 1000).toISOString(),
      kernelStores: { entries: [{ adapterId: 'kls2a-kernel', storeKey: 'kls2a-kernel-store', workspace: mainScope,
        databasePath: join(directory, 'kernel.sqlite') }] },
      operatorActor: OPERATOR,
      ...opts.platform,
      storage: opts.storage === 'sqlite' ? { kind: 'sqlite', directory: join(directory, 'store') } : { kind: 'memory' },
      workspace: bindings,
      knowledgeWorkspaces: () => workspaces,
    });
    const live = platform;
    let runRef: RunRef | null = null;
    const ctx = (principal: 'host' | 'work_run' = 'host', workspaceId: string = main): CoreCallContext => {
      if (principal === 'host') {
        return { projectId, workspaceId, principal: { kind: 'host', actor: OPERATOR },
          materialReader: { kind: 'host', projectId, workspaceId, actor: OPERATOR }, signal: new AbortController().signal };
      }
      if (runRef === null) throw new Error('KLS2A world: call claimExecutorRun() before ctx(\'work_run\')');
      return { projectId, workspaceId, principal: { kind: 'work_run', runRef, roleBinding: EXECUTOR_BINDING },
        materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal };
    };
    /** The value of a successful public write or read; any other answer stops the world with its body. */
    const must = <R extends { status: string }>(label: string, result: R): Done<R> => {
      if (result.status !== 'committed' && result.status !== 'completed' && result.status !== 'ready') {
        throw new Error(`KLS2A world: ${label} failed: ${JSON.stringify(result)}`);
      }
      return (result as unknown as { value: Done<R> }).value;
    };
    const scopePins = async (workspaceId: string = main): Promise<VersionPin[]> => {
      const read = must(`the ${workspaceId} registration read`,
        await live.projects.readWorkspaceRegistration(ctx('host', workspaceId), { projectId, workspaceId }));
      return [{ ref: read.project.ref, revision: read.project.revision }, { ref: read.workspace.ref, revision: read.workspace.revision }];
    };
    const projectRef = { aggregateType: 'Project' as const, projectId };
    must('createProject', await live.projects.createProject(ctx(), { meta: { requestId: 'kls2a-project',
      expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } }));
    for (const workspaceId of workspaces) {
      const project = workspaceId === main ? { ref: projectRef, revision: 1 } : (await scopePins())[0]!;
      must(`registerWorkspace ${workspaceId}`, await live.projects.registerWorkspace(ctx('host', workspaceId), {
        meta: { requestId: `kls2a-register-${workspaceId}`, expected: [project,
          { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 0 }] },
        input: { workspace: { projectId, workspaceId } } }));
    }
    const [projectPin] = await scopePins();
    const installed = must('installCompletionPolicy',
      await live.completionPolicies.installCompletionPolicy(ctx(), { meta: { requestId: 'kls2a-policy-install', expected: [projectPin!,
        { ref: { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'kls2a-policy', revision: 1 }, revision: 0 }] },
      input: { policyId: 'kls2a-policy', contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } } }));
    must('activateCompletionPolicy', await live.completionPolicies.activateCompletionPolicy(ctx(), {
      meta: { requestId: 'kls2a-policy-activate', expected: [projectPin!,
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
      input: { target: { ref: installed.ref, digest: installed.contentDigest } } }));
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'kls2a-goal' };
    must('createGoal', await live.goals.createGoal(ctx(), { meta: { requestId: 'kls2a-goal', expected: await scopePins() },
      input: { goalId: goalRef.goalId, workspace: mainScope, objective: 'KLS2A knowledge goal' } }));

    const claimExecutorRun = async (): Promise<void> => {
      const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'kls2a-plan', planRevision: 1, goalId: goalRef.goalId,
        stages: [{ stageId: 's1', title: 'Stage one' }],
        tasks: [
          { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
          { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        ],
        assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' }],
        obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 'g1'],
          verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
        taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
      const before = must('queryGoal', await live.plans.queryGoal(ctx(), goalRef));
      const proposed = must('proposePlan', await live.plans.proposePlan(ctx(), {
        meta: { requestId: 'kls2a-plan-propose', expected: [{ ref: goalRef, revision: before.goal.revision }] },
        input: { goalRef, basedOn: null, draft, reason: { text: 'KLS2A plan', sources: [] } } }));
      const proposedGoal = must('queryGoal', await live.plans.queryGoal(ctx(), goalRef));
      const plan = must('applyPlanChange', await live.plans.applyPlanChange(ctx(), {
        meta: { requestId: 'kls2a-plan-apply', expected: [{ ref: goalRef, revision: proposedGoal.goal.revision }] },
        input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }));
      const session = must('createSession',
        await live.runtime.createSession(ctx(), { workspace: mainScope,
          role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
          recommendedRefs: [], initialLinks: [], meta: { requestId: 'kls2a-session', expected: [] } }));
      const sessionRef = { projectId: session.ref.projectId, sessionId: session.ref.sessionId };
      const goal = must('queryGoal', await live.plans.queryGoal(ctx(), goalRef));
      const card = must('readSession', await live.sessions.readSession(ctx(), sessionRef));
      const claimed = must('claimTask', await live.claims.claimTask(ctx(), {
        input: { goalRef, planRef: plan.ref, taskId: 't1', sessionRef, roleBinding: EXECUTOR_BINDING,
          budget: { tokenBudget: 100000, deadline: null } },
        meta: { requestId: 'kls2a-claim', expected: [{ ref: goalRef, revision: goal.goal.revision }, (await scopePins())[1]!,
          { ref: { aggregateType: 'Session', ...sessionRef }, revision: card.record.revision }] } }));
      runRef = claimed.runRef;
    };
    return {
      root: rootOf(), projectId, workspaceId: main, platform: live, goalRef, ctx, claimExecutorRun, scopePins,
      file(rel, workspaceId) {
        const path = join(rootOf(workspaceId), rel);
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
      },
      files(dir, workspaceId) {
        const path = join(rootOf(workspaceId), dir);
        if (!existsSync(path)) return [];
        return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort();
      },
      edit(rel, text, workspaceId) { writeFileSync(join(rootOf(workspaceId), rel), text); },
      async close() {
        try { await live.close(); } finally { await rm(directory, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    if (platform !== undefined) await platform.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
