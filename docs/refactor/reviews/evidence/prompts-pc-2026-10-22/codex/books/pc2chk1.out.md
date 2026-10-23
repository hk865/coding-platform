本版需要修改后再核。PC-1 的接口名称、设置路由的门禁、现有历史选择判据及 K3 收缩位置基本核对正确；主要问题如下。此次仅阅读文件，未运行测试、构建、git 或网络。

1. **阻塞｜裁定 4、11、19，§4：PC-2a 无法独立保持编译通过。**  
   A 在第一晚新增必填 `sectionOrder`、`PromptSetV1.tools/toolNames`、`toolOrigins`，相应生产者却归第二晚：绑定由 [context-work-recipe.ts:300](D:/cxt/pc/src/core/agent-runtime/context-work-recipe.ts:300)、[context-query-recipe.ts:80](D:/cxt/pc/src/core/agent-runtime/context-query-recipe.ts:80) 创建；冻结集由 PC-1 的 `storePromptTexts` 创建（[PC-1:568](D:/cc-lead-notes/impl/pc/pc1-book.md:568)）；生成平台包也不归 A。  
   **改书：**明确第一晚的完整过渡提交，或将必填字段及全部生产者一起移到第二晚；不要用兼容旧记录的可选字段补洞。`toolOrigins` 若第一晚必填，生成器和生成模块必须同晚更新。

2. **阻塞｜§4：文件归属不完整，测试归属有交叉。**  
   PC-1 明定装配根注入包源、`runtime.ts` 实现正文读口（[PC-1:522](D:/cc-lead-notes/impl/pc/pc1-book.md:522)、[537](D:/cc-lead-notes/impl/pc/pc1-book.md:537)），PC-2 却未分配这两处；`takesSessionHistory` 所在 [prepared-execution.ts:195](D:/cxt/pc/src/contracts/core/prepared-execution.ts:195) 及 Query manifest 校验 [query-execution.ts:427](D:/cxt/pc/src/core/work-graph/queries/query-execution.ts:427) 也漏归属。G 的“手写 bindings”与 Q 的 K3 收缩测试会覆盖同一文件。  
   **改书：**逐文件分配装配根、manifest 类型/读取器、`readPromptRecord` 新正文遍历、两个 contracts renderer；旧测试也逐文件唯一归属。第一晚若留下未接消费者的声明，明确 architecture allowlist 的添加和第二晚移除责任。

3. **阻塞｜裁定 16，§4：最终工具选择仍留给实施者设计。**  
   `kernelEnabledToolNames` 已经是纯函数，但扩展名不是单靠权限数组决定：[execution-driver.ts:485](D:/cxt/pc/src/core/agent-runtime/execution-driver.ts:485) 按复核阶段注册；[508](D:/cxt/pc/src/core/agent-runtime/execution-driver.ts:508) 按阻塞命令注册；只读命令还取决于完整工作区读取授权（[readonly-command-tool.ts:408](D:/cxt/pc/src/core/agent-runtime/readonly-command-tool.ts:408)）。  
   **改书：**开工前冻结函数签名及输入：Work/Query、有效权限、只读状态、复核阶段、阻塞命令、各 owner 能力、固定来源/material 能力、只读命令开关与 `allowsRead('.')` 结果；冻结输出顺序和拒绝语义。保持 [tool-group-assembly.ts:425](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:425) 的顺序，不让实施者自行选择集合比较或数组比较。

4. **阻塞｜裁定 16–18：没有覆盖所有模板的工具块渲染。**  
   简报、复核及提方案 renderer 当前都传 `[]`，见 [continuation-brief.ts:415](D:/cxt/pc/src/contracts/continuation-brief.ts:415)、[prepared-execution.ts:168](D:/cxt/pc/src/contracts/core/prepared-execution.ts:168)、[192](D:/cxt/pc/src/contracts/core/prepared-execution.ts:192)。只冻结 `toolNames`、修改 `base`，不会让这些模板中的工具块生效。  
   **改书：**明确同一冻结清单贯穿所有实际使用模板、Skill、收缩重渲染和入口重渲染；补齐相应签名、文件 owner，以及非 `base` 模板工具块的验收行。

5. **阻塞｜裁定 18、PC-19：平台扫描按当前定义必然失败。**  
   [initial-planning-answer.txt:14](D:/cxt/pc/resources/prompts/platform/templates/initial-planning-answer.txt:14) 的普通检查概念包含完整单词 `check`，声明却为空。PC-1 原样搬入的 Skill 还含 `check`、`write` 和真实工具名，例如 [platform-work/content.md:39](D:/cxt/pc/resources/skills/platform-work/content.md:39)、[43](D:/cxt/pc/resources/skills/platform-work/content.md:43)、[45](D:/cxt/pc/resources/skills/platform-work/content.md:45)，PC-1 同样规定空声明。把 `check` 补进声明又会使准备永久拒绝。  
   **改书：**冻结普通词/字段名与工具引用的判定，明确有限的非工具命中豁免；逐个处理 Skill 的真实工具引用。若用条件块包裹 Skill 指导，必须同时修订“其他文字字节不变”的范围及相关旧测试授权。

