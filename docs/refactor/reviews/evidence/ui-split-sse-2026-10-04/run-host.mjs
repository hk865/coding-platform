#!/usr/bin/env node
/**
 * Task E screenshot baseline: one deterministic, model-free local workbench Host.
 *
 * Evidence harness only (never imported by product code). It starts the REAL
 * built Host (`dist/app/host.js`, through the same `loadWorkbenchCliConfig`
 * startup-file path the CLI uses) on an isolated temporary project, seeds formal
 * facts only through the public HTTP core routes, and keeps serving until
 * SIGTERM/SIGINT.
 *
 * No real model/provider is reachable: the provider registry contains ONE local
 * scripted client (same pattern as tests/helpers/AG2b-collaboration-fixture.ts);
 * its base URL is `https://invalid.test` and it never opens a socket.
 *
 * Determinism (so the same seed renders the same pixels on every run):
 *   - `crypto.randomUUID` (node:crypto + WebCrypto) is replaced by a counter;
 *   - the global `Date` is a virtual clock: every `Date.now()` / `new Date()`
 *     returns BASE + n * STEP ms (n = call count), so ledger/Kernel timestamps
 *     and Run start/end instants are identical whenever the call order is.
 *   The seed runs strictly sequentially (awaited HTTP calls, explicit
 *   `workflow/advance` steps instead of the background driver), which keeps
 *   that call order stable. The token stays random (it is never displayed).
 *
 * Fault injection (phase 2 evidence): SIGUSR2 breaks every open change-stream
 * connection (see 1b). Nothing else reacts to it.
 *
 * Usage (inside WSL, after `npm run build` in the repository):
 *   REPO_ROOT=<repo> node run-host.mjs --dir <empty temp dir> [--port 44851] [--state <file>]
 * REPO_ROOT defaults to five directories above this file (the repository root
 * when the file lives in docs/refactor/reviews/evidence/<dir>/). It prints one
 * JSON line `{"ready":true,...}` and writes the full state to --state
 * (default <dir>/state.json).
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. Determinism prelude (before any product module is loaded).
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const nodeCrypto = require('node:crypto');
let uuidCounter = 0;
const deterministicUuid = () => {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
};
nodeCrypto.randomUUID = deterministicUuid;
try { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: deterministicUuid, configurable: true }); } catch { /* ignore */ }
syncBuiltinESMExports();

const RealDate = globalThis.Date;
const CLOCK_BASE_MS = RealDate.parse('2026-10-04T01:00:00.000Z');
const CLOCK_STEP_MS = 10;
let clockTicks = 0;
const virtualNow = () => CLOCK_BASE_MS + (clockTicks++) * CLOCK_STEP_MS;
class VirtualDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(virtualNow());
    else super(...args);
  }
  static now() { return virtualNow(); }
}
if (process.env.RUN_HOST_REAL_CLOCK !== '1') globalThis.Date = VirtualDate;

// ---------------------------------------------------------------------------
// 1b. Change-stream fault injection (task E phase 2 evidence only).
// SIGUSR2 destroys the TCP socket of every open `GET /api/real/core/changes`,
// i.e. the connection breaks in the middle of the stream, as a network drop
// would. capture.mjs uses it for the fallback scenario, because a Playwright
// route only affects new requests and Chromium's offline emulation does not
// end an already open loopback stream. Product code is not touched.
// ---------------------------------------------------------------------------
const http = require('node:http');
const changeStreamSockets = new Set();
const serverEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function emit(event, ...args) {
  const request = args[0];
  if (event === 'request' && typeof request?.url === 'string' && request.url.startsWith('/api/real/core/changes')) {
    const socket = request.socket;
    changeStreamSockets.add(socket);
    socket.once('close', () => changeStreamSockets.delete(socket));
  }
  return serverEmit.call(this, event, ...args);
};
process.on('SIGUSR2', () => {
  const count = changeStreamSockets.size;
  for (const socket of changeStreamSockets) socket.destroy();
  process.stderr.write(`fault injection: destroyed ${count} change-stream connection(s)\n`);
});

// ---------------------------------------------------------------------------
// 2. Arguments and repository paths.
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const baseDir = option('dir', undefined);
if (baseDir === undefined) {
  process.stderr.write('usage: node run-host.mjs --dir <empty temp dir> [--port 44851] [--state <file>]\n');
  process.exit(2);
}
const port = Number(option('port', '44851'));
const statePath = resolve(option('state', join(baseDir, 'state.json')));
const repo = resolve(process.env.REPO_ROOT ?? fileURLToPath(new URL('../../../../../', import.meta.url)));
const dist = (path) => pathToFileURL(join(repo, 'dist', path)).href;

