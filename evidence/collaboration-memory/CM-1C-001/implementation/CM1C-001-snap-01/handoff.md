# CM-1C-001 独立验收交接

唯一实施者 /root 已停止源码写入；当前快照以 source-snapshot.json 为准，逐文件原始字节在 source-files/，相对已接受 CM1B-001-snap-01 的差异为 delivery-files.json。HEAD 相同不代表源码相同。全量和构建在 logs/，集中检查尚在运行时不能宣称完成。

## 逐项可复核证据

| 项 | 用例与边界 |
| --- | --- |
| C01 | tests/app/architecture-review-service.test.ts 通过正式 HTTP 创建Goal/模型规划/三份只读指派；普通首次派发自动建立 exact Agent/参与关系，C 的真实 report_architecture_conflict 工具形成 Finding/Brief/Proposal/Candidate/Review。两个先行工作已独立完成，变更方案待决。完整构建的浏览器展示 Record.id、Run/Plan/baseline、提案摘要、选项与影响。模型输出是标明的确定性协议替身，不证明自动发现真实项目问题。 |
| C02 | 同服务四种选择及 browser-service 截图；修改产生新提案并重新待决，旧选择拒绝，重试同回执。tests/control/architecture-review.test.ts 双账本核正文绑定/完整集/提交竞争/篡改/旧来源修改拒绝/不可降级影响集。source-selection 与 baseline-evolution 测试核旧 pin/Candidate/MigrationGate 路径；接受不激活基线。 |
| C03 | 服务测试不调用测试 drive，人的决定后自动投递、Wait/admission、current input/ModelRequest evidence，完整三 Work 其中两 resume、一 notify。scenario 测四 Work 与中断后恢复（决定落账后关闭重开；投递后、bind前/后抛错关闭重开）；失败 Work 明确 failed，不影响另一Work的唯一启动。首次分配变体同时三路drive核有效admission仍2；作用域/旧历史/角色篡改与时间篡改拒绝。这里的故障注入不等于操作系统强杀，通用执行强杀恢复另有A回归证据。 |
| C04 | 完整 dist Node server/workbench 四种浏览器点击与同一账本视图、模型请求、重启重放一致。维护B偏好不会改变Review事实或只读工具权限；B的解释机制和真实效果证据另列。real-model-02 的两个DeepSeek后继非空回应completed，原始请求/回应/事件保留。模型报告producer仍为协议替身，空隔离源目录不证明真实项目方案质量、视觉输入能力或自由协商能力。 |

## 收口与权威

新 ArchitectureReview 只承担精确待决/修改/固定影响集；最终结果复用 ArchitectureChangeDecision。决定与全部 intent 原子提交；逐 Work 投递/完成intent/真实Wait原子提交；完整且唯一的架构 Delivery 才能接续。Control 与 Ledger 最终事务均校来源、角色、完整集、正文、版本，保留基线迁移与激活守卫。只读读面按稳定事件边界区分投递、绑定、provider尝试和失败；provider尝试不是质量/任务完成。

首次分配是显式普通派发业务入口，不能从 grant 拒绝反向补身份，不能接管旧参与历史；review/query/admitted successor 不走此入口。真实 service 的决定/前驱结束/重启推进互相独立，并由持久租约/CAS/执行许可保证唯一有效启动。

## 必须保留的范围

1. 固定目标集只覆盖决定时已存在 Work，最多64；新 Work 不追溯加入，超界不截断。
2. 修改只改提案说明、保留结构化约束；既定resume模式不能降级。Workspace/Finding 来源过期必须重报，不能只改描述刷新。
3. 本票不包含跨任意真实项目的模型自主发现效果或图片输入验证；未触碰用户列出的测试项目源码。
4. Gate C 由另一 Agent 独立判断；root 的通过测试不代替 Gate。整批 M01–M05/I01–I04 尚未完成。

## 重跑

WSL Node24 PATH 按 continuation-01/frozen-checks.sh。定向 bash scripts/test-wsl.sh tests/control/architecture-review.test.ts tests/coordination/architecture-review-host.test.ts tests/app/architecture-review-service.test.ts --maxWorkers=4。

完整工作台浏览器需先 pnpm build，再 C1_SERVICE_BROWSER=1 和 CHROME_PATH 指向已安装Chromium，运行 service test。无需真Key。真实模型仅 C1_REAL_MODEL=1 的独立样例，使用本机设置，不在命令/产物泄漏密钥。全量通过与源码复算结果见 logs/results.txt / source-snapshot-after.json。
