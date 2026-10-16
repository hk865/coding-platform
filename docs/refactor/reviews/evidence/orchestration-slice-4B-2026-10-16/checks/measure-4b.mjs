#!/usr/bin/env node
/**
 * Slice 4B acceptance measurement (slice-4-SPEC §7: "规模：lead 验收时在 MEMORY-LOOKUP §1
 * 的基准规模上量一次（20,000 条注记、100,000 个历史版本），只记不断言").
 *
 * This is a MEASUREMENT, not a test: it records wall times and result shapes and
 * asserts nothing. It builds the dataset only through the public platform
 * services (the same calls tests/helpers/S4A-note-fixture.ts and
 * S4B-memory-fixture.ts use) on the SQLite backend, then times the six memory
 * reads on `platform.notes`, the store reopen (plain and after a forced
 * full-text rebuild through a changed text registration, the T-06 trigger), and
 * the raw RecordStore `searchText` port.
 *
 * It imports the compiled `dist/` of the repository given by --repo (build it
 * first with `node_modules/.bin/tsc -p tsconfig.build.json`).
 *
 * Usage (WSL, Node 24):
 *   node measure-4b.mjs --repo ~/dsh-work/measure-4b \
 *     [--data <dir>] [--out <file.json>] [--goals-a 100] [--per-goal 200] \
 *     [--target-versions 100000] [--reps 30] [--pilot] [--fresh]
 *
 * Phases: build to checkpoint A (goals-a × per-goal notes) → measure A →
 * keep adding goals until the NoteVersion count reaches --target-versions →
 * measure B. Each note can carry at most 4 versions through the public
 * dispositions (pending_review → accept → review → superseded/withdrawn), so
 * 100,000 versions cannot sit on 20,000 notes; B is therefore a larger note
 * count, reported as such.
 */
import { mkdir, writeFile, readFile, rm, stat, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const home = os.homedir();
const expand = p => (typeof p === 'string' && p.startsWith('~/') ? join(home, p.slice(2)) : p);
const REPO = resolve(expand(args.repo ?? '~/dsh-work/measure-4b'));
const PILOT = args.pilot === true;
const DATA = resolve(expand(args.data ?? join(REPO, PILOT ? '.measure-data/pilot' : '.measure-data/full')));
const OUT = resolve(expand(args.out ?? (PILOT ? join(DATA, 'measure-4b.pilot.out.json') : '/mnt/d/cc-lead-notes/impl/s4b/measure-4b.out.json')));
const GOALS_A = Number(args['goals-a'] ?? (PILOT ? 2 : 100));
const PER_GOAL = Number(args['per-goal'] ?? (PILOT ? 60 : 200));
const TARGET_VERSIONS = Number(args['target-versions'] ?? (PILOT ? 0 : 100000));
const REPS = Number(args.reps ?? (PILOT ? 5 : 30));
// The full-text rebuild inserts one row per head outside a transaction (about 20 ms
// per head on WSL ext4 in the pilot), so one forced-rebuild cycle per checkpoint.
const REBUILD_REPS = Number(args['rebuild-reps'] ?? 1);
const LOG = join(DATA, 'measure-4b.log');

const dist = p => import(pathToFileURL(join(REPO, 'dist', p)).href);
const { createTargetPlatform } = await dist('composition/create-platform.js');
const { createSqliteRecordBackend } = await dist('core/record-store/sqlite-record-store.js');
const { NOTE_RECORD_SCHEMAS, S4_NOTE_TEXT_LOOKUP } = await dist('core/work-graph/persistence/note-record-codecs.js');

async function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  try { await appendFile(LOG, `${text}\n`); } catch { /* the data dir may not exist yet */ }
}

// ---------------------------------------------------------------------------
// Deterministic generator (fixed seeds; no Math.random)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
function weighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of entries) { r -= w; if (r < 0) return value; }
  return entries[entries.length - 1][0];
}
const pad = (n, w) => String(n).padStart(w, '0');

const ZH = ('架构图 锚点 缓存 令牌 刷新 重试 超时 并发 事务 索引 分页 游标 权限 日志 配置 回滚 迁移 夹具 内存 进程 沙箱 队列 心跳 '
  + '会话 目标 阶段 任务 计划 版本 审查 冲突 取代 撤下 注记 书记 秘书 执行者 工作线 提醒 预算 额度 上限 快照 事件 提交 序号 '
  + '校验 摘要 路径 符号 签名 接口 模块 依赖 边界 读取 写入 重建 全文 分词 排序 打分 候选 命中 去重 规范化 大小写 字符 字节 '
  + '正文 结论 话题 种类 状态机 守卫 修订 基线 目录 工作区 捕获 查询 源码 构建 补丁 内核 主机 路由 界面 画布 原型 通知 返工 '
  + '证据 验收 合入 分支 推送 回放 幂等 指纹 死锁 竞态 泄漏 抖动 降级 熔断 限流 慢查询 冷启动 预热 压缩 序列化 编码 解码 时钟 '
  + '时区 重入 锁表 连接池 句柄 信号 子进程 管道 终端 渲染 布局 拖动 分隔 草稿 引用 选区 页签 差异 合并 冲刷 落盘 校准 采样 '
  + '指标 告警 回调 钩子 插件 适配器 网关 代理 证书 密钥轮换 签发 过期 续租 租约 抢占 调度 派工 认领 交接 归档 恢复 中断 暂停 '
  + '取消 重排 投影').split(' ');
const EN = ('readMany lookupOrdered commitCursor sessionStore retryPolicy tokenRefresh graphContext workLine noteHead noteVersion '
  + 'currentPointer anchorKey topicKey searchText bigramWindows fts5 sqlite vitest bwrap systemd MemoryMax TasksMax '
  + 'captureSourceChanges querySource planRevision catalogRevision contextAssembler executionDriver attentionObserver heartbeat '
  + 'mailbox dispatchOutbox claimTask roleBinding dutyResolver scribeScope decisionQueue kernelStore historyCursor idempotency '
  + 'fingerprint snapshot migration rollback deadlock backoff jitter eviction pagination tokenizer normalize unicode camelCase '
  + 'schemaId codec decoder encoder router handler middleware websocket stream buffer chunk offset quota lease timer '
  + 'abortSignal promiseAll eventLoop gcPause heapLimit walFile checkpoint vacuum pragma busyTimeout journalMode fsync rename '
  + 'symlink realpath inode mtime sha256 canonicalJson structuredClone deepFreeze reducer selector debounce throttle retryAfter '
  + 'httpRoute coreRoutes uiApi workbench canvasPanel dagLayout outline railView hoverCard pinList leftColumn nodeDetail '
  + 'lineSettings reworkNotice raiseMemoryCap resourceCapHit probeFailed keeperProcess gateFd quiescence observationComplete '
  + 'buildKernelPatch distHash patchCheck lockfile npmCi esbuild tscBuild typecheck boundaryCheck allowlist productionReach '
  + 'moduleDag moduleTarget').split(' ');

