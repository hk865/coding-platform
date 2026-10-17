只读核对完成；未修改文件，未运行测试或构建。十项中，1、3、5、9 部分修复，其余原问题已修复；另有公开覆盖信息的权限遗漏。

路径缩写：`A=src/core/work-graph/architecture`，`W=src/core/workspace`，`V=src/core/work-graph/views`，`N=src/core/work-graph/notes`，`T=tests/work-graph`，`E=tests/composition`。

1. **部分修复；必须改：配置文件被跳过后仍击穿整次观测。**  
   容错读取会记录二进制、超限和不可读文件（`W/project-source-snapshot.ts:140`），但随后仍无保护地调用模块分析（`W/capture.ts:544`）。最小反例：正常 `good.ts`，含 NUL 的 `tsconfig.json`，显式指定该配置；分析器因配置已被跳过而抛错（`W/typescript-source-query.ts:254`），整次捕获被拒绝（`W/capture.ts:630`）。  
   **修改思路：**仅在 observation 模式隔离分析失败，保留冻结文件和计行结果，记录语言失败覆盖、生成空模块层；严格捕获保持原行为，也不要暗中换配置。这样才覆盖裁定中的“JSON 文件失败不击穿观测”。

2. **是：冻结材料、完整核验和 configPath 已接通。**  
   模块层取同一观测材料的子集，文件层消费保存的 `observed`，verify 重算全材料摘要（`W/capture.ts:535、263、217`）；显式配置进入提供者（`W/architecture-language-provider.ts:102`）。摘要额外包含 engine、workspace/commit identity，属于合理加强，不是问题（`W/project-source-snapshot.ts:150`）。

3. **部分修复；必须改：skipped 与 tie 组合仍误报确定缺依赖。**  
   同模块边已排除，`other` 不再单独导致 unknown（`A/formal-comparison.ts:95、132、146`）；但 issues 只接受唯一 owner，并列被丢掉，而歧义集合只扫描 nodes（同文件`:135、56`）。  
   最小反例：A、P 都映射 `src/dup`，声明 A→B；唯一候选源码 `src/dup/bad.ts` 被跳过，B 有正常文件。A 没有节点，最终 A→B 被报 `proven`（同文件`:155`）。  
   **修改思路：**处理 skipped/failed issue 时直接消费 `ownershipOf`；tie 的所有候选模块均记 unknown，继续排除 `other`。复用已有节点歧义规则即可。

4. **是：pin 的范围、关联、版本读取和摘要检查齐全。**  
   检查顺序已落实（`A/architecture-service.ts:1004、1007、1014、1017`），`readRevisionByRef` 已导出（`A/catalog-service.ts:433`）；测试改用真实采用结果并覆盖错误 pin（`T/S8A-file-layer.test.ts:417、477`）。

5. **部分修复。**  
   获胜前缀由共享函数返回，两个私有匹配器已移除；根模块搜索和相关注记扫描已接上（`src/contracts/path-ownership.ts:61`；`V/graph-context-reader.ts:227`；`N/note-related-scope.ts:341`）。单根、双根搜索有测试（`T/S3-graph-context.test.ts:1011、1019`）。书记、目标冲突、节点详情及相关注记仍保留“并列不归属”，未发现裁定外改变（`N/scribe-scope.ts:98`；`V/goal-conflicts.ts:479`；`V/node-detail-reader.ts:753`；`N/note-related-scope.ts:349`）。

   **必须改：还有两处归属链遗漏。**
   - verifier 要求搜索 `.` 返回所有模块（`.lead-ref/verify-s8a.md:53`）。现有匹配没有根查询分支（`V/graph-context-reader.ts:237`）；R=`.`、A=`src/a`，名称和摘要不含点时，搜索 `.` 只返回 R。**修改思路：**在路径搜索处理根查询，复用同文件`:1422` 已有的全模块语义。
   - 首轮遗留：文件锚点查询先删除无观测节点的 mapping，再判归属（`A/graph-index.ts:100`）。A=`[src/a,src/tie]`、B=`[src/tie]`，文件为 `src/a/a.ts`、`src/tie/x.ts`：写入时后者不归任何模块，B 没节点（`W/architecture-source.ts:38、46`）；查询却删掉 B 后判给 A，邻域和影响范围因此错误。**修改思路：**先对全部 mappings 判归属，再筛选可返回节点，避免改变候选集合。

