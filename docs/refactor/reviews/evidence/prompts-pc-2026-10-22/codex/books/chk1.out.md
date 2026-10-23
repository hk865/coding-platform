只读核对完成；未修改文件，也未运行测试、构建、git 或网络。以下是需要改进任务书的地方；涉及检查失败的判断均来自静态核对。

1. **阻塞｜裁定 13、§4 C：缺少生成脚本的所有权，PC-1a 无法按书完成。**

   `ResolvedPromptPackV1.origins` 要成为必填字段，但生成器目前只返回、输出 `manifest/templates/strings/tools`，见 [build-platform-prompts.mjs:76](D:/cxt/pc/scripts/build-platform-prompts.mjs:76)、[同文件:127](D:/cxt/pc/scripts/build-platform-prompts.mjs:127)。仅重新运行生成器不会产生 `origins`；手改生成模块又被禁止。

   **建议改文：**将 `scripts/build-platform-prompts.mjs` 明确划给 PC-1a 的 C，要求生成每个模板的来源信息。同时说明 `runtime-assets.json` 除增加六项，还须更新修改后的 `pack.json` 的摘要。现有 [check-boundaries.mjs:232](D:/cxt/pc/scripts/check-boundaries.mjs:232)、[同文件:582](D:/cxt/pc/scripts/check-boundaries.mjs:582) 已检查资产闭包及生成物，无需为此放宽检查。

2. **阻塞｜裁定 13“只写、不接线”、§5.3：PC-1a 会撞上未列出的架构测试。**

   C 新增的 `PLATFORM_SKILLS`、默认 source 工厂和部分冻结合同，在 PC-1a 没有生产消费者。仅由新测试使用不能使其生产可达。[production-reach.test.ts:103](D:/cxt/pc/tests/architecture/production-reach.test.ts:103) 禁止未登记的不可达声明；104–105 行又要求已经接线的登记及时删除。

   **建议改文：**给 C 增加 `tests/architecture/production-reach-allowlist.json` 的所有权，仅为实际未接线声明登记已有的 `kept-for` 理由，注明 PC-1b 消费者；给 PC-1b 协调者明确清理责任。将这一项加入 §5.3，不能通过删检查或让测试充当生产入口解决。

3. **阻塞｜裁定 13：直接 Host 配置的选包字段会在设置绑定重建时丢失。**

   当前启动目录只保存 provider/options，[host.ts:393](D:/cxt/pc/src/app/host.ts:393)、[同文件:811](D:/cxt/pc/src/app/host.ts:811)；`settingsModelBinding` 也只恢复这些旧字段，[同文件:667](D:/cxt/pc/src/app/host.ts:667)。设置选择随后会用这个结果替换原始配置中的 model，[同文件:694](D:/cxt/pc/src/app/host.ts:694)。只移动 ID 算法并添加 `modelId`，不能保住直接配置的 `promptPack/reasoningReplay`。

   **建议改文：**PC-1 的启动配置私有映射同时保存这两个字段，重建相应绑定时恢复；设置文件格式和编辑路线仍留给 PC-2。C 的验证必须经过完整 Host 启动及绑定重建，不能止于配置解析和 catalog ID。

4. **应改｜裁定 14、16：已有快照不会保留新增的 `selection`，Query 也没有书中所称的同等快照。**

   [execution-preparation.ts:607](D:/cxt/pc/src/core/agent-runtime/execution-preparation.ts:607) 的快照函数逐字段重建 model，目前只复制 configuration/client/inputCounter。新增 `BoundModel.selection` 会被丢掉。Query 则直接使用 `configured.value`，见 [query-preparation.ts:202](D:/cxt/pc/src/core/agent-runtime/query-preparation.ts:202)、[同文件:238](D:/cxt/pc/src/core/agent-runtime/query-preparation.ts:238)。

   **建议改文：**明确要求 P 更新共享快照函数，复制 `selection`；Work、Query 均在解析 pack 等后续等待之前取快照。S 的启动检查使用同一快照及同一默认值 helper，避免准备阶段误落到 `revision` 回退。

