/**
 * PL-47 (spec §5.3.4, §6.4.3; C-9/N12): a real filesystem failure at the
 * automatic-adoption export does not fail the adoption. The world is the ruled
 * one: a real first Plan, the real Workflow through the second stage's
 * `plan_only` gap, a real planning answer and review pass, a clean diagnosis
 * and automatic mode, then the ruled export fault, automatic adoption and the
 * public notice read.
 *
 * The two branches are the two ruled faults: a real `ENOTDIR` at the export
 * root, and the export root inside the registered workspace root. The human
 * fault path stays in G-08. Where this tree still lacks a P4/P5/L symbol the
 * row stops there instead of falling back to a manual adoption or a read-only
 * notice.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import {
  createS6BLine, lineBinding, openPLTaskbookWorld, twoStageDraft, type PLTaskbookWorld,
} from '../helpers/PL-taskbook-fixture.js';
import { asRecord, readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding } from '../helpers/S6A-request-fixture.js';
import { setS7AAutonomy, sessionOf } from '../helpers/S7A-fixture.js';
import { assignGoalAdviserLine } from '../helpers/S7C-handoff-fixture.js';
import { awaitCandidate, awaitPlanningAnswer, readProposal } from '../helpers/IV-host-fixture.js';

const PL47_EXTRA_BINDINGS: readonly S6AExtraBinding[] = [
  lineBinding('pl47-adviser-binding', platformRoleProfile('adviser').template, 'PL-47 adviser'),
  lineBinding('pl47-reviewer-binding', platformRoleProfile('reviewer').template, 'PL-47 reviewer'),
];

const faults: readonly {
  name: string;
  label: string;
  open(): Promise<PLTaskbookWorld>;
  prepare(world: PLTaskbookWorld): Promise<void>;
}[] = [
  {
    name: 'a real ENOTDIR at the export root',
    label: 'fs',
    open: async () => await openPLTaskbookWorld({ extraBindings: PL47_EXTRA_BINDINGS }),
    prepare: async (world) => {
      // A regular file where `<settingsDirectory>/taskbooks` must be: every
      // write below it fails with ENOTDIR, the real ruled fault.
      await writeFile(join(world.settingsDirectory, 'taskbooks'), 'not a directory\n');
    },
  },
  {
    name: 'the export root inside the workspace root',
    label: 'isolation',
    open: async () => await openPLTaskbookWorld({ isolation: true, extraBindings: PL47_EXTRA_BINDINGS }),
    prepare: async () => undefined,
  },
];

/**
 * The one stage-two segment the adviser answers after the `refine:` round:
 * the placeholder `stage-next` becomes the stage's real work task, with its
 * own instruction and verification obligation (spec §5.1.1–§5.1.2).
 */
