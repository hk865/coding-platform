静态只读核对未发现本轮范围内可证的问题。未运行测试、构建或变异验证。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| — | — | — | — | 无 | — |

- W2c-01: OK。归档完成后才读取图，按归档 Task 和完整 `archiveRef` 找到自身记录；错误的归档 `at` 会使严格比较失败。删除的导入均只供旧用例使用（`tests/work-graph/S4C2-goal-triggers.test.ts:478、487、489、533、538、544`；`.lead-ref/parts/P1.diff:884、928、964`）。
- W2c-02: OK。两处均固定为 `rejected/invalid`，公开历史的前后比较保留（`tests/runtime/R4b-session-recovery.test.ts:242、248、249`；`tests/runtime/R4b-session-input-boundaries.test.ts:124、127、137`）。
- W2c-03: OK。包装记录每次底层调用；建游标后清空，前后历史检查绕过包装。静态推演删除读者自身检查后，四例都会到达底层委托，从而违反零调用断言（`tests/runtime/R4c-execution-history.test.ts:94、145、154、155、160、331、352`；`src/core/agent-runtime/observation-recovery.ts:260、269、285`）。
- W2c-04: OK。规范文本的字段和排序符合生产编码；独立复算为 **183 字节**，SHA-256 为 `27272b141e404048373f9886a5c179a23d500d987d486619fae262023fb055d5`，与字面量一致（`tests/composition/A1-graph-session-platform.test.ts:101、110`；`src/core/work-graph/architecture/catalog-record-codecs.ts:193`；`src/contracts/fingerprint.ts:45`）。
- W2c-05: OK。两次公开读取均发生在关闭前，分别核对同一个当前观测引用和活动基线不存在；数据库尾部只保留 R-20 的版本与水位检查（`tests/composition/R3d-R3g-platform.test.ts:197、200、202、216、232、239、241`；`src/core/work-graph/architecture/architecture-service.ts:856`；`src/core/work-graph/architecture/catalog-service.ts:373、774`）。
- W2c-06: OK。只删除指定死函数、注释、独占导入和常量；保留函数及时间常量未变，现存导入方行为不变（`.lead-ref/parts/P1.diff:148、159`；`tests/helpers/S2B-r2-track-support.ts:15、24`）。
- W2c-07: OK。逐文件与基线比对，27 个场景文件仅删除指定的 53 处字段或重置，没有其他修改（`.lead-ref/parts/P1.diff:305–863`）。
- W2c-08: OK。注释改为三个真实符号，运行代码未变（`tests/helpers/K3-review-card-fixture.ts:337`；`tests/helpers/S5-decision-fixture.ts:270、484、531`）。
- W2c-09: OK。注释准确描述 `replies` 替换单条 `text` 回复，运行代码未变（`tests/helpers/R4-history-turn-support.ts:56、129`）。
- W2c-10: OK。计数包装、字段、重置和无效断言均按行删除；缺失接缝会返回 `unsupported`，使说明构建不能成功（`tests/composition/K-R-previous-turn-bounds.test.ts:27、30、35、37、85`；`src/core/agent-runtime/session-operations.ts:1004`；`src/core/agent-runtime/continuation-brief-assembly.ts:574`）。
- W2c-11: OK。仅改注释；实际传入 `b2.entry`，缺失路径提前返回，未到使用它的终态分支（`tests/work-graph/A2-disposition-change.test.ts:361、382`；`src/core/agent-runtime/run-reconcile.ts:303、397`）。
- W2c-12: OK。仅补充计数范围说明，断言未变；图读者确实使用原始输入 owner（`tests/runtime/S3-context-assembler.test.ts:687、690`；`src/composition/create-platform.ts:1123`）。
- W2c-13: OK。断言完整渲染标签，原始记录断言保留，文字与渲染器一致（`tests/app/session-rendering.test.ts:447、448`；`src/ui/views/history/timeline.ts:277`）。
- W2c-14: OK。宽页仍断言依次返回 `pending`、`decided` 并取得非空游标；生产游标取窗口末项，即 `decided`。收窄查询严格返回 `[later]` 且无后续游标，可排除“外部游标一律返回空页”的错误实现（`tests/work-graph/unknown-call-review-list.test.ts:289、296、300、305、308、310`；`src/core/work-graph/tasks/unknown-call-review-service.ts:1520、1534、1538`）。

```json
[]
```

会出错 0，违规 0，不整洁 0，建议 0