/**
 * GP-1 (lead 11-16 `gpt-brief.md` row GP-1; `docs/MVP-BEHAVIOR.md:86-92`, `:98`, `:104`, `:144-150`, `:311`): a new
 * project's first Goal, in one `it`, from the person's request to the completed Goal.
 *
 * World: a brand-new project the person opens on the S6B3 goal-card Host (`openS6B3World`, which carries the settings
 * directory): a fresh folder, made a Git work tree first (`initGitWorkspace`, real files on disk; the delivery read
 * pins the files' working-tree blobs), opened through the Host's own `workspaces/open` with no `projectId` (a new
 * project: no Goal, no governance) with write and commands. Why not
 * the cold-start world (`S7D2-coldstart-world.ts`): its main scope's access is fixed by the start-up configuration
 * (`workspaces/access` answers `unsupported: the start-up runtime configuration fixes this workspace's access`,
 * `host.ts:2541-2542`), so its Runs cannot change a file. Steps, all public: `requests/submit` with no Goal → the
 * secretary's scripted initial answer (one goal card, the first plan, the setup with one static check `true`) →
 * `goals/confirm-draft` → the person opens one executor line (`sessions/create`, SMK-3's step A-25) →
 * `initialization/adopt`, which starts the Goal's driver; from there only the Host drives: the Task's Run (its
 * scripted model creates `gp1-greeting.txt` with the native `edit`), the check round, `complete_task`, the Goal
 * gate's round and `complete_goal`. Why the person opens the line: with no line the driver sends the member request to
 * the project's adviser (`workflow.ts:1821-1833`, `suggestion_committed`), and that adviser system round on the built-in
 * 128k local profile closes before any model call: `required_content_over_budget` (87678 tokens required > input
 * budget 64000; `host.ts:1950-1978`); the Goal then stays `RUNNING` with no card for the person. The platform-path
 * version of this row (a Host heartbeat option on `openS6B3World` and a scripted `create_member` on the adviser) is
 * saved in `D:/cc-lead-notes/impl/g7/scratch/gpt/` for when that gap is fixed.
 * End products: ① the Goal reads `COMPLETED`;
 * ② `goals/delivery` lists the file the Task changed; ③ every hop from the completed Goal to the adopted plan, the
 * Task, its Run, its check round and that round's evidence is a ref the previous public read returned.
 * Memory only (rule S3: a business flow).
 *
 * Green today (b9444921). Mutation shown: the delivery read drops each node's files
 * (`task-node-commit-service.ts` `readNodeRows`) → red at ②.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { EvidenceV1 } from '../../src/contracts/evidence.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer } from '../helpers/S6B3-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { initGitWorkspace } from './support/git-workspace.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

/** The secretary's initial v2 answer: one work Task for the local workbench, the Goal gate, one static obligation over
 *  both, one goal card, and the setup (policy, empty architecture, the static check `true` for every Task). */
