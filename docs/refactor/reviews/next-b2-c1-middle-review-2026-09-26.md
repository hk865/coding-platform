# B2 / C1 / M1 中间审核（在途）

2026-09-26，主审 Astra。此页仅记录骨架、测试语义和接口冻结，不是产品验收。最新已验收基线仍为 B1/W1 726项。原工程保护基线8,827项在本批证据目录；施工仅next。

## C1 邮箱：中审通过，开放第二阶段

DSH lane `c1-session-mailbox-skeleton-20260926` 原始8文件scope无越界，原主工作区文件无覆盖。初交骨架提前实现317行工具adapter，主审恢复显式unsupported handler，保留固定名字/schema/effect声明；正式算法留实现阶段。

原测试将少数claim记录复制到第二账本，同时Session目录仍指向第一账本，缺lease/Goal/Workspace等事实。主审改为原TaskClaim fixture可选注入schema（默认行为不变），两个测试复用同一C1 helper。真实running+V2 entered仅为邮箱领域规则种子，不能作为B2生产链证据。

修正工具写回执解包；补正式lease后继、Session释放的局部事务守卫（当时另有 raw Role 矩阵注入测试，已按本页末用户纠正删除），原send/ack/respond终态后重放，新动作拒绝；双响应提交屏障、keyset跨页/主体/过滤绑定与精确lookup计数；正文已存但metadata提交失败不可见、早晚取消、SQLite正文+账本关闭重开与损坏。B2 V2进入绑定/代次也纳入新动作门槛。

主审专项：61项，51项红/10项绿；红为显式unsupported或工具骨架execution_failed，未出现坏导入/夹具异常。类型检查通过后冻结测试与契约哈希。第二阶段只开放 mailbox-service.ts、message-record-codecs.ts、communication-tools.ts。实现者不能改测试、扩大Host授权、将旧V1当已进入或把消息当Task完成/强wait。主审后续组合根负责真实入口与关闭排空。

## B2状态：中审通过，第二阶段在途

首轮DSH错误写scope外 execution-history.ts并在只读父目录创建probe，未持久任何文件；其“全环境不可写”判断不成立。主审验证批准文件可原地写后恢复同Session，15个批准文件已交付，无越界。没有修改全局DSH配置或扩大文件权限。

主审核定共享TaskClaim移位/re-export、Prepared类型、V2授权/持久lease释放与outbox状态类型，可供其它骨架编译；这不发布生产行为。原测试发现默认absent Role缺Host模板、伪permit跳过authorize/begin/entered、过期Run pin、恒真Host回显、无新schema注册以及仅顺序调用假称竞争等问题。已改用独立固定Host grant、正式回执和binding revision、真实Memory提交屏障/SQLite并发消费与重开、同代释放/旧owner迟到保护、未知证据不重启。最终18项在完整正式初始化后红于unsupported，类型通过，4测试文件及6契约文件哈希已冻结；实现仅12个scope文件，第二阶段已启动。

ModelCallServiceDependencies已收敛为复用Entry的真实Role/配置/材料依赖，防止每次模型准入只能读Run而无法重核。WG12纯compiler加入正式Session供mapping校验。提前实现的codec validator恢复显式unsupported，事件与permit注册对象声明为空，待阶段二实现。

## Kernel最小公开导出：中审通过，开放第二阶段

原public-api受管源精确提取自冻结map，源摘要 `6fa6a3a57a9716054a97e3616d1d05a5876977d963acddffdc9ee0a196c470a6`。构建脚本只增加第二个显式受管源并按深度校验map；初始两个源的8项产物逐字再现。

DSH只追加同名unsupported stub与10项公开入口测试。主审检查原99个runtime导出保留，修正拒绝测试label避免原因片段被label自身满足。发布stage1生成物后9项因unsupported/非StoreError红、1项旧公共面绿。第二阶段已仅把stub改成既有assertTranscriptExchangeIntegrity纯re-export，冻结测试不变，主审生成dist；公开入口及既有Kernel/历史范围3文件49项通过，SQLite4产物不变。整体批次物理隔离验收仍待其它实现集成；不复制算法。

