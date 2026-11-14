/**
 * B06 witness checks: the one shared world of the SB06 rows. It reuses the S9 review world's recipe
 * (`S9-review-fixture.ts`) through public steps only, never reads the store and asserts nothing.
 * - `openSB06World`: a real Host (`openS6AHostWorld`, memory unless named) with the S7A echo command check, a Git
 *   baseline in its root before any Run (`initGitWorkspace`; `git: false` keeps the plain root), the governance seed
 *   with a completion policy admitting `static`, `witness` and `reviewer`, one Plan adopted through `plans/propose` +
 *   `plans/apply`, and one Work line responsible for each work Task (`sessions/create`). `write` merges the native
 *   `write` tool and a write grant into the Work binding (Host input, rule A8).
 * - `sb06Draft`: required work Tasks (the first, `sb06-explore`, has `sizeClass:'explore'`), the required Goal gate
 *   with its own static obligation, and one requirement per obligation (`witness` may carry `requiredReadPaths`).
 * - `driveSB06`: scripts the line, then `select_work` → `claim_task` → the public `workflow/advance` chain, stopping
 *   before the first `run_check`, or right after `finalize_checks` (the next step stays unperformed), or at the end.
 * - reads: `graph/look` (`card`, `evidence`), `tasks/query` and `materials/open`.
 */
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { EvidenceV1 } from '../../src/contracts/evidence.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { adoptPLPlanDraft } from './PL-workflow-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, ready, receiptOf, sessionOf } from './S7A-fixture.js';

export const SB06_TASK = 'sb06-explore';
export const SB06_WITNESS = 'platform:witness';
/** Three files of the Git baseline (`DEFAULT_GIT_WORKSPACE_FILES`), in the order the rows read them. */
export const SB06_PATHS = ['src/module.ts', 'tsconfig.json', 'README.md'] as const;

export type SB06Obligation = { id: string; taskIds: readonly string[]; kind: 'witness' | 'static' | 'reviewer';
  paths?: readonly string[] };
export type SB06World = { world: S6AHostWorld; main: S6ACardsWorkspace; goal: GoalRef;
  lines: ReadonlyMap<string, S6ASession>; close(): Promise<void> };
export type SB06Drive = { roundRef: VerificationRoundRef; runRef: RunRef; receipts: WorkflowStepReceipt[];
  next: WorkflowAdvanceInput | null };
export type SB06Card = { round: RoundSnapshot; evidence?: EvidenceV1[] };

/** The witness obligation of the explore Task (`paths` omitted: the requirement carries no `requiredReadPaths`). */
export const sb06Witness = (paths?: readonly string[], id = 'sb06-read'): SB06Obligation =>
  ({ id, taskIds: [SB06_TASK], kind: 'witness', ...(paths === undefined ? {} : { paths }) });

export function sb06Draft(goal: GoalRef, obligations: readonly SB06Obligation[],
  workTasks: readonly string[] = [SB06_TASK]): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'sb06-plan', planRevision: 1, goalId: goal.goalId, stages: [],
    tasks: [...workTasks.map(taskId => ({ taskId, title: `SB06 ${taskId}`, requirementLevel: 'required' as const,
      taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const },
      executionIntent: 'request_execution' as const, ...(taskId === SB06_TASK ? { sizeClass: 'explore' as const } : {}) })),
    { taskId: 'sb06-gate', title: 'SB06 Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
      phase: 'pending', scope: { kind: 'goal' } }],
    assignments: workTasks.map(taskId => ({ taskId, role: S6A_WORK_ROLE.templateId, instruction: `Read for ${taskId}` })),
    obligations: [...obligations, { id: 'sb06-gate', taskIds: ['sb06-gate'], kind: 'static' as const }].map(ob => ({
      obligationId: ob.id, title: `SB06 ${ob.id}`, requirementLevel: 'required' as const, taskIds: [...ob.taskIds],
      verificationRequirements: [{ requirementId: `${ob.id}-req`, requirementLevel: 'required' as const, kind: ob.kind,
        description: `SB06 ${ob.kind} requirement`, ...(ob.paths === undefined ? {} : { requiredReadPaths: [...ob.paths] }) }] })),
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

