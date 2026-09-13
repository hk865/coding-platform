# CM-1A-001 独立验收交接（检查点）

> 本文件是**交给独立验收者**的入口。实施者**不自行宣称 PASS**；下面的「覆盖」只说明哪些 A 项有可核对的用例，
> 不构成通过结论。**请把本文件与票面、源码快照一起交给验收方。**

## 1. 三项入口（按 HANDOFF 第 3 节要求）

| 项 | 绝对路径 |
| --- | --- |
| **实施 handoff** | `/mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-01/handoff.md` |
| **被验 Ticket** | `/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/CM-1A-001.md` |
| **源码快照** | `/mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-01/source-snapshot.json` |
| 验收 Prompt | `/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/ACCEPTANCE-PROMPT.md` |
| 技术裁决 D01-D06 | 同目录 `decision-log.md` |
| 验证记录 | 同目录 `verification.md` |
| 构建验证 | 同目录 `build-verification.md` |
| 原始日志 | 同目录 `logs/` |

产品根（WSL）：`/mnt/d/1.project/Software/agent_platform`
产品根（Windows）：`D:/1.project/Software/agent_platform`
文档根：`D:/1.project/Software/agent_learn/agent_dev/agent_platform`

## 2. 被验源码快照

| 项 | 值 |
| --- | --- |
| snapshot_id | `CM1A-001-snap-01` |
| 产品 HEAD | `0eb02717d16412298c786166a75ca1a9d3e05ac7`（`main`，**未移动**） |
| 文档 HEAD | `e99484fb2bd3296a32d8442e74b47d8ed569b3d5` |
| 源文件数 | 1211（算法见 `BASELINE.md` 第 5 节） |
| 源码指纹 | `sha256:391d23a280689196...`（完整值见 `source-snapshot.json`） |
| 工作树条目数 | 226 |
| Node / pnpm | v24.18.0 / 11.21.0（WSL2 Linux） |

**验收方必须自己核对两件事**（本快照的准备基线无法替你做）：
1. 工作树里同时存在**用户原有改动**与一类**归属未证实**的改动（25 个文件，mtime 早于基线采集但基线未记录，
   而 HEAD 未移动）。分类清单见 `verification.md` 第 4 节。**不要把 `git diff HEAD` 当作本票成果。**
2. 本票三个工作段的实际产物清单见 `source-snapshot.json` 的 `changedByThisWorkSegment` 与 `workSegments`。

## 3. 实施者已运行的验证（请独立重跑，不要采信）

```bash
cd /mnt/d/1.project/Software/agent_platform
npx tsc --noEmit                                                    # 0 诊断
node scripts/check-module-boundaries.mjs                            # issues: []
bash scripts/test-wsl.sh tests/coordination tests/contracts/module-ownership.test.ts   # 5 文件 / 55 用例
bash scripts/test-wsl.sh                                            # 306 文件 / 2043 用例
```

**测试入口纪律**：必须用 `bash scripts/test-wsl.sh`（它注入 `CODING_AGENT_BWRAP_PATH` 并做 sandbox preflight）。
用 `npx vitest run` 会产生 130 个与本票无关的假失败 —— 这条已被同一工作树上的对照重跑证伪过。

构建（`pnpm kernel:build` / `pnpm build` / `pnpm ui:typecheck`）需要把 npm 所在目录加入 PATH：
本机 `~/.local/bin` 只链接了 node/npx/pnpm，npm 11.16.0 在
`/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/`。

## 4. A01-A12 的可核对用例（**不是 PASS**）