// One fixed Zipf (s = 1) over the shuffled combined vocabulary.
const VOCAB = (() => {
  const all = [...ZH.map(w => ({ w, zh: true })), ...EN.map(w => ({ w, zh: false }))];
  const rng = mulberry32(0x4b5eed);
  for (let i = all.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  let acc = 0;
  const cumulative = all.map((entry, rank) => { acc += 1 / (rank + 1); return acc; });
  return { all, cumulative, total: acc };
})();
function word(rng, wantZh) {
  for (;;) {
    const r = rng() * VOCAB.total;
    let lo = 0; let hi = VOCAB.cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (VOCAB.cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    const entry = VOCAB.all[lo];
    if (wantZh === undefined || entry.zh === wantZh) return entry.w;
  }
}

const SENTENCES = [
  r => `在模块 ${r.mod} 里处理${word(r.rng, true)}时需要先确认${word(r.rng)}，否则${word(r.rng)}会出错。`,
  r => `上次${word(r.rng, true)}超过了${String(50 + Math.floor(r.rng() * 950))}毫秒，原因是${word(r.rng)}没有及时释放。`,
  r => `不要在${word(r.rng)}里直接调用${word(r.rng)}，应该通过${word(r.rng)}转一层。`,
  r => `${word(r.rng, true)}和${word(r.rng, true)}的顺序不能颠倒，这一点在测试里已经验证过。`,
  r => `相关文件是 ${r.path}，修改${word(r.rng)}之前先看这里的${word(r.rng, true)}。`,
  r => `如果${word(r.rng)}返回空，就按${word(r.rng, true)}的规则重新读取一次，不要静默跳过。`,
  r => `这条结论来自第 ${String(1 + Math.floor(r.rng() * 9))} 轮返工：${word(r.rng)}在高负载下会让${word(r.rng)}变慢。`,
  r => `后续需要把${word(r.rng)}拆出来，单独给${word(r.rng, true)}一个上限。`,
  r => `Keep ${word(r.rng, false)} behind ${word(r.rng, false)}; calling it directly broke ${word(r.rng)} twice.`,
  r => `The ${word(r.rng, false)} path in ${r.path} assumes ${word(r.rng)} is already normalized.`,
  r => `When ${word(r.rng, false)} times out after ${String(100 + Math.floor(r.rng() * 4900))} ms, retry once and then report ${word(r.rng)} as unavailable.`,
  r => `Do not cache ${word(r.rng, false)} across requests; ${word(r.rng)} changes between commits.`,
];
const CONCLUSIONS = [
  r => `${word(r.rng)}必须在${word(r.rng)}之前完成，否则${word(r.rng, true)}的结果不可信`,
  r => `${word(r.rng)}要用${word(r.rng)}代替，旧的${word(r.rng, true)}只在迁移期保留`,
  r => `Always check ${word(r.rng, false)} before ${word(r.rng)}; ${word(r.rng)} is not safe to skip`,
  r => `${word(r.rng, true)}的上限定为 ${String(2 + Math.floor(r.rng() * 200))}，超出时报${word(r.rng)}而不是截断`,
  r => `${word(r.rng)}出错时先回滚${word(r.rng, true)}，再重放${word(r.rng)}`,
];
function makeBody(rng, ctx) {
  const target = 6 + Math.floor(rng() * 7); // 6–12 sentences, about 1 KiB
  let body = '';
  for (let i = 0; i < target; i += 1) {
    const sentence = pick(rng, SENTENCES)({ rng, ...ctx });
    if (Buffer.byteLength(body + sentence, 'utf8') > 2900) break;
    body += sentence;
  }
  return body;
}
function makeConclusion(rng, ctx) {
  const text = pick(rng, CONCLUSIONS)({ rng, ...ctx });
  return [...text].slice(0, 200).join('');
}
function makeTopic(rng) {
  const t = rng() < 0.5 ? `${word(rng, true)}${word(rng, true)}` : `${word(rng, true)} ${word(rng, false)}`;
  return [...t].slice(0, 34).join('');
}

// ---------------------------------------------------------------------------
// Workspace and catalog
// ---------------------------------------------------------------------------

const PROJECT = 'm4b-project';
const WORKSPACE = 'm4b-workspace';
const NMOD = PILOT ? 6 : 50;
const SUBDIRS = 4;
const FILES_PER_SUB = PILOT ? 3 : 10;
const scope = { projectId: PROJECT, workspaceId: WORKSPACE };
const projectRef = { aggregateType: 'Project', projectId: PROJECT };
const workspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE };
const hostActor = { kind: 'human', id: 'm4b-operator' };
const moduleId = m => `M${pad(m, 2)}`;
const filePath = (m, s, f) => `src/m${pad(m, 2)}/sub${s}/file${pad(f, 2)}.ts`;
const ALL_FILES = [];
for (let m = 0; m < NMOD; m += 1) for (let s = 0; s < SUBDIRS; s += 1) for (let f = 0; f < FILES_PER_SUB; f += 1) ALL_FILES.push({ m, s, f, path: filePath(m, s, f) });

async function makeWorkspace(root) {
  for (const file of ALL_FILES) {
    const dir = join(root, `src/m${pad(file.m, 2)}/sub${file.s}`);
    await mkdir(dir, { recursive: true });
    const rng = mulberry32(0xf11e + file.m * 1000 + file.s * 100 + file.f);
    const lines = [`// module ${moduleId(file.m)} sub ${file.s} file ${file.f}`,
      `export function fn${pad(file.m, 2)}${file.s}${pad(file.f, 2)}(input: number): number {`,
      `  return input * ${file.m + 1} + ${file.f};`, '}'];
    const extra = 2 + Math.floor(rng() * 40);
    for (let i = 0; i < extra; i += 1) lines.push(`// ${word(rng)} ${word(rng)} ${word(rng)}`);
    await writeFile(join(root, file.path), `${lines.join('\n')}\n`);
  }
}

const hostCtx = () => ({ projectId: PROJECT, workspaceId: WORKSPACE, principal: { kind: 'host', actor: hostActor },
  materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: hostActor },
  signal: new AbortController().signal });
const workCtx = (runRef, roleBinding) => ({ projectId: PROJECT, workspaceId: WORKSPACE,
  principal: { kind: 'work_run', runRef, roleBinding }, materialReader: { kind: 'run', requester: runRef },
  signal: new AbortController().signal });
const roleRef = role => ({ kind: 'legacy_template', templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
  templateRevision: 's3.1' });
const bindingFor = (role, id) => ({ schemaVersion: 1, bindingId: `m4b-${id}-binding`,
  templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
  bindingVersion: 1, policyRevision: 'legacy-template' });

function makeClock(startMs) {
  let t = startMs;
  return { now: () => { t += 10; return new Date(t).toISOString(); }, value: () => t };
}

async function openPlatform(dataDir, clock) {
  const root = join(dataDir, 'workspace');
  const bindings = {
    async resolveRoot(requested) {
      return requested.projectId === PROJECT && requested.workspaceId === WORKSPACE
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'm4b-host', permissionRevision: 'm4b-grant-1', allowsRead: () => true } };
    },
  };
  return createTargetPlatform({
    storage: { kind: 'sqlite', directory: join(dataDir, 'storage') },
    workspace: bindings,
    now: clock.now,
    kernelStores: { entries: [{ adapterId: 'm4b-kernel', storeKey: 'm4b-kernel-store', workspace: scope,
      databasePath: join(dataDir, 'kernel.sqlite') }] },
  });
}