const PLAN_TEXT = JSON.stringify({
  schemaVersion: 2, kind: 'plan', summary: 'GP-1 first plan',
  plan: { schemaVersion: 2, stages: [], tasks: [
    { taskId: 'gp1-work', title: 'GP-1 greeting', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
      phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    { taskId: 'gp1-gate', title: 'GP-1 Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
      phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [{ taskId: 'gp1-work', role: 'local-workbench', instruction: 'Write gp1-greeting.txt' }],
  obligations: [{ obligationId: 'gp1-delivery', title: 'GP-1 delivery', requirementLevel: 'required',
    taskIds: ['gp1-work', 'gp1-gate'], verificationRequirements: [{ requirementId: 'gp1-static',
      requirementLevel: 'required', kind: 'static', description: 'GP-1 static check' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } },
  goalCardDrafts: [{ objective: 'GP-1 greeting', completion: ['gp1-greeting.txt is written'],
    autonomy: 'after_plan_confirmation', screening: null }],
  planDraftIndex: 0,
  setup: { architecture: { baselineId: 'gp1-baseline', description: 'GP-1 governance', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [] } },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  checks: [{ checkId: 'gp1-true', kind: 'static', command: 'true', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }] },
});

type TaskRow = { ref: { projectId: string; goalId: string; taskId: string }; effectivePhase: string };
type Node = { task: { taskId: string }; runs: RunRef[]; files: { path: string; certainty: string }[] };

it('GP-1: request → goal card → first plan adopted → the Run changes a file → checks PASS → Goal gate → COMPLETED',
  async () => {
    const world = await openS6B3World({ backend: 'memory' });
    const root = await mkdtemp(join(tmpdir(), 'gp1-project-'));
    try {
      await initGitWorkspace(root);
      const snapshot = await world.host.settings('snapshot', {});
      const modelId = snapshot.status === 'ready' ? snapshot.value.models[0]?.id : undefined;
      const opened = await world.host.settings('workspaces/open', { path: root, name: 'gp1', modelId: modelId!,
        writeAllowed: true, commandsAllowed: true });
      if (opened.status !== 'ready') throw new Error(`GP-1: workspaces/open: ${JSON.stringify(opened)}`);
      const scope = { projectId: opened.value.scope.projectId, workspaceId: opened.value.scope.workspaceId };
      await world.host.settleDetached();
      const read = async <T>(route: string, input: unknown): Promise<T> =>
        ready<T>(await world.host.post(route, plain(scope, input)), route);
      expect((await read<{ goals: unknown[] }>('goals/list', { workspace: scope })).goals).toEqual([]);

      const held = await holdS6B3RequestAnswer(world, { scope, label: 'gp1', goalId: null,
        executionKind: 'initial_coordination', reply: () => ({ kind: 'text', text: PLAN_TEXT }) });
      const answer = await releaseS6B3DraftAnswer(world, held);
      const goal = committed<GoalConfirmDraftReceiptV1>(await world.host.post('goals/confirm-draft', plain(scope,
        { commandId: 'gp1-confirm', round: held.round, index: 0 })), 'GP-1: the goal card').goal.ref;
      expect((await world.host.post('sessions/create', plain(scope, { workspace: scope, role: LOCAL_WORKBENCH_ROLE,
        recommendedRefs: [], initialLinks: [], meta: { requestId: 'gp1-line', expected: [] } }))).body)
        .toMatchObject({ status: 'completed' });
      world.host.scriptReplies([{ kind: 'calls', calls: [{ callId: 'gp1-edit', name: 'edit',
        args: { mode: 'create', path: 'gp1-greeting.txt', newText: 'hello from GP-1\n' } }] },
      { kind: 'text', text: 'GP-1 wrote the greeting' }]);
      const adopted = (await world.host.post('initialization/adopt', plain(scope, { commandId: 'gp1-adopt',
        expectedAnswerDigest: sha256Hex(answer.answerText), source: { kind: 'binding', answerRef: answer.answerRef,
          draftIndex: 0 }, expectedGoal: { ref: goal, revision: 1 } }))).body as { status: string; receipt: { plan: unknown } };
      expect(adopted.status).toBe('committed');

      // ① Only the Host's driver runs from here: no advance, no driver-start.
      const display = await waitFor(async () => (await read<{ display: { phase: string } }>('goals/display',
        { goalRef: goal })).display, value => value.phase === 'COMPLETED', 'GP-1: the Goal COMPLETED');
      expect(display.phase).toBe('COMPLETED');

      // ② The delivery view lists the file the work Task changed.
      const delivery = await read<{ display: { phase: string }; nodes: Node[] }>('goals/delivery', { goalRef: goal });
      expect(delivery.display.phase).toBe('COMPLETED');
      const work = delivery.nodes.find(node => node.task.taskId === 'gp1-work');
      expect(work?.files.map(file => ({ path: file.path, certainty: file.certainty })))
        .toEqual([{ path: 'gp1-greeting.txt', certainty: 'definite' }]);

      // ③ Goal → adopted plan → Task → Run → check round → evidence, each ref from the previous public read.
      const planRef = (await read<{ goal: { activePlanRevision: unknown } }>('goals/read', goal)).goal.activePlanRevision;
      expect(planRef).toEqual(adopted.receipt.plan);
      const graph = await read<{ plan: { ref: unknown }; tasks: TaskRow[] }>('tasks/query', { goalRef: goal, planRef });
      expect(graph.plan.ref).toEqual(planRef);
      expect(graph.tasks.map(task => [task.ref.taskId, task.effectivePhase]))
        .toEqual([['gp1-work', 'satisfied'], ['gp1-gate', 'satisfied']]);
      const task = graph.tasks[0]!.ref;
      const runs = await read<{ items: { run: { ref: RunRef; planRef: unknown; status: string; outcome: string } }[] }>(
        'executions/list', { goalRef: goal, taskId: task.taskId, page: { afterCursor: null, limit: 5 } });
      expect(runs.items.map(item => item.run)).toEqual([expect.objectContaining({ planRef, status: 'ended', outcome: 'completed' })]);
      const runRef = runs.items[0]!.run.ref;
      expect(work?.runs).toEqual([runRef]);
      const look = async <T>(node: Record<string, unknown>, relation: string): Promise<T[]> => (await read<{ items: T[] }>(
        'graph/look', { goalRef: goal, target: { kind: 'node', node }, relation, page: { afterCursor: null, limit: 10 } })).items;
      const rounds = (await look<{ round: RoundSnapshot }>({ kind: 'task', ref: task, planRef }, 'checks')).map(item => item.round);
      expect(rounds).toHaveLength(1);
      expect(rounds[0]).toMatchObject({ subject: task, subjectRunRef: runRef, adoptedPlanRef: planRef,
        status: 'finalized', outcome: 'PASS' });
      const evidence = (await look<{ evidence?: EvidenceV1[] }>({ kind: 'round', ref: rounds[0]!.ref }, 'evidence'))[0]?.evidence;
      expect(evidence?.map(item => item.evidenceId)).toEqual(rounds[0]!.evidenceRefs.map(ref => ref.evidenceId));
      expect(evidence).toEqual([expect.objectContaining({ subject: task, outcome: 'PASS',
        coverage: [{ obligationId: 'gp1-delivery', requirementId: 'gp1-static' }] })]);
    } finally {
      await world.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
