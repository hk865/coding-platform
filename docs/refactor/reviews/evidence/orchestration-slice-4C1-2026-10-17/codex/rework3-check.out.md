只读核对完成；未修改文件，未运行测试或构建。以下用唯一文件名定位。

1. **裁定1：部分。必须改。** 涉及的 notes/views 已无模块级或按 ctx 存活的缓存；写入、处置、计数和核对均新建调用对象（note-service.ts:768、1213；scribe-scope.ts:348；note-views.ts:1140）。但同目标的多个阶段关系仍逐个调用 `readGoalPlanWindow`，缓存的只是历史阶段集合（note-service.ts:677、694、745）。  
   **修改思路：** 在 `NoteCall` 中按项目、目标缓存当前计划窗口，阶段判断共用；补同次处置含多个阶段目标的计数断言。这是落实“一目标一窗口”的最小修改，也避免一次处置读到不同计划时点。

2. **裁定2：是。** 不适用的 resolution 已先于范围及关系读取拒绝（note-service.ts:1256、1261、1286）；阻断关系读取的两个用例覆盖 review/reject（S4C-resolution-order.test.ts:80、90）。

3. **裁定3：是。** 裁展示规范不再删除其核对统计，统计仍按注记和版本去重（note-read-model.ts:1605、1670）。新用例断言裁完展示规范后仍保留两项、两个文件及观察记录（S4C-find-byte-trim.test.ts:104、109）。

4. **裁定4：部分。必须改。** 已按模块组织候选，但仍有两处错误：
   - 归属计算使用规范化路径，回取获胜路径却使用原值；例如模块路径 `Src`，查询 `src/a.ts`，会漏掉所属模块（graph-context-reader.ts:216、223、225）。
   - 两模块都声明 `src/`、查询 `src` 时，虽已判为并列，却经“子目录”分支同时命中（graph-context-reader.ts:234、235）。
   
   **修改思路：** 候选保存规范化且去尾斜杠的路径，并保留获胜模块身份；等值、祖先匹配服从归属结果，子目录判断也使用处理后的路径。补上述两个反例，不改共享归属算法。

5. **裁定5：部分。** 批量关系读取已完成，缺失、损坏和存储失败的处理保持原语义，未发现此处新增回归（note-service.ts:170、906、914、917）。但 **必须改**：RW-12b 直接调用工具处理器，未经过裁定明确要求的脚本化 Work Run（S4C-write-read-bounds.test.ts:124、128；.lead-ref/s4c1-rework-3.md:43）。  
   **修改思路：** 复用 RW-15 的脚本化 Host 入口，在该次 `record_note` 执行窗口计数，并断言写后核对结果，避免把外围调度读取算进去（S4C-record-note-host.test.ts:199、216）。

计数值本身与现有夹具相符，按 §11.7 的“未改读取沿用”口径可相加：

- **find 7→5、10→8：** 5＝账本1＋当前计划窗口2＋活动1＋项目指针1；8＝5＋新增模块项核对所需的当前目录2、历史目录1（note-read-model.ts:524、1278；note-related-scope.ts:264、386；note-views.ts:653、657；catalog-service.ts:373、382、433）。
- **lookup 9：** 锚点五槽5＋原有配额状态桶4，修后的注释正确（S4C-find-read-bounds.test.ts:168）。
- **RW-12a 13→12：** Run事实3＋锚点事实5＋范围事实3＋关系批读1；lookup＝5＋4＋3＝12（S4C-write-read-bounds.test.ts:78、82；note-service.ts:906）。
- **RW-12b：** readMany＝写入12＋核对〔头1＋目录2＋作者Run1＋绑定计划1〕＝17；lookup＝写入12＋冲突五槽5＋配额4＋相似项5＝26（S4C-write-read-bounds.test.ts:141；note-views.ts:216、694、702、745、923）。

**建议：修正 find 的推导注释。** 25＝相关三组锚点15＋Run索引1＋项目锚点5＋配额4；37＝25＋目标索引1＋两个槽各三状态6＋模块锚点5。当前注释把额外读取说成“两目标”及“第二段三次 readMany”，容易误导以后调整预算；最小修改仅重写分解（S4C-find-read-bounds.test.ts:127、149；note-read-model.ts:1255、1258）。

UNSPECIFIED 四项判断：

- **无并列标记：需改。** 内部保留了 tie，公开结果却只返回普通列表，仍未落实“报告为并列”（graph-context-reader.ts:219、1602；裁定文件:34）。应由 lead 冻结最小歧义字段，再把已算出的 tie 透传。
- **caller_task/auto 不注入当前计划缓存：合理。** 它读 Run 绑定计划，不能冒充当前计划（note-related-scope.ts:402；note-views.ts:393）。
- **RED 仅推断：** 属于证据缺口，不能当作实测失败；不据此要求实现返工。
- **resolution 优先于版本冲突：合理。** 与本次前置拒绝裁定一致，未见相反规格要求（note-service.ts:1256、1273）。

先改完列出的几处