function committedValue(label, result) {
  if (result.status !== 'committed') throw new Error(`${label} failed: ${JSON.stringify(result).slice(0, 800)}`);
  return result.value;
}

async function setupProject(platform) {
  const ctx = hostCtx();
  committedValue('project', await platform.projects.createProject(ctx, { meta: { requestId: 'm4b-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId: PROJECT } }));
  committedValue('workspace', await platform.projects.registerWorkspace(ctx, { meta: { requestId: 'm4b-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } }));
  const installed = committedValue('policy-install', await platform.completionPolicies.installCompletionPolicy(ctx, {
    meta: { requestId: 'm4b-policy-install', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT, policyId: 'm4b-policy', revision: 1 }, revision: 0 }] },
    input: { policyId: 'm4b-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } } }));
  committedValue('policy-activate', await platform.completionPolicies.activateCompletionPolicy(ctx, {
    meta: { requestId: 'm4b-policy-activate', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: PROJECT }, revision: 0 }] },
    input: { target: { ref: installed.ref, digest: installed.contentDigest } } }));
  const modules = [{ ref: { projectId: PROJECT, moduleId: 'R' }, name: 'R', responsibility: 'root', paths: ['.'], interfaces: [] }];
  for (let m = 0; m < NMOD; m += 1) {
    modules.push({ ref: { projectId: PROJECT, moduleId: moduleId(m) }, name: moduleId(m), responsibility: `area ${moduleId(m)}`,
      paths: [`src/m${pad(m, 2)}`], interfaces: [{ id: 'I1', description: `${moduleId(m)} interface`, paths: [`src/m${pad(m, 2)}`] }] });
  }
  committedValue('architecture', await platform.architecture.adoptInitialArchitecture(ctx, {
    meta: { requestId: 'm4b-architecture', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { baselineId: 'm4b-baseline', description: 'M4B note anchors', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules } } }));
}

const TASKS = ['t1', 't2', 't3', 't4', 't5', 't6'];
async function setupGoal(platform, clock, g) {
  const ctx = hostCtx();
  const goalId = `g${pad(g, 3)}`;
  const goalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId };
  const planRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: `${goalId}-plan` };
  const project = await platform.projects.readProject(ctx, PROJECT);
  if (project.status !== 'ready') throw new Error(`project read failed: ${JSON.stringify(project)}`);
  committedValue('goal', await platform.goals.createGoal(ctx, { meta: { requestId: `${goalId}-create`,
    expected: [{ ref: projectRef, revision: project.value.revision }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId, workspace: scope, objective: `${goalId} objective` } }));
  const draft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }, { stageId: 's2', title: 'Stage two' }],
    tasks: [
      ...TASKS.map((taskId, i) => ({ taskId, stageId: i < 3 ? 's1' : 's2', title: `Work ${taskId}`, requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } })),
      { taskId: 't7', stageId: 's2', title: 'Scribe review', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' } },
    ],
    assignments: [...TASKS.map(taskId => ({ taskId, role: 'platform-executor', instruction: `Work ${taskId}` })),
      { taskId: 't7', role: 'platform-scribe', instruction: 'Scribe review' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: [...TASKS, 't7', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = committedValue('plan-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: `${goalId}-propose`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: `${goalId} plan`, sources: [] } } }));
  committedValue('plan-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `${goalId}-apply`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }));

  async function claim(suffix, taskId, role) {
    const admitted = committedValue(`admit-${suffix}`, await platform.sessions.admitSessionCreation(ctx, {
      meta: { requestId: `${goalId}-admit-${suffix}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 'm4b-kernel', storeKey: 'm4b-kernel-store' },
        role: roleRef(role), recommendedRefs: [], initialLinks: [] } }));
    const kernelSessionId = `${goalId}-kernel-session-${suffix}`;
    await platform.kernelStores.withStore('m4b-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `${goalId}-kernel-record-${suffix}`, createdAt: clock.now(),
    }, { signal: ctx.signal }));
    const registered = committedValue(`record-${suffix}`, await platform.sessions.recordSessionCreated(ctx, {
      meta: { requestId: `${goalId}-record-${suffix}`, expected: [] },
      input: { operationRef: admitted.ref, sessionRef: admitted.action.plannedSessionRef, adapterId: 'm4b-kernel',
        kernelSessionId, historyCursor: null, observedAt: clock.now() } }));
    const sessionRef = registered.ref;
    const roleBinding = bindingFor(role, `${goalId}-${suffix}`);
    const goalRead = await platform.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('goal read failed');
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error('session read failed');
    const claimed = committedValue(`claim-${suffix}`, await platform.claims.claimTask(ctx, {
      input: { goalRef, planRef, taskId, sessionRef, roleBinding, budget: { tokenBudget: 100000, deadline: null } },
      meta: { requestId: `${goalId}-claim-${suffix}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { aggregateType: 'Session', projectId: PROJECT, sessionId: sessionRef.sessionId }, revision: card.value.record.revision },
      ] } }));
    return { runRef: claimed.runRef, roleBinding };
  }
  const executor = await claim('exec', 't1', 'executor');
  const scribe = await claim('scribe', 't7', 'scribe');
  return { goalId, executor, scribe };
}

// ---------------------------------------------------------------------------
// Note building through the public notes holder
// ---------------------------------------------------------------------------

const ANCHOR_KINDS = [['file', 45], ['task', 18], ['stage', 9], ['module', 9], ['goal', 6], ['interface', 6], ['project', 2]];
const LENGTHS = [[1, 15], [2, 15], [3, 20], [4, 20], [5, 15], [6, 15]];
const FATES = [['reviewed', 62], ['accepted', 10], ['withdrawn', 8], ['rejected', 7], ['pending', 5], ['contradicted', 8]];
const GENERAL = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'];

const state = {
  notes: new Map(), // noteId -> { version, state, anchorKey, goalId, kind, text, author }
  anchorHeads: new Map(), // anchorKey -> { anchor, heads }
  counts: { notes: 0, versions: 0, writeRejected: {}, retriedTopics: 0, scribeFallback: 0, staged: 0 },
  opTimes: { write: [], accept: [], review: [], reject: [], withdraw: [] },
  goals: [],
  buildMs: 0,
  perThousand: [],
};

function anchorKeyOf(anchor) {
  switch (anchor.kind) {
    case 'module': return `module:${anchor.moduleId}`;
    case 'interface': return `interface:${anchor.moduleId}/${anchor.interfaceId}`;
    case 'file': return `file:${anchor.path}`;
    case 'goal': return `goal:${anchor.goalId}`;
    case 'stage': return `stage:${anchor.goalId}/1/${anchor.stageId}`;
    case 'task': return `task:${anchor.goalId}/${anchor.taskId}`;
    case 'project': return 'project';
    default: throw new Error('anchor');
  }
}
const moduleZipf = (() => {
  let acc = 0;
  const cumulative = Array.from({ length: NMOD }, (_, i) => { acc += 1 / Math.pow(i + 1, 0.6); return acc; });
  return rng => { const r = rng() * acc; let i = 0; while (cumulative[i] < r) i += 1; return i; };
})();

function makeAnchor(rng, goalId, kind) {
  switch (kind) {
    case 'file': { const m = moduleZipf(rng); const s = Math.floor(rng() * SUBDIRS); const f = Math.floor(rng() * FILES_PER_SUB);
      return { anchor: { kind: 'file', path: filePath(m, s, f) }, m }; }
    case 'task': return { anchor: { kind: 'task', goalId, taskId: pick(rng, TASKS) }, m: moduleZipf(rng) };
    case 'stage': return { anchor: { kind: 'stage', goalId, stageId: rng() < 0.5 ? 's1' : 's2' }, m: moduleZipf(rng) };
    case 'module': { const m = moduleZipf(rng); return { anchor: { kind: 'module', moduleId: moduleId(m) }, m }; }
    case 'interface': { const m = moduleZipf(rng); return { anchor: { kind: 'interface', moduleId: moduleId(m), interfaceId: 'I1' }, m }; }
    case 'goal': return { anchor: { kind: 'goal', goalId }, m: moduleZipf(rng) };
    case 'project': return { anchor: { kind: 'project' }, m: moduleZipf(rng) };
    default: throw new Error(kind);
  }
}
function basisFor(rng, kind, anchor, m) {
  const sibling = () => filePath(m, Math.floor(rng() * SUBDIRS), Math.floor(rng() * FILES_PER_SUB));
  if (kind === 'file') {
    if (rng() < 0.7) return rng() < 0.3 ? [...new Set([anchor.path, sibling()])] : [anchor.path];
    return [];
  }
  if (kind === 'module' || kind === 'interface') {
    if (rng() < 0.5) return [...new Set(Array.from({ length: 1 + Math.floor(rng() * 2) }, sibling))];
    return [];
  }
  return rng() < 0.2 ? [sibling()] : [];
}
// The stored form of a draft anchor (L2: a stage anchor carries the plan revision; every plan here is revision 1).
const storedAnchor = a => (a.kind === 'stage' ? { kind: 'stage', goalId: a.goalId, planRevision: 1, stageId: a.stageId } : a);
function recordNote(noteId, info) {
  info.anchors = info.anchors.map(storedAnchor);
  state.notes.set(noteId, info);
  state.counts.notes += 1;
  state.counts.versions += 1;
  for (const key of info.anchorKeys) {
    const entry = state.anchorHeads.get(key);
    if (entry === undefined) state.anchorHeads.set(key, { anchor: info.anchors[info.anchorKeys.indexOf(key)], heads: 1 });
    else entry.heads += 1;
  }
}
function bumpVersion(noteId, newState, version) {
  const info = state.notes.get(noteId);
  if (info === undefined) return;
  state.counts.versions += version - info.version;
  info.version = version;
  info.state = newState;
}

async function timed(kind, fn) {
  const t0 = performance.now();
  const result = await fn();
  state.opTimes[kind].push(performance.now() - t0);
  return result;
}

async function buildGoalNotes(platform, goal, g, perGoal) {
  const notes = platform.notes;
  const rng = mulberry32(0x4b000 + g * 7919);
  const host = hostCtx();
  const exec = () => workCtx(goal.executor.runRef, goal.executor.roleBinding);
  const scribe = () => workCtx(goal.scribe.runRef, goal.scribe.roleBinding);
  let count = 0;
  let cmd = 0;
  const nextCmd = () => `${goal.goalId}-c${pad(cmd++, 4)}`;

  async function write(author, draft) {
    const ctx = author === 'user' ? host : exec();
    let attempt = 0;
    for (;;) {
      const result = await timed('write', () => notes.writeNote(ctx, { commandId: nextCmd(), note: draft,
        expectedPointerRevision: null, goalId: goal.goalId }));
      if (result.status === 'rejected' && result.reason === 'same_topic_unresolved' && attempt < 5) {
        attempt += 1; state.counts.retriedTopics += 1;
        draft = { ...draft, topic: `${[...draft.topic].slice(0, 34).join('')} ${attempt}${pad(g, 3)}` };
        continue;
      }
      return { result, draft };
    }
  }
  async function dispose(kind, ctx, noteId, version, verdict, reason) {
    if (kind === 'withdraw') {
      return timed('withdraw', () => notes.withdrawNote(ctx, { commandId: nextCmd(), noteId, expectedVersion: version, reason }));
    }
    return timed(kind, () => notes.reviewNote(ctx, { commandId: nextCmd(), noteId, expectedVersion: version,
      expectedPointerRevision: null, verdict, reason }));
  }
  function rejectedCount(reason) { state.counts.writeRejected[reason] = (state.counts.writeRejected[reason] ?? 0) + 1; }

  // 1) two understanding notes on the goal anchor (the second moves the pointer).
  let firstUnderstanding = null;
  for (let u = 0; u < 2 && count < perGoal; u += 1) {
    const sections = { status: `${goal.goalId} 第 ${u + 1} 版：${word(rng, true)}进行中`, decided: `${word(rng)}已定`,
      open: `${word(rng, true)}待定`, next: `下一步做${word(rng)}`, risks: `${word(rng, true)}有风险` };
    const draft = { kind: 'understanding', topic: '当前理解', conclusion: `${goal.goalId} 的当前理解 v${u + 1}`,
      anchor: { kind: 'goal', goalId: goal.goalId }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: u === 1 && firstUnderstanding !== null ? [firstUnderstanding] : [], contradicts: [], coexistWith: [], sections };
    const result = await timed('write', () => notes.writeNote(host, { commandId: nextCmd(), note: draft,
      expectedPointerRevision: u === 0 ? null : 1, goalId: goal.goalId }));
    if (result.status === 'rejected') { rejectedCount(`understanding:${result.reason}`); continue; }
    const key = `goal:${goal.goalId}`;
    if (u === 1) { for (const [id, info] of state.notes) if (info.goalId === goal.goalId && info.kind === 'understanding' && info.state === 'accepted') bumpVersion(id, 'superseded', info.version + 1); }
    recordNote(result.noteId, { version: 1, state: result.status, anchorKeys: [key], anchors: [draft.anchor], goalId: goal.goalId,
      kind: 'understanding', text: `${draft.topic}\n${draft.conclusion}\n${Object.values(sections).join('\n')}`, author: 'user' });
    if (u === 0) firstUnderstanding = result.noteId;
    count += 1;
  }
  // 2) one repair staged by the executor (half of the goals withdraw it again).
  if (count < perGoal) {
    const { anchor } = makeAnchor(rng, goal.goalId, 'task');
    const draft = { kind: 'repair', topic: `修补 ${word(rng, true)}`, conclusion: makeConclusion(rng, { mod: 'M00' }),
      anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
      body: makeBody(rng, { mod: 'M00', path: ALL_FILES[0].path }) };
    const { result } = await write('agent', draft);
    if (result.status === 'rejected') rejectedCount(`repair:${result.reason}`);
    else {
      recordNote(result.noteId, { version: 1, state: result.status, anchorKeys: [anchorKeyOf(anchor)], anchors: [anchor],
        goalId: goal.goalId, kind: 'repair', text: `${draft.topic}\n${draft.conclusion}\n${draft.body}`, author: 'agent' });
      state.counts.staged += 1;
      count += 1;
      if (g % 2 === 1) {
        const w = await dispose('withdraw', exec(), result.noteId, 1, 'withdraw', '修补不再需要');
        if (w.status === 'done') bumpVersion(result.noteId, w.state, w.version); else rejectedCount(`repair-withdraw:${w.reason}`);
      }
    }
  }

  // 3) lineages of general notes.
  while (count < perGoal) {
    const remaining = perGoal - count;
    let fate = weighted(rng, FATES);
    let length = weighted(rng, LENGTHS);
    const extra = fate === 'contradicted' ? 1 : 0;
    if (length + extra > remaining) { length = remaining - extra; if (length < 1) { fate = 'reviewed'; length = remaining; } }
    const anchorKind = weighted(rng, ANCHOR_KINDS);
    const { anchor, m } = makeAnchor(rng, goal.goalId, anchorKind);
    const extraAnchors = [];
    if (anchorKind === 'file' && rng() < 0.08) extraAnchors.push({ kind: 'module', moduleId: moduleId(m) });
    if (anchorKind === 'task' && rng() < 0.05) extraAnchors.push({ kind: 'file', path: filePath(m, Math.floor(rng() * SUBDIRS), Math.floor(rng() * FILES_PER_SUB)) });
    const anchors = [anchor, ...extraAnchors];
    const anchorKeys = anchors.map(anchorKeyOf);
    const noteKind = pick(rng, GENERAL);
    let topic = makeTopic(rng);
    const basis = basisFor(rng, anchorKind, anchor, m);
    const textCtx = { mod: moduleId(m), path: anchor.kind === 'file' ? anchor.path : filePath(m, 0, 0) };
    let prev = null; // current predecessor { noteId, version, author }
    for (let k = 0; k < length; k += 1) {
      const tail = k === length - 1;
      const tailFate = tail ? fate : 'reviewed';
      let author = weighted(rng, [['agentS', 65], ['agentP', 20], ['user', 15]]);
      if (tailFate === 'rejected' || tailFate === 'pending') author = 'agentS';
      let draft = { kind: noteKind, topic, conclusion: makeConclusion(rng, textCtx), anchor, extraAnchors, facts: [],
        basisFiles: basis, structural: author === 'agentS', replaces: prev === null ? [] : [prev.noteId], contradicts: [],
        coexistWith: [], body: makeBody(rng, textCtx) };
      const written = await write(author === 'user' ? 'user' : 'agent', draft);
      const result = written.result;
      draft = written.draft;
      topic = draft.topic;
      if (result.status === 'rejected') { rejectedCount(result.reason); break; }
      const noteId = result.noteId;
      recordNote(noteId, { version: 1, state: result.status, anchorKeys, anchors, goalId: goal.goalId, kind: noteKind,
        text: `${draft.topic}\n${draft.conclusion}\n${draft.body}`, author: author === 'user' ? 'user' : 'agent' });
      count += 1;
      let version = 1;
      let current = result.status;
      if (current === 'accepted' && prev !== null) bumpVersion(prev.noteId, 'superseded', state.notes.get(prev.noteId).version + 1);
      if (current === 'pending_review') {
        if (tailFate === 'pending') break;
        if (tailFate === 'rejected') {
          const r = await dispose('reject', host, noteId, version, 'reject', `不采用：${word(rng, true)}理由不足`);
          if (r.status === 'done') bumpVersion(noteId, r.state, r.version); else rejectedCount(`reject:${r.reason}`);
          break;
        }
        const a = await dispose('accept', host, noteId, version, 'accept', `确认：${word(rng, true)}`);
        if (a.status !== 'done') { rejectedCount(`accept:${a.reason}`); break; }
        bumpVersion(noteId, a.state, a.version); version = a.version; current = a.state;
        if (prev !== null) bumpVersion(prev.noteId, 'superseded', state.notes.get(prev.noteId).version + 1);
      }
      if (tail && tailFate === 'rejected') {
        // an accepted-at-write tail cannot be rejected; it stays current.
      }
      if (!(tail && tailFate === 'accepted')) {
        let r = await dispose('review', scribe(), noteId, version, 'review', null);
        if (r.status === 'rejected' && r.code === 'forbidden') { state.counts.scribeFallback += 1; r = await dispose('review', host, noteId, version, 'review', null); }
        if (r.status !== 'done') { rejectedCount(`review:${r.reason}`); break; }
        bumpVersion(noteId, r.state, r.version); version = r.version; current = r.state;
      }
      if (tail && tailFate === 'withdrawn') {
        const ctx = author === 'user' ? host : exec();
        const w = await dispose('withdraw', ctx, noteId, version, 'withdraw', `${word(rng, true)}已经不成立`);
        if (w.status === 'done') { bumpVersion(noteId, w.state, w.version); version = w.version; } else rejectedCount(`withdraw:${w.reason}`);
      }
      if (tail && tailFate === 'contradicted' && count < perGoal) {
        const cDraft = { kind: noteKind, topic, conclusion: makeConclusion(rng, textCtx), anchor, extraAnchors, facts: [],
          basisFiles: basis, structural: false, replaces: [], contradicts: [noteId], coexistWith: [], body: makeBody(rng, textCtx) };
        const c = await write('agent', cDraft);
        if (c.result.status === 'rejected') { rejectedCount(`contradict:${c.result.reason}`); }
        else {
          recordNote(c.result.noteId, { version: 1, state: c.result.status, anchorKeys, anchors, goalId: goal.goalId, kind: noteKind,
            text: `${c.draft.topic}\n${c.draft.conclusion}\n${c.draft.body}`, author: 'agent', contradicts: noteId });
          count += 1;
          if (c.result.status === 'pending_review') {
            const a = await dispose('accept', host, c.result.noteId, 1, 'accept', `两种说法都保留：${word(rng, true)}`);
            if (a.status === 'done') bumpVersion(c.result.noteId, a.state, a.version); else rejectedCount(`contradict-accept:${a.reason}`);
          }
        }
      }
      prev = { noteId, version, author };
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

function quantile(sorted, q) { if (sorted.length === 0) return null; return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]; }
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const r = v => (v === null ? null : Math.round(v * 100) / 100);
  return { count: sorted.length, p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), max: r(sorted[sorted.length - 1] ?? null),
    min: r(sorted[0] ?? null), mean: r(sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length)) };
}
function summarize(result) {
  if (result === undefined || result === null) return null;
  if (result.status !== 'ready') return { status: result.status, code: result.code, reason: result.reason };
  const v = result.value;
  const out = { status: 'ready', bytes: Buffer.byteLength(JSON.stringify(v), 'utf8') };
  if (Array.isArray(v.items)) out.items = v.items.length;
  if (Array.isArray(v.records)) out.records = v.records.length;
  for (const key of ['complete', 'ranking', 'coverage', 'topicsComplete']) if (v[key] !== undefined) out[key] = v[key];
  if (v.next !== undefined) out.hasNext = v.next !== null;
  if (Array.isArray(v.warnings)) out.warnings = v.warnings.length;
  if (v.readBasis !== undefined) out.observedFiles = v.readBasis.observedFiles.length;
  if (Array.isArray(v.topics)) out.topics = v.topics.length;
  if (v.understanding !== undefined) out.understanding = v.understanding === null ? null : { pointerSet: v.understanding.pointer.noteId !== null };
  if (Array.isArray(v.items) && v.items.length > 0) {
    const fresh = {}; const states = {};
    for (const item of v.items) { fresh[item.freshness] = (fresh[item.freshness] ?? 0) + 1; states[item.storedState] = (states[item.storedState] ?? 0) + 1; }
    out.freshness = fresh; out.storedStates = states;
    if (v.items[0].score !== undefined) out.topScore = v.items[0].score;
    const conflicting = v.items.filter(item => item.conflicting).length;
    if (conflicting > 0) out.conflictingItems = conflicting;
  }
  return out;
}
async function bench(label, fn, options = {}) {
  const reps = options.reps ?? REPS;
  const maxMs = options.maxMs ?? 90000;
  const t0 = performance.now();
  const first = await fn();
  const firstMs = performance.now() - t0;
  const times = [];
  const start = performance.now();
  for (let i = 0; i < reps; i += 1) {
    const s = performance.now();
    await fn();
    times.push(performance.now() - s);
    if (performance.now() - start > maxMs && times.length >= 3) break;
  }
  const row = { label, firstMs: Math.round(firstMs * 100) / 100, warm: stats(times), sample: summarize(first) };
  await log(`  ${label}: first ${row.firstMs} ms; warm p50 ${row.warm.p50} p95 ${row.warm.p95} max ${row.warm.max} (n=${row.warm.count}) ${JSON.stringify(row.sample)}`);
  return row;
}

async function fileSizes(dataDir) {
  const dir = join(dataDir, 'storage');
  const out = {};
  for (const name of await readdir(dir)) out[name] = (await stat(join(dir, name))).size;
  return out;
}

function dbFacts(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'storage', 'ledger.sqlite'), { readOnly: true });
  try {
    const count = type => Number(db.prepare("SELECT count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = ?").get(type).n);
    const facts = { noteHeads: count('NoteHead'), noteVersions: count('NoteVersion'), currentPointers: count('CurrentPointer'),
      snapshotsTotal: Number(db.prepare('SELECT count(*) AS n FROM snapshots').get().n),
      eventsTotal: Number(db.prepare('SELECT count(*) AS n FROM events').get().n) };
    const states = db.prepare("SELECT json_extract(snapshot_json, '$.state') AS s, count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'NoteHead' GROUP BY s").all();
    facts.headStates = Object.fromEntries(states.map(row => [row.s, Number(row.n)]));
    const fts = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'next_fts_%'").all().map(row => row.name);
    facts.ftsTables = fts;
    facts.pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
    facts.journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    facts.pageCount = Number(db.prepare('PRAGMA page_count').get().page_count);
    try {
      const rows = db.prepare('SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12').all();
      facts.largestObjects = rows.map(row => ({ name: row.name, bytes: Number(row.bytes) }));
    } catch (error) { facts.largestObjects = `dbstat unavailable: ${error.message}`; }
    return facts;
  } finally { db.close(); }
}

// Exact substring document frequency over the generated head texts (normalized
// the way the store normalizes: NFC + ASCII lowercase). Context only.
function documentFrequency(term) {
  const t = term.normalize('NFC').toLowerCase();
  let n = 0;
  for (const info of state.notes.values()) {
    if (info.norm === undefined) info.norm = info.text.normalize('NFC').replace(/[A-Z]/g, c => c.toLowerCase());
    if (info.norm.includes(t)) n += 1;
  }
  return n;
}
function chooseTerms() {
  const candidates = [...ZH, ...EN, '需要', 'the'];
  const freq = candidates.map(w => ({ w, n: documentFrequency(w) }));
  const total = state.notes.size;
  const closest = (target, filter = () => true, exclude = []) => freq.filter(e => filter(e) && !exclude.includes(e.w) && e.n > 0)
    .sort((a, b) => Math.abs(a.n - target) - Math.abs(b.n - target) || (a.w < b.w ? -1 : 1))[0];
  const many = [...freq].sort((a, b) => b.n - a.n)[0];
  const single = closest(Math.round(total * 0.015), e => ZH.includes(e.w) && [...e.w].length === 2);
  const singleEn = closest(Math.round(total * 0.015), e => EN.includes(e.w));
  const pairA = closest(Math.round(total * 0.03), e => ZH.includes(e.w), [single.w]);
  const pairB = closest(Math.round(total * 0.03), e => EN.includes(e.w), [singleEn.w]);
  const cap = closest(1500, e => e.w !== many.w);
  return { many, cap, single, singleEn, pairA, pairB, none: { w: '量子纠缠', n: documentFrequency('量子纠缠') },
    top10: [...freq].sort((a, b) => b.n - a.n).slice(0, 10) };
}

function pickAnchors() {
  const entries = [...state.anchorHeads.entries()].map(([key, v]) => ({ key, ...v }));
  const busiest = [...entries].sort((a, b) => b.heads - a.heads || (a.key < b.key ? -1 : 1))[0];
  const files = entries.filter(e => e.key.startsWith('file:')).sort((a, b) => a.heads - b.heads || (a.key < b.key ? -1 : 1));
  const typicalFile = files[Math.floor(files.length / 2)];
  const modules = entries.filter(e => e.key.startsWith('module:')).sort((a, b) => a.heads - b.heads || (a.key < b.key ? -1 : 1));
  const typicalModule = modules[Math.floor(modules.length / 2)] ?? busiest;
  const busiestModule = modules[modules.length - 1] ?? busiest;
  const fileHeads = files.map(e => e.heads).sort((a, b) => a - b);
  const conflicted = [...state.notes.entries()].find(([, info]) => info.contradicts !== undefined);
  const conflictAnchor = conflicted === undefined ? null : { key: conflicted[1].anchorKeys[0], anchor: conflicted[1].anchors[0], noteId: conflicted[0] };
  const mostVersions = [...state.notes.entries()].sort((a, b) => b[1].version - a[1].version || (a[0] < b[0] ? -1 : 1))[0];
  const replacing = [...state.notes.entries()].find(([, info]) => info.version >= 3 && info.state === 'reviewed');
  return { busiest, typicalFile, typicalModule, busiestModule, conflictAnchor,
    fileAnchorHeads: { anchors: files.length, p50: quantile(fileHeads, 0.5), p95: quantile(fileHeads, 0.95), max: fileHeads[fileHeads.length - 1] },
    anchorsTotal: entries.length, mostVersions: { noteId: mostVersions[0], version: mostVersions[1].version },
    neighborNote: replacing === undefined ? null : replacing[0] };
}

async function touchFiles(dataDir, fraction, salt) {
  const root = join(dataDir, 'workspace');
  const rng = mulberry32(0x7011c4 + salt);
  let n = 0;
  for (const file of ALL_FILES) {
    if (rng() < fraction) { await appendFile(join(root, file.path), `// changed ${salt}\n`); n += 1; }
  }
  return n;
}

async function measureSuite(label, dataDir, clockRef, goalsBuilt) {
  await log(`== measure ${label}: notes ${state.counts.notes}, versions (bookkept) ${state.counts.versions}`);
  const result = { label, scale: {}, reads: [], reopen: {}, rawSearch: [] };
  const terms = chooseTerms();
  const anchors = pickAnchors();
  result.terms = { many: terms.many, cap: terms.cap, single: terms.single, singleEn: terms.singleEn, pairA: terms.pairA, pairB: terms.pairB,
    none: terms.none, top10: terms.top10 };
  result.anchors = { busiest: { key: anchors.busiest.key, heads: anchors.busiest.heads },
    typicalFile: { key: anchors.typicalFile.key, heads: anchors.typicalFile.heads },
    typicalModule: { key: anchors.typicalModule.key, heads: anchors.typicalModule.heads },
    busiestModule: { key: anchors.busiestModule.key, heads: anchors.busiestModule.heads },
    conflictAnchor: anchors.conflictAnchor === null ? null : { key: anchors.conflictAnchor.key },
    fileAnchorHeads: anchors.fileAnchorHeads, anchorsTotal: anchors.anchorsTotal, mostVersions: anchors.mostVersions };

  // --- 2. reopen (plain) and first query after reopen -----------------------
  const g0 = goalsBuilt[0];
  const lookupTypical = p => p.notes.memoryLookup(hostCtx(), { v: 1, op: 'lookup', anchor: anchors.typicalFile.anchor, limit: 20, cursor: null });
  const reopenTimes = []; const firstQuery = [];
  for (let i = 0; i < (PILOT ? 2 : 5); i += 1) {
    const t0 = performance.now();
    const p = await openPlatform(dataDir, clockRef.clock);
    reopenTimes.push(performance.now() - t0);
    const q0 = performance.now();
    await lookupTypical(p);
    firstQuery.push(performance.now() - q0);
    await p.close();
  }
  result.reopen.plain = { open: stats(reopenTimes), firstLookupAfterOpen: stats(firstQuery) };
  await log(`  reopen plain: ${JSON.stringify(result.reopen.plain)}`);

  // --- 2b. forced full-text rebuild through a changed text registration (T-06 trigger)
  const ledger = join(dataDir, 'storage', 'ledger.sqlite');
  const altSchemas = { ...NOTE_RECORD_SCHEMAS, lookups: NOTE_RECORD_SCHEMAS.lookups.map(l => (l.text === undefined ? l
    : { ...l, text: { paths: ['topic', 'conclusion'] } })) };
  const altOpen = []; const rebuildOpen = []; const rebuildFirst = [];
  for (let i = 0; i < REBUILD_REPS; i += 1) {
    const a0 = performance.now();
    const backend = createSqliteRecordBackend({ path: ledger, schemas: altSchemas });
    altOpen.push(performance.now() - a0);
    await backend.close();
    const t0 = performance.now();
    const p = await openPlatform(dataDir, clockRef.clock);
    rebuildOpen.push(performance.now() - t0);
    const q0 = performance.now();
    await lookupTypical(p);
    rebuildFirst.push(performance.now() - q0);
    await p.close();
  }
  // a plain backend open with the unchanged note registration (no rebuild) for comparison
  const plainBackend = [];
  for (let i = 0; i < 3; i += 1) {
    const b0 = performance.now();
    const backend = createSqliteRecordBackend({ path: ledger, schemas: NOTE_RECORD_SCHEMAS });
    plainBackend.push(performance.now() - b0);
    await backend.close();
  }
  result.reopen.forcedRebuild = {
    trigger: 'createSqliteRecordBackend opened with the note text registration changed to [topic, conclusion] (T-06 "a changed text registration rebuilds the index"), closed, then the platform reopened with the real registration, which rebuilds again',
    backendOpenWithChangedRegistration: stats(altOpen),
    platformOpenRebuildingBack: stats(rebuildOpen),
    firstLookupAfterRebuild: stats(rebuildFirst),
    backendOpenNoRebuild_noteSchemasOnly: stats(plainBackend),
  };
  await log(`  reopen forced rebuild: ${JSON.stringify(result.reopen.forcedRebuild)}`);

  // --- 6. raw searchText port (platform closed; note schemas only, no rebuild)
  {
    const backend = createSqliteRecordBackend({ path: ledger, schemas: NOTE_RECORD_SCHEMAS });
    const records = backend.records;
    const search = (t, limit = 100, after) => records.searchText({ index: S4_NOTE_TEXT_LOOKUP, values: [PROJECT], terms: t, limit,
      ...(after === undefined ? {} : { after }) });
    const pageAll = async t => {
      let after; let total = 0; let pages = 0;
      for (;;) {
        const page = await search(t, 100, after);
        if (page.status !== 'ready') return { status: page.status, code: page.code, reason: page.reason };
        total += page.value.records.length; pages += 1;
        if (page.value.next === null) return { status: 'ready', value: { records: { length: total }, pages } };
        after = page.value.next;
      }
    };
    const raw = [
      ['searchText one term (first page, limit 100)', () => search([terms.single.w])],
      ['searchText two terms (first page, limit 100)', () => search([terms.pairA.w, terms.pairB.w])],
      ['searchText many-match term (first page, limit 100)', () => search([terms.many.w])],
      ['searchText no-match term', () => search([terms.none.w])],
      ['searchText one term, all pages', () => pageAll([terms.single.w])],
      ['searchText ~1,500-match term, all pages', () => pageAll([terms.cap.w])],
      ['searchText many-match term, all pages', () => pageAll([terms.many.w])],
    ];
    for (const [l, fn] of raw) {
      const row = await bench(l, fn, { reps: l.includes('all pages') && !l.includes('one term') ? Math.min(REPS, 5) : REPS });
      if (l.includes('all pages')) { const r = await fn(); row.pages = r.value?.pages; row.matches = r.value?.records.length; }
      result.rawSearch.push(row);
    }
    await backend.close();
  }

  // --- 3–5, 7: the six memory reads through platform.notes -----------------
  const platform = await openPlatform(dataDir, clockRef.clock);
  const notes = platform.notes;
  const host = hostCtx;
  const exec = () => workCtx(g0.executor.runRef, g0.executor.roleBinding);
  const L = (anchor, ctx = host) => () => notes.memoryLookup(ctx(), { v: 1, op: 'lookup', anchor, limit: 20, cursor: null });
  const F = (t, match, extra = {}, ctx = host) => () => notes.memoryFind(ctx(), { v: 1, op: 'find', terms: t, match, limit: 20, cursor: null, ...extra });
  const conflictAnchor = anchors.conflictAnchor;
  const staleGoal = g0.goalId;
  const plan = [
    ['memoryLookup typical file anchor (host)', L(anchors.typicalFile.anchor)],
    ['memoryLookup typical file anchor (executor of g000)', L(anchors.typicalFile.anchor, exec)],
    ['memoryLookup typical module anchor (host)', L(anchors.typicalModule.anchor)],
    ['memoryLookup busiest module anchor (host)', L(anchors.busiestModule.anchor)],
    ['memoryLookup busiest anchor (host)', L(anchors.busiest.anchor)],
    ['memoryLookup busiest anchor (executor of g000)', L(anchors.busiest.anchor, exec)],
    ['memoryLookup goal anchor with understanding (host)', L({ kind: 'goal', goalId: staleGoal })],
    ['memoryHistory note with most versions', () => notes.memoryHistory(host(), { v: 1, op: 'history', noteId: anchors.mostVersions.noteId, limit: 20, cursor: null })],
    ['memoryNeighbors reviewed note with predecessor', () => notes.memoryNeighbors(host(), { v: 1, op: 'neighbors', noteId: anchors.neighborNote, limit: 20, cursor: null })],
    ['memoryFind one term, any', F([terms.single.w], 'any')],
    ['memoryFind one English term, any', F([terms.singleEn.w], 'any')],
    ['memoryFind one term, any (executor of g000)', F([terms.single.w], 'any', {}, exec)],
    ['memoryFind two terms, any', F([terms.pairA.w, terms.pairB.w], 'any')],
    ['memoryFind two terms, all', F([terms.pairA.w, terms.pairB.w], 'all')],
    ['memoryFind ~1,500-match term, any (just over the candidate cap)', F([terms.cap.w], 'any')],
    ['memoryFind many-match term, any (candidate cap)', F([terms.many.w], 'any')],
    ['memoryFind many-match term + anchor filter (busiest module)', F([terms.many.w], 'any', { anchor: anchors.busiestModule.anchor })],
    ['memoryFind no-match term', F([terms.none.w], 'any')],
    ['memoryStale one goal', () => notes.memoryStale(host(), { v: 1, op: 'stale', goalId: staleGoal, limit: 20, cursor: null })],
    ['memoryStale busiest module anchor', () => notes.memoryStale(host(), { v: 1, op: 'stale', anchor: anchors.busiestModule.anchor, limit: 20, cursor: null })],
    ...(conflictAnchor === null ? [] : [
      ['memoryConflicts anchor with a registered contradiction', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', anchor: conflictAnchor.anchor, limit: 20, cursor: null })],
      ['memoryConflicts by noteId', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', noteId: conflictAnchor.noteId, limit: 20, cursor: null })],
    ]),
    ['memoryConflicts busiest anchor', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', anchor: anchors.busiest.anchor, limit: 20, cursor: null })],
  ];
  for (const [l, fn] of plan) {
    const heavy = l.includes('candidate cap') || l.includes('many-match term +');
    result.reads.push(await bench(l, fn, heavy ? { reps: Math.min(REPS, 10) } : {}));
  }
  await platform.close();
  result.scale = { notesBookkept: state.counts.notes, versionsBookkept: state.counts.versions, goals: goalsBuilt.length,
    files: ALL_FILES.length, modules: NMOD, db: dbFacts(dataDir), storageFiles: await fileSizes(dataDir) };
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (existsSync(DATA)) {
    if (args.fresh === true) await rm(DATA, { recursive: true, force: true });
    else throw new Error(`data dir ${DATA} exists; pass --fresh to rebuild it`);
  }
  await mkdir(join(DATA, 'workspace'), { recursive: true });
  const meta = { started: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemGiB: Math.round(os.totalmem() / 2 ** 30 * 10) / 10,
    repo: REPO, data: DATA, pilot: PILOT, goalsA: GOALS_A, perGoal: PER_GOAL, targetVersions: TARGET_VERSIONS, reps: REPS, rebuildReps: REBUILD_REPS,
    files: ALL_FILES.length, modules: NMOD };
  await log(`start ${JSON.stringify(meta)}`);
  await makeWorkspace(join(DATA, 'workspace'));
  const clockRef = { clock: makeClock(Date.parse('2026-10-16T00:00:00.000Z')) };
  let platform = await openPlatform(DATA, clockRef.clock);
  const setup0 = performance.now();
  await setupProject(platform);
  const setupMs = performance.now() - setup0;
  const out = { meta, setupMs, checkpoints: [] };

  const buildStart = performance.now();
  let lastMark = buildStart; let lastNotes = 0; let goalSetupMs = 0;
  const goalsBuilt = [];
  const buildGoals = async (from, until) => {
    for (let g = from; until(g); g += 1) {
      const gs = performance.now();
      const goal = await setupGoal(platform, clockRef.clock, g);
      goalSetupMs += performance.now() - gs;
      goalsBuilt.push(goal);
      await buildGoalNotes(platform, goal, g, PER_GOAL);
      if (state.counts.notes - lastNotes >= 1000 || PILOT) {
        const now = performance.now();
        state.perThousand.push({ notes: state.counts.notes, versions: state.counts.versions, msPer1000: Math.round((now - lastMark) / ((state.counts.notes - lastNotes) / 1000)) });
        await log(`  built goal ${g}: notes ${state.counts.notes}, versions ${state.counts.versions}, ${Math.round((now - buildStart) / 1000)} s, rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MiB, rejected ${JSON.stringify(state.counts.writeRejected)}`);
        lastMark = now; lastNotes = state.counts.notes;
      }
    }
  };
  const buildReport = (from) => ({ ms: Math.round(performance.now() - from), notes: state.counts.notes, versions: state.counts.versions,
    msPer1000Notes: Math.round((performance.now() - from) / (state.counts.notes / 1000)), goalSetupMs: Math.round(goalSetupMs),
    perThousand: [...state.perThousand], counts: JSON.parse(JSON.stringify(state.counts)),
    opTimes: Object.fromEntries(Object.entries(state.opTimes).map(([k, v]) => [k, stats(v)])) });

  // Checkpoint A
  await buildGoals(0, g => g < GOALS_A);
  const buildA = buildReport(buildStart);
  await platform.close();
  const touchedA = await touchFiles(DATA, 0.05, 1);
  await log(`checkpoint A built: ${JSON.stringify({ ms: buildA.ms, notes: buildA.notes, versions: buildA.versions })}; touched ${touchedA} files`);
  const measureA = await measureSuite('A', DATA, clockRef, goalsBuilt);
  out.checkpoints.push({ label: 'A', build: buildA, touchedFiles: touchedA, ...measureA });
  await writeFile(OUT, JSON.stringify(out, null, 2));

  // Checkpoint B: keep adding goals until the version count reaches the target
  if (TARGET_VERSIONS > 0 && state.counts.versions < TARGET_VERSIONS) {
    platform = await openPlatform(DATA, clockRef.clock);
    const bStart = performance.now();
    state.perThousand.length = 0;
    for (const k of Object.keys(state.opTimes)) state.opTimes[k] = [];
    lastMark = bStart; lastNotes = state.counts.notes; goalSetupMs = 0;
    const notesBefore = state.counts.notes;
    await buildGoals(GOALS_A, () => state.counts.versions < TARGET_VERSIONS);
    const buildB = buildReport(bStart);
    buildB.notesAdded = state.counts.notes - notesBefore;
    buildB.msPer1000Notes = Math.round(buildB.ms / (buildB.notesAdded / 1000));
    await platform.close();
    const touchedB = await touchFiles(DATA, 0.05, 2);
    await log(`checkpoint B built: ${JSON.stringify({ ms: buildB.ms, notes: buildB.notes, versions: buildB.versions })}; touched ${touchedB} files`);
    const measureB = await measureSuite('B', DATA, clockRef, goalsBuilt);
    out.checkpoints.push({ label: 'B', build: buildB, touchedFiles: touchedB, ...measureB });
  }
  out.finished = new Date().toISOString();
  out.totalMs = Math.round(performance.now() - buildStart);
  await writeFile(OUT, JSON.stringify(out, null, 2));
  await log(`done; wrote ${OUT}`);
}

main().then(() => process.exit(0), async error => { await log(`FAILED: ${error.stack ?? error}`); process.exit(1); });
