# T items, group TQ (115 items; generated from the verified inventory, lead 2026-10-19)

编号 = 组内序号 · 清点编号（A1-07 = Codex 清点 A1 区第 7 条；D:… 的条目只在 DSH 清点里出现，编号前不带 C:）。 动作是最终的；看不懂或和代码对不上的，标 BLOCKED 并报证据（任务书 §1）。

### TQ-001 · P2b-22 · legacy · src/app/attention-observer.ts:588-599,651-715
- **动作：** change:删 attention-observer.ts:668-715 的直接读取回退，以及 590-591 的 plans/architecture 依赖；readAttentionGraph 改为必填（597），host.ts:1444-1447 去掉条件和 plans/architecture；S0-01/02/03 改成经 platform.runtime.readAttentionGraph（真实读取器 graph-context-reader.ts:157 生成同样的 depends 边）测试，边标签断言保留；AT11 的旧读取假件随之可删
- **覆盖/依据：** 当前扫描器由 S3-attention-context.test.ts:300 AT04、:462 AT11 覆盖；S0 的边标签行为现在在 graph-context-reader.ts:157，改入口后由 S0 规格行继续钉住
- **核实理由：** create-platform.ts:1509 的 runtimePort 字面量总会提供 readAttentionGraph（骨架版是 runtime.ts:96，真实版是 runtime.ts:737），host.ts:1444 只用这个平台，所以 668-715 的回退在生产中走不到。S0-attention-edge-label.test.ts:42-64 没传 readAttentionGraph，只测这个回退。AT04 用的是测试自己拼的边（S3-attention-context.test.ts:123-124），没测真实读取器，所以 S0 应该改测试入口，不能删。
- **涉及测试：** tests/app/S0-attention-edge-label.test.ts:42-64,68,76,87::旧 scanner 夹具及 S0-01/02/03; tests/app/S3-attention-context.test.ts:300::AT04; tests/app/S3-attention-context.test.ts:462::AT11
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：56
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：S0 转换缺 TQ 白名单，且与 T3-009 重复负责；见 .lead-ref/books/t-items-T3.md:61、.lead-ref/books/t-files-T3.txt:9。 改法：把 S0 测试归入 TQ，将 T3-009 要求并入本项，撤销 T3 对该条目和文件的重复施工。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：AT11 修改文件缺白名单，AT04 也残留被删除的依赖假件；见 tests/app/S3-attention-context.test.ts:304、:305、:466、:467。 改法：删除 AT04、AT11 的 plans/architecture 假件及旧说明，保留边断言以及读取失败、基线保留和不发送删除通知的断言。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：漏改未提供 readAttentionGraph 的 SC02 调用方；见 tests/scenarios/S3-query-graph.test.ts:459。 改法：为 SC02 扫描器绑定 h.platform.runtime.readAttentionGraph，删除 plans/architecture 参数，保留业务断言；将文件列为与 T2 明确共享的编辑范围。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：真实 reader 的 revision 带架构摘要，不能保留原 plan:p1 期望；revision 差异还会计入变化数。见 tests/app/S0-attention-edge-label.test.ts:71、src/core/work-graph/views/graph-context-reader.ts:1715、src/app/attention-observer.ts:238。 改法：使用符合 A1 的真实前置链并覆盖 memory、SQLite；固定比较双方的 Plan 标识和架构内容，只改变依赖 kind/label；明确完整 revision 的手算字面量，保留两条边变化及零节点、零状态变化断言。

### TQ-002 · P1-001 · allowlist-pre-batch · src/app/core-http-types.ts:298
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（298 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；projects/create 由 core-routes.ts:372、1052 分派，界面实际调用
- **核实理由：** DSH 的事实无误：core-http-types.ts:298 在 src/tests 没有具名引用，路由在 core-routes.ts:372/1052 分派，界面用 body: unknown 发请求（src/ui/api/http.ts:22）。但同文件 46 条同类路由 DTO 别名在 allowlist 记为 wire-format 保留（如 production-reach-allowlist.json:642 GoalsSettingsBody，note 写读者是 HTTP 路由边界和新工作台 UI），DSH 自己也判 keep，只删 pre-batch 这一半前后不一致，所以建议保留，从 Codex。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-003 · P1-002 · allowlist-pre-batch · src/app/core-http-types.ts:300
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（300 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；workspaces/register 由 core-routes.ts:373、1053 分派，界面实际调用
- **核实理由：** core-http-types.ts:300 确实无具名引用，路由 core-routes.ts:373/1053 照常分派；但同类路由 DTO 别名在 allowlist 记为 wire-format 保留，DSH 对那些也判 keep，单删这条不一致，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-004 · P1-003 · allowlist-pre-batch · src/app/core-http-types.ts:302
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（302 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；completion-policies/install 由 core-routes.ts:374、1054 分派
- **核实理由：** core-http-types.ts:302 无具名引用、路由 core-routes.ts:374/1054 分派属实；同文件 46 条同类别名记 wire-format 保留（allowlist:642 起），只删 pre-batch 一半不一致，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-005 · P1-004 · allowlist-pre-batch · src/app/core-http-types.ts:304
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（304 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；completion-policies/activate 由 core-routes.ts:375、1055 分派
- **核实理由：** core-http-types.ts:304 无具名引用、core-routes.ts:375/1055 分派属实；同类路由 DTO 别名按 wire-format 保留，DSH 也判 keep，建议这条一样保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-006 · P1-005 · allowlist-pre-batch · src/app/core-http-types.ts:306
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（306 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；completion-policies/read 由 core-routes.ts:376、1056 分派
- **核实理由：** core-http-types.ts:306 无具名引用、core-routes.ts:376/1056 分派属实；但它和 allowlist 里 46 条 wire-format 路由 DTO 是同一类，单删不一致，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-007 · P1-006 · allowlist-pre-batch · src/app/core-http-types.ts:307
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（307 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；completion-policies/read 由 core-routes.ts:376、1056 分派
- **核实理由：** core-http-types.ts:307 无具名引用属实；同文件 46 条同类响应和请求别名记 wire-format 保留（note 写读者是 HTTP 路由边界和新工作台 UI），建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-008 · P1-007 · allowlist-pre-batch · src/app/core-http-types.ts:308
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（308 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；goals/create 由 core-routes.ts:377、1057 分派，界面实际调用
- **核实理由：** core-http-types.ts:308 无具名引用、core-routes.ts:377/1057 分派属实，同路由的 GoalsCreateResponse 被 src/ui/state/scope-state.ts:16 使用；同类别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-009 · P1-008 · allowlist-pre-batch · src/app/core-http-types.ts:310
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（310 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；goals/read 由 core-routes.ts:378、1058 分派
- **核实理由：** core-http-types.ts:310 无具名引用、core-routes.ts:378/1058 分派属实；同类路由 DTO 别名在 allowlist 记 wire-format 保留，单删 pre-batch 一半不一致，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-010 · P1-009 · allowlist-pre-batch · src/app/core-http-types.ts:311
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（311 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；goals/read 由 core-routes.ts:378、1058 分派
- **核实理由：** core-http-types.ts:311 无具名引用属实；它和 wire-format 保留的同类响应别名（如 GoalsSettingsResponse）是一族，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-011 · P1-010 · allowlist-pre-batch · src/app/core-http-types.ts:312
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（312 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；architecture/adopt-initial 由 core-routes.ts:379、1059 分派
- **核实理由：** core-http-types.ts:312 无具名引用、core-routes.ts:379/1059 分派属实；同类路由 DTO 别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-012 · P1-011 · allowlist-pre-batch · src/app/core-http-types.ts:315
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（315 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；architecture/read 由 core-routes.ts:380、1060 分派，同路由 Body 被 src/ui/state/layout.ts:66 使用
- **核实理由：** core-http-types.ts:315 无具名引用、Body 被 layout.ts:66 和 graphs/actions.ts:64 使用都属实；删响应留请求会让同一路由的契约只剩一半，且同类别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-013 · P1-012 · allowlist-pre-batch · src/app/core-http-types.ts:319-325
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（319-325 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；requestSeq 的运行时拒绝在 core-routes.ts:573-577，由 tests/app/S8A-L8-http-watermark.test.ts:48 钉住
- **核实理由：** core-http-types.ts:319-325 无具名引用、解析器 core-routes.ts:573-577 拒绝 requestSeq 都属实；但这个形状是 L8 返工 P16 刚定的，冻结规格 slice-8-SPEC.md:991 写“公开 HTTP 输入和它的运行时解析拒绝 requestSeq”，DSH 没提这条，删了要改规格，所以更该保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-014 · P1-013 · allowlist-pre-batch · src/app/core-http-types.ts:326
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（326 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；architecture/capture 由 core-routes.ts:381、1061 分派
- **核实理由：** core-http-types.ts:326 无具名引用、core-routes.ts:381/1061 分派属实；同路由的请求别名是 L8 定的契约（slice-8-SPEC.md:991），同类别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-015 · P1-014 · allowlist-pre-batch · src/app/core-http-types.ts:327
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（327 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；architecture/query 由 core-routes.ts:382、1062 分派
- **核实理由：** core-http-types.ts:327 无具名引用、core-routes.ts:382/1062 分派属实（文档里只有历史稿 docs/refactor/skeleton/END-TO-END.md:192 提到）；同类别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-016 · P1-015 · allowlist-pre-batch · src/app/core-http-types.ts:328
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（328 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；architecture/query 由 core-routes.ts:382、1062 分派
- **核实理由：** core-http-types.ts:328 无具名引用属实；它和 allowlist 里按 wire-format 保留的同类响应别名是一族，单删不一致，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-017 · P1-016 · allowlist-pre-batch · src/app/core-http-types.ts:329
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（329 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 不删；plans/propose 由 core-routes.ts:388、1067 分派，界面实际调用
- **核实理由：** core-http-types.ts:329 无具名引用、core-routes.ts:388/1067 分派属实，同路由 PlansProposeResponse 被 src/ui/state/scope-state.ts:23 使用；同类别名按 wire-format 保留，建议保留。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：0

### TQ-018 · P1-017 · allowlist-pre-batch · src/app/core-http-types.ts:331
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（331 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:389、1068 与 PlanTaskPort.applyPlanChange 签名，删别名不改运行时）
- **核实理由：** 全仓只有声明 core-http-types.ts:331 和 allowlist:102 两处；UI 发请求体一律是 unknown（src/ui/api/http.ts:22、submit.ts:13，buildApplyRequest 也返回 unknown，src/ui/views/setup/requests.ts:165），只有响应别名 PlansApplyResponse 被用（scope-state.ts:22、77），Codex 说的“HTTP 调用方”在代码里不存在，DSH 对。估计行数要加 allowlist 6 行（production-reach.test.ts:104-105 对已删声明的条目报错），共 7 行。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-019 · P1-018 · allowlist-pre-batch · src/app/core-http-types.ts:333
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（333 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:390、1069 与 PlanTaskPort.readPlanProposal 签名）
- **核实理由：** 只在 core-http-types.ts:333 和 allowlist:108 出现；UI 的 buildProposalReadRequest 返回 unknown（setup/requests.ts:180）再交给 submit(body: unknown)，没有任何调用方用这个具名请求体，删掉不改 JSON。估计行数应为 1 行声明加 6 行 allowlist（production-reach.test.ts:104-105），共 7 行。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-020 · P1-019 · allowlist-pre-batch · src/app/core-http-types.ts:334
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（334 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；UI 把 plans/proposal 结果存成 unknown）
- **核实理由：** 只在 core-http-types.ts:334 和 allowlist:114 出现；UI 收到 plans/proposal 结果直接存 scope.proposalRead = payload（apply-result.ts:77），字段类型是 unknown（scope-state.ts:288），不用这个响应别名。估计行数 1+6=7（allowlist 条目必须同删，production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-021 · P1-020 · allowlist-pre-batch · src/app/core-http-types.ts:335
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（335 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:391、1070 与 PlanTaskPort.queryTaskGraph 签名）
- **核实理由：** 只在 core-http-types.ts:335 和 allowlist:120 出现；UI 调 tasks/query 都是手写字面量交给 unknown 参数（src/ui/views/nav/project-tree.ts:47、graphs/actions.ts:99、setup/requests.ts:219 返回 unknown），没有调用方用这个别名。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-022 · P1-021 · allowlist-pre-batch · src/app/core-http-types.ts:336
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（336 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；UI 把 tasks/query 结果直接存为 payload）
- **核实理由：** 只在 core-http-types.ts:336 和 allowlist:126 出现；UI 收到结果 scope.taskGraph = payload（apply-result.ts:86-88），读图时用的是转出的 TaskGraph（graphs/actions.ts:4），不用这个响应别名。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-023 · P1-022 · allowlist-pre-batch · src/app/core-http-types.ts:337
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（337 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:392、1071 与 WorkspaceToolsPort.readWorkspace 签名）
- **核实理由：** 只在 core-http-types.ts:337 和 allowlist:132 出现；UI 调 files/read 用 callCore(route, body: unknown)（http.ts:22；files/save-diff.ts:50、147）和返回 unknown 的 buildFileRequest（setup/requests.ts:245），只用响应别名 FilesReadResponse（scope-state.ts:14、80）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-024 · P1-023 · allowlist-pre-batch · src/app/core-http-types.ts:342
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（342 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:431、1108 与 WorkbenchToolsPort.listFiles 签名）
- **核实理由：** 只在 core-http-types.ts:342 和 allowlist:138 出现；UI 调 files/list 是 callCore 加手写字面量（src/ui/views/files/directory.ts:109），没有用这个别名，DSH 对。DSH 漏了 339-341 的注释：本条和 P1-024 一起删后它没有着落，要移走或删，估计行数 1+6+3=10。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：10

