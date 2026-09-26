# R3b WorkGraph 首轮返修完成报告

## 已改文件（仅两个原批准实现文件，Python `Path.write_text` 原地写）

| 文件 | sha256 |
|---|---|
| `src/core/work-graph/materials/applicability.ts` | `9f77b9f7e711666d247ceb747bdd4e52bcdffab5ec4519ad96ee4d3e91e54586` |
| `src/core/work-graph/materials/material-service.ts` | `438156cdce5b48fedfc9537a66659c9e7e14dd1c91565061cfc4919290045a4c` |

未动 raw lane（body-*.ts mtime 仍 07:38）、旧 Vault/policy、Host、其他测试与 `check.py`。未新增文件、依赖、公共错误码或 timeout。

## 四项返修对应实现

1. **platform origin 的 Host 读取**（`applicability.ts` `hostAdmission`）：在 owner 分支前直接核对规范 `platform_operation` origin——`origin.projectId` 必须等于 Host project；workspace 受限 Host（`reader.workspaceId !== undefined`）要求 `reader.workspaceId === origin.workspaceId`，故跨 workspace 或 origin 无可信 workspace 关联均 `forbidden`；project-wide Host 可读同 project 正文。**不伪造 Run**，`legacy owner=null` 仍 `forbidden`。

2. **reader/principal 首个 await 前隔离**（`material-service.ts`）：新增 `snapshotReader`/`snapshotPrincipal`，在同步段复制 reader（host 的 project/workspace/actor、run 的 requester/currentBasis）与 principal（含 runRef/roleBinding/queryRunRef）后再做一致性检查与后续使用；保留原 `ctx.signal` 引用。新增 `workRunWorkspaceBound`/`canonicalRunScopeMatches`：`work_run` 读与写都要求 `authority.load(principal.runRef)` 命中且 `snapshot.ref` 全 ref 相等、`workspaceSnapshot.workspaceId === ctx.workspaceId`，否则 `forbidden`（读取不到则 `unavailable`）。legacy owner-only 路径不新增任何 canonical 查询或角色伪造。

3. **读取取消如实拒绝**：`readArtifact(..., signal?)` 在 body I/O 完成后、授权等待完成后各检查一次 `signal.aborted`，命中返回 `cancelled`，不返回正文；`openArtifact` 在 canonical scope 等待后也复查一次。写入仍只检查进入前取消，put 成功后按真实结果返回，不假装回滚。

4. **corrupt 的错误语义一次转换**：新增内部 `MaterialReadFailure`（`not_found/corrupt/invalid/unsupported/unavailable/forbidden/source_stale/cancelled`）。`fromStoreFailure` 把物理 `corrupt` 保留为内部 `corrupt`；Core 边界 `coreReadFailure` 将 `corrupt→unavailable` 且保留 reason；legacy 边界 `legacyReadFailure` 将 `corrupt→invalid`（issues 保留 reason）。其余映射：`not_found→Core not_found / legacy unavailable`，`source_stale→Core source_stale / legacy stale`。不靠 reason 字符串判断，未改公共 `CoreError`。顺带把 Core `storeArtifact` 的 raw corrupt 也统一映射为 `unavailable`。

## 真正运行的检查

| 检查 | 结果 |
|---|---|
| `check.py r3b-admission-boundaries` | **exit 0 — `Tests 6 passed (6)`**（修复前基线 5 failed / 1 passed） |
| `check.py r3b-work-graph` | **exit 0 — `Tests 7 passed \| 3 skipped (10)`**（raw 3 项按分组跳过） |
| `check.py platform-types` | **exit 0** |
| `check.py platform-architecture` | **exit 0，`issues: []`**（`WorkGraph -> WorkspaceTools` 仍为唯一运行时边） |

日志留存：`/tmp/dsh-output/final-{r3b-work-graph,r3b-admission-boundaries,platform-types,platform-architecture}.log`。

## 残留 / 说明（非阻塞）

- Host `current` 仍恒 `source_stale`：本批无可信 source-pin 入口，符合"不伪称 current"，待真实 source-pin 接线。
- `createMaterialAccessResolver` 仍无生产消费者，旧 `material-access-policy.ts` 保留副本，按计划由下一集成任务薄重导出。
- `MaterialReadFailure.cancelled` 在 legacy 边界映射为旧 `unavailable`（旧 wire 无取消码），未被测试覆盖；如主 Agent 认为应另映射请告知。
- 无错误，无需冻结接口改动的阻碍。