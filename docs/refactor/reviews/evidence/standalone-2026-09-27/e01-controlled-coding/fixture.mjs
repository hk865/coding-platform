/**
 * Temporary E01 coding manual-browser fixture, not a product entry or test suite.
 * The real Kernel reads/edits a fresh /tmp workspace; registered checks execute
 * the actual saved module. Fixture callbacks only observe successful tool results.
 * Uses the approved R6 Host normal-chain inputs and the EXISTING scripted
 * ModelClientPort helper. No Query/Run/terminal/answer is seeded or written here.
 * Run only after the final physical build is supplied by the main reviewer.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const usage = 'node /tmp/coding-platform-e01-coding-start.mjs --start --next-root <FINAL_PHYSICAL_NEXT> [--fixture-root <APPROVED_NEXT_WITH_TESTS>] [--output </tmp/NEW_DIRECTORY>]';
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
const fixtureRoot = resolve(option('--fixture-root') ?? nextRoot);
const outputInput = option('--output');
if (outputInput !== undefined && (!isAbsolute(outputInput) || !resolve(outputInput).startsWith('/tmp/')))
  throw new Error('--output must be a fresh directory below /tmp');
const output = outputInput === undefined
  ? await mkdtemp('/tmp/coding-platform-e01-coding-review-')
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
const firstSource = initialSource.replace('sum - value', 'sum + value').replace('value + 2', 'value * 2');
const finalSource = 'export const inputs = [2, 3, 5];\n'
  + firstSource.replace('[2, 3, 5].reduce', 'inputs.reduce');
await writeFile(sourcePath, initialSource); // Only the pre-task source is initialized by the fixture.
await writeFile(join(sourceRoot, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
}, null, 2) + '\n');

const publicDir = join(nextRoot, 'dist/app/public/workbench');
await stat(join(publicDir, 'index.html'));
const requireFromBuild = createRequire(join(nextRoot, 'package.json'));
const ts = requireFromBuild('typescript');
const hash = value => createHash('sha256').update(value).digest('hex');
const hashes = {};

// Extract the exact named function bodies from the existing acceptance sources.
// Transpilation only removes TS syntax. This does not import/run other fixture
// helpers (in particular, no raw-store or overwrite helper is reachable).
async function importExistingFunction(relative, name, outputName) {
  const sourcePath = join(fixtureRoot, relative);
  const source = await readFile(sourcePath, 'utf8');
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (node === undefined) throw new Error(`Cannot find existing function ${name} in ${sourcePath}`);
  const exactFunction = node.getText(ast);
  const transformed = ts.transpileModule(exactFunction + `\nexport { ${name} as selected };\n`, {
    compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
  });
  const generated = join(output, outputName);
  await writeFile(generated, transformed.outputText);
  hashes[relative] = { sourcePath, sha256: hash(source), function: name, functionSha256: hash(exactFunction) };
  return (await import(pathToFileURL(generated).href)).selected;
}
const createScriptedModel = await importExistingFunction(
  'tests/helpers/B2-runtime-fixture.ts', 'createScriptedModel', 'existing-scripted-model.mjs');
const executionPlanAnswer = await importExistingFunction(
  'tests/app/R6-host.test.ts', 'executionPlanAnswer', 'existing-r6-plan-answer.mjs');
const { ProviderRegistry } = await import(pathToFileURL(join(nextRoot, 'vendor/coding-agent/dist/public-api.js')).href);
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
const secretName = 'R6X_CONTROLLED_SECRET';
// A literal fixture sentinel only. Never consult process.env or a real secret.
const fixtureSecret = 'r6x-controlled-secret-value';
const queryInstruction = 'R6 execution trusted read-only query guidance';
const workInstruction = 'E01 trusted work: use read then edit to repair the assigned expression in src/module.ts, preserve the other work, and report the real edit result. Never modify checks or invent outcomes.';
const queryRole = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const workRole = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const queryRoleBinding = { schemaVersion: 1, bindingId: 'r6x-query-role-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workRoleBinding = { schemaVersion: 1, bindingId: 'r6x-work-role-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const budget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const skillsRoot = join(nextRoot, 'vendor/coding-agent/resources/skills');
// Keep the original accepted Plan shape/IDs and official adoption path; change
// only the task instructions/obligation to describe this controlled coding input.
const planAnswer = JSON.parse(executionPlanAnswer());
planAnswer.summary = 'Repair actual module behavior, then extract reusable input without regressing it';
planAnswer.plan.tasks.find(task => task.taskId === 'r6x-work-1').title = 'Fix total and doubled in src/module.ts';
planAnswer.plan.tasks.find(task => task.taskId === 'r6x-work-2').title = 'Extract reusable inputs while preserving module behavior';
planAnswer.plan.assignments.find(item => item.taskId === 'r6x-work-1').instruction =
  'Read src/module.ts, fix sum - value to sum + value and value + 2 to value * 2 in one revision-pinned edit, and report the actual result.';
planAnswer.plan.assignments.find(item => item.taskId === 'r6x-work-2').instruction =
  'Read the first work in src/module.ts, extract export const inputs = [2, 3, 5] and make total reduce inputs; retain total=10 and doubled=[2,4,6], then report the real edit.';
planAnswer.plan.obligations[0].title = 'Actual module exports total=10 and doubled=[2,4,6]';
planAnswer.plan.obligations[0].verificationRequirements[0].description =
  'The same registered check executes the actual saved module after each Work and at the final gate, asserting total=10 and doubled=[2,4,6].';
const replies = [
  { kind: 'calls', calls: [{ callId: 'r6x-source-1', name: 'project_source',
    args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
  { kind: 'text', text: JSON.stringify(planAnswer) },
  { kind: 'calls', calls: [{ callId: 'e01-work-1-read', name: 'read', args: { path: 'src/module.ts', maxBytes: 8192 } }] },
  { kind: 'calls', calls: [{ callId: 'e01-work-1-edit', name: 'edit', args: {
    mode: 'replace', path: 'src/module.ts', oldText: initialSource, newText: firstSource,
  } }] },
  { kind: 'text', text: 'Read and edited src/module.ts through Kernel edit: corrected sum and doubled expressions. The registered check must establish the actual module behavior.' },
  { kind: 'calls', calls: [{ callId: 'e01-work-2-read', name: 'read', args: { path: 'src/module.ts', maxBytes: 8192 } }] },
  { kind: 'calls', calls: [{ callId: 'e01-work-2-edit', name: 'edit', args: {
    mode: 'replace', path: 'src/module.ts', oldText: firstSource, newText: finalSource,
  } }] },
  { kind: 'text', text: 'Read the prior work and edited src/module.ts through Kernel edit: extracted reusable inputs and retained the corrected exports. Formal completion requires the actual module check.' },
];
const fileObservations = [{ stage: 'initial_before_query', sha256: hash(initialSource),
  content: initialSource, observedAt: new Date().toISOString() }];
const toolObservations = [];
await writeFile(join(output, 'file-observations.json'), JSON.stringify(fileObservations, null, 2) + '\n');
await writeFile(join(output, 'tool-observations.json'), JSON.stringify(toolObservations, null, 2) + '\n');
function savedToolResult(request, callId) {
  // Inspect ONLY the named public tool result, never assistant reasoning or
  // request bodies. The existing model helper passes the real ModelRequest.
  const entry = request.messages.findLast(message => message.role === 'tool' && message.callId === callId);
  if (entry?.result.status !== 'success') throw new Error(`Expected successful real tool result ${callId}`);
  return entry.result;
}
function jsonPart(result) {
  return result.output.find(part => part.kind === 'json' && part.value?.path === 'src/module.ts')?.value;
}
async function observeFile(stage, expected) {
  const content = await readFile(sourcePath, 'utf8');
  if (content !== expected) throw new Error(`E01 fixture observed unexpected actual file at ${stage}`);
  fileObservations.push({ stage, sha256: hash(content), content, observedAt: new Date().toISOString() });
  await writeFile(join(output, 'file-observations.json'), JSON.stringify(fileObservations, null, 2) + '\n');
}
const scripted = createScriptedModel(replies, async (request, index, signal) => {
  signal.throwIfAborted();
  await writeFile(join(output, 'provider-count.json'), JSON.stringify({
    attemptedCalls: index + 1, suppliedReplies: replies.length,
  }, null, 2) + '\n');
  if (index === 3 || index === 6) {
    const ordinal = index === 3 ? 1 : 2;
    const result = savedToolResult(request, `e01-work-${ordinal}-read`);
    const read = jsonPart(result);
    if (typeof read?.revision !== 'string' || !/^[a-f0-9]{64}$/.test(read.revision))
      throw new Error('Kernel read did not return the required exact file revision');
    const expected = ordinal === 1 ? initialSource : firstSource;
    if (read.revision !== hash(expected)) throw new Error('Kernel read revision did not match the expected actual stage');
    // Existing helper reads the next reply AFTER this callback, so supply the
    // genuine latest read revision, never a fabricated/static edit permission.
    replies[index].calls[0].args.expectedRevision = read.revision;
    toolObservations.push({ callId: result.callId, status: result.status,
      path: read.path, revision: read.revision, source: 'real_model_request_tool_result' });
  }
  if (index === 4 || index === 7) {
    const ordinal = index === 4 ? 1 : 2;
    const result = savedToolResult(request, `e01-work-${ordinal}-edit`);
    const edit = jsonPart(result);
    if (edit?.newRevision !== hash(ordinal === 1 ? firstSource : finalSource)
      || result.effects.sideEffect !== 'confirmed' || !result.effects.changedPaths.includes('src/module.ts'))
      throw new Error('Kernel edit did not confirm the expected actual file change');
    toolObservations.push({ callId: result.callId, status: result.status,
      path: edit.path, oldRevision: edit.oldRevision, newRevision: edit.newRevision,
      effects: result.effects, source: 'real_model_request_tool_result' });
    await observeFile(`after_kernel_edit_${ordinal}`, ordinal === 1 ? firstSource : finalSource);
  }
  await writeFile(join(output, 'tool-observations.json'), JSON.stringify(toolObservations, null, 2) + '\n');
  signal.throwIfAborted();
});
await writeFile(join(output, 'provider-count.json'), JSON.stringify({ attemptedCalls: 0, suppliedReplies: replies.length }, null, 2) + '\n');
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
const registry = new ProviderRegistry().register({
  id: 'deepseek', secretEnvironmentVariable: secretName, defaultBaseUrl: 'https://invalid.test',
  capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => scripted.client,
});
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
      model: { revision: 'r6x-query-model@1', provider: 'deepseek', model: 'r6x-scripted-query', secretEnvironmentVariable: secretName },
      grant: grant(queryRole, queryInstruction, ['read', 'project_source']) },
    { id: 'r6x-work-binding', label: '工作执行配置', scope, role: workRole,
      configurationRevision: 'r6x-work-host@1',
      model: { revision: 'r6x-work-model@1', provider: 'deepseek', model: 'r6x-scripted-work', secretEnvironmentVariable: secretName },
      grant: grant(workRole, workInstruction, ['read', 'write']) },
  ],
  queryProfiles: [{ id: 'r6x-investigate', label: '只读调查与初始规划', scope,
    runtimeBindingId: 'r6x-query-binding', sessionRole: queryRole, roleBinding: queryRoleBinding,
    runtimeBudget: budget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'r6x-consumer' }],
};
const readPrefixes = ['src'];
const permissionRevision = `host-permission-v1:${hash(JSON.stringify({
  subject: actor, scope, readPrefixes: [...new Set(readPrefixes)].sort(),
}))}`;
const config = {
  sqliteDirectory: storageRoot,
  actor,
  workspaces: [{ scope, name: 'E01 临时真实代码修改验收', root: sourceRoot, workspaceRevision: 1, readPrefixes }],
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
  if (scripted.calls() !== 0) throw new Error('A provider call occurred before browser Query input');
  const manifest = {
    createdAt: new Date().toISOString(), nextRoot, fixtureRoot, output, sourceRoot, storageRoot,
    publicDir, configPath, address: address.url, scope, goalRef, objective,
    initialization: 'public HTTP owners only; no Query/Session/Run/answer/terminal seeded',
    status: 'ready_for_manual_browser_input', providerCallsBeforeBrowser: scripted.calls(),
    suppliedReplies: replies.length, inputSources: hashes,
    coding: { sourcePath, initialSha256: hash(initialSource), firstSha256: hash(firstSource), finalSha256: hash(finalSource),
      expectedExports: { total: 10, doubled: [2, 4, 6] },
      writeAuthority: 'trusted Work tools=[read,write], writeScope=[.] only in this new temporary source root',
      evidenceFiles: ['file-observations.json', 'tool-observations.json', 'provider-count.json'],
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
