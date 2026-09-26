R3b Raw body 实现完成。只原地写了批准范围内的 3 个文件，未创建其它文件、未装依赖、未提交/重置 Git、未动 `body-ports.ts` 及其它 R 批次或 WG lane。

## 已改文件（sha256）

| 文件 | sha256 |
|---|---|
| `coding-platform/src/core/record-store/body-codec.ts` | `fb54ddc21759849e8cfa41339e794a54bc5676072ecb0d300e31b402fc8d99af` |
| `coding-platform/src/core/record-store/body-store.ts` | `fc5b91f9463f82e826105c8df960f37cc65e449ac42291d42e4c63030604a026` |
| `coding-platform/src/core/record-store/sqlite-body-store.ts` | `7f03710bc34352ff081e5073b6549a31fbda26b47692a68672b2fe9523442db4` |

变动方式：Python `Path.write_text` 原地写；`body-ports.ts` 哈希未变。

## 实现要点

- **单一物理规则**：全部形状/完整性校验在 `body-codec.ts`。`RawArtifactBodyStore` 只做 StoreResult 映射 + key 一致性；SQLite 只提供持久 seam。复用 `artifactBodyDigest/artifactBodySize`、`ARTIFACT_MAX_SIZE_BYTES`、`artifacts` 表、`record-codec` 的 `invalidFailure/corruptFailure/notFoundFailure/isJsonObject/isNonEmptyString/parseJsonObject`、`contracts/material-access.sameArtifactRef`。
- **编码**：新行 JSON 为 `{ref, body, sourceRefs, ownerRunRef, origin}`。Run/QueryRun 的 `ownerRunRef` 写完整 ref，TaskAttempt/`platform_operation` 写 `null`；`origin` 为附加规范字段。`legacy` origin 新写被拒 → `invalid`。
- **解码**：无 `origin` 的旧行按 `ownerRunRef` 解码为 `legacy`（缺失/null → `{kind:'legacy',ownerRunRef:null}`，不猜主体）；有 `origin` 时以规范 origin 为准。坏 JSON、缺字段、未知 origin/kind、`ref.source`≠`sourceRefs[0]`、正文 digest/size/ref 不符 → `corrupt`，绝不 `not_found`/空正文。
- **写入**：`INSERT ... ON CONFLICT(key) DO NOTHING` 后读回真实获胜行，保留第一次 ref/sourceRefs/origin；无预读、无上层事务、无覆盖。`put` 输入在首个 await 前同步编码，返回对象全部克隆。
- **SQLite**：沿用旧 pragma；`close()` 幂等；重开读原库；不 DROP/清库/迁移/GC。关闭后 `get/putIfAbsent` 明确抛错，不伪造成功。
- **接口**：未改冻结契约。`body-codec.ts` 新增导出 `ArtifactBodyCodecError`、`isArtifactRef`、`artifactBodyKey` 均有消费者（`body-store`），非无消费者 API。

## 真正运行的检查

| 检查 | 结果 |
|---|---|
| `python3 tools/dsh-refactor/check.py r3b-raw` | ✅ 3 passed, 7 skipped（另一组按分组跳过；预期 RED 未触碰） |
| `... check.py platform-types` | ✅ exit 0 |
| `... check.py platform-architecture` | ✅ exit 0，`issues: []` |
| /tmp 额外自检（37 项） | ✅ 37 passed |

额外自检覆盖：invalid（null、缺/unknown/legacy origin、空/坏 sourceRefs、坏 requestedAt、坏 actor、非法 owner ref、超 256KiB）；`not_found`；8 类 corrupt（非 JSON/数组/缺 ref/digest 不符/source 不符/unknown origin/显式 legacy origin/坏 ownerRunRef）；legacy `ownerRunRef:null` 解码；Run/QueryRun/TaskAttempt/platform_operation 四种 origin 往返与 `ownerRunRef` 兼容字段；重复 put 保留首 ref/source/origin；返回 ref/sourceRefs/origin 深拷贝隔离；输入在 `put` 调用后漂移不影响；SQLite reopen、close 幂等、关闭后读写抛错；**旧 `SqliteArtifactVault` 能读新行**（附加 `origin` 被忽略，`ownerRunRef` 兼容）。该自检已随调用结束（/tmp 每次调用重建），不替代冻结测试。

## 未完成 / 需主 Agent 知悉

- 未跑 `r3b-work-graph`（另一 lane stub，预期 RED）；未跑 `r3b-regression` 与旧竞态测试（旧 Vault 尚未切新 raw，按要求不虚报新接线）。
- 三个映射取舍（非冻结接口改动，供审阅）：① 空 `sourceRefs`、超限正文在 `body-ports` 无 `missing_source/size_exceeded` 码，统一映射为 `invalid`；② 存储行里显式带 `origin:{kind:'legacy'}` 视为不一致 → `corrupt`（legacy 只由“无 origin”表达）；③ `read` 返回首提交的 stored ref（保留首 source），与旧 Vault 语义一致。
- 需要冻结接口修改的阻碍：无。