配对完整不等于副作用已知：outcome_unknown可合法配对，但Runtime仍必须拒绝据此释放。Runtime消费者、增量完整Turn、跨主体内部cursor、模型预算和所有实际工具权限仍须单独验收。

## C1 独立实现审阅与返修

首次实现scope无越界。其59/61自检的2个失败确为生命周期fixture漏事件schema，主审补注册；另独立补3个真实反例：新动作未拒released Lease、正文已存但发布失败后Workspace版本推进无法重试、readInbox跨await读取可变page.cursor导致caller检查绕过。主审复现61pass/3fail，冻结补测并刷新同lane只读snapshot，正在DSH返修。证据 `c1-independent-counterexamples.log`；没有把历史读取/原回执机械收紧为当前entered。

## M1：中审通过，第二阶段在途

原测试错误schema/Goal pin、raw seed冒充生产、provider sourceIdentity与资源次数假设已修。领域链现真实claim→MaterialPort.store→W1输入采用→consumer claim；独立provider核同次重授权、字节/增删、截断/权限/取消释放。27条均为新接口占位的目标红点，类型通过。missing reader=not_found，Query owner本批forbidden。6文件骨架合入、冻结契约与2测试文件，DSH只写3实现文件。组合根writer与reader共用source provider待集成，不把grant当证据重验证。

## Runtime：中审进行，未开放实现

初交15文件scope无越界，但发现多数测试在unsupported之前掩盖后续无效夹具：缺schema、虚构Skill目录、Host恒真、重开仍用旧runtime、真实组合根缺Goal/claim、终态outbox预期错误。正在修3测试文件。主审同时修最小接口：正文put能力、复用BoundModel、Host精确legacy template、唯一WorkspaceHost root/authorization、正式Run预算不由Host重写、driver/model-call固定身份与真实依赖、Session owner bounded position-window。提前实现run-limits预算映射已退回显式unsupported；原无TaskBudget行为保持。整体TaskInput生产链、连续运行、Workflow、Host/UI以及后续范围均未关闭。


## 后续整合与用户补充（2026-09-26）

B2 返修独立集合 13 文件/172 项、M1 grant/source + reader 3 文件/41 项通过；scope audit 无越界/主树冲突，分别导入 9/3 个变更文件。C1 前述独审返修 148 项后已导入。主树 B2/C1/M1 组合受影响集合 8 文件/130 项通过，类型检查通过；证据为 `evidence/next-b2-2026-09-26/*independent-repair-check.log`、`integrated-b2-c1-m1-check.log`、`integrated-b2-m1-types.log` 及逐文件导入 hash JSON。B2 当前外部选中材料在未接 M2 事实 guard 时仍明确 unsupported，不冒充材料已消费。

Runtime 的只读依赖已刷新已审核 B2/M1 实现，留存 hash。M2 中审纠正同实例并发/取消和撤权污染，7 条均在真实材料前置通过后因 unsupported 红；W2 工具中审 18 条中 7 通过、11 预期红，包含真实 Kernel 工具轮次。两者已导入骨架并开始窄 scope 实现，测试只读。没有将测试种子或记录型端口当作正式生产链。

最新用户要求已写入既有产品/意图/数据操作/模块/质量规范与实施计划。只读源码审计确认基础意图节点的正式采用受完整分配/验收校验阻挡，且首次补 assignment 受 W1 拒绝；W2 必须补这两个路径及缺项解释，不能只修改文案。规划充分性不硬拒，既有正式承诺、权限、局部 CAS 与实际副作用边界继续保留。整批物理隔离与真实组合根验收仍待完成。

## M2/W2 组件及 Runtime 独立反例

M2 事实 collector 经独审，2文件18项及类型检查通过，已导入组件；M1 已在主工程有真实实现，DSH交付报告仍称其骨架的句子不作为当前状态。W2工具及三职责资源经独审修正文案与结果未知提示后，6文件90项（含C1/W1邻接）通过，已导入4个实际变更文件；6份资源进入runtime-assets清单。两组件尚待正式Runtime/组合根生产消费，不能以recording Plan端口/静态Skill词句证明自动规划。

