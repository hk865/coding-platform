/**
 * RC-02 ContextCompiler — 「code」类必读材料的**窄端口消费**（不是工作区访问实现）。
 *
 * 这一票把「列举／读取／路径边界」的实现移进了 WorkspaceReader（见 tests/data/workspace-path-boundary.test.ts），
 * ContextCompiler 侧只剩消费。这里固定消费面的四条判据，防止它们再被搬回来或被放宽：
 *   1. 信封没有 `read` → 不调用端口（不为了拿到材料而伪造权限）；
 *   2. 信封工作区版本与 canonical Workspace 不一致 → 不调用端口（stale，不用新版本冒充 claim 时的来源）；
 *   3. 端口缺失／不可用／越权 → `unavailable`（由调用方按必读 fail-closed），不退回"没有源码也能开工"；
 *   4. 端口只收到调用方**已解析**的范围：权限、版本、上限、模块路径前缀；它拿不到拒绝前缀，
 *      也无从自行决定路径边界（那是 WorkspaceReader 的能力）。
 */
import { expect, it } from 'vitest';
import { selectCodeMaterial, type CodeMaterialRequest } from '../../src/data/context-compiler/role-source-index.js';
import type { RoleSourceIndexPort, RoleSourceIndexRequestV1, RoleSourceIndexResultV1 } from '../../src/contracts/role-material-channels.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { StateLedger, AggregateSnapshot } from '../../src/contracts/ledger.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';

const PROJECT = 'p-rc02';
const WORKSPACE = 'ws-rc02';
const TASK = 'task-rc02';
const REVISION = 7;

/** 只读 canonical Workspace 版本：消费面唯一的 ledger 依赖（其余聚合一律 not_found）。 */
function ledgerFor(workspaceRevision = REVISION): Pick<StateLedger, 'load'> {
  return {
    load: async (ref) => (ref.aggregateType === 'Workspace'
      ? {
          status: 'found',
          snapshot: {
            ref: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE },
            revision: workspaceRevision,
          } as AggregateSnapshot,
        }
      : { status: 'not_found', ref }),
  };
}

function planWith(moduleRef: string | null): PlanRevisionSnapshot {
  return {
    ref: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-rc02' },
    planRevision: 4,
    tasks: [{
      taskId: TASK,
      scope: moduleRef === null ? { kind: 'stage', stageId: 'stage-1' } : { kind: 'module', moduleRef },
    }],
  } as unknown as PlanRevisionSnapshot;
}

function request(overrides: Partial<CodeMaterialRequest> = {}): CodeMaterialRequest {
  return {
    scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: 'goal-rc02', taskId: TASK, runId: 'run-rc02' },
    planRef: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-rc02' },
    workspaceSnapshot: { workspaceId: WORKSPACE, revision: REVISION },
    permissions: { policyRevision: 'policy-1', tools: ['read'], writeScope: ['*'] },
    ...overrides,
  };
}

function port(result?: (request: RoleSourceIndexRequestV1) => RoleSourceIndexResultV1) {
  const calls: RoleSourceIndexRequestV1[] = [];
  const sourceIndex: RoleSourceIndexPort = {
    readSourceIndex: async (incoming) => {
      calls.push(structuredClone(incoming));
      if (result) return result(incoming);
      return {
        status: 'sourced',
        provenance: { workspace: 'kernel-workspace-identity' },
        entries: [{ path: 'src/app/service.ts' }, { path: 'README.md' }],
        entryCount: 2,
        truncated: false,
        excerpts: [{ path: 'src/app/service.ts', revision: 'rev-service', content: 'export const wired = true;\n' }],
        excerptNotes: [],
      };
    },
  };
  return { sourceIndex, calls };
}

it('端口只收到调用方已解析的候选范围：任务作用域的模块引用按路径形态决定要不要当前缀', async () => {
  const asPath = port();
  const pathResult = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: asPath.sourceIndex }, request(), planWith('src/app'));
  expect(pathResult.status).toBe('supplied');
  expect(asPath.calls[0]!.pathPrefix).toBe('src/app');
  // 端口收到的就是调用方已解析的候选范围：没有拒绝前缀、没有 root、没有可自行扩大的东西。
  expect(Object.keys(asPath.calls[0]!).sort()).toEqual([
    'declaredTools', 'maxEntries', 'maxExcerptBytes', 'maxExcerptFiles', 'pathPrefix',
    'projectId', 'schemaVersion', 'workspaceId', 'workspaceRevision',
  ]);
  expect(asPath.calls[0]!.declaredTools).toEqual(['read']);
  expect(asPath.calls[0]!.workspaceRevision).toBe(REVISION);

  // 单段标识（例如 m-goal-105）在词法上也是"路径形态"：原样交给端口，由端口按索引如实回答
  // "没有匹配路径，只给索引"，不在这里猜目录、也不假装取了正文（既有行为，本票不改）。
  const asId = port();
  const idResult = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: asId.sourceIndex }, request(), planWith('m-goal-105'));
  expect(idResult.status).toBe('supplied');
  expect(asId.calls[0]!.pathPrefix).toBe('m-goal-105');

  // 不是路径形态（含冒号等）的取值**不**当作前缀：不拿它去猜目录。
  const asOpaque = port();
  await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: asOpaque.sourceIndex }, request(), planWith('module:goal-105'));
  expect('pathPrefix' in asOpaque.calls[0]!).toBe(false);
  expect(asOpaque.calls[0]!.workspaceRevision).toBe(REVISION);
});