### TQ-025 · P1-024 · allowlist-pre-batch · src/app/core-http-types.ts:343
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（343 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者）
- **核实理由：** 只在 core-http-types.ts:343 和 allowlist:144 出现；directory.ts:109 收到 files/list 结果后不用这个响应别名，同文件其余被 UI 用的响应别名都在 scope-state.ts:14-40，里面没有它。估计行数 1+6=7（production-reach.test.ts:104-105）；注释 339-341 的处理记在 P1-023。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-026 · P1-025 · allowlist-pre-batch · src/app/core-http-types.ts:346
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（346 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:393、1072 与 WorkspaceCapturePort.captureSourceChanges 签名）
- **核实理由：** 只在 core-http-types.ts:346 和 allowlist:150 出现；UI 的 buildSourceCaptureRequest 返回 unknown（setup/requests.ts:226），save-diff.ts:108 也是 callCore 加字面量，只有响应别名 SourceCaptureResponse 被用（scope-state.ts:39、78）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-027 · P1-026 · allowlist-pre-batch · src/app/core-http-types.ts:348
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（348 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:394、1073 与 WorkspaceCapturePort.querySource 签名）
- **核实理由：** 只在 core-http-types.ts:348 和 allowlist:156 出现；UI 的 buildSourceQueryRequest 返回 unknown（setup/requests.ts:235），只用响应别名 SourceQueryResponse（scope-state.ts:40、79）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-028 · P1-027 · allowlist-pre-batch · src/app/core-http-types.ts:362
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（362 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:395、1074 与 SessionDirectoryPort.findSessions 签名）
- **核实理由：** 只在 core-http-types.ts:362 和 allowlist:162 出现；UI 的 buildSessionFindRequest 返回 unknown（src/ui/views/sessions/requests.ts:104），只用响应别名 SessionsFindResponse（apply-result.ts:12、106）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-029 · P1-028 · allowlist-pre-batch · src/app/core-http-types.ts:364
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（364 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:396、1075 与 SessionDirectoryPort.readSession 签名）
- **核实理由：** 只在 core-http-types.ts:364 和 allowlist:168 出现；UI 的 buildSessionReadRequest 返回 unknown（sessions/requests.ts:129），只用响应别名 SessionsReadResponse（apply-result.ts:15、117）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-030 · P1-029 · allowlist-pre-batch · src/app/core-http-types.ts:366
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（366 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:397、1076 与 SessionDirectoryPort.getSessionOperation 签名）
- **核实理由：** 只在 core-http-types.ts:366 和 allowlist:174 出现；UI 调 sessions/operation 把 body 交给 submit(body: unknown)（sessions/actions.ts:127、submit.ts:13），只用响应别名 SessionsOperationResponse（apply-result.ts:14、126）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-031 · P1-030 · allowlist-pre-batch · src/app/core-http-types.ts:368
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（368 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:398、1077 与 RuntimeExecutionPort.capabilities 签名）
- **核实理由：** 只在 core-http-types.ts:368 和 allowlist:180 出现；UI 的 buildRuntimeCapabilitiesRequest 返回 unknown（sessions/requests.ts:189），只用响应别名 RuntimeCapabilitiesResponse（apply-result.ts:10、129）。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-032 · P1-031 · allowlist-pre-batch · src/app/core-http-types.ts:370
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（370 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:399、1078 与 RuntimeExecutionPort.createSession 签名）
- **核实理由：** 只在 core-http-types.ts:370 和 allowlist:186 出现；UI 的两处 sessions/create 请求都是手写字面量（sessions/requests.ts:125、execution/run.ts:174-176），只用响应别名 SessionsCreateResponse（apply-result.ts:11、132），删掉不改协议。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-033 · P1-032 · allowlist-pre-batch · src/app/core-http-types.ts:372
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（372 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（无消费者；路由契约在 core-routes.ts:400、1079 与 RuntimeExecutionPort.readSessionHistory 签名）
- **核实理由：** 只在 core-http-types.ts:372 和 allowlist:192 出现；UI 的 buildSessionHistoryRequest 只用 SessionsHistoryResponse 当参数类型，自身返回 unknown（sessions/requests.ts:165-168），没有调用方用这个请求别名。估计行数 1+6=7（production-reach.test.ts:104-105）。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：7

