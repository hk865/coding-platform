# PC-1a R1 回复（A1/A2/A3 的 16 个 fix 行）

## 1. 摘要

16 个 fix 行全部处理；A2-01 按裁定保持原样，`composition-contracts.ts` 未改。生产改动只有
`context-selection-policy.ts`（A1-07/A1-08）和 `src/app/host.ts`（A3-01 删除 `runtime` 出口），
其余是测试、重新生成的 `dist` 和 allowlist 注记。提交一条：`dd89733`
`PC-1a R1: A1-01..08, A2-02..04, A3-01..05`。HEAD 之前是 `afff716`，工作区干净。

## 2. 逐行

- **A1-01 完成。** 测试：`tests/kernel/PC-14-task-input-current.test.ts` 的
  “keeps both current user messages and the current tool exchange, and drops run 1”。改为冻结夹具
  `createKernelHarness`：同一 Session 先完成一次历史 Run，再跑当前 Run；工具循环里通过
  `inputs.enqueue` 注入 `input-injected-1`，紧预算计数为“含历史 900、不含历史 700，reserve 100，
  window 900”。断言模型实际收到的请求里两条用户消息（任务输入的真实 id、注入输入的
  `input-injected-1`）及正文都在，工具交换还在，第一次 Run 的正文不在；报告 `historyExchange: 1`、
  `historyConclusion: 1`。变异：删除 `runtime-runner.ts` ~656 的
  `state = await this.#acceptSuppliedInputs(state, context);`。RED：请求里只剩任务输入，注入消息缺失。
  恢复后 GREEN。
- **A1-02 完成。** 测试：`PC-12-tool-result-placeholder.test.ts` 新增
  “PC-12 hand-computed eligibility cases” 5 例：长 error/cancelled 在可替换 success 前；与占位正文
  等长的输出；UTF-8 字节长度与字符长度在占位长度两侧相反的 29 个“中”；非 `read` 的工具名；
  两调用组只有一个长成功结果。预算按手写参照请求逐例分开。变异与 RED：
  硬编码 `read` → 非 `read` 例失败（占位写成 `read`，不是 `grep`）；用
  `JSON.stringify(...).length` 代替 `Buffer.byteLength` → 等长例和多字节例失败；
  `<=` 代替 `<` → 等长例把等长输出错误替换；删除部分闭合组保护 → 部分闭合例把 `p1` 当单位。
  每次恢复后 GREEN。
- **A1-03 完成。** 测试：`PC-17-thinking-replay.test.ts` 的 `selectContext` 两个小输入用例；
  调用前 `structuredClone` 保存 `input`，调用后 `expect(input).toEqual(snapshot)`，覆盖
  `current_run` 和 `none`；真实 `none` Run 另查返回的 `state.transcript` 仍有
  `reasoningContent: "think-three"`。变异：策略 ~157 改成对原 `entry.message` 原地
  `delete reasoningContent`。RED：两个快照比较都失败，真实 none 的状态检查也失败。恢复后 GREEN。
- **A1-04 完成。** 新文件 `tests/kernel/PC-18-thinking-byte-preview.test.ts`（1 例）。历史含 4 条
  thinking-only 消息，过滤后消失；当前含任务输入和完整工具交换；用 `bytePreview` 取临界预算。
  断言每次 preview 看到的请求都已过滤（没有 thinking-only、没有空 assistant），当前交换仍归当前，
  选中的前缀、请求和报告逐字相符。变异 1：`const history = result.length < historyEntryCount`
  （按过滤后位置重算）→ RED，选中请求错误地替换了当前 `c1` 正文。变异 2：先按未过滤内容计量、
  再发出过滤后的请求 → RED，前缀/请求错误。恢复后 GREEN。
- **A1-05 完成。** `PC-11-selection-seven-kinds.test.ts` 只删除第二个只验证测试自身参考的 `it`；
  第一个逐前缀生产对照用例保留并通过。无命名变异。
- **A1-06 完成。** `PC-17` 该用例改名为
  “current_run keeps the selected thinking-only message; DeepSeek sends it and OpenAI has no item for it”；
  断言未改。无命名变异。
- **A1-07 完成。** 删除 `PreviewOutcome.request` 成员及返回对象里的 `request` 属性，预览用的局部
  `request` 保留；`dist` 已由脚本重新生成。
- **A1-08 完成。** 删除策略 ~479–482 的不可达补预览分支，以已缓存的 `high` 结果结束搜索
  （`const chosen = cache.get(high)!`），最终 `fits` 复核保留；`dist` 已重新生成。