Runtime首次独审在21项中复现builtin read拒绝路径红：Kernel宿主before_tool adapter不接受runner已支持的block。追加Astra独立反例并修正测试Host的交集投影后，26项中22通过、4失败，准确为builtin read、Host grant合法收窄、后来撤权后的start只观察、同实例terminal提交失败后重试。长Session超过200条和探索工具路径过滤在最终实现中已通过，早期暂态发现撤回。输入快照问题另按既有冻结要求修订，未宣称已实测。

已再次派Runtime返修；scope明确增加受管control-hooks原源码及4生成物。源码自冻结map提取，初始hash d3151d0e313d59cf5ae88c75a0c9b173c72428cd5a7e5c7b093fb370eb02846a；三个受管源/12生成物基线逐字再现。仅拟开放before_tool原生block，before_model及其它未支持决策不变；这是实际消费者接缝修复，不重写Kernel引擎。旧工程8,827受保护文件再次核对零变化（protected-check-after-component-imports.json）。

W2 Agent委托领域与B2外部材料接线目前仅进入DSH骨架/测试阶段；未来意图节点设计已落任务书，等待W2领域共享文件写权释放后串行施工。C2真实通信/白板模型工具接线正在定最小依赖，未实装。

## Runtime 独审返修合入

四项实测反例修复后，主审独立检查10文件96项通过；末项缓存清理后再查26项全部通过，类型检查通过，12份Kernel生成物逐字再生。原9个Runtime文件与受管control-hooks源/4生成物共14文件逐hash合入。已结束Run从临时归约及待提交缓存移除，未成功提交的终态保留原稳定event/请求用于重试；不留一份无限增长的历史副本。证据为runtime-independent-repair-check.log、runtime-final-independent-check.log、runtime-reviewed-implementation-import.json、kernel-control-hook-final-repro.json。

平台组合根接线已进入唯一create-platform.ts的DSH实现，5条真实组合目标测试冻结；该链未通过前，不把Runtime组件宣布为平台可用。外部材料与Agent白板领域仍在各自骨架中审阶段，C2工具消费继续单列。

## M1 重复读取精简

按用户校验纠偏核对实际调用后，grant-service 的同一次申请按完整 owner ref 去重首次权限读取；捕获后每个唯一 owner 的重新核验/CAS、逐项 body/digest 校验均保留。去掉两个已经分别限定为 revision 1 后的重复比较。静态直接 authority 调用由 6+N+U 降为 6+2U（N 为材料数，U 为唯一 owner 数），不当作端到端性能倍数。仅一生产文件，独立 M1/source/reader 41 项通过并按 hash 合入；组合根和 B2 材料骨架 lane 的只读依赖同步刷新。证据：m1-simplification-independent-check.log、m1-simplification-reviewed-import.json 及两份依赖刷新记录。

## W2 委托与 B2 材料骨架中审冻结

W2 修正 fixture 缺 Host 白板 grant、错误晚取消与CAS时机、原receipt完整pins后，25项7绿18红；红点均新身份入口unsupported，两个正式B2 entered前置成立。四生产仅契约/结构codec/unsupported，6文件核hash合入后以4生产文件派实现。真实Agent工具轮次仍由C2接线验收；当前Role覆盖为真实absent+精确legacy template，不夸成已安装RoleSpec全矩阵。

B2 materials 修正consumer Kernel身份、旧Plan兼容测试与撤权错误预期后，原B2 25项通过；新13项1绿12红，绿项证明缺facts明确失败及无外部材料真实进入，红点均authorize的材料unsupported。夹具先通过真实M1/W1/consumer Run reader/M2预检，后段四提交窗口/重放仍未运行。5文件合入后以3生产文件派实现；冻结测试只读。证据见w2-agent-reviewed-skeleton-import.json与b2-material-reviewed-skeleton-import.json。

## B2 外部材料事实独审合入

唯一实际生产变更 execution-entry-service.ts 经主审与独立审阅，8文件86项、types、architecture script通过，按hash合入。四fresh屏障读取真实Plan成员与Run材料身份、M2 current事实及局部guards；原回执、entered及终态没有新材料门槛。同barrier fullref缓存以源码核实，专项没有单独selected/additional相同ref案例，未扩大测试覆盖声明。组合根尚未注入materialFacts，当前只完成领域消费者。

