# 限定范围独立复核

Ticket: SC-CLEANUP-REVIEW。复核者未实现源码、测试或现行文档；唯一写入本报告。依据用户当前委托、两根 AGENTS.md、当前 Module 说明以及 baseline.json/history 中的本轮前正文，不以 HEAD 代表工作树。产品 HEAD 65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d，文档基线 HEAD 2f9a5df01175fb5686bb8bf02abc65216055a570。

## 结论与发现

已检查的行为改动未发现阻断回归。发现以下当前性整理遗漏，已逐项发给主 Agent，交付前需复查处理：

1. rework-plan-compiler.ts 顶部保留了已搬移摘要常数/分组类型的孤立注释，class 注释仍称“本票”。
2. ledger-validation 迁移后的注释旧路径仍出现在 context-continuity.ts、work-record.ts、两个 ledger adapter 及 work-identity-uniqueness.test.ts。实际 import 已正确迁移。
3. app/service.ts 角色规格/角色 code 材料注释留下 RW-11/、RW-17／残片；两 harness 的 QueryContext override 注释仍称 default stub，实际默认 QueryContextCompilerImpl。Snapshot 默认 unsupported 路径仍有效，不能随之删去。
4. 权威 Verification Module 说明保留“独立审阅本身未在本票实现”及重验/再次审阅未完成的旧范围说法，需要与已有当前版本自动重验消费者区分，不能将仍缺的语义 FAIL 协调消费混同已有重验通道。

## 独立证据

- 对本轮前 rework-plan-compiler.ts 的全部 26 个具名函数/方法，与当前 compiler + rework-proposal.ts 做 TypeScript AST 定位、去注释词法 body 对照：26/26 identical tokens。覆盖 compile、groupRework、validateRequest、checkScope、checkCurrent、buildTaskSetDelta、角色指派、来源/失败事实、UTF-8 截断、buildProposal、影响和摘要。提案身份、顺序、generatedAt、全部义务继承未发生执行体变化。Control 的 deriveTaskSet/deriveTaskAssignments/deriveObligationSet/deriveExpectedTaskGraph 仍是规则权威，编译器无 I/O 或正式状态提交。
- 逐项对照两 harness 清理前 QueryJobDriveEngineImpl 构造与 composeQueryDrive：grantMaterialAccess 仅 committed 后 await advanceProjection，另外三 Control 方法转发不变。内存 driveQuery 每次创建实例；SQLite buildHarness 创建一个实例并复用，生命周期差异保留。
- 使用 rg --files 限定源码，AST 遍历 imports/exports/import type，排除 UI 测试后检查 373 个生产源码文件：迁移表旧路径生产引用 0，生产导入 tests 路径 0。删除 QueryJobContextStub 及三个 barrel 的符号/路径在 src/tests/scripts 搜索无消费者。仓库 private:true，package 没有 exports 发布面；这支持仓内整理，但不等于承诺未知外部 deep-import 消费者兼容。
- ledger-validation 两个真实 adapter 的 imports 均指向 StateLedger 内唯一实现；VerificationServiceDeps/RecordedVerificationDeps/VerificationControlPort 的使用落在 Verification 内及显式测试；跨模块服务与持久日志记录契约仍在 contracts/verification-service.ts，requiredOutputs 缺口不阻断归约说明保留。
- PlanningTaskWorkMaterial 合并至 planning.ts 的 resolved/absent/unavailable 三分支和字段保持；Rework 源问题协议没有新增版本或重写身份规则。
- 逐文件正文对照额外获得 243 个文件移除 imports/comments 后词法主体相同；该统计仅用于筛选，不当作行为回归测试。inline import 类型路径、模板字符串与职责提取导致的差异另行阅读。

## 兼容性与局限

未见 HTTP 路由、持久字段、schemaVersion、命令/事件标识、失败来源或 Reviewer 资格改变；这是代码对照结论。实际重启、HTTP/浏览器、完整构建/旧产物扫描和全仓回归由主 Agent 执行并保存独立日志，复核者未并发重跑，也不将尚未完成的验证报 PASS。支持文件余下 8 个有生产消费者，拟从 contracts 移到 src/fixtures 与 src/testing；只要内容/默认值/原 Fixtures、TestDoubles 非Module分类和消费者白名单不变，未见职责风险，迁移后需要重新扫描。

失败事实依然由 Verification 形成，组合根读取后传 Dispatch；机械返工编译与 Control 受理存在。协调角色实际读取 FAIL 并语义形成正式调整提案仍未实现，本次整理不证明该能力完成。

