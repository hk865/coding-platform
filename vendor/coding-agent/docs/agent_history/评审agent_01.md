# 独立审查 M6 状态与业务行为

> 你是本项目的独立质量评审 Agent。不要相信上一位 Agent 的修复报告、现有测试结果或 oracle 结论；必须从源码、事件日志和真实业务行为独立得出结论。
>
> 项目目录：
>
> `/home/han001/projects/agents/coding-agent`
>
> 当前基线：
>
> - 分支：`codex/m6-completion`
> - 基线提交：`beaeaff7b1d830498fd98308a549b154383165c0`（`m6-baseline`）
> - 当前工作树包含大量未提交修改和用户文档，必须完整保留。
> - 禁止 reset、checkout 覆盖、clean、删除文件、提交或修改生产代码。
> - 你的职责是审查和独立测试，不是修复问题。
>
> ## 一、先建立事实基线
>
> 1. 查看当前 branch、HEAD、git status、tracked/untracked 文件和完整 diff。
> 2. 阅读：
>    - `docs/adr/0005-tool-lifecycle-states.md`
>    - `docs/development/post-m6-large-repo-roadmap.md`
>    - `docs/development/improvement-plan-from-codex-review.md`
>    - `tests/scenarios/README.md`
> 3. 阅读本轮涉及的 Runtime、Reducer、Recovery、Checkpoint、Web Projection、Session、工具协议与场景 runner 源码。
> 4. 把“代码已经实现的事实”“只写在文档里的规划”“现有测试声称覆盖的行为”分开记录。
>
> ## 二、独立编写核心状态测试
>
> 不要复制现有测试断言。自行构造 Fake Model、ToolExecutor、required sink、checkpoint store 和跨进程场景，至少验证：
>
> 1. required sink 精确在 `tool.started` 时失败：
>    - Run 必须 failed；
>    - ToolExecutor 调用次数必须为 0；
>    - 不得出现工具副作用或后续 tool result 事件。
> 2. cancelled ToolResult 已产生部分文件修改，并返回新 workspaceRevision：
>    - `tool.cancelled → run.cancelled`；
>    - 最新 checkpoint 必须保存新 revision；
>    - 恢复时不能把这次修改误判为外部并发修改。
> 3. 并行组中分别出现：
>    - 一个 success；
>    - 一个真实 cancelled；
>    - 一个抛 AbortError；
>    - 验证三者不会互相覆盖或被错误标记。
> 4. 工具忽略 AbortSignal 且 Promise 永不结束：
>    - 验证取消是否能在有限时间内结束；
>    - 若挂起，记录为缺陷，不要无限等待测试进程。
> 5. started 工具崩溃恢复：
>    - outcome\_unknown 只追加一次；
>    - 不自动重放副作用；
>    - pending 调用成为 abandoned；
>    - 合成 ToolResult 确实进入 transcript。
> 6. 明确验证生产恢复路径是否真的再次调用模型。不要用手工调用 ContextBuilder 冒充生产续跑；如果当前设计只支持事实投影、尚未支持下一 Turn handoff，应如实写明。
>
> 独立测试可以放入专门的 review 测试目录或临时测试 harness。不要修改生产源码。若测试暴露缺陷并导致门禁变红，保留最小复现证据，并明确说明这是新测试发现的问题，不得降低断言换取绿灯。
>
> ## 三、真实业务场景测试
>
> ### Bug Hunt
>
> 必须把 `tests/scenarios/bug-hunt/base/` 复制到独立临时目录。测试期间不得读取或向被测 Agent 暴露 `oracle/`。
>
> 除原有测试外，自行增加业务用例：
>
> - 两行订单第一行库存充足、第二行库存不足：整个订单失败，第一行预留必须回滚；
> - 第一行正常、第二行 SKU 不存在：不得留下部分预留；
> - 0%、100%、超过 100% 折扣边界；
> - reserved 等于或超过 stock；
> - 零数量、负数量等非法输入的行为；
> - 同一订单重复调用是否造成重复预留；
> - 测试文件、模块结构及场景 base 不得被被测 Agent 篡改。
>
> 不要仅运行项目提供的 acceptance；要写独立黑盒测试，并比较两者是否存在“官方验收通过但真实业务失败”的情况。
>
> ### Web Game
>
> 必须在隔离工作区运行，不得读取 oracle。
>
> 先执行静态和逻辑测试，再做真实浏览器测试。至少验证：
>
> - 16 张牌、每个符号恰好两张；
> - 点击两张不匹配牌后会翻回；
> - 匹配牌保持已匹配且不可重复计分；
> - move、timer、score 的更新逻辑；
> - 完成全部配对后的胜利状态；
> - restart 会重置状态并重新洗牌；
> - 快速连续点击、重复点击同一张牌、完成动画期间点击；
> - 窄屏布局、键盘操作、基本可访问性；
> - 页面无明显脚本错误、资源加载失败和布局遮挡。
>
> 如果当前环境提供 `computer-use`，先完整阅读其 SKILL.md，然后启动本地网页服务，使用真实 Windows 浏览器完成点击、键盘、窄屏和重启测试，并保存关键截图。不能用阅读 HTML 或调用函数代替真实游玩。
>
> 如果浏览器能力或 Provider 不可用，标记为 `external_dependency_missing`，列出已经完成的替代验证；不得把未执行写成通过。
>
> ## 四、场景 Runner 独立审查
>
> 验证：
>
> - oracle 是否真的无法进入 Agent workspace；
> - runner 是否拒绝把 scenario 根目录、base 原目录或含 oracle 的目录作为 workspace；
> - scenarioId 是否存在路径穿越；
> - 非法或结构错误的 YAML 是否会被误判为 parsed；
> - acceptance 超时、无效 JSON、信号退出的失败分类是否准确；
> - CI 当前验证的是任务包结构，还是也真正执行了业务验收。
>
> ## 五、完整门禁
>
> 使用仓库自带工具：
>
> `PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH"`
>
> 执行并记录：
>
> - `npm run check`
> - `npm run check:scenarios`
> - 强制 bubblewrap E2E
> - `git diff --check`
> - 场景的未修复基线失败和独立完成版本通过
> - 你新增的独立测试
>
> ## 六、最终报告格式
>
> 先给出是否建议提交：
>
> - `建议提交`
> - `修复阻塞项后提交`
> - `不建议提交`
>
> 随后按 P0/P1/P2/P3 列出发现。每个问题必须包含：
>
> - 真实业务影响；
> - 文件和准确行号；
> - 最小复现步骤；
> - 新测试结果；
> - 期望行为与实际行为；
> - 是否为本轮引入、基线遗留或测试缺口。
>
> 最后单独列出：
>
> - 已独立验证通过的能力；
> - 未执行及原因；
> - 对上一位 Agent 报告中不准确表述的纠正；
> - 新增测试文件清单；
> - 是否修改了生产代码（应为否）；
> - 当前完整 git status。
>
> 不要因为现有 132 个测试通过就结束评审。重点是寻找“模块测试全绿，但真实业务或中断条件下失败”的情况。

