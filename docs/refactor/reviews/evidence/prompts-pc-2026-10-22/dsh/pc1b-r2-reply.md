# PC-1b R2 回复（返工 2，2026-10-22 夜）

## 1. 结论

- 冻结表里判 **fix** 的行全部完成：X-01；P2-02、P2-04、P2-05、P2-06；S2-02…S2-09；R2-01、R2-02；J2-01、J2-02、J2-04、J2-05、J2-06；以及规则 T。
- 判 **rejected / accepted as built** 的行没有动：P2-01、P2-03、S2-01、J2-03。
- 每个测试行都做了“改测试 → 施加命名变异 → RED → 撤销 → GREEN”；提交里没有留变异。纯静态行（R2-02 文件头、J2-05 的 allowlist 说明）没有行为变异；J2-04 的迁移用“把 allowlist 条目放回”验红。
- 提交 `68dfb10`，25 个文件，+338/−152；工作区干净；范围与冻结夹具检查通过。
- 18 项 X 场景失败是环境失败（本机没有 bwrap），逐文件列在 §6；`ENOENT … bwrap` 没有出现，实际文本是 `bwrap: command not found` 和 check 路径 `run_check rejected:unsupported`。其余 68 项 X 测试通过。

## 2. 逐行 RED → GREEN

### X

- **X-01 完成。** 只改三个 helper，测试正文 0 行：
  - `tests/scenarios/harness.ts`：`ag2bWorkRuntime` 增加可选 `workModelId`；给了值时 Work 模型带 `selection: { modelId, promptPack: 'platform', reasoningReplay: 'current_run' }`（并有一行注释说明为什么）。
  - `tests/scenarios/support/common.ts`：`openWorkRoot` 传 `runtimeModelId({ provider: 'deepseek', model: 'ag2b-scripted-work', secretEnvironmentVariable: AG2B_SECRET_VAR })`。
  - `tests/scenarios/support/review-work-root.ts`：`openReviewWorkRoot` 传同一个 id。
  - 其他 `ag2bWorkRuntime` 调用者和 Query 未动。
  - 接线变异：暂时去掉 `openWorkRoot` 的 `workModelId` → `A8-host-restart-entry` 的 A8-2d RED（start 在 S-01 比较处被拒：“the lock was taken right after the begin: expected false to be true”，`execution-driver.ts:600`）；备份恢复、sha256 一致后 GREEN（1 passed / 7 skipped）。
  - 16 个文件的结果和逐文件数字见 §6。

### P

- **P2-02 完成。** `tests/work-graph/PC-entry-frozen-continuation.test.ts`，用例 “answers unavailable when only the entry cannot read the frozen prompt text”。在已有的 `toMatchObject({status:'rejected', code:'unavailable'})` 后用 union 收窄再断言完整 `reason` 字面量：`the frozen continuation-brief template could not be read: PC injected entry prompt-text read failure`。变异：`src/core/work-graph/tasks/execution-entry-service.ts:1012` 的不可读分支 `return { ok:false, rejection: unavailable(...) }` 改成 `throw new Error(...)`（同一条消息）。RED：期望上面的 reason，实得 `the authorization write failed: the frozen … failure`；恢复后 GREEN（1 passed）。
- **P2-04 完成。** `tests/runtime/PC-prepare-prompt-freeze.test.ts`：
  - Work 用例 “keeps the original selection, provider and model when the Host object changes while paused”：暂停时除 modelId/promptPack/provider/model 外，也把 `config.model.selection!.reasoningReplay` 从 `none` 改成 `current_run`；既有 `reasoningReplay: 'none'` 断言保留。
  - Query 同名用例：同样把 `reasoningReplay` 改成 `current_run`；`manifest.promptSet` 的局部类型补 `packId`/`reasoningReplay`，并断言 `packId: 'platform'`、`reasoningReplay: 'none'`。
  - 三个变异分别做，均 RED：
    1. `execution-preparation.ts:538` `reasoningReplay: selection.reasoningReplay` → 读 await 后的 `promptSelectionOf(configured.value.model).reasoningReplay`；Work RED（期望 `none`，实得 `current_run`）。
    2. `query-preparation.ts:294` 同样改；Query RED（期望 `none`，实得 `current_run`）。
    3. `query-preparation.ts:294` `packId: pack.manifest.packId` → 读 await 后的 `promptSelectionOf(configured.value.model).promptPack`；Query RED（期望 `platform`，实得 `person-changed`）。
  - 每次备份恢复、sha256 一致；恢复后 Work/Query GREEN（文件 6/6）。
