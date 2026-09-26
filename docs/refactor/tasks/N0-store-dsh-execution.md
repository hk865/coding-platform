# N0 / R3c 开始：独立目标 Store 的精确索引与旧后门退出

用户已授权独立 `coding-platform/next` 工程迁移。原 `coding-platform/src` 是只读参考；本任务不改旧项目，不把下一工程接回旧 Ledger。

只允许写范围文件中的三个实现文件；共同协议、注册类型、测试、配置和其他代码只读。原有文件已是搬入的验收实现，保持 CAS、幂等、schema 检查、同事务回滚、原旧库四表读取格式和正文实现不变。只给目标工程提供真实能力，不造平行 DataEngine。

## 冻结契约

读 `next/src/core/record-store/lookup-ports.ts`、`ports.ts` 及独立 `next/tests/record-store/lookup.test.ts`、`next/tests/work-graph/goal-independent.test.ts`。

1. 两个 backend 工厂公开对象只有 `records` 和 `close`。移除 legacyAccess 的接口、实例字段、返还物及只供旧适配器使用的 helper；同一内部 Map/connection 和 CAS 算法继续使用，不向上层暴露 SQL、连接或可变状态。清理 stale 注释。
2. `records` 类型为现有 GoalRecordTransactionPort 加 RecordLookupPort，必须真实实现 lookup。既有精确 readMany 已足以支持注册过的物理行；不要再增加另一套 snapshot reader 或连接。
3. RecordBackendSchemas.lookups 注册 `{name, aggregateType, paths}`。由 schema 所有者配置，Store 只解释安全 dotted JSON key 路径；必须在打开数据库前验证注册。拒绝空/重复名、无对应 aggregate schema、空路径、空路径段、原型键与不安全路径。复制输入，不能让调用者随后修改注册影响系统。
4. 索引值是 string/finite number/boolean/null；缺字段按 null，复合对象不可伪装标量。lookup 仅接受已注册索引、准确值数、整数 limit 1..200、可选完整 canonical refKey 的 exclusive after。不能接受 SQL 或不受限扫描请求。未注册 unsupported、非法请求 invalid、命中损坏行 corrupt；关闭后沿用关闭约束。
5. 每页按完整 refKey 的 UTF-8 字节序稳定排序（Memory 与 SQLite BINARY 一致，after 使用同一比较规则），取 limit+1 判断 next。readThrough 是同次读取已观察的最后事件游标，不宣称跨页冻结。业务需重读 canonical 行，候选不作授权。
6. SQLite 对注册字段建立安全表达式索引（包含 aggregate type、查询标量和 ref_key）；索引由 SQLite 与 snapshot 写事务自动更新，复用唯一连接。查找必须使用对应谓词/keyset；不能每页 SELECT 全部 snapshot 后在 JS 过滤。只在必要 schema/index 初始化时处理已有库，不再做新旧双写。SQL布尔值必须保持和内存一致，注意 true 与数值1、false与0的区别。
7. Memory 保持按注册字段建立的候选索引，随单次 commit 更新；失败/冲突/重放不能留下错误索引。不得每次 lookup 全量扫描 snapshot Map。共用 `lookup-index.ts` 的注册/键/请求判据，避免两后端各造同义算法。
8. 性能与语义均要守住：只有新建/更改行更新索引；没有重复扫描、额外连接或嵌套异步事务。保留输入 clone 的时序保证。
9. 2026-09-24 主审修订：EncodedRecord.json 表达解析后的 JSON 值，不是精确字节产物。两端 snapshot 写入都重新编码已验证的 parsed 值，使重复字段及数字表示与内存索引一致；不改事件/正文精确字节语义、不扫描重写已有全库。旧 writer 本来使用 JSON.stringify；任意外部 SQL 编码不是支持的生产协议。

## 可运行的固定能力

在工作区根运行：

```sh
python3 tools/dsh-refactor/check.py next-store
python3 tools/dsh-refactor/check.py next-types
python3 tools/dsh-refactor/check.py next-architecture
```

测试已由 Sol 编写、主审审阅；现有缺口应 RED。不得修改测试、放宽类型为 any、删断言或另建旧 Ledger 替身来通过。业务与其他实现仍可能有显式未实现骨架，不得顺手填充。

最终报告列实际文件、测试与剩余限制。不 git stage/commit/push，不安装依赖。单文件写挂载需原位写，不通过 rename 替换文件。遇到冻结协议的实际矛盾准确报告，不能越界改契约。