- **A2-02 完成。** 测试：`PC-inputs-public.test.ts` 两条
  “same-identity resume: a paused tool loop resumes …” 和
  “public resumeCodingAgent: the same paused tool loop resumes …”。经公开 `runCodingAgent` 先跑真实
  工具循环并产生带 `reasoningContent` 的当前 assistant 消息，在第二次 `before_model` 暂停；恢复时
  `reasoningReplay: "none"`，分别走同身份 `runCodingAgent` 和公开 `resumeCodingAgent`。断言出站请求
  没有 thinking、calls 消息和 toolCalls 还在、返回的 `state.transcript` 仍保留原思考、五项输入都到达、
  报告只在 provider 之前一次。变异：删除 `composition-root.ts` ~352 的 `reasoningReplay` 转发；
  RED：同身份用例在 `"reasoningContent" in assistants[0]` 处失败（出站仍有 thinking）；公开入口
  由 `resume-composition.ts` 转发，仍 GREEN。恢复后两条都 GREEN。
- **A2-03 完成。** `PC-16-hook-recheck-preview.test.ts` 保留原两例，新增
  “reports the re-checked input count: 701, not the first preview's 700”：首个 preview 700、复核 701、
  预留 150，851 在 900 内；provider 收到 150，报告 `inputTokens: 701, budget: 750`，且报告在 provider
  之前恰好一次。变异：`runtime-runner.ts` ~755 保留第一次计数（`inputTokens: selection.report.inputTokens`）。
  RED：新例期望 701，收到 700（budget 仍 750）；原两例通过。恢复后 GREEN。
- **A2-04 完成。** `PC-inputs-public.test.ts` 缺席用例对 `configuration.systemPrompt` 和 provider 请求中
  手写 Skill 段之前的基底分别断言 SHA-256
  `860d951d7f60787371922438b5935842c76ea90aa8a75fdf75d55297727f7cc2`；原有 Skill 断言保留。
  无命名变异，GREEN。
- **A3-01 完成。** 删除 `LocalWorkbenchHost.runtime` 属性、注释和返回项。测试用
  `vi.hoisted`/`vi.mock` 包住公开 `createTargetPlatform`，捕获 `options.runtime` 后调用真实工厂，
  完整 Host 启动、settings 路由和原有断言保留；`grep host.runtime` 无命中。5/5 GREEN。无命名变异。
- **A3-02 完成。** `PC-prompt-set-v1.test.ts` 新增逐字段拒绝表：顶层、templates、strings、base、
  Skills、每处 `ArtifactRef` 的每个字段及 `source`，覆盖缺项、错误类型、未知键；枚举和 digest 的
  非法值也覆盖。变异 1：删除 `prompt-set.ts` ~156 的四个字符串字段校验 → RED
  （`top level: modelId wrong type`）。变异 2：删除 `isRef` 的 contentType/sizeBytes/source 校验 →
  RED（`templates[].ref: contentType wrong type`）。恢复后 16/16 GREEN。
- **A3-03 完成。** `PC-host-prompt-selection.test.ts` 新增真实 `models/save`（字面
  `id: "settings-item-1"`）→ `models/select` → 经捕获的 Host runtime 读回，断言
  `promptSelectionOf(model).modelId === "settings-item-1"`。变异：删除 `host.ts` ~689 的
  `modelId: model.id`；RED：读回 `runtime-b2bc1d533a11bb3f`，旧 4 例仍通过；恢复后 5/5 GREEN。
- **A3-04 完成。** `PC-platform-pack-v2.test.ts` 的 origins 改为一张手写的全部 16 个模板 id、
  `packId: "platform"`、version 1 的字面量表，整体 `toEqual`；不再从 manifest/origins 取键或版本。
  2/2 GREEN。无命名变异。
- **A3-05 完成。** `production-reach-allowlist.json` 的 `PROMPT_TOOL_SPECS_CONTENT_TYPE` 注记保留
  `PC-1b, slice 6 of the orchestration design:` 前缀，消费者改为 `observed-model-run.ts` 发送包装器
  的 `onConfiguration` 正文写入。`production-reach` 4/4 GREEN。无命名变异。

## 3. 检查

- `node scripts/build-kernel-patch.mjs --check`：退出 0，16 个源、64 个产物全部 matches。
- `node scripts/build-platform-prompts.mjs --check`：退出 0，`platform prompt pack: OK`。
- `flock ./.dsh-scratch/tsc.lock npm run typecheck`：退出 0，无错误。
- `npm run check:architecture`：退出 0，`next source boundaries: OK`。
- `flock ./.dsh-scratch/tsc.lock npm run build`：退出 0。
- 改动/新增的 10 个测试文件：10 files，44 tests，全部通过。
- `tests/kernel`（23 个文件，分 3 批）：173 tests，119 过，54 失败，全部是环境失败（见下）。
- `tests/app`（65 个非 scale 文件，分 7 批）：369 tests，359 过，10 失败，全部是环境失败（见下）。
- `tests/contracts`：8 files，103 tests，全过。
- `tests/architecture`：4 files，53 tests，全过。

