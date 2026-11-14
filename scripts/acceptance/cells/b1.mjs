// B1 (128k window → 64000): its own Host and ledger (WB), the same model as A1 (ruling 14:0x §9.6) with the
// profile's and the binding's `contextWindowTokens=128000` — the only place a window is set is the trusted start
// configuration (settings models carry no window, `host-settings.ts:1044-1105`; the built-in local budget is 1M for
// `deepseek-flash`, `host.ts:442-447`). So WB declares one config workspace and one adviser binding/profile for it
// (`runtime-configuration.ts:154-191`; both budgets set, spec :708); `models/select` later swaps that binding's model
// (`host.ts:2016-2024`). The config workspace needs `projects/create` + `workspaces/register` first (`host.ts:2644-2663`).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { workbenchConfig } from '../lib/host.mjs';
import { broken, gitFacts, sha256, writeFiles } from '../lib/flows.mjs';
import { Abort } from '../lib/report.mjs';
import { cellChecks, planningCell, PROBE_FILES } from './a1.mjs';

const SCOPE = { projectId: 'g6-wb', workspaceId: 'g6-wb-ws' };
const ADVISER_ROLE = { kind: 'legacy_template', templateId: 'platform-adviser', templateRevision: 's3.1' };
const WORK_ROLE = { kind: 'legacy_template', templateId: 'g6-wb-builder', templateRevision: '1' };
const INSTRUCTION = 'G6 B1 adviser: plan the next segment of the Goal you are given.';

/** The WB start configuration: one config workspace, one adviser binding + profile with the 128k window. */
export function wbConfig(cfg, dir, tree) {
  const cell = cfg.cells.B1;
  const seed = cfg.host.settingsModels.find(model => model.id === cell.modelId);
  if (seed === undefined) throw new Abort('entry-missing', `cells.B1.modelId ${cell.modelId} is not in host.settingsModels`);
  const budget = { contextWindowTokens: cell.contextWindowTokens, perResponseTokens: cell.reservedOutput, inputTokens: null,
    outputTokens: cell.outputTokens, maxRequests: null, maxToolCalls: null, timeoutMs: null };
  const binding = {
    id: 'g6-wb-adviser', label: 'G6 B1 adviser', scope: SCOPE, role: ADVISER_ROLE, configurationRevision: 'g6-wb-adviser@1',
    model: { revision: 'g6-wb-model@1', provider: seed.provider, model: seed.model,
      ...(seed.baseUrl === undefined ? {} : { baseUrl: seed.baseUrl }), secretEnvironmentVariable: seed.secretEnvironmentVariable },
    grant: { budget, hostTemplate: { templateId: ADVISER_ROLE.templateId, revision: ADVISER_ROLE.templateRevision, digest: sha256(INSTRUCTION) },
      tools: ['read', 'record_note'], writeScope: [], skills: { resourceRoot: join(tree, 'vendor/coding-agent/resources/skills'), enabledIds: [] },
      systemInstruction: INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null },
  };
  const profile = {
    id: 'g6-wb-adviser-query', label: 'G6 B1 adviser', scope: SCOPE, runtimeBindingId: binding.id, sessionRole: ADVISER_ROLE,
    roleBinding: { schemaVersion: 1, bindingId: binding.id, templateId: ADVISER_ROLE.templateId, templateRevision: ADVISER_ROLE.templateRevision,
      bindingVersion: 1, policyRevision: binding.configurationRevision },
    runtimeBudget: budget, budget: { maxTokens: null, deadline: null }, consumerId: 'local-workbench-consumer',
  };
  return workbenchConfig({
    settingsModels: cfg.host.settingsModels,
    workspaces: [{ scope: SCOPE, name: 'g6-wb', root: join(dir, 'projects', 'b1'), workspaceRevision: 1, readPrefixes: ['.'] }],
    runtime: { schemaVersion: 1, bindings: [binding], queryProfiles: [profile] },
    extra: {
      kernelStores: { entries: [{ adapterId: 'g6-wb-kernel', storeKey: 'g6-wb-kernel-store', workspace: SCOPE, databasePath: join(dir, 'data', 'kernel-wb.sqlite') }] },
      workflow: { consumerId: 'local-workbench-consumer', bindings: [{ workspace: SCOPE, sessionRole: WORK_ROLE,
        roleBinding: { schemaVersion: 1, bindingId: 'g6-wb-builder', templateId: WORK_ROLE.templateId, templateRevision: WORK_ROLE.templateRevision,
          bindingVersion: 1, policyRevision: 'g6-wb' }, budget: { tokenBudget: 1_000_000, deadline: null } }] },
    },
  });
}

const def = { id: 'B1', host: 'wb', rows: ['C-214'], checks: [...cellChecks(64000),
  { id: 'fits', rows: ['C-214'], text: '输入 + 64000 预留装得下（没有 ContextCapacityExceeded）' }] };

async function run(ctx, rec) {
  const cell = ctx.cfg.cells.B1;
  const dir = join(ctx.runRoot, 'wb');
  const root = join(dir, 'projects', 'b1');
  mkdirSync(root, { recursive: true });
  writeFiles(root, PROBE_FILES);
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'g6@example.invalid'], ['config', 'user.name', 'g6'], ['add', '-A'], ['commit', '-q', '-m', 'b1: initial files']]) {
    execFileSync('git', args, { cwd: root });
    ctx.report.command(`git ${args.join(' ')} (in ${root}) -> 0`);
  }
  ctx.budget.own(SCOPE, rec.id);
  const host = await ctx.start('wb', wbConfig(ctx.cfg, dir, ctx.tree));
  try {
    const created = await host.client.write('projects/create', SCOPE, { projectId: SCOPE.projectId },
      [{ ref: { aggregateType: 'Project', projectId: SCOPE.projectId }, revision: 0 }]);
    const registered = await host.client.write('workspaces/register', SCOPE, { workspace: SCOPE },
      [{ ref: { aggregateType: 'Project', projectId: SCOPE.projectId }, revision: 1 }, { ref: { aggregateType: 'Workspace', ...SCOPE }, revision: 0 }]);
    if (created?.status !== 'committed' || registered?.status !== 'committed') {
      throw broken(ctx, `projects/create ${created?.code ?? created?.status} ${created?.reason ?? ''}, workspaces/register ${registered?.code ?? registered?.status} ${registered?.reason ?? ''}`);
    }
    const project = { name: 'b1', root, scope: SCOPE, initial: gitFacts(ctx, root), host };
    rec.projects.push(project);
    await planningCell(ctx, rec, { project, modelId: cell.modelId, window: cell.contextWindowTokens, target: cell.reservedOutput,
      cumulative: cell.outputTokens });
    const reported = rec.facts.requests?.[0];
    if (reported === undefined) rec.uncover('fits', 'capability-unsupported', '没有发出请求：输入加预留装不下或没进入（spec :720，不改窗口迁就）');
    else rec.pass('fits', `请求发出（reservedInput 以内），reservedOutput ${reported.reservedOutput}`);
  } finally {
    await ctx.close('wb');
  }
}

export default { ...def, run };