- **P2-05 完成。** 规则 T(1)：三个旧用例去掉 R1 加的 `180_000`，回到仓库默认 30,000：
  - `PC-entry-frozen-continuation` “re-renders the saved brief …” 与 “answers unavailable …”；
  - `PC-entry-frozen-review` “admits the review Run …”。
  只改限时，无行为变异；GREEN。
- **P2-06 完成。** 规则 T(2)：`PC-prepare-architecture-reminders` 24、`PC-prepare-prompt-text-put-failure` 28/42、`PC-prepare-prompt-freeze` 152/210、`PC-prepare-review-freeze` 71 全部改成 `60_000`。只改限时；GREEN。

### S

- **S2-02 完成。** `tests/runtime/PC-model-budget-preview.test.ts`，用例 “reads the same totals() through a real tool call: 700 + 256 = 956, then 700 + 200 = 900”。从公开记录加断言 `selection.inputTokens === [700, 700]`、`selection.budget === [744, 800]`。
  - 手算：window = 1000，counter 每次 700；第一次 cap = min(256, 400−0) = 256 → budget = 1000−256 = 744；第二次 cap = min(256, 400−200) = 200 → budget = 1000−200 = 800；两次 inputTokens 都是 700。所以 `inputTokens [700,700]`、`budget [744,800]`。
  - 变异：`src/core/agent-runtime/model-budget.ts:108` 的 preview 单独测量改成 `this.measure(request, { input: 0, output: 0 })` → RED `expected [ 744, 744 ] to deeply equal [ 744, 800 ]`（`selection.budget`，行 83）；恢复后 GREEN。
- **S2-03 完成。** 同文件 “keeps wrap as the only reservation and persist while sharing the preview measurement”：`reservedInput`/`reservedOutput` 的期望从 `measure` 改成字面量 `700`、`256`。这一行没有点名变异；GREEN。
- **S2-04 完成。** 同文件 S-06 用例去掉 `120_000`，回到默认 30,000；只改限时。
- **S2-05 完成。** `PC-send-frozen-prompt`（Work、Query）和 `PC-send-platform-root`（Work、Query）四个用例都改成：注入手写的 `literalPack`（`work-input`/`query-planning-input` 模板、54 个字符串表项、base、plan guide、必要时 `skill-platform-work`），用手写的 `WORK_INPUT`/`QUERY_INPUT` 整段与模型消息比较；删掉 `preparedTexts()` 和 manifest `input` 期望，其他行为断言保留。
  - 变异：`src/core/agent-runtime/context-rendering.ts:34` 的 goal 段头后加 `.slice(1)`（`PC-GOAL` → `C-GOAL`）→ 四个用例全 RED（`send-frozen` 140/165、`platform-root` 146/173，diff 显示 `- PC-GOAL / + C-GOAL`）；恢复、sha256 一致后四个 GREEN（2+2）。