5. **阻塞｜裁定 14、17：冻结路径漏列了三个实际的文本来源。**

   - `renderUnknownCallReviewZh` 的 proposal 分支使用 **`unknown-call-proposal`**，见 [prepared-execution.ts:133](D:/cxt/pc/src/contracts/core/prepared-execution.ts:133)、[同文件:161](D:/cxt/pc/src/contracts/core/prepared-execution.ts:161)。入场校验同时处理 review/proposal，[execution-entry-service.ts:1044](D:/cxt/pc/src/core/work-graph/tasks/execution-entry-service.ts:1044)；只回读 `unknown-call-review` 不够。
   - 初始化协调 Query 直接追加 `initial-planning-answer` 常量，不经过模板 renderer，见 [query-preparation.ts:51](D:/cxt/pc/src/core/agent-runtime/query-preparation.ts:51)、[同文件:227](D:/cxt/pc/src/core/agent-runtime/query-preparation.ts:227)。“只追踪渲染过的模板”会漏它。
   - 角色正文仍经 `platformRoleProfile` 取得生成包中的 label/purpose，见 [context-fact-text.ts:82](D:/cxt/pc/src/core/agent-runtime/context-fact-text.ts:82)、[role-profiles.ts:23](D:/cxt/pc/src/core/agent-runtime/role-profiles.ts:23)。

   **建议改文：**“used templates”包括直接取用的模板正文；初始化指南从本次 resolved pack 读取并登记；entry 按 phase 读取被冻结的 review 或 proposal 模板；角色文案从本次 strings 读取，职责等代码元数据保持原样。

6. **阻塞｜§4：三条接缝尚不足以让 P/S/R 独立施工。**

   `PromptPackSourcePort` 的注入位置没有定稿，而依赖入口 [execution-contracts.ts:207](D:/cxt/pc/src/core/agent-runtime/execution-contracts.ts:207) 不在任何组的文件清单中。P 要求检查的 manifest loaders 又分别在 S 的 Runtime Query 文件和 R 的 WorkGraph Query 文件中。Query reservation 的数据通道也不等于已列出的 `beforeCall` 接缝。

   **建议改文：**开工前再冻结并分配以下内容：

   - pack source 的依赖字段、默认 source 的安装位置及 `runtime.ts` 接线责任；
   - `promptSet` 的校验、正文回读 API，由 P 提供，S/R 各修改自己拥有的 loader；
   - S→R 的 **reservation 和 admission 两种输入合同**；
   - Work 请求读取端口的准确签名及 Runtime 依赖位置。

   `execution-contracts.ts` 须指定唯一 owner；`runtime.ts` 保持由 R 统一接线。

7. **阻塞｜裁定 27：首次写入的位置写错，且 `admitted` 的不变规则有歧义。**

   首次 reservation 是 [query-execution.ts:1302](D:/cxt/pc/src/core/work-graph/queries/query-execution.ts:1302) 的 `recordQueryUsage`；书中引用的 1381–1395 是查找已有 reservation 并将 `admitted` 改成 true 的 admission。Runtime 顺序也确实是 meter persist 后才进入 `beforeCall`，见 [Runtime query-execution.ts:363](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:363)、[同文件:387](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:387)。

   此外，reservation 输入使用的是 [QueryModelUsageV1:356](D:/cxt/pc/src/contracts/query-job.ts:356)，只给其派生类型 `QueryModelRequestV1` 加字段，不能完成首次写入。

   **建议改文：**明确顺序为“计算 facts → reservation 首写完整行、`admitted:false` → admission 比较 facts 并置 true → 后续 usage 只合并四个用量字段”。将 `reservedInput` 也列为不可变事实。“admitted 保留首次值”改成“usage 保留已有值；只有 admission 可以将 false 改为 true”。同时冻结 reservation 输入中的 facts。

8. **阻塞｜§2.6、§5.1、PC-06…17：夹具尚不能视为已经交付、冻结。**

   当前树不存在 `tests/helpers/PC-kernel-fixture.ts` 和 `PC-platform-fixture.ts`。因此无法验证“不得修改冻结夹具”这一施工前提。列出的能力说明还缺少以下必要能力：

   - PC-14/17：同一 Session 的多次真实运行、历史注入和公开历史读取；PC-17 还需合法的 thinking-only 响应。
   - PC-06：通过公开步骤到达 continuation，以及 review/proposal 入场校验。
   - PC-08：真实 Host registry 的安装、绑定固定流程。
   - PC-09：捕获并重放实际 Work 授权及 Query reservation/admission 命令；仅捕获模型请求和读取 prompt record，拿不到完整写入信封。Work 流程见 [model-call-access.ts:76](D:/cxt/pc/src/core/agent-runtime/model-call-access.ts:76)，Query 见上述 reservation/admission 位置。

   **建议改文：**将夹具实际交付和接口核对列为冻结前置项，补足这些能力。PC-11/12/13 的 selector 小输入按规格 PE4 构造即可，不必伪造持久状态；PC-07 的正式 pause/resume 明确为 Work，避免暗示 Query 有同样生命周期。