6. **阻塞｜PC-24–PC-26：工具文字样例违反现有键集合，Query 样例不可达。**  
   [record_note.json:3](D:/cxt/pc/resources/prompts/platform/tools/record_note.json:3) 的 `parameters` 是 `{}`。因此修改参数说明、删除参数键都无法成为合法样例。十个文件中，note、project-source、communication、graph、session-discovery 五组均没有现成参数说明。Query 只装配图协调工具，不装配 `record_note`（[query-execution.ts:208](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:208)）。  
   **改书：**PC-24 覆盖 31 个工具的 description，仅对八个非空参数表覆盖参数说明；PC-25 用 `list_files.prefix` 等验证缺键。PC-26 保留 Work 的 `record_note` description，再用 Work/Query 都可获得的 `list_files.prefix` 验证参数冻结，不扩张 Query 权限。

7. **阻塞｜裁定 2–3：包目录自身的链接可以绕过隔离。**  
   当前规则只比较 `prompts/` 与工作区，并要求文件位于“包的 realpath”内。若 `prompts/mine` 链接到工作区中的目录，两条检查都通过，但 agent 仍能改包，违背 [规格:80](D:/cxt/pc/docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:80)。  
   **改书：**每个包及父包的真实目录必须位于真实 `prompts/` 内；`pack.json` 和保存目标的实际父目录也受边界检查。路径判断按 `..` **段**，不能误拒绝合法的 `..name`。

8. **应改｜裁定 20–21：文字接线清单少了实际创建点。**  
   `assembleObservedExtensions` 接收的是已经创建好的闭包（[tool-group-assembly.ts:390](D:/cxt/pc/src/core/agent-runtime/tool-group-assembly.ts:390)），无法事后替换其文字。还须经过 [observed-model-run.ts:309](D:/cxt/pc/src/core/agent-runtime/observed-model-run.ts:309) 的 exploration 工厂、[exploration-tools.ts:165](D:/cxt/pc/src/core/agent-runtime/exploration-tools.ts:165) 的 project-source 子工厂，以及 [readonly-command-tool.ts:417](D:/cxt/pc/src/core/agent-runtime/readonly-command-tool.ts:417) 的注册包装。  
   **改书：**逐条列出传递链；规定逐工具 fallback，即 `texts[name] ?? platform.tools[name]`，不能只给整个参数默认值。冻结集只含启用工具，而工厂可能同时构建未启用兄弟工具。

9. **应改｜裁定 4、§4：A/H 的验证契约尚不够明确。**  
   现有生成器只做部分结构检查（[build-platform-prompts.mjs:44](D:/cxt/pc/scripts/build-platform-prompts.mjs:44)）；书没有明确 manifest 身份一致性、字符串值类型、`mentionsTools` 类型、继承终点和有效 manifest 元数据如何合并。“parameters value”也容易被理解成整个 `parameters` 是字符串。  
   **改书：**冻结读取链 DTO、完整验证结果及有效模板的版本/声明来源；明确 `parameters` 是对象且各值为字符串。另明确必填**值为空**也使用可辨识错误并映射 `invalid`（现有检查在 [render-template.ts:207](D:/cxt/pc/src/contracts/prompts/render-template.ts:207)），补 PE8 行。可选槽能否从模板删掉，也应明确，避免与 P1“不能加减槽位”出现两种解释。

10. **应改｜裁定 12：守卫职责与入口职责需要写全。**  
    当前范围检查就在状态守卫的 [context-input.ts:178](D:/cxt/pc/src/core/work-graph/state/context-input.ts:178)，书却只明确入口新增范围相等和出现一次。实施者可能仅删除守卫的尾段限制。I-19 还有固定 marker 行号假设（[invariants.ts:1864](D:/cxt/pc/tests/state/invariants.ts:1864)）。  
    **改书：**守卫接受已经重渲染的正文，统一核区间相等和唯一出现；入口负责读取冻结正文并调用它。明确绑定顺序与冻结集对应顺序一致；I-19 不再要求 marker 位于固定行。PE9 分别列范围错误、重复正文及非尾段成功。

11. **应改｜§5.1：夹具说明不足，PC-23 的目录方向还写反了。**  
    “workspace root configured inside settings directory”不意味着工作区包含 `prompts/`。PC-23 要的是设置/prompts 位于工作区之内。盘点已经列出必要能力（[inventory:220](D:/cc-lead-notes/codex2/pc/inv-pc2.out.md:220)）。  
    **改书：**补配置根与恢复根两种关系、相等路径/链接场景、文件字节快照；补真实 K3 **触发收缩且后面有提醒**、Query 历史派生、PE8 空槽值注入、PE9 公开入口负向输入装置。还要冻结历史判定和重渲染材料的具体签名，不能到 T 开工后再选“材料或函数”。

