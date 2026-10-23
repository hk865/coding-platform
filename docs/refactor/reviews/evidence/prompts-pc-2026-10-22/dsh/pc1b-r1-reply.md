# PC-1b R1 回复（返工 1，2026-10-22 夜）

## 1. 结论

- **P、S、R、联合、PC-15、L-02/L-03/L-04：完成。** 每个测试行都按“改测试 → 施加命名变异 → RED → 撤销 → GREEN”做过，提交里没有留变异。
- **J-07 部分完成（规则 6）。** 删掉 6 个导出、私有 `DEFAULT_BRIEF_TEXTS` 和 7 条 allowlist；`CONTEXT_SECTION_HEADERS` 及其 1 条 allowlist 保留，见 §7.1。J-08 完成。
- **A1 在改动前就红。** `tests/scenarios/A1-rework-same-session.test.ts:65` 期望 `stopped`、实得 `waiting`；在干净的 `pc1b-base` 归档上同样红，不是本轮引入，见 §7.2。
- 两次提交；工作区干净；范围与冻结夹具检查通过；没有 bwrap/ENOENT 环境失败。

## 2. 逐行 RED → GREEN

### P（10 行 + L-03）

- **P-01**（`PC-prepare-architecture-reminders`，“keeps the injected no-observation text”）：变异为 `architectureReminderRowEntries` 的 no-observation 行再读 `PLATFORM_PROMPT_PACK_V1` → RED（得到 `还没有观测`，期望字面 `CUSTOM`），撤销后 GREEN。渲染链（kind labels、时间、omission、observation suffix）都改为接收 `PromptTextsV1`，准备传解析后的包；无参纯调用保留平台默认，旧 `S8A-L8-reminders-pure` 23/23 仍过。
- **P-03**（`PC-prepare-skill-selection`，“normalizes a padded platform id”）：变异为删掉平台分支的 `.trim()` → RED（` platform-secretary ` 被判未知 id），撤销后 GREEN。
- **P-05**（`W2-role-skills`）：恢复 base 的真实请求断言（secretary+scribe、显式空选择、错误场景 `model.calls()===0`）和 `60_000` ms；变异为只保留 `enabledIds[0]` → RED（scribe 缺失），撤销后 GREEN。
- **P-06**（`PC-prepare-skill-selection`、`PC-prepare-review-freeze`、`PC-prompt-texts-store`）：平台 Skill 正文、review 字符串、base 和 Skill 都用与生成包不同的字面量，冻结内容/元数据/`source` 用字面值和对字面量算的 sha256 核对；变异分别为选择器忽略传入 texts 读生成包、review 用生成 strings 渲染、store 写生成 Skill 正文 → 均 RED，撤销后 GREEN。
- **P-07**（`PC-prompt-texts`、`PC-prompt-texts-store`）：摘要负例改成等 UTF-8 字节长但摘要不同（`你好`/`世界`、`SAME_TEXT`/`DIFF_TEXT`），另留独立长度负例；变异为删掉 `checkPromptBody` 的正文摘要检查 → 两文件 RED，撤销后 GREEN。
- **P-08**（`PC-entry-frozen-continuation`、`PC-entry-frozen-review`）：各自注入入口重渲染实际会用的字面串（`brief.summary.lead`、`k3.workspace.statusLead`），准备后改包，再启动，断言冻结串进入模型输入；变异为入口用冻结模板配生成包 strings → RED（启动被拒），撤销后 GREEN。
- **P-09**（`PC-entry-frozen-continuation`，“answers unavailable when only the entry cannot read”）：真实公开准备后只让入口那一步的第一次 prompt-text 读失败（driver 的读成功）；变异为删掉入口自己的不可读分支（继续用空串）→ RED（`invalid`，期望 `unavailable`），撤销后 GREEN；模型 0 次。
- **P-10**（`PC-prepare-prompt-freeze`，Work+Query）：用可暂停、计数的 `PromptPackSourcePort`，暂停时改原配置对象；变异为 await 后才读 selection/provider/model → RED；变异为 resolve 两次 → RED（`calls()===2`）；撤销后 GREEN。Work 的 snapshot `selection` 用 `snapshotRuntimeConfiguration` 纯函数核对（准备没有公开 snapshot 读口，见 §7.6）。
- **P-11**（`PC-prepare-prompt-text-put-failure`，Work+Query）：用夹具的 `failPutContentType` 让 `PROMPT_TEXT_CONTENT_TYPE` 的 put 失败；变异为把该失败映射成 `invalid` → 两例 RED，撤销后 GREEN；准备 `unavailable`、没有可启动结果、模型 0 次。
- **P-12**：只改 `execution-preparation.ts` ~62 与 `query-preparation.ts` ~160 两处注释：缺 source 安装平台默认，不是 `unavailable`；无测试/变异。
- **L-03**：按探针把 `prompt-set-texts.ts` 改成 `options.kernel?.FileSkillLoader ?? FileSkillLoader`（从 `vendor/coding-agent/dist/public-api.js` 导入），删掉 `unavailable` 分支；`PC-prepare-skill-selection` 6/6、`R3c-plan-adoption` 2/2 绿。

