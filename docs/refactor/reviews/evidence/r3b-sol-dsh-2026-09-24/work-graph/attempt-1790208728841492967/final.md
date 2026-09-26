# R3b WG Session 第二轮返修报告

## 已改文件（仅两个原批准实现文件，原地 `Path.write_text`）

| 文件 | sha256 |
|---|---|
| `src/core/work-graph/materials/applicability.ts` | `4279e4e627a8560840a0647ecdbc9ef954c4494b714b856973bee7d9b6d395fd` |
| `src/core/work-graph/materials/material-service.ts` | `10e5ed77325eb25b80f86fcf9ccedacefa94d2a0b1dcf845497fad60fdef66d2` |

未动 raw lane（`body-store.ts` 等 mtime 仍 07:38）、旧 Vault/policy、Host、其他测试、`check.py`；未新增接口/层/文件/依赖。

## 两处精确修复

1. **work_run storeArtifact 的 post-await 取消**（`material-service.ts`）：`storeArtifact` 现在固定保留受理时的 `const signal = ctx.signal`（不克隆、不替换），在 `workRunWorkspaceBound` 的 canonical scope 查询完成后、`storeRawBody`/`raw.put` 开始之前再检查 `signal.aborted`，命中即返回 `{status:'rejected', code:'cancelled'}` 且不写正文。已开始的 `raw.put` 不做任何回滚声明。

2. **Host owner canonical full-ref 等值核对**（`applicability.ts` `hostAdmission`）：`authority.load(owner)` 返回 `found` 后，取 `canonical.snapshot.ref ?? null` 并用 `sameArtifactOwnerRunRef` 与原 owner 做完整 ref 等值比对（Run 比 goalId+runId，QueryRun 比 workspaceId+queryJobId+runId）；不一致即 `forbidden`，不再信任其 workspace。与 Core `canonicalRunScopeMatches` 已有做法一致。

## 真正运行的检查

| 检查 | 结果 |
|---|---|
| `check.py r3b-await-boundaries` | **exit 0 — `Tests 2 passed (2)`** |
| `check.py r3b-work-graph` | **exit 0 — `Tests 7 passed \| 3 skipped (10)`** |
| `check.py r3b-admission-boundaries` | **exit 0 — `Tests 6 passed (6)`** |
| `check.py platform-types` | **exit 0**（无输出） |
| `check.py platform-architecture` | **exit 0，`issues: []`** |

已通过 7+6 项无回归。日志：`/tmp/dsh-output/final2-*.log`。

## 边界 / 残留

- 取消检查只在 canonical 等待后、首次 raw 写之前；若 `raw.put` 已开始则不检查、按真实存储结果返回（符合"不假装回滚"）。
- Host 当前仍恒 `source_stale`（本批无可信 source-pin 入口），未变。
- `createMaterialAccessResolver` 仍无生产消费者，待下一集成任务把旧文件改薄重导出。
- 无错误、无冻结接口改动请求。