### TQ-034 · P1-033 · allowlist-pre-batch · src/app/core-http-types.ts:374
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（374 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:404/1083 照常工作）
- **核实理由：** MessagesSendBody 确实只在 core-http-types.ts:374 声明、allowlist:198 登记，src/tests 无引用，路由在 core-routes.ts:404/1083；但同文件 46 条新路由别名同样无人引用，却按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 登记成 wire-format 保留，按路由给齐 Body/Response 是 core-http-types.ts:1-12 和 R6 任务书 :9 的设计，所以“无引用”不足以单独删它，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-035 · P1-034 · allowlist-pre-batch · src/app/core-http-types.ts:376
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（376 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:405/1084 照常工作）
- **核实理由：** MessagesInboxBody 确实只在 core-http-types.ts:376 声明、allowlist:204 登记，src/tests 无引用，路由在 core-routes.ts:405/1084；但同类的新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 登记成 wire-format 保留（note 明说 src 里没人引用），按路由给齐 Body/Response 是 core-http-types.ts:1-12 的设计，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-036 · P1-035 · allowlist-pre-batch · src/app/core-http-types.ts:378
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（378 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:407/1086 照常工作）
- **核实理由：** MessagesReadBody 确实只在 core-http-types.ts:378 声明、allowlist:210 登记，src/tests 无引用，路由在 core-routes.ts:407/1086；但同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，同路由 MessagesReadResponse 还被 UI 用，删掉只会让具名契约缺一半，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-037 · P1-036 · allowlist-pre-batch · src/app/core-http-types.ts:380
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（380 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:408/1087 照常工作）
- **核实理由：** MessagesBodyBody 确实只在 core-http-types.ts:380 声明、allowlist:216 登记，src/tests 无引用，路由在 core-routes.ts:408/1087；但同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，同路由 MessagesBodyResponse 还被 UI 用，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-038 · P1-037 · allowlist-pre-batch · src/app/core-http-types.ts:382
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（382 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:406/1085 照常工作）
- **核实理由：** MessagesOutboxBody 确实只在 core-http-types.ts:382 声明、allowlist:222 登记，src/tests 无引用，路由在 core-routes.ts:406/1085；它和 P1-038 一起删会让 messages/outbox 没有任何具名 DTO，而同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-039 · P1-038 · allowlist-pre-batch · src/app/core-http-types.ts:383
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（383 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:406/1085 照常工作）
- **核实理由：** MessagesOutboxResponse 确实只在 core-http-types.ts:383 声明、allowlist:228 登记，src/tests 无引用；但同文件 46 条新路由别名同样无人引用，却按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 登记成 wire-format 保留，单删这一对会让 messages/outbox 的具名契约整条缺失，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-040 · P1-039 · allowlist-pre-batch · src/app/core-http-types.ts:505
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（505 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:409/1088 照常工作）
- **核实理由：** WorkspacesRegistrationBody 确实只在 core-http-types.ts:505 声明、allowlist:234 登记，src/tests 无引用，路由在 core-routes.ts:409/1088；同路由 WorkspacesRegistrationResponse 被 UI 用了 6 处，同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-041 · P1-040 · allowlist-pre-batch · src/app/core-http-types.ts:509
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（509 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:411/1090 照常工作）
- **核实理由：** QueriesReadBody 确实只在 core-http-types.ts:509 声明、allowlist:240 登记，src/tests 无引用；DSH 说同路由 Response 被 UI 用 5 处也对（ui/views/conversation/goal-start.ts:5,41,72、ui/views/sessions/requests.ts:5,34），正因如此只删 Body 会让这条路由的具名契约缺一半，而同类别名按 slice-2B-SPEC.md:107（F34）作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-042 · P1-041 · allowlist-pre-batch · src/app/core-http-types.ts:511
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（511 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:412/1091 照常工作）
- **核实理由：** QueriesClaimBody 确实只在 core-http-types.ts:511 声明、allowlist:246 登记，src/tests 无引用，路由在 core-routes.ts:412/1091；但同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留（note 明说 src 里没人引用），Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-043 · P1-042 · allowlist-pre-batch · src/app/core-http-types.ts:512
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（512 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:412/1091 照常工作）
- **核实理由：** QueriesClaimResponse 确实只在 core-http-types.ts:512 声明、allowlist:252 登记，src/tests 无引用；和 P1-041 一起删会让 queries/claim 没有具名 DTO，而同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-044 · P1-043 · allowlist-pre-batch · src/app/core-http-types.ts:513
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（513 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:413/1092 照常工作）
- **核实理由：** QueriesPrepareBody 确实只在 core-http-types.ts:513 声明、allowlist:258 登记，src/tests 无引用，路由在 core-routes.ts:413/1092；同路由 QueriesPrepareResponse 有人用，同类新路由别名按 slice-2B-SPEC.md:107（F34）作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-045 · P1-044 · allowlist-pre-batch · src/app/core-http-types.ts:515
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（515 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:414/1093 照常工作）
- **核实理由：** QueriesStartBody 确实只在 core-http-types.ts:515 声明、allowlist:264 登记，src/tests 无引用，路由在 core-routes.ts:414/1093；同路由 QueriesStartResponse 有人用，同类新路由别名按 slice-2B-SPEC.md:107（F34）作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-046 · P1-045 · allowlist-pre-batch · src/app/core-http-types.ts:517
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（517 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:415/1094 照常工作）
- **核实理由：** QueriesObserveBody 确实只在 core-http-types.ts:517 声明、allowlist:270 登记，src/tests 无引用，路由在 core-routes.ts:415/1094；但同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，按路由给齐 Body/Response 是 core-http-types.ts:1-12 的设计，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-047 · P1-046 · allowlist-pre-batch · src/app/core-http-types.ts:518
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（518 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:415/1094 照常工作）
- **核实理由：** QueriesObserveResponse 确实只在 core-http-types.ts:518 声明、allowlist:276 登记，src/tests 无引用；和 P1-045 一起删会让 queries/observe 没有具名 DTO，而同类新路由别名按 slice-2B-SPEC.md:107（F34）、slice-4-SPEC.md:680 作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-048 · P1-047 · allowlist-pre-batch · src/app/core-http-types.ts:521
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（521 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:417/1096 照常工作）
- **核实理由：** MaterialsOpenBody 确实只在 core-http-types.ts:521 声明、allowlist:282 登记，src/tests 无引用；DSH 说同路由 Response 被 UI 用 6 处也对（ui/state/scope-state.ts:18,166、ui/views/conversation/goal-start-deps.ts:6,107、ui/views/execution/run.ts:5,205），只删 Body 会让具名契约缺一半，同类别名按 slice-2B-SPEC.md:107（F34）作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-049 · P1-048 · allowlist-pre-batch · src/app/core-http-types.ts:524
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（524 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** —（只是类型别名，无运行时行为；路由 core-routes.ts:418/1097 照常工作）
- **核实理由：** WorkflowGoalInputResponse 确实只在 core-http-types.ts:524 声明、allowlist:288 登记，无人引用，同路由 Body 在 ui/state/scope-state.ts:87 被用；Codex 另指出的也对：它派生自 handleGoalInput 的结果 InitialPlanningGoalInputResult（business/workflow/ports.ts:226、contracts.ts:322），N0 只删输入联合里的 N0GoalInput，结果类型不变，所以它不随 N0 删，加上同类别名按 slice-2B-SPEC.md:107（F34）作为 wire-format 保留，Codex 的保留更合约定。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-050 · P1-049 · allowlist-pre-batch · src/app/core-http-types.ts:526
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（526 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：WorkflowAdvanceResponse（core-http-types.ts:526）在 src/tests/docs/scripts 无命名引用，路由 core-routes.ts:419、1098 在用，删掉不改 JSON。但 slice-2B-SPEC.md:107（F34）规定路由 Body/Response 别名登记成 wire-format 保留，DSH 自己也把 46 条同样无引用的路由别名判 keep（如 P1-063），只删这批 pre-batch 前后不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-051 · P1-050 · allowlist-pre-batch · src/app/core-http-types.ts:537
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（537 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：WorkflowDriverReadBody（core-http-types.ts:537）无命名引用，路由 core-routes.ts:422、1101 在用，界面在 collaboration.ts:103 直接写请求体、callCore 收 unknown（src/ui/api/http.ts:22）。但同类路由别名按 F34（slice-2B-SPEC.md:107）登记 wire-format 保留，只删 pre-batch 这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-052 · P1-051 · allowlist-pre-batch · src/app/core-http-types.ts:539
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（539 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：WorkflowDriverStopBody（core-http-types.ts:539）无命名引用，路由 core-routes.ts:423、1102 在用，界面 collaboration.ts:171 直接写请求体。同类路由别名按 F34（slice-2B-SPEC.md:107）登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-053 · P1-052 · allowlist-pre-batch · src/app/core-http-types.ts:550
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（550 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：ExecutionsReadBody（core-http-types.ts:550）无命名引用，路由 core-routes.ts:424、1103 在用，界面 src/ui/views/execution/actions.ts:170 直接写请求体，同组 ExecutionsReadResponse 界面在用（apply-result.ts:188）。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-054 · P1-053 · allowlist-pre-batch · src/app/core-http-types.ts:552
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（552 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：ExecutionsHistoryBody（core-http-types.ts:552）无命名引用，路由 core-routes.ts:425、1104 在用，界面 actions.ts:172 直接写请求体。同类路由别名按 F34（slice-2B-SPEC.md:107）登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-055 · P1-054 · allowlist-pre-batch · src/app/core-http-types.ts:567
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（567 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：ExecutionsListBody（core-http-types.ts:567）无命名引用，路由 core-routes.ts:428、1105 在用，同组 ExecutionsListResponse 界面在用（src/ui/views/execution/list.ts:34）。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-056 · P1-055 · allowlist-pre-batch · src/app/core-http-types.ts:569
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（569 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：ProjectsReadBody（core-http-types.ts:569）无命名引用，路由 core-routes.ts:429、1106 在用，界面 goal-setup.ts:141 直接写请求体。同类路由别名按 F34（slice-2B-SPEC.md:107）登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-057 · P1-056 · allowlist-pre-batch · src/app/core-http-types.ts:571
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（571 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：FilesSaveBody（core-http-types.ts:571）无命名引用，路由 core-routes.ts:430、1107 在用，同组 FilesSaveResponse 界面在用（save-diff.ts:42）。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-058 · P1-057 · allowlist-pre-batch · src/app/core-http-types.ts:573
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（573 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：FilesCompareBody（core-http-types.ts:573）无命名引用，路由 core-routes.ts:432、1109 在用，同组 FilesCompareResponse 界面在用（save-diff.ts:132）。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-059 · P1-058 · allowlist-pre-batch · src/app/core-http-types.ts:575
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（575 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：CommandsStartBody（core-http-types.ts:575）无命名引用，路由 core-routes.ts:433、1110 在用，界面 terminal/commands.ts:36 直接写请求体。同类路由别名按 F34（slice-2B-SPEC.md:107）登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-060 · P1-059 · allowlist-pre-batch · src/app/core-http-types.ts:577
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（577 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：CommandsReadBody（core-http-types.ts:577）无命名引用，路由 core-routes.ts:434、1111 在用，界面 terminal/commands.ts:67 直接写请求体。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-061 · P1-060 · allowlist-pre-batch · src/app/core-http-types.ts:579
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（579 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：like the GoalsSettingsBody entry: the <this alias's route> route request/response DTO; its reader is the HTTP route boundary (src/app/server.ts + CORE_ROUTE_SPECS/core-routes.ts) and the workbench UI; nothing in src/ names the alias at runtime。路由名从 src/app/core-routes.ts 的 CORE_ROUTE_SPECS 查。
- **覆盖/依据：** 无测试导入；保留依据 slice-2B-SPEC.md:107 F34
- **核实理由：** 事实属实：CommandsStopBody（core-http-types.ts:579）无命名引用，路由 core-routes.ts:435、1112 在用，界面 terminal/commands.ts:84 直接写请求体。同类路由别名按 F34 登记 wire-format 保留，只删这批不一致。
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：2

### TQ-062 · P2b-13 · old-data · src/app/host-settings-types.ts:26-42
- **动作：** change:HostSettingsSnapshot.automation/resourceCaps 改为必需并删去“older snapshots”注释（host-settings-types.ts:26-42）；补全 tests/app/settings-ui.test.ts:38、:93 两个快照字面量；不动磁盘 PersistedSettingsV1
- **覆盖/依据：** tests/app/A2-settings-automation.test.ts:60,125 与 tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,114 的输出、保存、重开测试保留；文档 STATE-MACHINES-SPEC.md:4769,4868 和 slice-RL-SPEC.md:655 写着“可选”，由 lead 同步
- **核实理由：** 唯一生产者 snapshotOf（host-settings.ts:548-572）每次都带上 automation 和 resourceCaps；src/ui/settings.ts 不读这两个字段。剩下要改的只有 tests/app/settings-ui.test.ts:38、:93 两个缺字段的字面量，改成必需对行为没有影响。
- **涉及测试：** tests/app/A2-settings-automation.test.ts:60,125::默认输出及保存重开; tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,114::RL-40/RL-41
- 来源：Codex；核实：confirmed；规格行：是；估计行数：12

### TQ-063 · P1-061 · allowlist-pre-batch · src/app/main.ts:19-29
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（19-29 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：the workbench startup JSON shape; its reader is parseWorkbenchCliConfig (src/app/main.ts:72) and README.md:59 documents it
- **覆盖/依据：** 建议保留；配置 JSON 由 tests/app/R6-host.test.ts:698 经 loadWorkbenchCliConfig 读取
- **核实理由：** src/app/main.ts:19-29 是启动配置 workspaces[] 单项的形状，只被 main.ts:35 引用，字段和解析代码 main.ts:81-105 实际读的一致，描述对。它只是 WorkbenchCliConfig 的一部分，跟着那条走，建议留合理（DSH 也建议留）。
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TQ-064 · P1-062 · allowlist-pre-batch · src/app/main.ts:31-51
- **动作：** change（用户 2026-10-19 选保留）：代码不动；production-reach-allowlist.json 里这一条（31-51 行的声明）的 reason 由 "pre-batch" 改为 "wire-format"，note 改写为：the workbench startup JSON shape; its reader is parseWorkbenchCliConfig (src/app/main.ts:72) and README.md:59 documents it
- **覆盖/依据：** 建议保留；tests/app/R6-host.test.ts:698、tests/app/AG2-consultation.test.ts:169 按这个形状写配置再读
- **核实理由：** src/app/main.ts:31-51 的字段和 parseWorkbenchCliConfig（main.ts:72-193）实际读取的字段一一对应，README.md:59 把它写成配置契约，描述对，留是合理的（两位盘点者一致）。要告诉用户：解析收的是 raw: unknown（main.ts:72），不用这个类型，类型以后可能和解析漂移。
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TQ-065 · P1-064 · allowlist-kept-for · src/contracts/role-material-channels.ts:3-16
- **动作：** delete
- **覆盖/依据：** 行为已不存在：slice-3-SPEC.md:492 定 Role 必读 code 材料仍不支持（execution-preparation.ts:414-418 回 unsupported）；第 6、7、8 片和 E3 都没有 code 材料通道
- **核实理由：** 注里写的使用方第 3 片已合入且没接（slice-3-SPEC.md:492），这些类型只被只有测试用的 WorkspaceSourceIndexReader 用（src/core/workspace/role-source-reader.ts:45，允许清单 :635）；“按含义挑成员”是 7C L15 按职责挑人（slice-7-SPEC.md:166），用不到源码索引。整个 role-material-channels.ts（52 行）要和读取器（131 行）、tests/data/workspace-path-boundary.test.ts:65-105 的 3 个读取器用例及其夹具（约 80 行）一起删，留 :57 的拒绝前缀用例。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：20

### TQ-066 · P1-065 · allowlist-kept-for · src/contracts/role-material-channels.ts:17-19
- **动作：** delete
- **覆盖/依据：** 行为已不存在：slice-3-SPEC.md:492 定 Role 必读 code 材料仍不支持；之后各片没有 code 材料通道
- **核实理由：** RoleSourceIndexEntryV1（src/contracts/role-material-channels.ts:17-19）只被只有测试用的 WorkspaceSourceIndexReader 用，理由同 P1-064，和整个文件、读取器一起删。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：9

### TQ-067 · P1-066 · allowlist-kept-for · src/contracts/role-material-channels.ts:20-25
- **动作：** delete
- **覆盖/依据：** 行为已不存在：slice-3-SPEC.md:492 定 Role 必读 code 材料仍不支持；之后各片没有 code 材料通道
- **核实理由：** RoleSourceIndexExcerptV1（src/contracts/role-material-channels.ts:20-25）只被只有测试用的 WorkspaceSourceIndexReader 用，理由同 P1-064，和整个文件、读取器一起删。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：12

### TQ-068 · P1-067 · allowlist-kept-for · src/contracts/role-material-channels.ts:26-48
- **动作：** delete
- **覆盖/依据：** 行为已不存在：slice-3-SPEC.md:492 定 Role 必读 code 材料仍不支持；之后各片没有 code 材料通道
- **核实理由：** RoleSourceIndexResultV1（src/contracts/role-material-channels.ts:26-48）只被只有测试用的 WorkspaceSourceIndexReader（role-source-reader.ts:50）用，理由同 P1-064，和整个文件、读取器一起删。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：29

### TQ-069 · P1-068 · allowlist-kept-for · src/contracts/role-material-channels.ts:50-52
- **动作：** delete
- **覆盖/依据：** 行为已不存在：slice-3-SPEC.md:492 定 Role 必读 code 材料仍不支持；之后各片没有 code 材料通道
- **核实理由：** RoleSourceIndexPort（src/contracts/role-material-channels.ts:50-52）唯一实现是只有测试用的 WorkspaceSourceIndexReader（role-source-reader.ts:45）；理由同 P1-064。读取器 131 行和测试约 80 行算在读取器那一条，IMPLEMENTED-CAPABILITIES.md:298 一行随之改。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：10