### S（12 行；S-04=L-01，S-05=PC-15）

- **S-01**（`PC-send-start-check`，“refuses a selection-less start binding prepared as test/test…”）：删掉 `execution-driver.ts`/`query-execution.ts` 两处 `selection === undefined` 早退；变异为重新加回早退 → RED（`ready`，期望 `rejected/forbidden`），撤销后 GREEN；模型 0 次。`S3-prepared-context-admission` 通过 L-04 的夹具参数用同一绑定，14/14 绿。
- **S-03**（`PC-model-budget-preview`，“reports fits=false without reserving”）：`measure` 现在返回 cap、count、`fits`，preview、`wrap` 容量检查和请求事实都取同一结果；变异为 `fits` 漏掉 output cap → RED（`true` vs `false`），撤销后 GREEN。
- **S-04 / L-01**（`PC-host-prompt-selection`）：删掉 `existsSync` import 和存在性断言，保留重导出与绝对路径断言；变异为把断言加回并在干净检出条件（临时移走空 `resources/skills`）下运行 → RED，恢复后 GREEN。
- **S-06**（`PC-model-budget-preview` 平台公开准备/启动用例）：真实 `read` 工具调用、第二次模型请求；计数 700、第一次输出用量 200；字面断言请求与记录上的 cap `[256,200]`、成本 `[956,900]`；变异为测量忽略 `totals`（每请求新 meter）→ RED（`[256,256]`），撤销后 GREEN。
- **S-07**（`PC-send-frozen-prompt`、`PC-send-platform-root`）：注入字面模板/strings/Skill/Host 指令，手拼完整 system 和整段 input，整段比较；Work 和 Query 都断言旧 Skill 仍在；变异为发送端 `skills: []` → 4/4 RED，撤销后 GREEN。
- **S-08**（`PC-send-start-check`）：补 Query 单独改 provider、单独改 model；有活句柄且换绑定 resume → `forbidden`；无活句柄 → 先 `busy`；Query 进入后只 observe。四个变异（删 provider/model 比较、删 busy 返回、把 observe 换成拒绝等）分别 RED，撤销后 GREEN；每例新增模型 0 次。
- **S-09**（`PC-joint-record-and-failure` PC-10）：另断言 Work authorization=0、Query usage/admission/reservation=0，公开读 `requests: []`；变异为把 tool-spec put 挪到 reservation 之后 → RED（Query usage 0→2），撤销后 GREEN。
- **S-10 / J-03**（`PC-joint-freeze-and-pin` PC-07）：公开 `observeRun` 断言 `desiredState=paused`，正常 `await` 第一次 start（不再吞错），resume 后请求数恰好 +1、requestId 不同、system 与第一次逐字节相等；变异为 resume 只返回 observation（`resumeEntered=false` 并关掉 busy 守卫）→ RED（轮询停在 1），撤销后 GREEN。
- **S-11**（`B1-kernel-assembly`）：超时恢复 `60_000`；无行为变异，6/6 绿。
- **S-12 / S-13**：静态。删掉外部 `onContextSelected` 选项与转发（grep 只剩内部 Kernel 回调），删掉 `enabledIds` 过时注释分句；typecheck 绿。
- **L-02**：`S1-workflow-archive-fixture.ts` 在 runtime 构建前写 `base.directory/skills/b2-trusted-skill/{skill.json,content.md}`（按探针）；变异为删掉这段 → S1-archive 2 处 `ENOENT .../skills` RED，恢复后 archive+maintenance 18/18 绿。
- **L-04**：改了 `tests/helpers/task-claim-fixture.ts`（`preparationHost` 增加可选 `model` 绑定，默认不变）和 `tests/helpers/S2B-runtime-steps-fixture.ts`（把 start 配置的 model 传给准备）；`S3-prepared-context-admission` 测试文件本身未改，14/14 绿。

