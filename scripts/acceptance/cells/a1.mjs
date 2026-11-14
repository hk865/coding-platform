// A1 (1M window → 131072): its own Host and ledger (WA), the binding arrives after the start through settings
// (`models/save` → `models/select`), DeepSeek 1M only (`smoke-deepseek`, ruling 14:0x §9.6). The planning round is a
// Host system `action_request` whose budget is `planningRoundRuntimeBudget` (`host.ts:3006-3015`,
// `runtime-configuration.ts:135-142`). `goals/create` + `driver-start` alone never plans in this tree (no adopted Plan →
// `waiting`, `workflow.ts:2697-2699`), so the cell adopts a stage-scoped `plan_only` placeholder (the shape of
// `PL-forms-fixture.ts:402-411`); `select_work` then sends the `refine:` round to the Goal's adviser. Only request facts
// count (`queries/read` → `run.run.executionState.requests[]`, slice-9-SPEC.md:704-723); no configuration echo.
import { newId, ready } from '../lib/http.mjs';
import { Abort } from '../lib/report.mjs';
import { adoptArchitecture, chooseModel, createGoal, driverStart, ensurePolicy, lines, openProject, proposeAndApply,
  sessionQueries, sleep, waitFor } from '../lib/flows.mjs';
import { BudgetStop } from '../lib/budget.mjs';

const MINUTE = 60_000;
export const PROBE_FILES = {
  'README.md': '# g6 planning probe\n\nA word list utility to be planned.\n',
  'src/words.js': 'export const words = text => text.split(/\\s+/).filter(Boolean);\n',
};

export const cellChecks = target => [
  { id: 'reserved', rows: ['C-214'], text: `规划轮请求 reservedOutput=${target}` },
  { id: 'usage', rows: ['C-214'], text: 'usageStatus=reported，inputTokens/outputTokens 非 null（cachedInputTokens 有就记）' },
  { id: 'accepted', rows: ['C-214'], text: 'provider 不返回 400/422（Query 没有以 failed 关闭）' },
  { id: 'not-truncated', rows: ['C-214'], text: '结束原因不是长度截断' },
];

function placeholderDraft(goalId) {
  const stageId = 'next-segment';
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId,
    stages: [{ stageId, title: 'Next segment' }],
    tasks: [{ taskId: 'placeholder', stageId, title: '规划词表工具的下一段工作', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId }, executionIntent: 'plan_only' }],
    assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/**
 * The shared cell body: architecture, policy, Goal, the placeholder Plan, an adviser line, `driver-start`; then read
 * the planning Query's first request. After the request has its usage the Query is cancelled (`queries/cancel`) and the
 * Goal paused, so the cell spends one planning request, not a whole planning round.
 */
export async function planningCell(ctx, rec, { project, modelId, window, target, cumulative }) {
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, project.host, project, modelId);
  if (rec.facts.model.contextWindowTokens !== window) {
    throw new Abort('env-unavailable', `the selected profile's window is ${rec.facts.model.contextWindowTokens}, this cell needs ${window}`);
  }
  await adoptArchitecture(ctx, project, { requireDag: true, dependencies: [],
    modules: [{ ref: { projectId: project.scope.projectId, moduleId: 'words' }, name: 'words', responsibility: '词表工具', paths: ['src'], interfaces: [] }] });
  await ensurePolicy(ctx, project, ['static']);
  const goalId = newId(`g6-${rec.id.toLowerCase()}`);
  const goal = await createGoal(ctx, project, goalId, '规划词表工具的下一段工作', rec);
  await proposeAndApply(ctx, project, goal.ref, placeholderDraft(goalId), `${rec.id}: plan_only placeholder`, rec);
  // The Goal's adviser is the queue's own allocation (the stub run showed `goals/adviser-queue/assign` answering
  // `busy: unique claim owner changed` and the refine round landing on an adviser line the platform opened), so the
  // cell does not open one; it reads every adviser line's Queries.
  const started = await driverStart(ctx, project, goal.ref, { flowId: newId(`${rec.id}-plan`) });
  rec.note(`driver-start: ${started?.status} ${started?.value?.state ?? started?.code ?? ''}`);
  // The first request of the planning Query once it settled: usage reported or unknown, or the Query closed.
  const settledQuery = async () => {
    for (const row of (await lines(project)).filter(entry => entry.duty === 'adviser')) {
      const found = (await sessionQueries(project, row.key)).find(entry =>
        (entry.run?.executionState?.requests ?? []).some(request => request.usageStatus !== 'reserved') || entry.run?.status === 'closed');
      if (found !== undefined) { rec.link('session', row.key); return found; }
    }
    return null;
  };
  let snapshot;
  let meterStop = null;
  try {
    snapshot = await waitFor(ctx, 'the planning request to settle', settledQuery, value => value !== null, { timeoutMs: 30 * MINUTE });
  } catch (error) {
    // An unknown usage stops the meter (budget, second review #2): no new work starts, but the request already
    // happened, so the cell still judges it from reads (no request is sent) and then lets the stop go on.
    if (!(error instanceof BudgetStop && error.cap === 'meter')) throw error;
    meterStop = error;
    snapshot = await settledQuery();
    if (snapshot === null) throw error;
  }
  const runRef = snapshot.ref;
  const jobRef = { aggregateType: 'QueryJob', projectId: runRef.projectId, workspaceId: runRef.workspaceId, queryJobId: runRef.queryJobId };
  let read = ready(await project.host.client.read('queries/read', project.scope, jobRef));
  const requestsOf = value => value?.run?.run?.executionState?.requests ?? [];
  let first = requestsOf(read)[0] ?? snapshot.run.executionState?.requests?.[0];
  // Second review #13: an unknown usage is committed before the Query's own end and its failure source; wait (reads
  // only, bounded) for that Query's terminal state before reading where the failure came from.
  const terminal = value => ['closed', 'answered'].includes(value?.run?.run?.status);
  if (first?.usageStatus === 'unknown' || (first === undefined && !terminal(read))) {
    for (const until = Date.now() + 10 * MINUTE; !terminal(read) && Date.now() < until;) {
      await sleep(10_000);
      read = ready(await project.host.client.read('queries/read', project.scope, jobRef));
    }
    first = requestsOf(read)[0] ?? first;
  }
  const close = read?.job?.job?.closeReason ?? null;
  rec.facts.requests = requestsOf(read).map(request => ({ requestId: request.requestId, reservedOutput: request.reservedOutput,
    usageStatus: request.usageStatus, inputTokens: request.inputTokens, outputTokens: request.outputTokens, cachedInputTokens: request.cachedInputTokens }));
  rec.note(`请求事实：${JSON.stringify(rec.facts.requests)}；Query ${read?.run?.run?.status}；close ${JSON.stringify(close)}；profile 累计输出上限 ${cumulative}`);
  if (first?.usageStatus === 'reported' && !terminal(read)) {
    const cancelled = await project.host.client.read('queries/cancel', project.scope, { queryRunRef: runRef });
    rec.note(`queries/cancel after the first request: ${cancelled?.status} ${cancelled?.value?.stop ?? cancelled?.code ?? ''}`);
  }
  judgeFirst(rec, first, read, close, target, terminal(read));
  if (meterStop !== null) {
    // Quick check 补充1: the stop this request caused is lifted once its rejection is proven (one more full reading);
    // any other stop, or this one unproven, goes on up.
    await ctx.budget.read();
    if (ctx.budget.stop !== null) throw ctx.budget.stop;
    rec.note(`the meter stop held for request ${first?.requestId} was lifted after its proven rejection; the run goes on`);
  }
}