it('取材结果带来源与版本，资格固定为参考（不是当前事实，也不是完成判据）', async () => {
  const { sourceIndex } = port();
  const result = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex }, request(), planWith('src/app'));
  expect(result.status).toBe('supplied');
  if (result.status !== 'supplied') return;
  const entry = result.entries[0]!;
  expect(entry.kind).toBe('code');
  expect(entry.qualification).toBe('reference');
  expect(entry.selection).toBe('selected');
  expect(entry.digest).toBe(artifactBodyDigest(entry.content));
  expect(entry.sourceRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'workspace', refId: WORKSPACE, revision: String(REVISION) }),
    expect.objectContaining({ kind: 'artifact', refId: 'source-file:src/app/service.ts', revision: 'rev-service' }),
  ]));
  expect(JSON.stringify(entry)).not.toContain('"completed"');
});

it('信封没有 read：不调用端口，按缺失返回（判据在消费面，不在端口里）', async () => {
  const { sourceIndex, calls } = port(() => { throw Error('端口不该被调用：信封没有 read'); });
  const result = await selectCodeMaterial(
    { ledger: ledgerFor(), sourceIndex },
    request({ permissions: { policyRevision: 'policy-1', tools: ['write'], writeScope: ['*'] } }),
    planWith('src/app'),
  );
  expect(result.status).toBe('unavailable');
  expect(result.status === 'unavailable' && result.message).toContain('read');
  expect(calls).toHaveLength(0);
});

it('信封工作区版本与 canonical 不一致：按 stale 处理，不读取', async () => {
  const { sourceIndex, calls } = port();
  const result = await selectCodeMaterial({ ledger: ledgerFor(REVISION + 5), sourceIndex }, request(), planWith('src/app'));
  expect(result.status).toBe('unavailable');
  expect(result.status === 'unavailable' && result.message).toContain('stale');
  expect(calls).toHaveLength(0);
});

it('端口缺失或如实报不可用：都按缺失处理，不退回"没有源码也能开工"', async () => {
  const missing = await selectCodeMaterial({ ledger: ledgerFor() }, request(), planWith('src/app'));
  expect(missing.status).toBe('unavailable');
  expect(missing.status === 'unavailable' && missing.message).toContain('RoleSourceIndexPort');

  const forbidden = port(() => ({ status: 'forbidden', message: '本 Run 的信封工具集不含 read：不读取工作区，也不返回任何路径' }));
  const denied = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: forbidden.sourceIndex }, request(), planWith('src/app'));
  expect(denied).toEqual({ status: 'unavailable', message: '本 Run 的信封工具集不含 read：不读取工作区，也不返回任何路径' });

  const unavailable = port(() => ({ status: 'unavailable', message: '工作区源码索引不可读取：路径不存在' }));
  const broken = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: unavailable.sourceIndex }, request(), planWith('src/app'));
  expect(broken.status).toBe('unavailable');

  // 索引里一个可读条目都没有，也是缺失，不是"工作区是空的"这一结论。
  const empty = port(() => ({ status: 'sourced', provenance: { workspace: 'w' }, entries: [], entryCount: 0, truncated: false, excerpts: [], excerptNotes: [] }));
  const none = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex: empty.sourceIndex }, request(), planWith('src/app'));
  expect(none.status).toBe('unavailable');
  expect(none.status === 'unavailable' && none.message).toContain('没有任何可读条目');
});

it('上限造成的未取全原样交给调用方写进 gaps（消费面不静默裁剪）', async () => {
  const { sourceIndex } = port((incoming) => ({
    status: 'sourced',
    provenance: { workspace: 'w' },
    entries: [{ path: 'src/app/service.ts' }],
    entryCount: 1,
    truncated: true,
    excerpts: [],
    excerptNotes: ['索引清单达到上限 ' + incoming.maxEntries + ' 条：未列出的路径不在本次材料内'],
  }));
  const result = await selectCodeMaterial({ ledger: ledgerFor(), sourceIndex }, request(), planWith('src/app'));
  expect(result.status).toBe('supplied');
  expect(result.status === 'supplied' && result.notes).toEqual(['索引清单达到上限 512 条：未列出的路径不在本次材料内']);
});