### R（13 行；R-03 按裁定 rejected）

- **R-01**（`A2-step1-codecs` + `B2-model-request`）：Work prompt 校验对 `toolSpecsRef` 及其 `source` 做精确键集合检查；授权输入、许可快照、授权事件的嵌套未知键分别拒绝；变异为退回普通 `isArtifactRef`（不查键集合）→ RED 2，撤销后 GREEN。
- **R-02**（`PC-query-record-usage` 的 it.each，公开 `bindPreparedQuery`）：`loadQueryManifest` 解码 `promptSet`；缺失/损坏在 bind 为 `invalid` 且状态不前进；变异为删掉 `decodePromptSetV1` → RED 2，撤销后 GREEN。
- **R-04**（`PC-query-record-usage`）：`readPromptRecord` 在读缓存前先校验 `target.contentType`；同 digest、同 size、另一 contentType → `invalid`；变异为删掉该检查 → RED 1，撤销后 GREEN。
- **R-05**（`PC-read-record-work-query`）：无依赖 `createAgentRuntime().port.readPromptRecord` 校验 ref，完整 WorkRef 返回 `unavailable`“model request reads are not wired”；变异为恢复 basePort 的 `unsupported` 骨架 → RED 1，撤销后 GREEN。
- **R-06**（`PC-record-model-request-facts`）：改用 `ModelRequestReadPort`，删掉直接 `records.readMany`；变异为读口返回改了 `systemDigest` 的事实 → RED 1，撤销后 GREEN；随后公开消费断言保留。
- **R-07**（同文件）：claim 槽位期望改成手写 JSON（普通字符串/原生 `JSON.stringify` 手写对象），不用 `canonicalJson`；变异为用 `JSON.stringify` 重算 key → RED 1，撤销后 GREEN。
- **R-08**（`PC-record-model-request-facts` / `PC-record-model-request-read`）：先连续授权两条并断言第二条 `sequence: 2`，再消费第一条，保留最终公开读；变异为只统计已消费许可 → RED 4，撤销后 GREEN。
- **R-09**（`PC-query-record-usage`）：usage 的每个不可变事实（`requestDigest`、`reservedInput`、`reservedOutput`、每个 prompt 事实）单独改 → `idempotency_conflict` 且公开读保持原行；admission 的每个 prompt 事实单独改 → 冲突，`requestDigest` 仍 `invalid`；变异为 usage 只比 `requestDigest` → RED 1，撤销后 GREEN。
- **R-10**（`A2-step1-codecs`）：快照和事件的拒绝矩阵补 `selection.budget` 缺失和非法值；变异为删掉 budget 值检查 → RED 1，撤销后 GREEN。
- **R-11**（`PC-query-record-codec`）：每个新字段单独坏、每层未知键、第一条合法第二条坏的列表；变异为只校验 `requests[0]` → RED 1，撤销后 GREEN。
- **R-12 / J-05**（`PC-joint-record-and-failure` PC-09）：每条请求的工具 JSON、工具正文、`toolsDigest`、`toolSpecsRef.digest` 互相核对，每条 `systemDigest` 对手拼 system；变异为 Query `toolsDigest` 换成 `'a'.repeat(64)` → RED，撤销后 GREEN。
- **R-13**（非联合部分 `PC-read-record-work-query`，联合部分 §2 J）：汇总 set 与请求引用的全部 digest，严格比较 `texts` 键集合，再逐 body 验 sha256；变异为跳过模板和字符串表读取（`runtime.ts` ~648/~652）→ RED 2，撤销后 GREEN。
- **R-14**（`PC-joint-record-and-failure`）：重放捕获的 Query reservation 原命令，只改一个合法的新 prompt 事实 → `idempotency_conflict`；变异为幂等指纹漏掉 prompt → RED（重放被接受），撤销后 GREEN。