## 4. 环境失败（无 bubblewrap）

本机没有 `/usr/bin/bwrap`，也没有 systemd user session。以下失败均属此类，未计入代码失败：

- `tests/kernel/K-readonly-sandbox.test.ts` 15 项：
  `AssertionError: read-only sandbox unavailable: ENOENT: no such file or directory, access '/usr/bin/bwrap'`。
- `tests/kernel/RL-01-02-caps-effect.test.ts` 4 项：`RL RE1 environment unavailable (no bubblewrap / systemd user session): ENOENT … '/usr/bin/bwrap'` 或 `ProcessSandboxError: 隔离进程能力不可用`。
- `tests/kernel/RL-03-05-oom-pids.test.ts` 5 项：`隔离进程能力不可用`，以及缺 bwrap 时的 cap 探测断言 `expected false to be true`。
- `tests/kernel/RL-06-11-stop.test.ts` 17 项：`RL RE1 environment unavailable … ENOENT … '/usr/bin/bwrap'`。
- `tests/kernel/RL-12-15-conditions.test.ts` 11 项：bwrap ENOENT、`隔离进程能力不可用`，以及缺 bwrap 导致的探测原因差异（如期望 `no_user_session` 得到 `no_cgroup_v2`）。
- `tests/kernel/RL-15c-gate-stream-error.test.ts` 2 项：`RL RE1 environment unavailable … process exited 127`。
- `tests/app/A2-automation-verdict.test.ts` 2 项：`run_check` 被 `unsupported` 拒绝，
  `ENOENT … '/usr/bin/bwrap'`；另一项停在等待 `finalize_checks`。
- `tests/app/A2-requeue-route.test.ts` 1 项：check 无法运行，Task 停在 `verifying` 而不是 `failed`。
- `tests/app/A2-reverify-route.test.ts` 1 项：check 无法运行，状态 `waiting` 而不是 `stopped`。
- `tests/app/AG2b-collaboration.test.ts` 2 项：30 s 超时，等待注册检查完成。
- `tests/app/MVP-workbench-tools.test.ts` 1 项：`startCommand` 返回 `status: rejected`（无可用 sandbox profile）。
- `tests/app/R6-host.test.ts` 1 项：`waiting` 而不是 `completed`（等待 check）。
- `tests/app/change-emitters.test.ts` 1 项：`the Kernel ProcessSandbox profile is not available; no host shell fallback`。
- `tests/app/orchestration-mechanism.test.ts` 1 项：`run_check` 被 `unsupported` 拒绝，
  `ENOENT … '/usr/bin/bwrap'`。

## 5. 未完全贴合的地方

1. **A1-01 的变异**按字面删除输入接收调用后，TypeScript 认为下一条 `state.status === "paused"`
   比较不可达，因此为通过编译也删除了这条已死的比较；核心仍是“去掉输入接收”。RED/GREEN 均已记录。
2. **A1-02/A1-01 的测试工具**：冻结夹具的 `fixtureTool` 声明空的 `requiredCapabilities`，Host 权限策略会拒绝；
   测试代码在副本上补 `requiredCapabilities: ["workspace_read"]`，未改夹具。
3. **A2-02** 的命名变异只覆盖同身份分支；公开 `resumeCodingAgent` 的转发在 `resume-composition.ts`，
   未被该变异影响，故公开入口在 RED 时仍 GREEN；恢复后两条都通过。公开入口本身有测试覆盖。
4. **A3-04/A3-05** 没有命名变异，按要求只跑 GREEN。
5. 既有 `tests/app` 环境失败里有 4 项不是逐字 `ENOENT … bwrap`，而是同一缺 bwrap 引起的
   `unsupported` / `隔离进程能力不可用` / 等待检查超时；原文已列在 §4。

## 6. 提交与收尾

- 提交：`dd89733 PC-1a R1: A1-01..08, A2-02..04, A3-01..05`。
- `git status --porcelain`：空。
- `git diff --name-only pc1a-base HEAD | grep -vE -f ./.dsh-ref/pc1a-whitelist.txt`：无输出（exit 1）。
- `vendor/coding-agent/patches` 只剩 `context-selection-policy.ts` 的 A1-07/A1-08 改动；
  `runtime-runner.ts`、`composition-root.ts`、`resume-composition.ts` 无残留变异。