const { createLocalWorkbenchHost } = await import(dist('app/host.js'));
const { loadWorkbenchCliConfig } = await import(dist('app/main.js'));
const { sha256Hex } = await import(dist('contracts/fingerprint.js'));
const { ProviderRegistry } = await import(pathToFileURL(join(repo, 'vendor/coding-agent/dist/public-api.js')).href);

// ---------------------------------------------------------------------------
// 3. Fixed seed facts.
// ---------------------------------------------------------------------------
const SCOPE = { projectId: 'demo-project', workspaceId: 'demo-workspace' };
const LIB_SCOPE = { projectId: 'demo-lib', workspaceId: 'demo-lib-workspace' };
const PROJECT_REF = { aggregateType: 'Project', projectId: SCOPE.projectId };
const WORKSPACE_REF = { aggregateType: 'Workspace', ...SCOPE };
const GOAL_ID = 'demo-goal';
const POLL_GOAL_ID = 'demo-goal-poll';
const GOAL_REF = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId: GOAL_ID };
const BUILDER_ROLE = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const ADVISOR_ROLE = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const BUILDER_BINDING = { schemaVersion: 1, bindingId: 'demo-builder-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const ADVISOR_BINDING = { schemaVersion: 1, bindingId: 'demo-advisor-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const CONSUMER_ID = 'demo-consumer';
const ADVISOR_PROFILE_ID = 'demo-consult';
const BUILDER_INSTRUCTION = 'Demo trusted builder instruction (screenshot baseline, scripted model)';
const ADVISOR_INSTRUCTION = 'Demo trusted read-only advisor instruction (screenshot baseline, scripted model)';
const RUNTIME_BUDGET = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
  maxToolCalls: 16, timeoutMs: 600000, perResponseTokens: 512 };
const QUERY_BUDGET = { maxTokens: 200000, deadline: null };
const SECRET_VAR = 'DEMO_SCRIPTED_SECRET';
const ACTOR = { kind: 'human', id: 'demo-operator' };

// Task markers route the scripted replies; assistant texts never repeat them.
const PARSE_MARKER = 'DEMO-PARSE';
const DOCS_MARKER = 'DEMO-DOCS';
const BLOCK_MARKER = 'DEMO-BLOCK';
const MAIN_QUESTION = '请先阅读解析器模块，说明当前结构和下一步建议。';
const REVIEW_QUESTION = '解析结果类型应放在哪个模块？';

const MAIN_ANSWER = [
  '## 解析器现状',
  '',
  '当前 `src/parser/index.ts` 只导出了 `parseLine`，还没有结构化的结果类型。',
  '',
  '| 文件 | 作用 |',
  '| --- | --- |',
  '| `src/parser/index.ts` | 按行解析 `key=value` |',
  '| `src/util/text.ts` | 去除首尾空白 |',
  '',
  '建议下一步：',
  '',
  '1. 新增 `ParseResult` 类型并由解析器返回；',
  '2. 在 `docs/` 下补充使用说明。',
  '',
  '```ts',
  'export type ParseResult = { key: string; value: string };',
  '```',
  '',
  '> 以上结论只依据当前工作区内容，没有修改任何文件。',
].join('\n');
const REVIEW_ANSWER = '建议放在 **parser** 模块内（`src/parser/result.ts`），由 `parseLine` 直接返回；`util` 保持无业务类型。';

const PROJECT_FILES = {
  'README.md': '# 演示工程\n\n截图基线使用的隔离工程，内容固定，不连接任何真实模型。\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['src/**/*.ts'] }, null, 2) + '\n',
  'src/index.ts': "import { parseLine } from './parser/index.js';\n\nexport function run(text: string) {\n  return text.split('\\n').map(parseLine);\n}\n",
  'src/parser/index.ts': "import { trim } from '../util/text.js';\n\nexport function parseLine(line: string) {\n  const [key, value] = line.split('=');\n  return { key: trim(key ?? ''), value: trim(value ?? '') };\n}\n",
  'src/util/text.ts': 'export const trim = (value: string): string => value.trim();\n',
  'docs/notes.md': '# 笔记\n\n- 解析器按行处理 `key=value`。\n',
};
const LIB_FILES = {
  'README.md': '# 示例库\n\n第二个隔离工作区，只用于项目树与切换。\n',
  'src/lib.ts': 'export const answer = 42;\n',
};

