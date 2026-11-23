/**
 * P1's one shared world (contract `p1-frozen.md` section 五), composed from existing public steps only: PL's consume
 * world (Host consumer, the platform adviser's binding and Query profile, the Work send/reply grant, governance) with
 * `installPLFailingCheck`'s failing check; goal 1's AG2b Plan with four work Tasks (`adoptS6BPlan`): tA idle, tB (with
 * `running`) run by E and held at its model request (released, the model fails and the Run ends `failed`), tC run by
 * E2 to a failed check round and stopped before the Workflow's own rework, tD idle; the executor lines E (tB, tA) and
 * E2 (tC, tD), the Goal's adviser A (goal link through the adviser queue), the secretary S with only the project link
 * (`createSecretary`, as request intake opens it; lead ruling 1) and the region adviser B with one module link.
 * A held round is G-05's: a person's `action_request` naming the Goal opens the line's planning round (B20; the
 * scripted model answers text only) and its model request is held. The context the Runtime hands the round's answer
 * tools is kept as given (A3, `query-context-capture.ts` `captureAnswerContexts`). One consume pass per workspace
 * runs at a time and a held round keeps it open, so rounds held together open in one pass, each later line waiting
 * at its claim commit. Nothing here reads or writes a store.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { heartbeatUntilModel, settleHost } from './IV-host-fixture.js';
import { captureAnswerContexts } from './query-context-capture.js';
import {
  createPLAdviserLine, createPLLine, installPLFailingCheck, openPLConsumptionWorld,
} from './PL-consumption-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AGate, S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, openS6BRoleLine } from './S6B1-fixture.js';
import { committed, sessionOf, setS7AAutonomy } from './S7A-fixture.js';
import { claimOf } from './S7C-member-fixture.js';

/** A held round: its line, the Runtime's own `query_run` context, the person's message that opened it; `end` releases
 *  the model requests of its pass and resolves once that pass settled (every round it opened ended). */
export type P1HeldRound = { line: S6ASession; ctx: CoreCallContext; source: SessionMessageRef; end(): Promise<void> };
export type P1World = {
  world: S6AHostWorld; goal: GoalRef;
  task: Record<'tA' | 'tB' | 'tC' | 'tD', TaskTriple>; lines: Record<'E' | 'E2' | 'A' | 'S' | 'B', S6ASession>;
  /** tB's Run (null unless `running`); `endB` releases its model request and waits until the Run ended. */
  runB: RunRef | null; endB(): Promise<void>;
  /** tC's ended Run, and the Workflow's own next step on it: the automatic `requeue_task`, not performed. */
  runC: RunRef; autoRework: WorkflowAdvanceInput;
  hold(line: S6ASession, label: string): Promise<P1HeldRound>;
  holdRounds<const L extends readonly S6ASession[]>(lines: L, label: string): Promise<{ [K in keyof L]: P1HeldRound }>;
  /** The Workflow's own `claim_task` step of `task`, unperformed (the Task's responsible line claims it). */
  claimStep(line: S6ASession, task: TaskTriple, label: string): Promise<WorkflowAdvanceInput>; close(): Promise<void>;
  /** `line` runs `task` as tC was run: the Run ends, its check fails, the Workflow stops before its own rework. */
  failWork(line: S6ASession, task: TaskTriple, label: string): Promise<RunRef>;
};