| ID | 有可核对的用例 | 用例位置 | 已知未覆盖 |
| --- | --- | --- | --- |
| A01 | 参与 @1 同事务 link、换手后等待/请求/订阅仍归 Work、mailboxView 重建、投递不越权、错误 expected participation 被拒 | `tests/coordination/control.test.ts`、`control.sqlite.test.ts` | 「一个 AgentInstance 至多一个 active participation」**不成立**（无身份槽，已收口为文档边界）；无真实运行时归因证据 |
| A02 | replay / `idempotency_conflict` / `stale_participation` 零写入、body-first respond digest 精确匹配 | 同上 | **权限隔离的读取面**（两个获准 Work 可读、第三者不可读、相同 digest 不串权限）未验证 |
| A03 | 固定事件位置路由、投递目标=订阅 owner、页 settle 同一 CAS（含被拒零部分写入）、三条专用校验反例、catchup 幂等 | `tests/coordination/route-drive.test.ts`（12 例） | **不做尾随新事件**；跨位置 checkpoint 推进在生产路径上多为 `null` |
| A04 | 两消费者竞争只有一个 claimed、过期 generation 被拒、可证明无副作用的过期租约允许重领 | 同上 | **跨 SQLite 连接/跨进程**竞争未验证 |
| A05 | wait 先注册/事件先到两种时序都**恰好一次**后继、前驱 active 时零写入不重叠、deadline 到点不接续、连续硬失败熔断为 `quarantined` | 同上 | 断点覆盖见 A09 |
| A06 | Delivery 正文与版本进入**捕获的 user message**、`manifest.selected` 含该条目、nonce 不在前驱输入、撤权/来源更新后**零新增模型请求** | `tests/coordination/delivery-into-input.test.ts`（3 例） | **未做**账本侧 `provider_call_authorized` / `provider_call_attempted`（D06 留下）；撤权只能由准备期来源能力/basis 当前性证明 |
| A07 | 请求先落 `cancelled`、重复取消零写入 | `control.test.ts` | `cancel_requested` 的 intent 收敛**无真实生产者**，该分支未被覆盖；执行中取消/完成竞争未验证 |
| A08 | （无） | — | **无注入证据**（外部动作已发生但回执未落账 → 重启不重做） |
| A09 | SQLite `close()`+`reopen()` 后从持久 `wait_admission` intent 继续并完成唯一后继 | `route-drive.test.ts` | canonical commit 后 wake 前、路由页前后、claim/start/bind 之间的断点未验证 |
| A10 | （无） | — | **未验证**（两个只读 Run 真实并行、写冲突、backlog/公平） |
| A11 | 共存清单（decision-log D05）、ordinary drive 与协作面同收口且协作异常不让 ordinary 停摆 | `route-drive.test.ts`、既有 `tests/control/dispatch-drive.test.ts` | 无「未迁移入口不与新循环竞争」的回归证据 |
| A12 | `tsc` 0、`check:architecture` 0 issue、`pnpm build` 通过、`ui:typecheck` 通过、文档检查 13/13、全量 306/2043 | 见第 3 节 | Interface 文档只同步了 state-ledger 的 commit kind；`runtime-collaboration` / `context-lifecycle` 未同步；独立审阅未做 |

## 5. 实施者报告的三处真实缺陷修复（请重点复核）

这三处都是**消费者第一次真正走到**才暴露的，都动了第 1/2 工作段的代码：

1. **`participation-start` 提交形状与账本白名单不一致**（第 1 工作段留下）：契约要求同一事务带
   `WorkRunLinked`，白名单没有它 → **参与关系无法通过 Control 建立**。修法：新增**专用校验器**
   `validateParticipationStartCommit`（钉住事件恰好两条且有序、快照与 expectedVersions 精确对齐、
   `runRef` 真在 `linkedRunRefs` 里、binding 与 participation 同属一个 Work），白名单登记只是附加。
2. **`checkWaitConditionRefShape` 曾要求契约不存在的 `waitRef.workId`** → 任何合法 waitRef 都被判非法
   （`admitWaitSuccessor` 与路由页全部不可用）。修法：删除该字段要求，归属一律按 canonical 快照判定。
3. **`wait-register` / `communication-route-page` 建 intent 时不发 `CommunicationIntentRecorded`** →
   重启后分页会永久停住。修法：两个提交同样发出该事件。

验收方应独立判断这三条修法**是否放宽了校验强度**、是否需要用反例证明它们没有。

## 6. 待验范围与剩余工作

**待验**：CM-1A-001 全票 A01-A12，重点见第 4 节的「已知未覆盖」列与第 5 节的三处修复。

**剩余工作（实施者判断，请验收方复核该判断是否成立）**：

