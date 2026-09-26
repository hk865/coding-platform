按最小方案完成最终返修，未保留任何放宽。

## 自检结果（最终代码，真实执行）

| 检查 | 结果 |
| --- | --- |
| `check.py r4a`（3 文件 / 17 项） | **17 passed / 17** |
| `check.py kernel-types` | **exit 0** |
| `check.py kernel-architecture` | **passed (69 source files)** |
| `check.py r4a-regression` | **46 files passed；207 passed / 1 skipped（208）** |

## 1. 删除 `requireWorkspaceRevision:false` 与暂停例外

`recovery-coordinator.ts`：删除该选项和 `else if (paused)` 分支。现在 `willContinue || (status==='paused' && environment !== undefined)` 统一走 `#assertCompatibleEnvironment`，严格比较原 `RunConfigSnapshot` 与完整 workspace 引用（identity / reference / **revision 全等**）。Core `recover` 未传 `environment` 仍只投影 paused、不执行 runner；生产恢复组合根始终传 environment，公共路径无放宽。

## 2. `resolveRecoveryWorkspaceOptions`（app `recovery-contract.ts`，纯机械 helper）

- `path.resolve/relative` 计算配置 `storage.databasePath` 相对 `workspaceRoot`；**仅在严格位于 root 内且非 root 本身**时追加数据库文件与 `-wal/-shm/-journal` 四个精确相对路径；root 外不新增，不忽略父目录或整个 `data`。
- 复用 `DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES`，取 `caller.snapshotIgnoredPrefixes ?? DEFAULT`，保留显式覆盖语义与其余 options，`Set` 去重；未复制算法或常量。
- 两个组合根都在 `WorkspaceSandbox.create` 之前调用同一 helper，`consistencyMode` 仍按 config 装配顺序覆盖。
- 只把内核自身持续写入的 SQLite 文件排除出 revision/一致性快照，**不改变 read/write 权限**；同目录普通文件仍参与核对。解析结果经 `snapshotIgnoredPrefixes` getter 进入新 turn/checkpoint 的 `recoveryConstraints`，run/resume 生效值一致。

## 3. Sol 新 7 项独立对照（全过）

仅换 model → conflict；仅换 workspaceRoot → conflict；strict 同 root 改 `note.txt` → conflict（零模型调用、零记录变化）；strict + DB 在 workspace 内、仅 SQLite 增长 → 正常恢复成功且 usage 1→2、追加记录；strict 改 DB 同目录 `data/user.txt` → conflict；version=2 的 checksum 合法 checkpoint 未被采用且 state 等于事件回放；缺字段旧 checkpoint 仍被采纳。

## 4. INTEGRATION.md

删除「paused 不比较 revision / 后续边界会检查」的错误说明，改为 paused 与 willContinue 同样核对完整 workspace 引用（暂停期间普通文件变化会在恢复前 conflict）；新增 helper 的实际语义与边界（精确四文件、root 外不新增、不改权限、不忽略父目录、run/resume 一致、旧记录/旧 checkpoint 兼容）。

## 5. 如实报告的兼容性边界

旧无字段记录继续执行仍拒绝、terminal 与无字段旧 checkpoint 继续可读；本仓上一轮 R4a 构建写过的「有 `recoveryConstraints` 但不含 SQLite 忽略项」记录，在新代码下会因 supplied 新增 ignored prefix 判为放宽而 conflict——未做字段迁移、执行时不跳过不一致约束；真实旧库无该字段不受影响。若需接受这类中间记录，请明确兼容策略。

冻结测试/类型/getter 均未修改（hash 见报告 §6）；未实现 after_tool 暂停、block/modify/fail、native compact；未 build。报告已写 `/tmp/dsh-output/implementation-final2.md`，待主 Agent 验收。