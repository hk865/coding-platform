## 第三轮完成：kernelStore pin 已接入并全部真实测试通过

### 阅读（宽读窄写）
按要求读了 `docs/PRODUCT.md`（Session 连续/重放/未知语义）、`docs/refactor/ARCHITECTURE.md` 与 `module-dag.md`（五模块/8 边，AgentRuntime 只依赖 WorkGraph/WorkspaceTools/RecordStore/Contracts/Kernel）、`docs/refactor/DSH-WORKFLOW.md §3`、`modules/core/record-store.md`（§4.1 事务/幂等/`commitCursorBindings`、§4.3 「映射唯一键包含 adapterId 代表的存储实例」），并复核了本模块与 work-graph §6.1。写范围未扩大：**只改 `session-operations.ts`**。

### pin 实现（公开 `CreateSessionRequest` 未新增字段）
- 首个 `admit` 的 `kernelStore` 来自受信 `kernelStores.forWorkspace(workspace)` 的 `{adapterId,storeKey}`；ctx 未绑定 → `forbidden`；workspace 结构非法 → `invalid`；无当前默认 → **`unsupported`（不编造 pin，不建库）**。
- `admitted` 之后**只用 `operation.action.kernelStore`**：`byAdapterId` 必须是 current 注册（legacy 拒绝）、`storeKey` 与 `workspace` 必须逐一相等，否则 `unsupported`；绝不回退默认、绝不打开/新建替代库。completed 重放另核对 `observation.adapterId === pinned.adapterId`。
- WG 侧已核对：create 指纹**不含** `kernelStore`（重试按原 action），`recordSessionCreated` 会核对 `registration.adapterId === action.kernelStore.adapterId`。

### 实测（主工作区 src/tests + 已刷新 WG 候选 + 真实 Memory/SQLite Store + 真实 Kernel，合并树在 /tmp）
- `next-session-runtime` 四个真实测试文件：**22/22 PASS**，新增反例「never moves an accepted create to a new default Kernel store after registration is interrupted」通过（改默认后拒绝 `unsupported` 且 replacement 库 `ENOENT`；恢复原配置后同 request `completed` 且仍是原 kernelSessionId）。
- WG provider 自身 `tests/work-graph/R4b-session-directory.test.ts`：**14/14 PASS**（证明候选对一致）。
- 定点探针（仅 merged 树）：无当前默认时同 request → `unsupported` 且不创建任何替代库，通过。
- 上一轮补充校验仍成立（请求首 await 前克隆、`basis.ref` 平台 Ref、cursor 绑 platform+adapter/kernel+principal+upper/position、limit 1..200、EACCES→unavailable、续页/显式 through 删首记录必失败）。
- 主工作区固定检查：`next-architecture` **exit 0**；`next-types` 中我的 runtime **无错误**，仅剩 `tasks/plan-readers.ts` 缺 `TaskLeaseSnapshot`/`TaskReductionSnapshot`（root 在途改动，非本 scope）；`next-session-runtime` **4/22**，18 个失败全部是主工作区 `session-directory.ts` 仍为 unsupported stub、`session-record-codecs.ts` 仍是 skeleton codec 所致。

### 阻碍与边界
- **主工作区 WG 未同步**：刷新后的成对文件在 `.toolchain/dsh-refactor-runs/next-r4b-wg-20260924/workspace/...`（contracts 15:31、directory 15:32:45、codecs 15:33:04），需 root 成对同步进主工作区；按「禁止改 WG/测试」我未代落盘。
- `next-types` 另被 `plan-readers.ts` 的共享 contracts 缺口阻塞，需 root 处理。
- 按主审意见：cursor 仍是内部查询书签，未加 MAC/secret/cache；每次仍核对真实 Session、可信 scope 与 upper/binding/position。
- 工厂 close/drain 属 root 组合根；本工厂无跨调用句柄，`withStore` 仍 finally 关闭且不主动新建缺失库。
- 未自标验收；测试通过仍待主审独立验收。