### TQ-070 · P2b-01 · old-data · src/core/record-store/body-codec.ts:160-218,239-286
- **动作：** change:body-codec.ts 删掉 decodeOrigin 207-213 缺 origin 的分支（缺 origin 改为 corrupt）、196 的 legacy 专门拒绝（落到 197 不支持的种类）、247 写出的 ownerRunRef 镜像及 NormalizedOrigin.ownerRunRef、originOwnerMatches 200-204 和 215-217 的一致性检查、文件头 5-13/19 的兼容说明；body-ports.ts:9 的 legacy 成员和 :15 的 Exclude；与 P2a-15（applicability.ts:97）同批。测试：删 R3b-materials-contract.test.ts:63-86 和 :151-156；删 R3b-body-boundaries.test.ts:67-77（只测镜像冲突，篡改用）并去掉 rowFor:23 的 ownerRunRef；删 S3-context-inputs.test.ts:874-884 的 IN18（slice-3-SPEC.md:683 那一行整行是 legacy origin）及夹具 176 的 'owner-less' 选项和 554-557 分支；R3b-materials-contract.test.ts:88-106 照留
- **覆盖/依据：** 旧格式依 docs/refactor/HANDOFF.md:566 退役；当前格式：tests/data/R3b-materials-contract.test.ts:45、:110、:132、:144；损坏正文 :88；R3b-body-boundaries.test.ts:44；IN18 的行为已不存在（slice-3-SPEC.md:683，lead 加后注）
- **核实理由：** 核心成立：当前写入只走 encodeArtifactBodyRow（body-codec.ts:239、247 必写 origin），内存和 SQLite 共用它（body-store.ts:30、sqlite-body-store.ts:48），存储行里的 ownerRunRef 只有 decodeOrigin 读（material-service.ts:108、plan-service.ts:1178 用的是从 origin 推出来的值）。但删除清单漏了 S3-context-inputs.test.ts:554-557 和 IN18（874），以及 R3b-body-boundaries.test.ts:67 的镜像冲突测试，去掉镜像后后者会失败。
- **涉及测试：** tests/data/R3b-materials-contract.test.ts:63::reopens the original artifacts table and reads legacy first-owner provenance; tests/data/R3b-materials-contract.test.ts:151::does not infer a Host-readable scope from a legacy record without an owner
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：85
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：要求保留的混合测试被 TQ-099 删除，覆盖依据还引用 TQ-094 删除的测试。见 .lead-ref/books/t-items-TQ.md:422、:423、:615。 改法：删除“88-106 照留”及已删除测试的覆盖引用；按 TQ-099 删除混合测试，保留当前格式材料测试和 SQLite 并发重开覆盖。

### TQ-071 · P2b-03 · old-data · src/core/record-store/sqlite-lookup-indexes.ts:85-113
- **动作：** change: 删除 planMigration 的整个 drop 分支（TYPE_PREDICATE :87-88、registeredTypes :100、drop 列表与判断 :102,105-110、DROP 循环 :130 及模块注释 :10-13 的 C' 规则）；保留 expectedIndexes、缺索引 create 规划和 BEGIN IMMEDIATE 内重规划的创建事务；SP-40..SP-43 不改
- **覆盖/依据：** 行为已不存在：生产只在 create-platform.ts:678 用一套固定注册开 ledger，过时索引只来自别的代码版本写的库（79-1 重建）；SP-40..SP-43 只断言 lookup 答案，删 drop 后仍通过
- **核实理由：** 生产只有 create-platform.ts:678 一个后端、注册固定，所以“仍注册类型的过时索引”和无谓词旧全索引一样只出现在别的构建写的库里，Codex 说 SP-40..43 钉住当前注册变化不对（测试文件头 :5-7 自称 characterization，只看答案）；但 DSH 的行号 99-113、123-131 把 create 规划和事务也划进删除范围，这部分新库要用，必须保留。
- **涉及测试：** tests/record-store/SP-lookup-index-migration.test.ts:107::SP-40; tests/record-store/SP-lookup-index-migration.test.ts:154::SP-41; tests/record-store/SP-lookup-index-migration.test.ts:188::SP-42; tests/record-store/SP-lookup-index-migration.test.ts:223::SP-43
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：15

### TQ-072 · P2b-02 · old-data · src/core/record-store/sqlite-text-scan.ts:54-60,135-160
- **动作：** delete：sqlite-text-scan.ts 的 13-15 注释、54-60 的 LEGACY_TABLES_SQL、135-160 的开库删表；同时删 SP-12（SP-text-scan.test.ts:400-435）、它的导入 :16 和只给它用的 tests/helpers/SP-storage-migration-fixture.ts（31 行）
- **覆盖/依据：** 旧 FTS 升级依 docs/refactor/HANDOFF.md:566 退役，SP-12 这一行的行为已不存在（lead 给 slice-4 提速规格的 SP-12 加后注）；当前重建和追赶由 tests/record-store/SP-text-scan.test.ts:176::SP-05、:316::SP-09、:333::SP-10、:350::SP-11、:374::SP-11B 覆盖
- **核实理由：** 成立：src 里没有任何地方建 next_fts_ 表或虚表（只在 sqlite-text-scan.ts:14-60、137-148 出现），当前只建 next_text_meta（43）和 next_text_* 普通表（205-211）。漏了一处：tests/helpers/SP-storage-migration-fixture.ts 只被 SP-text-scan.test.ts:16、:415 用，要一起删；行数应把 SP-12 和这个夹具算进去。
- **涉及测试：** tests/record-store/SP-text-scan.test.ts:400::SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：100

### TQ-073 · P1-158 · allowlist-kept-for · src/core/work-graph/architecture/architecture-record-codecs.ts:41
- **动作：** delete（删 architecture-record-codecs.ts:41 的常量，:40 的注释挪给 :42 的 FILE_GRAPH_CHUNK_CONTENT_TYPE；同时删 production-reach-allowlist.json:946-951 这条，不然声明没了条目还在）
- **覆盖/依据：** 没有任何读写方用它：src 和 tests 只在 :41 声明一次；块写入 architecture-service.ts:1154-1179、解码 architecture-record-codecs.ts:314-349 都只认 schemaVersion 2，不带 schema id
- **核实理由：** Grep 全仓 FILE_GRAPH_CHUNK_SCHEMA_ID 只有 architecture-record-codecs.ts:41 和允许清单 :948；当前块正文按 :314-349 只有 schemaVersion 2 的六个键，写入方 architecture-service.ts:1162-1179 也不写这个 id，第 8 片规格和 E3 都没提它，删掉不改行为。原来估 0 行不对：源码约 2 行，允许清单 6 行。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：8

### TQ-074 · P2a-11 · old-data · src/core/work-graph/architecture/catalog-record-codecs.ts:398-409;576-578
- **动作：** change:Catalog 记录必须有 since 键：删掉 validateArchitectureCatalog 的缺键分支（catalog-record-codecs.ts:398-409）、decodeArchitectureCatalogRecord 的补 null（:576-578），还有修订事件里内嵌记录的同样缺键分支 readArchitectureCatalogRecordValue（:458-472）。保留 since:null（采纳时不绑定，修订事件里是绑定前的值）
- **覆盖/依据：** tests/work-graph/S8A-catalog-version-time.test.ts::binds the revised record to its event cursor so the list shows that event time and reason；::returns the bound cursor in the revision write result, equal to the current read；tests/work-graph/A1-architecture-catalog.test.ts 的采纳读取；行为已不存在：HANDOFF 79-1
- **核实理由：** 核心属实：两个写入点都显式写 since 键（catalog-service.ts:525 采纳时写 null，:707 修订时写 null 再由 :741 绑定），合同里也是必填（catalog-contracts.ts:86），测试夹具同样带 since（MVP-ui-entry.test.ts:184）。不过同一个文件 :458-472 内嵌记录的校验也接受缺键，清单里漏了；修订事件实际写进去的是 since:null（catalog-service.ts:715）。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：30

### TQ-075 · P1-102 · allowlist-kept-for · src/core/work-graph/configuration/role-record-codecs.ts:421-428
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** encodeRoleSpecRevisionSnapshot（role-record-codecs.ts:421-428）只在 installRoleSpec 里用（role-memory-service.ts:375），测试里也没有直接调用；它是 readRoleSpec 所读记录唯一的写法，但条目写的第 3 片已结束，跟着 P1-091 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:614。 改法：保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.installRoleSpec; no direct test caller。

### TQ-076 · P1-103 · allowlist-kept-for · src/core/work-graph/configuration/role-record-codecs.ts:429-436
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** encodeProjectRoleSpecActiveSnapshot（role-record-codecs.ts:429-436）只在 activateRoleSpec 里用（role-memory-service.ts:500）；点名的第 3 片已合入、没接 activate，跟着 P1-092 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:620。 改法：保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.activateRoleSpec; no direct test caller。

### TQ-077 · P1-104 · allowlist-kept-for · src/core/work-graph/configuration/role-record-codecs.ts:437-439
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** encodeRoleSpecInstalledEvent（role-record-codecs.ts:437-439）只在 installRoleSpec 里用（role-memory-service.ts:379）；条目点名的第 3 片已结束，跟着 P1-091 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:626。 改法：保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.installRoleSpec; no direct test caller。

### TQ-078 · P1-105 · allowlist-kept-for · src/core/work-graph/configuration/role-record-codecs.ts:440-442
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** encodeRoleSpecActivatedEvent（role-record-codecs.ts:440-442）只在 activateRoleSpec 里用（role-memory-service.ts:504）；点名的第 3 片已结束，跟着 P1-092 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:632。 改法：保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.activateRoleSpec; no direct test caller。

### TQ-079 · P2a-15 · old-data · src/core/work-graph/materials/applicability.ts:97
- **动作：** change:删 MaterialOrigin 的 legacy 变体（record-store/body-ports.ts:9、:15）；body-codec.ts:206-213 中缺 origin 的行改为拒绝（成为 corrupt），:196 并进不支持的 kind；删 materials/applicability.ts:97；删测试 tests/data/R3b-materials-contract.test.ts:63-87、:151-156，删 tests/work-graph/S3-context-inputs.test.ts:874 的 IN18 和夹具的 owner-less 分支 :176、:554-557，并在 slice-3-SPEC.md:683 的 IN18 行注明行为已不存在
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-566（79-1）；当前形状：tests/data/R3b-material-admission-boundaries.test.ts:31::lets a Host read its own newly stored platform artifact but keeps project and workspace scope exact；tests/data/R3b-material-admission-boundaries.test.ts:98::binds a Core work_run owner read to the canonical Run workspace as well as its full Run ref
- **核实理由：** 核心成立：新写入经 body-codec.ts:239 normalizeOrigin 必写正式 origin，:196 拒绝 legacy，只有缺 origin 的旧行由 :206-212 读成 legacy。但只删 applicability.ts:97 一行不算删除，legacy 变体在 body-ports.ts:9 的类型里；另外 S3-context-inputs.test.ts:874 的 IN18（slice-3-SPEC.md:683 的冻结规格行）和 :554-557 的夹具也钉着 legacy origin，原发现漏了，行数也远不止 1 行。
- **涉及测试：** tests/data/R3b-materials-contract.test.ts:63::reopens the original artifacts table and reads legacy first-owner provenance; tests/data/R3b-materials-contract.test.ts:151::does not infer a Host-readable scope from a legacy record without an owner
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：50