export async function openSB06World(options: { draft: (goal: GoalRef) => PlanRevisionDraft; git?: boolean | undefined;
  write?: boolean | undefined; backend?: S6ABackend }): Promise<SB06World> {
  const write = { binding: { id: 's6a-work-binding' } as WorkbenchRuntimeBinding, mergeTools: ['write'], mergeWriteScope: ['.'] };
  const world = await openS6AHostWorld({ backend: options.backend ?? 'memory',
    ...(options.write === true ? { extraBindings: [write], workspaceGrants: { writePrefixes: ['.'] } } : {}),
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  try {
    if (options.git !== false) await initGitWorkspace(world.root);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    const governance = await governS6B(world, main, world.goals);
    await governance.activatePolicy({ content: { schemaVersion: 1, requirementKinds: ['static', 'witness', 'reviewer'],
      minimumRequiredRequirementsPerObligation: 1 } });
    const goal = world.goals.first;
    const plan = await adoptPLPlanDraft(main, goal, options.draft(goal), 'sb06');
    const lines = new Map<string, S6ASession>();
    for (const task of plan.tasks.filter(candidate => candidate.taskKind === 'work')) {
      const triple: TaskTriple = { projectId: goal.projectId, goalId: goal.goalId, taskId: task.taskId };
      lines.set(task.taskId, await sessionOf(world, await createS6BLine(main, { label: task.taskId, role: S6A_WORK_ROLE,
        tasks: [triple] })));
    }
    return { world, main, goal, lines, close: async () => { await world.close(); } };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The executor's replies: one native `read` per path, then the final text. */
export const sb06Reads = (paths: readonly string[], report: string): S6AReply[] => [
  ...paths.map((path, index): S6AReply => ({ kind: 'calls', calls: [{ callId: `sb06-read-${String(index)}`, name: 'read',
    args: { path } }] })), { kind: 'text', text: report }];

export async function driveSB06(sb: SB06World, input: { to: 'run_check' | 'finalized' | 'end';
  replies?: readonly S6AReply[]; taskId?: string; from?: SB06Drive }): Promise<SB06Drive> {
  const taskId = input.taskId ?? SB06_TASK;
  const receipts = [...(input.from?.receipts ?? [])];
  let start = input.from?.next ?? null;
  if (input.from === undefined) {
    const line = sb.lines.get(taskId)!;
    await sb.world.scripted.script(line, input.replies ?? []);
    start = await advanceUntil(sb.world.ag2b, { schemaVersion: 1, goalRef: sb.goal, flowId: `sb06-${taskId}`,
      sessionHint: line.ref, kind: 'select_work', taskId }, 'claim_task');
  }
  if (start === null) throw new Error('SB06: nothing left to drive');
  const steps = await driveWorkflow(sb.world.ag2b, start, { receipts, stopBefore: op => input.to === 'run_check'
    ? op.kind === 'run_check' : input.to === 'finalized' && receipts.some(receipt => receipt.kind === 'finalize_checks') });
  const opened = receiptOf(receipts, 'open_checks')?.result as { value?: { ref?: VerificationRoundRef } } | undefined;
  const kinds = receipts.map(receipt => receipt.kind).join(',');
  if (opened?.value?.ref === undefined) throw new Error(`SB06: no round opened: ${kinds}`);
  const next = steps.at(-1)?.next ?? null;
  if (input.to === 'run_check' && opOf(next) !== 'run_check') throw new Error(`SB06: no run_check after ${kinds}`);
  return { roundRef: opened.value.ref, runRef: claimedRunOf(receipts, taskId).run, receipts, next };
}

/** The kind of the unperformed step (`null` for a wait or the end). */
export const opOf = (next: WorkflowAdvanceInput | null): string | null =>
  next?.kind === 'perform' ? next.operation.kind : null;

/** `graph/look` of the round node: its card, with `evidence` for the evidence relation. */
export async function roundSB06(sb: SB06World, roundRef: VerificationRoundRef,
  relation: 'card' | 'evidence' = 'card'): Promise<SB06Card> {
  const card = ready<{ items: SB06Card[] }>(await sb.world.post('graph/look', plain(S6A_SCOPE, { goalRef: sb.goal,
    target: { kind: 'node', node: { kind: 'round', ref: roundRef } }, relation, page: { afterCursor: null, limit: 1 } })),
  `SB06: graph/look ${relation}`).items[0];
  if (card === undefined) throw new Error(`SB06: no round card for ${roundRef.roundId}`);
  return card;
}

export const witnessOf = (round: RoundSnapshot) => round.checks.find(check => check.checkId === SB06_WITNESS);

export async function taskRowSB06(sb: SB06World, taskId = SB06_TASK) {
  return ready<{ tasks: { ref: { taskId: string }; effectivePhase: string; reduction?: unknown }[] }>(await sb.world.post(
    'tasks/query', plain(S6A_SCOPE, { goalRef: sb.goal })), 'SB06: tasks/query').tasks.find(row => row.ref.taskId === taskId);
}

/** `materials/open` of an artifact (the historical-explanation usage): the raw body string. */
export async function bodySB06(sb: SB06World, ref: unknown, scope: WorkspaceScope = S6A_SCOPE): Promise<string> {
  return ready<{ body: string }>((await sb.world.post('materials/open', plain(scope, { ref,
    usage: 'historical_explanation' }))).body, 'SB06: materials/open').body;
}
