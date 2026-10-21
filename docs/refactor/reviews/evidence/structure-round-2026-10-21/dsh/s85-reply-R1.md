# S85 结构轮返工 1 回复（决定 80；lead，2026-10-21）

## 问题

无阻塞问题。一点说明：P2 的确定性补丁（`make-deterministic.mjs`）只加在
`.dsh-scratch/R1/base` 与 `.dsh-scratch/R1/result-1` 两个探针副本里，把
`mkdtemp` 的随机后缀和两处 `new Date()` 换成固定值（书 §5.0 规则 3 允许的
“同一编辑使源确定”），没有进入工作树；比较的仍是原始 UTF-8 字节，没有用模式
抹掉任何值。

## 摘要

P1-01、P3-01、P3-03、P4-01 已按表修复；P2-01、P2-02 只改证据探针。四个生产
提交文件之外没有改动，`tests/` 与 allowlist 一行未动。base 与结果副本的 P4
渲染输出 4/4 字节相同；生成模块的差异只有 7 处 `mentionsTools` 断言和 1 处
P4 模板串；P1 的差异只有一行。C2 探针现在记录每次被包装的 store 调用的
结果或抛错，以及四个循环的返回结果；base 跑两遍、结果副本跑一遍，7 个文件
加合并日志全部原始字节相同（0 差异），必需探针 0 缺失、计数 0 不符。48 个
测试文件（44 个 r1-tests + 4 个 `tests/architecture`）471 项全过，0 失败，无环境失败。范围检查
干净：`n1-merged..HEAD` 只有 §2 的 7 个文件，`tests/` 无差异，`git status`
为空；+21/−17，净 +4。

## 每条 finding

| Id | 状态 | 位置 | 证据 |
|---|---|---|---|
| P1-01 | 已修 | `src/core/agent-runtime/observed-model-run.ts:282` | 一行改为 `hasMaterialTools: hasRead && reviewSource && !!o.materialTools`；base 同处是 `hasRead && reviewSource ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...]`（base `:301–303`）。diff 只有这一行。 |
| P2-01 | 已修（仅证据） | `.dsh-scratch/R1/probes/c2/apply-probe.mjs` | 每次 `readMany`/`lookup`/`lookupOrdered`/`eventAt` 调用的参数、结果或抛错都入日志；四个循环 `readActivityCalendar`/`readRunActivities`/`readTrackBars`/`readTaskStateTimeline` 的返回也入日志；序列化保序并显式标记 `undefined`。1,018 行/轮。 |
| P2-02 | 已修（仅证据） | `.dsh-scratch/R1/probes/c2/compare.mjs` | 除原始字节比较外，按 `test+tag+kind` 统计两侧行数；base-run1 出现过的键和四个 `*-result` 标签任一侧为 0 即 `MISSING probe` 并退出非 0。14 次比较 0 MISSING、0 计数不符；负向自测（空日志 16 MISSING；仅 store 日志 + `--require-loop-results` 四个循环标签 MISSING）均触发。 |
| P3-01 | 已修 | `src/contracts/prompts/render-template.ts:200–206` | 必需槽检查改为遍历 `Object.keys(table)`，`required` 为真且 `undefined`/`''` 时抛原错误文本。结果副本探针 `tests/zz-p3-probe.test.ts` 两项通过：表中必需但模板正文未用的 `workspaceLines` 为 `undefined` 时抛 `required slot "workspaceLines" is empty in template "unknown-call-review"`；七个 v1 模板按调用方槽位都能渲染。 |
| P3-03 | 已修 | `scripts/build-platform-prompts.mjs:96–98`；`src/contracts/prompts/platform-pack.generated.ts:13,18,23,28,33,38,43` | 生成器改为 `[names] as [names]`；重新生成后 6 个 `[] as []`、1 个 `["propose_safer_method"] as ["propose_safer_method"]`，可赋给 manifest 的 `string[]`，字面量类型保留。 |
| P4-01 | 已修 | `resources/prompts/platform/templates/unknown-call-review.txt:10`；`src/contracts/core/prepared-execution.ts:191`；`runtime-assets.json:84` | 模板行改为 `### 要核对的调用{{items}}`，`{{items}}` 独立行删除；调用方传 `itemLines.length === 0 ? '' : '\n' + itemLines.join('\n')`。模板 `version` 仍为 1。重新生成模块；资源哈希按 raw byte SHA-256 更新为 `20f73792…b3ad`。 |

