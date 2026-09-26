# R3b WorkGraph material — 实现完成报告

## 已改文件（仅批准的两个，原地 `Path.write_text`）

| 文件 | sha256 |
|---|---|
| `src/core/work-graph/materials/applicability.ts` | `271e2fd8c13a750268ac8169414bd91369870dae78c2e12313f2c87051249f45` |
| `src/core/work-graph/materials/material-service.ts` | `346f4e6c1ba2ab3e6ee0fc103be415a4b45a1744ebe894b4741a3defbae535a8` |

未创建文件、未装依赖、未 reset/commit、未改标准/timeout/新模块。旧 `artifact-vault.ts`（mtime 仍是 09-18）与 `material-access-policy.ts`（09-23 13:22，他人既有改动）未被触碰。

## 实现内容

**`applicability.ts`** — 迁移原 Vault 的 owner/exact-grant/currentBasis/历史标记策略与原 policy 的 canonical/sourcePin 规则：
- `createMaterialApplicability` 单一准入：Run/QueryRun reader 的 owner-only 默认、非 owner 的 exact grant（reader/scope/material/issuer 四项过滤）、basis 等价、`currentBasisValid` 二次核验、历史 grant 与显式 historical 的标记；TaskAttempt/legacy-null/platform origin 不赋 Run 资格。
- Host reader：`historical_explanation` 用真实 origin/legacy owner `authority.load` 核对 canonical Run/QueryRun scope，跨 project/workspace 拒绝；legacy null `forbidden`；本批 Host `current` 一律 `source_stale`，不伪称 current。
- `createMaterialAccessResolver`：候选 index → 逐条 canonical 撤销/scope 复核 → `currentBasisValid` 先做 source I/O、再做最终 canonical 重核；只依赖 `authority.load` 类型、index 类型与既有 `materialSourcePinIsCurrent`（WorkspaceTools），不 import StateLedger 实现。
- `materialOwnerFromOrigin` 为唯一 provenance 解释点，供 service 复用。

**`material-service.ts`** — 共享私有 `storeRawBody`/`readArtifact` 原语：
- `createMaterialService`：`storeArtifact` 校验 principal/reader/project/workspace/actor 一致与 writer-match-origin，先于首个 await 同步隔离 `sources`/`origin`（不克隆 signal），只返回 `stored`（无 Ledger cursor）；`openArtifact` 先校验 context 一致再走共享授权。
- `createLegacyArtifactPort`：仅参数/结果映射，无伪造 `work_run`/roleBinding/CoreCallContext；`includeOwner=false` 不输出 owner 字段；`corrupt→invalid`、`source_stale→stale`、`not_found→unavailable`，reason 保留在 issues；usage 缺省保留 owner-only 语义。

## 真正运行的检查

| 检查 | 结果 |
|---|---|
| `check.py r3b-work-graph` | **exit 0 — `Tests 7 passed \| 3 skipped (10)`**（raw 3 项按分组跳过，另一 lane 的 stub） |
| `check.py platform-types` | **exit 0** |
| `check.py platform-architecture` | **exit 0，`issues: []`**（新增唯一运行时边 `WorkGraph -> WorkspaceTools` 已在 module-map 允许集内） |

额外验证：两文件 mtime 仅 07:50/07:51；其他 lane 的 body-store/body-codec/sqlite-body-store 保持 07:38 未动；`git status` 确认 `src/core/work-graph/materials/` 为未跟踪骨架目录。

## 未完成 / 说明（非阻塞）

- `createMaterialAccessResolver`/`createMaterialApplicability` 尚未有生产消费者：旧 `material-access-policy.ts` 仍用自己的副本，按计划由下一集成任务把旧文件改为薄重导出。当前旧文件保留第二份副本是任务书明确允许的过渡态。
- Host `current` 恒 `source_stale`：本批无可信 source-pin 入口，符合"不伪称 current"；真实 source-pin 接线与真实 Host/Run 端到端稍后独立验收。
- 未运行 `r3b-regression` 等其它组别（按要求只跑指定三项）。
- 无错误、无需要主 Agent 裁决的冻结接口阻碍。

自查输出留存：`/tmp/dsh-output/{r3b-wg-tests.log,r3b-wg-platform-types.log,r3b-wg-architecture.log}`。