// ---------------------------------------------------------------------------
// 4. Local scripted model (no network).
// ---------------------------------------------------------------------------
const scriptedCalls = { work: 0, query: 0, blocked: 0 };
const PARSE_SCRIPT = [
  { kind: 'calls', calls: [{ callId: 'demo-read-parser', name: 'read', args: { path: 'src/parser/index.ts' } }] },
  { kind: 'calls', calls: [{ callId: 'demo-create-result', name: 'edit', args: { mode: 'create', path: 'src/parser/result.ts',
    newText: 'export type ParseResult = { key: string; value: string };\n' } }] },
  { kind: 'text', text: '已新增 `src/parser/result.ts`，导出 `ParseResult` 类型；解析器其余行为未改动。' },
];
const DOCS_SCRIPT = [
  { kind: 'calls', calls: [
    { callId: 'demo-read-readme', name: 'read', args: { path: 'README.md' } },
    { callId: 'demo-read-missing', name: 'read', args: { path: 'docs/usage.md' } },
  ] },
  { kind: 'calls', calls: [{ callId: 'demo-create-doc', name: 'edit', args: { mode: 'create', path: 'docs/parser.md',
    newText: '# 解析器使用说明\n\n```ts\nimport { parseLine } from "../src/parser/index.js";\nparseLine("a = 1"); // { key: "a", value: "1" }\n```\n' } }] },
  { kind: 'text', text: '使用说明已写入 `docs/parser.md`。\n\n- 原 `docs/usage.md` 不存在，因此新建了独立文件；\n- 示例与 `ParseResult` 保持一致。' },
];

function stepAfterMarker(request, marker) {
  let anchor = -1;
  request.messages.forEach((message, index) => {
    if (message.role !== 'assistant' && JSON.stringify(message).includes(marker)) anchor = index;
  });
  return request.messages.slice(anchor + 1).filter(message => message.role === 'assistant').length;
}
function lastUserText(request) {
  const user = [...request.messages].reverse().find(message => message.role === 'user');
  return user === undefined ? '' : JSON.stringify(user);
}

function scriptedClient(kind) {
  return {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      let reply;
      if (kind === 'query') {
        scriptedCalls.query += 1;
        const text = lastUserText(request);
        reply = { kind: 'text', text: text.includes(REVIEW_QUESTION) ? REVIEW_ANSWER
          : text.includes(MAIN_QUESTION) ? MAIN_ANSWER : '已记录该问题；当前没有更多可确认的事实。' };
      } else {
        const transcript = JSON.stringify(request.messages);
        const current = [PARSE_MARKER, DOCS_MARKER, BLOCK_MARKER]
          .map(marker => ({ marker, at: transcript.lastIndexOf(marker) })).filter(entry => entry.at >= 0)
          .sort((left, right) => right.at - left.at)[0]?.marker;
        if (current === BLOCK_MARKER) {
          // Polling scenario: the Run stays `running` until the Host closes.
          scriptedCalls.blocked += 1;
          await new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
          });
        }
        scriptedCalls.work += 1;
        const script = current === DOCS_MARKER ? DOCS_SCRIPT : PARSE_SCRIPT;
        const step = stepAfterMarker(request, current ?? PARSE_MARKER);
        reply = script[Math.min(step, script.length - 1)];
      }
      const base = { schemaVersion: 1, requestId: request.requestId };
      let sequence = 0;
      if (reply.kind === 'text') {
        yield { ...base, sequence: ++sequence, type: 'text_delta', delta: reply.text };
        yield { ...base, sequence: ++sequence, type: 'completed', reason: 'final_answer' };
        return;
      }
      for (const [ordinal, call] of reply.calls.entries()) {
        yield { ...base, sequence: ++sequence, type: 'tool_call_started', callId: call.callId, name: call.name, ordinal };
        yield { ...base, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.callId, delta: JSON.stringify(call.args) };
      }
      yield { ...base, sequence: ++sequence, type: 'completed', reason: 'tool_calls' };
    },
  };
}
const workClient = scriptedClient('work');
const queryClient = scriptedClient('query');
const registry = new ProviderRegistry().register({
  id: 'deepseek', secretEnvironmentVariable: SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
  capabilities: { streaming: true, toolCalls: true, usage: true },
  create: context => context.model.includes('scripted-query') ? queryClient : workClient,
});