- **S2-06 完成。** `tests/runtime/PC-send-start-check.test.ts`，用例 “returns the observation on a second start and makes no new model call”。第一次 start 之后，改掉 fixture 钉住的原始 `RuntimeHostBindings` 的 `resolveQueryConfiguration`，让它返回另一个 provider/model；再次公开 start，断言返回原执行的 `run.ref`、同一 `revision`，且模型调用数不变。
  - 说明：RL Query fixture 没有暴露 `fixture.base.host`，所以通过 fixture 自己的 `createHostRuntimeResolverRegistry` 接缝拿到同一个被钉住的 binding 对象，再替换它的 resolver；没有手写事实，只改 Host 行为。
  - 变异：`src/core/agent-runtime/query-execution.ts:226` 在 `observation.observe(...)` 前重新 resolve 一次并比较绑定 → RED `{"status":"rejected","code":"forbidden","reason":"the prepared Query binding changed before observation"}: expected 'rejected' to be 'ready'`（行 349）；恢复后 GREEN。
- **S2-07 完成。** 同文件两例 120,000 → 60,000。
- **S2-08 完成。** `PC-joint-record-and-failure` 两个 PC-10 用例 120,000 → 60,000。
- **S2-09 完成。** `PC-joint-freeze-and-pin` 的 PC-07 用例 180,000 → 60,000。

### R

- **R2-01 完成。** `tests/runtime/PC-read-record-work-query.test.ts` 的四个显式限时（75、115、134、150）120,000 → 60,000（按规则 T(2)，不是 audit 建议的 5,000）。
- **R2-02 完成。** `src/core/agent-runtime/runtime.ts` 文件头改为：无参工厂的 `readPromptRecord` 校验 ref，完整 Work ref 返回 `unavailable`；其他成员仍是 `unsupported`。只改注释，无行为变异。

### J

- **J2-01 完成。** `tests/runtime/PC-joint-budget-removal.test.ts`，用例 “keeps system, current input and the two removal counts through run 2”。删掉 `BRIEF_DIGEST`/`ROUND_ID` 正则和 `normalizeBrief`；在 `next.start()` 之后通过公开 `readContinuationBrief` 取 `digest`，用公开 `openVerification` 返回的 `opened.value.ref.roundId` 取轮次；把这两个值填进手写的 `EXPECTED_INPUT_2`，整段比较 `current.content`。
  - 变异：`src/contracts/continuation-brief.ts:307` 的 marker 把 digest 最后一个十六进制位换掉（等长）→ RED：输入与手写期望不一致，diff 显示 `…sha256:1522…cee2]` 对 `…cee0]`（行 151）；恢复、sha256 一致后 GREEN。
- **J2-02 完成。** 删除 `preparedTexts()` 及依附断言：`PC-joint-prepare-freeze` 272/293、`PC-joint-freeze-and-pin` 116、`PC-joint-budget-removal` 77/127/151。仍需要的事实从模型请求或 `readPromptRecord` 取；PC-15(a) 直接比较 J2-01 的手写输入。其他行为断言保留。GREEN（4 文件 12/12）。
- **J2-04 完成。** 三个旧测试改为字面段头：`S3-context-assembler`（`## Footprint`、`## Note index`、`## Reminders`、`## Selected inputs`）、`S4C2-assembly`（`## Note index`、`## Reminders`）、`S3-role-profiles`（`## Runtime context`）；删掉 `context-rendering.ts` 的 `CONTEXT_SECTION_HEADERS`、`context-assembler.ts` 的重导出和 allowlist 条目。`contextSectionHeaders()`/`DEFAULT_TEXTS` 仍被生产使用，保留。
  - 变异：把原 allowlist 条目放回 → `tests/architecture/production-reach.test.ts` RED：“src/core/agent-runtime/context-rendering.ts#CONTEXT_SECTION_HEADERS (wire-format) is reached now or gone; remove it from the allowlist”（行 105）；移除后 4/4 GREEN。