### TQ-080 · P1-144 · allowlist-kept-for · src/core/work-graph/model/note-contracts.ts:44
- **动作：** delete：删 note-contracts.ts:44 的 NOTE_BODY_PAGE_MAX_BYTES 和允许清单 :862-867 一条（DSH 写的 allowlist:935 不对）；第 4 片规格 :189 的“最多 4 KiB”和 :518 常量表加后注
- **覆盖/依据：** 行为已不存在：第 4 片已合入，没有 notes 正文路由，正文请求无页大小参数（slice-4-SPEC.md:189、535-538）
- **核实理由：** src/tests 无引用；第 4 片路由表只有 notes/list/write/withdraw/review（slice-4-SPEC.md:535-538），没有 notes 正文路由；正文分页走 lookup/history 的 body:{noteId,version?,cursor}（note-contracts.ts:338、341），请求里没有页大小参数，note-read-model.ts:1182 固定按 2 KiB 切，所以“最多 4 KiB”无处可用，第 6/7/8 片和 E3 也没点名它。Codex 的“仍在冻结规格”只说明要给规格加后注，不构成保留理由。
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：1

### TQ-081 · P1-177 · allowlist-kept-for · src/core/work-graph/model/tool-commit-arguments.ts:181-183
- **动作：** delete：删 tool-commit-arguments.ts:180-183 的 toolCommitLookupNotPublished 和允许清单 :1060-1065 一条；K3-39-tool-commit-lookup.test.ts:20 去掉导入、:72 去掉这一句断言，留下 :73-75 的 unknown_tool 断言并把用例名改成那件事
- **覆盖/依据：** tests/work-graph/K3-39-tool-commit-lookup.test.ts:111（公开分派）；tests/work-graph/K3-39-record-note-lookup.test.ts:94-95
- **核实理由：** 允许清单写的使用方“K3 group 2 wires it”没有兑现：K3 已合入，生产分派 composition/tool-commit-lookup.ts:48 自己写字面量，K3 规格 :1796 引的也是这一行；同一行为由 K3-39-tool-commit-lookup.test.ts:111 和 K3-39-record-note-lookup.test.ts:94-95 经公开分派钉住。Codex 让分派改调它也行为不变，但只为一个字面量给 composition 加一条依赖，按“使用方已不在计划→删”应删；DSH 的行数漏算了测试改动。
- **涉及测试：** tests/work-graph/K3-39-tool-commit-lookup.test.ts:20,72
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：6

### TQ-082 · P1-131 · allowlist-wire-format · src/core/work-graph/persistence/decision-record-codecs.ts:53
- **动作：** delete
- **覆盖/依据：** 当前事件格式由 GOAL_SETTINGS_CHANGED_EVENT 和 DECISION_EVENT_SCHEMA_VERSION 表达（decision-record-codecs.ts:48、50，登记在 :427-441 的 DECISION_RECORD_SCHEMAS）；这个常量在 src、tests、scripts 里都没有引用，删掉不改行为。删除：decision-record-codecs.ts:53（:52 的注释和 P1-132 一起删），以及 production-reach-allowlist.json:784-789 这一条
- **核实理由：** 事件只按 eventType+schemaVersion 写读（event-envelope.ts:4-13 不写 schemaId；DECISION_RECORD_SCHEMAS 在 decision-record-codecs.ts:430-433 用的是 GOAL_SETTINGS_CHANGED_EVENT 和 DECISION_EVENT_SCHEMA_VERSION）。'GoalSettingsChanged@1' 这个字符串从来没写进存储，也没有代码读它，允许清单 :788 说读取方是 DECISION_RECORD_SCHEMAS，这不成立；它不是当前格式，是没人用的常量，应删（src 1–2 行，允许清单 6 行）。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：6

### TQ-083 · P1-132 · allowlist-wire-format · src/core/work-graph/persistence/decision-record-codecs.ts:54
- **动作：** delete
- **覆盖/依据：** 当前事件格式由 WORKSPACE_NOTICE_SEEN_CHANGED_EVENT 和 DECISION_EVENT_SCHEMA_VERSION 表达（decision-record-codecs.ts:49、50、435-438）；删除 decision-record-codecs.ts:54 和 :52 的注释，以及 production-reach-allowlist.json:790-795 这一条
- **核实理由：** 和 P1-131 一样：WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID（decision-record-codecs.ts:54）在 src、tests、scripts 里没有任何引用，事件的写读不带 schemaId（event-envelope.ts:7-13；decision-record-codecs.ts:435-438），这个字符串从未持久化。不是当前格式，应删；2C 的置顶事件也没加同类常量（line-settings-codecs.ts:29）。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：6

### TQ-084 · P2a-12 · old-data · src/core/work-graph/persistence/note-record-codecs.ts:120-123;387-390;612-633
- **动作：** change:noticeClass、actor、proof 三个键必须存在，删掉缺键补 null（删掉 withNoticeClass，note-record-codecs.ts:120-123，同时改它的三个调用点 :472、:584、:612，以及 :389-390、:618-633 的 undefined 分支）；保留显式 null
- **覆盖/依据：** tests/work-graph/S4C2-N1.test.ts::N1 %s: one g1 line with three members and one g2 line with one；tests/work-graph/S4C2-notice-class.test.ts::S4C2-U9 writes the given class and defaults to null（显式 null）；行为已不存在：HANDOFF 79-1
- **核实理由：** 属实：NoteVersion 只由 newNoteVersionRecord 建，它总会写 noticeClass，默认 null（note-machine.ts:294-309）；三处 NoteDispositionChanged 都显式写 actor/proof（note-service.ts:708-710、845-869 先初始化成 null、1542-1544）。事件信封只用 hasOnlyKeys 检查（note-record-codecs.ts:513），所以缺键能通过，这条确实是只为旧数据留的；唯一手写的事件夹具 S4C2-U3.test.ts:63-69 也带这三个键。
- 来源：Codex；核实：confirmed；规格行：否；估计行数：25

### TQ-085 · P1-178 · allowlist-kept-for · src/core/work-graph/state/command-normalization.ts:12-14
- **动作：** delete（lead 定，不交用户）：随 P1-179 一起删 command-normalization.ts:12-14 的 ShellActionsResult 和允许清单 :1066-1071 一条；K3 规格加后注
- **覆盖/依据：** B2-10 解析规则由 parseShellActionsDetailed 保留，tests/state/command-normalization.test.ts 改调 detailed 后覆盖不变
- **核实理由：** 事实属实：ShellActionsResult 只被 parseShellActions（:524）用，测试不导入它；生产三处都调 parseShellActionsDetailed（tasks/command-recognition.ts:60、command-expansion.ts:170、unknown-call-review-service.ts:238），且都要 dirs。允许清单写的“K3 group 4 wires it”没兑现，裁定 5 留这个投影只为“B2-10's cases stay”（k3-g4b-rulings.md:37），属于只为兼容保留的接口；改规格文字归 lead（AGENTS 第 3 条），不是产品决定，不必交用户。
- **涉及测试：** tests/state/command-normalization.test.ts:15,52,62,116
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：3

### TQ-086 · P1-179 · allowlist-kept-for · src/core/work-graph/state/command-normalization.ts:524-529
- **动作：** delete（lead 定，不交用户）：删 command-normalization.ts:520-529 的 parseShellActions 和允许清单 :1072-1077 一条，改 :6、:19、:534 的注释；tests/state/command-normalization.test.ts 的 parsed 助手（:51-58）和直接调用处（:62、:116、:222、:269、:282、:331）改调 parseShellActionsDetailed 并投影成 {words,text}，删只钉“投影不变”的两处（:400-405 的第一句、:435-439）；slice-K3-SPEC.md :465、:1139、:1494（B2-10）、:1841 加后注
- **覆盖/依据：** B2-10 用例改调 parseShellActionsDetailed 后照旧钉住全部解析规则（tests/state/command-normalization.test.ts）
- **核实理由：** 生产不调它，三处都用 detailed 且需要 dirs（command-recognition.ts:60、command-expansion.ts:170、unknown-call-review-service.ts:238）；两者共用 parseLevel，parseShellActions 只是去掉 dirs 的投影（:524-529），留它是为了不改 B2-10 的用例（k3-g4b-rulings.md:37），T 轮正该清这种兼容口。Codex 的 keep 只引规格 :1841 那条裁定，没有其他使用方；B2-10 的用例改指 detailed，不是删除。改规格归 lead，DSH 交用户不合适；DSH 的行数漏了测试改动。
- **涉及测试：** tests/state/command-normalization.test.ts:15,52,62,116,222,269,282,331,401,436
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：28

### TQ-087 · P2a-26 · old-data · src/core/work-graph/tasks/model-call-contracts.ts:43-55; tasks/model-request-codecs.ts:11
- **动作：** change: make requestId/requestDigest/contextInputDigest/manifestDigest required in ModelRequestPermitV1 (model-call-contracts.ts:50-53) and in modelRequestPermitProblem (model-request-codecs.ts:93-96); delete the historical-permit notes (model-call-contracts.ts:43-45, model-request-codecs.ts:11-12)
- **覆盖/依据：** tests/work-graph/B2-model-request.test.ts:56 (issuance pins all four and denies substitution)
- **核实理由：** 只有 model-call-service.ts:144-149 写许可，四个字段都写；消费时 model-call-service.ts:245-248 逐个和 actual 比对，缺字段的许可本来就会被拒，所以改成必填行为不变，也没有测试构造缺字段的许可。
- **涉及测试：** tests/work-graph/B2-model-request.test.ts
- 来源：DSH；核实：confirmed；规格行：是；估计行数：10
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：字段范围 50-53 错位；manifestDigest 实际在 src/core/work-graph/tasks/model-call-contracts.ts:54。 改法：字段修改范围改为 model-call-contracts.ts:51-54，仅将四个点名字段改为必填。

### TQ-088 · P2a-05 · old-data · src/core/work-graph/tasks/session-facts.ts:417-440;467-477
- **动作：** delete：删 session-facts.ts:417-440 的指针补充合并和 :464-470 的指针例外，连同游标的 pointerDone 字段 :68-69、:88；保留 pending、还没 claim 的 QueryRun 不带 executionState 的读法；删 SV53。
- **覆盖/依据：** tests/work-graph/S1-session-facts.test.ts:62::SV06 a real newer Query pointer does not hide the previous Work wait；旧格式由 HANDOFF 79-1 撤销
- **核实理由：** 属实：Query claim（query-execution.ts:983-1002）在同一批里写带 executionState 的 QueryRun（query-run-recovery.ts:519-538）和占用它的 Session，lastExecutionRef 只在占用或释放时写（session-availability.ts:364、390）。Session 指针指向一个没有 executionState 的 QueryRun，只能像 SV53 那样用 overwriteSession 手改出来（S1-session-facts.test.ts:181）。
- **涉及测试：** tests/work-graph/S1-session-facts.test.ts:172::SV53
- 来源：Codex；核实：confirmed；规格行：是；估计行数：50
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除范围包含当前作用域和 Session 校验，且指针分页变量还有剩余引用；见 src/core/work-graph/tasks/session-facts.ts:443、:453、:464、:469、:476。 改法：保留作用域校验，将归属判断改为 !sessionMatch；只删除指针豁免和全部指针游标逻辑，直接按索引 keys 与分页结果读取、推进，保留缺记录和损坏记录拒绝。

### TQ-089 · P1-106 · allowlist-kept-for · src/core/workspace/role-source-reader.ts:45-131
- **动作：** delete:删 src/core/workspace/role-source-reader.ts 和 src/contracts/role-material-channels.ts（RoleSourceIndexRequestV1/EntryV1/ExcerptV1/ResultV1/Port 五个只被它用的契约），以及白名单 6 条（383-411、634-639）；测试删 tests/data/workspace-path-boundary.test.ts:15、65-105 并改文件头，保留 :57-63 的拒绝前缀测试；改 IMPLEMENTED-CAPABILITIES.md:298
- **覆盖/依据：** 拒绝前缀仍由 workspace-path-boundary.test.ts:57-63 钉；角色必读 code 材料照旧按 execution-preparation.ts:415-418 回 unsupported（行为不变）
- **核实理由：** 白名单写的使用方是第 3 片，第 3 片已合入，而且明说不支持角色必读 code 材料（slice-3-SPEC.md:492；生产 execution-preparation.ts:415-418 仍回 unsupported）。6/7/8/E3 规格没有接角色 code 通道的计划；决定 6 留角色规格是给 7C 的“按含义挑成员”（slice-7-SPEC.md:37），用不到这个有界源码读取，只有 workspace-path-boundary.test.ts 在用它。lead 若认为决定 6 也包括这个缺口，就得改白名单说明，但写不出是哪一片。
- **涉及测试：** tests/data/workspace-path-boundary.test.ts:15,65-105
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：45

