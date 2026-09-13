# CM-1A-001 独立验收交接（**snap-03**，当前有效快照）

> 交给独立验收者的入口。实施者**不自行宣称 PASS**。
> **snap-01 与 snap-02 均已作废**（见 §9），请只对 **snap-03** 验收。

## 1. 三项入口

| 项 | 绝对路径 |
| --- | --- |
| 实施 handoff / 本文件 | `/mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-03/ACCEPTANCE-HANDOFF.md` |
| **被验 Ticket** | `/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/CM-1A-001.md` |
| **源码快照** | `.../CM1A-001-snap-03/source-snapshot.json`（含**逐文件哈希**） |
| 协议约束（字段五问、事务边界、兼容） | `.../collaboration-memory/CM-1A-001-PROTOCOL-CONSTRAINTS.md` |
| 后续实施计划（5 步） | `.../collaboration-memory/CM-1A-001-FOLLOWUP-PLAN.md` |
| 技术裁决 D01–D06 | 同目录 `decision-log.md` |
| 原始日志 | 同目录 `logs/` |

## 2. 被验源码快照（**可复算**）

| 项 | 值 |
| --- | --- |
| snapshot_id | `CM1A-001-snap-03` |
| 产品 HEAD | `0eb02717d16412298c786166a75ca1a9d3e05ac7`（`main`，**未移动**） |
| 文档 HEAD | `e99484fb2bd3296a32d8442e74b47d8ed569b3d5` |
| 源文件数 | **1225** |
| 源码指纹 | **`sha256:2c3e61c237d5dd398d9a33370b916a08847354450992b08d6d734925e3f944db`** |
| 复算自证 | ✅ 冻结后当场用同一脚本重算，指纹**逐字节相同** |
| 与 snap-02 的差异 | **0 新增 / 0 删除 / 12 变更**（`snap02-to-snap03-diff.json`） |

```bash
cd /mnt/d/1.project/Software/agent_platform
node scripts/source-snapshot.mjs                        # 打印快照（含逐文件哈希）
node scripts/source-snapshot.mjs --diff <其它快照>.json   # 新增/删除/变化
```

## 3. snap-03 上已归档的验证（请独立重跑）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npx tsc --noEmit` | **rc=0**，0 诊断 | `logs/typecheck.log` |
| `node scripts/check-module-boundaries.mjs` | **rc=0**，`issues: []` | `logs/boundaries.log` |
| `bash scripts/test-wsl.sh`（全量） | **rc=0**：`312 files passed` / `2080 tests passed` | `logs/full-tests.log` |
| `bash scripts/test-wsl.sh tests/coordination tests/contracts tests/control` | **rc=0**：86 文件 / 750 用例 | `logs/coordination.log` |
| 定向（覆盖那 12 个变更文件） | **rc=0**：21 文件 / 171 用例 | `logs/targeted.log` |
| 快照复算 | 指纹不变 | `logs/snapshot-recheck.json` |

**测试入口纪律**：必须用 `bash scripts/test-wsl.sh`（注入 `CODING_AGENT_BWRAP_PATH` + sandbox preflight）。
用 `npx vitest run` 会产生约 130 个与本票无关的假失败（已在同一工作树上对照证伪）。
**`pnpm build` 未在 snap-03 重跑**（snap-01 时期通过过一次，见 `../CM1A-001-snap-01/build-verification.md`）。

## 4. A01–A12 现状（**无一项可标记通过**）

| ID | 有可核对用例 | 已知未覆盖 |
| --- | --- | --- |
| A01 | 参与 @1 同事务 link；换手后等待/请求仍归 Work；**换手后旧 Run 不再被授予协调能力、新 Run 被授予**；错误 expected participation 被拒；投递不越权 | 无真实两 Work 链 |
| A02 | replay / `idempotency_conflict` / `stale_participation` 零写入；body-first respond digest 精确匹配；协调工具身份由宿主绑定、未授予即不可调用 | **权限隔离读取面**未验证 |
| A03 | 固定事件位置路由；**同事务登记 route intent**；**首轮 `subscriptionScope` 真的固定**、范围外订阅被拒；**末页完成后才推进事件处理位置**；多页连续完成；页 settle 同一 CAS | 仍**不做持续尾随** |
| A04 | 两消费者竞争只有一个 `claimed`；过期 generation 被拒；可证明无副作用的过期租约允许重领 | **跨 SQLite 连接/跨进程**竞争未验证 |
| A05 | wait 两种时序都**恰好一次**后继；前驱 active 时零写入不重叠；deadline 到点不接续；硬失败熔断 `quarantined` | — |
| A06 | **经真实 Host 工具**完成完整链；Delivery 正文与版本进入**捕获的 user message**；撤权/来源更新后零新增模型请求；**账本侧 `requestDigest` 等于由捕获请求重算的 sha256** | `contextInputDigest` **无 canonical 复核点**（已裁定降级，T-A7 钉住）；每 Run 只覆盖**首次**调用；**不写 ack** |
| A07 | 请求先落 `cancelled`；重复取消零写入；**取消等待的真实生产者**先落 `cancel_requested` | 执行中取消/完成竞争矩阵未验证 |
| A08 | 退避**只对已证实无副作用的失败**；租约到期+已置副作用不重领；**旁路失败不再把已完成的 Run 改写成 unknown** | **强杀断点注入**未做 |
| A09 | SQLite 重建宿主 + 新 Runtime 实例读同一 journal 后链继续完成；已完成的后继不重复准备 | 其余强杀断点未覆盖 |
| A10 | — | **完全未验证**（只读并行/写冲突/backlog/公平） |
| A11 | 共存清单（D05）；协作面挂在**唯一** `drive(trigger)` 内且异常不让 ordinary 停摆 | 无「未迁移入口不与新循环竞争」的回归证据 |
| A12 | `tsc` rc=0、边界 0 issue、全量 312/2080 通过 | **`pnpm build` 未在 snap-03 重跑**；正式 Interface 未同步；独立审阅未做 |

