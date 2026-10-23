/**
 * PC-2 rework 2, J-08: the continuation preparation's REAL model request under
 * a zero resident-context budget. A Work fixture is opened with
 * `contextResidentBytes: 0`; the first Run completes, a second Task with one
 * exact input requirement is appended through the public Plan owners, claimed
 * on the same Session, completed and requeued, and its same-Session
 * continuation is prepared (not just rendered) and started.
 *
 * The frozen manifest is read from the prepared bundle. Every expected count,
 * the role's whole text, the new Task's whole text, the input row and the whole
 * current input are hand-written literals below; none is computed from
 * production, the generated pack, the manifest or a captured request. The three
 * public identifiers the expected input carries are the brief digest the public
 * brief read returns, the previous Run id the public claim returned and the round
 * id the public open returned.
 *
 * Optional sections with rows: `notes` (the one note we wrote for the new
 * Task), `reminders` (the architecture no-observation row, the one unavailable
 * decision source, and the goal-understanding update-due row the rework trigger
 * adds) and `inputs` (the one exact input requirement). The production
 * footprint producer emits no rows and stays a declared future section.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { claimSuccessorRun } from '../helpers/WP2-platform-support.js';

const REMINDER = '- 文件可能已经变化，编辑前先重新读取。';
const NOTE_CONCLUSION = 'J-08 hand-written inputs note';
const NEW_TASK_ID = 'pc2-j08-inputs';
const NEW_REFERENCE = 'pc2-j08-input-1';
const NEW_PLAN_ID = 'pc2-j08-input-plan';
const INPUT_MATERIAL = 'PC2 J-08 exact input material';
const INPUT_MATERIAL_CONTENT_TYPE = 'text/plain';

/** The whole exact-input Artifact reference, hand-written. */
const INPUT_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain',
  digest: 'f6ec1dc45d2714bac9e6059061c6ad66fdcf42899f846188860e5d1a11650d71', sizeBytes: 29,
  source: { kind: 'workspace', refId: 'r4c-claim-workspace', revision: '1' },
};

/** The whole role interval, hand-written; the stale-files reminder ends it. */
const ROLE_TEXT = '## Runtime context\n'
  + '## Runtime binding\n'
  + 'roleBinding: {"policyRevision":"legacy-template","tools":["read"],"writeScope":[]}\n'
  + 'tools: read\n'
  + 'writeScope: (none)\n'
  + '\n'
  + '## Role specification\n'
  + 'role: builder@1\n'
  + 'label: WP2 platform role\n'
  + 'purpose: WP2_PLATFORM_DUTY_PIN\n'
  + 'responsibility: human_decision_support\n'
  + 'required materials: contract (Read the assigned Plan/Task)\n'
  + 'required outputs: answer-with-sources (Report the actual result)\n'
  + 'exit success: Report result\n'
  + 'exit stop: Stop on missing permission\n'
  + 'exit handoff: Keep references\n'
  + '\n'
  + 'duty: secretary\n'
  + '\n'
  + 'contextResidentBytes: 0\n'
  + REMINDER;

/** The whole goal interval, hand-written. */
const GOAL_TEXT = '## Goal\n'
  + 'goal: r4c-claim-goal\n'
  + 'objective: Exercise the atomic claim skeleton\n'
  + 'workspace: r4c-claim-workspace@1\n'
  + 'autonomy: after_plan_confirmation\n'
  + 'current understanding: 目标 r4c-claim-goal：还没有当前理解';

/** The whole new-Task interval, hand-written; budget 0 puts the omission counts here. */
const TASK_TEXT = '## Accepted task\n'
  + 'task: J-08 inputs (pc2-j08-inputs)\n'
  + 'instruction: Exercise the J-08 input section\n'
  + 'plan: pc2-j08-input-plan\n'
  + 'workspace: r4c-claim-workspace@1\n'
  + 'definitionPlan: pc2-j08-input-plan@2\n'
  + 'stage: (未声明)\n'
  + 'module: (未声明)\n'
  + 'requirementLevel: required\n'
  + 'disposition: active\n'
  + 'phase: running\n'
  + 'obligations: 未定义\n'
  + 'acceptance: 未定义\n'
  + 'upstream: [{"consumer":{"goalId":"r4c-claim-goal","projectId":"r4c-claim-project","taskId":"pc2-j08-inputs"},"declarationId":"legacy:pc2-j08-input-1","legacyArtifactRef":{"contentType":"text/plain","digest":"f6ec1dc45d2714bac9e6059061c6ad66fdcf42899f846188860e5d1a11650d71","kind":"artifact","sizeBytes":29,"source":{"kind":"workspace","refId":"r4c-claim-workspace","revision":"1"}},"planRef":{"aggregateType":"PlanRevision","planId":"pc2-j08-input-plan","projectId":"r4c-claim-project"},"requires":{"kind":"artifact","label":"pc2-j08-input-1"},"upstream":null}]\n'
  + 'downstream: null\n'
  + 'failure: null\n'
  + '\n'
  + '## Context omissions\n'
  + 'notes: 另有 1 条，用‘看’读\n'
  + 'reminders: 另有 3 条，用‘看’读\n'
  + 'inputs: 另有 1 条，用‘看’读';

