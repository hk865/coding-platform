# EU-1 变异验证（已执行并成立）

外审 §3.3 的 EU-1：修复批次内改过 `tests/app/explorations.test.ts`，修改前字节缺失，
需用变异方法证明当前回归测试仍能捕获该修复机制失效。

## 此前一次尝试不成立（保留为本目录的失败前例）

`../eu1-mutation.log`（2026-09-10 02:17）与 `../eu1-mutation-workspace-copy.log`（02:19）
的结论**不能采信**：全部 7 项失败都是 `timed out`，`AssertionError` 计数为 0，
且失败载荷为 `run_crashed / 隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。`

原因不是变异本身，而是那次运行**没有设置 `CODING_AGENT_BWRAP_PATH`**。
`scripts/test-wsl.sh` 会自行设置该变量，任何绕过该脚本直接调 vitest 的运行都会
让沙箱预检失败。该失败与 `sourcePin` 无关，因此不能区分"变异被捕获"与"环境坏了"。
原始日志不改写，与其结论一并保留。

## 本次验证（成立）

隔离副本 `/tmp/err02-eu1-verify-20260910`，由产品工作树复制 `src/ tests/ scripts/`
与根配置，`.local`／`vendor/coding-agent`／`node_modules` 以链接接入；产品工作树未被改动。

变异（`eu1-mutation.diff`）：`src/context/exploration-context-compiler.ts` 的
`basis` 去掉 `sourcePin: source.pin`，只留 `sourceDigest`。

| 运行 | 命令（副本内） | 结果 |
| --- | --- | --- |
| 变异体 | `CODING_AGENT_BWRAP_PATH=… bash scripts/test-wsl.sh tests/app/explorations.test.ts` | **exit 1，8 项中 2 项失败**（见 `eu1-mutant-run.log`） |
| 对照（同副本、恢复为产品原字节） | 同上 | **exit 0，8/8 通过**（见 `eu1-control-run.log`） |

变异体失败的正是外审所指的两项回归：

- `executes a real read-only dependency chain, requires operator review and preserves reports across restart`
- `inherits only directly required applied PASS review notes, keeping reports and failed-goal history separate`

且失败是**机制级**的：下游 Run 以
`run_crashed：执行前材料校验失败：跨运行材料不可读或来源版本已失效`
结束——去掉 `sourcePin` 后跨运行材料适用性失效判定不再工作。
本目录变异体日志中 `隔离环境不可用` 出现 **0** 次，说明沙箱可用，失败与 EU-1 的
环境前例无关。

结论：当前 `tests/app/explorations.test.ts` 能捕获探索来源 pin 修复机制失效，
该回归测试未被削弱。这与 E-1 恢复出的修改前字节（见 `../E-1-recovered-original/`）
相互印证：2026-09-09 的改动是**加强**而非削弱该测试。