### J（5 行；J-03/J-05/J-06 已归入 S-10/R-12/S-05）

- **J-01**（`PC-joint-prepare-freeze`）：Work/Query 改真正的段标签（`context.section.goal`）和 Skill 文件，准备后整个 system/input 与手写字面比较，正向断言旧 Skill，逐个核对手算 digest（templates/strings/base/Skills）；变异为发送端丢 Skills → 2 失败/2 通过，撤销后 GREEN。
- **J-02**（同文件）：continuation 与 K3 review 走冻结夹具；准备前注入、准备后改 `brief.summary.lead`/`k3.workspace.statusLead`，入口成功且模型收到手写冻结串；变异为入口用平台默认 strings → 2 失败，撤销后 GREEN。
- **J-04**（`PC-joint-freeze-and-pin` PC-08）：注入字面 base/Skill、无 Host 指令，手写旧绑定完整 system；安装新绑定后仍与该字面相等；变异为发送前给 base 追加 `PC_CORRUPT` → RED，撤销后 GREEN。
- **J-07**：见 §7.1（部分完成）。
- **J-08**：7 条 allowlist 从 `wire-format` 改为 `kept-for`，note 用 `slice 6 of the orchestration design (decision 83, prompts and context): <consumer>; E3 adds the route`；3 个 `PromptRecord*` 保持 `wire-format` 并修正 reader 说明；`tests/architecture` 53/53 绿。

### L

- **L-01**：同 S-04。
- **L-02**：见 §2 S 的 L-02。
- **L-03**：见 §2 P 的 L-03。
- **L-04**：见 §2 S 的 L-04。

## 3. PC-15（新 `tests/runtime/PC-joint-budget-removal.test.ts`）

**(a) 平台用例（Work，冻结夹具公开步骤）**

字面量：`EXPECTED_INPUT_1`、`EXPECTED_INPUT_2`、`EXPECTED_TOOLS`。手算：

- `e1 = 2136`、`e2 = 8220`、`t = 14993`；
- `hostLength = 16_564 + e1 = 18_700`；
- `W = 21_213 + e1 + e2 + t = 46_562`；
- `W + D = 46_562 + 18_700 = 65_262 ≤ 100_000`（任务预算）。

运行结果：run 1 与 run 2 不同 Run、同一 Session；run 2 的 system 精确等于 `"B\n\n" + "H".repeat(18_700)`；只有一条当前 user，内容等于手写 `EXPECTED_INPUT_2`（前 4,000 个 `X` 保留），没有旧 user/assistant message id；run 2 `completed`；`readPromptRecord` 一条请求，`maxOutputTokens: 256`，`selection.inputTokens === selection.budget === 46_306`，删除计数 `historyExchange: 1, historyConclusion: 1`，其余 0。

