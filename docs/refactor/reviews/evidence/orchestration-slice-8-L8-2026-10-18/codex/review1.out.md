只读审查完成，未改文件、未运行测试或构建。以下按当前副本行号，文件名均可唯一定位。

裁定核对：采用、修订和两条 PASS 通路已统一通知，通知异常不改变原回执（create-platform.ts:914、:935、:1187）。裁定2、4的串行、合并、开始快照共用身份与失败守卫已接上（auto-capture-driver.ts:121、:137、:158、:188、:204）。裁定3的状态构造、事件、检查登记齐全，指针在版本守卫下取 max（state/architecture-capture.ts:40、:74；architecture-record-codecs.ts:743；state-writes.test.ts:112、:213；architecture-service.ts:1126、:1131）。裁定5关闭顺序、7前次指针符合（auto-capture-driver.ts:246；host.ts:1602；architecture-service.ts:1125）。裁定9、10的移动唯一性、依赖任一端相关、严格最长目录前缀符合；11的时间、措辞、“，不确定”和上限符合，排序有下述问题（architecture-reminders.ts:58、:70、:87、:106、:123、:148、:186）。裁定12两次观测各加载一次、比较复用最新图符合（architecture-service.ts:1323、:1331、:1336）。

1. **必须改：恢复已有工作区也重新抓取。** settings 启动恢复调用 openWorkspace（host-settings.ts:572），已有登记会跳过注册，却仍无条件触发（host.ts:904、:927）。已满足请求重启也重抓，pending 恢复还可能与 startup_retry 重叠。修改思路：只在本次非重放登记成功后触发；已有登记恢复只交启动重试。补“已满足不抓、pending 只重试一次”的 settings 重启用例。

2. **必须改：最终提醒顺序不符合裁定11。** 路径拼进键后，装配器再次按键排序（architecture-reminders.ts:171；context-assembler.ts:237）。同类路径 `src/a`、`src/a/inner` 会因分隔符把后者排前。修改思路：先按规定排序，再用固定宽度序号作键；经公开 prepare 验证最终文本。

3. **必须改：失败信息不完整。** 目录读取拒绝或抛错直接返回，已有请求只剩 pending，没有失败原因（auto-capture-driver.ts:176、:178，UNSPECIFIED8）。修改思路：非取消错误进入现有失败出口，继续用开始 revision 守卫。另外失败原因被擅自截至2000字符（state/architecture-capture.ts:87；architecture-record-codecs.ts:663）；删除截断及对应限制，或由 lead 明定截断规则。

4. **必须改：映射仍有两份。** 新 helper 与 UI 原 map 并存，违背裁定6；“不能导入”不能算完成共享（architecture-catalog.ts:81；ui/views/setup/requests.ts:205，UNSPECIFIED4）。修改思路：确定合法共享位置或精确的边界例外，让两方调用同一函数，删除副本。

5. **必须改：服务测试仍手写事实。** S8A-L8-observation-state.test.ts:84、:99 自建事件并直接提交 Project/Workspace；:163 直接写编造的失败；:145 写没有真实 PASS 的请求。因此包括 max 在内的场景不能按公开步骤验收。修改思路：公开创建、登记和真实触发；移走根目录产生失败；保留现有捕获门控，验证驱动实际使用开始快照。

6. **必须改：§3覆盖不完整。**
   - A-03四行主例有双后端公开准备（S8A-L8-reminders-public.test.ts:238）；12→10、unknown、无观测、空段只有纯函数测试（S8A-L8-reminders.test.ts:128、:137、:152、:159），须补双后端公开 prepare。
   - Host 失败例确实移走根目录，但都是首次捕获失败，未证明提醒保留上次成功图（S8A-L8-auto-capture-host.test.ts:257、:267）。应先成功，再失败，恢复根后、重试前 prepare 核对旧图和时间。
   - settings、运行中追加、手动路由各只有一个后端；启动/关闭重试仅 SQLite（同文件:199、:217、:344、:281、:313）。补另一后端；内存跨 Host 恢复若无产品能力，须由 lead 明确豁免。
   - 并发及关闭例靠900文件和 setImmediate 碰时序，关闭只等序号2，不能证明第二轮尚未开始（同文件:223、:229、:315、:332）。换可控门控；同时补跨工作区串行、等待中合并、未绑定请求不重试。
   - “loads once”没有计数且 previous 为空（S8A-L8-observation-state.test.ts:269、:278）。在真实准备依赖外计数，覆盖两份观测及多块图。

7. **必须改：PASS三行是没写，不只是没跑。** UNSPECIFIED1承认缺项（l8-impl-final.md:18）。分别补 Workflow 定案、公开 finalize、finalize 原样重放，双后端、真实 Run 和检查：
   - 首次 PASS 原回执保持非重放成功；序号恰加1、trigger=check_passed、最终 pending=false、current 换新、previous 等于旧 current。
   - 重放返回 replayed=true，序号/current/previous 均不变。
   
   旧 A2 仅断言 PASS，未装自动抓取驱动，不能替代（A2-verification-chain-platform.test.ts:191、:411）。

其余 UNSPECIFIED：2可接受按工作区省略内部元数据（architecture-observation.ts:40）。3**建议**开始时传上次引用，避免变更数全算 added；当前这些数没有公开读者，不单独阻断（auto-capture-driver.ts:188；architecture-service.ts:1028；slice-8-SPEC.md:567）。5**建议**读口附带 persisted ref，避免模块查询必须靠重放取引用（architecture-observation.ts:38；architecture/contracts.ts:80）。6、7可接受已有依赖透传和专用 system actor（host.ts:507；auto-capture-driver.ts:32）。9**建议由 lead 明定为不阻断 Run**：非取消读错显示“架构提醒不可用”并继续；目前会使整个准备失败，新增了执行门槛（context-assembler.ts:1037、:1039；execution-preparation.ts:270）。10**建议**失败事件使用实际失败时间，保留原 requestedAt（architecture-service.ts:857）。

净增1475行本身不构成拒收理由。必要状态、事件和读取层应保留；可删无用 signal、队列 trigger、running.key（auto-capture-driver.ts:44、:61、:84）。读取报告的10/7仅适用于每图一块，提醒链一般为 `8+最新块数+前次块数`／`6+最新块数`（architecture-service.ts:595、:607、:682）。WP2省略数2→3有手算且未放宽断言（WP2-wiring.test.ts:538）。未见业务输出自证期望；建议删除随机ID不等断言及重复旧归属测试（S8A-L8-auto-capture-host.test.ts:213；S8A-L8-reminders.test.ts:110）。

先改完列出的几处