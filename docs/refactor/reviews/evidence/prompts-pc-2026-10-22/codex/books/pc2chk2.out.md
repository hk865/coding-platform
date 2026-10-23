| 首轮项 | 状态 | 核对结果 |
|---|---|---|
| 1 | 已修 | 改为一轮施工，整轮结束保持绿。 |
| 2 | 部分修复 | 已列文件没有重复归属；allowlist 的清理仍无 owner，见新问题 8。 |
| 3 | 部分修复 | 已给函数，但输入和拒绝语义不完整，见新问题 3、4。 |
| 4 | 部分修复 | 已覆盖各类渲染；新增签名漏掉 PC-1 的包参数，见新问题 1。 |
| 5 | 已修 | Skill 渲染、工具块、版本、扫描豁免及指纹更新均已写入。 |
| 6 | 已修 | PC-24～26 的参数样例和 Query 工具选择已纠正。 |
| 7 | 已修 | 包及父包的真实目录边界、保存目标父目录和 `..` 段规则已补。 |
| 8 | 已修 | 工厂创建前的传递链、包装层及逐工具回退已补。 |
| 9 | 部分修复 | 校验规则已补；解析结果仍丢失继承模板的声明，见新问题 2。 |
| 10 | 已修 | 守卫、入口、I-19 和三类 PE9 行已明确。 |
| 11 | 部分修复 | 夹具能力已补；重渲染材料及历史判定的跨组接缝仍不足，见新问题 5～7。 |
| 12 | 部分修复 | 原漏项已补；新增渲染必填参数影响授权清单外的旧调用，见新问题 1。 |
| 13 | 已修 | 成功 DTO、错误分类及坏包列表行为已明确。 |
| 14 | 已修 | 省略即清除、启动配置不覆盖后续保存及重启行已明确。 |
| 15 | 已修 | 省略行 30 字节，全留 59、保留前三项 49，计算正确。 |
| 16 | 已修 | 两个白板参数说明迁入两个工具的参数表，并交 W 消费。 |
| 17 | 已修 | 分组和增删口径一致，合计 7,139 正确。 |

8 项 `[DSH choice]` 的意见：

| 项 | 意见 |
|---|---|
| 1．`PromptRenderError` | 接受类名和 code 集。 |
| 2．读取链及问题 DTO | 接受 `{file,text}` 和问题字段；解析输出须补齐有效模板声明，见新问题 2。 |
| 3．路由 DTO | 接受；保存返回新版读取描述可行。 |
| 4．重渲染材料 | 修改：保留省略元数据和实际计费值，并明确类型出口，见新问题 5。 |
| 5．历史判定 | 接受名称和模式；补跨组传递接口，且 Query 有 basis 时不要求读取目标边界，见新问题 6、7。 |
| 6．最终工具函数 | 接受名称；输入及返回契约需修改，见新问题 3、4。 |
| 7．`readPromptTexts` 返回形状 | 接受增加 `tools`；只读 Skills 与题设实建接口一致。 |
| 8．白板参数路径 | 接受。两个工具应分别读取各自的 `expected[].ref/revision`，允许文字不同。 |

1. **阻塞｜裁定 10：两个渲染签名漏掉 PC-1 的包参数，也破坏旧调用兼容性。**

   PC-1 要求准备和入口显式传入解析后／冻结的包，并保留无包参数的纯调用兼容性；其窄类型是 `PromptTextsV1`。见 [pc1-book.md:330](D:/cc-lead-notes/impl/pc/pc1-book.md:330)、[pc1-book.md:347](D:/cc-lead-notes/impl/pc/pc1-book.md:347)、[pc1-book.md:560](D:/cc-lead-notes/impl/pc/pc1-book.md:560)。v2 的完整签名只有业务输入与工具清单，没有传入冻结模板、字符串表的位置。

   同时，未列入 §5.3 的旧测试仍使用两参数简报调用和单参数复核调用，例如 [C3-brief-timeline.test.ts:121](D:/cxt/pc/tests/runtime/C3-brief-timeline.test.ts:121)、[K3-16-proposal-input.test.ts:152](D:/cxt/pc/tests/runtime/K3-16-proposal-input.test.ts:152)。按新增必填参数实施，这些调用不能编译。

   **改书：**冻结同时接收 `PromptTextsV1` 和工具清单的完整签名；保留 PC-1 的纯调用兼容重载，生产调用必须显式传入两者。若决定取消兼容重载，则逐文件授权机械补参并分配 owner。