**base 变异证明**：让 preview 看未合并的 `"B"`、发送前再补回合并 base（复现 base 的晚追加），run 2 不到模型，以 `iterator_threw`（平台投影 `crashed`）失败；撤销后 GREEN。

**(b) `responseFormat`（直接 `runObservedModel` + `PC-frozen-prompt.ts`）**

- 请求：base `"B"`、无 Host 指令、Skill `project-conventions`、`input: 'Q'`、`allowedTools: []`、`responseFormat: {type:'json_object'}`。
- 手算：`236 + 726 + 40 + 4,096 + 256 = 5,354 > 5,314`，删掉一个 reference Skill 后 `236 + 40 + 4,096 + 256 = 4,628` 放入。
- 运行结果：模型收到 `systemPrompt: 'B'`、user `"Q"`、无工具、带 `responseFormat`；meter 一条：`inputBytes: 276`、`reservedInput: 4,372`、`reservedOutput: 256`；报告 `inputTokens: 4,372`、`budget: 5,058`；`removed.skillReference: 1`，其余 0。
- **变异**：`previewRequest: request => o.meter.preview(request)`（不做最终变换）→ 模型 0 次、meter 0 条、`iterator_threw`（`5,098 + 256 > 5,314`）；撤销后 GREEN。
- 所有数字与 `pc15.out.md` §3/§4 一致；没有字段对不上，也没有为了让测试过而调数字。

## 4. 检查（全部在最终树上）

- `node scripts/build-kernel-patch.mjs --check`：**0**（16 源 / 64 产物全 matches）。
- `node scripts/build-platform-prompts.mjs --check`：**0**（`platform prompt pack: OK`）。
- `flock ./.dsh-scratch/tsc.lock npm run typecheck`：**0**。
- `npm run check:architecture`：**0**（`next source boundaries: OK`）。
- `flock ./.dsh-scratch/tsc.lock npm run build`：**0**。
- `git status --porcelain`：空。
- `git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-r1-whitelist.txt`：无输出（exit 1）。
- `git diff --name-only c1c7af4 HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts`：无输出。

## 5. 测试运行（全部 `--maxWorkers=2`，`timeout 900`）

| 批次 | 文件数 | 结果 |
| --- | ---: | --- |
| 批一：P 的准备/发送/读取新改文件 | 10 | **43 通过** |
| 批二：联合、入口冻结、Query/Work 记录 | 10 | **41 通过** |
| 批三：contracts、J-07 四个旧测试、B1/W2/A2/B2 | 10 | **126 通过** |
| A1 单跑 | 1 | **1 失败**（见 §7.2，base 上同样失败） |
| 批四：31 文件余下（AG6、section-order、cpp、C2、K3-35、B2） | 6 | **27 通过** |
| 批五：R4c×3、source-text、source-tool | 5 | **55 通过** |
| `tests/architecture` | 4 | **53 通过** |
| 指定回归：S1-archive、S1-maintenance、R3c、PC-host、S3-admission | 5 | **39 通过** |

- 31 个 PC-1b 改动文件全部覆盖（批一/二/三/四/五 + S3-admission）。
- 环境失败：**无**；没有出现 bwrap/ENOENT。
- 唯一红的是 A1，且不是本轮引入（§7.2）。

## 6. 提交与范围

- `9fe7eb3` `PC-1b R1: P, S, R`（38 文件，+1,353/−380）。
- `1b5183a` `PC-1b R1: joint, PC-15, J-07, J-08`（13 文件，+943/−226）。
- 从 `c1c7af4` 到 HEAD：50 文件，+2,296/−606。
- 白名单内没有越界文件；两个冻结夹具没有改；没有改旧测试的超时上限（B1/W2 恢复为 60,000）。

## 7. 不适配 / UNSPECIFIED（规则 6）

### 7.1 J-07 只完成 6/7 个导出