<details><summary>40 previous messages</summary>

> 我会把这次评审当作一次全新取证：保留现有工作树、不修改生产代码，也不采信已有测试结论。环境提供真实浏览器控制能力，我先按要求完整读取其操作规范；随后会分离代码事实、文档规划与既有测试声明，再建立独立复现与完整门禁记录。
>
> <details><summary>Explored 2 files</summary>
>
> - Read `/mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/skills/computer-use/SKILL.md`
> - Read `/mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/skills/computer-use/SKILL.md`
>
> </details>
>
> 浏览器技能规范已读。它要求在任何 Windows 控制前继续读取核心运行与确认规则；这一步只约束后续真实浏览器操作，不会触碰项目文件。
>
> <details><summary>Explored 2 files</summary>
>
> - Read `/mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/docs/guidance.md`
> - Read `/mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/docs/confirmations.md`
>
> </details>
>
> 现在开始建立只读事实基线。我会同时核对分支/HEAD、工作树、文件清单、完整差异统计与仓库约束；任何现有改动都视为用户资产保留。之后才会设计独立测试，避免被现有断言带偏。
>
> <details><summary>Explored 4 files, ran 9 commands</summary>
>
> - Ran `"git" "branch" "--show-current"`
>
> - Ran `"git" "rev-parse" "HEAD"`
>
> - Ran `"git" "status" "--short" "--branch" "--untracked-files=all"`
>
> - Ran `"git" "ls-files"`
>
> - Ran `"git" "ls-files" "--others" "--exclude-standard"`
>
> - Ran `"git" "diff" "--stat"`
>
> - Ran `"git" "diff" "--no-ext-diff" "--unified=80"`
>
> - Ran `"bash" "-lc" "find .. -name AGENTS.md -print"`
>
> <details><summary>Explored 2 files</summary>
>
> - Read `./AGENTS.md`
> - Read `./docs/adr/0005-tool-lifecycle-states.md`
>
> </details>
>
> - Ran `wc -l docs/adr/0005-tool-lifecycle-states.md docs/development/post-m6-large-repo-roadmap.md docs/development/improvement-plan-from-codex-review.md tests/scenarios/README.md`
>
> <details><summary>Explored 8 files</summary>
>
> - Read `./docs/development/post-m6-large-repo-roadmap.md`
> - Read `./docs/development/post-m6-large-repo-roadmap.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
> - Read `./docs/development/improvement-plan-from-codex-review.md`
>
> </details>
>
> </details>
>
> 文档已完成分层阅读，当前先记住一个重要边界：ADR 明确承认崩溃恢复后的原 Run 已终态，生产 `resume` 不会再次调用模型；文档中的“合成结果模型可见”只指可投影/未来 handoff，不等于当前自动续跑。我接下来直接核对源码是否与这条边界及其它声明一致。
>
> <details><summary>Explored 18 files, 2 searches, ran a command</summary>
>
> - Ran `wc -l src/core/runtime/loop/runtime-runner.ts src/core/runtime/reducer/run-state-reducer.ts src/core/runtime/recovery/recovery-coordinator.ts src/core/runtime/checkpointing/checkpointing-event-sink.ts src/core/runtime/events/agent-events.ts src/core/runtime/state/run-state.ts src/core/runtime/tool-outcome-unknown.ts src/core/ports/tool_executor/tool-executor-port.ts src/core/ports/event_sink/event-sink-port.ts src/core/ports/checkpoint_store/checkpoint-store-port.ts src/core/ports/session_store/session-store-port.ts src/core/ports/session_store/session-projection.ts src/app/composition/resume-composition.ts src/app/composition/composition-root.ts src/app/web/web-event-projection.ts src/app/web/web-run-manager.ts src/tools/schemas/tool-schemas.ts tests/scenarios/runner.mjs tests/scenarios/scenarios.test.ts`
>
> <details><summary>Explored 19 files, 2 searches</summary>
>
> - Read `./src/core/runtime/loop/runtime-runner.ts`
> - Read `./src/core/runtime/loop/runtime-runner.ts`
> - Read `./src/core/runtime/reducer/run-state-reducer.ts`
> - Read `./src/core/runtime/state/run-state.ts`
> - Read `./src/core/runtime/checkpointing/checkpointing-event-sink.ts`
> - Read `./src/core/runtime/event_delivery/event-delivery-coordinator.ts`
> - Read `./src/storage/session_event_sink/session-event-sink.ts`
> - Read `./src/core/ports/checkpoint_store/checkpoint-store-port.ts`
> - Read `./src/core/ports/session_store/session-store-port.ts`
> - Read `./src/core/ports/session_store/session-projection.ts`
> - Read `./src/core/runtime/recovery/recovery-coordinator.ts`
> - Read `./src/app/composition/resume-composition.ts`
> - Read `./src/core/runtime/events/agent-events.ts`
> - Read `./src/core/runtime/tool-outcome-unknown.ts`
> - Read `./src/core/ports/tool_executor/tool-executor-port.ts`
> - Read `./src/tools/schemas/tool-schemas.ts`
> - Read `./src/app/composition/composition-root.ts`
> - Searched for `CheckpointingEventSink|toolDrainTimeoutMs|toolEffectClass` in `src`
> - Read `./src/app/web/web-event-projection.ts`
> - Searched for `resumeCodingAgent|WebEventProjectionSink|resume|recovery|observerEventSinks` in `web`
> - Read `./src/app/web/web-run-manager.ts`
>
> </details>
>
> </details>
>
> 源码核对已经发现一个需要独立验证的候选缺口：恢复器直接写 Session，不经过 Web observer；而 `side_effect_result_unknown` 又在组合层提前返回，因此新增的 Web 投影代码可能只在单元测试里可见，真实 Web 恢复时间线未必出现该事件。我会用生产入口/黑盒行为确认，而不是仅凭代码推断下结论。接下来审查场景 runner 的隔离和失败分类。
>
> <details><summary>Explored 18 files, a list</summary>
>
> - Read `./tests/scenarios/runner.mjs`
> - Read `./tests/scenarios/scenarios.test.ts`
> - Read `./package.json`
> - Read `./.github/workflows/ci.yml`
> - Read `./tests/scenarios/bug-hunt/environment.yaml`
> - Read `./tests/scenarios/web-game/environment.yaml`
> - Read `./tests/scenarios/bug-hunt/acceptance/check.mjs`
> - Read `./tests/scenarios/web-game/acceptance/check.mjs`
> - Listed files in `base`
> - Read `./tests/scenarios/bug-hunt/task.md`
> - Read `./tests/scenarios/bug-hunt/base/src/inventory.js`
> - Read `./tests/scenarios/bug-hunt/base/src/order.js`
> - Read `./tests/scenarios/bug-hunt/base/test/run-tests.mjs`
> - Read `./tests/scenarios/web-game/task.md`
> - Read `./tests/scenarios/web-game/base/README.md`
> - Read `./tests/scenarios/web-game/expected-artifacts.md`
> - Read `./tests/integration/runtime-tool-states.test.ts`
> - Read `./tests/integration/m5-resume-smoke.test.ts`
> - Read `./vitest.config.ts`
>
> </details>
>
> 场景层已经确认 CI 入口只做任务包结构校验，不执行任何业务 acceptance。现在进入隔离业务验证：我会把两个 `base/` 仅复制到系统临时目录，之后所有修补和测试都只发生在副本；`oracle/` 不会被读取、复制或暴露给被测内容。技能规范在此没有要求暂停。
>
> <details><summary>Ran a command</summary>
>
> - Ran `bash -lc 'bug_dir=$(mktemp -d /tmp/coding-agent-review-bug-XXXXXX); web_dir=$(mktemp -d /tmp/coding-agent-review-web-XXXXXX); cp -a tests/scenarios/bug-hunt/base/. "$bug_dir"; cp -a tests/scenarios/web-game/base/. "$web_dir"; printf "%s\n%s\n" "$bug_dir" "$web_dir"'`
>
> </details>
>
> 真实浏览器控制入口可用，因此 Web Game 的浏览器部分不会标记为外部依赖缺失。等静态/逻辑验收完成后，我会启动本地服务并使用 Windows 浏览器执行真实点击、键盘、窄屏和重启；在此之前按技能要求补读 API 签名。
>
> <details><summary>Explored a file, ran a command</summary>
>
> - Ran `wc -l /mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/docs/api.md`
>
> <details><summary>Explored a file</summary>
>
> - Read `/mnt/c/Users/han001/.codex/plugins/cache/openai-bundled/computer-use/26.820.71523/docs/api.md`
>
> </details>
>
> </details>
>
> 独立核心测试会覆盖六条状态链，其中跨进程恢复用一个单独子进程先写入“工具已 started、进程随后消失”的 SQLite 事实，再由生产 `resumeCodingAgent` 恢复；这样能直接统计模型是否被再次调用，也能验证副作用标记未被重放。测试断言将与现有 `runtime-tool-states` 的组织方式分开。
>
> <details><summary>Created 12 files, ran 14 commands</summary>
>
> - Wrote `./coding-agent/tests/review/fixtures/seed-started-tool.mjs` (+135 -0)
> - Wrote `./coding-agent/tests/review/independent-runtime-lifecycle.test.ts` (+544 -0)
> - Wrote `./coding-agent/tests/review/minimart-blackbox.mjs` (+132 -0)
> - Wrote `./coding-agent/tests/review/scenario-runner-security.test.ts` (+155 -0)
> - Wrote `./coding-agent/tests/review/fixtures/minimart-fixed/inventory.js` (+21 -0)
> - Wrote `./coding-agent/tests/review/fixtures/minimart-fixed/order.js` (+54 -0)
> - Ran `cp -a tests/review/fixtures/minimart-fixed/inventory.js /tmp/coding-agent-review-bug-GgRUgz/src/inventory.js`
> - Ran `cp -a tests/review/fixtures/minimart-fixed/order.js /tmp/coding-agent-review-bug-GgRUgz/src/order.js`
> - Ran `bash -lc 'baseline_dir=$(mktemp -d /tmp/coding-agent-review-bug-baseline-XXXXXX); cp -a tests/scenarios/bug-hunt/base/. "$baseline_dir"; printf "%s\n" "$baseline_dir"'`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/scenarios/bug-hunt/acceptance/check.mjs /tmp/coding-agent-review-bug-baseline-bxvKLH`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/review/minimart-blackbox.mjs /tmp/coding-agent-review-bug-baseline-bxvKLH`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/scenarios/bug-hunt/acceptance/check.mjs /tmp/coding-agent-review-bug-GgRUgz`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/review/minimart-blackbox.mjs /tmp/coding-agent-review-bug-GgRUgz`
> - Wrote `./coding-agent/tests/review/fixtures/web-game-complete/README.md` (+3 -0)
> - Wrote `./coding-agent/tests/review/fixtures/web-game-complete/game-logic.mjs` (+28 -0)
> - Wrote `./coding-agent/tests/review/fixtures/web-game-complete/index.html` (+38 -0)
> - Wrote `./coding-agent/tests/review/fixtures/web-game-complete/script.js` (+156 -0)
> - Wrote `./coding-agent/tests/review/fixtures/web-game-complete/style.css` (+226 -0)
> - Ran `cp -a tests/review/fixtures/web-game-complete/. /tmp/coding-agent-review-web-OyacfL/`
> - Wrote `./coding-agent/tests/review/web-game-logic-blackbox.mjs` (+56 -0)
> - Ran `bash -lc 'baseline_dir=$(mktemp -d /tmp/coding-agent-review-web-baseline-XXXXXX); cp -a tests/scenarios/web-game/base/. "$baseline_dir"; printf "%s\n" "$baseline_dir"'`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/scenarios/web-game/acceptance/check.mjs /tmp/coding-agent-review-web-baseline-7BfnFK`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/scenarios/web-game/acceptance/check.mjs /tmp/coding-agent-review-web-OyacfL`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/review/web-game-logic-blackbox.mjs /tmp/coding-agent-review-web-OyacfL`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node --check /tmp/coding-agent-review-web-OyacfL/script.js`
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node --check /tmp/coding-agent-review-web-OyacfL/game-logic.mjs`
>
> </details>
>
> Bug Hunt 与 Web Game 的未修复基线均按预期失败；两个隔离完成版本同时通过官方验收和独立黑盒/逻辑验收。Bug Hunt 额外覆盖的非法数量与重复订单并不在官方 acceptance 中，这会成为“官方绿但业务仍可能失败”的测试缺口证据。现在先格式化并运行新增的核心/runner 评审测试。
>
> <details><summary>Ran 4 commands</summary>
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write tests/review'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run build'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" vitest run tests/review/independent-runtime-lifecycle.test.ts'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- vitest run tests/review/independent-runtime-lifecycle.test.ts'`
>
> </details>
>
> 独立核心测试前四条已经通过；跨进程生产入口测试先被测试配置 schema 拦住，因为生产配置只允许 `openai/deepseek`。这是评审夹具问题，不是产品结论。我会把夹具的假 Provider ID 机械改成允许的 `deepseek` 后重跑，断言本身不变。当前补丁读取器受环境缺少 bubblewrap 影响，机械替换不会触碰生产文件。
>
> <details><summary>Ran 4 commands</summary>
>
> - Ran `perl -pi -e 's/provider: "review-provider"/provider: "deepseek"/; s/id: "review-provider"/id: "deepseek"/; s/secretEnvironmentVariable: "REVIEW_API_KEY"/secretEnvironmentVariable: "DEEPSEEK_API_KEY"/' tests/review/independent-runtime-lifecycle.test.ts`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write tests/review/independent-runtime-lifecycle.test.ts'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- vitest run tests/review/independent-runtime-lifecycle.test.ts'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- vitest run tests/review/scenario-runner-security.test.ts'`
>
> </details>
>
> 独立 runner 审查得到 8 项中的 7 项红灯：路径穿越、含 oracle 的父工作区、伪 YAML、无效 JSON 仍 pass、外部依赖分类丢失、SIGTERM 被误判超时、其他信号崩溃被当业务验收失败；缩短超时常量后的真实超时检测本身通过。断言与复现会原样保留。现在补齐逐文件 diff 取证，确定哪些是本轮引入、哪些是基线遗留。
>
> <details><summary>Ran 3 commands</summary>
>
> - Ran `git diff --no-ext-diff --unified=12 -- src/core/runtime/loop/runtime-runner.ts src/core/runtime/reducer/run-state-reducer.ts src/core/runtime/recovery/recovery-coordinator.ts`
> - Ran `git diff --no-ext-diff --unified=12 -- src/core/runtime/checkpointing/checkpointing-event-sink.ts src/core/runtime/events/agent-events.ts src/core/runtime/state/run-state.ts src/core/ports/tool_executor/tool-executor-port.ts src/tools/schemas/tool-schemas.ts`
> - Ran `git diff --no-ext-diff --unified=12 -- src/app/composition/composition-root.ts src/app/composition/resume-composition.ts src/app/web/web-event-projection.ts src/app/web/web-page.ts`
>
> </details>
>
> 逐行审查 Runtime diff 发现一个比既有用例更严重的新回归候选：所谓 `toolDrainTimeoutMs` 的 5 秒等待从工具启动立刻计时，并不只在取消后启用。因此任何正常执行超过 5 秒的工具都会被 Runner 提前判失败，而底层 Promise 仍可继续产生未记录副作用。现有“永不返回工具取消”测试没有覆盖未取消的长工具。我会加一个最小红灯复现。
>
> <details><summary>Created a file, ran 2 commands</summary>
>
> - Wrote `./coding-agent/tests/review/runtime-drain-regression.test.ts` (+133 -0)
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write tests/review/runtime-drain-regression.test.ts'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- vitest run tests/review/runtime-drain-regression.test.ts'`
>
> </details>
>
> 长工具复现确认是实际缺陷：Runner 在 20ms 先写 `run.failed`，模型只调用 1 次；80ms 后执行器仍完成并产生 1 次文件副作用，但事件链没有 `tool.completed`。生产默认只是把窗口放大到 5 秒，逻辑相同。现在开始真实浏览器测试 Web Game 完成副本，并保存初始、窄屏和胜利关键截图。
>
> <details><summary>Ran a command, called a tool</summary>
>
> - Ran `python3 -m http.server 4173 --bind 0.0.0.0`
>
> MCP tool call
>
> node_repl.js
>
> ```json
> {
>   "code": "if (!globalThis.sky) {\n  const { sky } = await import(\"@oai/sky\");\n  globalThis.sky = sky;\n}\nglobalThis.apps = await sky.list_apps();\nnodeRepl.write(JSON.stringify(apps, null, 2));",
>   "timeout_ms": 30000,
>   "title": "初始化真实浏览器控制并列出可用窗口"
> }
> ```
>
> Error: tool call error: tool call failed for `node_repl/js`
>
> Caused by:
>     Mcp error: -32602: js: codex/sandbox-state-meta: sandboxCwd is not a local file URI: file:///home/han001/projects/agents
>
> </details>
>
> 真实 Windows 浏览器步骤被 Provider 阻断：浏览器控制会话在初始化前即返回 `sandboxCwd is not a local file URI: file:///home/han001/projects/agents`，因此没有任何点击、键盘、窄屏或截图实际发生。我不会把静态/逻辑结果冒充真实游玩通过；该部分将标记为 `external_dependency_missing`，并列出已完成的替代验证。先停止只为该测试启动的本地服务。
>
> <details><summary>Explored a file, a search</summary>
>
> - Searched for `defaultTimeoutMs` in `builtin`
> - Read `./src/tools/dispatcher/tool-dispatcher.ts`
>
> </details>
>
> 为证明“官方验收通过但真实业务仍失败”，我会再构造一个仅满足官方用例的近似修复副本：修正已知三类症状与两行原子性，但故意不补非法数量校验和订单幂等。若官方绿、独立黑盒红，就能把缺口从推测变成可复现证据。
>
> <details><summary>Created 2 files, explored a search, ran 4 commands</summary>
>
> - Wrote `./coding-agent/tests/review/fixtures/minimart-official-near-miss/inventory.js` (+9 -0)
> - Wrote `./coding-agent/tests/review/fixtures/minimart-official-near-miss/order.js` (+34 -0)
>
> - Ran `bash -lc 'near_dir=$(mktemp -d /tmp/coding-agent-review-bug-near-miss-XXXXXX); cp -a tests/scenarios/bug-hunt/base/. "$near_dir"; cp -a tests/review/fixtures/minimart-official-near-miss/. "$near_dir/src"; printf "%s\n" "$near_dir"'`
>
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/scenarios/bug-hunt/acceptance/check.mjs /tmp/coding-agent-review-bug-near-miss-Xl2Vp8`
>
> - Ran `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node tests/review/minimart-blackbox.mjs /tmp/coding-agent-review-bug-near-miss-Xl2Vp8`
>
> - Ran `sha256sum tests/scenarios/bug-hunt/base/README.md tests/scenarios/bug-hunt/base/src/inventory.js tests/scenarios/bug-hunt/base/src/order.js tests/scenarios/bug-hunt/base/test/run-tests.mjs /tmp/coding-agent-review-bug-baseline-bxvKLH/README.md /tmp/coding-agent-review-bug-baseline-bxvKLH/src/inventory.js /tmp/coding-agent-review-bug-baseline-bxvKLH/src/order.js /tmp/coding-agent-review-bug-baseline-bxvKLH/test/run-tests.mjs`
>
> <details><summary>Explored a search</summary>
>
> - Searched for `oracle` in `coding-agent-review-bug-GgRUgz`
>
> </details>
>
> </details>
>
> 完整门禁将按仓库脚本原样执行。由于新增的 runner 安全测试与长工具回归测试刻意保留红灯，`npm run check` 预计会在测试阶段失败；这不会被弱化断言。我仍会单独执行 `check:scenarios`、强制 bubblewrap E2E 和 `git diff --check`，避免一个早期红灯掩盖其它门禁。
>
> <details><summary>Explored a file, ran a command</summary>
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run check'`
>
> <details><summary>Explored a file</summary>
>
> - Read `./tests/review/independent-runtime-lifecycle.test.ts`
>
> </details>
>
> </details>
>
> 这次 `npm check` 先被新增浏览器夹具的 ESLint 环境声明和一个无用赋值拦住，尚未到产品红灯。两处都是评审文件的机械问题；我会只补全 `document/window` 全局声明并移除无用赋值，然后重跑完整门禁。
>
> <details><summary>Ran 4 commands</summary>
>
> - Ran `perl -0pi -e 's/\A/\/\* global document, window \*\/\n/' tests/review/fixtures/web-game-complete/script.js`
> - Ran `perl -0pi -e 's/sequence: \(sequence \+= 1\),\n      type: "completed"/sequence: sequence + 1,\n      type: "completed"/' tests/review/independent-runtime-lifecycle.test.ts`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write tests/review/fixtures/web-game-complete/script.js tests/review/independent-runtime-lifecycle.test.ts'`
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run check'`
>
> </details>
>
> 第二次完整门禁已通过格式与 lint，停在新增测试的类型过宽：observer 工厂返回了通用 sink 类型，而生产入口要求显式 `best_effort`。我会只收窄评审辅助函数的返回类型，再重跑；业务断言仍不变。
>
> <details><summary>Explored 5 files, a list, ran 18 commands</summary>
>
> - Ran `perl -0pi -e 's/\): EventSinkPort \{/\): EventSinkPort \& { readonly delivery: "best_effort" } {/' tests/review/independent-runtime-lifecycle.test.ts`
>
> <details><summary>Explored a file</summary>
>
> - Read `./tests/review/independent-runtime-lifecycle.test.ts`
>
> </details>
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write tests/review/independent-runtime-lifecycle.test.ts'`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run check'`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run check:scenarios'`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run test:e2e:bwrap'`
>
> - Ran `git diff --check`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run check:architecture'`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run benchmark:validate'`
>
> - Ran `bash -lc 'PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm run test -- --exclude "tests/review/**"'`
>
> <details><summary>Explored 3 files, a list</summary>
>
> - Read `./tests/review/independent-runtime-lifecycle.test.ts`
> - Read `./tests/review/runtime-drain-regression.test.ts`
> - Read `./tests/review/scenario-runner-security.test.ts`
> - Listed files in `review`
>
> </details>
>
> - Ran `git diff --no-ext-diff --unified=6 -- tests/contract/state-events.contract.test.ts`
>
> - Ran `git diff --no-ext-diff --unified=6 -- tests/e2e/m4-cross-process.test.ts`
>
> - Ran `git diff --no-ext-diff --unified=6 -- tests/integration/m4-storage.test.ts`
>
> - Ran `git diff --no-ext-diff --unified=6 -- tests/unit/web-event-projection.test.ts`
>
> - Ran `git branch --show-current`
>
> - Ran `git rev-parse HEAD`
>
> - Ran `git status --short --branch --untracked-files=all`
>
> - Ran `git diff --stat`
>
> - Ran `git status --short --untracked-files=all -- tests/review`
>
> <details><summary>Explored 2 files</summary>
>
> - Read `./tests/review/minimart-blackbox.mjs`
> - Read `./src/app/composition/composition-root.ts`
>
> </details>
>
> </details>
>
> Context compaction
>
> Source: automatic
> Status: completed
>
> 独立评审已经完成；我正在做最后一次只读核对，确保报告里的行号、门禁结果和完整工作树状态与当前现场一致。生产代码没有被修改。
>
> <details><summary>Ran 2 commands</summary>
>
> - Ran `git status --short --branch && nl -ba tests/review/minimart-blackbox.mjs | sed -n '1,190p' && nl -ba tests/review/runtime-drain-regression.test.ts | sed -n '60,100p' && nl -ba tests/review/scenario-runner-security.test.ts | sed -n '60,155p'`
> - Ran `git status --short --branch && nl -ba tests/review/minimart-blackbox.mjs | sed -n '1,190p' && nl -ba tests/review/runtime-drain-regression.test.ts | sed -n '60,100p' && nl -ba tests/review/scenario-runner-security.test.ts | sed -n '60,155p'`
>
> </details>
>
> <details><summary>Plan</summary>
>
> 全部只读审查、独立测试、隔离场景、runner 安全测试与门禁均已完成；生产代码未修改，红灯复现已保留。
>
> - [x] 建立 Git 与文档/源码事实基线
> - [x] 编写并运行独立核心状态测试
> - [x] 隔离执行 Bug Hunt 与 Web Game 真实业务测试
> - [x] 独立审查场景 Runner 安全与失败分类
> - [x] 执行完整门禁与差异完整性检查
> - [x] 汇总优先级发现与最终提交建议
>
> </details>
</details>

修复阻塞项后提交

当前分支和 HEAD 符合给定基线：

- 分支：`codex/m6-completion`
- HEAD：`beaeaff7b1d830498fd98308a549b154383165c0`
- 审查开始时已有 25 个 tracked 文件发生修改，合计 `892 insertions(+), 146 deletions(-)`，另有大量 untracked 文件。
- 我没有 reset、checkout、clean、删除、提交或修改任何生产代码，也没有读取或复制两个场景的 `oracle/` 内容。

## 事实基线

代码已经实现且经独立测试确认：

- required sink 在 `tool.started` 失败时，执行器不会被调用。
- cancelled ToolResult 携带的新 workspace revision 能被 CheckpointingEventSink 保存；注入该 sink 后恢复不会误报外部并发修改。
- 并行组中的 success、真实 cancelled 和 AbortError 可以保持独立结果。
- 取消后，忽略 AbortSignal 且永不返回的执行器能被 drain timeout 截断。
- started 工具崩溃恢复会合成一次 `outcome_unknown`，不会重放副作用，pending 调用变成 abandoned，合成结果进入 transcript。
- 当前生产恢复路径不会再次调用模型。这符合 [ADR 0005](./coding-agent/docs/adr/0005-tool-lifecycle-states.md:53) 对“只完成事实投影、尚未进行下一 Turn handoff”的限定。

只在文档中规划、尚未完整落地：

- Artifact Store、durable inbox/profile、完整 Context Projection。
- 恢复后下一 Turn 的模型 handoff。
- edit 类工具的确定性副作用对账。
- 更完整的 sandbox/recovery declaration 和大型仓库增量能力。

现有测试实际声称或覆盖的范围：

- 排除新增 review 测试后：35 个测试文件通过，`137 passed / 3 skipped`，不是 132。
- Web Projection 单元测试是手工向 projector 发布事件，不能证明生产恢复路径会发布相同事件。
- 场景 CI 主要验证任务包结构；没有在完成版本上执行真实业务验收。

# P0

## P0-1：tool drain timeout 被错误地当成所有工具的运行时限

- 业务影响：正常但耗时超过 5 秒的工具会被 Run 提前判定失败；工具仍可在后台完成副作用，却没有 `tool.completed`。这会产生“Run 已失败但文件后来被修改”的不一致，恢复或重试时可能造成重复副作用。
- 代码位置：[runtime-runner.ts:710](./coding-agent/src/core/runtime/loop/runtime-runner.ts:710)、[runtime-runner.ts:741](./coding-agent/src/core/runtime/loop/runtime-runner.ts:741)、[runtime-runner.ts:759](./coding-agent/src/core/runtime/loop/runtime-runner.ts:759)。底层 dispatcher 自己另有更长的超时：[tool-dispatcher.ts:167](./coding-agent/src/tools/dispatcher/tool-dispatcher.ts:167)。
- 最小复现：

  `npm exec -- vitest run tests/review/runtime-drain-regression.test.ts`

- 新测试结果：1/1 失败。实际事件为：

  `run.started → model.request_started → assistant.message_completed → tool.started → run.failed`

  Run 失败之后，测试观察到 `sideEffects=1`，但始终没有 `tool.completed`。
- 期望：drain timeout 只应在取消信号已经发生后开始计时；未取消的正常工具应遵从工具自身 timeout。
- 实际：从工具启动就无条件执行 `Promise.race`。默认 drain 为 5 秒，而 shell 等内置工具允许运行到 30 秒。
- 引入归属：本轮引入。当前 diff 将原先等待执行结果的逻辑改成了通用 bounded drain。
- 独立复现断言：[runtime-drain-regression.test.ts:74](./coding-agent/tests/review/runtime-drain-regression.test.ts:74)。

# P1

## P1-1：场景 Runner 的 oracle/workspace 隔离可被路径绕过

- 业务影响：调用者可以把包含所有场景及 `oracle/` 的 `tests/scenarios` 目录直接作为 workspace；`scenarioId` 也能穿越到场景根之外。Runner 因而不能强制保证被测 Agent 看不到 oracle。
- 代码位置：[runner.mjs:83](./coding-agent/tests/scenarios/runner.mjs:83)、[runner.mjs:108](./coding-agent/tests/scenarios/runner.mjs:108)、[runner.mjs:157](./coding-agent/tests/scenarios/runner.mjs:157)。
- 最小复现：

  - `validate ../../<外部任务包>`
  - `check bug-hunt --workspace tests/scenarios`
- 新测试结果：两项都失败了安全断言。Runner 接受了路径穿越；包含 oracle 的父目录也没有被拒绝。
- 期望：对 scenario 路径执行 canonical containment 检查；拒绝 scenario 根、base 原目录、oracle 目录、其父目录及指向这些位置的链接。
- 实际：使用未经边界校验的 `path.join`；workspace guard 只比较两个完全相等的字符串路径。
- 引入归属：本轮引入，Runner 当前是 untracked 新文件。
- 独立测试：[scenario-runner-security.test.ts:65](./coding-agent/tests/review/scenario-runner-security.test.ts:65)、[scenario-runner-security.test.ts:74](./coding-agent/tests/review/scenario-runner-security.test.ts:74)。

默认 `prepare` 路径确实只复制了 `base/`，这个默认流程本身未发现 oracle 泄漏；问题是 Runner 没有把该安全约束强制到所有入口。

## P1-2：YAML、JSON、信号和外部依赖的失败分类不可信

- 业务影响：结构错误的任务包、没有给出合法结果的 acceptance，甚至崩溃退出，都可能得到错误的 parsed/pass/timeout 分类，使自动门禁产生假阳性或错误诊断。
- 代码位置：[runner.mjs:92](./coding-agent/tests/scenarios/runner.mjs:92)、[runner.mjs:127](./coding-agent/tests/scenarios/runner.mjs:127)、[runner.mjs:218](./coding-agent/tests/scenarios/runner.mjs:218)、[runner.mjs:224](./coding-agent/tests/scenarios/runner.mjs:224)。
- 最小复现：运行新增的 runner security 测试。
- 新测试结果：8 项中 7 项失败、1 项通过。

  - malformed YAML 被标记为 valid/parsed。
  - exit 0、stdout 为无效 JSON 时仍判 pass。
  - acceptance 明确报告 `external_dependency_missing` 时被覆盖成 `acceptance_failed`。
  - 自己发送 SIGTERM 被误判为 timeout。
  - SIGKILL 被分类成普通 acceptance failure。
  - 仅“Runner 自己确实触发超时”的用例分类正确。
- 期望：严格解析和 schema 校验；无效 JSON 为 runner error；真实 timeout 与进程信号区分；保留显式 external dependency 分类。
- 实际：手写行级 YAML parser 不检查结构；exit code 0 直接决定 pass；任何 SIGTERM 都被视为 timeout。
- 引入归属：本轮引入。
- 独立测试：[scenario-runner-security.test.ts:81](./coding-agent/tests/review/scenario-runner-security.test.ts:81) 至 [scenario-runner-security.test.ts:150](./coding-agent/tests/review/scenario-runner-security.test.ts:150)。

## P1-3：生产恢复事件绕过 Web Projection

- 业务影响：恢复时虽然数据库中追加了 `tool.outcome_unknown`，Web 客户端却收不到该工具事实事件。用户只能看到最终 Run 失败，无法在 Timeline 中看到副作用未知、取消或 abandoned 的关键审计原因。
- 代码位置：[recovery-coordinator.ts:361](./coding-agent/src/core/runtime/recovery/recovery-coordinator.ts:361)、[resume-composition.ts:139](./coding-agent/src/app/composition/resume-composition.ts:139)、[resume-composition.ts:144](./coding-agent/src/app/composition/resume-composition.ts:144)。
- 最小复现：跨进程写入 `tool.started`，随后对同一 Session 调用生产 `resumeCodingAgent` 两次，并注册 observer sink。
- 新测试结果：Session/transcript 中各只有一次合成 `outcome_unknown`，但 `observerEvents.length === 0`。
- 期望：恢复追加的事实同时经过生产事件投递管线，供 Web Projection 消费。
- 实际：RecoveryCoordinator 直接调用 `sessions.append`，而 resume 在创建 SessionEventSink/RuntimeRunner 之前提前返回。
- 引入归属：本轮引入或本轮恢复实现的集成缺口。
- 独立测试：[independent-runtime-lifecycle.test.ts:532](./coding-agent/tests/review/independent-runtime-lifecycle.test.ts:532)、[independent-runtime-lifecycle.test.ts:541](./coding-agent/tests/review/independent-runtime-lifecycle.test.ts:541)。

# P2

## P2-1：CheckpointingEventSink 的行为正确，但生产 composition 没有接入

- 业务影响：生产 Run 不会按工具边界写入独立 checkpoint；崩溃恢复只能依赖 Session 全量事件重放。大型 Session 的恢复成本和“最新 checkpoint revision”承诺都无法成立。
- 代码位置：checkpoint 的 revision 保存逻辑位于 [checkpointing-event-sink.ts:69](./coding-agent/src/core/runtime/checkpointing/checkpointing-event-sink.ts:69)，但生产只创建 Session sink：[composition-root.ts:202](./coding-agent/src/app/composition/composition-root.ts:202)、[composition-root.ts:264](./coding-agent/src/app/composition/composition-root.ts:264)。
- 最小复现：比较独立注入 CheckpointingEventSink 的测试与生产 composition 的 sink 列表。
- 新测试结果：手工注入时 `tool.cancelled` 后最新 checkpoint 保存 `revision-after-partial-change`，恢复正常；生产 wiring 中找不到该 sink。
- 期望：生产事件链同时包含 SessionEventSink、CheckpointingEventSink 和 observer sinks。
- 实际：核心组件可用，但生产入口没有接线。
- 引入归属：基线遗留的 wiring 缺口，本轮新增文档和测试没有覆盖真实 composition。

## P2-2：Bug Hunt 官方 acceptance 可被业务不完整实现绕过

- 业务影响：实现可以通过官方验收，但仍接受负数量、改变库存方向，并对重复订单二次预留。
- 代码位置：官方 acceptance 只运行任务包自带测试：[check.mjs:73](./coding-agent/tests/scenarios/bug-hunt/acceptance/check.mjs:73)。新增边界验证位于 [minimart-blackbox.mjs:30](./coding-agent/tests/review/minimart-blackbox.mjs:30) 至 [minimart-blackbox.mjs:127](./coding-agent/tests/review/minimart-blackbox.mjs:127)。
- 最小复现：对 `minimart-official-near-miss` fixture 分别执行官方 acceptance 和独立 blackbox。
- 新测试结果：

  - 官方 acceptance：通过。
  - 独立 blackbox：3 项失败。
  - 零/负 allocation 未拒绝。
  - 零/负订单行被接受，负数量将 reserved 从 2 降到 1。
  - 同一订单重复调用后 reserved 变成 6。
- 期望：官方 acceptance 至少覆盖非法数量、折扣边界和订单幂等性。
- 实际：已知 happy-path 与原始 bug 被覆盖，但新增真实业务边界没有成为门禁。
- 引入归属：本轮 acceptance 测试缺口。

独立完整实现同时通过官方和新增黑盒测试；原始 base 官方验收失败 6 项，说明 baseline/fixed 区分本身仍有效。

## P2-3：CI 只验证场景任务包结构，不执行完成版本的业务验收

- 业务影响：场景结构合法即可让 CI 通过，即使 baseline 业务仍然失败、acceptance 分类存在上述漏洞。
- 代码位置：[package.json:26](./coding-agent/package.json:26)、[scenarios.test.ts:1](./coding-agent/tests/scenarios/scenarios.test.ts:1)、[scenarios.test.ts:91](./coding-agent/tests/scenarios/scenarios.test.ts:91)、[ci.yml:29](./coding-agent/.github/workflows/ci.yml:29)。
- 最小复现：运行 `npm run check:scenarios`，随后对原始 Bug Hunt base 执行 acceptance。
- 新测试结果：`check:scenarios` 退出 0，但原始 Bug Hunt acceptance 失败。
- 期望：CI 除结构验证外，应至少运行受控的完成 fixture 或 runner 自测，验证 acceptance 的执行和分类。
- 实际：CI 仅证明任务包存在、字段被手写 parser “解析”和 baseline 仍失败。
- 引入归属：本轮场景门禁设计缺口。

# P3

没有发现需要单列、且证据强于上述问题的新 P3 项。

## 独立验证通过的能力

- required sink 精确在 `tool.started` 失败：

  - Run 为 failed。
  - ToolExecutor 调用 0 次。
  - 副作用 0 次。
  - 没有后续 completed/failed/cancelled 结果事件。

- cancelled partial edit：

  - 事件顺序为 `tool.cancelled → run.cancelled`。
  - 注入 checkpoint sink 后保存新 workspace revision。
  - 恢复未误判外部并发修改。

- 并行组：success、真实 cancelled、AbortError 分别保持 completed、cancelled、outcome_unknown，没有互相覆盖。
- 永不结束工具：取消在有限时间内完成，没有让测试进程无限挂起。
- started 工具跨进程恢复：

  - `outcome_unknown` 只追加一次。
  - 副作用 marker 保持一次。
  - pending 调用成为 abandoned。
  - 合成 ToolResult 进入 transcript。
  - 第二次恢复不重复追加。
- 生产恢复模型调用次数明确为 0。当前仅支持终态事实恢复，不支持同一 Turn 继续调用模型。
- Bug Hunt：

  - 原始 base 官方验收失败。
  - 独立完成版本官方验收和新增 8 项黑盒测试全部通过。
  - 原始 base 文件哈希在测试前后保持一致。
- Web Game 静态和逻辑验证：

  - 16 张牌、8 个符号、每个恰好两张。
  - 唯一牌 ID。
  - 同牌、异牌、重复同一张的匹配逻辑。
  - score 单调且不为负。
  - 20 次 shuffle 不固定。
  - HTML、JS 和模块语法检查通过。
- `git diff --check`：通过。
- `npm run check:architecture`：通过，验证 64 个源码文件。
- `npm run benchmark:validate`：通过，4 个任务包 preflight 正常。
- 排除 review 测试后的原有套件：`137 passed / 3 skipped`。

## 完整门禁结果

- `npm run check`：失败。

  - format、lint、typecheck、build 均通过。
  - 测试结果：`36 passed files / 2 failed files`，`143 passed / 8 failed / 3 skipped`。
  - 8 个失败均为新增独立测试揭示的问题：1 个 runtime P0、7 个 runner 问题。
- `npm run check:scenarios`：退出 0，但仅是结构门禁。
- 强制 bubblewrap E2E：3 通过、3 失败。环境没有系统或 bundled `bwrap`，另一个 CLI 流程停在一次性授权提示；因此该门禁记为 `external_dependency_missing`，不能记为产品通过。
- `git diff --check`：通过。

## 未执行及原因

真实 Windows 浏览器测试未执行，状态为 `external_dependency_missing`。

我完整阅读了 computer-use skill 及其 guidance、confirmations、API 文档，并启动了隔离 Web Game 服务；Provider 初始化时返回：

`codex/sandbox-state-meta: sandboxCwd is not a local file URI`

因此没有执行或冒充通过以下项目：

- 真实点击不匹配牌并等待翻回。
- 匹配牌不可重复计分。
- timer、move、score 的浏览器更新。
- 全部配对后的胜利动画。
- restart 重置和重新洗牌。
- 快速连续点击、完成动画期间点击。
- 键盘操作、窄屏布局、遮挡和资源加载验证。
- 浏览器 console 错误检查。
- 关键截图。

没有截图可交付。官方 Web acceptance 的浏览器门禁本身也是固定报告 `external_dependency_missing`，不能替代真实浏览器游玩。

## 对上一位 Agent/现有文档表述的纠正

上一位报告原文不在当前工作区；以下是对能够从现有文档、测试及题述核验的表述纠正：

- “132 个测试通过”已过时：当前原有测试是 `137 passed / 3 skipped`；加入独立评审测试后门禁有 8 个真实红灯。
- “永不返回工具不会阻塞取消”本身正确，但新的 drain 实现同时错误截断了未取消的正常长工具。
- “Web Timeline 可以区分 outcome_unknown/cancelled”只在手工 projector 单元测试中成立；生产恢复 observer 实测收到 0 个事件。
- “恢复后的合成结果会再次进入模型”不准确。生产路径模型调用数为 0；当前 ADR 明确只做事实投影，下一 Turn handoff 是未来工作。
- “cancelled revision 会保存进最新 checkpoint”只在显式注入 CheckpointingEventSink 时成立；生产 composition 没有接入该 sink。
- “场景 CI 验证业务验收”不准确；当前主要验证任务包结构。
- [improvement-plan-from-codex-review.md](./coding-agent/docs/development/improvement-plan-from-codex-review.md:1) 所称“当前工作树 clean”与现场不符。

## 新增评审文件

全部位于 `tests/review/`，没有改动场景 base 或生产源码：

- [independent-runtime-lifecycle.test.ts](./coding-agent/tests/review/independent-runtime-lifecycle.test.ts)
- [runtime-drain-regression.test.ts](./coding-agent/tests/review/runtime-drain-regression.test.ts)
- [scenario-runner-security.test.ts](./coding-agent/tests/review/scenario-runner-security.test.ts)
- [minimart-blackbox.mjs](./coding-agent/tests/review/minimart-blackbox.mjs)
- [web-game-logic-blackbox.mjs](./coding-agent/tests/review/web-game-logic-blackbox.mjs)
- [seed-started-tool.mjs](./coding-agent/tests/review/fixtures/seed-started-tool.mjs)
- `fixtures/minimart-fixed/{inventory.js,order.js}`
- `fixtures/minimart-official-near-miss/{inventory.js,order.js}`
- `fixtures/web-game-complete/{README.md,game-logic.mjs,index.html,script.js,style.css}`

是否修改生产代码：**否**。

## 当前完整 git status

```text
## codex/m6-completion...origin/codex/m6-completion
 M .prettierignore
 M docs/adr/README.md
 M docs/architecture/m4-secure-snapshot-incremental-consistency.md
 M docs/data-flow/m2-m4-runtime-flow.md
 M docs/development/README.md
 M docs/development/improvement-plan-from-codex-review.md
 M docs/interfaces/m2-m4-runtime-tools-storage.md
 M docs/testing/m2-m4-verification.md
 M package.json
 M src/app/composition/composition-root.ts
 M src/app/composition/resume-composition.ts
 M src/app/web/web-event-projection.ts
 M src/app/web/web-page.ts
 M src/core/ports/tool_executor/tool-executor-port.ts
 M src/core/runtime/checkpointing/checkpointing-event-sink.ts
 M src/core/runtime/events/agent-events.ts
 M src/core/runtime/loop/runtime-runner.ts
 M src/core/runtime/recovery/recovery-coordinator.ts
 M src/core/runtime/reducer/run-state-reducer.ts
 M src/core/runtime/state/run-state.ts
 M src/tools/schemas/tool-schemas.ts
 M tests/contract/state-events.contract.test.ts
 M tests/e2e/m4-cross-process.test.ts
 M tests/integration/m4-storage.test.ts
 M tests/unit/web-event-projection.test.ts
