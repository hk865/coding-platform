只读审查完成，未修改文件，未运行测试或构建。上一轮五项必须改的生产修补均已落实；本次未发现新增生产缺陷，但几条测试尚不足以证明第 3 组验收完成。以下短文件名均指当前副本。

| 项目 | 结论 | 证据 |
|---|---|---|
| A1／旧问题3 | 是 | `review-admission.ts:86` 统一检查两个 Host 工具及完整只读权限；准入 `:126`、capability 的 `runtime-configuration.ts:477` 共用它。 |
| A2／旧问题4 | 是 | `create-platform.ts:1609、1612` 两个保存失败分支均传 `captured.baselineKnown`；测试 `K3-R1-workspace-capture.test.ts:264、270` 覆盖抛错、拒绝及 false。 |
| A3／旧问题5 | 是 | `K3-10-review-round-cells.test.ts:217`、`K3-48-2-unknown-call-review-model-text-budget.test.ts:29` 均固定字面值 158,720。 |
| B1 | 是 | `review-admission.ts:122` 在工具集检查前拒绝 proposal。测试目前只到纯函数，见下方建议。 |
| B2／旧问题2 | 是 | `workflow.ts:1246` 只查一次绑定，`:1249` 缺失返回 `review_binding_missing`，`:1261、1274` 传入所选绑定；`:1533` 指定任务返回 waiting。测试 `K3-review-workflow-rows.test.ts:305、309` 验证 waiting、记录仍 pending_review。 |
| B3／旧问题1 | 是 | `unknown-call-review-tools.ts:173` 返回 status、别名、revision、提交 cursor、replayed；`:181` 保留拒绝信息。`K3-10-review-round-cells.test.ts:282、287、294` 验证回执小于4096字节、completed及后续定稿。字段叫 receipt 可以接受。 |

R2 覆盖不能笼统算八行完成。K3-19（一）本来就要求零模型调用，已有不开轮、零调用及定稿断言（`K3-19-review-unavailable.test.ts:93、104、113`）。K3-37 的取消、暂停重启、目标暂停后 unfinished 已走实际流程（`K3-37-stopped-review-round.test.ts:149、159、231、241、310`）。K3-42（一）（三）的模型写入和改判链成立（`K3-42-truncated-command.test.ts:192、209、236、259`）。其余不足如下。

1. **必须改：K3-11、K3-45（一）仍用预置状态代替关键流程。**  
   连续第二次、三原因组合仍是 owner 用例（`tests/work-graph/K3-11-review-reasons.test.ts:257、310`）；真正 R2 只补了每步确认（`K3-11-review-reasons-r2.test.ts:129、146`）。K3-45 第一轮直接转成 unfinished，尚未写第一轮结论；第二轮结论也直接调用状态机，之后一次落库（`K3-45-review-incomplete.test.ts:123、129、192`）。  
   最小反例：Workflow 无法领取第二轮，或第二轮工具写入失效，这些测试仍可通过，漏掉实际无法核对的问题。**修改思路：**复用现有 R2 夹具，两轮各由模型写完结论，在无调用在途时中断，再由 Workflow 定稿；在该链上组合 every_step、partial，固定断言三原因顺序。连续第二次沿真实原工作 Run 接续链构造。inventory_incomplete 应由真实创建／认定入口证明，无需强开核对轮。

2. **必须改：K3-35（一）的大规模夹具不合法，断言也漏了裁剪后的完整性。**  
   `K3-35-review-input-size.test.ts:160、161` 使用非法摘要哈希和超过512字符的命令摘要；正式 codec 会拒绝（`unknown-call-review-codecs.ts:307、312`），但 `:293` 的记录替身绕过校验。实际 R2 只有一条，止于 completed（`:409、445、448`）。容量断言仍跟随生产常量（`:325、326`）；32条只检查裁剪前（`:311`），裁剪后仅循环剩余条目（`:356`）。  
   最小反例：裁剪误删全部条目，循环变空、渲染自比仍可能通过，无法保证每条保留别名和工具名。**修改思路：**记录使用合法摘要，长命令从 Kernel 事实取得，200条路径从采集全文取得；明确断言裁剪后仍有32条及固定别名顺序，容量写死262,144／65,536，并补定稿。多调用接缝由 lead 裁定后共用，不能直接把当前替身算作 R2 完成。

