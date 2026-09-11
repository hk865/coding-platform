# 本轮语义协作实现与验证

结论：已走通一条真实工具纵向路径，**未满足用户定义的整项完整语义协作完成条件**。保留明确检查点继续开发，不把下述流程证据解释为完整自治或真实模型质量。

## 同一任务的实际链路

任务是按 RULES.md 实现一个Python标签规范化函数：去除两端空白、ASCII字母小写、保留内部空格、空串不变。初始代码直接返回原值，真实行为断言首次失败。协调规划读取源码，经Control受理；执行Run读取源码并提交公开结构化缺料反馈；只读协调Query实际读取RULES.md，形成带来源补料。首次工具FAIL触发已有正式返工提案、策略受理及新PlanRevision；同工作后继Run的Context带入补料及来源manifest，真实read取得源码版本后以CAS edit修改函数；自动工具重验PASS，经Evidence接纳及Control归约返工Task为satisfied。原FAIL、报告和旧计划保留。

实际顺序是“先取得补料，初次FAIL后由返工Run消费”，并非额外插入一个补料执行Run后才开始首次检查。动态验证足以覆盖该样例，未人为制造Reviewer或人工审批；该任务不自然需要人的产品决定。当前轮次completed、聚合Evidence全部admitted后才保存最终截面；Control的Goal归约为RUNNING并绑定返工计划，目标门禁仍有未满足事项，不把Task满足报告成Goal完成。

- HTTP/SQLite/内核/工具：[semantic-test-8.log](semantic-test-8.log)；同样任务的浏览器测试通过记录在[browser-1.log](browser-1.log)。
- `semantic-task-*.json`保存各成功执行的公开状态、第一次失败轮次、最终任务/运行/Context/来源/验证回执、实际修改后的函数和模型调用数。临时源目录在测试结束清理；持久恢复在清理前于同一SQLite目录重新打开服务验证。
- 浏览器测试使用构建后的真实服务和同一任务夹具，未拦截或伪造状态/报告响应，检查反馈、协调调查、RULES来源、已接纳PASS及原始AssertionError报告。截图：[调查与来源](semantic-conversation.png)、[原始失败](semantic-original-fail.png)。
- 外部模型为明确标识的本地协议替身，9次模型请求；真实SQLite、coding-agent、读取与版本校验编辑、Python行为检查。没有付费真实模型质量证据。

## 责任、接口与恢复

| Module | 本轮实际责任与消费者 |
| --- | --- |
| HumanCollaboration | 既有目标/实际工作/验证HTTP入口，工作台展示Query反馈和来源、正式验证及历史报告 |
| PlanCompiler | ExecutionFeedbackCompiler将已结束Run的公开结构化反馈交由正式只读Query协调调查；不写正式状态 |
| ControlEngine | Query提交的scope/当前Plan/Workspace/结束Run守卫；精确授权；继承返工计划reviewAdmissionProtocol；继续唯一Evidence/Task/Goal权威 |
| DispatchEngine | QueryDrive在Context读取前申请精确原报告授权；WorkMaterialDrive为同工作后继补料申请精确回答授权；既有outbox派发与返工 |
| VerificationEngine | reverifyRework解析正式返工起源，继承实际适用的冻结工具配置；prepareReworkReview按当前义务准备必要审阅；继续使用现有round/review journal和Control接纳/归约 |
| WorkerRuntime | 保持真实内核；普通角色Context增长暴露内核把完整输入用作16KiB空记忆查询的错误，现只限制辅助query，模型保留完整输入；从公开成功read事件提取路径/版本见证，完整空文件见证不等同空片段或未找到 |
| ContextCompiler | 读取canonical反馈来源、保存精确报告、编译Query材料；为普通Run保存绑定Task Context与Run的版本化公开反馈协议并投递，验证回答、真实读取见证及来源、组装同工作后继材料并记manifest；Verification返工来源仍由本模块读取 |
| WorkspaceReader | 复用既有受限读取、源码摘要及sourcePin端口，无新增底层源码扫描权 |
| StateLedger / ArtifactVault | 复用正式QueryJob、工作绑定、授权、Evidence、不可变正文和持久身份，不新增平行状态系统 |
| ReadModelIndex | 复用既有Query/Run/Context/轮次/治理投影；Query授权committed后由harness推进投影再读取，避免新授权候选不可见 |
| ArchitectureReconciler | 未扩展；保持12 Module及允许依赖图 |