P1-02、P2-03、P3-02 的结论分别是 rejected / closed / rejected，按要求未动。

## 字节证明

### P1-01

```diff
-      hasMaterialTools: o.materialTools !== undefined,
+      hasMaterialTools: hasRead && reviewSource && !!o.materialTools,
```

同一处 base（`s85-base:src/core/agent-runtime/observed-model-run.ts:301–303`）：

```ts
const enabledNames = hasRead && reviewSource
  ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...readTools, ...]
```

新 helper 仍是同一条件、同一真值测试；`additionalTools` 回调里的
`o.materialTools?.(workspace)` 读取保持不变。

### P3-01

结果副本 `.dsh-scratch/R1/result-1` 中运行
`tests/zz-p3-probe.test.ts`（源文件
`.dsh-scratch/R1/probes/p3/probe.test.ts`）：2 passed。第一项是“表有必需槽、
正文不用、传 `undefined`”必抛；第二项逐一渲染
`initial-planning-answer`、`continuation-brief`、`unknown-call-review`、
`unknown-call-proposal`、`consultation-received-input`、`user-decision-response`、
`scribe-reminder`，全部非空且不抛。各调用方路径另由本次 45 个测试文件覆盖。

### P3-03

`git diff n1-merged HEAD -- src/contracts/prompts/platform-pack.generated.ts`
共 8 行增删：7 行 `mentionsTools` 断言（6 处 `[] as []`、1 处
`["propose_safer_method"] as ["propose_safer_method"]`）加 1 行 P4 的
`unknown-call-review` 模板串。没有别的生成内容变化。

### P4-01

探针：`.dsh-scratch/R1/probes/p4/probe.test.ts`，同一文件复制进 base 与
`result-1` 的 `tests/zz-p4-probe.test.ts`，各自用本副本源码调用
`renderUnknownCallReviewZh`，输出写到 `probes/p4/{base,result}/`。按 UTF-8
buffer 比较：

| 用例 | base 字节 | result 字节 | 结果 |
|---|---:|---:|---|
| review，`items: []` | 613 | 613 | 相同 |
| review，full + truncated + unexpanded 各一 | 1,196 | 1,196 | 相同 |
| proposal，无 targets | 556 | 556 | 相同 |
| proposal，有 targets（含 personText/annotations/platformTargets） | 804 | 804 | 相同 |

4/4 相同，0 差异；`review-empty` 的 SHA-256 前缀 `49bede55…`，四份输出逐字节
相等。模板 `version` 保持 1。

### P2-01 / P2-02

探针与报告：`.dsh-scratch/R1/probes/c2/report.md`；脚本
`apply-probe.mjs`、`make-deterministic.mjs`、`compare.mjs`、`run.sh`；原始日志
`logs/{base-run1,base-run2,result-run1}/` 和 `run-deterministic.out`。

| 探针（包装对象） | 文件（base 行） | base-run1 调用数 | base1=base2 | base=result |
|---|---|---:|---|---|
| activity record port（参数+结果/抛错） | `views/activity-read-model.ts:762`（用于 773/775/777、798/800/802） | 262（readMany 158、lookup 38、lookupOrdered 64、eventAt 2） | 相同 | 相同 |
| calendar `now()`（调用+结果） | 同文件 `:763`（调用 775） | 26 | 相同 | 相同 |
| track record port（参数+结果/抛错） | `views/track-read-model.ts:1165`（用于 1174/1176/1178） | 259（127/96/36） | 相同 | 相同 |
| task timeline record port（参数+结果/抛错） | `views/task-state-timeline.ts:539`（用于 548/550/552） | 389（135/216/38） | 相同 | 相同 |
| calendar 循环结果 | `activity-read-model.ts` factory 759 / wrapper 817 | 19 | 相同 | 相同 |
| Run activity list 循环结果 | 同文件 wrapper 818 | 11 | 相同 | 相同 |
| track 循环结果 | `track-read-model.ts` factory 1164 / wrapper 1194 | 15 | 相同 | 相同 |
| task timeline 循环结果 | `task-state-timeline.ts` factory 538 / wrapper 567 | 37 | 相同 | 相同 |

