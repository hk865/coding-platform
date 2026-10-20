发现 2 项会出错，均属 W2b-49。以下是静态调用链核对结果；未修改文件、运行测试或访问网络。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| P3-01 | 会出错 | `tests/runtime/R4b-session-recovery.test.ts:246`、`:248` | W2b-49 | 跨 Session 拒绝仍可能由另一检查代替。传入第一 Session 的 limit=2 游标，其冻结上界为 6；第二 Session 未执行，仅有创建记录。移除 `src/core/agent-runtime/session-operations.ts:426` 的游标绑定检查后，仍会在 `:494` 因历史达不到冻结上界而返回 `unavailable`；当前只断言 `rejected`，前后历史也不变，因此仍通过。 | 将该断言收紧为 `{ status: 'rejected', code: 'invalid' }`，保留公开历史前后比较。这样替代性的 `unavailable` 会使测试失败。 |
| P3-02 | 会出错 | `tests/runtime/R4c-execution-history.test.ts:321`、`:342` | W2b-49 | 跨 Session 行和非法 limit 的三行未钉住执行历史 reader 自己的检查。删除 `src/core/agent-runtime/observation-recovery.ts:269` 的 Session 比较后，下层仍在 `session-operations.ts:426` 返回 `invalid`；删除 `observation-recovery.ts:260` 的限长检查后，0、201、1.5 仍被 `session-operations.ts:713` 拒绝。当前错误码及历史不变断言全部仍通过，违反 F11（`.lead-ref/books/test-rule-sheet-v1.md:85`）。 | 在拒绝框架中用现有 `spyOn` 包装真实 history；建立游标后重置调用记录，对这四行追加“本次下层调用为 0”的断言，保留原拒绝及公开前后读断言。 |

逐行结果：

- W2b-36: OK（`tests/app/A2-settings-automation.test.ts:128`、`:138`）
- W2b-37: OK（`tests/data/S8E-A23-ignored-databases.test.ts:22`、`:41`）
- W2b-38: OK（`tests/scenarios/C8-human-stop-respected.test.ts:462`、`:478`）
- W2b-39: OK（`tests/app/A2-runtime-capabilities.test.ts:209`；`tests/helpers/runtime-capabilities-fixture.ts:56`）
- W2b-40: OK（`tests/runtime/K3-19-review-admission.test.ts:28`；`tests/helpers/R4-history-turn-support.ts:53`；`tests/composition/K-R-previous-turn-bounds.test.ts:27`；`tests/helpers/WP2-duties-fixture.ts:1`）
- W2b-41: OK（`tests/app/session-rendering.test.ts:433`、`:448`）
- W2b-42: OK（`tests/app/host-settings.test.ts:987`、`:993`、`:994`）
- W2b-43: OK（`tests/composition/W1-future-plan-platform.test.ts:164`、`:180`）
- W2b-44: OK（`tests/data/S8E-A08-skip-list.test.ts:43`）
- W2b-45: OK（`tests/app/R6-workbench.test.ts:294`；`tests/runtime/R4c-kernel-history-range.test.ts:406`）
- W2b-46: OK（`tests/data/S8E-A07-git-inventory.test.ts:48`、`:68`）
- W2b-47: OK（`tests/data/S8D-platform-fixture.test.ts:28`、`:31`、`:32`）
- W2b-48: OK（`tests/app/S2B-41-decision54-backfill-bound.test.ts:202`、`:212`）
- W2b-49: P3-01, P3-02
- W2b-50: OK（`tests/work-graph/S8A-L8-observation-state.test.ts:400`、`:405`、`:408`）
- W2b-51: OK（`tests/work-graph/S8A-L8-observation-state.test.ts:773`、`:784`）
- W2b-52: OK（`tests/runtime/R4c-execution-history.test.ts:169`、`:247`、`:273`、`:280`）
- W2b-53: OK（`tests/runtime/R4c-execution-history.test.ts:213`、`:375`、`:505`）
- W2b-54: OK（`tests/runtime/R4b-session-recovery.test.ts:100`、`:125`、`:147`、`:172`）
- W2b-55: OK，保留表定 partial（`tests/composition/R3d-R3g-platform.test.ts:44`、`:223`）
- W2b-56: OK（`tests/composition/A1-graph-session-platform.test.ts:104`、`:118`、`:175`、`:221`）

重点复核结果：

