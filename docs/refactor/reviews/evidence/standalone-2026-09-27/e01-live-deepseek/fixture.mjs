/** Temporary real-provider E01 fixture. Uses the production Host/Kernel/owners.
 * Only the initial broken source and public bootstrap inputs are initialized.
 * The built-in DeepSeek provider supplies every model response; diagnostics
 * observe public outcomes only. Credentials are read into memory, never saved.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const usage = 'node fixture.mjs --start --next-root <PHYSICAL_BUILD> --key-file <LOCAL_KEY_FILE> [--output </tmp/NEW_DIRECTORY>]';
if (!argv.includes('--start')) {
  console.log(usage);
  console.log('Prepared only. This invocation did not start a Host or initialize domain records.');
  process.exit(0);
}
function option(name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return value;
}
const nextInput = option('--next-root');
if (nextInput === undefined || !isAbsolute(nextInput)) throw new Error(usage);
const nextRoot = resolve(nextInput);
const outputInput = option('--output');
if (outputInput !== undefined && (!isAbsolute(outputInput) || !resolve(outputInput).startsWith('/tmp/')))
  throw new Error('--output must be a fresh directory below /tmp');
const output = outputInput === undefined
  ? await mkdtemp('/tmp/coding-platform-live-model-review-')
  : resolve(outputInput);
if (outputInput !== undefined) {
  const parent = await realpath(dirname(output));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('--output parent must resolve below /tmp');
  await mkdir(output); // EEXIST is fatal: never reuse/reset a populated fixture.
}
const sourceRoot = join(output, 'source');
const storageRoot = join(output, 'storage');
await mkdir(join(sourceRoot, 'src'), { recursive: true });
await mkdir(storageRoot);
const sourcePath = join(sourceRoot, 'src/module.ts');
// Valid TypeScript which is also ordinary ESM JavaScript: the sandbox's Node 18
// can execute the actual saved source without importing a second transpiler.
const initialSource = 'export const total = [2, 3, 5].reduce((sum, value) => sum - value, 0);\n'
  + 'export const doubled = [1, 2, 3].map(value => value + 2);\n';
await writeFile(sourcePath, initialSource); // Only the pre-task source is initialized by the fixture.
await writeFile(join(sourceRoot, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
}, null, 2) + '\n');

const publicDir = join(nextRoot, 'dist/app/public/workbench');
await stat(join(publicDir, 'index.html'));
const hash = value => createHash('sha256').update(value).digest('hex');
const { createBuiltinProviderRegistry } = await import(pathToFileURL(join(nextRoot, 'vendor/coding-agent/dist/public-api.js')).href);
const { loadWorkbenchCliConfig } = await import(pathToFileURL(join(nextRoot, 'dist/app/main.js')).href);
const { createLocalWorkbenchHost } = await import(pathToFileURL(join(nextRoot, 'dist/app/host.js')).href);
const { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_META_NAME } =
  await import(pathToFileURL(join(nextRoot, 'dist/app/core-http-types.js')).href);

const scope = { projectId: 'r6-host-project', workspaceId: 'r6-host-workspace' };
const actor = { kind: 'human', id: 'r6x-operator' };
const projectRef = { aggregateType: 'Project', projectId: scope.projectId };
const workspaceRef = { aggregateType: 'Workspace', ...scope };
const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'r6x-goal' };
const objective = '修复 src/module.ts 的求和与翻倍错误，再提取求和输入数组并保留行为；total 应为 10、doubled 应为 [2,4,6]。两项工作都修改实际文件，并通过实际产物检查与正式目标验收';
const secretName = 'DEEPSEEK_API_KEY';
const keyFile = option('--key-file');
if (!keyFile || !isAbsolute(keyFile)) throw new Error('--key-file requires a local absolute path');
const keyText = await readFile(keyFile, 'utf8');
const keyCandidates = [...new Set(keyText.match(/sk-[A-Za-z0-9_-]+/g) ?? [])];
if (keyCandidates.length !== 1) throw new Error('Exactly one configured DeepSeek key is required');
const fixtureSecret = keyCandidates[0];
const queryInstruction = 'You are the read-only planning advisor for a small coding task. Inspect src/module.ts with project_source. The available executing role is builder. A registered static check runs the actual saved module and requires total=10 and doubled=[2,4,6] after each work and at the final goal gate. The user authorizes two sequential coding works and a goal gate. Use the formal plan output contract supplied in the Query input; do not invent execution results.';
const workInstruction = 'E01 trusted work: use read then edit to repair the assigned expression in src/module.ts, preserve the other work, and report the real edit result. The Host runs the registered checks after each Work exits and at the goal gate; these checks are not files in this workspace and no shell capability is granted. Do not search for or modify check implementations, and never invent outcomes.';
const queryRole = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const workRole = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const queryRoleBinding = { schemaVersion: 1, bindingId: 'r6x-query-role-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workRoleBinding = { schemaVersion: 1, bindingId: 'r6x-work-role-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const budget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 12, timeoutMs: 90000, perResponseTokens: 8192 };
const skillsRoot = join(nextRoot, 'vendor/coding-agent/resources/skills');
// The real built-in provider receives unmodified formal Kernel requests.
// Diagnostics record only counters, public tool outcomes and actual file hashes.
let providerCalls = 0;
const liveEvents = [];
const builtinRegistry = createBuiltinProviderRegistry();
const registry = {
  get: id => builtinRegistry.get(id),
  create(id, context) {
    const client = builtinRegistry.create(id, context);
    return { async *stream(request, options) {
      providerCalls += 1;
      const call = providerCalls;
      const toolResults = request.messages.filter(m => m.role === 'tool').map(m => ({callId:m.callId,status:m.result.status,errorCode:m.result.error?.code}));
      const content = await readFile(sourcePath, 'utf8');
      await writeFile(join(output, 'provider-count.json'), JSON.stringify({attemptedCalls:providerCalls,model:'deepseek-flash'},null,2)+'\n');
      liveEvents.push({call,requestId:request.requestId,runId:request.runId,toolResults,fileSha256:hash(content),startedAt:new Date().toISOString()});
      await writeFile(join(output, 'live-events.json'), JSON.stringify(liveEvents,null,2)+'\n');
      for await (const event of client.stream(request, options)) {
        if (['completed','truncated','error','cancelled'].includes(event.type)) {
          liveEvents.push({call,type:event.type,reason:event.reason??null,errorCode:event.error?.code??null,at:new Date().toISOString()});
          await writeFile(join(output, 'live-events.json'),JSON.stringify(liveEvents,null,2)+'\n');
        }
        yield event;
      }
    }};
  },
};
await writeFile(join(output, 'provider-count.json'),JSON.stringify({attemptedCalls:0,model:'deepseek-flash'},null,2)+'\n');
// These commands read and execute the actual persisted module. No constant PASS,
// fixture callback, source rewrite or second implementation supplies the result.
// Node 18 in the real process sandbox is enough for this JS-compatible .ts input.
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function checkCommand(stage, checkTotal, checkDoubled) {
  const code = [
    "const fs=require('node:fs'); const assert=require('node:assert/strict'); const crypto=require('node:crypto');",
    "(async()=>{ const source=fs.readFileSync('src/module.ts','utf8');",
    "const actual=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));",
    checkTotal ? "assert.equal(actual.total,10,'total must sum the saved input');" : '',
    checkDoubled ? "assert.deepEqual(actual.doubled,[2,4,6],'doubled must multiply each saved value');" : '',
    `console.log(JSON.stringify({kind:'E01_ACTUAL_MODULE_CHECK',stage:${JSON.stringify(stage)},path:'src/module.ts',sha256:crypto.createHash('sha256').update(source).digest('hex'),total:actual.total,doubled:actual.doubled}));`,
    "})().catch(error=>{console.error(error.message);process.exitCode=1;});",
  ].join('\n');
  return '/usr/bin/node -e ' + shellQuote(code);
}
const grant = (role, instruction, tools) => ({
  budget, hostTemplate: { templateId: role.templateId, revision: role.templateRevision, digest: hash(instruction) },
  tools, writeScope: tools.includes('write') ? ['.'] : [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
  systemInstruction: instruction, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
});
const runtime = {
  schemaVersion: 1,
  bindings: [
    { id: 'r6x-query-binding', label: '调查执行配置', scope, role: queryRole,
      configurationRevision: 'r6x-query-host@1',
      model: { revision: 'r6x-query-model@1', provider: 'deepseek', model: 'deepseek-flash', secretEnvironmentVariable: secretName, options: {thinking:'disabled'} },
      grant: grant(queryRole, queryInstruction, ['read', 'project_source']) },
    { id: 'r6x-work-binding', label: '工作执行配置', scope, role: workRole,
      configurationRevision: 'r6x-work-host@1',
      model: { revision: 'r6x-work-model@1', provider: 'deepseek', model: 'deepseek-flash', secretEnvironmentVariable: secretName, options: {thinking:'disabled'} },
      grant: grant(workRole, workInstruction, ['read', 'write']) },
  ],
  queryProfiles: [{ id: 'r6x-investigate', label: '只读调查与初始规划', scope,
    runtimeBindingId: 'r6x-query-binding', sessionRole: queryRole, roleBinding: queryRoleBinding,
    runtimeBudget: budget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'r6x-consumer' }],
};
const readPrefixes = ['.']; // The entire fresh toy root is in this acceptance scope.
const permissionRevision = `host-permission-v1:${hash(JSON.stringify({
  subject: actor, scope, readPrefixes: [...new Set(readPrefixes)].sort(),
}))}`;
const config = {
  sqliteDirectory: storageRoot,
  actor,
  workspaces: [{ scope, name: '真实 DeepSeek 临时代码验收', root: sourceRoot, workspaceRevision: 1, readPrefixes }],
  architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
  kernelStores: { entries: [{ adapterId: 'r6x-kernel', storeKey: 'r6x-kernel-store', workspace: scope,
    databasePath: join(storageRoot, 'kernel.sqlite') }] },
  // Review offers a navigation hint only. The same Goal is actually created by
  // the public HTTP owner below; the UI must read its formal record/revision.
  review: { notes: '临时正常链的目标入口；状态以正式读取为准。', goals: [{ goalId: goalRef.goalId, objective }] },
  runtime,
  checks: {
    configurationRevision: 'e01-coding-checks-1', workspace: workspaceRef, executor: actor,
    permissionRevision, sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    // Current producer maps all registered checks into each round; do not rely
    // on taskIds-specific filtering. One real behavior contract applies to both
    // coding steps and to the independent Goal gate.
    checks: [{ checkId: 'e01-module-behavior', kind: 'static', command: checkCommand('saved-module', true, true),
      cwd: '.', timeoutMs: 60000, taskIds: 'all' }],
  },
  workflow: { consumerId: 'r6x-consumer', bindings: [{ workspace: scope, sessionRole: workRole,
    roleBinding: workRoleBinding, budget: { tokenBudget: 100000, deadline: null } }] },
};
const configPath = join(output, 'workbench.json');
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
const loaded = await loadWorkbenchCliConfig(configPath);
const host = await createLocalWorkbenchHost({
  ...loaded, publicDir,
  runtimeProvider: { registry, secretSource: { get: name => name === secretName ? fixtureSecret : undefined } },
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.close();
}
process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
const receipts = [];
try {
  const address = await host.listen(0);
  const base = new URL(address.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Host did not publish a loopback address');
  const page = await fetch(base);
  if (!page.ok) throw new Error(`Host page status ${page.status}`);
  const html = await page.text();
  const token = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html)?.[1];
  if (!token) throw new Error('Host page did not expose its normal per-instance token');
  async function post(route, body, wanted) {
    const response = await fetch(new URL(CORE_API_PREFIX + route, base), {
      method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    receipts.push({ route, request: body, httpStatus: response.status, result });
    await writeFile(join(output, 'initialization-receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
    if (!response.ok || result.status !== wanted) throw new Error(`${route}: ${response.status}, ${result.status}, ${result.reason ?? ''}`);
    return result.value;
  }
  const graphWrite = (input, requestId, expected) => ({ scope, request: { input, meta: { requestId, expected } } });
  const plain = input => ({ scope, input });
  const project = await post('projects/create', graphWrite({ projectId: scope.projectId }, 'r6x-project-1',
    [{ ref: projectRef, revision: 0 }]), 'committed');
  const workspace = await post('workspaces/register', graphWrite({ workspace: scope }, 'r6x-workspace-1',
    [{ ref: projectRef, revision: project.revision }, { ref: workspaceRef, revision: 0 }]), 'committed');
  await post('goals/create', graphWrite({ goalId: goalRef.goalId, workspace: scope, objective }, 'r6x-goal-1',
    [{ ref: projectRef, revision: project.revision }, { ref: workspaceRef, revision: workspace.revision }]), 'committed');
  const registration = await post('workspaces/registration', plain(scope), 'ready');
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'r6x-policy', revision: 1 };
  const policy = await post('completion-policies/install', graphWrite({
    policyId: policyRef.policyId, contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, 'r6x-policy-install', [{ ref: projectRef, revision: registration.project.revision }, { ref: policyRef, revision: 0 }]), 'committed');
  await post('completion-policies/activate', graphWrite({ target: { ref: policy.ref, digest: policy.contentDigest } },
    'r6x-policy-active', [{ ref: projectRef, revision: registration.project.revision },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 0 }]), 'committed');
  await post('architecture/adopt-initial', graphWrite({
    baselineId: 'r6x-baseline', description: 'R6 execution-entry boundary', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: scope.projectId, moduleId: 'r6x' },
      name: 'R6 execution entry', responsibility: 'Consume the answer and advance', paths: ['src'], interfaces: [] }] },
  }, 'r6x-adopt', [{ ref: projectRef, revision: registration.project.revision },
    { ref: workspaceRef, revision: registration.workspace.revision }]), 'committed');
  if (providerCalls !== 0) throw new Error('A provider call occurred before browser Query input');
  const manifest = {
    createdAt: new Date().toISOString(), nextRoot, output, sourceRoot, storageRoot,
    publicDir, configPath, address: address.url, scope, goalRef, objective,
    initialization: 'public HTTP owners only; no Query/Session/Run/answer/terminal seeded',
    status: 'ready_for_manual_browser_input', providerCallsBeforeBrowser: providerCalls,
    provider: 'live DeepSeek flash',
    coding: { sourcePath, initialSha256: hash(initialSource),
      expectedExports: { total: 10, doubled: [2, 4, 6] },
      writeAuthority: 'trusted Work tools=[read,write], writeScope=[.] only in this new temporary source root',
      evidenceFiles: ['live-events.json', 'provider-count.json'],
      checks: config.checks.checks.map(item => ({ checkId: item.checkId, taskIds: item.taskIds, command: item.command })),
      conclusion: 'unverified_until_actual_browser_run_formal_checks_and_goal_completion_are_read',
    },
  };
  await writeFile(join(output, 'fixture.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(output, 'address.json'), JSON.stringify({ url: address.url }, null, 2) + '\n');
  console.log(JSON.stringify({ url: address.url, directory: output, goalId: goalRef.goalId }));
} catch (error) {
  await writeFile(join(output, 'startup-failure.json'), JSON.stringify({
    message: error instanceof Error ? error.message : String(error), initializedRoutes: receipts.map(item => item.route),
  }, null, 2) + '\n');
  await close();
  throw error;
}