?? docs/adr/0005-tool-lifecycle-states.md
?? docs/development/post-m6-large-repo-roadmap.md
?? src/core/runtime/tool-outcome-unknown.ts
?? tests/integration/runtime-tool-states.test.ts
?? tests/review/fixtures/minimart-fixed/inventory.js
?? tests/review/fixtures/minimart-fixed/order.js
?? tests/review/fixtures/minimart-official-near-miss/inventory.js
?? tests/review/fixtures/minimart-official-near-miss/order.js
?? tests/review/fixtures/seed-started-tool.mjs
?? tests/review/fixtures/web-game-complete/README.md
?? tests/review/fixtures/web-game-complete/game-logic.mjs
?? tests/review/fixtures/web-game-complete/index.html
?? tests/review/fixtures/web-game-complete/script.js
?? tests/review/fixtures/web-game-complete/style.css
?? tests/review/independent-runtime-lifecycle.test.ts
?? tests/review/minimart-blackbox.mjs
?? tests/review/runtime-drain-regression.test.ts
?? tests/review/scenario-runner-security.test.ts
?? tests/review/web-game-logic-blackbox.mjs
?? tests/scenarios/README.md
?? tests/scenarios/bug-hunt/acceptance/check.mjs
?? tests/scenarios/bug-hunt/base/README.md
?? tests/scenarios/bug-hunt/base/src/inventory.js
?? tests/scenarios/bug-hunt/base/src/order.js
?? tests/scenarios/bug-hunt/base/test/run-tests.mjs
?? tests/scenarios/bug-hunt/environment.yaml
?? tests/scenarios/bug-hunt/expected-artifacts.md
?? tests/scenarios/bug-hunt/interruption-plan.md
?? tests/scenarios/bug-hunt/oracle/reference.md
?? tests/scenarios/bug-hunt/task.md
?? tests/scenarios/runner.mjs
?? tests/scenarios/scenarios.test.ts
?? tests/scenarios/web-game/acceptance/check.mjs
?? tests/scenarios/web-game/base/README.md
?? tests/scenarios/web-game/environment.yaml
?? tests/scenarios/web-game/expected-artifacts.md
?? tests/scenarios/web-game/interruption-plan.md
?? tests/scenarios/web-game/oracle/reference.md
?? tests/scenarios/web-game/task.md
```

`oracle` 路径出现在 git status 中仅因为 Git 枚举了文件名；评审期间未打开、读取或复制其内容。

> 把评审过程，评审结论/证据，评审意见形成文档

<details><summary>6 previous messages</summary>

> 我会把这次独立评审整理成一份仓库内的正式 Markdown 文档，涵盖评审边界、过程、事实分层、逐项证据、门禁结果、未执行项和提交建议；只新增文档，不改生产代码或已有评审测试。
>
> <details><summary>Created a file</summary>
>
> - Wrote `./coding-agent/docs/development/m6-independent-quality-review-2026-08-28.md` (+542 -0)
>
> </details>
>
> 文档已写入。我再做一次格式与工作树核对，确认它能直接纳入仓库，同时不会把已有修改误算成这次文档整理的改动。
>
> <details><summary>Ran a command</summary>
>
> - Ran `PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --check docs/development/m6-independent-quality-review-2026-08-28.md && git status --short -- docs/development/m6-independent-quality-review-2026-08-28.md && sed -n '1,40p' docs/development/m6-independent-quality-review-2026-08-28.md`
>
> </details>
>
> 格式检查发现文档只有 Prettier 风格差异。我会仅对这一个新文档执行仓库格式化，然后复查；不会触碰其他文件。
>
> <details><summary>Ran a command</summary>
>
> - Ran `PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --write docs/development/m6-independent-quality-review-2026-08-28.md && PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" npm exec -- prettier --check docs/development/m6-independent-quality-review-2026-08-28.md && git status --short -- docs/development/m6-independent-quality-review-2026-08-28.md`
>
> Tool call
>
> Tool: open_in_codex
> Status: completed
>
> </details>
</details>

已形成正式评审文档：

[M6 独立质量评审报告](./coding-agent/docs/development/m6-independent-quality-review-2026-08-28.md)

文档包含：

- 评审过程、边界和事实基线
- 代码实现、文档规划、现有测试声明的区分
- P0/P1/P2/P3 结论及逐项复现证据
- Runtime、Recovery、Checkpoint、Web Projection 审查
- Bug Hunt、Web Game 和场景 Runner 测试
- 完整门禁结果及未执行项
- 对既有不准确表述的纠正
- 提交前处理建议和后续验证计划
- 新增评审文件及生产代码未修改声明

文档已通过 Prettier 格式检查。此次仅新增该文档，没有修改生产代码。