| ID | 剩余项 | 影响 |
| --- | --- | --- |
| R1 | D06 的账本侧 provider 调用证据（`RunFactV1` 新变体 `model_request_evidence` + `provider_call_authorized`） | A06 目前只能在「捕获的请求 + manifest」层证明 |
| R2 | 位置推进型 route intent 的生产者 | A03 的「持续尾随/跨位置 checkpoint」不成立 |
| R3 | intent 的非终态重排（`retry_scheduled`/退避） | `backoffDelayMs` 未接入，`retry_scheduled` 不可达 |
| R4 | `cancel_requested` 的真实生产者 | A07 的一条分支未被覆盖 |
| R5 | A08/A09 的强杀断点注入 | A08 完全未验证；A09 只覆盖重启一条 |
| R6 | A10 只读并行/写冲突/backlog | 完全未验证 |
| R7 | successor 的派发期 Work 一致性（`ensureWorkIdentity` 仍按 (goal, task) 解析） | 「协调 Work 与任务 Work 是同一个」这一前提需裁决 |
| R8 | `runtime-collaboration` / `context-lifecycle` 正式 Interface 未同步 | V15 追溯 |

## 7. 收到验收结论后的继续入口

- **有缺陷** → 按缺陷的 Ticket/Acceptance 编号与复现条件修复，产出**新快照**（不要沿用本快照的结论），
  并说明影响范围；修复后重验受影响范围与必要回归。
- **无缺陷但第 6 节的剩余项被判定属于本票范围** → 把对应 R 项当作本票剩余工作继续实施，仍交新快照重验。
- **无缺陷且剩余项被判定超出本票范围** → 记录 Gate A 的**实际适用范围**（哪些 A 项通过、哪些部分通过），
  再按 PLAN 第 7.1 节决定可释放的下一张票。**M06 已预起草为 `CM-M06-DRAFT.md`（`blocked_by: CM-1A-001`）**，
  但 any-wait 依赖 A05 的 all-wait seam 成立。
- **整批仍未完成**：1B（B01-B05）、1C（C01-C04）、入口迁移 M01-M06、整批集成 I01-I04 全部未开始。
  1A 的 PASS 不是整批完成，也不自动释放 B/C。

## 8. 实施者声明

- 本工作段的源码写入**已停止**（除验收发现的缺陷外，不再改动被验快照）。
- 本文件与 `handoff.md`、`verification.md` 中的任何结论都**不是**独立 PASS。
- 未 commit / 未 push；用户既有未提交改动全部保留。

---

## 9. 独立验收 review-01 缺陷的处理（实施者侧记录，复盘用）

独立验收者的结论在 `../acceptance/CM1A-001-snap-01/review-01/`（**不由我编辑**）。它对**当前工作树**的实测指纹为
`26529f1e926bc712...`，与我声明快照的 `391d23a280689196...` 不符，因此正确地把 7 条缺陷都标为 OPEN 并绑在它自己的实测树上。

### 9.1 SNAP-01（指纹不一致）—— **根因已查清，不是算法不可复算；需要新快照而不是解释**

我把**验收者自己的** `capture.py` 与我在本票第 5 步新增的 `scripts/source-snapshot.mjs` 在同一棵树上同时运行，
两者给出**逐字节相同**的结果（`1221` 文件 / `4d3710a7d6d5e5bb...`）—— 说明两套实现是同一个算法，**可复算性本身没有问题**。

而 `391d23a2` 与 `26529f1e` 都是 `1211` 文件却摘要不同：这不是算法差异，而是**两次采集之间的内容漂移**。
本票第 1/2/3 步是在我生成那份快照**之后**才落到工作树上的，所以验收者看到的必然不是那一份。
**这正是验收者指出的真问题：我把一个随后就被自己改动覆盖的快照交了出去，没有冻结它。**

处理（不靠解释关闭）：
1. 全部工作段停止写入后，用**统一脚本**重新生成快照（`node scripts/source-snapshot.mjs --out <path>`），
   它在旧格式之外**额外写出逐文件哈希**，使验收者可以逐文件核对而不只信总指纹；
2. 用 `--diff <旧快照>` 输出**新增/删除/变化**三类清单作为「准确差异」；
3. 把新快照与新指纹交给独立验收者重跑，**旧声明快照作废**，不追认其字节内容。

### 9.2 其余 6 条缺陷与第 1–3 步的对应关系