/** The brief body, hand-written; the public Run/round ids are its two tokens. */
const BRIEF_BODY = `[continuation-brief v1 sha256:<brief-digest>]
这是任务 pc2-j08-inputs 的接续执行（返工）：第 1 次重新入队，失败类别：检查不完整，发起方：人工。
接续方式：在同一 Session session-745d82aab121011f9bdab7c9ab2507b971e7333d620d59edaa7baf706d13fb00 中继续，上一次的对话历史仍在。

### 上一次执行
- 执行 <previous-run-id>（Session session-745d82aab121011f9bdab7c9ab2507b971e7333d620d59edaa7baf706d13fb00）依据执行记录以 completed 结束。
- 结束时间：2026-09-26T00:00:00.000Z。

### 停在哪里
- 执行记录读到位置 13，Turn 状态：completed。
- 最后的助手输出：PC2 J-08 input task answer
- 读取的记录范围：位置 8–13。

### 工具调用
- 执行记录中没有工具调用。

### 检查
- 轮次 <round-id>（第 1 轮）未通过的检查：无
- 缺口：source_changed、uncovered_requirement

### 重新入队
- 原因（人工）：Continue PC work
- 新输入：材料 text/plain; charset=utf-8 sha256:2fd8fff321f4ddeef590f40f36b04f1363dbe8427fa90cc1d3b4d1f42e5162f9：Continue PC work

### 工作区
- 上一次执行经工具改动的文件（完整）：无
- 上一次执行结束（2026-09-26T00:00:00.000Z）到“检查轮次开始”之间：无法从持久记录确定是否有改动。
- 检查轮次开始 → 重新入队：有变化（具体文件无法从持久记录确定）
- 重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）
- 工作区不是 git 仓库，未提交的改动无法列出。

### 继续之前
- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。
- “没有执行”的工具调用没有产生结果，需要时重新发起。
- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。`;

/** The whole current input, hand-written. The three tokens come from public reads. */
const CURRENT_INPUT = '# Verified runtime task input\n'
  + '\n'
  + 'This is the current task context assembled from formal platform facts; it is not a transcript.\n'
  + '\n'
  + ROLE_TEXT + '\n'
  + '\n'
  + GOAL_TEXT + '\n'
  + '\n'
  + TASK_TEXT + '\n'
  + '\n'
  + '## 接续说明\n'
  + BRIEF_BODY;

const EMPTY_SKILLS = { resourceRoot: '/nonexistent/pc2-j08', enabledIds: [] as string[] };

type Section = PreparedTaskManifestV1['contextAssembly']['sections'][number];

function sectionText(input: string, section: Section): string {
  if (section.startByte === null || section.endByte === null) return '';
  return Buffer.from(input, 'utf8').subarray(section.startByte, section.endByte).toString('utf8');
}

function reminderCount(text: string): number {
  return text.split(REMINDER).length - 1;
}

/** The last message's content; the current input a started request handed to the model. */
function currentInputOf(request: ModelRequest): string {
  const last = request.messages.at(-1);
  if (last === undefined || !('content' in last)) throw new Error('PC2 J-08: the request has no content message');
  return last.content;
}

async function frozenManifest(
  fixture: Awaited<ReturnType<typeof openPCWorkFixture>>,
  prepared: { envelope: { bundleRef: ArtifactRef } },
): Promise<PreparedTaskManifestV1> {
  const read = await fixture.base.platform.materials.openArtifact(fixture.base.ctx, {
    ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
  });
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return JSON.parse(read.value.body) as PreparedTaskManifestV1;
}