- **J2-05 完成。** `tests/architecture/production-reach-allowlist.json` 的 `PromptRecordRequestV1` 保持 `"reason": "wire-format"`，只把 note 改成 `the element type of PromptRecordReadResultV1.requests, returned by RuntimeExecutionPort.readPromptRecord`。静态行，无行为变异；architecture 4 文件 53/53 GREEN。
- **J2-06 完成。** 四个 `PC-joint-*` 的 12 个显式限时统一 `60_000`（见 §3）。只改限时；GREEN。

## 3. 规则 T：改动的限时（文件、用例、旧 → 新）

### T(1)：去掉 R1 加的显式限时，回到默认 30,000

| 文件 | 用例 | 旧 | 新 |
| --- | --- | ---: | --- |
| tests/work-graph/PC-entry-frozen-continuation.test.ts | re-renders the saved brief from the frozen template and strings after the pack changes | 180_000 | 删除（默认 30_000） |
| tests/work-graph/PC-entry-frozen-continuation.test.ts | answers unavailable when only the entry cannot read the frozen prompt text | 180_000 | 删除（默认 30_000） |
| tests/work-graph/PC-entry-frozen-review.test.ts | admits the review Run with the frozen template and strings after the pack changes | 180_000 | 删除（默认 30_000） |
| tests/runtime/PC-model-budget-preview.test.ts | reads the same totals() through a real tool call: 700 + 256 = 956, then 700 + 200 = 900 | 120_000 | 删除（默认 30_000） |

### T(2)：其余显式限时一律 60,000

| 文件 | 用例/位置 | 旧 | 新 |
| --- | --- | ---: | ---: |
| tests/runtime/PC-prepare-architecture-reminders.test.ts | 该文件唯一用例（24） | 120_000 | 60_000 |
| tests/runtime/PC-prepare-prompt-text-put-failure.test.ts | Work / Query（28、42） | 120_000 | 60_000 |
| tests/runtime/PC-prepare-prompt-freeze.test.ts | Work / Query（152、210） | 120_000 | 60_000 |
| tests/runtime/PC-prepare-review-freeze.test.ts | 该文件唯一用例（71） | 180_000 | 60_000 |
| tests/runtime/PC-send-start-check.test.ts | refuses a changed binding on a resume with the live handle…（263） | 120_000 | 60_000 |
| tests/runtime/PC-send-start-check.test.ts | answers busy before the binding check…（311） | 120_000 | 60_000 |
| tests/runtime/PC-read-record-work-query.test.ts | reads two Work permits…（75） | 120_000 | 60_000 |
| tests/runtime/PC-read-record-work-query.test.ts | reads two Query request rows…（115） | 120_000 | 60_000 |
| tests/runtime/PC-read-record-work-query.test.ts | rejects the read with unavailable…（134） | 120_000 | 60_000 |
| tests/runtime/PC-read-record-work-query.test.ts | validates the ref and answers a complete Work ref…（150） | 120_000 | 60_000 |
| tests/runtime/PC-joint-budget-removal.test.ts | PC-15(a) keeps system, current input and the two removal counts…（168） | 240_000 | 60_000 |
| tests/runtime/PC-joint-budget-removal.test.ts | PC-15(b) responseFormat is part of the measured final request…（265） | 120_000 | 60_000 |
| tests/runtime/PC-joint-prepare-freeze.test.ts | J-01 Work（195） | 120_000 | 60_000 |
| tests/runtime/PC-joint-prepare-freeze.test.ts | J-01 Query（234） | 120_000 | 60_000 |
| tests/runtime/PC-joint-prepare-freeze.test.ts | J-02 continuation（281） | 180_000 | 60_000 |
| tests/runtime/PC-joint-prepare-freeze.test.ts | J-02 review（299） | 180_000 | 60_000 |
| tests/runtime/PC-joint-freeze-and-pin.test.ts | PC-07 observes the pause…（103，即 S2-09） | 180_000 | 60_000 |
| tests/runtime/PC-joint-freeze-and-pin.test.ts | J-04 a Host binding installed after preparation…（127） | 120_000 | 60_000 |
| tests/runtime/PC-joint-record-and-failure.test.ts | PC-09 Work（122） | 180_000 | 60_000 |
| tests/runtime/PC-joint-record-and-failure.test.ts | PC-09 Query（163） | 180_000 | 60_000 |
| tests/runtime/PC-joint-record-and-failure.test.ts | PC-10 Work（188，即 S2-08） | 120_000 | 60_000 |
| tests/runtime/PC-joint-record-and-failure.test.ts | PC-10 Query（211，即 S2-08） | 120_000 | 60_000 |

