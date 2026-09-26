首轮审阅返修完成。仅原地重写批准范围的 3 个文件，`body-ports.ts` 未动，未改测试/检查/其他 lane。

## 四项返修

1. **消除重复摘要**：`put` 不再 `decode(candidate)`。新增 `readEncodedArtifactRef(json)`（读回刚由本 codec 编码的可信 ref，只 `JSON.parse`，不重算摘要、不新增 ref 构造算法）。新 INSERT 的 winner 就是刚编码行 → 只 `encode` 时对输入做 **1 次**摘要；仅当 `putIfAbsent` 返回已存在 winner 时才 `decode` 核验 **1 次**。持久数据完整性核验未跳过。
2. **winner 与请求 key 一致性**：`put` 取得已存在 winner 后，用 `sameArtifactRef(stored.ref, candidateRef)` 核对 contentType/digest/size；错放在 key A 的合法 row B 返回 `corrupt`。`sameArtifactRef` 只看内容身份，首次 source 不同仍正常去重；正确 key 新行/正例正常 `ready`。
3. **origin 与兼容字段一致**：删除编码/解码两段同义 origin 规则，统一为 `normalizeOrigin(value) → {origin, ownerRunRef}`（`run`/`platform_operation`/拒绝 `legacy`/未知 kind 一份实现）。解码有 origin 的行时用 `originOwnerMatches` 校验兼容 `ownerRunRef`：Run/QueryRun 必须为同一完整 ref（`sameArtifactOwnerRunRef`），TaskAttempt/platform 必须为 `null`，缺失视为不一致 → `corrupt`。无 origin 旧行仍走 legacy 解码（含 null）。
4. **SQLite 初始化失败关闭连接**：`exec` 与两次 `prepare` 包在同一个 `try` 中；任一步抛错即 `db.close()` 并 `throw` 原错误（close 自身的异常不覆盖原错误）。`CREATE TABLE IF NOT EXISTS` 不改旧表，测试验证表结构仍只有 `key`。

## 检查真实结果

| 检查 | 结果 |
|---|---|
| `check.py r3b-raw` | ✅ 3 passed, 7 skipped |
| `check.py r3b-raw-boundaries` | ✅ 4 passed（返修前 4/4 复现失败） |
| `check.py platform-types` | ✅ exit 0 |
| `check.py platform-architecture` | ✅ exit 0，`issues: []` |
| /tmp 额外自检 47 项 | ✅ 47 passed |

额外自检在原 37 项上新增/覆盖：Run/QueryRun/TaskAttempt/platform 四种 origin 与兼容 `ownerRunRef` 的一致（runA↔runB、↔null、↔缺失、attempt↔runA、platform↔runA 均 `corrupt`；runA↔runA、attempt↔null、platform↔null 均 `ready`）、旧 `SqliteArtifactVault` 仍能读新行、SQLite close 幂等与关闭后抛错、输入/返回隔离。

## 变动规模与 hash

| 文件 | 行数 | 新 sha256 |
|---|---|---|
| `body-codec.ts` | 291 | `f2460dc79a1bfe4a4559a46e798ca4b22e6e4f7f11e714c9adc80c69be902870` |
| `body-store.ts` | 87 | `8fb298ac994ab23925ceb781e55a291dcab8c17f2b380955f84f01cbcce4b1b8` |
| `sqlite-body-store.ts` | 70 | `23f6a03449c057c01d1bfcbb9fb69fb00326a2dda2b7caeb92d8881a91ea62c7` |
| `body-ports.ts`（冻结） | — | `024d80dab496e7347c7b65078980080a2f6d190107e886c7f9edc587814d9b0a`（未动） |

相对我上轮交付：codec `fb54dd…→f2460d…`、store `fc5b91…→8fb298…`、sqlite `7f0371…→23f6a0…`。仅新增 `readEncodedArtifactRef` 一个导出，消费者为 `body-store`，其余导出照旧。

## 未完成 / 说明

- 正文库与旧 Vault 的真实接线、`r3b-regression`/旧竞态集成验收仍按分工由后续集成完成，本会话未改其他 lane、未提交。
- 无冻结接口改写，无新增模块/依赖。新增测试与 `check.py r3b-raw-boundaries` 由主 Agent 只读同步，非我所改。