### TQ-090 · P2b-04 · old-data · src/ui/state/display-preference.ts:14-16,106-137
- **动作：** change（不是整段删）：删 display-preference.ts:14-16 的 DISPLAY_PREFERENCE_V1_KEY、106-111 的 readLegacy、loadIds 119-124 的迁移（缺记录直接回空）、readGlobal 131-137 的迁移（缺记录回空的全局值）；127-130 当前 v2 全局读取保留；删 src/ui/main.ts:64 对 V1 键的导出；测试删 MVP-ui-entry.test.ts:261-273、改 :31 的导入，并把 :239 的测试名里“migrates only the explicit v1 scopeKey”去掉
- **覆盖/依据：** 旧 v1 读取依 docs/refactor/HANDOFF.md:566 退役；当前行为：tests/app/MVP-ui-entry.test.ts:239 的 243-259 段（按 scope 分存、全局单独）和 :276（恢复）
- **核实理由：** 成立：src 里没有写 v1 键的代码（只在 display-preference.ts:16、108 读，main.ts:64 导出），save/writeGlobal 只写 v2（143、149）。但 106-137 这个范围里有 readGlobal 的当前 v2 读取（127-130），照字面 delete 会删掉当前行为；另外漏了 main.ts:64 的导出和测试 :31 的导入。
- **涉及测试：** tests/app/MVP-ui-entry.test.ts:239::keeps display ids per scope and migrates only explicit v1 scopeKey
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：35

### TQ-091 · P2b-20 · old-data · src/ui/views/graphs/architecture.ts:28-31,102; node-link.ts:138-150; setup/panels.ts:92
- **动作：** change: ArchitectureRevision.catalog 改非空（catalog-contracts.ts:93），readCatalogBesideBaseline 缺目录行读作 unavailable（catalog-service.ts:417-421），删 :325 的条件、:409 的可选 guard、:655-657 的“早于目录不能修订”拒绝；简化来自 revision.catalog 的空分支（attention-observer.ts:696、auto-capture-driver.ts:214、architecture-reminder-facts.ts:35、architecture-service.ts:1026,1548,1716,1733、catalog-service.ts:820、note-anchors.ts:182,452,459、note-related-scope.ts:309、scribe-scope.ts:153、goal-conflicts.ts:374、graph-context-reader.ts:798,1635、node-detail-reader.ts:726、note-views.ts:654,777,781,868、ui planning.ts:61）和 UI 三处（architecture.ts:28-31,102；node-link.ts:138,149-150；panels.ts:92）；删 A1-architecture-catalog.test.ts:169 用例，:190 和 A1-independent-review.test.ts:66 的起始状态改走 adoptInitialArchitecture，删 graph-session-fixture.ts:123-127,403 起的 seedLegacyArchitectureBaseline
- **覆盖/依据：** 行为已不存在：基线只由 catalog-service.ts:550-552（采用）和 :732-734（修订）写，都在同一提交里写目录
- **核实理由：** 核心属实：两个基线 writer 都把 baseline 和 catalog 写在同一次提交，catalog 为 null 只来自早于目录的旧基线或篡改；但只删 UI 三处做不到，ArchitectureRevision.catalog 的类型仍可空（catalog-contracts.ts:93），核心约 20 处读者都分支处理，两个测试还用旧基线夹具当起始状态。
- **涉及测试：** tests/work-graph/A1-architecture-catalog.test.ts:169; tests/work-graph/A1-independent-review.test.ts:64
- 来源：DSH；核实：partly；规格行：否；估计行数：80
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：当前指针读取器及 CurrentCatalogWindow 仍允许 catalog:null；见 src/core/work-graph/architecture/catalog-service.ts:358、:396、:411、:781。 改法：同时收窄 CurrentCatalogWindow；当前读取缺目录行返回 unavailable，成功必须包含解码后的 catalog 和无条件 catalog guard；历史读取成功类型同步收窄。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：architecture-service.ts:1548 处理当前未采用架构的合法输入；真实调用见 src/composition/architecture-reminder-facts.ts:28。 改法：从简化清单删除 architecture-service.ts:1548，保留 catalog 为 null 时的空 findings 行为。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：architecture-service.ts:1716 是公开 catalog pin 输入校验，不是旧 revision 分支。 改法：从简化清单删除 architecture-service.ts:1716，保留该拒绝及其检查顺序。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：123-127 删除范围侵入 createSession 声明；见 tests/helpers/graph-session-fixture.ts:123、:124。 改法：接口处只删除 125-127，保留完整 createSession 声明；旧 helper 实现和返回成员按原点名位置删除。

### TQ-092 · P1-187 · c1-transfer · tests/kernel/RL-12-15-conditions.test.ts:360,403
- **动作：** change：tests/kernel/RL-12-15-conditions.test.ts:360 和 :403 的下界 10_000 → 9_900，上界 12_000 不变
- **覆盖/依据：** —
- **核实理由：** 死线是 process-sandbox.js:2050 的 setTimeout(10_000)，和测试 :351/:397 的 startedAt 在同一个同步段里，Node 计时器按 libuv 缓存的毫秒级循环时间起算，会比 performance.now() 早触发，早多少随负载变大，实测缺 0.09 ms（C1 lead-acceptance.md:88）。下界只需和其他停点分开，最近的另一个是 :630 金丝雀的 5 秒，(a) 还有 :358 的“探测超过 10 秒”文字直接证明是死线，所以 9_900 一样能证明 10 秒死线赢了，余量更足；Codex 的 9_990 也对，但在高负载全量下余量偏小。
- **涉及测试：** RL-15b (a) a hanging systemd-run --version stops at the 10 s deadline and reports probe_failed; RL-15b (b) a bwrap whose --version hangs ends as probe_failed, not sandbox_unavailable
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：是；估计行数：2

### TQ-093 · E1-01 · stale · tests/app/MVP-ui-entry.test.ts:['261-273']
- **动作：** delete（连同生产 src/ui/state/display-preference.ts:14-16,106-111,119-124,131-137 的 v1 迁移和 src/ui/main.ts:64 的导出一起删；测试名、220-225 注释和第 31 行导入同步改）
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-566（79-1 只读当前格式、不写迁移）；当前格式部分仍由 tests/app/MVP-ui-entry.test.ts:239-259 断言
- **核实理由：** 261-273 只测 v1 单记录迁移；grep 全仓库，DISPLAY_PREFERENCE_V1_KEY 只在 display-preference.ts:16/108 读取和 main.ts:64 导出，没有任何当前代码写这个键，属 79-1 要去掉的旧格式读取。MVP-BEHAVIOR.md 没有这条行为。
- **涉及测试：** keeps display ids per scope and migrates only the explicit v1 scopeKey
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：15

### TQ-094 · E2-04 · tamper · tests/data/R3b-body-boundaries.test.ts:[[44, 65]]
- **动作：** delete
- **覆盖/依据：** 行为不应存在：AGENTS 规则 4；79-4 分类 5
- **核实理由：** 键就是 contentType|digest|sizeBytes（body-codec.ts:144-146），sameArtifactRef 也只比这三项（src/contracts/material-access.ts:86-88）。两个真实的 ArtifactBodyRows（body-store.ts:71-79 的 Map、sqlite-body-store.ts:34-46）都按 encode 得到的 ref 算键再存，所以 body-store.ts:43-45,54-56 只有改了表里的 key，或者像测试那样用替身，才会走到。只为篡改的测试本来就不需要替代覆盖，Codex 留着它的理由不成立。
- **涉及测试：** rejects a valid body row stored or returned under a different content key
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：否；估计行数：23

### TQ-095 · E2-05 · tamper · tests/data/R3b-body-boundaries.test.ts:[[67, 77]]
- **动作：** delete
- **覆盖/依据：** 行为不应存在：AGENTS 规则 4；79-4 分类 5
- **核实理由：** encode 用 normalizeOrigin 同时得出 origin 和 ownerRunRef，一起写进去（body-codec.ts:163-170,244,250），两者不可能不一致，所以 decodeOrigin 的不一致检查（body-codec.ts:215-217）只有手工造行才能到。兼容字段 ownerRunRef 删不删，不影响这条测试是只为篡改；字段删掉，这个检查也就跟着没了。
- **涉及测试：** rejects a row that claims two conflicting owner authorities
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：否；估计行数：11

### TQ-096 · E2-37 · tamper · tests/data/R3b-body-boundaries.test.ts:79-96
- **动作：** delete
- **覆盖/依据：** 行为不应存在：79-1（旧库重建、不写迁移）+ AGENTS 规则 4；79-4 分类 5
- **核实理由：** artifacts.sqlite 是单独一个文件（src/composition/create-platform.ts:684-685），只有 sqlite-body-store.ts:81 建它，表结构一直是 (key, record)，连旧表也是这样（R3b-materials-contract.test.ts:67）。所以 prepare 失败、走 sqlite-body-store.ts:58-65 关闭连接，只会发生在外来的或被改过的表上。
- **涉及测试：** closes a newly opened SQLite connection when the existing artifacts schema cannot be prepared
- 来源：DSH；核实：confirmed；规格行：否；估计行数：18

### TQ-097 · E2-01 · stale · tests/data/R3b-materials-contract.test.ts:[[63, 86]]
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-566（79-1）；当前唯一写入 encodeArtifactBodyRow 总写 origin（body-codec.ts:247，写入点只有 body-store.ts:39），旧行只能手插。SQLite 首写者胜出与重开读回由 tests/record-store/R3b-body-concurrency.test.ts:60-96::two real SQLite processes preserve one first owner/source and one content ref after concurrent puts 覆盖
- **核实理由：** 测试 72-73 行手插缺 origin 的旧行，只走 body-codec.ts:206-212 的旧格式分支；SQLite 重开和重放已有并发测试覆盖。删时要同步删生产的 legacy 分支（body-codec.ts:206-212、body-ports.ts:9、applicability.ts:97），而 slice-3-SPEC.md:683 的 IN18（S3-context-inputs.test.ts:874）也钉着 legacy，要 lead 一起处理。
- **涉及测试：** reopens the original artifacts table and reads legacy first-owner provenance
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：24

### TQ-098 · E2-02 · stale · tests/data/R3b-materials-contract.test.ts:[[151, 156]]
- **动作：** delete（与生产 legacy 分支和 IN18 一起处理）
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-566（79-1）。当前写入方只写 Run/QueryRun 或 platform_operation 来源（create-platform.ts:2021、execution-preparation.ts:180/573、query-preparation.ts:373、material-service.ts:151-153、architecture-service.ts:1169/1180），没有写入方产生无 owner 的正文。132-141 那条测试走 applicability.ts:75 和上下文不符检查，不走 applicability.ts:59-60，不能算覆盖
- **核实理由：** 152 行的 legacy/ownerRunRef=null 来源只能由旧行解码产生（body-codec.ts:208），删除成立；但原 covered_by 说 132-141 覆盖，这不对，它不走 owner===null 分支（applicability.ts:59-60）。同一行为在规格行 IN18（slice-3-SPEC.md:683）也有测试，要一起裁定。
- **涉及测试：** does not infer a Host-readable scope from a legacy record without an owner
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：6