改完后对 `tests/runtime/PC-*`、`tests/work-graph/PC-*`、`tests/contracts/PC-*` 做过 grep：除 §T(1) 删除的四处外，所有显式 per-test 限时都是 `60_000`；没有新增任何限时。

## 4. 检查（最终树）

- `node scripts/build-kernel-patch.mjs --check`：**0**（16 个源 / 64 个产物，全部 `matches: true`）。
- `node scripts/build-platform-prompts.mjs --check`：**0**（`platform prompt pack: OK`）。
- `flock ./.dsh-scratch/tsc.lock npm run typecheck`：**0**。
- `npm run check:architecture`：**0**（`next source boundaries: OK`；模块边 7/8 allowed，子模块边 56）。
- `flock ./.dsh-scratch/tsc.lock npm run build`：**0**。
- `git status --porcelain`：空。
- `git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-r2-whitelist.txt`：无输出（grep exit 1）。
- `git diff --name-only 1b5183a HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts`：无输出。
- 提交后 `git diff --name-only 1b5183a HEAD` 25 个文件，全部在白名单内。

## 5. 测试运行（`--maxWorkers=2`，`timeout 900`，一次一条）

| 批次 | 文件数 | 结果 |
| --- | ---: | --- |
| 改动的测试文件 批一 | 9 | **22 passed / 0 failed** |
| 改动的测试文件 批二 | 9 | **71 passed / 0 failed** |
| `tests/architecture` | 4 | **53 passed / 0 failed** |
| X 批一 | 8 | **27 passed / 17 failed**（环境，见 §6） |
| X 批二 | 8 | **41 passed / 1 failed**（环境，见 §6） |

- 18 个改动的测试文件共 **93 passed / 0 failed**。
- 架构测试 4 文件 **53 passed / 0 failed**（boundaries 29、production-reach 4、state-writes 19、record-store-literal-type 1）。
- X 16 个文件共 **68 passed / 18 failed**，18 项均为环境失败。
- 没有 `ENOENT … bwrap` 文本；实际是 `bwrap: command not found` 和 check 路径 `run_check rejected:unsupported`。

## 6. X 16 文件逐文件结果与环境失败

| 文件 | 结果 |
| --- | --- |
| tests/scenarios/A8-host-restart-entry.test.ts | 1 passed / 7 failed（A8-2d 通过；其余 7 项环境） |
| tests/scenarios/A8-host-restart.test.ts | 9 passed / 3 failed（环境） |
| tests/scenarios/C3-brief-idempotency.test.ts | 0 passed / 4 failed（环境） |
| tests/scenarios/C7-defer-reactivate.test.ts | 2 passed / 3 failed（环境） |
| tests/scenarios/K-R-attested-facts-source.test.ts | 4 passed / 0 failed |
| tests/scenarios/K3-06-mixed-batch.test.ts | 2 passed / 0 failed |
| tests/scenarios/K3-08-wait-reply.test.ts | 2 passed / 0 failed |
| tests/scenarios/K3-26-inventory-scenarios.test.ts | 7 passed / 0 failed |
| tests/scenarios/K3-29-recovery-continuation.test.ts | 8 passed / 0 failed |
| tests/scenarios/K3-R1-continuation-protection.test.ts | 7 passed / 0 failed |
| tests/scenarios/K3-R1-file-change.test.ts | 2 passed / 0 failed |
| tests/scenarios/K3-R1-restart-flows.test.ts | 3 passed / 0 failed |
| tests/scenarios/K3-R1-second-cleanup.test.ts | 1 passed / 0 failed |
| tests/scenarios/K3-R1-session-not-closable.test.ts | 1 passed / 0 failed |
| tests/scenarios/K3-R1-workspace-capture.test.ts | 7 passed / 0 failed |
| tests/state/invariants-fuzz.test.ts | 12 passed / 1 failed（环境） |

