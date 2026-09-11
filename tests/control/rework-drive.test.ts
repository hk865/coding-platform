import { resolvePlanningWorkIdentities } from '../../src/control/plan-compiler/planning-work-materials.js';
import { composeReworkDrive } from '../../src/harness/rework-composition.js';
/**
 * RW-06 返工触发驱动：确定性、幂等、可解释。
 *
 * 覆盖：真实 FAIL → 每个任务分组编译提案 → 交 RW-04 四条边界受理 → 结构化结果；
 * 边界不成立时停在 needs_human_decision 且零写入；人显式拒绝后不再自动受理；
 * 重复触发不产生第二份提案或第二个 revision；受理后原问题随 revision 推进变成 superseded；
 * 只读视图由 canonical 事实重建（SQLite 重启后一致）。
 *
 * 全部通过真实入口：未处置问题来自**真实** VerificationOpenIssues 投影（真实 journal 记录与
 * 真实已接纳证据），提案来自 RW-03 的真实编译器，受理来自 ControlEngine 的真实入口，
 * 账本是真实的 InMemory／SQLite StateLedger。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReworkCoordination } from '../../src/contracts/execution-feedback.js';
import { ExecutionFeedbackCompiler } from '../../src/control/plan-compiler/execution-feedback-compiler.js';
import { ReworkPlanCompiler } from '../../src/control/plan-compiler/rework-plan-compiler.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { QueryJobSnapshot, QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import { buildP109Answer, buildP109Intent, buildP109Job } from '../contract-support/fixtures/query-job-fixtures.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import { reworkTaskIdFor } from '../../src/contracts/rework/proposal.js';
import type { CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { decisionTargetFor } from '../../src/contracts/goal-change.js';
import { buildRecordUserDecisionCommand } from '../contract-support/fixtures/goal-change-fixtures.js';
import { P115_COORDINATION_POLICY_CONTENT } from '../contract-support/fixtures/human-role-collaboration-fixtures.js';
import { ReworkDriveEngine } from '../../src/control/dispatch-engine/rework-drive.js';
import {
  FIXED,
  RW04_GOAL,
  RW04_OBLIGATION,
  RW04_PROJECT,
  RW04_REQUIREMENT,
  RW04_VERIFY_TASK,
  RW04_WORKSPACE,
  activateCoordinationPolicy,
  admitConclusion,
  compileProposal,
  engineFor,
  loadActivePlan,
  loadGoal,
  loadPlan,
  memoryLedger,
  prepareScope,
  sqliteLedger,
  type Ledger,
} from './autonomous-rework-fixture.js';
import { appendFailRound, openJournalPort, type JournalPort } from './rework-drive-fixture.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Engine = ReturnType<typeof engineFor>;
type Scope = { ledger: Ledger; engine: Engine; goal: GoalSnapshot; plan: PlanRevisionSnapshot };

const request = { schemaVersion: 1 as const, projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL };
const issueRequest = { schemaVersion: 1 as const, projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL, taskIds: [] };

const policyContent = (budget: number): CoordinationPolicyContentV1 => ({
  ...P115_COORDINATION_POLICY_CONTENT,
  budget: { ...P115_COORDINATION_POLICY_CONTENT.budget, maxAutonomousReworks: budget },
});

async function setup(options: { ledger?: Ledger; budget?: number; activatePolicy?: boolean } = {}): Promise<Scope> {
  const ledger = options.ledger ?? memoryLedger();
  const engine = engineFor(ledger);
  await prepareScope(ledger, RW04_PROJECT);
  if (options.activatePolicy !== false) await activateCoordinationPolicy(engine, RW04_PROJECT, policyContent(options.budget ?? 1));
  const goal = await loadGoal(ledger, RW04_PROJECT);
  return { ledger, engine, goal, plan: await loadActivePlan(ledger, goal, RW04_PROJECT) };
}

/** 真实 journal 目录 + 真实投影；current() 是间接引用，重启换掉 ledger 后语义不变。 */
async function journalPort(current: () => Ledger): Promise<JournalPort> {
  const directory = await mkdtemp(join(tmpdir(), 'rw06-journal-'));
  directories.push(directory);
  return openJournalPort({ directory, current });
}

/** 一条真实的 FAIL 轮次 + 一条真实已提交结论（两者身份一致：边界 (a) 复核的就是它）。 */
async function failOnce(input: {
  journal: JournalPort['journal'];
  engine: Engine;
  ledger: Ledger;
  plan: PlanRevisionSnapshot;
  taskId: string;
  obligationId: string;
  requirementId: string;
  kind: 'static' | 'dynamic';
  checkId: string;
  evidenceId: string;
  requestId: string;
  withoutCheckRecord?: boolean;
}): Promise<void> {
  await appendFailRound({
    journal: input.journal,
    scope: { projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL, runId: 'run-rw06-' + input.taskId, taskId: input.taskId },
    plan: input.plan,
    sourceDigest: 'source-digest-' + input.requestId,
    check: { checkId: input.checkId, command: 'pnpm test', obligationId: input.obligationId, requirementId: input.requirementId, kind: input.kind },
    ...(input.withoutCheckRecord === true ? { withoutCheckRecord: true } : {}),
    evidenceId: input.evidenceId,
    requestId: input.requestId,
  });
  await admitConclusion(input.engine, input.ledger, {
    plan: input.plan,
    taskId: input.taskId,
    obligationId: input.obligationId,
    requirementId: input.requirementId,
    outcome: 'FAIL',
    evidenceId: input.evidenceId,
  });
}

const reviseCount = async (ledger: Ledger) =>
  (await ledger.events({ afterCursor: null, limit: 10000 })).events.filter((entry) => entry.event.eventType === 'PlanRevisionAccepted').length;

/**
 * RC-01 的账本判据：当前 revision 里承担该义务的 **active** 任务。
 * 空数组就等于"这个义务没有承担者"——失败义务凭空消失就是这么被发现的，
 * 因此多失败场景必须逐条断言它非空（而不是只看"受理了几个分组"）。
 */
function activeCarriers(plan: PlanRevisionSnapshot, obligationId: string): string[] {
  const obligation = plan.obligations.find((entry) => entry.obligationId === obligationId);
  if (obligation === undefined) return [];
  return obligation.taskIds
    .filter((taskId) => plan.tasks.find((task: RuntimeTask) => task.taskId === taskId)?.disposition === 'active')
    .sort();
}