`CONTEXT_SECTION_HEADERS` 没有删，`tests/architecture/production-reach-allowlist.json:1278` 也保留。原因：除 J-07 点名的 `tests/runtime/S3-context-assembler.test.ts` 外，它还被 **`tests/runtime/S4C2-assembly.test.ts:29`（使用于 `:358`）** 和 **`tests/work-graph/S3-role-profiles.test.ts:39`（使用于 `:206`）** import；这两个文件不在 `pc1b-r1-whitelist.txt` 里，也不在 J-07 点名的四个旧测试里。删掉会得到 TS2305，且按规则 3 不能改它们。其余 6 个导出（`REWORK_FAILURE_CLASS_LABELS_ZH`、`REWORK_ACTOR_CLASS_LABELS_ZH`、`CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1`、`WORK_CONTEXT_PRELUDE`、`QUERY_CONTEXT_PRELUDE`、`INITIAL_COORDINATION_RESPONSE_GUIDE`）、私有 `DEFAULT_BRIEF_TEXTS` 和 7 条 allowlist 已删；四个点名旧测试改为字面期望。J-07 的变异证明：把 `REWORK_ACTOR_CLASS_LABELS_ZH` 的 allowlist 条目加回 → RED（“is reached now or gone”）；只把该导出加回 → RED（unreachable）；撤销后 GREEN。

### 7.2 A1 在 base 上已经红

`tests/scenarios/A1-rework-same-session.test.ts:65` 在 `advance(..., {stopBefore: performs('requeue_task')})` 处期望 `stopped`、实得 `waiting`（`AssertionError: expected 'waiting' to be 'stopped'`）。我在 `git archive pc1b-base` 的干净副本里补上 `resources/skills` 和 `vendor/coding-agent/node_modules` 后运行，**同样 1 失败**，失败行和错误文本一致；所以不是本轮 P/S/R/联合改动引入的。J-07 对它只改了第 208 行的字面常量，没有碰前面的行为。这个失败不在本轮任何行的验收范围里，也没有可归因到本轮的变异。

### 7.3 PC-15(a) 的两个平台生成 id

手写的 `EXPECTED_INPUT_2` 在比较前把两个本来就不可能预先知道的平台生成值规范化：continuation brief 的 `sha256:<brief-digest>` 和验证轮次 UUID（`<round-id>`）。其余字节逐字比较。要完全逐字比较，只能在测试里从生产读取这两个值，反而违反“期望值不得来自生产”；这里选择了正则占位 + 其余整段字面比较，作为 UNSPECIFIED 报给 lead。

### 7.4 J-03 的 `.gitignore` 测试设置

`PC-joint-freeze-and-pin` 在夹具临时 workspace 里写 `.gitignore`（`*.sqlite*`）并 `git init/add`，否则 SQLite 文件落在 workspace 内会让 Kernel 拒绝 resume（“当前 workspace 与 Session 记录不兼容”）。这是测试环境设置，不涉及生产；作为 UNSPECIFIED 报给 lead 复核。

### 7.5 其他测试实现说明

- **P-10** 的“Work snapshot keeps `selection`”用 `snapshotRuntimeConfiguration` 纯函数核对，因为 preparation 没有公开的 snapshot 读口；公开准备用例已分别覆盖原 selection/provider/model 与 resolve 恰好一次。
- **R-04** 用真实 Query 准备 + `bindPreparedQuery` + `readPromptRecord`，通过 fault-injected body store 把 base ref 指到模板的 digest/size 但换 contentType；另用一次性的 B2 fixture 提供 Runtime 依赖，不共享任何记录。
- **S-11/S-12/S-13** 是静态改动（超时恢复、删外部选项/过时注释），没有可观察的行为变异；由 typecheck 和 B1 的 6/6 证明。
- 没有子 agent 遗留的变异：所有临时生产改动都撤销，`git diff -- src` 为空；`1b5183a` 的 src 改动只有 J-07 的 4 个文件（`continuation-brief.ts`、`context-assembler.ts`、`context-rendering.ts`、`query-preparation.ts`）。