// ---------------------------------------------------------------------------
// 5. Isolated project, startup file and Host.
// ---------------------------------------------------------------------------
const root = join(baseDir, 'project');
const libRoot = join(baseDir, 'lib');
const database = join(baseDir, 'db');
async function writeTree(target, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), text);
  }
}
await writeTree(root, PROJECT_FILES);
await writeTree(libRoot, LIB_FILES);
await mkdir(database, { recursive: true });

const permissionRevision = (scope, readPrefixes) => `host-permission-v1:${createHash('sha256').update(JSON.stringify({
  subject: { kind: ACTOR.kind, id: ACTOR.id }, scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
  readPrefixes: [...new Set(readPrefixes)].sort(),
})).digest('hex')}`;
const skillsRoot = join(repo, 'vendor/coding-agent/resources/skills');
// The check sandbox only sees system binaries (no user-installed node), so the
// registered check uses grep from /usr/bin.
const CHECK_COMMAND = 'grep -q ParseResult src/parser/result.ts && echo DEMO_CHECK_OK';
const config = {
  sqliteDirectory: database,
  actor: ACTOR,
  port,
  workspaces: [
    { scope: SCOPE, name: '演示工程', root, workspaceRevision: 1, readPrefixes: ['.'], allowCommands: true },
    { scope: LIB_SCOPE, name: '示例库', root: libRoot, workspaceRevision: 1, readPrefixes: ['.'] },
  ],
  review: { sessionRoles: [
    { scope: SCOPE, label: '执行者', role: BUILDER_ROLE },
    { scope: SCOPE, label: '顾问', role: ADVISOR_ROLE },
  ] },
  architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
  kernelStores: { entries: [{ adapterId: 'demo-kernel', storeKey: 'demo-kernel-store', workspace: SCOPE,
    databasePath: join(database, 'kernel.sqlite') }] },
  runtime: {
    schemaVersion: 1,
    bindings: [
      { id: 'demo-builder-binding', label: '执行者运行时', scope: SCOPE, role: BUILDER_ROLE,
        configurationRevision: 'demo-builder-host@1',
        model: { revision: 'demo-builder-model@1', provider: 'deepseek', model: 'demo-scripted-work', secretEnvironmentVariable: SECRET_VAR },
        grant: { budget: RUNTIME_BUDGET, hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(BUILDER_INSTRUCTION) },
          tools: ['read', 'write'], writeScope: ['.'], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: BUILDER_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } },
      { id: 'demo-advisor-binding', label: '顾问运行时', scope: SCOPE, role: ADVISOR_ROLE,
        configurationRevision: 'demo-advisor-host@1',
        model: { revision: 'demo-advisor-model@1', provider: 'deepseek', model: 'demo-scripted-query', secretEnvironmentVariable: SECRET_VAR },
        grant: { budget: RUNTIME_BUDGET, hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(ADVISOR_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: ADVISOR_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } },
    ],
    queryProfiles: [{ id: ADVISOR_PROFILE_ID, label: '顾问只读调查', scope: SCOPE, runtimeBindingId: 'demo-advisor-binding',
      sessionRole: ADVISOR_ROLE, roleBinding: ADVISOR_BINDING, runtimeBudget: RUNTIME_BUDGET, budget: QUERY_BUDGET,
      consumerId: CONSUMER_ID }],
  },
  workflow: { consumerId: CONSUMER_ID, bindings: [{ workspace: SCOPE, sessionRole: BUILDER_ROLE,
    roleBinding: BUILDER_BINDING, budget: { tokenBudget: 1000000, deadline: null } }] },
  checks: { configurationRevision: 'demo-checks@1', workspace: WORKSPACE_REF, executor: ACTOR,
    permissionRevision: permissionRevision(SCOPE, ['.']), sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'demo-static', kind: 'static', command: CHECK_COMMAND, cwd: '.', timeoutMs: 30000, taskIds: 'all' }] },
};
const configPath = join(baseDir, 'workbench.json');
await writeFile(configPath, JSON.stringify(config, null, 2));
const loaded = await loadWorkbenchCliConfig(configPath);
const host = await createLocalWorkbenchHost({
  ...loaded,
  runtimeProvider: { registry, secretSource: { get: name => name === SECRET_VAR ? 'demo-scripted-secret-never-sent' : undefined } },
});
const address = await host.listen(port);
const base = address.url;

