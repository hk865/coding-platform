# 契约本体清理续轮

本目录属于同一个有界 [源码清理 evidence](../verification.md)，追加记录本轮实际契约重构，不覆盖前轮失败和结论。当前状态仍只在 human/module-status.md 与 IMPLEMENTATION-HANDOFF.md。本轮不实现协调角色消费工具 FAIL 后的语义改计划。

## 起点与范围

两个 dirty 工作树身份见 [baseline.json](baseline.json)，完整起点状态分别在 product-status-before.txt 和 docs-status-before.txt。产品 HEAD `65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d`，文档 HEAD `2f9a5df01175fb5686bb8bf02abc65216055a570`。起点产品源码摘要 `30807ce2d094385e97ad7b512bdb4f85fd454e171e3547a8860c21af84a6d54f`，文档摘要 `8006eff0987151068691f7cc3a4104aed6f5f945473d70be7363d18bc2945bc7`。

与前轮 final.json 相比，仅产品 .gitignore 已额外变化，本轮保留。可观察到多个 Node 宿主进程（process-observation.json），不能据此认定它们在写源码；迁移前按起点摘要检查目标、保留原文。最终范围与既有改动保护核对见 preservation.json。没有 reset/clean/checkout/stash、提交、推送、依赖重装或持久数据迁移。

交付身份见 [final.json](final.json)：产品摘要 `486834413c503516aeb7646ec2baec4f911bae79f89aa89903bc8254cac4647a`，文档摘要 `e87d6833641efbb10cd86ffdcfc027ad439fd98065068d41c149bb9ea5b2e596`，两个 HEAD 均与起点相同。相对本轮 dirty 起点，产品98个路径变化（72修改、21新增、5个被迁移的旧入口删除），文档5个修改。所有82个涉及的既有文件原文均与起点SHA一致保存在history；未发现未保存或额外消失的既有文件，.gitignore与UI探针原文件摘要保持不变。完整路径列表在 [preservation.json](preservation.json)。

本轮只改协议组织、消费导入和失效说明。校验函数与返工声明的实现体不变；两处 Control 校验消费者文件只改 imports 和注释。没有新增 Module、业务流程、长期依赖、HTTP 路由、存储或 UI 行为。

## 结构与消费者证据

| 之前 | 之后 | 判断依据 |
| --- | --- | --- |
| contracts/validation.ts，3510 行，混合 16 类协议与基础校验 | validation 下 16 个直接入口，最大 context.ts 383 行；无汇总 barrel | [validation-plan.json](validation-plan.json) 记录符号依赖与35个静态导入消费者；额外 inline 类型引用也迁移。Control、Context、Runtime、ReadModel和测试只导入所需协议 |
| rework.ts 混合失败事实、处置视图、提案与身份；drive/acceptance/disposition 平面散落 | rework/issues.ts、proposal.ts、drive.ts、acceptance.ts 四个入口 | [rework-map.json](rework-map.json) 记录原声明归属及35个静态/inline消费者。issues 聚合 Verification 来源与 Control 处置，proposal 复用 PlanProposal；drive/acceptance 保留真实责任差异 |
| ReworkDispositionPort 单独文件 | 与问题请求、视图共同定义 | Control 生产，Verification/Dispatch 消费，是真实跨 Module 协议 |
| ReworkIssueReadPort 公共协议导出 | harness/rework-composition.ts 的宿主类型 | 仅3个 harness 文件和1个测试夹具使用；模块不持有该 Verification 读取器，组合根先取材料后交 Dispatch |
| ReworkIssueMaterials = OpenIssuesViewV1 | 删除同义别名 | src/tests/scripts 无消费者；遍历相邻 coding-agent 无已知外部引用。保留真实 OpenIssuesViewV1 |
| validation/rework 历史阶段标题，两 Control 文件的 FROZEN/Lane A/旧交接施工说明 | 当前字段、零写入、身份、CAS、不清除旧义务等约束 | 迁移前正文保存在 history；没有按关键词删除仍有效的限制 |

完整行数与导出列表见 [metrics.json](metrics.json)。本轮 contracts TS 文件 101→116，顶层文件 90→85。源码语法导出声明 1521→1531：12 个原私有声明因校验器跨文件复用而导出，删除1个无消费者别名、1个宿主私有类型移出。共享校验导出是结构原语，不能声称公共业务接口数量全面减少。原75个公开校验声明原样迁移，消费导入同步，没有制造另一份校验权威；这不代表已经逐一收窄全仓所有旧公开导出。

## 兼容性与保留项

[compatibility.json](compatibility.json) 比对所有 1572 个保留契约声明，170 个迁移声明的函数/类型体等价；只归一 import 相对路径、export 修饰与注释。独立复核另检查既有消费者绑定与循环，见 [independent-review.md](independent-review.md)。类型检查验证实际解析，运行测试验证所覆盖的语义；AST 等价本身不代替运行验收。