组合根在普通Run终态及服务启动扫描中调用同一后续入口；prepared/running/outcome_unknown不盲目重跑。反馈请求按原Run确定身份；返工轮次按正式提案和scope确定身份，重试恢复原journal。组合根取得Verification问题材料再传Dispatch，没有新增Dispatch→Verification回调。正常服务重开不增加模型调用；不由此推断各中途checkpoint均已实测。

## 反例及真实失败

新增独立补料拒绝专项：伪造proven_empty而无成功读取见证、needs_decision冒充已决定、来源已改变三项PASS，见[独立报告](independent-review.md)及[日志](sc-verify-independent-final.log)。这是公开依赖seam的反例，不是三次端到端模型执行。Verification新增8项正式重验/必要审阅专项，见[日志](sc-verify-review-prepare-tests.log)。

已有反例通过全仓及浏览器套件复验时仍各有原覆盖边界：缺少角色材料/权限拒绝、旧PASS不解除当前义务、不独立Reviewer拒绝、再次失败与多失败返工、重复/丢回执、未知副作用保留。它们不能替代新增反馈链与决定、中途恢复、多工作并发的联合验收。

所有失败保留：semantic-test-1/2为新Query精确授权及投影时序遗漏；3为组合根错误传完整RunSpec代替精确scope；4/5为替身协议使用不存在write及遗漏edit的expectedRevision；6为验证沙箱PATH无Node，改用已安装Python且仍做真实行为断言；7为测试读到PASS但Control归约尚未完成，改等正式satisfied；8通过。独立复核再发现ASCII范围与final过早截面，两处修正后final-targeted.log通过10项；browser-semantic-final.log通过1项。后续生产协议投递首轮contract-delivery-tests.log被Vault的missing_source守卫拒绝，已将协议来源绑定实际Task Context Artifact再复验。全仓首轮full-tests.log的2项失败分别为新文件清单和旧计划视图停止增长假设；清单已补，视图断言保留旧提案/决定/版本历史，并核对最新处置行来源。独立假调查反例先FAIL后修复。前端严格检查另发现共享浏览器夹具的type import把整个后端拉入noUnused检查；改为既有夹具同类窄ApplicationFactory后复验，不为此清理无关后端源码。以上没有把旧失败日志改为PASS。

## 统一验证记录

以下记录本轮实际命令；历史1939项不作为本轮新增功能PASS。最终全仓/相关浏览器均已完成，以下以真实退出码和日志为准。

| 检查 | 命令/日志 | 结果 |
| --- | --- | --- |
| 直接相关回归 | test-wsl.sh加相关路径；related-regression-1.log、contract-delivery-tests-2.log | 首轮5文件26项PASS；最终协议投递/纵向/计划视图/拒绝/工作材料4文件28项PASS |
| 新纵向任务 | final-targeted.log、contract-delivery-tests-2.log | ASCII边界、完整轮次/归约和生产协议投递后的纵向PASS |
| 后端及测试类型 | node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit；backend-typecheck-delivery.log | exit0 |
| 前端严格类型 | node src/ui/node_modules/typescript/bin/tsc --noEmit -p src/ui/tsconfig.json；ui-backend-typecheck-delivery.log | exit0 |
| 模块边界 | node scripts/check-module-boundaries.mjs；boundaries-final.json | 414解析文件+1仅归属文件，issues=[] |
| 构建与浏览器 | 既有WSL PATH .local/def17-bin，CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome，CODING_AGENT_BWRAP_PATH=产品根/.local/toolchains/bwrap/usr/bin/bwrap；node src/ui/node_modules/@playwright/test/cli.js test --config src/ui/tests/playwright.config.ts | browser-1.log 26项PASS；ASCII/完整归约修正后browser-semantic-final.log 1项PASS；最终协议投递版本browser-final.log 26项PASS；容量修复后browser-capacity-accepted.log 7项PASS（最新内核+完整构建）；其余布局等覆盖沿用同轮browser-final.log，UI生产代码未再改变 |
| 全仓行为 | bash scripts/test-wsl.sh | full-tests.log 1949 PASS/2 FAIL（清单、计划视图预期）；第二轮full-tests-final.log 1949 PASS/2 FAIL（新重验视图预期、真实Context触发内核memory query容量），专项closure-regression.log 3项已修复通过；最终full-tests-accepted.log exit0，299文件/1951项PASS |
| 文档 | 权威根node dev_docs/verification/validate-docs.mjs；docs-delivery.log | 13/13 PASS |
| 构建路径 | node evidence/2026-09-11-semantic-loop/check-artifacts.mjs；build-artifacts.json | 345非UI JS，0旧路径孤儿 |
| 源码身份 | snapshot.mjs、final.json、changes.json、closure.json | 已封存，复扫见closure.json |