3. **必须改：K3-42（二）的缺口不只是“owner 读取而非 HTTP”。**  
   测试直接预写模型结论（`K3-42-truncated-command.test.ts:317`），手动裁剪一次（`:358`），再另造 unexpanded 映射交给 owner（`:360`）。  
   最小反例：真实 prepare 不再按容量裁剪，或定稿读取清单的接线断开，这个测试仍通过，漏掉错误自动放行的风险。**修改思路：**复用修好的大输入夹具，让真实 prepare 产生 unexpanded，经脚本工具写结论、Workflow 定稿，再公开读回。单独使用 owner 公开读口并不是数据库读取问题；这里缺的是前半条生产链。

4. **必须改：K3-06、K3-13 把注入场景算成了生产批次证明。**  
   两处把工具改成 read_only＋independentReadOnly（`K3-mixed-seams.ts:67、69`；`K3-13-two-commands.test.ts:88、90`）。Kernel 仅对这种组合并行，其余逐个串行（`tool-registry.js:135、142`）；冻结规格明确要求 shell 保持 process（`slice-K3-SPEC.md:1392`），早任务书也把同类改造定为注入例（`.lead-ref/k3-g3-impl.md:99`）。  
   最小反例：真实工具分类下第二个调用根本未开始，替身却产生两／三个未知调用，掩盖规格场景的可达性差异。后半核对链仍有价值（`K3-06-mixed-batch.test.ts:222、234`；`K3-13-two-commands.test.ts:190、205`）。**修改思路：**保留并明确标为注入证据；由 lead 冻结合法的 Kernel 历史／执行接缝，再贯通认定及 R2。这也适用于 K3-35，宜共用一套夹具。

5. **必须改：新增测试重新直接打开数据库取断言材料。**  
   `K3-35-review-input-size.test.ts:427`、`K3-42-truncated-command.test.ts:183` 直接打开 artifacts.sqlite；包一层生产解析器仍是数据库读取。早任务书已明确纠正同类做法（`.lead-ref/k3-g3-impl.md:92`）。  
   最小反例：公开材料读取断了，直读库仍成功，测试掩盖使用入口故障。**修改思路：**模型实际收到的文字从请求观察；整份清单通过公开材料端口或 lead 冻结的写入见证测量。没有合适公开读口时报告接缝缺口，不增加生产路由凑测试。

两项**建议**：B1 的纯函数测试（`review-admission.test.ts:120、127`）抓不到调用方漏调准入函数；最小补法是在已有 Runtime 准入用例加 proposal，断言未进入、零模型调用。A1 缺 read 的测试目前只查 unavailable（`K3-19-review-capability-host.test.ts:153`），可同批补“不领取”。K3-37（三）已证明真实暂停扇出（`K3-37-stopped-review-round.test.ts:270、291`），但恢复只断言 committed，随后手动驱动第二轮（`:330、332`）；Host 恢复接线失效时仍能通过。第4组补自动恢复断言即可，本组不因此阻塞。

**L11 缺口确认，属于第4组必须补的门控，不是本次新增缺陷。** `workflow.ts:1239` 对 needs_decision 返回 pass，`:1537、1548` 随后可走普通重排、领取。`claim-service.ts:429` 没传 reviewPending，`:987` 仅核对领取读取记录；`run-machine.ts:633` 因而没有普通领取的事实来源。AV-2b 也未兜住：`plan-service.ts:891` 构造输入未带 reviews，`task-failure.ts:820` 将其视为无记录。

最小反例是记录 needs_decision、任务仍满足自动返工条件；再次推进可能领取普通 Run，越过人的决定。L11 列出全套门的位置，不等于全归第3组；分组明确把门控、恢复及普通领取相关验收放第4组（`slice-K3-SPEC.md:1569`；`.lead-ref/k3-g3-impl.md:123、142`）。**修改思路：**第4组统一读取选定 Run 的记录，接入选择、perform、重排 owner、普通领取及恢复；传递 pending／held／unreadable，提交加记录 revision或“不存在”守卫。仅改 Workflow 的 pass 不够。

成本核实为生产 +80／−27，净增53行。共享第一层判断、传递已选绑定已经消除了实际重复（`review-admission.ts:86`、`workflow.ts:1261`），没有值得继续强行合并的生产逻辑；返工重点应是复用上述测试夹具。

先改完列出的几处