describe('RW-06 返工触发驱动', () => {
  it.each(['exact', 'digest', 'instruction', 'run_binding'] as const)('Control 复核已加载协调答案的 %s 绑定（只读 Query 快照 seam）', async mutation => {
    const scope = await setup();
    const port = await journalPort(() => scope.ledger);
    await failOnce({ journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'binding', evidenceId: 'ev-binding', requestId: 'round-binding' });
    const issues = await port.port(issueRequest);
    if (issues.status !== 'ready') throw Error('expected real FAIL');
    const queryRef = { aggregateType: 'QueryJob' as const, projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, queryJobId: 'binding-query' };
    const runRef = { ...queryRef, aggregateType: 'QueryRun' as const, runId: 'binding-run' };
    const answerRef = { ...queryRef, aggregateType: 'QueryJobAnswer' as const, answerId: 'binding-answer' };
    const answer = { ...buildP109Answer(runRef), answerId: answerRef.answerId, queryJobRef: queryRef,
      answer: JSON.stringify({ kind: 'feedback_resolution', action: 'adjust_plan', availability: 'available',
        summary: '规则调查完成', material: '按当前规则修复实现并重跑失败验证。', sourcePaths: ['RULES.md'] }),
      sources: [{ kind: 'workspace_read', refKey: 'RULES.md', version: 'd'.repeat(64), label: 'Read RULES.md' }] };
    const workspace = await scope.ledger.load({ aggregateType: 'Workspace', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE });
    if (workspace.status !== 'found') throw Error('workspace missing');
    const intent = buildP109Intent({ projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL,
      execution: { kind: 'execution_coordination', runtimeBudget: DEFAULT_RUNTIME_BUDGET,
        roleBinding: { schemaVersion: 1, bindingId: 'binding', templateId: 'planner', templateRevision: '1', bindingVersion: 1, policyRevision: 'read-only' },
        feedback: { taskId: RW04_VERIFY_TASK, runRef: { aggregateType: 'Run', projectId: RW04_PROJECT, goalId: RW04_GOAL, runId: 'source-run' },
          planRef: scope.plan.ref, workspaceRevision: workspace.snapshot.revision, reportRef: answer.bodyRef!,
          failureIssueIds: issues.issues.map(i => i.issueId), sourcePin: { schemaVersion: 1, projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
            sourceSet: { kind: 'workspace_paths', paths: ['RULES.md'] }, identity: { workspace: '/fixture', commit: null }, manifestDigest: 'd'.repeat(64) } } } });
    const jobSnapshot: QueryJobSnapshot = { ref: queryRef, schemaVersion: 1, revision: 2,
      job: { ...buildP109Job(intent, runRef), ...queryRef, status: 'answered', answerRefs: [answerRef] } };
    const answerSnapshot: QueryJobAnswerSnapshot = { ref: answerRef, schemaVersion: 1, revision: 1, answer };
    const row: ReworkCoordination = { taskId: RW04_VERIFY_TASK, issueIds: issues.issues.map(i => i.issueId), answerRef,
      answerDigest: sha256Hex(answer.answer), instruction: '按当前规则修复实现并重跑失败验证。' };
    if (mutation === 'digest') row.answerDigest = '0'.repeat(64);
    if (mutation === 'instruction') row.instruction = '未被答案授权的另一条指令。';
    if (mutation === 'run_binding') answerSnapshot.answer.runRef = { ...runRef, runId: 'another-run' };
    // Only Query reads are injected. FAIL evidence, plan compilation, Control guards,
    // policy budget and resulting writes use the actual existing ledger and engine.
    const load = scope.ledger.load.bind(scope.ledger);
    vi.spyOn(scope.ledger, 'load').mockImplementation(async ref => {
      if (ref.aggregateType === 'QueryJob' && ref.queryJobId === queryRef.queryJobId) return { status: 'found', snapshot: structuredClone(jobSnapshot) };
      if (ref.aggregateType === 'QueryJobAnswer' && ref.answerId === answerRef.answerId) return { status: 'found', snapshot: structuredClone(answerSnapshot) };
      return load(ref);
    });
    const compiled = new ReworkPlanCompiler().compile({ ...request, goalRef: scope.goal.ref, goalObjective: scope.goal.objective,
      activePlan: scope.plan, issues: issues.issues, coordination: row,
      workIdentities: await resolvePlanningWorkIdentities(request, scope.plan, scope.engine) });
    if (compiled.status !== 'proposal') throw Error(JSON.stringify(compiled));
    const before = await scope.ledger.events({ afterCursor: null, limit: 10000 });
    const receipt = await scope.engine.acceptReworkProposal({ schemaVersion: 1, proposal: compiled.proposal });
    if (mutation === 'exact') {
      expect(receipt.status, JSON.stringify(receipt)).toBe('accepted');
      expect(await reviseCount(scope.ledger)).toBe(2);
    } else {
      expect(receipt).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await scope.ledger.events({ afterCursor: null, limit: 10000 })).toEqual(before);
    }
  });

  it('调查已返回，但提交前来源验证失效：零受理、零计划写入，旧失败仍有承担者', async () => {
    const scope = await setup();
    const port = await journalPort(() => scope.ledger);
    await failOnce({ journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'source-race', evidenceId: 'ev-source-race', requestId: 'round-source-race' });
    const view = await port.port(issueRequest);
    if (view.status !== 'ready') throw Error('expected real FAIL material');
    const row: ReworkCoordination = { taskId: RW04_VERIFY_TASK, issueIds: view.issues.map(i => i.issueId),
      answerRef: { aggregateType: 'QueryJobAnswer', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
        queryJobId: 'source-race-query', answerId: 'source-race-answer' },
      answerDigest: 'a'.repeat(64), instruction: '修复失败行为并保留既有验收要求。' };
    // Context boundary is injected here; real source capture itself is covered by feedback authority tests.
    let current: ReworkCoordination | null = row;
    const compiler = new ExecutionFeedbackCompiler({ control: scope.engine, now: () => FIXED,
      materials: { jobs: async () => [], prepare: async () => null, failureResolution: async () => current } });
    expect(await compiler.failureResolution(row.answerRef.queryJobId)).toEqual(row);
    current = null;
    const validate = vi.spyOn(compiler, 'validate');
    const accept = vi.spyOn(scope.engine, 'acceptReworkProposal');
    const before = await scope.ledger.events({ afterCursor: null, limit: 10000 });
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port, coordination: compiler });
    const result = await drive.driveRework({ ...request, coordination: [row] });
    expect(result.outcomes).toMatchObject([{ status: 'rejected', code: 'coordination_stale' }]);
    expect(validate).toHaveBeenCalledExactlyOnceWith(row);
    expect(accept).not.toHaveBeenCalled();
    expect(await scope.ledger.events({ afterCursor: null, limit: 10000 })).toEqual(before);
    expect(activeCarriers(await loadActivePlan(scope.ledger, await loadGoal(scope.ledger)), RW04_OBLIGATION)).toEqual([RW04_VERIFY_TASK]);
  });

  it('一组缺协调材料时，其他独立组仍进入自己的来源复核与 Control 守卫', async () => {
    const scope = await setup({ budget: 2 });
    const port = await journalPort(() => scope.ledger);
    for (const [taskId, obligationId, requirementId, kind] of [
      ['task-install-contract', 'obl-1', 'vr-1', 'static'],
      [RW04_VERIFY_TASK, RW04_OBLIGATION, RW04_REQUIREMENT, 'dynamic'],
    ] as const) await failOnce({ journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId, obligationId, requirementId, kind, checkId: 'independent-' + taskId,
      evidenceId: 'ev-independent-' + taskId, requestId: 'round-independent-' + taskId });
    const view = await port.port(issueRequest);
    if (view.status !== 'ready') throw Error('expected real FAIL material');
    const row: ReworkCoordination = { taskId: RW04_VERIFY_TASK,
      issueIds: view.issues.filter(i => i.taskId === RW04_VERIFY_TASK).map(i => i.issueId),
      answerRef: { aggregateType: 'QueryJobAnswer', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
        queryJobId: 'independent-query', answerId: 'independent-answer' },
      answerDigest: 'b'.repeat(64), instruction: '修复独立任务的失败行为并保留验收要求。' };
    const validate = vi.fn(async () => true);
    const accept = vi.spyOn(scope.engine, 'acceptReworkProposal');
    const before = await scope.ledger.events({ afterCursor: null, limit: 10000 });
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port, coordination: { validate } });
    const result = await drive.driveRework({ ...request, coordination: [row] });
    expect(result.outcomes[0]).toMatchObject({ groupTaskId: 'task-install-contract', code: 'coordination_pending' });
    expect(validate).toHaveBeenCalledExactlyOnceWith(row);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]![0].proposal.coordination).toEqual(row);
    // Passing Dispatch's source seam cannot replace Control's canonical answer authority.
    expect(result.outcomes[1]).toMatchObject({ groupTaskId: RW04_VERIFY_TASK, origin: 'acceptance', code: 'invalid' });
    expect(await scope.ledger.events({ afterCursor: null, limit: 10000 })).toEqual(before);
  });

  it.each(['answerRef', 'answerDigest', 'instruction'] as const)('协调绑定 %s 被替换时，编译器拒绝提交前验证', async field => {
    const row: ReworkCoordination = { taskId: RW04_VERIFY_TASK, issueIds: ['issue-exact'],
      answerRef: { aggregateType: 'QueryJobAnswer', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
        queryJobId: 'exact-query', answerId: 'exact-answer' }, answerDigest: 'c'.repeat(64), instruction: '精确的修复指令' };
    const scope = await setup();
    const compiler = new ExecutionFeedbackCompiler({ control: scope.engine, now: () => FIXED,
      materials: { jobs: async () => [], prepare: async () => null, failureResolution: async () => row } });
    expect(await compiler.validate(structuredClone(row))).toBe(true);
    const changed = structuredClone(row);
    if (field === 'answerRef') changed.answerRef.answerId = 'another-answer';
    else changed[field] = 'different';
    expect(await compiler.validate(changed)).toBe(false);
  });

  it('真实 FAIL 之后：分组编译提案 → 四条边界受理 → 新 revision 生效、原任务 superseded、旧 revision 保留', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check', evidenceId: 'ev-rw06-1', requestId: 'rw06-round-1',
    });
    const issues = await port.port(issueRequest);
    expect(issues.status).toBe('ready');
    if (issues.status !== 'ready') return;
    expect(issues.issues).toHaveLength(1);
    const issue = issues.issues[0]!;
    expect(issue.taskId).toBe(RW04_VERIFY_TASK);
    expect(issue.currentness.status).toBe('open');

    const before = (await loadGoal(scope.ledger, RW04_PROJECT)).revision;
    const result = await drive.driveRework(request);
    expect(result.status, JSON.stringify(result)).toBe('driven');
    expect(result.outcomes).toHaveLength(1);
    const outcome = result.outcomes[0]!;
    expect(outcome.status, JSON.stringify(outcome)).toBe('accepted');
    if (outcome.status !== 'accepted') return;
    expect(outcome.groupTaskId).toBe(RW04_VERIFY_TASK);
    expect(outcome.issueIds).toEqual([issue.issueId]);
    expect(outcome.replayed).toBe(false);
    // 四条边界的逐条结论都随结果返回：受理不是"黑箱通过"。
    expect(outcome.boundaries.map((entry) => entry.code).sort()).toEqual([
      'autonomous_budget_available', 'in_scope_rework', 'no_human_rejection', 'trigger_source_committed',
    ]);
    expect(outcome.boundaries.every((entry) => entry.satisfied)).toBe(true);
    expect(outcome.budget).toMatchObject({ limit: 1, used: 0, remaining: 1 });
    expect(result.acceptedPlanRefs).toEqual([outcome.planRef]);

    // 新 revision 生效；原承担者退出默认可执行集合，返工任务接手同一批义务。
    const goal = await loadGoal(scope.ledger, RW04_PROJECT);
    expect(goal.revision).toBe(before + 1);
    expect(goal.activePlanRevision?.planId).toBe(outcome.planRef.planId);
    const newPlan = await loadPlan(scope.ledger, outcome.planRef.planId, RW04_PROJECT);
    const superseded = newPlan.tasks.find((task: RuntimeTask) => task.taskId === RW04_VERIFY_TASK)!;
    const reworkTaskId = reworkTaskIdFor(issue.issueId);
    expect(superseded.disposition).toBe('superseded');
    expect(superseded.replacedByTaskId).toBe(reworkTaskId);
    const replacement = newPlan.tasks.find((task: RuntimeTask) => task.taskId === reworkTaskId)!;
    expect(replacement.disposition).toBe('active');
    expect(replacement.phase).toBe('pending');
    // 旧 revision 原样保留（不可改写）。
    const oldPlan = await loadPlan(scope.ledger, scope.plan.planId, RW04_PROJECT);
    expect(oldPlan.tasks.some((task: RuntimeTask) => task.taskId === RW04_VERIFY_TASK)).toBe(true);
    expect(oldPlan.tasks.every((task: RuntimeTask) => task.disposition === 'active')).toBe(true);

    // 只读视图：提案与受理事实都由 canonical 来源重建。
    const view = await drive.reworkView(request);
    expect(view.proposal.status).toBe('not_compiled'); // 受理之后原问题不再属于当前 revision
    expect(view.issues.status).toBe('ready');
    if (view.issues.status === 'ready') expect(view.issues.issues[0]!.currentness.status).toBe('superseded');
    expect(view.acceptance.applied).toBe(true);
    expect(view.acceptance.appliedProposalId).toBe(outcome.proposalId);
    expect(view.acceptance.proposalRecorded).toBe(true);
    // 受理之后已经没有"当前 revision 的未处置问题"，因此没有可比较的推导结果：
    // 视图如实给 null，而不是把历史提案说成当下的推导（比较只在当前问题可推导时给出）。
    expect(view.acceptance.digestMatches).toBeNull();
    expect(view.acceptance.activePlanRef?.planId).toBe(outcome.planRef.planId);
  });

  it('重复触发与并发触发都幂等：不产生第二份提案或第二个 revision', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check', evidenceId: 'ev-rw06-idem', requestId: 'rw06-round-idem',
    });
    const first = await drive.driveRework(request);
    expect(first.outcomes[0]!.status).toBe('accepted');
    const revisions = await reviseCount(scope.ledger);
    const goalAfterFirst = await loadGoal(scope.ledger, RW04_PROJECT);

    const second = await drive.driveRework(request);
    expect(second.status).toBe('nothing_to_do');
    expect(second.outcomes).toEqual([]);
    expect(await reviseCount(scope.ledger)).toBe(revisions);
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).revision).toBe(goalAfterFirst.revision);

    // 并发触发由驱动内部队列串行化：两个触发看到的是同一份收敛后的事实。
    const [a, b] = await Promise.all([drive.driveRework(request), drive.driveRework(request)]);
    expect(a.status).toBe('nothing_to_do');
    expect(b.status).toBe('nothing_to_do');
    expect(await reviseCount(scope.ledger)).toBe(revisions);
  });

  it('一个触发里的多个任务分组：尚未处置的分组全部被接手，没有失败义务凭空消失（RC-01）', async () => {
    const scope = await setup({ budget: 2 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    // task-install-contract 承担 obl-1/vr-1；task-verify 承担 obl-2/vr-2。两条都是真实的失败结论。
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1',
      kind: 'static', checkId: 'rw06-check-install', evidenceId: 'ev-rw06-install', requestId: 'rw06-round-install',
    });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-verify', evidenceId: 'ev-rw06-verify', requestId: 'rw06-round-verify',
    });
    const before = await port.port(issueRequest);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    // 触发开始前两条问题都是"尚未处置"（anchor 就是当前 revision）。
    expect(before.issues.every((issue) => issue.disposition?.status === 'unaddressed')).toBe(true);
    const reworkByTask = new Map(before.issues.map((issue) => [issue.taskId, reworkTaskIdFor(issue.issueId)]));
    const issueIds = before.issues.map((issue) => issue.issueId).sort();

    const result = await drive.driveRework(request);
    expect(result.status).toBe('driven');
    // RC-01 的旧缺陷现场：第一个分组受理后，第二个分组被标成 superseded 而没有任何人接手。
    // 现在两个分组都必须被接手——一次触发把所有尚未处置的分组推进完。
    expect(result.outcomes.map((entry) => entry.status), JSON.stringify(result.outcomes)).toEqual(['accepted', 'accepted']);
    expect(result.outcomes.map((entry) => entry.groupTaskId)).toEqual(['task-install-contract', RW04_VERIFY_TASK]);
    // 每个分组各自一次受理、各自一个 revision（预算按 Goal 计数：两次受理用掉 2 次额度）。
    expect(result.acceptedPlanRefs).toHaveLength(2);
    expect(result.acceptedPlanRefs[1]!.planId).not.toBe(result.acceptedPlanRefs[0]!.planId);

    // 逐项交代：每一条失败都有明确归属（返工任务），且没有一项落在"既无归属也无阻塞"或"读不到"上。
    expect(result.dispositions.map((entry) => entry.issueId)).toEqual(issueIds);
    for (const trace of result.dispositions) {
      expect(trace.status, JSON.stringify(trace)).toBe('accepted_rework');
      const reworkTaskId = reworkByTask.get(trace.taskId)!;
      expect(trace.reworkTaskIds).toEqual([reworkTaskId]);
      expect(trace.carrierTaskIds, JSON.stringify(trace)).toContain(reworkTaskId);
      expect(trace.obligationIds.length).toBeGreaterThan(0);
    }
    expect(
      result.dispositions.filter((entry) => entry.status === 'unresolved' || entry.status === 'unknown'),
      JSON.stringify(result.dispositions),
    ).toEqual([]);

    // 账本判据（"没有义务凭空消失"）：新 revision 里两个原任务都退出执行并记录 replacedByTaskId，
    // 它们的每一项失败义务都由 active 的返工任务接手。
    const goal = await loadGoal(scope.ledger, RW04_PROJECT);
    const newPlan = await loadPlan(scope.ledger, goal.activePlanRevision!.planId, RW04_PROJECT);
    for (const [taskId, reworkTaskId] of reworkByTask) {
      const superseded = newPlan.tasks.find((task: RuntimeTask) => task.taskId === taskId)!;
      expect(superseded.disposition, taskId).toBe('superseded');
      expect(superseded.replacedByTaskId).toBe(reworkTaskId);
      expect(newPlan.tasks.find((task: RuntimeTask) => task.taskId === reworkTaskId)!.disposition).toBe('active');
    }
    for (const obligationId of ['obl-1', RW04_OBLIGATION]) {
      const carriers = activeCarriers(newPlan, obligationId);
      expect(carriers.length, obligationId + ' 在当前 revision 上没有 active 承担者').toBeGreaterThan(0);
      expect(carriers.some((taskId) => taskId.startsWith('rework-')), obligationId + ' 没有被返工任务接手').toBe(true);
    }

    // 旧 revision、旧 FAIL、旧报告与旧证据全部保留（返工不删除历史）。
    const oldPlan = await loadPlan(scope.ledger, scope.plan.planId, RW04_PROJECT);
    expect(oldPlan.tasks.every((task: RuntimeTask) => task.disposition === 'active')).toBe(true);
    expect(port.journal.rounds).toHaveLength(2);
    for (const evidenceId of ['ev-rw06-install', 'ev-rw06-verify']) {
      const loaded = await scope.ledger.load({ aggregateType: 'Evidence', projectId: RW04_PROJECT, evidenceId });
      expect(loaded.status, evidenceId).toBe('found');
    }
    // 恰好两个新 revision（初始计划 + 两次受理），后面的分组没有被伪造成额外的提案。
    expect(await reviseCount(scope.ledger)).toBe(3);

    // 重复触发：两条都已被处置，如实说明"被谁接手"，不产生第三个 revision。
    const again = await drive.driveRework(request);
    expect(again.status).toBe('nothing_to_do');
    expect(again.dispositions.map((entry) => entry.status)).toEqual(['disposed_by_rework', 'disposed_by_rework']);
    expect(await reviseCount(scope.ledger)).toBe(3);
    const view = await drive.reworkView(request);
    expect(view.proposal.status).toBe('not_compiled'); // 没有未处置问题了
    // 两次受理各自产生一个新 revision：身份重建只能对上最后一次，因此视图如实说明依据，
    // 而不是把它当成"没有生效"。
    expect(view.acceptance.applied).toBe(true);
    expect(view.acceptance.appliedBasis).toBe('rework_carrier');
    expect(view.issues.status).toBe('ready');
    if (view.issues.status === 'ready') {
      for (const issue of view.issues.issues) {
        expect(issue.disposition?.status, JSON.stringify(issue.disposition)).toBe('disposed_by_rework');
        expect(issue.disposition?.carrierTaskIds.some((taskId) => taskId.startsWith('rework-'))).toBe(true);
      }
    }
  });

  it('边界 (a) 不成立（覆盖缺失、没有结论）→ 停在 needs_human_decision 且零写入', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    // 轮次引用了检查身份，但没有留下检查记录：该要求"没有产生结论"（failure.result 为 null），
    // 覆盖缺失／没有结论不能作为自动返工的依据。
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check', evidenceId: 'ev-rw06-gap', requestId: 'rw06-round-gap',
      withoutCheckRecord: true,
    });
    const before = await loadGoal(scope.ledger, RW04_PROJECT);
    const beforeEvents = (await scope.ledger.events({ afterCursor: null, limit: 10000 })).events.length;

    const result = await drive.driveRework(request);
    expect(result.status).toBe('driven');
    const outcome = result.outcomes[0]!;
    expect(outcome.status, JSON.stringify(outcome)).toBe('needs_human_decision');
    if (outcome.status !== 'needs_human_decision') return;
    expect(outcome.origin).toBe('acceptance');
    expect(outcome.code).toBe('trigger_source_committed');
    expect(outcome.reasons.join(' ')).toContain('没有产生结论');
    expect(outcome.boundaries.some((entry) => entry.code === 'trigger_source_committed' && !entry.satisfied)).toBe(true);
    // 零写入：Goal revision、active plan 与事件流都没有变化。
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).revision).toBe(before.revision);
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).activePlanRevision?.planId).toBe(scope.plan.planId);
    expect((await scope.ledger.events({ afterCursor: null, limit: 10000 })).events.length).toBe(beforeEvents);
  });

  it('人显式拒绝这条问题之后，同一问题不再自动受理', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check', evidenceId: 'ev-rw06-reject', requestId: 'rw06-round-reject',
    });
    // 人走既有提案/决定路径对**这份**提案表态（reject）：actor 是人，不是 system。
    const issues = await port.port(issueRequest);
    expect(issues.status).toBe('ready');
    if (issues.status !== 'ready') return;
    const proposal = compileProposal(scope.goal, scope.plan, issues.issues, RW04_PROJECT, await resolvePlanningWorkIdentities(request, scope.plan, scope.engine));
    const recorded = await scope.engine.recordPlanChangeProposal({
      commandId: 'rw06-human-proposal', commandType: 'RecordPlanChangeProposal', schemaVersion: 1,
      identity: { projectId: RW04_PROJECT, actor: { kind: 'human', id: 'user-owner-1' }, idempotencyKey: 'rw06-human-proposal-idem' },
      aggregateId: proposal.proposalId, expectedRevision: 0, correlationId: 'rw06-human-proposal-corr', submittedAt: FIXED,
      payload: { proposal },
    });
    expect(recorded.status).toBe('committed');
    const decided = await scope.engine.recordUserDecision(
      buildRecordUserDecisionCommand(
        {
          schemaVersion: 1, decisionId: 'rw06-human-decision', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
          proposalRef: { aggregateType: 'PlanProposal', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, proposalId: proposal.proposalId },
          subject: { goalRef: scope.goal.ref, sourcePlanRef: scope.plan.ref, sourcePlanRevision: scope.plan.planRevision },
          outcome: 'reject', actor: { kind: 'human', id: 'user-owner-1' },
          authority: { strategy: 'user', delegator: null, policyVersion: 'user-decision-policy@1' },
          authorizedTarget: decisionTargetFor(proposal), summary: '人不接受这条返工', decidedAt: FIXED,
        },
        { commandId: 'rw06-human-decision-cmd' },
      ),
    );
    expect(decided.status).toBe('committed');

    const before = await loadGoal(scope.ledger, RW04_PROJECT);
    const result = await drive.driveRework(request);
    expect(result.status).toBe('driven');
    const outcome = result.outcomes[0]!;
    expect(outcome.status).toBe('needs_human_decision');
    if (outcome.status !== 'needs_human_decision') return;
    expect(outcome.code).toBe('no_human_rejection');
    expect(outcome.reasons.join(' ')).toContain('rw06-human-decision');
    // 转人工且零写入：没有第二个 revision。
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).revision).toBe(before.revision);
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).activePlanRevision?.planId).toBe(scope.plan.planId);
    // 只读视图仍然只有那一条已记录提案，且它与当前机械推导逐字一致（照原样交给人决定）。
    const view = await drive.reworkView(request);
    expect(view.proposal.status).toBe('proposal');
    expect(view.acceptance.proposalRecorded).toBe(true);
    expect(view.acceptance.digestMatches).toBe(true);
    expect(view.acceptance.applied).toBe(false);
  });

  it('没有治理授权时不套默认预算：受理被拒绝且可见，仍然零写入', async () => {
    const scope = await setup({ activatePolicy: false });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check', evidenceId: 'ev-rw06-gov', requestId: 'rw06-round-gov',
    });
    const before = await loadGoal(scope.ledger, RW04_PROJECT);
    const result = await drive.driveRework(request);
    const outcome = result.outcomes[0]!;
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.origin).toBe('acceptance');
    expect(outcome.code).toBe('governance_unavailable');
    expect(outcome.reasons.join(' ')).toContain('CoordinationPolicy');
    expect((await loadGoal(scope.ledger, RW04_PROJECT)).revision).toBe(before.revision);
    expect(await reviseCount(scope.ledger)).toBe(1);
  });

  it('问题出口不可用时明确回报 unavailable，不把读取失败当成"没有问题"', async () => {
    const ledger = memoryLedger();
    const engine = engineFor(ledger);
    const drive = composeReworkDrive({
      ledger,
      control: engine,
      issues: async () => ({ status: 'unavailable', code: 'unavailable', message: '投影未接线' }),
    });
    const result = await drive.driveRework(request);
    expect(result.status).toBe('unavailable');
    expect(result.outcomes).toEqual([]);
    expect(result.gaps.join(' ')).toContain('投影未接线');
    const view = await drive.reworkView(request);
    expect(view.issues.status).toBe('unavailable');
    expect(view.proposal.status).toBe('not_compiled');
    expect(view.acceptance.applied).toBe(false);
  });

  it('SQLite 重启后一致：多失败分组的处置事实与逐项交代都由持久／canonical 事实重建', async () => {
    const { ledger, directory, path } = await sqliteLedger();
    directories.push(directory);
    const scope = await setup({ ledger, budget: 2 });
    const holder: { current: Ledger } = { current: ledger };
    const port = await journalPort(() => holder.current);
    const drive = composeReworkDrive({ ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-restart-verify', evidenceId: 'ev-rw06-restart', requestId: 'rw06-round-restart',
    });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger, plan: scope.plan,
      taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1',
      kind: 'static', checkId: 'rw06-check-restart-install', evidenceId: 'ev-rw06-restart-install', requestId: 'rw06-round-restart-install',
    });
    const first = await drive.driveRework(request);
    expect(first.outcomes.map((entry) => entry.status)).toEqual(['accepted', 'accepted']);
    expect(first.dispositions.map((entry) => entry.status)).toEqual(['accepted_rework', 'accepted_rework']);
    const viewBefore = await drive.reworkView(request);
    expect(viewBefore.acceptance.applied).toBe(true);
    const revisionsBefore = await reviseCount(ledger);

    await ledger.close();
    const { SqliteStateLedger } = await import('../../src/data/state-ledger/sqlite-ledger.js');
    const reopened = new SqliteStateLedger({ path });
    try {
      holder.current = reopened;
      // 重启：journal 从磁盘重建（不是内存对象幸存），问题身份与失效标注必须一致。
      const reopenedPort = await openJournalPort({ directory: port.journal.directory, current: () => holder.current });
      expect(reopenedPort.journal.rounds).toHaveLength(2);
      expect(reopenedPort.journal.checks).toHaveLength(2);
      const reopenedDrive = composeReworkDrive({ ledger: reopened, control: engineFor(reopened), issues: reopenedPort.port });

      // 只读视图由 canonical／持久事实重建：重启前后逐字一致（含 RC-01 的处置事实与承担者）。
      const viewAfter = await reopenedDrive.reworkView(request);
      expect(viewAfter.issues).toEqual(viewBefore.issues);
      expect(viewAfter.acceptance).toEqual(viewBefore.acceptance);
      expect(viewAfter.proposal).toEqual(viewBefore.proposal);

      // 重触发仍然收敛：没有第二个 revision；"未处置的还剩什么"重启后照样答得出来。
      const again = await reopenedDrive.driveRework(request);
      expect(again.status).toBe('nothing_to_do');
      expect(again.dispositions.map((entry) => entry.status)).toEqual(['disposed_by_rework', 'disposed_by_rework']);
      expect(again.dispositions.every((entry) => entry.carrierTaskIds.some((taskId) => taskId.startsWith('rework-')))).toBe(true);
      expect(await reviseCount(reopened)).toBe(revisionsBefore);
    } finally {
      await reopened.close().catch(() => undefined);
    }
  });

  it('三个失败分组一次触发全部推进；中间分组用推进后的 revision 重新编译，不丢任何一条（RC-01）', async () => {
    const scope = await setup({ budget: 3 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    // obl-1 由 task-install-contract 与 task-accept-plan 共同承担；obl-2 由 task-verify 承担。
    // 三条都是真实的失败结论（各自的轮次与检查身份不同，因此是三条独立的未处置问题）。
    const failures = [
      { taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1', runId: 'run-install' },
      { taskId: 'task-accept-plan', obligationId: 'obl-1', requirementId: 'vr-1', runId: 'run-accept' },
      { taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT, runId: 'run-verify' },
    ];
    for (const failure of failures) {
      await failOnce({
        journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
        taskId: failure.taskId, obligationId: failure.obligationId, requirementId: failure.requirementId,
        kind: 'static', checkId: 'rw06-check-' + failure.runId, evidenceId: 'ev-rw06-' + failure.runId, requestId: 'rw06-round-' + failure.runId,
      });
    }
    const before = await port.port(issueRequest);
    if (before.status !== 'ready') throw new Error('expected ready');
    const reworkByTask = new Map(before.issues.map((issue) => [issue.taskId, reworkTaskIdFor(issue.issueId)]));

    const result = await drive.driveRework(request);
    expect(result.status).toBe('driven');
    // 分组顺序按 taskId 升序，三个都受理（预算 3 足够）。
    expect(result.outcomes.map((entry) => entry.status), JSON.stringify(result.outcomes)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(result.outcomes.map((entry) => entry.groupTaskId)).toEqual(['task-accept-plan', 'task-install-contract', RW04_VERIFY_TASK]);
    expect(result.acceptedPlanRefs).toHaveLength(3);
    // 每个提案都建立在**当时生效**的 revision 上：revision 逐次 +1，中间的分组不是拿旧快照推导的。
    const revisions: number[] = [];
    for (const ref of result.acceptedPlanRefs) revisions.push((await loadPlan(scope.ledger, ref.planId, RW04_PROJECT)).planRevision);
    expect(revisions).toEqual([2, 3, 4]);

    expect(result.dispositions.map((entry) => entry.status)).toEqual(['accepted_rework', 'accepted_rework', 'accepted_rework']);
    for (const trace of result.dispositions) {
      expect(trace.reworkTaskIds).toEqual([reworkByTask.get(trace.taskId)!]);
      expect(trace.carrierTaskIds, JSON.stringify(trace)).toContain(reworkByTask.get(trace.taskId)!);
    }

    // 三个原任务全部退出执行、义务全部有 active 承担者；obl-1 的两个承担者都被换掉后仍有人接。
    const plan = await loadPlan(scope.ledger, (await loadGoal(scope.ledger, RW04_PROJECT)).activePlanRevision!.planId, RW04_PROJECT);
    for (const taskId of ['task-install-contract', 'task-accept-plan', RW04_VERIFY_TASK]) {
      expect(plan.tasks.find((task: RuntimeTask) => task.taskId === taskId)!.disposition, taskId).toBe('superseded');
    }
    expect(activeCarriers(plan, 'obl-1')).toEqual([reworkByTask.get('task-accept-plan')!, reworkByTask.get('task-install-contract')!].sort());
    expect(activeCarriers(plan, RW04_OBLIGATION)).toEqual([reworkByTask.get(RW04_VERIFY_TASK)!]);
    expect(await reviseCount(scope.ledger)).toBe(4);
    expect((await drive.driveRework(request)).status).toBe('nothing_to_do');
  });

  it('预算只够一次时：一个分组被接手，另一个停在明确且可见的"等预算"上，义务仍有承担者（RC-01）', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1',
      kind: 'static', checkId: 'rw06-check-budget-install', evidenceId: 'ev-rw06-budget-install', requestId: 'rw06-round-budget-install',
    });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-budget-verify', evidenceId: 'ev-rw06-budget-verify', requestId: 'rw06-round-budget-verify',
    });

    const result = await drive.driveRework(request);
    expect(result.outcomes.map((entry) => entry.status)).toEqual(['accepted', 'needs_human_decision']);
    const blocked = result.outcomes[1]!;
    expect(blocked.groupTaskId).toBe(RW04_VERIFY_TASK);
    if (blocked.status !== 'needs_human_decision') return;
    expect(blocked.code).toBe('autonomous_budget_available');
    expect(blocked.budget).toMatchObject({ limit: 1, used: 1, remaining: 0 });
    expect(blocked.reasons.join(' ')).toContain('预算已耗尽');

    // 逐项交代：一个是明确归属，另一个是明确阻塞（等预算），没有第三种"消失"。
    const traces = new Map(result.dispositions.map((entry) => [entry.taskId, entry]));
    expect(traces.get('task-install-contract')!.status).toBe('accepted_rework');
    const waiting = traces.get(RW04_VERIFY_TASK)!;
    expect(waiting.status).toBe('awaiting_budget');
    expect(waiting.reasons.join(' ')).toContain('autonomous_budget_available');
    // 等预算不等于没有承担者：obl-2 仍由当前 revision 里 active 的 task-verify 承担。
    expect(waiting.carrierTaskIds).toEqual([RW04_VERIFY_TASK]);

    // 视图把两条轴分别表达："历史证据失效"（anchor 不是当前 revision）与"尚未处置"互不冒充。
    const view = await drive.reworkView(request);
    if (view.issues.status !== 'ready') throw new Error('expected ready');
    const pending = view.issues.issues.find((issue) => issue.taskId === RW04_VERIFY_TASK)!;
    expect(pending.currentness.status).toBe('superseded');
    expect(pending.currentness.issues.join(' ')).toContain('不再生效');
    expect(pending.disposition?.status).toBe('carried_by_task');
    expect(pending.disposition?.carrierTaskIds).toEqual([RW04_VERIFY_TASK]);
    // 它仍然可以推导返工提案：没有被当成"已处置"。
    expect(view.proposal.status).toBe('proposal');

    // 账本：只有一个新 revision，obl-2 的承担者没有消失。
    expect(await reviseCount(scope.ledger)).toBe(2);
    const plan = await loadPlan(scope.ledger, (await loadGoal(scope.ledger, RW04_PROJECT)).activePlanRevision!.planId, RW04_PROJECT);
    expect(activeCarriers(plan, RW04_OBLIGATION)).toEqual([RW04_VERIFY_TASK]);
    expect(activeCarriers(plan, 'obl-1').some((taskId) => taskId.startsWith('rework-'))).toBe(true);
  });

  it('人对一条问题的返工说过 no（defer）：它停在转人工，别的分组照常被接手，两者都可见（RC-01）', async () => {
    const scope = await setup({ budget: 2 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1',
      kind: 'static', checkId: 'rw06-check-human-install', evidenceId: 'ev-rw06-human-install', requestId: 'rw06-round-human-install',
    });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-human-verify', evidenceId: 'ev-rw06-human-verify', requestId: 'rw06-round-human-verify',
    });
    const issuesView = await port.port(issueRequest);
    if (issuesView.status !== 'ready') throw new Error('expected ready');
    const blockedIssue = issuesView.issues.find((issue) => issue.taskId === 'task-install-contract')!;
    // 人走既有提案/决定路径对**这一条问题**表态：defer 与 reject 同判据，都阻止自动受理。
    const proposal = compileProposal(scope.goal, scope.plan, [blockedIssue], RW04_PROJECT, await resolvePlanningWorkIdentities(request, scope.plan, scope.engine));
    const recorded = await scope.engine.recordPlanChangeProposal({
      commandId: 'rw06-human-defer-proposal', commandType: 'RecordPlanChangeProposal', schemaVersion: 1,
      identity: { projectId: RW04_PROJECT, actor: { kind: 'human', id: 'user-owner-1' }, idempotencyKey: 'rw06-human-defer-proposal-idem' },
      aggregateId: proposal.proposalId, expectedRevision: 0, correlationId: 'rw06-human-defer-proposal-corr', submittedAt: FIXED,
      payload: { proposal },
    });
    expect(recorded.status).toBe('committed');
    const decided = await scope.engine.recordUserDecision(
      buildRecordUserDecisionCommand(
        {
          schemaVersion: 1, decisionId: 'rw06-human-defer', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE,
          proposalRef: { aggregateType: 'PlanProposal', projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, proposalId: proposal.proposalId },
          subject: { goalRef: scope.goal.ref, sourcePlanRef: scope.plan.ref, sourcePlanRevision: scope.plan.planRevision },
          outcome: 'defer', actor: { kind: 'human', id: 'user-owner-1' },
          authority: { strategy: 'user', delegator: null, policyVersion: 'user-decision-policy@1' },
          authorizedTarget: decisionTargetFor(proposal), summary: '人要求先等一等', decidedAt: FIXED,
        },
        { commandId: 'rw06-human-defer-cmd' },
      ),
    );
    expect(decided.status).toBe('committed');

    const result = await drive.driveRework(request);
    expect(result.outcomes.map((entry) => entry.status)).toEqual(['needs_human_decision', 'accepted']);
    const stoppedOutcome = result.outcomes[0]!;
    if (stoppedOutcome.status !== 'needs_human_decision') return;
    expect(stoppedOutcome.code).toBe('no_human_rejection');
    expect(stoppedOutcome.reasons.join(' ')).toContain('rw06-human-defer');

    const traces = new Map(result.dispositions.map((entry) => [entry.taskId, entry]));
    expect(traces.get('task-install-contract')!.status).toBe('awaiting_human_decision');
    expect(traces.get('task-install-contract')!.reasons.join(' ')).toContain('rw06-human-defer');
    // 被拒的那一条仍有明确承担者（obl-1 的两个承担者都还在，且都还是 active），
    // 没有被静默当成已处置。
    expect(traces.get('task-install-contract')!.carrierTaskIds).toEqual(['task-accept-plan', 'task-install-contract']);
    expect(traces.get(RW04_VERIFY_TASK)!.status).toBe('accepted_rework');
    // 只发生了一次受理（被拒的那一组零写入）。
    expect(await reviseCount(scope.ledger)).toBe(2);
    const plan = await loadPlan(scope.ledger, (await loadGoal(scope.ledger, RW04_PROJECT)).activePlanRevision!.planId, RW04_PROJECT);
    expect(plan.tasks.find((task: RuntimeTask) => task.taskId === 'task-install-contract')!.disposition).toBe('active');
    expect(activeCarriers(plan, 'obl-1')).toEqual(['task-accept-plan', 'task-install-contract']);
  });


  it('原任务的要求已在推进后的 revision 上重验通过：标为"已重验通过"，不再重复返工（RC-01）', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: 'task-install-contract', obligationId: 'obl-1', requirementId: 'vr-1',
      kind: 'static', checkId: 'rw06-check-reverify-install', evidenceId: 'ev-rw06-reverify-install', requestId: 'rw06-round-reverify-install',
    });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-reverify-verify', evidenceId: 'ev-rw06-reverify-verify', requestId: 'rw06-round-reverify-verify',
    });
    // 预算 1：只够受理 install 那一组；verify 被明确阻塞（等预算），它的 anchor 随之失效。
    const first = await drive.driveRework(request);
    expect(first.outcomes.map((entry) => entry.status)).toEqual(['accepted', 'needs_human_decision']);
    const advanced = await loadGoal(scope.ledger, RW04_PROJECT);
    const advancedPlan = await loadPlan(scope.ledger, advanced.activePlanRevision!.planId, RW04_PROJECT);
    const waiting = await drive.reworkView(request);
    if (waiting.issues.status !== 'ready') throw new Error('expected ready');
    expect(waiting.issues.issues.find((issue) => issue.taskId === RW04_VERIFY_TASK)!.disposition?.status).toBe('carried_by_task');

    // 推进后的 revision 上真的把那条要求重验通过了（真实轮次记录 + 真实已提交结论）。
    await appendFailRound({
      journal: port.journal,
      scope: { projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL, runId: 'run-rw06-reverify-pass', taskId: RW04_VERIFY_TASK },
      plan: advancedPlan, sourceDigest: 'source-digest-rw06-pass',
      check: { checkId: 'rw06-check-reverify-pass', command: 'pnpm test', obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT, kind: 'dynamic', result: 'PASS' },
      evidenceId: 'ev-rw06-reverify-pass', requestId: 'rw06-round-reverify-pass',
    });
    await admitConclusion(scope.engine, scope.ledger, {
      plan: advancedPlan, taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      outcome: 'PASS', evidenceId: 'ev-rw06-reverify-pass',
    });

    // 视图把"已重验通过"与"历史证据失效"分开表达；重验通过之后不再重复返工（不制造多余的 revision）。
    const view = await drive.reworkView(request);
    if (view.issues.status !== 'ready') throw new Error('expected ready');
    const reverified = view.issues.issues.find((issue) => issue.taskId === RW04_VERIFY_TASK)!;
    expect(reverified.currentness.status).toBe('superseded');
    expect(reverified.disposition?.status).toBe('disposed_by_reverification');
    expect(reverified.disposition?.issues.join(' ')).toContain('重新验证通过');
    const again = await drive.driveRework(request);
    expect(again.status).toBe('nothing_to_do');
    expect(again.dispositions.map((entry) => entry.status).sort()).toEqual(['disposed_by_reverification', 'disposed_by_rework']);
    expect(await reviseCount(scope.ledger)).toBe(2);
  });

  it('并发触发：只受理一次，后一次如实报告"已经被谁接手"，不产生第二个 revision（RC-01）', async () => {
    const scope = await setup({ budget: 1 });
    const port = await journalPort(() => scope.ledger);
    const drive = composeReworkDrive({ ledger: scope.ledger, control: scope.engine, issues: port.port });
    await failOnce({
      journal: port.journal, engine: scope.engine, ledger: scope.ledger, plan: scope.plan,
      taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT,
      kind: 'dynamic', checkId: 'rw06-check-concurrent', evidenceId: 'ev-rw06-concurrent', requestId: 'rw06-round-concurrent',
    });
    const [a, b] = await Promise.all([drive.driveRework(request), drive.driveRework(request)]);
    const driven = a.status === 'driven' ? a : b;
    const idle = a.status === 'driven' ? b : a;
    expect([a.status, b.status].sort()).toEqual(['driven', 'nothing_to_do']);
    expect(driven.outcomes[0]!.status).toBe('accepted');
    // 第二次触发看到的已是"被接手的"问题：逐项交代说得出接手者，而不是空清单。
    expect(idle.dispositions.map((entry) => entry.status)).toEqual(['disposed_by_rework']);
    expect(idle.dispositions[0]!.carrierTaskIds.some((taskId) => taskId.startsWith('rework-'))).toBe(true);
    expect(await reviseCount(scope.ledger)).toBe(2);
  });
});