12. **应改｜§5.3：旧测试清单确有漏项。**  
    新目录检查会拒绝以下数据目录兼工作区配置：
    - [S2B-backfill-host.test.ts:78](D:/cxt/pc/tests/app/S2B-backfill-host.test.ts:78)，同文件 118、142；
    - [S2B-35-activity-routes.test.ts:202](D:/cxt/pc/tests/app/S2B-35-activity-routes.test.ts:202)；
    - [S2B-r2-backfill-kernel-support.ts:136](D:/cxt/pc/tests/helpers/S2B-r2-backfill-kernel-support.ts:136)，影响真实 Kernel backfill 测试。
    
    此外，[context-input.test.ts:162](D:/cxt/pc/tests/state/context-input.test.ts:162) 的 ST08 专门拒绝简报后的文字，不能只补 `sectionOrder`；PC-1 的六模板 digest 测试也锁住旧 `base`（[PC-1:237](D:/cc-lead-notes/impl/pc/pc1-book.md:237)）。  
    **改书：**仅允许上述夹具分离设置目录、ST08 改为新范围规则、更新 `base` v2 指纹；补新必填 manifest 字段的机械更新范围。没有旧假设的 K3 测试维持不动。

13. **应改｜裁定 6：坏包编辑和错误响应仍有分歧空间。**  
    `read` 承诺正文、版本、digest，同时承诺 problems；文件缺失或 JSON 损坏时这些值可能不存在。`save` 的“description”也未定义为哪种 DTO。  
    **改书：**冻结成功响应结构，并规定未知包/模板/工具、损坏正文、无法取得有效版本时的错误码和 problems；建议不存在回 `not_found`、损坏回 `invalid`，list 保留坏包诊断。另把裁定 1“路由不存在”改成沿现有无 settings port 的 `unsupported` 行为（[server.ts:343](D:/cxt/pc/src/app/server.ts:343)）。

14. **应改｜裁定 7–8：设置字段清除与 PC-1 的启动配置回填需要明确优先级。**  
    PC-1 要求私有启动目录保留直接绑定的选择，并在 `settingsModelBinding` 中恢复（[PC-1:294](D:/cc-lead-notes/impl/pc/pc1-book.md:294)）。PC-2 又规定字段缺失时使用默认值。保存已有模型时省略字段，可能被实现为清除，也可能重新恢复启动时的旧包。  
    **改书：**明确保存省略字段是否清除；建议与现有模型保存形状一致，清除后解析为默认值，启动目录只负责初始化，不能覆盖后续设置。补重启后的公开设置/执行验收。

15. **应改｜裁定 5、PC-21：引用的预算手算例已经不适用。**  
    [inventory:247](D:/cc-lead-notes/codex2/pc/inv-pc2.out.md:247) 使用 `omit 1`，裁定 5 却禁止改省略标记。真实 `另有 1 条，用‘看’读` 是 30 UTF-8 字节，原来的 25 字节预算不会得到预期结果。  
    **改书：**保留 F/N/M/I 标签，将输入行改为 40 个 `I`：全保留计费 59，保留前三行、输入仅省略标记计费 49；预算设 49，独立手算区间。

16. **应改｜裁定 4–5、21：两个已开放的字符串键没有消费路径。**  
    [whiteboard-tools.ts:198](D:/cxt/pc/src/core/agent-runtime/whiteboard-tools.ts:198)、[200](D:/cxt/pc/src/core/agent-runtime/whiteboard-tools.ts:200) 的参数说明来自 `strings['toolSchema.whiteboardPin.*']`，并非工具条目的 `parameters`。按书合并这些字符串、只向工厂传 `tools`，用户修改会被静默忽略。  
    **改书：**明确这两个键采用冻结字符串，并补传递接口；若决定固定，须明确列入固定键及理由，不能接受修改后仍发送平台原文。

17. **应改｜§6：规模口径不一致。**  
    盘点为新增 5,090、删除 1,030，共 **6,120**（[inventory:266](D:/cc-lead-notes/codex2/pc/inv-pc2.out.md:266)）；本书总数 **6,650**，只多 530。83-5 分项按表的“新增＋删除”口径是 `100+250+500+150=1,000`，不能再用 W 的净增扣减。  
    **改书：**先以约 **7,100 行**作为盘点加 83-5 的预算基准，再单列 PC-1 已接走部分的扣除额；每组分别报新增、删除、合计。夹具和新增旧测试调整计入对应组，不混用净增。

结论：改后再核