环境失败文本（本机无 bwrap；`tests/helpers/K3-tool-seams.ts` 的静态 check 返回 `unsupported`，check 失败路径停住）：

- `bwrap: command not found`；`run_check rejected:unsupported`。
- A8-host-restart-entry 7 项：`expected 'waiting' to be 'stopped'`。
- A8-host-restart 3 项：`expected 'waiting' to be 'completed'`；`the start-up re-drive completed the Task without a workflow/advance: expected … to match object { effectivePhase: 'satisfied' }`；`the start-up re-drive completed the Goal without a workflow/advance: expected … to match object { phase: 'COMPLETED' }`。
- C3 4 项：`expected 'waiting' to be 'stopped'`。
- C7 3 项：`expected false to be true`（`C7-defer-reactivate.test.ts:79` 等）。
- invariants-fuzz 1 项：`kinds that never ran: expected [ '起检 begin check', …(11) ] to deeply equal []`（`invariants-fuzz.test.ts:217:114`）。

补充证据：X-01 的接线变异用 base helper 内容复跑时，A8-host-restart-entry 是 8/8 红（含 A8-2d）；恢复后 A8-2d 绿，其余 7 项与 base 相同的环境路径。lead 用 bubblewrap 的探针已覆盖这 16 个文件，按要求由 lead 重跑。

## 7. 提交与范围

- 提交：`68dfb10` `PC-1b R2: X-01, P2, S2, R2, J2`（25 文件，+338/−152），基于 `1b5183a`。
- `git status --porcelain`：空。
- 范围检查：`git diff --name-only pc1b-base HEAD | grep -vE -f ./.dsh-ref/pc1b-r2-whitelist.txt` 无输出。
- 冻结夹具：`git diff --name-only 1b5183a HEAD -- tests/helpers/PC-platform-fixture.ts tests/helpers/PC-kernel-fixture.ts` 无输出；25 个提交文件里没有它们。
- 生产侧永久改动只有三处：`context-rendering.ts`/`context-assembler.ts`（J2-04 删除）、`runtime.ts`（R2-02 注释）；其余生产文件是变异，已全部按备份恢复，`git diff` 无残留。

## 8. 没有做成的行（规则 6）/ 需要 lead 知道的实现说明

- **规则 6：没有行因为“做不出来”被留下。** 冻结表里所有 fix 行都按行完成。
- **S2-06 的实现说明（不是未完成）：** 冻结行说“让原绑定的 resolver 返回另一个 provider/model”。RL Query fixture 没有公开 `fixture.base.host`，所以测试通过 fixture 自己的 `createHostRuntimeResolverRegistry` 接缝捕获同一个被钉住的 `RuntimeHostBindings` 对象，再替换它的 `resolveQueryConfiguration`。它仍是原绑定、公开第二次 start，断言原执行的 `run.ref`/`revision` 和零新模型调用；没有手写平台事实。
- **S2-05 的期望值：** 四个用例的 input 是手写 `WORK_INPUT`/`QUERY_INPUT`，模板、54 个字符串表项、base、plan guide、Skill 都是测试里注入的字面量；比较对象是模型消息整段，没有从 `preparedTexts()`、manifest 或捕获请求取期望。
- **X 的环境失败：** 见 §6；本机没有 bubblewrap，lead 按运行书用 bubblewrap 重跑场景。除这 18 项外没有其它环境失败。
