只读核对；实测次数取自报告。

1. **成立。**1644读均经 [note-scribe-todos.ts:128](/D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-scribe-todos.ts:128)。§11.6只需状态、用户标记、主锚点非文件退役；[note-service.ts:1058](/D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:1058)的B段正确：`symbol_missing`也属文件原因，替换会纠正旧误判。盖过、immediate、updateDue不依赖check（待办:162、225）。必须改：复用userReasonFacts、传完整窗口、改装配，约30行。测试：单目标、两任务关系目标、非空指针/Run，手算2+1+2+1+1+3＝10读；补符号丢失、盖过、归档认领。

2. **成立。**[note-anchor-facts.ts:63、67](/D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchor-facts.ts:63)重复读Goal、Goal、Plan；[note-anchors.ts:496](/D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchors.ts:496)仅在单次resolve内缓存。必须改：goalFacts接planWindowOf，约40–60行；保留工作区校验、错误分类、Run钉及基线、取消目标的计划、阶段连续性。公开写/审/卡测试：同目标多任务冷窗口2读、已传0新增；旧Run另读钉定计划1次，验证取消、阶段消失后重现。

3. **成立。**[note-read-model.ts:1338](/D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:1338)重扫；:1285缓存未过滤五槽全集，可复用。必须改：选择器收存anchorSets，两调用方共享，约15行。§11.7改“项目锚点集合共享一次，五槽分页求和；已有则零新增”。测试分段/不分段找及装配：201条主锚点、其余槽不足200，均6次；验附锚不进规范但参与冲突。

4. **部分成立。**[note-views.ts:1119、1192](/D:/cxt/s4c2b-measure/src/core/work-graph/views/note-views.ts:1119)支持派生/提示读归因；130条加重扫描，但L6/L7允许审收、并发超额，不能断言造数错误。4C-2须修前三项，其余按§11.7说明超时，不扩改4B。627＝610＋15次阶段扫描＋2次目录读。

测试均经公开入口，用计数包装、双后端验证。
可以据此返工