/** Close one verification round with an empty check list, as the current test does. */
async function closeInconclusiveRound(
  fixture: Awaited<ReturnType<typeof openPCWorkFixture>>,
  runRef: RunRef, subject: TaskTriple, planRef: PlanRevisionRef, suffix: string,
): Promise<string> {
  fixture.base.platform.registerCheckConfiguration({ configuration: {
    configurationRevision: `pc2-j08-checks-${suffix}@1`,
    workspace: fixture.base.fixture.workspaceRef,
    executor: { kind: 'human', id: 'r4c-claim-operator' },
    permissionRevision: 'wp2-workspace-read@1',
    sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [],
  } });
  const round = await fixture.base.platform.evidence.openVerification(fixture.base.ctx, {
    input: { subjectRunRef: runRef, subject, planRef },
    meta: { requestId: `pc2-j08-open-${suffix}`, expected: [] },
  });
  expect(round.status, JSON.stringify(round)).toBe('committed');
  if (round.status !== 'committed') throw new Error(JSON.stringify(round));
  const finalized = await fixture.base.platform.evidence.finalizeChecks(fixture.base.ctx, {
    input: { roundRef: round.value.ref },
    meta: { requestId: `pc2-j08-final-${suffix}`, expected: [
      { ref: round.value.ref, revision: round.value.revision },
    ] },
  });
  expect(finalized.status, JSON.stringify(finalized)).toBe('committed');
  if (finalized.status !== 'committed') throw new Error(JSON.stringify(finalized));
  expect(finalized.value.snapshot.outcome).toBe('INCONCLUSIVE');
  return round.value.ref.roundId;
}