持久事件、journal、快照、schemaVersion、身份散列、错误码/消息与 HTTP 形状不变。含 P1-03 的既有错误消息仍保留：它是运行期输出，不因清理注释修改。源码 deep-import 路径发生变化，仓内生产/测试/UI消费者全部迁移；package.json 标记 private 且无 package exports，相邻仓未找到引用。这不承诺未知外部 deep-import 兼容。

以下兼容/差异继续保留：Verification 的 legacyFingerprintMatches 服务旧 command-check journal，仍拒绝把旧指纹解释为新 round binding；plan.revisionAssignments 服务旧计划指派位置，不能删除历史计划的读取；Query 未启动记录恢复仍先核实副作用，不能盲重跑。不同字符串/数组校验的允许值、返回形状和错误路径不同，没有为去重而合并。样例内容校验仍有真实消费者，本轮不改变它们的加载路径。移除这些兼容分支之前必须证明相应历史数据已无消费者或完成经授权迁移。

## 验证与真实失败

- Windows 初次类型检查失败：缺少可解析的 node/vitest 类型，环境问题；types-initial.log/exit 保留。没有重装依赖，改用最新交付已验证的 WSL Node 24、隔离 runner、Chromium 1234 与本地 bubblewrap。
- 相关行为：targeted.log，13文件/136项 PASS。
- 候选类型与模块边界：backend-types-final、ui-types-final、boundaries-final 均返回0；边界12 Module、零问题。
- 全仓行为：full-tests.log，299文件/1951项 PASS，full-tests.exit=0。外层 wrapper 随后退出1：主 Agent 在其运行期间补写脚本分支，导致 bash 读取偏移失效；这是本轮验证操作错误，原始摘要保存在 full-wrapper-failure.txt。脚本已固定并以 bash -n 核验，后续运行不再编辑它；不把整条失败命令伪报为成功，也未改断言或跳过测试。
- 旧构建产物首检返回1：5个被迁移契约的旧 dist/*.js，见 artifacts-before.json/log/exit；保存原文并仅删除明确白名单路径，见 artifacts-remove-known.json。
- 完整构建：build.log/exit PASS；ui-artifacts.log/exit 的6步真实构建/HTTP检查均通过，源码探针原样恢复。artifacts-after.json 扫描338个服务端JS产物，无失去源码对应的旧文件。
- 首次浏览器验收：browser.log/exit 返回1，默认4399端口已被已有服务占用，测试未启动，属于环境问题。保留已有服务；本轮 playwright.config.ts 继承原配置，仅覆盖端口为44391，browser-isolated.sh 通过已有环境入口使用全新隔离夹具目录。Chromium、沙箱、26项测试、断言和不复用旧服务的设置均保留。browser-isolated.log/exit：26项 PASS（4.2分钟），包含实际HTTP、SQLite、内核、Reviewer与重开原FAIL；语义场景截图保存在browser-results-isolated，已查看原FAIL和协调调查来源的实际展示。
- 文档首检 docs.log/exit 为12/13：历史 reviewer-continuation.md 的一个链接仍指向旧 validation.ts。这是路径迁移造成的文档回归，只修复精确链接与行号，历史结论/原文保留。docs-final.log/exit 为13/13 PASS；涉及产品Markdown的62条本地链接也全部可解析（source-docs.json）。

没有已确认产品回归。环境与运行脚本错误未用后来的 PASS 覆盖。

## 下一步实现协调角色消费 FAIL 并调整计划

1. **失败材料进入**：VerificationService.openIssues / VerificationOpenIssues 从持久工具轮次和 Reviewer 结果组织来源，问题协议为 contracts/rework/issues.ts；ControlReworkDisposition 解释当前义务承担者。service.ts 组合 composeReworkDrive 先取问题，作为 issueMaterials 传入 Dispatch。
2. **协调角色实际消费**：ExecutionFeedbackCompiler.request → Control.submitQueryJob → QueryJobDrive 的 execution_coordination 只读 Run，Context 组装执行者公开 execution_feedback 与来源。它现在实际调查的是执行反馈；不是工具 FAIL 自动转成的语义调查。
3. **调整提案提交**：现有机械返工 ReworkPlanCompiler.compile，返回 contracts/rework/proposal.ts 的 ReworkProposalV1；Dispatch ReworkDriveEngine 调用 acceptReworkProposal。
4. **Control 受理**：control-engine/autonomous-rework.ts 经原 recordPlanChangeProposal → recordUserDecision → applyPlanChange，保留原权限、精确来源、义务与 Evidence 资格。新 PlanRevision 承载返工，旧 FAIL/报告/未处置义务保留。
5. **仍未实现**：工具 FAIL 材料正式进入协调调查、协调角色实际消费后形成语义调整结果、该结果转为正式提案并进入受理。当前确定性机械返工、执行反馈补料、后续重验入口的存在不代表这三段已经接通。调查刷新/人的决定回流、必要重审联合链、多失败/中途恢复专项仍是有效未完义务。

剩余维护债：其他未触及协议仍有平面入口和大型声明文件，StateLedger 内部大校验文件、部分 Module 大文件和历史注释仍需按真实消费者有界处理；本轮不延伸成全仓合同分类或存储/UI架构工程。当前清理完成后停止。
