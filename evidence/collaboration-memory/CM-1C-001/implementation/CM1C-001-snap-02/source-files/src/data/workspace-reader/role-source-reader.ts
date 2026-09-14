/**
 * RC-02 WorkspaceReader — 角色必读材料「code」通道的**宿主侧有界源码索引**读取。
 *
 * 本文件是从 `data/context-compiler/role-source-index.ts` **归位**过来的实现（RC-02）：
 * 它做的是工作区列举、读取与路径边界适配，而 module-boundaries 把「路径边界、来源 pin、
 * 索引/工具适配」划给 WorkspaceReader。ContextCompiler 侧现在只消费窄端口
 * （`contracts/role-material-channels.ts` 的 `RoleSourceIndexPort`），不再持有实现。
 *
 * ── 不变的是能力，不是新开一条读取路径 ───────────────────────────────────────
 * 真实工作区的读取能力属于 WorkspaceReader 与内核：检出根只有宿主知道；路径边界、符号链接竞态、
 * 拒绝前缀与逐文件 revision 都由内核的 `WorkspaceSandbox` 提供——本 Module 的
 * `source-workspace-reader.ts`／`query-workspace-source-reader.ts` 与 WorkerRuntime 的
 * `coding-agent-runtime.ts`／`exploration-tools.ts` 用的是同一份能力。本文件把这份既有能力
 * 包成一个宿主注入的窄端口，供 ContextCompiler 在派发准备阶段读取**有界的索引与更小的有界正文**。
 *
 * ── 为什么不用 WorkspaceReadPort 的图读取（保留的设计取舍）───────────────────
 * `WorkspaceReadPort`（P1-12 冻结端口，产品实现是 SourceGraphContextCompiler）把读取钉在
 * **计划固定的架构基线 sourceBinding** 上；产品安装的基线今天不含 sourceBinding（ADR 0003 D2 未开始），
 * 该端口对普通运行恒返回 `unsupported`。用它做「code」通道会让要修的场景原样存在
 * （装了 executor 规格的普通运行仍然起不来），因此这里用的是**同一批既有实现**里不依赖基线的
 * 那一份能力（内核工作区读取）。
 *
 * ── 边界（不是注释，是行为）───────────────────────────────────────────────────
 *  1. 权限：信封工具集不含 `read` 即 `forbidden`，**一个路径都不返回**。端口不授权，也不放宽；
 *  2. 版本：调用方（ContextCompiler）先把信封的 workspaceSnapshot.revision 与 canonical Workspace
 *     比对，不一致就不调用本端口；读取到的每个文件带**内核给出的内容 revision**；
 *  3. 有界：清单上限 `ROLE_SOURCE_INDEX_MAX_ENTRIES`、正文上限若干文件与字节；超限如实报
 *     `truncated`／`excerptNotes`，由调用方写进 gaps，绝不静默裁剪；
 *  4. 正文只取调用方声明的**模块路径前缀**下的文件（没有前缀就只给索引）：既让"当前源码入口"
 *     真的进入 ContextBundle，又不会把整仓源码塞进去；
 *  5. 不写：只读内核工作区能力，不建文件、不提交任何状态。
 *
 * ── 拒绝前缀的来源 ──────────────────────────────────────────────────────────
 * 只从本 Module 的 [denied-prefixes.ts](denied-prefixes.ts) （`WORKSPACE_DENIED_PREFIXES`）取，
 * 本文件不再自带一份字面量、也不再接受宿主覆盖：两个来源会让「派发时看不见、运行时可读」
 * （或反过来）重新出现。要改路径边界，改那一处。
 */
import { WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type {
  RoleSourceIndexPort,
  RoleSourceIndexRequestV1,
  RoleSourceIndexResultV1,
} from '../../contracts/role-material-channels.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';

export class WorkspaceSourceIndexReader implements RoleSourceIndexPort {
  constructor(private readonly deps: {
    rootFor: (projectId: string, workspaceId: string) => string;
  }) {}

  async readSourceIndex(request: RoleSourceIndexRequestV1): Promise<RoleSourceIndexResultV1> {
    // 权限先于 I/O：没有 read 就一个路径都不返回（不为了拿到材料而伪造权限）。
    if (!request.declaredTools.includes('read')) {
      return { status: 'forbidden', message: '本 Run 的信封工具集不含 read：不读取工作区，也不返回任何路径' };
    }
    if (!Number.isSafeInteger(request.maxEntries) || request.maxEntries < 1 ||
      !Number.isSafeInteger(request.maxExcerptFiles) || request.maxExcerptFiles < 0 ||
      !Number.isSafeInteger(request.maxExcerptBytes) || request.maxExcerptBytes < 1) {
      return { status: 'unavailable', message: '索引读取上限无效' };
    }
    try {
      const root = this.deps.rootFor(request.projectId, request.workspaceId);
      const workspace = await WorkspaceSandbox.create(root, {
        deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES],
      });
      const inventory = await workspace.listFiles(request.maxEntries);
      const entries = inventory.paths.map((path) => ({ path }));
      const excerptNotes: string[] = [];
      const excerpts: Array<{ path: string; revision: string; content: string }> = [];
      if (inventory.truncated) {
        excerptNotes.push('索引清单达到上限 ' + request.maxEntries + ' 条：未列出的路径不在本次材料内（这是上限事实，不是"工作区只有这些文件"）');
      }
      // 正文只取任务作用域声明的模块前缀：这不是放宽范围，而是把范围收得更小。
      const prefix = request.pathPrefix;
      if (prefix !== undefined && request.maxExcerptFiles > 0) {
        const candidates = inventory.paths.filter((path) => path === prefix || path.startsWith(prefix + '/')).sort();
        if (candidates.length === 0) {
          // 前缀可能不是路径（模块标识），也可能是本次索引上限之外：两种都如实说，不假装取了正文。
          excerptNotes.push('任务作用域声明的模块引用 ' + prefix + ' 在本次索引里没有任何匹配路径：本次只提供索引，不提供正文');
        }
        if (candidates.length > request.maxExcerptFiles) {
          excerptNotes.push('模块前缀 ' + prefix + ' 下有 ' + candidates.length + ' 个文件，正文只取前 ' +
            request.maxExcerptFiles + ' 个（按路径排序）：未取到的文件只出现在索引里');
        }
        for (const path of candidates.slice(0, request.maxExcerptFiles)) {
          try {
            const file = await workspace.read(path, request.maxExcerptBytes);
            if (Buffer.byteLength(file.content, 'utf8') > request.maxExcerptBytes) {
              excerptNotes.push('路径 ' + path + ' 超过正文上限 ' + request.maxExcerptBytes + ' 字节，只出现在索引里');
              continue;
            }
            excerpts.push({ path, revision: file.revision, content: file.content });
          } catch (error) {
            // 读不到不代表不存在：如实记一条说明，不补造正文。
            excerptNotes.push('路径 ' + path + ' 未能读取（' + (error instanceof Error ? error.message : '未知原因') + '）：只出现在索引里');
          }
        }
      }
      // Recheck only the material actually returned: the bounded inventory and
      // selected excerpts. This detects observed changes, not an atomic snapshot.
      for (const excerpt of excerpts) {
        let current: Awaited<ReturnType<typeof workspace.read>>;
        try { current = await workspace.read(excerpt.path, request.maxExcerptBytes); }
        catch {
          return { status: 'unavailable', message: 'stale: 所选源码在读取期间已删除或不可读，请重新取材：' + excerpt.path };
        }
        if (current.revision !== excerpt.revision || current.content !== excerpt.content) {
          return { status: 'unavailable', message: 'stale: 所选源码在读取期间发生变化，请重新取材：' + excerpt.path };
        }
      }
      const after = await workspace.listFiles(request.maxEntries);
      if (after.truncated !== inventory.truncated ||
          JSON.stringify([...after.paths].sort()) !== JSON.stringify([...inventory.paths].sort())) {
        return { status: 'unavailable', message: 'stale: 有界源码清单在读取期间发生变化，请重新取材' };
      }
      return {
        status: 'sourced',
        provenance: { workspace: workspace.identity },
        entries,
        entryCount: entries.length,
        truncated: inventory.truncated,
        excerpts,
        excerptNotes,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        message: '工作区源码索引不可读取：' + (error instanceof Error ? error.message : '未知原因'),
      };
    }
  }
}