9. **应改｜PC-15、PC-16：数值正确，但用例前提不完整。**

   [model-budget.ts:82](D:/cxt/pc/src/core/agent-runtime/model-budget.ts:82) 确实给出第二次 reserve `min(256, 400−200)=200`。但默认计量是请求字节数 **加 4,096**，[同文件:87](D:/cxt/pc/src/core/agent-runtime/model-budget.ts:87)，所以窗口 1,000 必须注入 counter。第一次仅返回最终文本也不会产生第二个请求，[runtime-runner.ts:649](D:/cxt/pc/vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:649)。

   **建议改文：**

   - PC-15 指定固定输入计数，例如 700；首轮返回工具调用及真实 output usage 200；两次分别为 `700+256=956`、`700+200=900`。
   - “长 Host instruction”用例明确安排可删除历史，并给出删除后受保护内容能够容纳的预算，才能证明新实现通过、旧实现拒绝。
   - PC-16 指定注入 preview，非夹紧案例 Host cap 至少 250；夹紧案例可定为 150，结果为 `700+150=850`、provider 收到 150。PC-1a 的 K 用夹具 preview 实现该算式，不能依赖 PC-1b 才新增的 `ModelBudget.preview`。

10. **应改｜裁定 2、3：不能承诺 standalone 的超预算结果保持原样。**

    今天 selector 对 **ContextBuilderInput** 做估算，[context-selection-policy.js:98](D:/cxt/pc/vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:98)；新方案对构建后的 **ModelRequest** 做 preview。这两个 JSON 并不相同，且 P3 本身改变保护项和删除次序。

    **建议改文：**把兼容承诺限定为“旧调用参数仍可用；未提供 base/skills 时保持旧来源，未提供 reasoningReplay 时不新增 thinking 过滤；P3 使用新规则”。删除“standalone over-budget results therefore match today’s”。默认 preview 继续使用 runner 已配置的 estimator，避免另行忽略现有 estimator 注入。

11. **应改｜裁定 10、PC-17：thinking-only 的删除条件应再收紧。**

    “空 content、无 toolCalls 就删除”可能让实现者删掉 `current_run` 下仍保留 reasoning 的当前消息。builder 会发送这种 reasoning，见 [context-builder.js:70](D:/cxt/pc/vendor/coding-agent/dist/core/context/builder/context-builder.js:70)。

    **建议改文：**明确“只有按策略移除 reasoning 后，content、reasoning 和 toolCalls 均为空的 assistant entry 才删除”。PC-17 将“当前循环也有 thinking”具体化为包含一条当前 thinking-only 消息，防止两种实现都声称符合文字。

12. **应改｜裁定 28、PC-09：现有 permit lookup 不能直接提供授权顺序。**

    permit 只有 `issuedAt`，没有授权序号，[model-call-contracts.ts:43](D:/cxt/pc/src/core/work-graph/tasks/model-call-contracts.ts:43)；普通 lookup 按 refKey 排序，[in-memory-record-store.ts:495](D:/cxt/pc/src/core/record-store/in-memory-record-store.ts:495)。permit ID 又是摘要，时间相同时按 ID 排序不等于授权顺序。

    **建议改文：**冻结真正的顺序依据，例如在受 Run 并发控制保护的授权写入中保存内部授权序号；不能默认用 lookup 顺序或 `issuedAt + permitId` 代替。把相同时间戳下的两次请求顺序纳入 PC-09。若不要求授权顺序，应由 lead 明确改写这项新增承诺。

13. **应改｜§5.3“构造 FileSkillLoader”的清单过宽。**

    下列位置实际都只是传 Skill selection，并未直接构造 loader：

    | 位置 | 当前行为 |
    |---|---|
    | [S4C2-assembly:107](D:/cxt/pc/tests/runtime/S4C2-assembly.test.ts:107) | 平台根目录，空 enabledIds |
    | [K-readonly-command:151](D:/cxt/pc/tests/runtime/K-readonly-command.test.ts:151)、273 | 定义平台根，传 `platform-work` selection |
    | [C2-runtime-platform-fixture:143](D:/cxt/pc/tests/helpers/C2-runtime-platform-fixture.ts:143) | 传平台 Skill selection |
    | [RL-query-fixture:83](D:/cxt/pc/tests/helpers/RL-query-fixture.ts:83) | 传 `platform-work` selection |
    | [S2B-be1-platform-fixture:255](D:/cxt/pc/tests/helpers/S2B-be1-platform-fixture.ts:255) | 传空 selection |
    | [host-settings:453](D:/cxt/pc/tests/app/host-settings.test.ts:453)、706 | 配置平台根及 enabledIds |

    裁定 15 保留根路径并按路径识别后，这些位置**不因目录删除而需要修改**。

    **建议改文：**移到“查过，无需因删除而改”的清单。保留 W2、AG6、C2 中实际读取旧 Skill 正文或直接测试旧加载路径的改动授权。