2. **阻塞｜裁定 4、6、18：继承模板的 `mentionsTools` 无法从解析结果取得。**

   v2 规定有效 `manifest` 保留请求包自己的内容，只合并三个正文映射；`origins` 又只有来源包和版本。模板声明实际位于 `manifest.templates[id].mentionsTools`，见 [prompt-pack.ts:11](D:/cxt/pc/src/contracts/prompts/prompt-pack.ts:11)。Runtime 经包源得到的只有解析结果，不含原始继承链，见 [pc1-book.md:271](D:/cc-lead-notes/impl/pc/pc1-book.md:271)。

   因此，子包只覆盖 `base` 时，Q 无法取得其余继承模板的声明来执行裁定 18；例如平台 proposal 确实声明了 `propose_safer_method`，见 [pack.json:36](D:/cxt/pc/resources/prompts/platform/pack.json:36)。

   **改书：**让 `origins[id]` 同时保留供应条目的 `mentionsTools`，或增加等价的有效模板元数据映射。版本明确取供应包的 `manifest.templates[id].version`。H 的读取响应和 Q 的声明检查统一消费该映射，T 同步生成平台值。

3. **阻塞｜裁定 16：输入缺少 `reviewSource`，且 `blockedCommands` 类型错误。**

   固定源码能力与替换 `read` 是两个独立条件：前者来自 `projectSource.mode`，后者来自 `sourceTools.includeReadSource`，见 [observed-model-run.ts:200](D:/cxt/pc/src/core/agent-runtime/observed-model-run.ts:200)、[observed-model-run.ts:266](D:/cxt/pc/src/core/agent-runtime/observed-model-run.ts:266)。现有输出函数也分别接收 `reviewSource` 和 `hasFrozenSource`，见 [tool-group-assembly.ts:428](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:428)。v2 只有 `frozenSource`，无法无歧义地选择两条输出分支。

   另外，manifest 的 `blockedCommands` 是对象数组，并非字符串数组，见 [prepared-execution.ts:243](D:/cxt/pc/src/contracts/core/prepared-execution.ts:243)。

   **改书：**增加独立的 `reviewSource: boolean`；`blockedCommands` 使用实际 manifest 元素类型并规定缺省归一为 `[]`，或明确改为仅需的 `hasBlockedCommands: boolean`。现有输出顺序描述可以保留。

4. **阻塞｜裁定 16：缺 owner 的处理前后矛盾，复核／重跑工具也不能统一按 `selected` 筛选。**

   现有协调选择遇到所需 owner 缺失会返回 `unsupported`，不是静默删工具，见 [tool-group-assembly.ts:213](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:213)。`applicationReceipt` 则只是可选增强，不决定白板工具能否注册，见 [tool-group-assembly.ts:236](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:236)。

   复核工具由 Run purpose 决定，重跑工具由普通 Work 加非空阻塞绑定决定，并不要求相应名字出现在 `selected`，见 [execution-driver.ts:482](D:/cxt/pc/src/core/agent-runtime/execution-driver.ts:482)、[execution-driver.ts:508](D:/cxt/pc/src/core/agent-runtime/execution-driver.ts:508)。v2 的“来自 selected 和 owners”“缺 owner 保持工具不出现”会改变这些规则；`string[]` 返回值又没有承载规定拒绝的方式。

   **改书：**返回现有风格的 `ToolGroupResult<string[]>`，先处理拒绝，再比较数组。逐类写明条件：协调工具按选择与必需 owner；复核／重跑按现有 purpose／阻塞规则；`applicationReceipt` 不作注册门槛。`graph`、`notes` 布尔值也明确代表所需端口组合，而非对象存在即可。

5. **阻塞｜裁定 13：重渲染材料丢失省略状态，不能可靠重建承诺的绑定。**

   当前 renderer 单独保存部分省略计数和整段省略状态，再将它们写入 `sections`；这些信息不只是槽位的字节区间。见 [context-rendering.ts:140](D:/cxt/pc/src/core/agent-runtime/context-rendering.ts:140)、[context-rendering.ts:205](D:/cxt/pc/src/core/agent-runtime/context-rendering.ts:205)。绑定要求每段同时具有 `omitted` 和可空区间，见 [graph-context.ts:112](D:/cxt/pc/src/contracts/graph-context.ts:112)。

   v2 材料只有最终槽字符串和预算上限，没有原始行、选中前缀、省略元数据或实际计费值。实现者只能重新解析正文猜这些事实，尤其无法直接区分“本来没有行”和“整段被省略”。另一个接缝是 `ContextTemplateId` 当前只在 renderer 内私有声明，见 [context-rendering.ts:57](D:/cxt/pc/src/core/agent-runtime/context-rendering.ts:57)。

   **改书：**材料补充冻结后的段元数据（名称、省略计数、是否整段省略）及实际 `residentBytes`；重渲染只替换 review、重算区间和总字节，保留预算选择。将 `ContextTemplateId` 移到或导出自 T 拥有的公共类型模块，明确函数实现与导入位置。