- 单回复 Run 的 **5** 条记录计算成立：`turn.started` 加四条事件；无 usage 事件。因此 **11＝1＋5＋5、6＝1＋5、5＝6－1、7＝1＋5＋1** 均正确。位置来自公开历史，未把计数字面量当位置使用。证据：`tests/helpers/B2-runtime-fixture.ts:86`；`vendor/coding-agent/dist/app/composition/composition-root.js:259`；`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:351`、`:438`、`:453`、`:472`、`:377`；`tests/runtime/R4c-execution-history.test.ts:175`、`:283`。
- W2b-42 移除授权检查后不会继续得到 `forbidden`：真实 Answer 由 Query 返回，后续 proposal 读取没有该错误码出口。证据：`tests/app/host-settings.test.ts:844`、`:987`；`src/app/host.ts:979`；`src/app/host-settings.ts:783`。
- 551 字节规范文本及摘要独立复算一致：`8874959184e543c8edb486773a272605682e9b6dde8a093359c7ee8ece3f78d5`。证据：`tests/composition/R3d-R3g-platform.test.ts:36`、`:44`。
- 共享 helper 的行为变化仅涉及 A2 原先显式传设置目录的调用；K-R 原本走默认路径。其余两份 helper 只改注释，不移动签发值。证据：`tests/app/A2-runtime-capabilities.test.ts:209`；`tests/app/K-R-runtime-capabilities.test.ts:39`；`.lead-ref/parts/P3.diff:641`、`:655`、`:671`。

R-20 部分：

| 行 | 部分 | 类别成立？ | 公开步骤可达？ |
|---|---|---|---|
| W2b-53 | 混合 run/turn 身份，`tests/runtime/R4c-execution-history.test.ts:213` | 成立：不可达。Runtime 按同一个 Run 形成身份对，`src/core/agent-runtime/execution-driver.ts:620`。 | 合法签发路径不可达；拼接只能由测试构造。reader 将它过滤为空，`src/core/agent-runtime/observation-recovery.ts:235`。 |
| W2b-53 | 手写 `not_ready`，`tests/runtime/R4c-execution-history.test.ts:375` | 成立：缺少公开入口。 | 不可达；此路径调用不带等待水位的 `readSession`，`src/core/agent-runtime/session-operations.ts:753`；该读取实现无等待入口，`src/core/work-graph/sessions/session-directory.ts:1178`。 |
| W2b-53 | 改写返回页，`tests/runtime/R4c-execution-history.test.ts:505` | 成立：不可达。 | 不可达；真实 owner 先校验记录，再从同一记录生成 envelope 和内联正文，`src/core/agent-runtime/session-operations.ts:356`、`:364`、`:365`。 |
| W2b-54 | Kernel 存在及数量，`tests/runtime/R4b-session-recovery.test.ts:100`、`:125`、`:147`、`:172` | 成立：缺少公开读取入口。 | `createSession` 配合丢响应／登记故障能形成状态；但公开目录只读已映射记录，不能清点未映射 Kernel Session，`src/core/work-graph/sessions/session-directory.ts:1192`、`:1527`。 |
| W2b-55 | 数据库尾段，`tests/composition/R3d-R3g-platform.test.ts:223` | 成立：缺少公开读取入口。 | 两次 `captureSourceChanges` 能形成状态，见该文件 `:146`、`:161`；指针 revision、`readThrough` 无公开读取字段，`src/contracts/architecture-observation.ts:53`。 |

后三类保留段与所给 `base/` 对应代码一致；混合身份部分按差异恢复了声明身份的 `runTurn` 路径。旧 `w2-base` 未提供，未将代理报告当作逐字一致的独立证据（`.lead-ref/parts/P3.diff:1005`；`.lead-ref/replies/t-reply-W2R1-agents.md:377`）。

```json
[
  {
    "id": "P3-01",
    "class": "会出错",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "line": 248,
    "row": "W2b-49",
    "problem": "第一 Session 的 limit=2 游标冻结上界为6，第二 Session 仅有创建记录。移除 src/core/agent-runtime/session-operations.ts:426 的游标绑定检查后，仍会在该文件:494 因历史不足返回 unavailable；当前仅断言 rejected，公开前后历史也不变，因此仍通过。",
    "fix": "将 wrongSession 的断言收紧为 { status: 'rejected', code: 'invalid' }，保留公开历史前后比较。"
  },
  {
    "id": "P3-02",
    "class": "会出错",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 321,
    "row": "W2b-49",
    "problem": "跨 Session 行及:342 的非法 limit 三行会被下层检查兜底。删除 src/core/agent-runtime/observation-recovery.ts:269 的 Session 比较，下层 session-operations.ts:426 仍返回 invalid；删除 observation-recovery.ts:260 的限长检查，0、201、1.5 仍在 session-operations.ts:713 返回 invalid，现有断言全部仍通过。",
    "fix": "在共享拒绝框架中用现有 spyOn 包装真实 history，建立游标后重置调用记录，对跨 Session 和三个非法 limit 行断言本次下层调用为0，并保留原拒绝及公开前后读断言。"
  }
]
```

会出错 2，违规 0，不整洁 0，建议 0