已完成。

**改动**
- `src/core/work-graph/tasks/goal-decision-reader.ts`：+14/−5。`readGoalRecord` 连同 `readThrough` 返回；在 workspace 检查后、其余读取前调用 `atLeastCursorResult`，并加一句“Goal 读是首个读取”的短注释。
- `src/contracts/ledger.ts`：+5/−4。`makeCommitCursor` 拒绝大于 9,999,999,999 的序号；注释改为十位、超出拒绝。
- 新增 `tests/work-graph/S5-goal-cause-at-least-cursor.test.ts`（63 行）与 `tests/contracts/ledger-cursor.test.ts`（19 行）。

**新增测试**
D85-5a：past 为 `not_ready`；恰为 LAST 为 `ready` 且与无游标相同；更早游标 `ready` 且相同；`forbidden`/`not_found` 优先。
D85-5b：拒绝 100 亿；最大十位可回读；1 补足十位。

**先失败**
D85-5a 第一条先失败：修复前返回 `ready` 而非 `not_ready`。D85-5b 第一条先失败：修复前不抛错，生成 11 位游标。

**检查**
指定 10 个文件共 148 项全过；`npm run typecheck` 通过；`npm run check:architecture` 通过。副本缺 `vendor/coding-agent/node_modules` 的 zod/openai，已从本机现有安装补齐（未入库），否则测试无法加载。

**UNSPECIFIED**
用例只跑 memory，未跑 sqlite；世界中无另一 workspace 的 Goal，按要求未另造；外部项目/不存在 Goal 的 id 取 `another-project`/`missing`。