DSH额外全量的3个架构测试红已查明为测试副本漏拷新W2 resources六文件；主审仅将resources加入原copy清单，11项原边界测试独立通过。不是生产边界违规，也没有删除断言。证据：b2-material-independent-{check,types,architecture}.log、b2-material-reviewed-implementation-import.json、architecture-resource-fixture-{fix.json,check.log}。

## 用户纠正：删除不存在的运行中角色切换反例

本批曾向组合根测试追加直接篡改 Session Role pin 的反例。当前产品无该合法操作，按用户要求删除主工程及隔离副本中的唯一新增用例和专用注入/spy代码，保留原有两个真实运行/关闭测试；未添加过对应生产修复，撤销该阻断项。后续设计与审阅执行质量规范 §2.1 的可达性要求。[清理核对](evidence/next-b2-2026-09-26/role-lifecycle-cleanup.json)仅记录文件哈希与裁决，不保存被删除测试源码。

相邻清理还删除 C1 直接写入 policy matrix 的参数化反例及专用 imports、来源迁移测试中运行后替换 Run.roleBinding 的单一数组项；在途 W2/组合根副本同步。共享 RoleFacts/guards、初始绑定和防调用者伪造检查未为这些测试新增，继续保留。历史测试数量只描述当时快照，不作为当前用例清单。

## 组合根合入

B2 真实 Runtime、C1 公共邮箱和 M1 材料授权使用同一正式存储链；独立组合检查 5 项、全部组合回归 8 文件/13 项与类型检查通过。撤销错误角色注入门槛后按原哈希合入 create-platform.ts；删除该测试后 main 的原 5 项再次通过。[逐文件合入](evidence/next-b2-2026-09-26/composition-reviewed-implementation-import.json)。M2 materialFacts、W2 delegatedWrites 与 Runtime 平台工具装配仍由 C2 接通，不能据此声明完整产品路径完成。

角色清理后实际邻接回归：通信与来源读取 5 文件 / 113 项通过，见[日志](evidence/next-b2-2026-09-26/role-cleanup-regression.log)。没有为删除项另增备用测试。

## W2 领域返修中审：真实输入与正式生命周期

独审原84项通过后发现 Agent 提案的源 Plan/版本/pin 范围和原取消信号缺口，以及 Host/Agent future-adoption 编排重复。删除本批7项内部改写状态反例与41行专用fixture，以正式 recordRunResult 拒绝/竞争替代；不增加损坏历史来源比对。修正v1夹具去除v2专有字段后，冻结26项为19绿7红，全部7红实际错误提交，类型通过。[中审与哈希](evidence/next-b2-2026-09-26/w2-reachable-tests-refresh.json)。原4生产文件scope和DSH Session不变，按精简返修任务继续。

## 当前子集物理隔离验收通过

W2返修独立12文件/85项、类型、边界与只读审阅通过后合入2文件。整批物理副本验证 **94文件/948项**，typecheck/build/边界/12项Kernel产物再现与编译入口全部通过；旧工程8827文件零变化。当前next/src为191个TypeScript文件、40,804物理行；B1基线为165文件/30,464行，增加为本批新增能力，不宣称全仓精简。角色错误反例及专用辅助代码已删除，清理未撤销真实权限/所有权边界。

[完整日志](evidence/next-b2-2026-09-26/b2-c1-w2-isolated.log)、[结果与边界](evidence/next-b2-2026-09-26/b2-c1-w2-isolated-result.json)、[旧工程核对](evidence/next-b2-2026-09-26/protected-check-b2-w2-integration.json)、[W2合入](evidence/next-b2-2026-09-26/w2-reviewed-implementation-import.json)。下一步并行派发未来意图与C2真实Runtime工具消费者骨架；R3e/R4及bootstrap/Workflow/Host/UI继续按已授权范围推进。


## 未来意图 / C2 第一轮中审：退回测试返修