6. **阻塞｜裁定 10、14、15及 §4：T 与 Q 之间仍没有冻结“同一次准备判定”的传递接口。**

   Work 的 `sessionBasis` 在配方内部组装简报或复核材料后才确定，见 [context-work-recipe.ts:235](D:/cxt/pc/src/core/agent-runtime/context-work-recipe.ts:235)、[context-work-recipe.ts:255](D:/cxt/pc/src/core/agent-runtime/context-work-recipe.ts:255)。Query 当前则在 assembler 返回后才计算它，见 [query-preparation.ts:249](D:/cxt/pc/src/core/agent-runtime/query-preparation.ts:249)。现有 assembler 接口没有历史判定或工具清单的传入／传出位置，见 [context-types.ts:59](D:/cxt/pc/src/core/agent-runtime/context-types.ts:59)。

   v2 冻结了纯函数，却没有规定：T 用哪份准备边界渲染提醒，Q 又从哪里取得同一次判定写进 manifest。

   **改书：**补完整 assembler 接缝：工具清单进入两种配方；Query 的 basis 在装配前传入；Work 在已有种子确定后判定；准备边界只由明确的一方读取；`AssembledContextV1` 返回本次实际使用的历史判定或 `takesSessionHistory`，Q 原样冻结。把这些接口加入 T 交接清单，避免 T、Q 各算一次。

7. **应改｜裁定 14：Query 有 `sessionBasis` 时不应强制取得目标 Session 的 completed boundary。**

   当前 Query 在有 basis 时直接选固定源前缀或明确空基线，只有没有 basis 的分支才调用 cursor owner，见 [query-execution.ts:473](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:473)、[query-execution.ts:483](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:483)。v2 将 `completedBoundary` 设为无条件必填，又统一要求准备读取边界，增加了原分支不需要的读取依赖。

   **改书：**允许该输入在 Query 有 basis 时缺席；明确此分支不读取目标边界，也不伪造零边界。Work 和无 basis 的 Query 才要求真实 completed boundary。两类历史选择的优先级文字本身正确。

8. **应改｜§2.3、§4：allowlist 清理有要求，没有文件 owner。**

   §4 没有分配 `tests/architecture/production-reach-allowlist.json`，同时禁止无 owner 的文件被编辑。检查会拒绝已经可达却仍留在 allowlist 的条目，见 [production-reach.test.ts:103](D:/cxt/pc/tests/architecture/production-reach.test.ts:103)。PC-1 也曾将最终清理明确交给唯一的联合步骤 owner，见 [pc1-book.md:315](D:/cc-lead-notes/impl/pc/pc1-book.md:315)。

   **改书：**明确由 Q 在联合步骤独占该文件，各组只报告需清理或保留的条目；最后统一修改并检查。

9. **应改｜PC-20、§5.1：`read_source` 场景仍没有明确可达的准备到请求入口。**

   现有 Work、Query 的生产 source options 都没有设置 `includeReadSource`，见 [execution-driver.ts:882](D:/cxt/pc/src/core/agent-runtime/execution-driver.ts:882)、[query-execution.ts:319](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:319)。仅将工具权限设成 `read_source` 也不会获得该模式：探索工具启用仍依赖 builtin `read`，见 [tool-group-assembly.ts:438](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:438)。PC-1 夹具目前暴露的是权限 `tools`，见 [PC-platform-fixture.ts:65](D:/cc-lead-notes/impl/pc/fixtures/PC-platform-fixture.ts:65)。

   **改书：**明确“四种清单”的 renderer 字面测试与真实准备到请求测试各走哪个公开入口。若 `read_source` 场景必须端到端，先冻结能同时影响准备计算和启动装配的夹具注入点；不能只改启动参数、手写冻结集，或新增产品权限来凑该行。

按 §5.1 承诺的夹具能力，PC-04、PC-05、PC-23～26、PE8、PE9 没有新增的公开步骤障碍；PC-18 需先补问题 6、7，PC-20 需补问题 3、9，PC-21 需补问题 5。其字面期望和范围均可独立手算。工具文字传递链与两处算术没有新增问题。

本次仅做只读核对，未修改文件，未运行测试、构建、git 或网络。

结论：改后再核