describe('PC2 J-08: a zero resident budget omits every present optional section in the real continuation', () => {
  it('prepares and starts a same-Session continuation with a real input section wholly omitted', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { text: 'PC2 J-08 first answer' },
        { text: 'PC2 J-08 input task answer' },
        { text: 'PC2 J-08 continuation answer' },
      ]),
      contextResidentBytes: 0,
      systemInstruction: null,
      skills: EMPTY_SKILLS,
    });
    try {
      // Keep the existing Task and complete its first Run.
      await fixture.work.prepare();
      const firstStart = await fixture.work.start();
      expect(firstStart.status, JSON.stringify(firstStart)).toBe('ready');
      if (firstStart.status !== 'ready') return;
      expect(firstStart.value.run.status).toBe('ended');
      expect(firstStart.value.run.outcome).toBe('completed');
      await closeInconclusiveRound(fixture, fixture.work.runRef, fixture.base.claim!.task,
        fixture.base.claim!.planRef, 'first');

      // The accepted Plan through the public read, plus one exact input Artifact.
      const graph = await fixture.base.platform.plans.queryTaskGraph(fixture.base.ctx, {
        goalRef: fixture.base.goalRef,
      });
      expect(graph.status, JSON.stringify(graph)).toBe('ready');
      if (graph.status !== 'ready') return;
      const plan = graph.value.plan;
      const stored = await fixture.base.platform.materials.storeArtifact(fixture.base.ctx, {
        contentType: INPUT_MATERIAL_CONTENT_TYPE,
        body: INPUT_MATERIAL,
        sources: [{ kind: 'workspace', refId: fixture.base.fixture.workspaceRef.workspaceId, revision: '1' }],
        origin: {
          kind: 'platform_operation', projectId: fixture.base.scope.projectId,
          workspaceId: fixture.base.scope.workspaceId, requestId: 'pc2-j08-input-material',
          actor: { kind: 'human', id: 'r4c-claim-operator' },
        },
      });
      expect(stored.status, JSON.stringify(stored)).toBe('stored');
      if (stored.status !== 'stored') return;
      expect(stored.ref).toEqual(INPUT_REF);

      const draft: PlanRevisionDraft = {
        schemaVersion: 2,
        planId: NEW_PLAN_ID,
        planRevision: plan.planRevision + 1,
        goalId: plan.goalRef.goalId,
        stages: structuredClone(plan.stages),
        tasks: [...structuredClone(plan.tasks), {
          taskId: NEW_TASK_ID, title: 'J-08 inputs', requirementLevel: 'required',
          taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
          executionIntent: 'request_execution',
        }],
        assignments: [...structuredClone(plan.assignments ?? []), {
          taskId: NEW_TASK_ID, role: 'builder', instruction: 'Exercise the J-08 input section',
        }],
        obligations: structuredClone(plan.obligations),
        taskHierarchy: structuredClone(plan.taskHierarchy),
        executionDag: structuredClone(plan.executionDag),
        taskRelations: structuredClone(plan.taskRelations ?? []),
        ...(plan.reviewAdmissionProtocol === undefined ? {} : { reviewAdmissionProtocol: plan.reviewAdmissionProtocol }),
        ...(plan.origin === undefined ? {} : { origin: structuredClone(plan.origin) }),
        inputRequirements: [...structuredClone(plan.inputRequirements ?? []), {
          requirementId: NEW_REFERENCE, consumerTaskId: NEW_TASK_ID,
          kind: 'artifact', artifactRef: INPUT_REF,
        }],
      };
      const goalBefore = await fixture.base.platform.plans.queryGoal(fixture.base.ctx, fixture.base.goalRef);
      if (goalBefore.status !== 'ready') throw new Error(JSON.stringify(goalBefore));
      const expected = [{ ref: fixture.base.goalRef, revision: goalBefore.value.goal.revision }];
      const proposed = await fixture.base.platform.plans.proposePlan(fixture.base.ctx, {
        input: { goalRef: fixture.base.goalRef, basedOn: plan.ref, draft, reason: { text: 'J-08 append input task', sources: [] } },
        meta: { requestId: 'pc2-j08-propose', expected },
      });
      expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
      if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
        throw new Error(`PC2 J-08 proposal: ${JSON.stringify(proposed)}`);
      }
      const applied = await fixture.base.platform.plans.applyPlanChange(fixture.base.ctx, {
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
        meta: { requestId: 'pc2-j08-apply', expected },
      });
      expect(applied.status, JSON.stringify(applied)).toBe('committed');
      if (applied.status !== 'committed') throw new Error(JSON.stringify(applied));
      const newPlanRef = applied.value.ref;

      // Claim and actually prepare/start the new Task on the same Session.
      const sessionRef = fixture.base.claim!.sessionRef;
      const newRunRef = await claimSuccessorRun(fixture.base, fixture.base.goalRef, NEW_TASK_ID,
        sessionRef, 'pc2-j08-claim-input', newPlanRef);
      const preparedNew = await fixture.runtime.prepareExecution(fixture.base.ctx, {
        runRef: newRunRef, requestId: 'pc2-j08-prepare-input',
      });
      expect(preparedNew.status, JSON.stringify(preparedNew)).toBe('ready');
      if (preparedNew.status !== 'ready') return;
      const startedNew = await fixture.runtime.startRun(fixture.base.ctx, {
        prepared: preparedNew.value, consumerId: 'pc2-j08-input-consumer', requestId: 'pc2-j08-start-input',
      });
      expect(startedNew.status, JSON.stringify(startedNew)).toBe('ready');
      if (startedNew.status !== 'ready') return;
      expect(startedNew.value.run.status).toBe('ended');
      expect(startedNew.value.run.outcome).toBe('completed');

      // One public note anchored to the new Task keeps the `notes` row real.
      const note = await fixture.base.platform.notes.writeNote(fixture.base.ctx, {
        commandId: 'pc2-j08-inputs-note',
        note: {
          anchor: { kind: 'task', goalId: fixture.base.goalRef.goalId, taskId: NEW_TASK_ID },
          extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
          coexistWith: [], kind: 'pitfall', topic: 'pc2-j08-inputs', conclusion: NOTE_CONCLUSION,
          body: 'J-08 inputs note body',
        },
        expectedPointerRevision: null,
        goalId: fixture.base.goalRef.goalId,
      });
      expect(note.status, JSON.stringify(note)).toBe('accepted');

      const newTask = { ...fixture.base.claim!.task, taskId: NEW_TASK_ID };
      const inputRoundId = await closeInconclusiveRound(fixture, newRunRef, newTask, newPlanRef, 'input');

      // Requeue the new Task and claim its same-Session successor.
      const prior = await fixture.base.platform.executions.readExecution(fixture.base.ctx, newRunRef);
      if (prior.status !== 'ready') throw new Error(JSON.stringify(prior));
      const goalNow = await fixture.base.platform.plans.queryGoal(fixture.base.ctx, fixture.base.goalRef);
      if (goalNow.status !== 'ready') throw new Error(JSON.stringify(goalNow));
      const requeued = await fixture.base.platform.claims.requeueTask!(fixture.base.ctx, {
        input: { taskRef: newTask, afterRunRef: newRunRef, reason: 'Continue PC work', note: 'Continue PC work' },
        meta: { requestId: 'pc2-j08-requeue-input', expected: [
          { ref: fixture.base.goalRef, revision: goalNow.value.goal.revision },
          { ref: newRunRef, revision: prior.value.run.revision },
        ] },
      });
      expect(requeued.status, JSON.stringify(requeued)).toBe('committed');
      if (requeued.status !== 'committed') return;
      if (requeued.value.kind !== 'requeued') throw new Error(JSON.stringify(requeued.value));
      const continuationRef = await claimSuccessorRun(fixture.base, fixture.base.goalRef, NEW_TASK_ID,
        sessionRef, 'pc2-j08-claim-continuation', newPlanRef, requeued.value.requeue.ref);

      // Really prepare the continuation and read its frozen manifest.
      const prepared = await fixture.runtime.prepareExecution(fixture.base.ctx, {
        runRef: continuationRef, requestId: 'pc2-j08-prepare-continuation',
      });
      expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
      if (prepared.status !== 'ready') return;
      const manifest = await frozenManifest(fixture, prepared.value);

      expect(manifest.takesSessionHistory).toBe(true);

      const sections = manifest.contextAssembly.sections;
      expect(sections.map((section) => section.name))
        .toEqual(['role', 'goal', 'task', 'notes', 'inputs', 'continuation', 'reminders']);
      // Every optional section that has rows is WHOLLY omitted, with its
      // hand-computed row count; footprint has no rows and so no section.
      expect(sections.filter((section) => section.startByte === null).map((section) => ({
        name: section.name, endByte: section.endByte, omitted: section.omitted,
      }))).toEqual([
        { name: 'notes', endByte: null, omitted: 1 },
        { name: 'inputs', endByte: null, omitted: 1 },
        { name: 'reminders', endByte: null, omitted: 3 },
      ]);
      expect(sections.map((section) => section.name)).not.toContain('footprint');
      // The input requirement reached the public preparation: one selected
      // exact input, and the future footprint projection still emits nothing.
      expect(manifest.selectedTaskInputs).toEqual([
        { requirementId: NEW_REFERENCE, ref: INPUT_REF },
      ]);
      expect(manifest.contextAssembly.extensions.footprint).toBe('not_implemented');
      expect(sections.find((section) => section.name === 'footprint')).toBeUndefined();

      const role = sections.find((section) => section.name === 'role');
      const task = sections.find((section) => section.name === 'task');
      if (role === undefined || task === undefined) throw new Error('PC2 J-08: required sections are missing');
      const roleText = sectionText(manifest.input, role);
      expect(roleText).toBe(ROLE_TEXT);
      expect(roleText.endsWith(`\n${REMINDER}`)).toBe(true);
      expect(reminderCount(roleText)).toBe(1);
      // Role-end, not merely somewhere: the only copy is inside the role range.
      expect(reminderCount(manifest.input)).toBe(1);
      expect(sectionText(manifest.input, task)).toBe(TASK_TEXT);
      // The omitted note/input bodies are not smuggled into the omission block.
      expect(manifest.input).not.toContain(NOTE_CONCLUSION);
      expect(manifest.input).not.toContain(INPUT_MATERIAL);
      expect(manifest.input).not.toContain('## Note index');
      expect(manifest.input).not.toContain('## Selected inputs');
      expect(manifest.input).not.toContain('## Reminders');
      expect(manifest.contextAssembly.residentBudgetBytes).toBe(0);
      expect(manifest.contextAssembly.residentBytes).toBe(0);

      // The started request carries the whole literal, with the public brief
      // digest and the public round id filled in.
      const started = await fixture.runtime.startRun(fixture.base.ctx, {
        prepared: prepared.value, consumerId: 'pc2-j08-continuation-consumer',
        requestId: 'pc2-j08-start-continuation',
      });
      expect(started.status, JSON.stringify(started)).toBe('ready');
      if (started.status !== 'ready') return;
      const brief = await fixture.base.platform.runtime.readContinuationBrief!(fixture.base.ctx, {
        runRef: continuationRef,
      });
      expect(brief.status, JSON.stringify(brief)).toBe('ready');
      if (brief.status !== 'ready' || brief.value === null) throw new Error(JSON.stringify(brief));
      const request = fixture.model.requests.at(-1)!;
      const currentInput = currentInputOf(request);
      const filled = CURRENT_INPUT
        .replace('<brief-digest>', brief.value.digest)
        .replace('<previous-run-id>', newRunRef.runId)
        .replace('<round-id>', inputRoundId);
      expect(currentInput).toBe(filled);
      const startedRole = sectionText(currentInput, role);
      expect(startedRole).toBe(ROLE_TEXT);
      expect(startedRole.endsWith(`\n${REMINDER}`)).toBe(true);
      expect(reminderCount(currentInput)).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