### TQ-099 · E2-06 · tamper · tests/data/R3b-materials-contract.test.ts:[[92, 105]]
- **动作：** delete（整条 88-108；前半要和生产的 legacy 来源一起删）
- **覆盖/依据：** 前半（89-91）：79-1，legacy 来源只为读没有 origin 的旧行（src/core/record-store/body-codec.ts:206-213），当前写入方一定写 origin（body-codec.ts:250），拒绝伪造（body-codec.ts:196、body-ports.ts:9,15）随 legacy 分支一起去掉；后半（92-107）：AGENTS 4，只有在库外 UPDATE 才会出现摘要不符
- **核实理由：** 后半只有改 SQLite 文件才能让正文和摘要对不上：encode 从正文算摘要（body-codec.ts:244-250），按摘要键 INSERT ON CONFLICT DO NOTHING（sqlite-body-store.ts:29），写进去的还是没有 origin 的旧形状，所以是只为篡改。前半不是只为篡改：put 是内部端口，真实写入在 material-service.ts:274-291 就只放行 platform_operation/execution，测试还要 as unknown as 才能传进去；它是 79-1 要删的 legacy 来源附带的检查，类别应是过时，而且要和生产代码一起删。Codex 说 90-91 是公开输入边界，这不成立；说摘要不符不一定是篡改，也没有给出别的触发路径。
- **涉及测试：** rejects newly forged legacy origins and reports damaged SQLite bodies as corrupt [SQLite corruption portion]
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：否；估计行数：21
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：88-108 包含外层 describe 的结束括号；见 tests/data/R3b-materials-contract.test.ts:107。 改法：只删除 88-106，保留 107 行外层结束括号。