两lane范围审计无越界/主树冲突。独立types通过；W2专项4绿4红，C2专项5绿8红。W2含相互矛盾的unsupported/committed断言、未分配执行任务的错误正例、删除原义务及raw accepted Plan seed，并提前实现eligibility/pinned-policy reader；已要求退回骨架并经真实writer测试逐步细化。C2骨架接口可保留，但真实通信只读inbox、白板未entered、Skill资源仿造/source authorization未实际拒绝，不能证明目标接线；修订要求见两任务书中审节。类型通过不作为冻结或实现许可；返修完成后再次独审。


## 未来意图 / C2 中审冻结并派实现

W2坏seed/互斥断言已删除；提前资格/policy实现退回骨架。主审补真实分配后仍plan_only的claim、新gate/badkind/源policy guard、可达CAS；旧R3c纯fixture补assignment但断言不变。独立目标2绿8红，types通过，10变更文件核hash导入；第二阶段仅5生产文件。未来apply去掉原active政策读取，只有新增义务读源Plan pin，propose原诊断保留。

C2测试改真实Session创建/部署3Skills及coding-safety、拒绝source授权计数、真实通信/白板模型轮次、材料终态后撤权观察；修复typed graph解包和immutable row revision混淆，C1 Host绑定固定grant。未知工具异常改为结果未确认，不宣称副作用未发生。独立5绿8红，types及邻接10文件157项通过；11变更文件核hash导入，第二阶段仅driver/mailbox/composition三文件。未到达红点后的断言仍待真实实现验证。证据：w2-future-intent-reviewed-skeleton-import.json、c2-reviewed-skeleton-import.json及middle-final/check日志。

后续设计已审R5a四bootstrap writer（无目录预注册循环）、R4.1持久控制fence（明确issue/consume与事实恢复缺口）；R3d仅已授权目录修订，不引入统一decision/gate门槛。它们尚未实现，组合根共享写权在C2后串行交接。

## C2 实现独审：真实同请求竞争返修

实现仅三生产文件，scope无越界/无主树冲突；独立13文件170项与types通过。driver与组合根真实工具过滤、固定身份、M2事实/唯一Plan委托装配成立。mailbox ack/respond 的A/B同请求首lookup均miss后，A提交、B读到read/responded时直接invalid，未恢复已提交原receipt；已要求仅该两拒绝分支复用recheckAfterMiss，并由主审补真实窗口测试。实现未合入，完整隔离仍待两批完成。

再次清理旧R2d Query任务书中的运行期角色改变要求，明确初始完整身份/外部调用者检查及真实Host grant撤权；未发现残余热换Role专用生产补丁或测试。

## W2未来意图 / C2最终合入与隔离

独审C2真实同请求窗口以7文件82项复验通过；W2修正显式optional/deferred数量门槛，以8文件28项复验通过。主审新增测试只通过公开writer/真实Store wrapper触发正常状态，不引入Role热换或持久篡改。分别5/3生产文件按before/after哈希导入，测试只读。

完整物理副本 **99文件/975项通过**，typecheck/build/6条实际依赖（8条允许）/12项Kernel再生/编译入口均通过；旧工程**8,827文件零变化**。next/src **191文件/41,502物理行**，较前序191/40,804增加698行，属于新增能力与接线，不宣称全工程缩减或未测性能收益。

真实交付：纯意图正式采用、optional/deferred、首次分配与明确激活、只读缺项解释及局部CAS；同Kernel通信与白板多轮工具、可信Skill/系统指令、平台工具独立文件权限；M2材料输入事实/Plan委托/通信准入同组合注入。通用materialTools工厂尚未进入driver，不把正式输入读取等同任意材料模型工具。R3e完成、R4控制恢复/Query、Workflow/Host/UI仍未交付。

证据：[完整日志](evidence/next-b2-2026-09-26/w2-future-c2-isolated.log)、[结果](evidence/next-b2-2026-09-26/w2-future-c2-isolated-result.json)、[旧工程核对](evidence/next-b2-2026-09-26/protected-check-w2-future-c2.json)、[W2导入](evidence/next-b2-2026-09-26/w2-future-intent-implementation-20260926-import.json)、[C2导入](evidence/next-b2-2026-09-26/c2-runtime-platform-tools-implementation-20260926-import.json)。后续按已审R5a正式初始化开始下一轮骨架。