/** Judge the first planning request (slice-9-SPEC.md:716-723); a rejection is `fail` with its recorded source. */
function judgeFirst(rec, first, read, close, target, ended) {
  if (first === undefined) {
    rec.uncover('reserved', 'capability-unsupported', `没有发出请求（fits 不通过或没进入）；close ${JSON.stringify(close)}`);
    return;
  }
  if (first.reservedOutput !== target) {
    for (const id of ['reserved', 'usage', 'accepted', 'not-truncated']) {
      rec.uncover(id, 'prereq-slice-missing', id === 'reserved' ? `实际 reservedOutput ${first.reservedOutput}，目标 ${target}` : 'reservedOutput 不是目标值，这格不判 provider 接受性');
    }
    return;
  }
  rec.pass('reserved', `reservedOutput ${first.reservedOutput}（requestId ${first.requestId}）`);
  if (first.usageStatus === 'reported') {
    rec.check('usage', first.inputTokens !== null && first.outputTokens !== null,
      `usageStatus reported，输入 ${first.inputTokens}，输出 ${first.outputTokens}，缓存命中 ${first.cachedInputTokens}`);
    rec.pass('accepted', '请求被接受（用量已报）');
    // A request row carries no finish reason (`query-job.ts:621-633`): an answer shorter than the reserve was not cut at it.
    rec.check('not-truncated', first.outputTokens !== null && first.outputTokens < first.reservedOutput,
      `输出 ${first.outputTokens} < 预留 ${first.reservedOutput}；close detail ${close?.detail ?? 'none'}`);
    return;
  }
  // `unknown` (or still reserved at the bound): the provider did not report the request.
  rec.fail('usage', `usageStatus ${first.usageStatus}，没有用量读数`);
  if (!ended) {
    rec.fail('accepted', `用量 ${first.usageStatus} 之后 10 分钟内同一 Query 没有到终态（${read?.run?.run?.status}），读不到失败来源`);
  } else {
    const proven = close?.code === 'failed' && JSON.stringify(read).includes('provider_request_failed');
    rec.failure = { failureClass: 'provider_rejected', source: proven ? 'model_service' : null, kernelCode: proven ? 'provider_request_failed' : close?.code ?? null,
      occurredAt: read?.run?.run?.endedAt ?? null, autoRetry: false, recoveryPath: 'none (no silent downgrade)' };
    rec.fail('accepted', `provider 没有接受：Query ${read?.run?.run?.status}，close ${close?.code ?? '-'}：${close?.message ?? ''}`);
    // Lead ruling 11-14 (A1/B1): a rejection the terminal failure proves is a known outcome; the meter counts the
    // request as unbilled 0 and the run goes on. Without that proof the meter stops the run (budget `#provenRejection`).
    rec.note(proven ? `请求 ${first.requestId} 是 provider 拒收（终态失败，来源 model_service / provider_request_failed）：预算按未计费 0 计，运行继续`
      : `请求 ${first.requestId} 用量未知，终态没有 provider 失败来源：计量停下，后面的单元不跑`);
  }
  rec.uncover('not-truncated', 'not-run', '请求没有被接受，不判截断');
}
const def = { id: 'A1', host: 'wa', rows: ['C-214'], checks: cellChecks(131072) };

async function run(ctx, rec) {
  const cell = ctx.cfg.cells.A1;
  const host = await ctx.start('wa');
  const project = await openProject(ctx, host, 'a1', PROBE_FILES);
  try {
    await planningCell(ctx, rec, { project, modelId: cell.modelId, window: cell.contextWindowTokens, target: cell.reservedOutput,
      cumulative: 'null = 不设上限' });
  } finally {
    await ctx.close('wa');
  }
}

export default { ...def, run };