6. **是：旧观测按旧成员规则读取。**  
   无 `fileGraph` 时选择 legacy，解码按任一前缀重算成员（`A/architecture-service.ts:512`；`A/architecture-record-codecs.ts:407`）；嵌套映射旧记录的查询和 previous 用例已有（`T/S8A-file-layer.test.ts:495、549`）。legacy 下 `.` 不匹配普通相对文件符合旧规则，不应套用新根语义（`A/architecture-record-codecs.ts:109`）。

7. **原项已修复，但有新问题，必须改。**  
   三页返回 languages，旧观测带游标会拒绝（`A/architecture-service.ts:914、918、946、951、979、984`）。然而加载器只复核 nodes 的当前权限，随后直接返回 languages（同文件`:593、596`）。  
   最小反例：最初允许 `good.ts` 和被跳过的 `private/bad.ts`，随后权限缩至 good.ts；读取仍 ready，并返回 private 文件的问题信息。  
   **修改思路：**在共同加载器中同时复核返回的 issue 路径，沿用历史读取越权返回 forbidden 的规则；不要分别在三个页面过滤，以免覆盖信息失真。

8. **是：空 mappings 与空模块层已成立。**  
   输入接受 `[]`，直接使用空模块快照（`A/architecture-service.ts:144、715`）；测试使用真实 TS 文件，并断言文件层存在、模块层为空（`T/S8A-file-layer.test.ts:382、395、403`）。

9. **部分修复；主要验收已补，旧记录的平台入口仍缺。**  
   平台容量检查已补；AE1 运行配置覆盖 memory/SQLite（`E/S8A-AE1-observation.test.ts:77、235`；`E/S8A-AE1-formal-comparison.test.ts:71`）。A-02/A-02b/A-05 保留字面量数组（后者`:154、182`；前者 observation 文件`:276`）。成功路由请求断言完整 findings（`tests/app/S8A-architecture-routes.test.ts:163、167`）；目录原因是字面量，时间夹在修订前后（`T/S8A-catalog-version-time.test.ts:31、37、57、58`）。覆盖与分块验收已改为公开读取（`T/S8A-file-layer.test.ts:171、341`）。

   **必须补齐平台旧记录验收。** 当前 `not_captured` 只经服务入口证明（`T/S8A-file-layer.test.ts:314、317`），足以证明该服务分支，不能算完成裁定的平台验收。最小场景就是旧库升级后读取。  
   **修改思路：**准备有效旧版 SQLite 夹具，再通过现有 `storage.directory` 打开平台、只用 `platform.architecture` 断言；组合根本就支持打开该目录的持久库（`src/composition/create-platform.ts:569、576`）。无需新增生产“旧记录注入”接口，也无需读库验证结果。

10. **是：环检测已统一。**  
    共同函数在 `A/architecture-delta.ts:24`，正式比较调用它（`A/formal-comparison.ts:105`）。分块打包也已线性：每项序列化一次，slice/join 的区间不重叠（`A/architecture-service.ts:265、269、277、292`）。

其余 UNSPECIFIED：多块及 64 块上限确实已通过服务依赖注入验证（`T/S8A-file-layer.test.ts:331、351`）；注入位置与任务书要求不同，**建议 lead 接受这个窄接缝**，不再增加平台选项。零节点写一个空块不违反上限，也能区别旧观测（`A/architecture-service.ts:275、292`）。跨文件重复测试编号不影响执行，不列为返工问题（`tests/data/S8A-file-graph.test.ts:193`；`T/S8A-formal-comparison.test.ts:201`）。

成本方面，仅按所给整片 diff 统计为新增 1,657、删除 155，净增 **1,502 行**，不是约 1,610。**建议合并一个确切重复：**三页重复“加载→旧记录游标判断→分页→附 languages→转换异常”（`A/architecture-service.ts:910、943、976`）。以后修改旧记录规则容易只改到其中一页；抽一个内部文件页读取助手，各入口保留参数校验和分页函数，能减重复且不丢规则。

先改完列出的几处