| 缺陷 | 与我这边的关系 | 状态 |
| --- | --- | --- |
| STD-01（含 next intent 的路由页必被拒） | 正是第 1 步修的核心：旧规则只允许 `CommunicationIntentSettled`、只允许一个 intent 快照 | **已修**（第 1 步：允许 `CommunicationIntentRecorded`，且把「本页 done intent」与「可选下一页 pending intent」分别校验） |
| STD-02（`participation-start` 放宽了事件基本校验） | 第 1 步的 `validateParticipationStartCommit` **先跑**通用校验，已补回非空 eventId / 事件 schemaVersion / 作用域一致性 | **已修**（并新增 8 条反例 + 2 条正向对照；验收者的 `standards-repro.mjs` 现在那三处变异会被**拒绝**——实施者探针已对照确认） |
| SPEC-01（唯一后继 outbox 没有生产 RunSpec prepare） | 第 3 步的完成条件就是**删除测试里的手工后继 `prepare`**，经正式产品路径准备并执行后继，且覆盖重启后恢复 | 第 3 步实施中 |
| SPEC-02（换手后仍向旧 participation 申请接续） | 第 2 步已改为按 **Work 当前参与关系**判定；验收者指的 `coordination-drive.ts` 从 `wait.ownerParticipationRef` 读取提交的路径，由第 2 步改成读 `currentParticipationRef` | 第 2 步已改，**待新快照重验** |
| SPEC-03（协调 Host 工具没有生产者接线） | 第 3 步的窄 Adapter 就是这条；并且我已按协议约束 2.3 要求它**不得**把会改平台状态的协调工具伪装成 `read_only` | 第 3 步实施中 |
| SNAP-01 | 见 9.1 | 待新快照 |

### 9.3 实施者从这次验收学到的三条纪律（写进后续交付）

1. **快照只在全部写入停止后生成一次**，并且**交付时用统一脚本复算一遍**自证可复算；
2. 交付包必须含**逐文件哈希 + 与上一份快照的差异清单**，而不是一个总指纹；
3. 声明快照一旦被自己后续的工作段改动，就**主动作废并出新快照**，不让验收者去解释漂移。


---

## 10. 内核（vendor/coding-agent）改动登记 —— **需要独立验收重点复核**

第 3 工作段为满足协议约束 2.3（协调工具必须由宿主**显式授权**、不得伪装成只读绕过检查）**修改了内置内核源码**。
按根 `AGENTS.md`「修改内置执行内核时先读 vendor/coding-agent/AGENTS.md 与 INTEGRATION.md」与
`vendor/coding-agent/AGENTS.md`「本副本的修改归入平台仓库」，登记如下。

### 10.1 改动的文件（vendor 仓库 `git status` 实测）

```text
 M INTEGRATION.md
 M src/app/composition/composition-root.ts
 M src/app/composition/resume-composition.ts
 M src/policy/permissions/permission-policy.ts
 M tests/integration/m3-tools.test.ts
```

`UPSTREAM.json` **未被修改**（导入身份与来源 commit `03334ece…` 保持不变）；`dist/` 是 gitignore 的构建产物，
由 `npm --prefix vendor/coding-agent run build` 重建 —— **审阅与验收必须以 `vendor/coding-agent/src` 的差异为准**，
不能以 dist 为准。

### 10.2 改了什么（实施者已核对过实际 diff）

新增一条**宿主显式授权**通道，供宿主扩展的**非只读**工具使用：

| 位置 | 改动 |
| --- | --- |
| `permission-policy.ts` | `PermissionPolicyConfig` 新增可选 `hostAuthorizedTools?: readonly string[]`；`evaluate()` 在**默认拒绝 `unknown_operation` 之前**新增一个分支：`effectClass !== 'read_only' && hostAuthorizedTools.has(tool)` → allow（新 reasonCode `host_authorized_tool`） |
| `composition-root.ts` / `resume-composition.ts` | `RunAppInput` / `ResumeAppInput` 新增可选 `hostAuthorizedTools`；组合根**只采纳**「本轮确实在 `additionalTools` 里注册过、且 `effectClass !== 'read_only'`」的扩展名 |
| `tests/integration/m3-tools.test.ts` | 新增反例与正例：未授权 → `permission_denied` 且 handler **未执行**；授权后放行；授权**别的名字**不放行 |
| `INTEGRATION.md` | 新增「协调工具能力声明（2026-09-13）」一节，替换/补充 2026-09-08 那条边界描述 |

