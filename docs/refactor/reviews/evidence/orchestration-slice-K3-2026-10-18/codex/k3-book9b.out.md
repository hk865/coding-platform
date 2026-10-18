1. **F-102：问题成立，但两处代码行号已过期。** r9a 的首命中返回在 [command-recognition.ts:129](/D:/cxt/k3g4b3-review10/src/core/work-graph/tasks/command-recognition.ts:129)，`rewrite_of_mismatch` 在 [command-rerun-request-service.ts:773](/D:/cxt/k3g4b3-review10/src/core/work-graph/tasks/command-rerun-request-service.ts:773)；规格 `:539` 正确。

   owner 不能拿现有的**一个命中**判断“是否属于全部命中”。必须让识别器在同一次解析、展开中检查全部候选。最小接口方案是增加可选的已解析 `preferred={reviewRunId,alias}`：命中它就返回它，否则仍返回首命中；不必把持久化 `match` 改成数组。另一方案是识别器返回有序命中数组，再由 owner 选择，不能在 owner 复制匹配逻辑或逐记录重复展开。

   直接调用者只有 owner `:761` 和 shell hook `execution-driver.ts:536`，由 `create-platform.ts:761,776,1178` 共用接线。下游必须保持：

   - hook 无 `preferred`，仍拦首命中并显示对应记录的处置；
   - owner 保存选中项的 `reviewRef/alias/match`，后续 pending、拒绝、允许等查询跟随该项；
   - 卡的 source facts／读模型读取选中记录，`command-rerun-request-card.ts:153–165` 显示其前缀、原命令和已保存的命中；
   - 接续说明不直接读识别结果；`context-assembler.ts:1443–1469` 按 **记录＋别名**连接请求状态，两个 `#1` 必须保留为两行；
   - allowance 仍按整条命令摘要放行，不因选了第二条而改变。

   若选择数组接口，还须适配 B2-401、B2-blocked-runtime、K3-crr、K3-review-card helpers，以及 B2-02、B2-07、B2-09、B2-12（含 pure）、B2-16、B2-18、K3-UR7 的识别调用／替身。

   **双命中公开可达。** 同 Task 先执行 A，未知后核对并跳过；重新入队后执行与 A 不匹配的 B，再核对并跳过；后续请求 `A && B`。两份真实记录可以各有 `alias=1`，身份由记录区分。可用 `node a.js`、`node b.js`，无需一份记录造两个条目。负例应是“只命中 A，却注明有效的 B”；**完全没有命中但注明有效出处，应按规格接受为 declared，不能当拒绝例。**

2. **F-031：可达，A8 时钟足够提供不同创建时间。** 上述 A/B 路径配合递增时钟、故意反向的 Run ID，即可检查同一组合命令命中两份记录时较早者胜出。若保留原测试“较早 action 胜过较晚 exact”的特殊组合，则第二次执行前须经过真实 CRR 一次性允许。

   r9a 失败的是 [B2-02-recognition-unified.test.ts:122](/D:/cxt/k3g4b3-review10/tests/runtime/B2-02-recognition-unified.test.ts:122)，在 `:134` 创建第二份记录时失败，尚未到 `:156` 的断言。`K3-blocked-command-fixture.ts:316–333` 未接 `commandRecognizer`；非空绑定在 hook `:528` 被拦，夹具最终在 `:352` 抛出 “Run ended before the tool call”。补接后，现有第二条 `migrate` 仍会被第一条 `migrate && cleanup` 正常拦截，不能只补时钟。

3. **§3 逐行可施工性：**

   | 行 | 判断及最小补句 |
   |---|---|
   | F-102 | **OPEN-1**：冻结接口选择：“识别器增加可选 preferred，同次展开返回该命中或原首命中；owner 传入已解析 rewriteOf，hook 不传。”正负例按上文。 |
   | F-031 | 行为已定；采用上述公开路径，增加可选 A8 时钟／ID输入和真实识别接线即可，无须新产品决定。 |
   | F-008、021、033 | 足够：接续 Run 发请求、真实 workspace reader、实际 review/proposal 前置后缩窄授权；prepare/start 拒绝分别验证，保持配置版本不变，避免被版本检查遮住。 |
   | F-020、035 | 足够：正式 startup 交回保存答复，再由 Workflow 执行②／③，覆盖成功、失败及再次重驱不增写。 |
   | F-040、041、042、044、045 | 足够；M§4 和旧裁定已规定实际发送 control、RUN-25 单次提交故障、requeue 后 claim、旧 Host durable 后 gate，以及第一次操作前的基线。 |
   | F-026、032 | F-032 足够，末页用实际改变结果的允许／禁止记录。**OPEN-2（F-026）**：“冻结兜底句为‘平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。’”目前只有生产常量，规格和两本书没有冻结它。 |
   | F-054 | 后端范围明确，但共享 helper 限制冲突，见 OPEN-3。 |
   | F-066、067 | F-067 的固定预算、长理由拒绝、不变、短理由成功和完整读回已足够；`156720+6000>158720` 是下界，完整增量仍须手算。**OPEN-4（F-066）**：“先冻结八条尚未拾取锚点的公开步骤及算式，并停在被测 prepare 前；不得重新拾取已拾取锚点，无法达到则 BLOCKED。”上一答复的 16,396 不能单独证明可达。 |

4. **§2 裁定 1–2：存在需要点名的例外。**

   **OPEN-3：** `K3-35-continuation-fixture.ts:791–794` 仍直接拒绝 memory，F-054 必须删除这道旧限制；F-066 所用 `prepareWorstCase` 目前只读回已成功准备的值，不能观察容量拒绝。最小补句：“允许为 F-054 移除该 SQLite-only guard，并为 F-066 增加返回真实 prepare 结果的分步入口；既有调用方式保留。”识别器、时钟、真实 reader 的可选接线可归窄增补，无须恢复整套 helper 整改。

   **OPEN-5（F-055）：历史证据冲突。** `k3-book9.out.md:281–292` 把三行 `:240,334,387` 列为原默认 30,000；实施答复却称原为 120,000。本轮 diff `:6244–6267` 只证明 **180,000→默认**，不能证明更早的 120,000。最小补句：“本书明确批准这三行使用 120,000，作为裁定 9 的例外。”若坚持称“恢复历史”，须补更早差异证据。

5. **遗漏的业务保护项：F-097 尚不能按答复认定关闭。** [B2-07-crr-card.test.ts:127](/D:/cxt/k3g4b3-review10/tests/work-graph/B2-07-crr-card.test.ts:127) 的计数 reader 只接到另建 CRR owner 的识别器；`:170` 读卡却走 world 原有 card source，未共享这个计数入口。改文件后保存的文字仍正确已有断言，但“正式读卡零重读”仍未守住。

   **OPEN-6 最小补句：**“将 F-097 加回，与 F-021 共用正式工作区 reader 的计数包装，修改文件后公开读卡，验证原命中和零新增读取。”其余分类内业务项已在 §3 或 r9a 已完成生产项中；不追加形式项。

OPEN count: 6