14. **阻塞｜裁定 14、22、28 与 §5.3：漏列了会受新接口影响的旧测试。**

    `runObservedModel` 的直接调用者绕过准备流程，现有参数没有 frozen set/body reader。除已列 W2、AG6 外，还有：

    [B1-kernel-assembly:89](D:/cxt/pc/tests/runtime/B1-kernel-assembly.test.ts:89)、[cpp-source-index:148](D:/cxt/pc/tests/data/cpp-source-index.test.ts:148)、[R4c-execution-history:54](D:/cxt/pc/tests/runtime/R4c-execution-history.test.ts:54)、[R4c-graph-history:234](D:/cxt/pc/tests/runtime/R4c-graph-history.test.ts:234)、[R4c-session-continuity:66](D:/cxt/pc/tests/runtime/R4c-session-continuity.test.ts:66)、[source-text-loop-migration:186](D:/cxt/pc/tests/runtime/source-text-loop-migration.test.ts:186)、[source-tool-lifecycle:125](D:/cxt/pc/tests/runtime/source-tool-lifecycle.test.ts:125)。其中 B1:189–200 还直接测试旧 skills 参数。

    renderer 若改成必填 pack 参数，也会影响例如 [A2-rework-contract-helpers:389](D:/cxt/pc/tests/contracts/A2-rework-contract-helpers.test.ts:389)、[C3-brief-timeline:121](D:/cxt/pc/tests/runtime/C3-brief-timeline.test.ts:121)、[K3-16-proposal-input:152](D:/cxt/pc/tests/runtime/K3-16-proposal-input.test.ts:152) 等现有调用。

    **建议改文：**为直接 runner 测试列出统一冻结夹具迁移，限于参数准备及原 Skill 行为所在层的迁移，不放宽断言。纯 renderer 可保留兼容调用入口，正式 preparation/entry 必须显式传冻结来源，避免批改无关测试。另外，若把读方法直接加到 `ModelRequestPort`，还须更新 [B2-runtime-execution:314](D:/cxt/pc/tests/runtime/B2-runtime-execution.test.ts:314) 的两方法包装器；若采用独立读端口，则明确写下，不能笼统承诺整个文件不变。

15. **应改｜裁定 11、23：新增 byte test 的生命周期相互冲突。**

    C 的测试要求读取旧 `content.md` 比较，S 随后删除这些文件；照此写成永久测试，PC-1b 会把 PC-1a 的新测试弄坏。旧正文读取的现成例子见 [C2-runtime-platform-tools.test.ts:63](D:/cxt/pc/tests/runtime/C2-runtime-platform-tools.test.ts:63)。

    **建议改文：**迁移时做旧文件与模板的逐字节核对；永久测试使用经 lead 核对的固定正文或字节摘要，删除后仍可运行。或者明确由 S 在删除时转换该测试，并把测试文件交接列入 §4。不能留下旧目录副本。

16. **应改｜§2.1、裁定 14、§2.8：新增 manifest 元数据与“输入始终逐字节不变”存在边界冲突。**

    现有 review 缩减按**整个 manifest** 的序列化大小决定，[execution-preparation.ts:514](D:/cxt/pc/src/core/agent-runtime/execution-preparation.ts:514)、[同文件:549](D:/cxt/pc/src/core/agent-runtime/execution-preparation.ts:549)。加入必填 `promptSet` 后，临界大小的旧输入可能需要多缩一点；若计量时故意排除它，又会低估最终 manifest。

    **建议改文：**明确 PC-1 将 `promptSet` 纳入现有整体大小计量，保持原缩减算法与顺序，允许仅由新增元数据占用引起的边界缩减或容量拒绝；PC-2 才改缩减位置和规则。相应收窄“byte-identical”的适用条件，并把已列 K3-35 测试的修改理由写清。

结论：改后再核