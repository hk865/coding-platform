只读静态审查完成；未修改文件，未运行测试或构建。4C-2 的未实现内容不计缺项。以下以唯一文件名定位。

1. **必须改：默认生产 Work Run 拿不到 `record_note`。**  
   授权链为 `host.ts:258` → `execution-preparation.ts:224` → `execution-driver.ts:227` → `observed-model-run.ts:271`：Host 未授予的工具不会进入注册及 `hostAuthorizedTools`。因此默认本地授权下不能调用；显式配置同时获得 Host、Role 授权的执行者、参谋、书记才可能调用。`S3-graph-tools.test.ts:735` 自行加授权，掩盖了这个缺口。最小修复：补生产授权接线，并用实际 Host grant 验证三类职责。

2. **必须改：并发确认可绕过用户注记保护。**  
   `note-service.ts:1156` 先读目标 X v1、判定无用户原因；用户随后确认 X，变成 v2；`:1227` 又让取代逻辑重读，`:588`、`:600` 以 v2 作提交守卫。书记因此可以成功取代刚获用户确认的 X。修复：权限判断和迁移共用同一批目标头，守住判断时的版本；所有影响保护判定的目标均须纳入守卫。

3. **必须改：旧处置命令升级后无法重放。**  
   `note-service.ts:1099` 无条件给指纹新增 `resolution:null`，旧指纹没有此字段（`.lead-ref/s4c1-src.diff:3255`）。升级前成功的 review/withdraw 原样重放，会在 `note-service.ts:1104` 返回幂等冲突。修复：未提供 resolution 时保持旧指纹，或兼容旧指纹查回原回执。

4. **必须改：选择取代却实际并存。**  
   合法稿件同时含 `contradicts:[X]`、`coexistWith:[X]`；`note-machine.ts:287` 的 supersede 只把 X 加入 replaces，`note-service.ts:287` 仍因 coexistWith 排除 X。结果成功但旧项没被取代。修复：supersede 同时从 coexistWith 移除本次目标。

5. **必须改：保护判定误认重建阶段为原阶段。**  
   `note-service.ts:659` 转换锚点时丢掉 planRevision。反例：p1 有 S，p2 删除，p3 同名重建；旧用户注记仍被判为 live，错误阻止书记处置。修复：保留版本，并共用 `note-views.ts:559` 的逐版连续性规则。

6. **必须改：跨段后丢失候选截断标记。**  
   `note-read-model.ts:1438` 进入第二段后只取该段 ranking。第一段有 1,001 个匹配、第二段未超限时，后页变成 full，末页可报 complete:true。修复：第二段仍合并第一段 partial 状态。现有 F-08 仅造两条相关项，未覆盖此反例（`S4C-related-scope.test.ts:512`）。

7. **必须改：字节裁剪会截断续读，且漏算 boundary。**  
   `note-read-model.ts:1624` 裁规范时无条件重算 next；若 all 查询本页候选全被过滤、items 为空但原 next 非空，裁规范会把 next 清空，后续命中无法到达。仅裁规范应保留原游标。另 `:1630` 在测量、裁剪后才加入 boundary；临界两项页可能超限却不再裁。应把完整返回结构纳入每次测量。

8. **必须改：项目头部核对被漏计。**  
   `note-read-model.ts:1305` 核对最多十条规范，`:1320`、`:1561` 却只用最终展示的前五条计算 coverage/observedFiles。反例：唯一规范因依据文件变化而不现行，查询项为空；实际核对、读文件后却报零。修复：初始统计保留全部实际核对结果，字节裁剪时再按规则重算。

9. **必须改：节点注记读取失败伪装成“没有”。**  
   `node-detail-reader.ts:960`、`:963` 把缺依赖、unavailable、forbidden 都变成空页且 complete:true。一次存储失败即可让已有注记消失在详情中。修复：传播失败或返回明确 unavailable。`S4C-node-notes.test.ts:125` 还固化了错误空成功，应一并改正。

10. **必须改：§11.7 多项读次数上界未落实。**
   - `scribe-scope.ts:322/352/370` 各自派生范围事实；项目理解无关系也派生两次（`note-service.ts:727/764`），书记写 r 个他人关系达到 `1+2r` 次（`:823/828`）。关系仍逐条 readMany（`scribe-scope.ts:305`）。应每次调用共享事实，目标去重批量读取。
   - `note-related-scope.ts:202` 扫整个目标的活动再筛任务。t1 无 Run、t2 有两万活动，查 t1 仍扫描约百页；其他任务损坏记录也会连带失败。应使用任务 Run 索引及一次批量活动读。
   - `note-related-scope.ts:132` 枚举所有历史阶段键，`note-read-model.ts:1225` 每键扫五槽。p=1000、没有注记也产生5000次空扫描；应改成五槽前缀扫描后筛版本。
   - `note-read-model.ts:1378` 无词查询提前扫描第二段。两条相关项、limit=1 仍读全项目；应延后至实际转段。

