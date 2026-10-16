只读核对完成；未修改文件，未运行测试或构建。以下用唯一文件名定位。

逐项结论：

- 1：是。Host 已按邮箱工具的条件授予 `record_note`（host.ts:263）。
- 2：是。取代复用判定时的头，未写入的目标也加版本守卫（note-service.ts:1329、note-service.ts:1350）。
- 3：是，按裁定保留指纹形状（note-service.ts:1191）。
- 4：是。取代时移除重叠的并存目标（note-machine.ts:291）。
- 5：部分。连续性规则已共用，但缓存生命周期有问题，见下。
- 6：是。第二段保留第一段的 `partial`（note-read-model.ts:1466）。
- 7：是。请求形状拒绝 `caller_task` 和多余键（note-read-model.ts:1198）。
- 8：部分。拒绝检查仍晚于关系读取，见下。
- 9：是。边界参与测量，裁规范保留游标（note-read-model.ts:1610、note-read-model.ts:1660）。
- 10：部分。初始统计修好，裁剪时仍漏计，见下。
- 11：是。缺依赖或读取失败返回不可用（node-detail-reader.ts:976）。
- 12：部分。任务 Run 索引、批读活动、阶段前缀和延迟读第二段已落实（note-related-scope.ts:249、note-related-scope.ts:266；note-read-model.ts:1233、note-read-model.ts:1419）；缓存、写入批读和计数验收未收口。
- 13：部分。共享函数正确，搜索调用方仍有错误，见下（note-path-ownership.ts:24）。
- 14：是。三种操作共用请求构造器（note-tool.ts:192、note-tool.ts:326）。
- 15：是。真实平台写入并比较详情与首个查询页（S4C-node-notes.test.ts:40、S4C-node-notes.test.ts:56）。
- 16：是，按裁定无需补监听器测试（.lead-ref/s4c1-rework.md:105）。
- 后续1：部分。`jsonSafe` 已解决非法返回，但缺省必填校验仍交服务（note-tool.ts:64、note-tool.ts:257）。
- 后续2：是。节点按唯一归属加声明的子模块汇总（node-detail-reader.ts:746）。

剩余问题：

1. **必须改：缓存跨调用存活。** `WeakMap` 按外部 `ctx` 身份缓存，服务入口没有建立每次调用独立的缓存作用域（scribe-scope.ts:257；note-service.ts:697、note-service.ts:1389）。复用同一上下文、其间改变书记负责关系或计划，后续调用仍用旧事实，可能错误放行或拒绝。最小修复：两种缓存均改为操作内部创建并传递；当前计划窗口也按目标共用，避免每个阶段目标重读（note-service.ts:741）。

2. **必须改：第8项顺序未落实。** 书记先调用 `managingScopeOf`，其中会读关系目标，之后才拒绝不适用的 `resolution`（note-service.ts:1226、note-service.ts:1245；scribe-scope.ts:304）。目标读取失败会遮盖应返回的错误。把检查前移到范围及关系读取之前。

3. **必须改：第10项裁剪统计违背裁定。** 项目头还保留时，代码把被裁掉的展示规范从核对统计中删除（note-read-model.ts:1667）；裁定要求此时继续计入（.lead-ref/s4c1-rework.md:67）。仅裁展示列表时保留全部已核对项及文件观察。

4. **必须改：路径搜索仍丢失模块身份。** 它把每条路径作为独立候选；同模块的 `src`、`src/` 会被误判并列，真正并列又被压成普通无匹配（graph-context-reader.ts:205、graph-context-reader.ts:1567）。两模块同为 `src`、查询恰为 `src` 时，等值分支仍让两者命中（graph-context-reader.ts:217）。按模块组织规范化后的路径，保留并报告并列结果，并让路径匹配服从归属判定。

5. **必须改：计数测试不能作为 §11.7 验收。** RW-12 的 `25/37/9` 固化了当前读取；其中查询页的 `9=5个锚槽+4个配额状态桶`，注释却称后四次是目标/计划读取（S4C-find-read-bounds.test.ts:163；note-read-model.ts:234）。这四次未列入 §11.7 的查询页及核对预算（slice-4-SPEC.md:903、slice-4-SPEC.md:907）。分段查询还重复读同一目标的计划窗口（note-related-scope.ts:385；note-views.ts:393）。
   
   RW-12a 的写入 `13` 明确包含两次逐条关系读取（S4C-write-read-bounds.test.ts:75；note-service.ts:887）；按裁定批读，这部分应为一次。它调用服务，漏掉工具写后的核对，不能代表 `record_note`（S4A-note-fixture.ts:265；note-tool.ts:268）。处置 `4/9` 有分步批读分解（S4C-write-read-bounds.test.ts:99），但不能证明缓存仅限单次调用。最小修复：批读写入关系、补真实工具入口计数；由 lead 对齐必要读取与规格预算，再冻结逐项手算值。

6. **建议：补齐后续1的前置必填校验。** 目前只提前拒绝字段混用（note-tool.ts:300）。缺 `body/sections` 仍进入服务；建议补校验，并由 lead 处理原断言保留要求。

先改完列出的几处