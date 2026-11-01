/**
 * PL R3 fixture: a real Host world with Work write/shell rights, one adopted
 * Plan and the lines its tasks run on. It composes the existing public steps
 * (`openS6AHostWorld`, `governS6B`, `adoptS6BPlan`, `createS6BLine`,
 * `driveWorkflow`) and never writes a record, reads a store or makes a call
 * context for a Run.
 *
 * The Work binding gets the Host's real write/shell grant through
 * `withConfiguredHost` (the ruling's world recipe).
 */
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, sessionOf } from './S7A-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';

type HostFactory = typeof import('../../src/app/host.js').createLocalWorkbenchHost;

const WORK_BINDING_ID = 's6a-work-binding';

export const usage = (inputTokens: number, outputTokens: number) =>
  ({ inputTokens, outputTokens, cachedInputTokens: 0, costUsdMicros: null });

/** Give the Work binding real write/shell rights; `unlimited` clears the three cumulative run limits. */
function configuredHostFactory(original: HostFactory, unlimited: boolean): HostFactory {
  return async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    const work = configuration?.bindings.find(binding => binding.id === WORK_BINDING_ID);
    if (configuration === undefined || work === undefined) {
      throw new Error('PL readings: the Host was opened without its Work binding');
    }
    work.grant = {
      ...work.grant,
      tools: [...new Set([...work.grant.tools, 'write', 'shell'])],
      writeScope: ['.'],
      shellWorkspaceAccess: 'all_except_denied',
      ...(unlimited ? { budget: { ...work.grant.budget, maxRequests: null, maxToolCalls: null, timeoutMs: null } } : {}),
    };
    return await original(hostOptions);
  };
}

export type PLReadingsOptions = {
  /** The Plan's work tasks; default `['pl-task']`. */
  taskIds?: readonly string[];
  /** PL-19: clear `maxRequests`/`maxToolCalls`/`timeoutMs` (null = unlimited), never a number. */
  unlimitedRunLimits?: boolean;
};

export type PLReadingsWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  /** A real line through `sessions/create` with open `responsible` links to `tasks`. */
  line(label: string, tasks?: readonly TaskTriple[]): Promise<S6ASession>;
  /** Script the Run's replies, claim `taskId` and drive it to completion; returns the Run. */
  runTask(input: {
    line: S6ASession; taskId: string; flowId: string; replies: readonly S6AReply[];
  }): Promise<RunRef>;
  /** The public `activity/runs` read. */
  readRuns(runRefs: readonly RunRef[]): Promise<RunActivityViewV1[]>;
  close(): Promise<void>;
};

/** Open the world; the caller closes it (a setup failure closes it here). */
export async function openPLReadingsWorld(options: PLReadingsOptions = {}): Promise<PLReadingsWorld> {
  const taskIds = options.taskIds ?? ['pl-task'];
  const world = await withConfiguredHost(
    () => openS6AHostWorld({ backend: 'memory',
      extraHostOptions: { checks: checkConfiguration({ ...OPERATOR, kind: 'human' }) } }),
    original => configuredHostFactory(original, options.unlimitedRunLimits === true));
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await governS6B(world, main, world.goals);
    const goal = world.goals.first;
    const { tasks } = await adoptS6BPlan(main, goal, {
      label: 'pl-readings', taskIds, role: S6A_WORK_ROLE.templateId,
    });
    return {
      world, main, goal, tasks,
      async line(label, linked = tasks) {
        return await sessionOf(world, await createS6BLine(main, { label, role: S6A_WORK_ROLE, tasks: linked }));
      },
      async runTask(input) {
        await world.scripted.script(input.line, input.replies);
        const claimInput = await advanceUntil(world.ag2b, {
          schemaVersion: 1 as const, goalRef: goal, flowId: input.flowId,
          sessionHint: input.line.ref, kind: 'select_work' as const, taskId: input.taskId,
        }, 'claim_task');
        const receipts: WorkflowStepReceipt[] = [];
        await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
        return claimedRunOf(receipts, input.taskId).run;
      },
      async readRuns(runRefs) {
        const answer = await world.post('activity/runs', plain(S6A_SCOPE, { runRefs: [...runRefs] }));
        const body = answer.body as { status: string; value?: RunActivityViewV1[]; code?: string; reason?: string };
        if (body.status !== 'ready' || body.value === undefined) {
          throw new Error(`PL readings: activity/runs was not ready: ${JSON.stringify(answer.body)}`);
        }
        return body.value;
      },
      async close() { await world.close(); },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The view of the named Run from the public `activity/runs` answer. */
export function runView(runs: readonly RunActivityViewV1[], runRef: RunRef): RunActivityViewV1 {
  const view = runs.find(candidate => candidate.runRef.runId === runRef.runId);
  if (view === undefined) throw new Error(`PL readings: activity/runs has no view for Run ${runRef.runId}`);
  return view;
}
