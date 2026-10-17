只读核对完成；未修改文件，未运行测试或构建。

路径简写：`A=src/core/work-graph/architecture`，`W=src/core/workspace`，`V=src/core/work-graph/views`，`T=tests/work-graph`，`E=tests/composition`。

1. **必须改：逐文件跳过被前置捕获阻断。**  
   公开捕获先走旧 TS 捕获（`A/architecture-service.ts:673`、`W/capture.ts:527`），它对不可读、超限、含 NUL 的 TS/JSON 文件整次拒绝（`W/project-source-snapshot.ts:77`、`:82`），到不了后面的跳过逻辑。最小反例：正常 `good.ts` 加含 NUL 的 `bad.ts`；应保存前者并记录后者的 skipped issue，实际无观测。**修改思路：**让观测入口先形成允许逐文件跳过的材料，提供者消费它；底层严格接口可以保留，但不能继续作为观测入口的必经前置。

2. **必须改：文件图没有绑定同一份冻结材料，还丢失显式配置。**  
   `captureFileGraph` 重新读取工作树（`W/capture.ts:257`、`:275`），最终验证却只检查 TS/JSON（`:218`；`W/project-source-snapshot.ts:70`）。同一 captureRef 下修改 `a.py`，再次取图可得到不同的行数，验证仍通过。另外，原分析传入显式 configPath（`W/capture.ts:532`），新提供者没有传（`W/architecture-language-provider.ts:101`）：仅在 `cfg.json` 配置的 alias 会由已解析变成 unresolved。**修改思路：**捕获 owner 保存完整材料、摘要及配置选择；文件图与模块图共用，发布前核完整集合。这样同时消除重复读取和两套分析结果不一致。

3. **必须改：正式比较有确定的误报。**  
   - 同模块两个文件之间的 import 也会报 `import_undeclared`（`A/formal-comparison.ts:168`、`:175`）。例如唯一模块 A 内 `one.ts→two.ts`；模块层原本会排除这种内部边（`W/architecture-source.ts:66`）。
   - 无归属端点直接被略过，缺依赖判断只检查成功节点（`A/formal-comparison.ts:171`、`:203`）。声明 A→B，A import 未归组的 `loose.ts`，或 A 唯一文件被 skipped，都会误报 proven missing。  
   **修改思路：**依赖汇总排除同模块边；按模块累计 skipped、歧义及未归组边带来的不确定性，再决定 missing 的 certainty。文件环仍独立保留。

4. **必须改：完整 catalog pin 没有实际核对。**  
   比较只按 catalogRef 读记录，未核 baseline ref/digest，也未核目录项目与调用项目一致（`A/architecture-service.ts:959`、`:964`、`:977`）。把合法 pin 的 digest 换成另一串合法十六进制，仍返回 ready；还可把另一项目目录与当前 capture 配对。结果身份因此不可信。**修改思路：**复用指定版本读取，校验项目范围、目录与基线关联及 digest，全部通过后再比较；已有版本读入口包含项目范围检查（`A/catalog-service.ts:781`）。

5. **必须改：根路径全链迁移仍有遗漏。**  
   图搜索仍过滤 `.`，另有私有前缀匹配（`V/graph-context-reader.ts:231`、`:217`）。目录只有 R=`.` 时搜索 `src/loose.ts` 找不到 R；两个根模块并列也无法返回双方。`A/formal-comparison.ts:33` 又复制了一套最长前缀算法。**修改思路：**共享函数同时提供获胜前缀信息，搜索和歧义说明直接消费；搜索保留所有并列 owner，其他调用者继续“并列不归属”。现有后者行为在 `notes/scribe-scope.ts:98`、`V/goal-conflicts.ts:479`、`V/node-detail-reader.ts:753` 未改变。