## 独立复核与未完成检查点

Verification子Agent独立复核主Agent的反馈/Query/补料/UI通路，并加入独立反例，发现并促成真实读取见证资格修复；未把其自身Verification实现当作独立审查。主Agent复读其冻结配置继承、正式来源校验、journal重入和Reviewer准备代码，集成发现精确scope和reviewAdmissionProtocol保留问题并修复。结论有范围限制，见唯一[独立报告](independent-review.md)。

仍有效且本轮未完成：

1. 调查过期、关闭或材料暂缺后，没有正式替代调查和自动恢复后继链；当前保守拒绝，旧调查可能阻塞后续同工作任务。
2. needs_decision能拒绝继续，但具体人的选项受理、版本化决定及全部受影响Run消费未接完整链。下一段优先复用已有决定和工作绑定机制完成此处及调查刷新。
3. 缺料反馈被协调实际消费；工具FAIL仍由已有正式机械返工消费，尚未证明协调模型实际解读FAIL后语义改计划。
4. 必要Reviewer准备已有专项和生产接线；样例为dynamic-only，不能拿其他Reviewer测试替代同一返工任务的必要重审联合证据。
5. 新反馈链的规划/补料/Reviewer/归约中途重启、多失败连续换版、并发触发、丢回执专项尚不完整；正常重开不等于中途恢复全覆盖。
6. 组合根部分后续异常仅日志记录，未统一持久投影为UI等待原因；已有Query关闭原因可见。

全仓第二轮full-tests-final.log仍为1949 PASS/2 FAIL：返工视图又一处旧静态预期已更新为保留正式身份/旧问题，重启后允许新的重验回执；角色运行失败经role-material-diagnostic.log确认为内核memory query上限，修复及完整模型输入断言见closure-regression.log。临时诊断源码已从原样副本恢复，未保留额外日志代码。

这些是尚需实施或验收的核心工作，不是要求用户批准的语义变更；本轮没有需要用户进一步决定的产品语义、架构依赖或技术选型。

## 源码身份与保护

[baseline.json](baseline.json)固定两个HEAD、dirty逐文件摘要；产品HEAD 65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d，文档HEAD 2f9a5df01175fb5686bb8bf02abc65216055a570。结束时final.json与changes.json记录最终摘要及本轮相对baseline变化（临时诊断已恢复，无诊断代码遗留），不能以HEAD代替工作树。原git status/processes保存在本目录，开始时Windows进程命令权限受限，未确认其他活动写入者；最终复扫核对封存期间有无变化，不声称取得全局写锁。

未reset/clean/stash/覆盖checkout、未提交推送、未重装依赖，旧证据/失败/计划原样保留。构建产物与依赖不计入源码摘要；旧构建路径另行检查。当前交接旧文保存在previous-handoff.md.txt；已修改状态的中间快照保存在intermediate-module-status.md.txt，不冒称本轮原始全文。






最终源码身份：产品204c3b69d793a894c1636ade15f32e2c774134d96d3334ffda61fa119ea123da（1402文件），文档d1071bd6aca6e65ef7558ef7d2b1e21fc65ff7fd84048a2fa94e8e2d6d400d9b（487文件）。相对baseline为34个产品文件、5个文档文件变化，没有删除源码。两个HEAD保持不变。较早的final候选保存为candidate-before-capacity-fix.json。



closure.json复扫与final.json产品/文档摘要完全一致，封存期间未发现额外源码或规范修改；源码复读不等同多文件全局写锁。