let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  try { await host.close(); } catch (error) { process.stderr.write(`close failed: ${String(error)}\n`); }
  process.exit(code);
}
process.once('SIGTERM', () => { void shutdown(0); });
process.once('SIGINT', () => { void shutdown(0); });

// ---------------------------------------------------------------------------
// 6. HTTP seed (formal public routes only, strictly sequential).
// ---------------------------------------------------------------------------
const pageHtml = await (await fetch(base)).text();
const token = /<meta name="platform-token" content="([^"]+)">/.exec(pageHtml)?.[1];
if (token === undefined) throw new Error('the workbench page did not expose its token meta');
const log = (step, detail = {}) => process.stderr.write(`${JSON.stringify({ step, ...detail })}\n`);
const asRecord = (value) => (typeof value === 'object' && value !== null ? value : {});
async function post(suffix, body) {
  const response = await fetch(new URL(`/api/real/core/${suffix}`, base), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}
const graphWrite = (scope, input, requestId, expected = []) => ({ scope, request: { input, meta: { requestId, expected } } });
const plain = (scope, input) => ({ scope, input });
async function committed(suffix, body) {
  const { payload } = await post(suffix, body);
  if (asRecord(payload).status !== 'committed') throw new Error(`${suffix} did not commit: ${JSON.stringify(payload)}`);
  return payload.value;
}
async function ready(suffix, body) {
  const { payload } = await post(suffix, body);
  if (asRecord(payload).status !== 'ready') throw new Error(`${suffix} was not ready: ${JSON.stringify(payload)}`);
  return payload.value;
}

async function registerProject(scope, withPolicy) {
  const projectRef = { aggregateType: 'Project', projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace', ...scope };
  await committed('projects/create', graphWrite(scope, { projectId: scope.projectId }, `${scope.projectId}-project`,
    [{ ref: projectRef, revision: 0 }]));
  await committed('workspaces/register', graphWrite(scope, { workspace: scope }, `${scope.projectId}-workspace`,
    [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]));
  if (!withPolicy) return;
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'demo-policy', revision: 1 };
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId };
  const installed = await committed('completion-policies/install', graphWrite(scope, {
    policyId: 'demo-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, 'demo-policy-install', [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }]));
  await committed('completion-policies/activate', graphWrite(scope, {
    target: { ref: installed.ref, digest: installed.contentDigest },
  }, 'demo-policy-activate', [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }]));
}

const moduleRef = moduleId => ({ projectId: SCOPE.projectId, moduleId });
async function adoptArchitecture() {
  await committed('architecture/adopt-initial', graphWrite(SCOPE, {
    baselineId: 'demo-baseline', description: '演示工程的初始模块边界', constraints: [{ name: 'util 不依赖 parser', scope: 'src/util' }],
    catalog: {
      requireDag: true,
      modules: [
        { ref: moduleRef('app'), name: '应用入口', responsibility: '组装解析流程并对外导出 run()', paths: ['src/index.ts'],
          interfaces: [{ id: 'run', description: '按行解析整段文本', paths: ['src/index.ts'] }] },
        { ref: moduleRef('parser'), name: '解析器', responsibility: '把一行 key=value 解析为结构化结果', paths: ['src/parser'], interfaces: [] },
        { ref: moduleRef('util'), name: '文本工具', responsibility: '与业务无关的字符串辅助函数', paths: ['src/util'], interfaces: [] },
        { ref: moduleRef('docs'), name: '文档', responsibility: '使用说明与笔记', paths: ['docs'], interfaces: [] },
      ],
      dependencies: [
        { from: moduleRef('app'), to: moduleRef('parser'), reason: 'run() 调用 parseLine' },
        { from: moduleRef('parser'), to: moduleRef('util'), reason: 'parseLine 使用 trim' },
      ],
      containment: { parentOf: [
        { parent: moduleRef('app'), child: moduleRef('parser') },
        { parent: moduleRef('app'), child: moduleRef('util') },
      ] },
    },
  }, 'demo-architecture', [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }]));
}

async function createGoalWithPlan(goalId, objective, planId, tasks, assignments, extra = {}) {
  await committed('goals/create', graphWrite(SCOPE, { goalId, workspace: SCOPE, objective }, `${goalId}-create`,
    [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }]));
  const goalRef = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId };
  const required = tasks.filter(task => task.requirementLevel === 'required').map(task => task.taskId);
  const draft = {
    schemaVersion: 2, planId, planRevision: 1, goalId, stages: [], tasks, assignments,
    obligations: [{ obligationId: `${goalId}-obligation`, title: '解析结果可用并通过登记检查', requirementLevel: 'required',
      taskIds: required, verificationRequirements: [{ requirementId: 'demo-static', requirementLevel: 'required',
        kind: 'static', description: '登记的静态命令检查' }] }],
    taskHierarchy: { parentOf: extra.parentOf ?? [] }, executionDag: { dependsOn: extra.dependsOn ?? [] },
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await committed('plans/propose', graphWrite(SCOPE, {
    goalRef, basedOn: null, draft, reason: { text: '演示初始计划', sources: [] },
  }, `${goalId}-plan-propose`, []));
  await committed('plans/apply', graphWrite(SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `${goalId}-plan-apply`, []));
}

