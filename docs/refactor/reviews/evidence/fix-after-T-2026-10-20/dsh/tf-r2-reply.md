# TF rework 2 回复（2026-10-21 夜）

**结果：DONE。** TFR-04 按表重做，两个手写 `unavailable` Session 的测试只补了合法的 `healthConclusion`。

提交：`bd58f4a TF rework 2`（父提交 `8317081 TF rework 1`）。`git diff --shortstat 8317081 HEAD` = **5 files changed, 17 insertions(+), 14 deletions(-)**。没有 stage `.dsh-ref/`、`.dsh-scratch/`、`.typecheck.lock`。

## 1. 文件与改动

| 文件 | 改动 |
|---|---|
| `src/core/work-graph/sessions/session-record-codecs.ts` | `checkSessionBody` 收紧：`health === 'unavailable'` 时 `healthConclusion` 必须是 `SESSION_HEALTH_CONCLUSIONS` 成员，否则返回 `'session healthConclusion is required when health is unavailable'`；非 `unavailable`（含 `available` 的合法 `null`/缺省）仍只做枚举校验。注释改为当前规则（原来“跨字段规则归写入方”已不成立）。 |
| `src/core/work-graph/state/line-status.ts` | `:287`、`:351` 去掉 `?? null`，直接传 `head.healthConclusion!`（codec 已保证 unavailable 必带结论）；`:601` 去掉 `'unrecorded'` 文案；`:817` 删除 `retired_unrecorded` 的 `default` 分支，`retiredReason` 参数收窄为 `SessionHealthConclusion`，switch 对三个成员穷尽。 |
| `src/core/work-graph/views/work-line-reader.ts` | `toSegment` 不再计算 `retired_unrecorded`：`reason` 只在 `notReadable` 时取 `missing`/`damaged`；随之删除不再使用的 `LineReasonV1` import（`--noUnusedLocals` 的唯一报告）。`isHistoryNotReadable` 的 `?? null` 是 available 合法 null 的读取，保留。 |
| `tests/work-graph/R4c-task-claim-boundaries.test.ts:96` | `overwriteSession` 的 mutation 改为 `{ ...record, health: 'unavailable', healthConclusion: 'missing' }`。 |
| `tests/work-graph/R4c-task-claim.test.ts`（`mutations` 列表，使用于 `:265`） | `unavailable` 项改为 `{ ...record, health: 'unavailable', healthConclusion: 'missing' }`。 |

**使用的结论值：`missing`。** 它是 `SESSION_HEALTH_CONCLUSIONS` 的成员（`src/contracts/core/session.ts:16`：`missing | damaged | kernel_turn_open`），不是另造的枚举值。

没有改 `tests/helpers/task-claim-fixture.ts`、任何断言或其它测试。`src/contracts/work-line.ts:46` 的 `retired_unrecorded` 成员按 R-TF-5 保留；`LineRowV1.retired.conclusion` 等冻结可空字段也保留。

## 2. 检查

- `flock ./.typecheck.lock npm run typecheck` → **0**（删 import 后重跑）。
- `npm run check:architecture` → **0**（`next source boundaries: OK`，删 import 后重跑）。
- `npm run build` → **0**。
- `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198"` → **0 行**（首轮报 `work-line-reader.ts(40,73) LineReasonV1`，删 import 后为空）。

**Importer 测试。** 用 `grep -rln` 找三个生产文件（`session-record-codecs`、`line-status`、`work-line-reader`）在 `tests/` 的直接导入者（73 个，其中 25 个 helper），再并上导入这些 helper 的测试文件，得到 218 个路径；其中 4 个是非测试支持模块（`tests/scenarios/support/{S5-decisions,control,fuzz}.ts`、`tests/state/invariants.ts`），实际运行 **214 个测试文件，22 批，每批 ≤10**，`timeout 900 npx vitest run --maxWorkers=2`，一条一条跑。

- **Test Files：202 passed / 12 failed（共 214）；Tests：2325 passed / 41 failed / 0 skipped。**
- 先单独跑两个改过的测试：`R4c-task-claim-boundaries.test.ts` 9/9、`R4c-task-claim.test.ts` 22/22 全过（31 passed）。
- 12 个失败文件中，10 个在 `./.dsh-ref/env-failures.txt` 覆盖范围内（无 bubblewrap）：
  - `A7-control` 14 项（日志有 `ENOENT ... /usr/bin/bwrap`，下同）；
  - `A2-verification-chain` 8 项；`S3-context-inputs` 6 项；`A2-disposition-change` 2 项；`R3e-command-check-platform` 2 项；`R3e-completion-platform` 1 项；`orchestration-mechanism` 1 项；`S5-user-message-tools` 1 项；`S4C2-goal-triggers` 1 项；`W1-future-plan` 1 项。合计 37 项。
    - 命名说明：env 清单把 R3e 两项写成 `R3e-command-check, R3e-command-completion-platform`，实际文件名是 `R3e-command-check-platform.test.ts` / `R3e-completion-platform.test.ts`；按同一清单条目计。
- **不在 env 清单、且不是 TFR-04 引起的 2 个文件（4 项）**：
  - `tests/scenarios/S1-archive-restart.test.ts` IT19 1 项、`tests/scenarios/WP1-wiring.test.ts` SC01×2 + SC02 3 项，均为 `expected 'waiting' to be 'completed'`。
  - 为排除本行回归，在 `/tmp` 建了 `8317081` 的干净 worktree（只补 `node_modules` 与 `vendor/coding-agent/node_modules` 链接），跑这两个文件：**同样 4 failed / 5 passed，报错与行号完全相同**；主运行里该路径是 `run_check` 被 `ENOENT ... bwrap` 拒后停在 `waiting`。故判定为环境/既有失败，不是 TFR-04 引起；worktree 已用 `git worktree remove --force` 删除。

**没有出现“另一个测试因同样原因变红”**：除点名的两个测试外，没有测试因 codec 收紧而失败。

## 3. Ledger

`python3 -I ./.dsh-ref/d1-ledger.py . 8317081 HEAD > ./.dsh-ref/out/ledger-r2.txt`：

- REMOVED assertion / test / describe / backend list：**0**
- LOOSENED：**0**；RAISED/NEW timeout：**0**；skip/todo/only：**0**
- DELETED test files：**0**
- D3 pure-file guard：25 个文件，**0 hits**
- 无可映射行（ledger 只统计删除或放宽的测试行；本轮只把两处手写 mutation 改成当前记录形状，未删断言、未改断言强度）。两处改动均属于 **TFR-04**。

## 4. 收尾

`./.dsh-scratch/` 本来就不存在（已确认），无需删除；工作区干净（`git status --porcelain` 为空）。