## 5. 请重点复核的四件事

1. **两处曾影响正确性的缺陷及其修复**：① `participation-start` 提交形状与账本白名单不一致（曾使**参与关系根本无法建立**），修为**专用校验器**；② **旁路失败（许可未签发/证据未落账）曾把已成功完成的 Run 改写成 `outcome_unknown`**，修为独立出口 `sideFactFailures` + `markUnknown` 前核对 Run 是否已 `ended`（修复前用例 error 文本与真实失败记录**逐字相同**）。请独立判断这两条修法**是否放宽了校验强度**。
2. **`contextInputDigest` 无 canonical 复核点**（协议 §4.13.6）：**已记录的验证上限**，由 T-A7 显式钉住。请判断该降级是否可接受。
3. **内核改动**（见 §6）。
4. **并发覆盖遗留**：`coordination-drive.ts` 的 `buildPage` 曾经历两个写者的覆盖合并，**请按最终树复核其语义**，不要采信任何一方的叙述。

## 6. 内核（vendor/coding-agent）改动登记

为满足协议约束 2.3（协调工具必须由宿主**显式授权**、不得伪装成只读绕过检查）修改了内置内核源码：

| 文件 | 改动 |
| --- | --- |
| `src/policy/permissions/permission-policy.ts` | 新增可选 `hostAuthorizedTools`；`evaluate()` 在**默认拒绝 `unknown_operation` 之前**加分支 `effectClass !== 'read_only' && hostAuthorizedTools.has(tool)` → allow（新 reasonCode `host_authorized_tool`） |
| `src/app/composition/composition-root.ts`、`resume-composition.ts` | 新增可选 `hostAuthorizedTools`；组合根**只采纳**「本轮确实注册过、且 `effectClass !== 'read_only'`」的扩展名 |
| `tests/integration/m3-tools.test.ts` | 未授权 → `permission_denied` 且 handler **未执行**；授权后放行；授权别的名字不放行 |
| `INTEGRATION.md` | 「协调工具能力声明（2026-09-13）」一节（含「不新增 effectClass」的裁决结论） |

**`UPSTREAM.json` 未修改**。`dist/` 是 gitignore 的构建产物，**验收必须以 `src` 差异为准**。
三层准入（装配层 / Adapter 调用期 / 内核策略层）各有独立用例，见 `coordination-capability.test.ts`。

**留给验收方判定**：(a) 是否应视为「经由公共 API 适配」，还是应向上游提交后重新导入（即是否必须更新 `UPSTREAM.json`）；(b) 分支位置与过滤条件是否足以保证「不得绕过现有检查」——**请独立构造绕过尝试**；(c) `INTEGRATION.md` 是否足够复原来源与理由。

## 7. 剩余工作与继续入口

| ID | 剩余项 | 影响 |
| --- | --- | --- |
| R-5 | **第 5 步（有界并发 + 统一收尾）未开始**：唯一 drive 内有界并发、`availableAt`/退避/公平、backlog 最老项与阻塞原因、**跨进程竞争证明**、Interface 同步 | A10 完全未验证 |
| R-2 | 位置推进型 route intent 的**持续尾随**生产者 | A03 尾随不成立 |
| R-1 | `contextInputDigest` 的 canonical 复核（R1/R2，已否决待复议） | A06 账本侧上限 |
| R-5b | 强杀断点注入（A08/A09 其余断点） | A08 无注入证据 |
| R-8 | 正式 Interface 未同步；`pnpm build` 未在 snap-03 重跑 | V15 / A12 |
| — | 全量套件在高并发下的超时类抖动（同文件单跑通过；满载 37s vs 空闲 12.9s） | 属第 5 步收尾；非逻辑回归 |

**收到结论后**：有缺陷 → 按编号修复并交**新快照**（旧 PASS 不迁移）；无缺陷但剩余项属本票范围 → 继续实施并再交新快照；无缺陷且超范围 → 记录 Gate A 的**实际适用范围**再放下一张票。
**M06 已预起草**（`CM-M06-DRAFT.md`，`blocked_by: CM-1A-001`）。**Gate A 仍未成立；1B/1C/M/I 全部未开始。**

## 8. 实施者声明

- 所有工作段**已停止源码写入**；除验收发现的缺陷外不再改动本快照。
- 本文件与任何实施报告中的结论都**不是**独立 PASS。
- 未 commit / 未 push；用户既有未提交改动全部保留。

## 9. 快照作废记录（供追溯，勿用于验收）

| 快照 | 状态 | 原因 |
| --- | --- | --- |
| `CM1A-001-snap-01` | **作废** | review-01 实测指纹 `26529f1e…` ≠ 声明 `391d23a2…`；根因是**交出去之后本批自己的后续工作段仍在写同一棵树**（验收者的 `capture.py` 与本仓 `source-snapshot.mjs` 在同一棵树上给出**逐字节相同**结果，算法无问题） |
| `CM1A-001-snap-02` | **作废** | **伪冻结**：冻结后 `tsc` rc=2、3 条用例失败、之后仍有写入（见其 `VOID.md`） |

两次事故的共同点是「**在写入未停止时冻结**」；snap-03 的纪律是：全部工作段确认停止 → 生成快照 → **当场复算指纹比对** → `tsc` rc=0 → 定向/全量验证。