async function createSession(requestId, role, initialLinks = []) {
  const { payload } = await post('sessions/create', plain(SCOPE, {
    workspace: SCOPE, role, recommendedRefs: [], initialLinks, meta: { requestId, expected: [] },
  }));
  if (asRecord(payload).status !== 'completed') throw new Error(`sessions/create ${requestId}: ${JSON.stringify(payload)}`);
  return { ref: { projectId: payload.value.ref.projectId, sessionId: payload.value.ref.sessionId },
    aggregateRef: payload.value.ref, revision: payload.value.revision };
}

async function runQuery(session, suffix, question) {
  const goal = await ready('goals/read', plain(SCOPE, GOAL_REF));
  const queryJobRef = { aggregateType: 'QueryJob', ...SCOPE, queryJobId: `demo-query-${suffix}` };
  const queryRunRef = { aggregateType: 'QueryRun', ...SCOPE, queryJobId: queryJobRef.queryJobId, runId: `demo-query-run-${suffix}` };
  const intent = { schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId,
    goalId: GOAL_ID, question, focusTaskRefs: [], budget: QUERY_BUDGET, multiTurn: { maxRounds: 1 },
    correlationId: `demo-corr-${suffix}`,
    execution: { kind: 'semantic_query', roleBinding: ADVISOR_BINDING, runtimeBudget: RUNTIME_BUDGET } };
  await committed('queries/submit', graphWrite(SCOPE, { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    `demo-query-submit-${suffix}`, [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 },
      { ref: GOAL_REF, revision: goal.goal.revision }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]));
  const card = await ready('sessions/read', plain(SCOPE, session.ref));
  await committed('queries/claim', graphWrite(SCOPE, { queryRunRef, sessionRef: card.record.ref },
    `demo-query-claim-${suffix}`, [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: card.record.ref, revision: card.record.revision }]));
  const prepared = await ready('queries/prepare', plain(SCOPE, { queryRunRef, requestId: `demo-query-prepare-${suffix}` }));
  await ready('queries/start', plain(SCOPE, { prepared, consumerId: CONSUMER_ID, requestId: `demo-query-start-${suffix}` }));
  for (let attempt = 0; attempt < 200; attempt++) {
    const observed = await ready('queries/observe', plain(SCOPE, { queryRunRef }));
    if (observed.answer !== null) return { queryRunRef, answered: true };
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`query ${suffix} produced no answer`);
}

async function advanceGoal(goalRef, sessionHint, flowId) {
  let input = { schemaVersion: 1, goalRef, flowId, sessionHint, kind: 'select_work' };
  const receipts = [];
  for (let step = 0; step < 80; step++) {
    const value = await ready('workflow/advance', plain(SCOPE, input));
    receipts.push({ state: value.state, receipt: value.receipt?.kind ?? null,
      result: asRecord(value.receipt?.result).status ?? null,
      next: value.next === null ? null : value.next.kind === 'perform' ? value.next.operation.kind : value.next.kind });
    if (value.state === 'completed') return { state: 'completed', receipts };
    if (value.next === null) return { state: value.state, reason: value.reason, receipts };
    input = value.next;
  }
  return { state: 'step_limit', receipts };
}