### TQ-100 · F-20 · stale · tests/helpers/SP-storage-migration-fixture.ts:1-31
- **动作：** delete：现在就删 tests/helpers/SP-storage-migration-fixture.ts:1-31，以及 SP-text-scan.test.ts:16 的 import 和 :400-435 的 SP-12；生产里 sqlite-text-scan.ts:54-60、:135-160 的旧 FTS drop 按 79-1 另在 P 区删，两边没有先后依赖
- **覆盖/依据：** 行为已不存在：src 里没有任何代码建 next_fts_*，只有 drop 用的查询 sqlite-text-scan.ts:59-60（HANDOFF.md:565-570 决定 79-1）；当前扫描由 SP-text-scan.test.ts 其余 SP 用例覆盖
- **核实理由：** 旧格式这一判断成立：生产不建 next_fts_*，SP-12 不是 slices/*-SPEC.md 的冻结行，只是提速一轮任务书里的用例。SP-12 只拿旧文件和普通文件的检索结果比（SP-text-scan.test.ts:424-430），不看旧表删没删，把 drop 去掉它照样通过，也就钉不住生产 drop，没必要等生产一起删；Codex 说现在就删是对的。行数要算上 SP-12 本身约 36 行。
- **涉及测试：** addLegacyFtsArtifacts; SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：68

### TQ-101 · F-23 · stale · tests/helpers/graph-session-fixture.ts:403-417
- **动作：** 先把两处不是测旧格式的借用点改走公开步骤：A1-architecture-catalog.test.ts:190 改用 fixture.adopt，A1-independent-review.test.ts:66 改用 adoptInitialArchitecture，它在 :69-86 竞争里手写的无 catalog baseline 改用 reviseArchitectureCatalog（catalog-service.ts:591）；然后删 graph-session-fixture.ts:403-417（连同 :127、:511）和 A1-architecture-catalog.test.ts:169-177。最好和生产 catalog:null 读法（catalog-service.ts:395-405、:414-420）同批去掉
- **覆盖/依据：** 行为属旧格式：baseline 只有 catalog-service.ts:551 和 :733 两处写，每次都和 catalog 同一提交写入，没有不带 catalog 的写法；当前读取由 A1-architecture-catalog.test.ts:195-207 覆盖
- **核实理由：** 旧格式这一判断成立。但 seedLegacyArchitectureBaseline 有三处调用，只有 :171 测 catalog:null；:190 和 A1-independent-review.test.ts:66 只是借它当正常前提。DSH 没指出这一点，只写了“同批决定”；Codex 点明要先迁这两处，更完整。这一项不是规格行，按 79-1 可以删。
- **涉及测试：** seedLegacyArchitectureBaseline; reads a historical baseline as catalog:null instead of guessing an empty catalog
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：30

### TQ-102 · F-30 · handwritten · tests/helpers/graph-session-fixture.ts:322-351
- **动作：** convert:createProject→registerWorkspace→installCompletionPolicy→activateCompletionPolicy
- **覆盖/依据：** 保留 A1 场景，尤其是初始化时还没有 baseline 这个前提；fixture 的 schemas 要加上 PROJECT_BOOTSTRAP_RECORD_SCHEMAS
- **核实理由：** 这几个公开步骤都在：project-bootstrap-service.ts:528、:601、:699、:812，路由在 core-routes.ts:1052-1055。它们写出的结果和现在手写的一样：Project 和 Workspace 都是 revision 1（:574、:669），注册 Workspace 和装策略只做守卫、不改 Project；现在用的策略内容能通过 completionPolicyContentProblem（project-bootstrap-record-codecs.ts:146-163）。spy 是在初始化之后才包上的（graph-session-fixture.ts:355），使用方也没有写死的游标值。
- **涉及测试：** createGraphSessionFixture scope/policy bootstrap
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：30

### TQ-103 · F-31 · handwritten · tests/helpers/graph-session-fixture.ts:433-469
- **动作：** convert:adoptInitialArchitecture（只在 seedAcceptedTask 里先调 f.adopt）→createGoal→proposePlan→applyPlanChange
- **覆盖/依据：** 保留 A1-session-lifecycle.test.ts:77-87、:132-155、:252-285，A1-session-independent.test.ts:26、:55、:86、:117，A1-independent-review.test.ts:22-62 的行为；这些调用方之后都不会再调 adopt
- **核实理由：** Codex 给的链条缺一步：applyPlanChange 要读当前激活的架构基线，没有时 resolveGovernance 直接返回 incomplete（plan-readers.ts:824-826），快照里的 pin 也不能为空（plan-commit-compiler.ts:133、:146）。而这个 fixture 初始化时没有基线（F-30 也要求保持这一点）。Codex 举的公开示例 task-claim-fixture.ts:274-310 本身也靠 :198-216 手写的基线。所以要在 seedAcceptedTask 里先做一次公开的 adopt。
- **涉及测试：** seedAcceptedTask; archive rejects occupancy and an unresolved responsible Task obligation
- 来源：Codex；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：直接把手写 Plan 改成 draft 后交 proposePlan 接受仍违反 F1；原状态见 tests/helpers/graph-session-fixture.ts:443、:464，规则表:57。 改法：暂标 BLOCKED；保留 seedAcceptedTask 内先 adopt 的要求，先冻结真实 Workflow 与脚本模型生产计划提议的入口，禁止直接接受测试构造的 draft。

### TQ-104 · F-32 · handwritten · tests/helpers/graph-session-fixture.ts:472-481
- **动作：** convert:claimTask（会占用 Session，并自动打开 responsible 链接）→submitControl 取消还没进入的 Run，借此释放 Session；A1-session-lifecycle.test.ts:143-145 单独开链接那一步要按真实流程改写
- **覆盖/依据：** 保留 A1-session-lifecycle.test.ts:132-155 的 busy、责任阻止归档、成功归档三处断言；overwriteSession（graph-session-fixture.ts:134、:472-482、:514）只有这一个测试用，可以一起删
- **核实理由：** 公开步骤是有的：claimTask 会写 occupancy（session-availability.ts:347-366），submitControl 取消没进入的 Run 会释放 Session（control-service.ts:587、:349，session-availability.ts:808-818）。但 claimTask 自己会打开 responsible 链接（claim-service.ts:1007-1036），这样 :143-145 那一步（先单独开链接，再断言 committed）就和真实流程对不上。整个测试要重排，改动比 helper 的 10 行多。
- **涉及测试：** overwriteSession; archive rejects occupancy and an unresolved responsible Task obligation
- 来源：Codex；核实：partly；规格行：否；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：claim 只有显式 openResponsibleLink:true 才开责任链接；见 src/core/work-graph/tasks/claim-service.ts:1040、:1227。 改法：claim 不传 openResponsibleLink，断言 busy 后取消未进入的 Run，保留原单独开链接和归档断言；夹具登记 CONTROL_RECORD_SCHEMAS 并使用真实 control owner，然后删除 overwriteSession。

### TQ-105 · F-49 · tamper · tests/helpers/graph-session-fixture.ts:419-431
- **动作：** delete（seedTamperedArchitectureBaseline 及接口/导出行；删 A1-session-lifecycle 的 digest-inconsistent 用例；混合用例删篡改段，其 healthy 段也删或改用 fixture.adopt，只留 not_found 断言）
- **覆盖/依据：** 只为篡改：基线只由 catalog-service.ts:519-522、700-704 按 architectureBaselineDigest 写入，摘要不符只能靠改库造出（catalog-record-codecs.ts:219-223）；混合用例的 ready 段已由 A1-architecture-catalog.test.ts:59-63（真实 adopt 后 readRevision ready）覆盖，且它用的 seedLegacyArchitectureBaseline 是无 catalog 的旧基线（79-1 候选）
- **核实理由：** 篡改性质成立：读取时摘要不符返回 null 再映射为 unavailable（catalog-record-codecs.ts:223，catalog-service.ts:441），生产写入方都现算摘要（catalog-service.ts:519、700）。但行数只算了辅助函数 13 行，漏了接口行 graph-session-fixture.ts:130、导出行 512、A1-session-lifecycle.test.ts:112-120 整条用例和 A1-architecture-catalog.test.ts:184-187，合计约 28 行；保留的 healthy 段（189-192）依赖旧格式 seedLegacyArchitectureBaseline，且与 59-63 重复。
- **涉及测试：** seedTamperedArchitectureBaseline; refuses to follow a digest-inconsistent catalog record; distinguishes a missing pointer, a digest-inconsistent record and a readable revision
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：28
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：healthy 分支可删可留的动作有歧义，并与 TQ-110 冲突；见 .lead-ref/books/t-items-TQ.md:657、:693。 改法：统一按 TQ-110 保留缺指针和 healthy 分支，将 healthy seed 改为 adopt，只删篡改段及专用篡改用例。

### TQ-106 · F-47 · helper · tests/helpers/graph-session-fixture.ts:61、65、83、89
- **动作：** delete:去掉 tests/helpers/graph-session-fixture.ts:61、65、83、89 的 4 处 export 关键字（声明保留）
- **覆盖/依据：** 同文件内部使用（:97、:131、:139、:257、:336-445、:484）；无外部消费者
- **核实理由：** graph-session-fixture.ts:61 GRAPH_FIXTURE_AT、:65 GraphFixtureKind、:83 GraphAcceptedTask、:89 GraphSessionConnection 在其它 tests/src 文件 grep -w 0 命中，只在本文件 :97/:131/:139/:257/:336/:433/:484 内部用（入口实际叫 createGraphSessionFixture，不影响结论）。
- **涉及测试：** A1 测试只取 openGraphSessionFixture 等入口
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：涉及测试中的 openGraphSessionFixture 不存在；真实入口见 tests/helpers/graph-session-fixture.ts:257。 改法：将入口名称改为 createGraphSessionFixture，四处删除 export 的动作保留。

### TQ-107 · D-16 · stale · tests/record-store/SP-text-scan.test.ts:['400-435']
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:566（79-1 代码只读当前格式，开发时旧版本写的库重建，不写迁移）
- **核实理由：** SP-12 只测 4B 时代带 next_fts_* 虚表和 next_fts_meta 的旧库打开后结果正确（SP-text-scan.test.ts:414-429）；src 里没有任何代码再建 FTS 表（Grep CREATE VIRTUAL/fts5 只命中 sqlite-text-scan.ts:57-60 的删除用 SQL），属于纯旧库兼容。删后 16 行的 import 和 tests/helpers/SP-storage-migration-fixture.ts:15 无人使用，生产端 sqlite-text-scan.ts:13-15、55-60、137-148 的旧表删除也应交 P 区一并去掉。
- **涉及测试：** SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：36

### TQ-108 · D-22 · duplicate · tests/state/command-normalization.test.ts:['268-271']
- **动作：** merge-into:tests/state/command-normalization.test.ts::B2-10 returns unparsed beyond three nested shell -c levels
- **覆盖/依据：** tests/state/command-normalization.test.ts:325-327::B2-10 returns unparsed beyond three nested shell -c levels（经 unparsedFor :281-285 断言 unparsed 和非空 reason）
- **核实理由：** command-normalization.test.ts:268-271 和 :325-327 输入都是 nestShell(4, 'tool a')；前者只断言 status 是 unparsed，后者另外还断言 reason 非空，前者断言的东西后者都断言了。两个都用 B2-10 这个行号，删掉前者后这一行仍有测试。
- **涉及测试：** B2-10 returns unparsed at the fourth level
- 来源：Codex；核实：confirmed；规格行：是；估计行数：4

### TQ-109 · A1-01 · stale · tests/work-graph/A1-architecture-catalog.test.ts:169-177
- **动作：** delete
- **覆盖/依据：** 行为已不存在：HANDOFF.md:565-570（79-1）；当前采用与读取由 tests/work-graph/A1-architecture-catalog.test.ts:41-64 覆盖
- **核实理由：** 生产里只有 catalog-service.ts:551-553（采用）和 :733-735（修订）写 baseline，两处都在同一提交里写 catalog；没有 catalog 的 baseline 只能来自旧格式夹具 graph-session-fixture.ts:403-415，属 79-1 要去掉的旧格式兼容（catalog-service.ts:414-420 的 null 分支可交 P 区）。
- **涉及测试：** reads a historical baseline as catalog:null instead of guessing an empty catalog
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：9

### TQ-110 · A1-49 · tamper · tests/work-graph/A1-architecture-catalog.test.ts:184-187
- **动作：** delete（A1-architecture-catalog.test.ts:184-187 与 A1-session-lifecycle.test.ts:112-120；同文件 190 行的健康 seed 改为公开 adopt；之后 seedTamperedArchitectureBaseline 无人使用可一并删）
- **覆盖/依据：** 只为篡改：AGENTS.md 第 4 条；保留 181-182（缺指针 not_found）与 189-193（改 adopt 后的可读分支）
- **核实理由：** 摘要只由 catalog-service.ts:519 用 architectureBaselineDigest 算出后写入，读取时 catalog-record-codecs.ts:219-223 复核；摘要与正文不符只能由 graph-session-fixture.ts:419-428 这类直接改库造出，没有真实边界输入能到达。
- **涉及测试：** distinguishes a missing pointer, a digest-inconsistent record and a readable revision; refuses to follow a digest-inconsistent catalog record
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：13

### TQ-111 · A1-26 · handwritten · tests/work-graph/A1-independent-review.test.ts:32-51;66-86
- **动作：** convert（只限 66-95）：adoptInitialArchitecture → 在 readMany 钩子里调用 reviseArchitectureCatalog 推进指针，成功分支改断言当前 catalog；22-62 段改为 keep-note：没有公开步骤
- **覆盖/依据：** 保留 53-61 与 90-94 的业务断言；22-62 段的“Plan 删掉 Task 后关闭关联”由 lead 裁定（状态只能手写造出）
- **核实理由：** 第二段可转：catalog-service.ts:591 的 reviseArchitectureCatalog 能产生同样的指针前移，且能顺带去掉 66 行的旧格式 baseline。第一段不能转：公开 Plan 变更不允许物理删除 Task（plan-validation.ts:336-339 返回 unsupported，plan-service.ts:2947-2954 据此拒绝），activePlanRevision 只在建 Goal 时为 null，所以“当前 Plan 不含该 Task”没有公开步骤能造出。
- **涉及测试：** can explicitly close an old Task relation after the active Plan removes that Task; rechecks a current catalog pointer that changes between pointer and revision reads
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：24
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：keep-note 保留直接改库的不可达 Plan 状态；见 tests/work-graph/A1-independent-review.test.ts:48、src/core/work-graph/tasks/plan-validation.ts:336。 改法：22-62 子项改为 BLOCKED，不计完成；66-95 的 adopt/revise 竞争转换单独继续。

### TQ-112 · A1-27 · handwritten · tests/work-graph/A1-session-lifecycle.test.ts:137-142
- **动作：** convert：用 claimTask（照本文件 259-267 的写法，不设 openResponsibleLink）占用 Session 得到 busy；“未了结的 responsible 义务”那半改用另一个空闲 Session，或整条改用 B2 夹具 enter → recordRunResult 清空占用（graph-session 夹具没有 Runtime 入口）
- **覆盖/依据：** 保留 139-140、143-154 的断言；终态入口参考 tests/work-graph/B2-execution-result.test.ts:35-48
- **核实理由：** 核心属实：137-138、142 用 overwriteSession（graph-session-fixture.ts:472-481，commitRaw）手写占用，claim-service.ts:1217-1226 的 claimTask 是公开的占用步骤。但 graph-session 夹具没有 recordRunResult/enter（grep 无匹配），按原建议走 recordRunResult 要换夹具，改动行数远不止 6 行。
- **涉及测试：** archive rejects occupancy and an unresolved responsible Task obligation
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：动作给出不同实现并含 F3 禁止的 B2 手写终态路径；见 .lead-ref/books/t-items-TQ.md:706、规则表:64、:66。 改法：统一采用修正后的 TQ-104：同一 Session，不带 openResponsibleLink 的 claim、busy、取消未进入 Run、原责任链接和归档步骤；删除其余方案。

### TQ-113 · A1-13 · stale · tests/work-graph/S1-session-facts.test.ts:172-189
- **动作：** delete（连同只为它的 encodeQueryRunSnapshotRecord、QueryRunRef/QueryRunSnapshot 导入）；生产 src/core/work-graph/tasks/session-facts.ts:417-440 的 lastExecutionRef 指针补充定位应同批去掉
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）；Work wait 部分由同文件 62-75::SV06 断言
- **核实理由：** 175-181 手写无 executionState 的 QueryRun 并用 overwriteSession 改指针；今天唯一写 lastExecutionRef 的占用（session-availability.ts:364）由 claimQuery 在同一提交写 executionState（query-execution.ts:897、983），所以“指针指向无 executionState 的 QueryRun”只来自旧数据；SV06（62-75）同样断言 latestWork 和 wait。
- **涉及测试：** SV53 an old Query pointer without executionState locates one Query and preserves the Work wait
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：20

### TQ-114 · A2-24 · handwritten · tests/work-graph/S3-context-inputs.test.ts:471-490,501-502
- **动作：** convert:runA/runB 走真实的 claimTask→authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered→recordRunResult（要把夹具换到带 Session/claim/entry 的 B2/S2B 夹具上）；IN04 的 w2 owner Run 和 IN14 的 msg-1 消息继续手写（没有公开步骤）
- **覆盖/依据：** 原 IN 断言保留；公开执行示例 tests/helpers/S2B-activity-fixture.ts:455-513；IN04、IN14 的事实没有同状态的公开步骤
- **核实理由：** 公开步骤确实有，但 IN04 要 tA 的 Run 落在 w2（S3-context-inputs.test.ts:482-487、712），真实 claim 只会建在 Goal 所在的 w 里；IN14 要 messageId 正好等于计划里的决定标签 msg-1（context-input-service.ts:632-635），而 sendMessage 的 id 是按 requestId 算出来的哈希（mailbox-service.ts:747-750、2139），造不出同样的状态。另外这个夹具的 schema 里没有 Session/claim（S3-context-inputs.test.ts:260-274），改造量比 35 行大。
- **涉及测试：** IN系列共享Run事实; IN14 a decision with only a reply and no application is missing
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：80
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：所引 S2B 入口手写 entered 和终态 observation；见 tests/helpers/S2B-activity-fixture.ts:471、:501、:508。 改法：使用真实 Host/Workflow 调度脚本模型，由 Runtime 写执行事实；禁止测试直接写 entered 和终态 observation，具体合规共享入口冻结前标 BLOCKED。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：漏掉 runA2，且 runB 原目标是 starting，不能同样执行到终态；见 tests/work-graph/S3-context-inputs.test.ts:484、:486、:489。 改法：明确 runA、runA2 真实执行结束；runB 只真实 claim 并保持 starting；删除三条 Run 的 raw seed。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：IN04 明确保留手写跨工作区 Run；见 tests/work-graph/S3-context-inputs.test.ts:482、:485、:712。 改法：IN04 标 BLOCKED，删除继续手写的授权，等待 lead 冻结允许的前置状态。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：IN14 保留手写 Message，并从 store 读取断言状态；见 tests/work-graph/S3-context-inputs.test.ts:501、:606、:827。 改法：IN14 标 BLOCKED；放行前冻结真实发送、回复、决策标签关联和公开消息读取步骤，禁止保留手写 Message。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换仍依赖 raw scope/governance seed；见 tests/work-graph/S3-context-inputs.test.ts:321、:329。 改法：把公开项目和两个 Workspace 登记、策略安装激活、架构采用纳入转换，替换 raw 初始化并承接真实版本 pin。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：材料前置直接写 raw body store；见 tests/work-graph/S3-context-inputs.test.ts:401、:405。 改法：在真实 owner 存在后经 materials.storeArtifact 写 old-A 和 new-A；缺正文用例不写 old-A，删除前置 rawBodies.put。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：Plan 前置直接接受测试构造的 draft；见 tests/work-graph/S3-context-inputs.test.ts:432、:458。 改法：将 Plan 前置纳入真实 Workflow 与脚本模型转换链；禁止直接接受手写 PlanRevisionDraft，入口冻结前保持 BLOCKED。

### TQ-115 · A2-25 · handwritten · tests/work-graph/S3-context-inputs.test.ts:337-388,494-499
- **动作：** IN11：convert:openVerification→beginCheck→recordCheckResult→finalizeChecks（等 A2-24 换成真实的 runA 之后）；IN12：keep-note
- **覆盖/依据：** IN12 暂保留 tests/work-graph/S3-context-inputs.test.ts:799::IN12；同一 subject 只有一条链、reverifyRound 只接 finalized non-PASS 链头（evidence-service.ts:19-25；evidence-contracts.ts:155-167），跨 Run 再开轮次对 gate 也行不通，lead 只能定退役，或者改写成 FAIL→reverify→FAIL 链
- **核实理由：** IN12 那条 PASS→FAIL 链确实没有任何公开步骤能造出来，这条说明是准的；但 IN11 只要一个没有前驱的 finalized PASS 轮次（S3-context-inputs.test.ts:375、495），这个靠公开的 openVerification/beginCheck/recordCheckResult/finalizeChecks 就能造（evidence-contracts.ts:111、168-181），不该一起只记说明不改。
- **涉及测试：** IN11; IN12 a finalized FAIL suppresses an older PASS for the same check
- 来源：Codex；核实：partly；规格行：是；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：recordCheckResult 是 runner 根据实际进程观察调用的写入；见 src/core/agent-runtime/check-execution.ts:115。 改法：改为 openVerification、真实 runRegisteredCheck 执行登记脚本、finalizeChecks；begin 和结果记录由 runner 完成。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：真实流程无法保留 revision:1 和 new-A 报告引用；见 tests/work-graph/S3-context-inputs.test.ts:795、src/core/work-graph/state/verification-machine.ts:978、:1026、src/core/work-graph/evidence/evidence-service.ts:832。 改法：IN11 暂标 BLOCKED；撤销保留 revision:1/reportRef:newRef 的要求，先由 lead 冻结单检查流程 revision:4 和真实报告语义的精确断言，不得放宽断言或复制输出充当期望。
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：IN12 keep-note 保留公开状态机拒绝的 PASS 后继链；见 tests/work-graph/S3-context-inputs.test.ts:497、src/core/work-graph/state/verification-machine.ts:1440。 改法：IN12 改为 BLOCKED，删除 DSH 自行选择退役或改链的文字，等待 lead 冻结处置。