## 复核执行日志（失败保留）

- 首次读取误用 src/modules/plan-compiler/rework-plan-compiler.ts，PowerShell PathNotFound；纠正至 src/control/plan-compiler 后继续。未作写入。
- 首次 AST 命令 Windows Node v24.19.0 require('typescript') 失败：MODULE_NOT_FOUND，requireStack D:/1.project/Software/agent_platform/[stdin]。属于工具入口环境错误，未安装依赖。改用已验证 .local/linux-test-tools/node_modules/typescript/lib/typescript.js 成功得到 26/26。
- 一次宽扫描包含 src/ui 依赖，共 4041 文件，得到旧路径 0；随后限定 rg 文件与 import AST 重新检查，采用上述 373 文件结果。没有以 CSS selector 等普通字符串当 import 的宽扫描噪声作为发现。
- 首次 Module 文档路径漏了 control 子目录，rg IO error；纠正至 dev_docs/modules/control 后读取。
- git diff --no-index 的 exit 1 表示有差异，CRLF warning 是行尾提示，均不是产品测试失败。

复核时源码 SHA256：compiler F378511D9C521E1051C146062E19699C69DA041D3E49F47DE166B05F04DF80CB；proposal 118B7FD5812A54C28C9BC1CC5A5280E81A5A931E96DAED59EA285BC64ED2636C；query-composition FED713F4D0831171B605C5C5CB402AC17F429B7172D4C3C9215E85A804662529。后续纯注释修正会改变文件摘要，交付身份以主 Agent 最终清单为准。

## 追加定向复查：宿主支持材料迁移与证据隔离

原发现 1—4 已逐项关闭：编译器孤立注释和“本票”已清理；ledger-validation 旧引用无残留；app 残缺历史前缀和两个 QueryContext 默认说明已修正，Snapshot unsupported 仍保留；Verification Module 将工具轮次与 Reviewer 资格分开，明确已有单任务重验/Task 归约证据及必要重审联合链、连续失败和恢复仍待验收。

8 个宿主支持文件迁移到 src/fixtures（6）和 src/testing（2）后，逐文件 TypeScript AST 打印主体对照全部相同（排除 imports/comments，inline import type 路径规范化）。fixture 内容、默认值、fake 结果及序列格式未改。重新扫描 373 个生产源码：两份迁移表的旧 import 引用 0，生产导入 tests 0。module-map diff 仅改这两个目录前缀，仍归原 Fixtures/TestDoubles 非 Module 类别；无第 13 个 Module 或新职责。

semantic-collaboration-fixture 的差异仅将输出位置改为 SEMANTIC_EVIDENCE_DIR 或 .local/test-evidence/semantic-collaboration，JSON.stringify 对象和所有 assert 不变。浏览器用例仅加入 testInfo 并将两个 screenshot 路径改为 testInfo.outputPath，expect/流程不变。没有用修改断言掩盖测试失败；历史输出不再被固定路径覆盖。

追加发现：迁移后 6 处注释仍引用 contracts/fixtures 或 contracts/testing（verification.ts、commands/governance.ts、commands/context.ts、fake-runtime-adapter.ts 及两处测试说明），其中 verification.ts 仍称 real tools are later tickets。已发主 Agent，属于当前说明遗漏，无执行行为影响；修正后再关闭。

本次补充执行日志：一次 rg scripts/module-map* 在 Windows 将 glob 当字面路径报 os error 123，改为 rg scripts 后正常读取。git diff --no-index exit 1 仍仅代表正文差异，无行为测试执行。本复查不将主 Agent 通报的首轮 299/1951 PASS 当作最终迁移版已通过。

## 最终定向关闭

上述追加 6 处旧路径/未来工具说明已关闭：CheckPort 明确生产 CommandCheckProvider 和 src/testing 确定性替身；context/governance builder 说明恢复当前字段构造与摘要权威；fake adapter 及两测试的旧 contracts/fixtures 路径已移除。src、tests、scripts 搜索 contracts/fixtures、contracts/testing、contracts/ledger-validation 无命中。此次未执行新测试，也未扩大源码审查范围。

同一次搜索附带发现 src/testing/check-providers.double.ts:4 仍有 “real tools are later tickets” 的旧说明，已提醒主 Agent；它不是本轮行为阻断，不改变原 6 项已关闭的结论。最终独立结论：已复核改动没有已知行为阻断，保留报告所列行为验证与外部 deep-import 兼容范围局限，不声称语义 FAIL 协调消费已实现。