### 10.3 安全边界为什么没有放宽（需独立复核）

1. **分支位置在所有既有规则之后**：路径/敏感资源（hidden prefixes、secret names）、内置 `read` / `check` / `edit` / `shell` 的既定规则都在它之前判定，因此这条新增分支**无法**用来绕过文件写入审批或进程审批。
2. **授权来自宿主、不来自工具自述**：名单由组合入口显式给出；工具**不能**把自己的 `effectClass` 声明成只读来换取放行（那正是改动前的错误做法）。
3. **只对确实注册过的扩展生效**：名单里写内置工具名或未注册的名字**不产生任何权限**（在组合根被过滤掉）。
4. **缺省向后兼容**：`hostAuthorizedTools` 缺省为 `[]`，既有调用方行为逐字节不变（未授权扩展仍按未授权未知操作默认拒绝）。
5. **来源未变**：上游导入身份（`UPSTREAM.json`）未改，改动是平台仓库对本副本的受控修改，理由与来源记录在 `INTEGRATION.md`。

### 10.4 实施者已跑的内核验证

```text
npm --prefix vendor/coding-agent run build            # exit 0
vendor: npx vitest run tests/integration/m3-tools.test.ts                       # 13 passed（含新增授权用例）
vendor: npx vitest run tests/integration/m6-security-acceptance.test.ts tests/unit   # 10 files / 33 passed
```

### 10.5 留给独立验收的问题（实施者不自行裁定）

1. 这条改动是否应被视为「经由公共 API 适配」，还是应改为向内核上游提交后重新导入（即是否必须更新 `UPSTREAM.json` 的来源身份）？
2. 分支位置与过滤条件是否足以保证「不得绕过现有检查」（第 10.3 节四条）——请独立构造绕过尝试，而不是采信本节的说明。
3. `INTEGRATION.md` 的记录是否足够让后续读者复原来源与理由。


### 4.12 三层拒绝（第 3 步）—— 准入层次与「无第二条路径」的结构证据

| 层 | 触发条件 | 结果 | 对应用例 |
| --- | --- | --- | --- |
| **层 1 装配层**（fail-closed） | 未授予协调能力 | 实际模型请求的工具清单里**没有**任何 `coordination_*`（模型调不到）；硬调则内核回可读 `unknown_tool`；平台状态零改动 | `coordination-capability.test.ts`「未授予的 Run…」 |
| **层 2 Adapter 调用期** | 授予在调用时刻已失效（用正式命令 `endWorkParticipation` 结束该段参与） | `rejected/not_granted` + 可读原因；**计数 Vault 证明 `vault.put` 调用次数 = 0**，无请求落账 | 同文件「每个写操作在动 Vault/Control 之前校验能力」 |
| **层 3 内核策略层** | 工具被注入并启用，但未进 `hostAuthorizedTools` | 内核回 `permission_denied`（`retryable:false`）；**handler 一次都没执行**（记录型 access 断言） | 同文件「内核策略层：…handler 不执行」 |

**「不存在第二条拿到协调工具的路径」的结构证据**（新增用例，扫 `src/**/*.ts` 断言）：
1. `createCoordinationTools(` 只出现在定义处与**唯一**注入处 `coding-agent-runtime.ts`；
2. `coordinationTools: {` 只在那处被设置，且是 `context?.coordination` 存在才注入；
3. `new CoordinationToolAccess(` 只出现在 `coordination-tool-access.ts` 与 `coordination-capability.ts`（唯一装配点）。
任何新增注入点或「绕过授予直接注入」的写法都会让这条断言失败。

**已知的测试入口抖动（记为第 5 步收尾项，不是逻辑回归）**：全量并行下 `tests/restart/*`、`tests/app/*`、`tests/integration/*` 会出现**超时类**失败
（实测 `material-access-restart` 的 `crowded=true` 达 30382ms / 43121ms，撞 30s 上限；加 `--testTimeout=120000` 后转为 `Hook timed out in 10000ms` 与 `CLI timeout after 20000ms`）；
**同一文件单跑通过**（`material-access-restart` 单跑 3/3，该例 17.5s），`tests/coordination` 多轮 10 文件 / 82 用例 exit 0。
判据：失败全部是**超时类**且**不在本批改动的文件上**。处置归第 5 步「有界并发 + 统一收尾」。

