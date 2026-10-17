只读核对，未改文件、未运行测试或构建，也未复验代理报告的运行结果。路径缩写：W＝src/core/work-graph，T＝tests/work-graph，E＝tests/scenarios/S4C2-U6-note-card-e2e.test.ts。

1. 第1项：是。attempt 已贯穿集合读取、注记源和原因事实；目录映射存入该 attempt 的缓存，按项目复用（W/views/decision-read-model.ts:259、307；W/notes/note-decision-source.ts:158；W/notes/note-service.ts:922、952、975）。双后端用例包含两个目标的模块关系，以及公开修订删除接口；手算断言为目录合计一次、计划每目标一次（T/S4C2-read-counts.test.ts:455、467、480、499、524）。

2. 第2项：是。真实卡先答复，再由书记普通撤下，随后公开落实入口明确断言 incomplete；按键读卡和队列均断言“已答复、待落实”、application:null（T/S4C2-U3.test.ts:130、145、156、161、165、175）。断言还限定空证明的拒绝原因，可检出该解码行错误放行或错误返回 unavailable；生产空证明检查在 W/communication/decision-application.ts:139。

3. 第3项：是。D 行预期键已改为固定字面量，D-01 两个对象标签也已写成独立字面量（T/S4C2-D-rows.test.ts:26、144；E:74）。指针移动覆盖确在 E:215，实际指针断言在 E:243。

本轮未发现新增缺陷：

- 新调用及窗口重试均重新创建空 attempt；按键读取不接收旧 attempt，分页后备路径也自建空缓存（W/views/decision-read-model.ts:410、441、989；W/notes/note-decision-source.ts:123）。写入、普通处置和卡落实各建自己的缓存，未见其他生产调用跨次共享目录（W/notes/note-service.ts:1089、1539、1702）。
- skipCandidates 加在展开后的事实副本上；退役判断只消费布尔结果。写入校验仍使用原事实对象并返回候选，书记处置的理由判断也不输出候选，因此未丢失原有候选列表（W/notes/note-service.ts:1081、1083、1122、1126、1612、1617）。

两项 UNSPECIFIED 均可接受：公开修订确实禁止删除模块，而接口缺失与模块缺失进入同一个候选分支，足以覆盖本轮重复读取问题（W/architecture/catalog-service.ts:682；W/notes/note-anchors.ts:696、706）。书记 withdraw 经公开撤下入口产生普通处置，符合本项要验证的空证明拒绝语义（tests/helpers/S4C2-note-card-fixture.ts:308；T/S4C2-U3.test.ts:161）。

可以合入