每轮 1,018 行；四个循环结果共 82 行。被包装的 store 调用在这些文件里没有
抛错（`error=` 0 行），1,018/1,018 行都带 `result=`。

| 文件 | base-run1 字节 | base-run2 字节 | result 字节 | base1=base2 | base=result |
|---|---:|---:|---:|---|---|
| `S2B-activity-read-faults` | 307,872 | 307,872 | 307,872 | 相同 | 相同 |
| `S2B-r2-27-moving-window` | 379,980 | 379,980 | 379,980 | 相同 | 相同 |
| `S2B-r2-keyed-cap` | 79,294 | 79,294 | 79,294 | 相同 | 相同 |
| `S2B-r2-r7-keyed-read-cap` | 137,316 | 137,316 | 137,316 | 相同 | 相同 |
| `S2B-33-task-timeline-pagination` | 127,064 | 127,064 | 127,064 | 相同 | 相同 |
| `S2B-r2-r4-bound-workspace` | 55,204 | 55,204 | 55,204 | 相同 | 相同 |
| `S2B-35-activity-routes` | 100,901 | 100,901 | 100,901 | 相同 | 相同 |
| 合并（固定文件顺序） | 1,187,631 | 1,187,631 | 1,187,631 | 相同 | 相同 |

差异 0/7、0/7、合并 0/1；必需探针 0 缺失，计数 0 不符。三轮各 42 项通过
（6、8、4、4、12、4、4），无 `TEST-FAIL`、无 `ENOENT … bwrap`。

## 测试

单条命令、`timeout 900 npx vitest run --maxWorkers=2 <≤10 files>`，共 5 条：

| 批次 | 文件数 | 通过文件 | 通过项 | 失败 |
|---|---:|---:|---:|---:|
| 1（r1-tests 1–10） | 10 | 10 | 96 | 0 |
| 2（11–20） | 10 | 10 | 65 | 0 |
| 3（21–30） | 10 | 10 | 70 | 0 |
| 4（31–40） | 10 | 10 | 105 | 0 |
| 5（41–44 + `tests/architecture`） | 4 + 目录 | 8 | 135 | 0 |
| **合计** | **44 + 4** | **48** | **471** | **0** |

环境失败：0。另 `npm run typecheck`、`npm run check:architecture`、
`npm run build`（先跑 pack `--check`）全部通过。

## 范围检查

- `git diff --name-only n1-merged HEAD`：只有
  `resources/prompts/platform/templates/unknown-call-review.txt`、
  `runtime-assets.json`、`scripts/build-platform-prompts.mjs`、
  `src/contracts/core/prepared-execution.ts`、
  `src/contracts/prompts/platform-pack.generated.ts`、
  `src/contracts/prompts/render-template.ts`、
  `src/core/agent-runtime/observed-model-run.ts`。
- `git diff --name-only n1-merged HEAD -- tests`：空。
- `git status --porcelain`：空。
- 提交：`c03f595 S85 S1 fix: P1-01`、`b35e077 S85 S3 fix: P3-01 P3-03 P4-01`
  （未 amend、未 reset；`.dsh-ref/`、`.dsh-scratch/` 未提交）。

## 改动行

| 文件 | 增 | 删 |
|---|---:|---:|
| `src/core/agent-runtime/observed-model-run.ts` | 1 | 1 |
| `src/contracts/prompts/render-template.ts` | 4 | 1 |
| `scripts/build-platform-prompts.mjs` | 5 | 3 |
| `src/contracts/core/prepared-execution.ts` | 1 | 1 |
| `src/contracts/prompts/platform-pack.generated.ts` | 8 | 8 |
| `resources/prompts/platform/templates/unknown-call-review.txt` | 1 | 2 |
| `runtime-assets.json` | 1 | 1 |
| **合计** | **21** | **17** |

净 +4 行（相对 `n1-merged`）。