6. **必须改：新校验会拒绝合法旧观测。**  
   模块 body 解码无版本区分地按唯一最长归属重算摘要（`A/architecture-record-codecs.ts:374`、`:388`）。旧实现生成的 A=`src`、B=`src/b`，仅含 `src/b/a.ts` 的观测，两个模块都有节点；现在 A 成员为空而被拒绝（`:390`），历史查询经 `A/architecture-service.ts:489` 变成 unavailable。**修改思路：**明确区分新旧观测的成员校验规则，旧材料按原规则读取；不能用新归属规则判旧证据损坏。

7. **必须改：覆盖信息未公开返回，旧观测还绕过游标校验。**  
   languages 只保存和内部加载（`A/architecture-service.ts:741`、`:572`），捕获回执及文件页没有返回（`:772`、`:888`）。纯 Python 项目只有空边，消费者无法知道“引用未支持”，不满足任务书 §7.2。另将新观测游标用于旧观测，会在 `:886` 提前返回空页，未报 cursor_mismatch。**修改思路：**贯通公开覆盖信息；把游标身份校验放到旧观测分支之前。保留 `notCaptured:true` 空页形式即可。

8. **必须改：无目录时不保证模块层为空。**  
   是否生成模块层只看 TS parsed 数量（`A/architecture-service.ts:689`）。未采用目录、提供一个 TS 文件及非空 mappings，仍生成模块节点。现有“无目录”验收实际使用无 TS 项目，避开了这个分支（`T/S8A-file-layer.test.ts:329`）。**修改思路：**读取活动目录是否存在；不存在时只产文件层，以有 TS 的无目录项目验证。

9. **必须改：验收证明弱于约定。**  
   - A-01 的语言覆盖、分块内容直接读记录和 artifact（`T/S8A-file-layer.test.ts:161`、`:179`）；容量注入只到直接 service（`:295`），平台入口尚未证明。补平台配置透传，并从公开读断言覆盖、容量和历史兼容。
   - A-01/A-05、A-02/A-02b 的平台夹具都固定 memory（`E/S8A-AE1-observation.test.ts:74`、`E/S8A-AE1-formal-comparison.test.ts:68`）；缺约定的 SQLite 服务级验证。A-02/A-02b 虽有精确数组（后者 `:150`、`:178`），HTTP 测试只送空输入（`tests/app/S8A-architecture-routes.test.ts:93`），未证明成功结果穿过路由。
   - 目录时间测试从数据库事件取期望时间（`T/S8A-catalog-version-time.test.ts:54`、`:75`），写错时间与读错时间一致时仍通过。应固定时钟，用字面量时间和原因断言公开列表。  
   这些应替换或补齐现有验收，不另扩无关测试矩阵。

10. **建议：合并确定重复的规则代码。**  
    按所给生产 diff 计，新增 1,460 行、删除 109 行，未超约 1,600 行预算。`A/formal-comparison.ts:58` 与 `A/architecture-delta.ts:17` 几乎复制同一环检测；以后修自环或排序须改两份。抽出接受节点、边的纯函数，两处调用，可减少约 50 行且不丢规则。第 5 项的前缀重复也应一起消除。

目录 `since` 本身未发现必须改项：旧记录缺字段归 null（`A/catalog-record-codecs.ts:585`），新修订绑定提交游标（`A/catalog-service.ts:739`），列表读取事件真实时间与原因（`src/core/work-graph/notes/note-version-lists.ts:151`、`:155`）。

对 UNSPECIFIED 的意见：提供者接口放 Workspace 合理（`W/architecture-language-provider.ts:20`）；ready 空页加 notCaptured 合理；邻居单跳、impact 反向且排除起点可接受（`A/file-graph-index.ts:109`、`:126`）；manifest 保存 unresolved 有必要（`A/architecture-service.ts:731`）。容量注入不是未规定，A-01 已明确要求。**建议**把 configPath 类型扩为 `string|null`，消除无配置调用必须强转的问题（`src/composition/create-platform.ts:192`、`E/S8A-AE1-observation.test.ts:73`）。三个路由标签无需改（`src/ui/api/routes.ts:28`）。底层拒绝 binary 可以保留，但必须解决第 1 项的入口阻断。

先改完列出的几处