## R4.3b 阶段二实现完成并 STOP

### 实现内容

**1. `projectTerminalTranscript` 算法**（原受管 `session-history.ts`）
- 只接受真实 terminal 且 `activeModelRequest === null`；
- 拒绝 `toolBatch` 中 `pending`/`running`/`outcome_unknown`；
- 沿原字段拒绝 `transcript` 中正式 `tool_result.result.status === "error" && error.code === "outcome_unknown"`（原 reducer 清空 batch 也不放行）；
- 仅从**返回副本**中移除 `toolBatch` 里 `abandoned && result === null` 的调用声明；正文、`reasoningContent`、真实结果及其配对不变；不改借用对象、不造结果；
- 缺失结果且无 abandoned 事实仍由消费端原 `assertTranscriptExchangeIntegrity` 拒绝。以上不满足一律 `StoreError('conflict', …)`。

**2. `restoreSessionHistory`**：每个真实终止 Turn 都消费同一投影（不再只在 `hasAbandoned` 时），随后仍执行原严格配对；position、Turn 身份、边界与 current-turn 排除逻辑不变。

**3. `execution-observation.ts`**：所有 terminal 一律先过同一投影再配对；投影/配对不能消费则保持占用、不释放、不伪造 applied。R4.3a 的真实退出/清理 proof、原 terminal pending、control source 与完成回执均保留。

**4. 产物**：仅由 `scripts/build-kernel-patch.mjs --write` 重新生成 4 个 session-history 产物；public-api、脚本源名单、骨架冻结测试、原 Kernel 参考工程均未改。

### 六文件差异/哈希（baseline → current）

| 路径 | baseline SHA256 | current SHA256 |
|---|---|---|
| `.../patches/core/ports/session_store/session-history.ts` | `6284efab…fbd5b4016449c04a` | `ff23182b6091353a80ddb4aeea468a8d7e367ee624b8bcec129a38a811fb10d2` |
| `.../dist/core/ports/session_store/session-history.js` | `8e833013…25ecf2785` | `010ef30661584fb59e76e92aa872109b2ef5dfae9678cac649d5d8ad5229e5ec` |
| `.../dist/core/ports/session_store/session-history.js.map` | `7e95215f…47ad16ef` | `ce5ec660c32fbb5bcabaf3de5366dd68fc528bcaec1de5656c96ae27a3bdf5c1` |
| `.../dist/core/ports/session_store/session-history.d.ts` | `49d890d6…cd1a105b` | `38d8568be0608421fd8cce93c67f9d366660f5cfc4da4f75faca69a162164299` |
| `.../dist/core/ports/session_store/session-history.d.ts.map` | `d4c35bc8…c07aa65` | `6b2e971d444d1bee49a2ad9c8e8748c6a80190e0ecf09f192c301a23ccc86fd2` |
| `.../src/core/agent-runtime/execution-observation.ts` | `27cafdbc…3be4945` | `779044403c37bb53777529cbcf36ae89bfad533f20f91d50a1b940de7b4abfdb` |

两源文件 unified diff 关键点：`session-history.ts` 的骨架 `throw version_unsupported` → 完整算法 + `restoreSessionHistory` 无条件走投影；`execution-observation.ts` 的 `abandonedInBatch ? project : state.transcript` → 无条件 `projectTerminalTranscript`（try/catch 保占用）。4 个产物为脚本再生成，非手写。

### 固定检查结果
- `next-terminal-history`：**2 files / 5 tests 全 pass**（Kernel 正常链 + 原真实 unknown；含原 Runtime 三案例与同 Session claim→prepare→start 后继消费）
- `next-kernel-history-public`：**1 file / 10 tests pass**（唯一新增符号白名单）
- `next-types`：**exit 0**
- `next-kernel-patch`：**7 sources / 28 artifacts 全部逐字匹配，exit 0**
- 影响面补充（原历史消费确实改动）：`next-frozen-kernel` 19 pass、`next-session-continuity` 18 pass

### Scope audit
对照 lane `manifest.snapshotHashes`：**changed = 恰好 6 个 writableFiles，`outsideScope = []`**（无新增/删除文件）。三个冻结测试 SHA 与任务书一致（`cdd75d64…`、`cbd89f51…`、`42a8a77d…`）。

### 如实说明
- 全部固定目标与两条后继链均已到达并通过，无“未到达的后继段”需以人工 kernel identity 替代；`originalWorkspaceChanged` 的 host 侧核对仍需 root 在沙箱外运行 `harness.py audit`（沙箱内该路径被 lane 覆盖，不能作为结论）。
- 未新增/修改任何测试、fixture、工具脚本或 manifest；未提交 Git、未安装依赖。按任务书 STOP，等待独立验证后导入并继续后续接线。