function stageTwoSegment() {
  return {
    stages: [{ stageId: 'stage-two', title: 'Stage two', description: 'The next stage.' }],
    tasks: [{
      taskId: 'stage-next', stageId: 'stage-two', title: 'Stage two work',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active',
      scope: { kind: 'stage', stageId: 'stage-two' }, executionIntent: 'request_execution',
      sizeClass: 'medium', estimatedLines: 5,
    }],
    assignments: [{ taskId: 'stage-next', role: S6A_WORK_ROLE.templateId, instruction: 'Do the stage two work.' }],
    obligations: [{
      obligationId: 'stage-two-obligation', title: 'Stage two is delivered', requirementLevel: 'required',
      taskIds: ['stage-next'],
      verificationRequirements: [{
        requirementId: 'stage-two-check', requirementLevel: 'required', kind: 'static',
        description: 'The stage two check passes.',
      }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

/** The message ref of a system round the Workflow returned as the next `perform` step. */
function roundMessageRefOf(
  steps: Awaited<ReturnType<typeof driveWorkflow>>,
  kind: 'refine' | 'planreview',
): SessionMessageRef {
  let request: Parameters<typeof systemRoundRequestId>[0] | undefined;
  for (const step of steps) {
    const next = step.next;
    if (next?.kind !== 'perform' || next.operation.kind !== 'send_system_round') continue;
    if (next.operation.request.round.kind !== kind) continue;
    request = next.operation.request.round;
    break;
  }
  if (request === undefined) {
    throw new Error(`UNPROVEN PL-47 ${kind}: the Goal selection returned no ${kind} system round; `
      + 'the plan loop / `send_system_round` arm is missing (owner: P4, src/business/workflow/workflow.ts).');
  }
  const requestId = systemRoundRequestId(request);
  if (requestId.status !== 'ready') throw new Error(`PL-47: the ${kind} request id is invalid: ${requestId.reason}`);
  const ref = systemRoundMessageRef(S6A_SCOPE, requestId.value);
  if (ref.status !== 'ready') throw new Error(`PL-47: the ${kind} message ref is invalid: ${ref.reason}`);
  return ref.value;
}

describe('PL-47: taskbook export failure', () => {
  it.each(faults)('automatic adoption survives $name and the notice carries the line', async (fault) => {
    const world = await fault.open();
    try {
      // The fault is real before the first adoption's export runs: the first
      // Plan is the person's, refinement of its second stage is automatic.
      await fault.prepare(world);
      const before = await world.readWorkspaceRegistration();
      const adopted = await world.adopt({
        label: `pl47-${fault.label}`, draft: twoStageDraft(world.goal, `pl47-${fault.label}`),
      });
      expect(adopted.plan.planRevision).toBe(1);
      expect(adopted.plan.stages.map(stage => stage.stageId)).toEqual(['stage-one', 'stage-two']);

      // The second stage's `plan_only` placeholder is the gap the plan loop
      // reads; automatic mode decides the adoption.
      await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
      // 7D2 O4b-2 (o4b2 ruling 2 (a)): the refine round goes to the Goal's responsible adviser. T4a: the line opens
      // through `role-lines/open` and the platform's queue assignment writes the Goal link.
      const adviser = await assignGoalAdviserLine(world.world, {
        goal: world.goal, label: `pl47-adviser-${fault.label}`,
        requestId: `pl47-adviser-${fault.label}`,
      });
      const reviewerLine = await createS6BLine(world.main, {
        label: `pl47-reviewer-${fault.label}`, role: platformRoleProfile('reviewer').template,
      });
      const reviewer = await sessionOf(world.world, reviewerLine);

      // The stage's real work runs on its own line; the stage gate is the real
      // `advanceGate` selection, with its own check run and no model execution.
      const work = world.tasks[0]!;
      const gateTask = { projectId: work.projectId, goalId: work.goalId, taskId: 'stage-gate' };
      const line = await createS6BLine(world.main, {
        label: `pl47-${fault.label}`, role: S6A_WORK_ROLE, tasks: [work, gateTask],
      });
      const session = await sessionOf(world.world, line);
      const segment = stageTwoSegment();
      await world.world.scripted.script(adviser, [{
        kind: 'calls',
        calls: [{
          callId: `pl47-plan-${fault.label}`, name: 'submit_plan_round',
          args: {
            answerKind: 'plan', summary: `PL-47 stage two ${fault.label}`, plan: segment,
            reason: { text: `PL-47 refine ${fault.label}`, affectedTaskIds: ['stage-next'] },
          },
        }],
      }]);
      await world.world.scripted.script(reviewer, [{
        kind: 'calls',
        calls: [{ callId: `pl47-review-${fault.label}`, name: 'submit_plan_review', args: { verdict: 'pass' } }],
      }]);
      await world.world.scripted.script(session, [{ kind: 'text', text: 'stage one work done' }]);
      await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
        flowId: `pl47-work-${fault.label}`, sessionHint: line.ref, kind: 'select_work', taskId: 'stage-work' });
      const gateSteps = await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
        flowId: `pl47-gate-${fault.label}`, sessionHint: line.ref, kind: 'select_work' });

      // The Goal selection, not an explicit task, ran the real `advanceGate`:
      // the stage gate is satisfied after its check run. The gate executes no
      // model turn.
      const gateGraph = readyValue<{ tasks: Array<Record<string, unknown>> }>(
        await world.main.route('tasks/query', { goalRef: world.goal }), 'tasks/query');
      const gateRow = gateGraph.tasks.find(row => asRecord(row['ref'])['taskId'] === 'stage-gate');
      expect(gateRow?.['effectivePhase']).toBe('satisfied');

      // The same selection then sees the `plan_only` second stage and sends
      // `refine:` to the adviser line; the real Host consume loop runs the
      // planning Query, and the scripted adviser submits its stage-two answer.
      const refineRef = roundMessageRefOf(gateSteps, 'refine');
      const refineAnswer = await awaitPlanningAnswer(world.world, refineRef);
      expect(refineAnswer?.job.job.status).toBe('answered');
      const candidate = await awaitCandidate(world.world, refineRef, world.goal);
      expect(candidate.proposal.status).toBe('candidate');

      // The candidate is reviewed by the real review round; the scripted
      // reviewer submits its pass, and the next Goal pass adopts the candidate
      // automatically (clean diagnosis and automatic mode).
      const reviewSteps = await driveWorkflow(world.world.ag2b, {
        schemaVersion: 1, goalRef: world.goal, flowId: `pl47-review-${fault.label}`,
        sessionHint: line.ref, kind: 'select_work',
      });
      const reviewRef = roundMessageRefOf(reviewSteps, 'planreview');
      const reviewAnswer = await awaitPlanningAnswer(world.world, reviewRef);
      expect(reviewAnswer?.job.job.status).toBe('answered');
      await driveWorkflow(world.world.ag2b, {
        schemaVersion: 1, goalRef: world.goal, flowId: `pl47-adopt-${fault.label}`,
        sessionHint: line.ref, kind: 'select_work',
      });

      // Public reads: the active plan advanced to the candidate's revision and
      // the registered workspace version did not move.
      const active = await world.readActivePlan();
      expect(active.revision).toBe(2);
      const planId = active.plan?.planId;
      if (planId === undefined) throw new Error('PL-47: no active plan after the adoption');
      const after = await world.readWorkspaceRegistration();
      expect(after).toEqual(before);
      // The failed export leaves the candidate adopted, not `not_adopted`.
      expect((await readProposal(world.world, candidate.proposal.ref)).status).toBe('accepted');

      // Both public entry points return exactly this adoption's one item; the
      // itemKey and the ruled export-failure line are the same on both.
      const itemKey = `plan-adoption:${planId}:2`;
      const read = await world.readNotices();
      const mainItems = read.main.filter(item => item['itemKey'] === itemKey);
      const queueItems = read.queue.filter(item => item['itemKey'] === itemKey);
      expect(mainItems).toHaveLength(1);
      expect(queueItems).toHaveLength(1);
      expect(mainItems[0]?.['category']).toBe('plan_adoption');
      expect(queueItems[0]?.['category']).toBe('plan_adoption');
      expect(mainItems[0]?.['itemKey']).toBe(queueItems[0]?.['itemKey']);
      const failedLine = (stageId: string) => '任务书 ' + stageId + ' 导出失败：未写出（'
        + world.taskbookPath({ stageId, planId, planRevision: 2 })
        + '）；采用不受影响，不自动重试';
      for (const stageId of ['stage-one', 'stage-two']) {
        expect(String(mainItems[0]?.['summary'])).toContain(failedLine(stageId));
        expect(String(queueItems[0]?.['summary'])).toContain(failedLine(stageId));
      }
    } finally {
      await world.close();
    }
  });
});