export async function openP1World(options: {
  backend?: 'memory' | 'sqlite'; running?: boolean; autonomy?: 'every_step';
} = {}): Promise<P1World> {
  const world = await openPLConsumptionWorld({ backend: options.backend ?? 'memory', label: 'p1',
    checks: installPLFailingCheck() });
  const releases: Array<() => Promise<void>> = [];
  const releaseAll = async () => { for (const release of releases.reverse()) await release().catch(() => undefined); };
  try {
    const [main, goal] = [s6aCardsWorkspace(world, S6A_SCOPE), world.goals.first];
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'p1', role: S6A_WORK_ROLE.templateId,
      taskIds: ['p1-ta', 'p1-tb', 'p1-tc', 'p1-td'] });
    const [tA, tB, tC, tD] = tasks as [TaskTriple, TaskTriple, TaskTriple, TaskTriple];
    const E = await createPLLine(world, { label: 'p1-e', role: S6A_WORK_ROLE, tasks: [tB, tA] });
    const E2 = await createPLLine(world, { label: 'p1-e2', role: S6A_WORK_ROLE, tasks: [tC, tD] });
    const A = await createPLAdviserLine(world, 'p1-adviser');
    const S = await world.createSecretary('p1-secretary');
    const B = await sessionOf(world, await openS6BRoleLine(main, { label: 'p1-region', duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: { projectId: goal.projectId, moduleId: 's6a-core' } }],
      requestId: 'p1-region-open' }));
    const claimStep = async (line: S6ASession, task: TaskTriple, label: string): Promise<WorkflowAdvanceInput> =>
      await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `p1-claim-${label}`,
        sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, 'claim_task');
    const failRun = async (line: S6ASession, task: TaskTriple, label: string) => {
      await world.scripted.script(line, [{ kind: 'text', text: `P1 ${label} ended` }]);
      const receipts: WorkflowStepReceipt[] = [];
      const steps = await driveWorkflow(world.ag2b, await claimStep(line, task, label),
        { stopBefore: 'requeue_task', receipts });
      const next = steps.at(-1)?.next;
      if (next?.kind !== 'perform' || next.operation.kind !== 'requeue_task') {
        throw new Error(`P1: ${label} did not stop before its automatic rework: ${JSON.stringify(steps.at(-1))}`);
      }
      return { run: claimOf(receipts), next };
    };
    const { run: runC, next: autoRework } = await failRun(E2, tC, 'tc');
    let runB: RunRef | null = null;
    let endB = async (): Promise<void> => { throw new Error('P1: the world has no running tB'); };
    if (options.running === true) {
      const gate = await world.gates.modelRequest(E);
      const bReceipts: WorkflowStepReceipt[] = [];
      const drive = driveWorkflow(world.ag2b, await claimStep(E, tB, 'tb'),
        { stopBefore: op => op.kind === 'open_checks' || op.kind === 'requeue_task', receipts: bReceipts });
      const ended = drive.then(() => { throw new Error('P1: tB ended before its model request'); });
      ended.catch(() => undefined);
      await Promise.race([gate.reached, ended]);
      runB = claimOf(bReceipts);
      // T4: the Run's own replies (the caller's `send_session_message`) must be consumed before the Run ends;
      // queueing the closing `fail` only here keeps the FIFO order send-then-fail.
      endB = async () => { await world.scripted.script(E, [{ kind: 'fail', message: 'P1 tB failed' }]); gate.release(); await drive; };
      releases.push(endB);
    }
    // Only now: under every step, tC's stopped rework would have become a confirmation card.
    if (options.autonomy !== undefined) await setS7AAutonomy(world, goal, options.autonomy);
    await settleHost(world);
    const holdRounds = async (lines: readonly S6ASession[], label: string): Promise<P1HeldRound[]> => {
      const capture = captureAnswerContexts();
      try {
        const opened: Array<{ line: S6ASession; model: S6AGate<unknown>; claim: S6AGate<unknown> | null;
          source: SessionMessageRef }> = [];
        for (const [index, line] of lines.entries()) {
          await world.scripted.script(line, [{ kind: 'text', text: `P1 ${label} round ${String(index)} answer` }]);
          const model = await world.gates.modelRequest(line);
          const claim = index === 0 ? null : world.gates.beforeClaim(line);
          const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
            recipient: line.ref, text: `P1 ${label} opens round ${String(index)}`, entry: 'person_intervention',
            needsReply: true, goalRef: goal }, `p1-open-${label}-${String(index)}`)), `the ${label} opening message`);
          opened.push({ line, model, claim, source: sent.ref });
        }
        const { settled } = await heartbeatUntilModel(world, opened[0]!.model);
        const end = async (): Promise<void> => {
          for (const entry of opened) { entry.claim?.release(); entry.model.release(); }
          await settled;
        };
        releases.push(end);
        const rounds: P1HeldRound[] = [];
        for (const entry of opened) {
          if (entry.claim !== null) { entry.claim.release(); await entry.model.reached; }
          const occupancy = (await world.readSession(entry.line)).record.occupancy;
          const ctx = occupancy?.kind === 'execution' ? capture.ofRun(occupancy.executionRef.runId) : undefined;
          if (ctx === undefined) throw new Error(`P1: no held round context for ${entry.line.label}`);
          rounds.push({ line: entry.line, ctx, source: entry.source, end });
        }
        return rounds;
      } finally {
        capture.restore();
      }
    };
    return {
      world, goal, task: { tA, tB, tC, tD }, lines: { E, E2, A, S, B }, runB, endB,
      runC, autoRework, claimStep, failWork: async (line, task, label) => (await failRun(line, task, label)).run,
      holdRounds: async (lines, label) => await holdRounds(lines, label) as never,
      hold: async (line, label) => (await holdRounds([line], label))[0]!,
      async close() { await releaseAll(); await world.close(); },
    };
  } catch (error) {
    await releaseAll();
    await world.close().catch(() => undefined);
    throw error;
  }
}