11. **必须改：U2 仍有四套、不一致的路径归属规则。**  
   `scribe-scope.ts:78`、`goal-conflicts.ts:470` 使用目录边界、最长前缀，并列不归属；`graph-context-reader.ts:210` 丢失模块并列信息，同路径两模块会都命中；`node-detail-reader.ts:739` 只判断任意前缀，还接受反斜杠，不处理最长或并列。反例 A=`src`、B=`src/deep`，无 containment，文件会计入两份详情。应按 U2 合并纯函数，搜索规范化及 containment 汇总留在调用方；`note-related-scope.ts:285` 已复用第一套，没有第五套。

六条路由确已接通：`create-platform.ts:1345` 发布 owner，`core-routes.ts:457` 登记，`host.ts:1272` 将原平台交给绑定器，`server.ts:247` 构造可信身份并分发。三项写入口有人类身份检查（`core-routes.ts:600/608/628`），未发现这里绕过 person-only 的路径。

U1 的 commandId **是确定性的**：`execution-driver.ts:489` 对 Run、Session、工具名、callId 求散列，`note-tool.ts:241` 直接使用；没有随机数或时间。**必须改**的剩余部分是按 U1 提取纯请求构造器：现在仍嵌在 `note-tool.ts:177`，后续 owner 无法直接复用来重建同一请求。

测试核对：

- 允许修改的旧测，现存版本仍保留原目的：同锚点扣配额、提交后配额、指针及处置保护（`S4A-note-write.test.ts:324/360/481/658/680/699/877`）；历史指针和实际取代（`S4A-note-history.test.ts:464/493`）；非现行核对（`S4B-memory-l12-bounds.test.ts:173`）；相似候选及冲突配额（`S4B-memory-similar.test.ts:22`、`SP-memory-check-scoped.test.ts:63`）；大小写列表及详情形状（`S3-graph-context.test.ts:851/867`、`S2C-node-detail-executions.test.ts:34`）。
- lookup 空页变化已有 stale 空页接续（`S4B-memory-paging.test.ts:108`、`S4C-default-states.test.ts:274`）。F-01 第二页前三项 related、第四项 project，零基位置 **3 正确**（`S4C-related-scope.test.ts:277`）。
- 没有测试 diff，不能确认逐字修改范围。所查新增行为用例未见读取数据库内容作断言。
- **必须改验收缺口**：计数包装存在，却只断言 searchText=0，未验 find/lookup/write 预算（`S4C-related-scope.test.ts:68/528`）；R-02 注记来自假端口，“look 下钻”只是再次调用同一 reader（`S4C-node-notes.test.ts:38/108`）；路由测试直接 dispatch，未经过 Host HTTP（`S4C-note-routes.test.ts:40`）。应补对应真实入口和上述反例，不能据现有测试宣称全部验收行完成。

对其余 UNSPECIFIED：

- **1，必须改**：请求不应接受 caller_task；当前确实放行（`note-read-model.ts:1209`）。拆请求与解析结果类型，拒绝额外形状。
- **2，建议**：把 conflicting 放进契约，消除两端隐含约定（`note-read-model.ts:429`、`note-contracts.ts:120`）。
- **3，可接受**：list 的 state 由内部 lookup 参数承接，不必扩大工具请求（`note-read-model.ts:1645`）。
- **4，可接受**：noteCounts 数组形状本身无问题（`work-line.ts:243`）。
- **5，建议**：运行时直接返回整行，没有实际丢字段；类型应对齐共享字段，避免消费者看不到 updateDue、关系等（`node-detail-reader.ts:946`、`work-line.ts:269`）。
- **8，必须改**：review/reject 携 resolution 被忽略，可能成功执行与参数不符的操作；应返回 resolution_not_applicable（`note-service.ts:1170/1179`）。

**建议压缩重复，而非按行数硬砍**：五槽前缀扫描两份约可省20–25行（`note-related-scope.ts:263`、`note-read-model.ts:637`）；状态桶扫描复用约省13–16行（`note-read-model.ts:1235/2386`）；工具与路由写后核对信封合并约省20行（`note-tool.ts:209`、`core-routes.ts:614`）。超出软预算本身不算错误。

先改完列出的几处