try {
  await registerProject(SCOPE, true);
  await registerProject(LIB_SCOPE, false);
  await adoptArchitecture();
  await createGoalWithPlan(GOAL_ID, '让解析器返回结构化结果，并补充使用说明', 'demo-plan', [
    { taskId: 'parse-result', title: '解析器返回 ParseResult', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    { taskId: 'usage-doc', title: '补充解析器使用说明', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    { taskId: 'future-cli', title: '命令行入口（未来意图）', requirementLevel: 'optional', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    { taskId: 'goal-gate', title: '目标验收', requirementLevel: 'required', taskKind: 'gate',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ], [
    { taskId: 'parse-result', role: 'builder', instruction: `${PARSE_MARKER}: 新增 src/parser/result.ts 导出 ParseResult 类型` },
    { taskId: 'usage-doc', role: 'builder', instruction: `${DOCS_MARKER}: 在 docs/ 下写解析器使用说明` },
  ], {
    parentOf: [{ parentTaskId: 'usage-doc', childTaskId: 'future-cli' }],
    dependsOn: [{ taskId: 'usage-doc', dependsOnId: 'parse-result', requires: { kind: 'output-contract', label: 'ParseResult 类型' } }],
  });
  log('seeded graph');

  const main = await createSession('demo-main-session', ADVISOR_ROLE);
  const work = await createSession('demo-work-session', BUILDER_ROLE);
  const reviewer = await createSession('demo-reviewer-session', ADVISOR_ROLE,
    [{ target: { kind: 'module', ref: moduleRef('parser') }, relation: 'participates' }]);
  const archived = await createSession('demo-archived-session', ADVISOR_ROLE);
  await committed('sessions/archive', graphWrite(SCOPE, { sessionRef: archived.ref, reason: '演示：已归档的旧顾问会话' },
    'demo-archive', [{ ref: archived.aggregateRef, revision: archived.revision }]));
  log('seeded sessions', { main: main.ref.sessionId, work: work.ref.sessionId, reviewer: reviewer.ref.sessionId, archived: archived.ref.sessionId });

  const mainQuery = await runQuery(main, 'main', MAIN_QUESTION);
  const reviewQuery = await runQuery(reviewer, 'review', REVIEW_QUESTION);
  await committed('messages/send', graphWrite(SCOPE, { recipient: reviewer.ref, text: '请在 usage-doc 完成后复核示例是否与 ParseResult 一致。' },
    'demo-notify', []));
  log('seeded queries and mail');

  const advance = await advanceGoal(GOAL_REF, work.ref, 'demo-flow');
  log('advanced goal', { state: advance.state, steps: advance.receipts.length });

  await createGoalWithPlan(POLL_GOAL_ID, '（轮询观察用）保持一个运行中的执行', 'demo-poll-plan', [
    { taskId: 'poll-work', title: '保持运行（脚本模型阻塞）', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
  ], [{ taskId: 'poll-work', role: 'builder', instruction: `${BLOCK_MARKER}: 等待，直到 Host 关闭` }]);

  const goalRead = await ready('goals/read', plain(SCOPE, GOAL_REF));
  const taskGraph = await ready('tasks/query', plain(SCOPE, { goalRef: GOAL_REF }));
  const state = {
    ready: true,
    url: base,
    port,
    scope: SCOPE,
    libScope: LIB_SCOPE,
    goalId: GOAL_ID,
    pollGoalId: POLL_GOAL_ID,
    goal: Object.fromEntries(Object.entries(asRecord(goalRead.goal)).filter(([, value]) => typeof value !== 'object')),
    goalPhase: goalRead.phase ?? goalRead.goalPhase ?? null,
    goalReadKeys: Object.keys(goalRead),
    tasks: (taskGraph.tasks ?? []).map(row => ({ taskId: row.ref.taskId, phase: row.effectivePhase, disposition: row.disposition })),
    sessions: { main: main.ref.sessionId, work: work.ref.sessionId, reviewer: reviewer.ref.sessionId, archived: archived.ref.sessionId },
    queries: { main: mainQuery, review: reviewQuery },
    queryProfileIds: [ADVISOR_PROFILE_ID],
    advance,
    scriptedCalls: { ...scriptedCalls },
    clock: { base: new RealDate(CLOCK_BASE_MS).toISOString(), stepMs: CLOCK_STEP_MS, ticksAfterSeed: clockTicks },
    uuidsAfterSeed: uuidCounter,
  };
  await writeFile(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(`${JSON.stringify({ ready: true, url: base, state: statePath })}\n`);
} catch (error) {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  await shutdown(1);
}
