# PC-1b 回复（P、S、R 与联合步；2026-10-22）

## 1. 疑问

1. **裁定 16 与旧夹具冲突。** `tests/work-graph/S3-prepared-context-admission.test.ts` 用 `preparationHost`（provider/model 为 `test/test`）准备，用 S2B 夹具（`deepseek/s2b-runtime-steps-model`）启动；旧行为只比 `configurationRevision`/`hostTemplate`，所以一直通过。裁定 16 加比 modelId/provider/model 后，这个 §5.3 未点名的旧测试会 `forbidden` 并永久等待。处理见 §4 第 2 条（只对没有 `selection` 的测试模型跳过整组比较），请确认。
2. **冻结夹具 `frozenPromptInputs` 运行时不可用。** 它用 `openPCWorkFixture({ tools: [] })`，而 WP2 的 Role 安装拒绝空工具表，必然抛错。§5.3 要求这些调用者改用它，但本轮只允许修夹具的类型错误。处理见 §4 第 3 条（新增 `tests/runtime/PC-frozen-prompt.ts` 等价 helper），请确认是否要在 PC-2 修夹具。
3. **`resources/skills` 根目录消失。** 裁定 23 删除五份 `platform-*` 后，空目录只在当前工作树里存在；C 的 `tests/app/PC-host-prompt-selection.test.ts:262` 断言 `existsSync(PLATFORM_SKILL_RESOURCE_ROOT)`，从干净检出运行会失败，而该测试不在白名单、§5.3 也没点名。本轮无法修，见 §9。
4. **PC-15 平台用例未完成。** 冻结夹具的 WP2 只允许很小的 `wp2-read.txt`，做不出可删的大段历史；第二次 Run 的 `continuation()` 一直 `busy`（"verifying/finalize its round first"）。另外 `responseFormat` 在 `src` 里只有 `observed-run` 选项，没有 Host 配置通路，无法在平台层注入。详见 §8、§10。
5. **P 组规模约估计的 2.3 倍。** 见 §7。

## 2. 摘要

P、S、R 三组全部完成并各自提交；联合步完成 PC-06、PC-07、PC-08、PC-09、PC-10 和 allowlist 清理，PC-15 平台用例未完成（S 组的 reserve 用例已完成）。类型检查、架构检查、构建、两个生成器 `--check` 全绿；31 个改动/新增测试文件 202 项、`tests/architecture` 53 项、联合 8 项全过。白名单内无越界文件，工作区干净。九条提交（p0、P×3、S×2、R×2、joint），未 amend。冻结的 `PC-platform-fixture.ts` 只改了一行类型断言（见 §7）。当前没有 bwrap/ENOENT 环境失败。

## 3. 逐裁定、逐行 RED → GREEN

**P 组**

- **裁定 14（冻结）**：`PC-prepare-prompt-freeze`（5 项："renders base, strings and inputs from the injected pack and keeps the selection"、"uses the ruling-30 default when no source is wired, and still names a rejected pack"、"turns a rejection into invalid…"、"takes the role label and purpose…" 等）；`PC-prepare-review-freeze`（1 项："uses the injected review strings and freezes the review template"）。RED：注入包的文字没有进入请求/manifest；GREEN：5+1。
- **裁定 15（Skill 选择）**：`PC-prepare-skill-selection`（5 项：平台包模板、按 `path.resolve` 认根、显式空表保持空、未知 id `invalid`、自定义目录走公开 `FileSkillLoader`、无选择时默认 `coding-safety`）；旧 `W2-role-skills`（5 项，内容改从包/冻结集取）。
- **裁定 18（sectionOrder）**：`PC-prompt-section-order`（2 项："keeps today's eight-section order for the two Work call kinds"、"projects each Query template onto its call kind"）。
- **裁定 19（冻结正文读取）**：`PC-prompt-texts-store`（3 项："stores each distinct content once…"、"reads every child by its ref and does not require the child origin to be this run"、"rejects a body that does not match its ref and one that cannot be read"）。
- **p0 seam**：`PC-prompt-texts`（8 项：成功返回正文，digest/size/contentType/record.ref 不符返回 null，手写 `{templates,strings}` 可渲染）。

**S 组**

- **裁定 20/21（最终请求与 preview）**：`PC-model-budget-preview`（5 项："reads the same totals() through preview: 700 + 256 = 956, then 700 + 200 = 900"、"keeps wrap as the only reservation and persist…"、"awaits an asynchronous counter and clamps…"、"keeps the UTF-8 + 4096 estimate…"、"reports fits=false without reserving…"）。
- **裁定 22（冻结输入进发送）**：`PC-send-frozen-prompt`（2 项，Work/Query 各一：system 前段等于冻结 base）；旧 `B1-kernel-assembly`、`cpp-source-index`、`R4c-execution-history`、`R4c-graph-history`、`R4c-session-continuity`、`source-text-loop-migration`、`source-tool-lifecycle` 仅改参数，断言不变；`B1` 的三个旧 `skills` 用例移到准备/启动。
- **裁定 23（删平台 Skill 目录）**：`PC-send-platform-root`（2 项：目录不存在时 Work/Query 仍能准备+启动）。
- **裁定 16（启动/恢复核对）**：`PC-send-start-check`（8 项：Work/Query × promptPack/modelId/reasoningReplay/provider/model 变化都 `forbidden`、模型 0 次）。

**R 组**

- **裁定 26（Work 记录）**：`PC-record-model-request-facts`（5 项：sequence 1/2、每个新事实的消费不一致、`model-request-sequence:<runKey>:<seq>` 唯一占位、并发后手 `busy`）；`A2-step1-codecs` 新增严格接受/拒绝（31 项中新增部分）；`B2-model-request`（5 项）。
- **裁定 28（Work 读口）**：`PC-record-model-request-read`（4 项：按 sequence 列出、只读本 Run、不扫全库）；`PC-read-record-work-query`（3 项：Work 顺序、Query 顺序、未接读口 `unavailable`）。
- **裁定 27（Query 首次事实/不可变）**：`PC-query-record-usage`（6 项：reservation `admitted:false`、admission 只翻 true、后续 usage 只改四个用量字段、改不可变事实 `idempotency_conflict`、不完整 `invalid`）；`PC-query-record-codec`（5 项）。
- **p2（裁定 17，入口复核）**：`PC-entry-frozen-continuation`（2 项："re-renders the saved brief from the frozen template after the pack changes"、"answers unavailable when the frozen prompt text body cannot be read"）；`PC-entry-frozen-review`（1 项："admits the review Run with the frozen review template after the pack changes"）。

**联合步**

- **PC-06** `PC-joint-prepare-freeze.test.ts`（2 项：Work/Query 在换包、换 Skill 文件后仍发准备时的 system/input，set 的 base digest 等于字面 sha256）。
- **PC-07** `PC-joint-freeze-and-pin.test.ts`（1 项：正式 pause → 换包/换 Skill → resume，system 与第一次逐字节相等）。
- **PC-08**（同文件，1 项：真实 Host registry 在准备后装新绑定，执行仍用旧包/旧 system）。
- **PC-09** `PC-joint-record-and-failure.test.ts`（2 项：Work/Query 各一次工具调用后终答，重读两条请求的 sequence、digest、removed、cap（321/321）、同一 `toolSpecsRef`、text 的 sha256、手拼 system 等于 `systemDigest`；Work 授权与 Query reservation 各改一个事实重放 → `idempotency_conflict`）。
- **PC-10**（同文件，2 项：只让 `PROMPT_TOOL_SPECS_CONTENT_TYPE` 的 put 失败，准备成功、Work/Query 启动 `unavailable`、模型 0 次）。
- **PC-15**：S 组 reserve 用例已过（`PC-model-budget-preview` 的 956/900）；平台用例未完成，见 §8/§10。

## 4. 与 §4 seam 不同的地方

1. **`createModelRequestReadPort` 是独立工厂**，没有并进 `createModelCallService` 的返回对象；`create-platform.ts` 以 `modelRequestReads: createModelRequestReadPort(entryDependencies)` 接线。原因：§4 只冻结了 `ModelRequestReadPort` 接口，没有冻结服务对象的形状；r3 原按“服务对象带读方法”接线，r1 按独立工厂实现，最后取后者，避免把读口塞进写端口。
2. **启动核对只在模型带显式 `selection` 时比 modelId/provider/model**；`model.selection === undefined`（仅测试直接构造的 `BoundModel`）整组跳过。原因：`promptSelectionOf` 的 revision 回退不是稳定身份，`S3-prepared-context-admission` 的准备/启动 Host 模型 revision 本来就不同（§1.1）。生产 Host 恒填 `selection`，五个字段仍全比。
3. **`frozenPromptInputs` 的替代**：新增 `tests/runtime/PC-frozen-prompt.ts`，用 `openPCWorkFixture({ tools: ['read'] })` + `prepare()` + `preparedTexts().prompt` 构造同样的冻结输入；§5.3 的七个直接调用者改用它。冻结夹具未做运行期修改。
4. **准备在 `deps.promptPacks` 缺席时用 `createPlatformPromptPackSource()`**（裁定 30 的默认），而不是 `unavailable`。原因：`task-claim-fixture.ts:592`、`K3-35-prepare.ts:92`、`WP1-entry-fixture`、`S4C2-assembly` 等直接调用者不在白名单；被点名但拒绝的包仍 `invalid`，不回退。
5. **`storePromptTexts` 的 `sourceRefs`** 由 packId + base.version 生成 governance 引用（body store 拒绝空数组，而 §4 的签名没有 sourceRefs 参数）；tool-spec body 用 `{kind:'governance', refId:'runtime-model-configuration', revision: bound.configuration.revision}`。
6. **`SkillContext` 类型别名**：`public-api` 不导出该别名，S 的 `prompt.skills` 用 P 的 `PromptSkillV1`（同形）。
7. **`readPromptRecord` 的 Query manifest 读取**：两处 Query loader 都是私有函数，runtime.ts 里放了一个最小的 `readQueryPromptSet`（只读 manifest + `decodePromptSetV1`），未复制整个 loader。
8. **p1 给 assembler/recipe 输入加了 `texts?`**，并把 `state/context-input.ts` 的 call-kind 许可表在 preparation 侧复制了一份（该表私有，未导出）。
9. **冻结夹具一行类型修改**：`tests/helpers/PC-platform-fixture.ts:529` `captured[1].prepared` → `(captured as StartArgs)[1].prepared`（TS 把闭包内赋值的 `captured` 收窄成 `never`）。只改类型，运行期不变，按要求列出。

## 5. 跑过的测试

- 改动/新增测试文件 **31 个 / 202 项全过**（4 批，每批 ≤9 文件，`--maxWorkers=2`）：
  - 批一 8 文件/38 项：`AG6-agent-assembly`、`PC-prompt-section-order`、`PC-prompt-texts-store`、`PC-prompt-texts`、`cpp-source-index`、`B1-kernel-assembly`、`C2-runtime-platform-tools`、`K3-35-manifest-trim-pure`。
  - 批二 9 文件/36 项：`PC-model-budget-preview`、`PC-prepare-prompt-freeze`、`PC-prepare-review-freeze`、`PC-prepare-skill-selection`、`PC-read-record-work-query`、`PC-send-frozen-prompt`、`PC-send-platform-root`、`PC-send-start-check`、`W2-role-skills`。
  - 批三 7 文件/91 项：`R4c-execution-history`、`R4c-graph-history`、`R4c-session-continuity`、`source-text-loop-migration`、`source-tool-lifecycle`、`A2-step1-codecs`、`B2-model-request`。
  - 批四 7 文件/37 项：`PC-entry-frozen-continuation`、`PC-entry-frozen-review`、`PC-query-record-codec`、`PC-query-record-usage`、`PC-record-model-request-facts`、`PC-record-model-request-read`、`S3-prepared-context-admission`。
- `tests/architecture` + 联合 **7 文件 / 61 项全过**（架构 4/53、联合 3/8）。
- 组内另跑：`R5b-query-job` 8、`R5b-query-session-loop` 4、`S3-context-assembler` 15、`B2-execution-result`/`R4-control-intent` 65、`K3-35-owner-manifest-trim` 2、`K3-unknown-call-review-section` 1 等，均过。
- 环境失败：**无**。未出现 bwrap/ENOENT 或沙箱不可用。

## 6. 检查

- `node scripts/build-kernel-patch.mjs --check`：0（16 源 / 64 产物全 matches）。
- `node scripts/build-platform-prompts.mjs --check`：0（platform prompt pack: OK）。
- `flock ./.dsh-scratch/tsc.lock npm run typecheck`：0。
- `npm run check:architecture`：0（`next source boundaries: OK`）。
- `flock ./.dsh-scratch/tsc.lock npm run build`：0。
- 范围：`git diff --name-only pc1b-base HEAD | grep -vE -f whitelist` 无输出；`git status --porcelain` 空。

## 7. 行数、旧测试、白名单

`git diff --numstat pc1b-base HEAD`（不含 `.dsh-ref/`）：

| 组 | 加 | 删 | 合计 | 估计 | 文件 |
| --- | ---: | ---: | ---: | ---: | ---: |
| P（含 p0/p1/p2） | 2,129 | 640 | 2,769 | 1,200 | 30 |
| S（s1/s2） | 862 | 348 | 1,210 | 1,100 | 27 |
| R（r1/r2/r3） | 1,519 | 33 | 1,552 | 1,200 | 21 |
| 联合 | 389 | 46 | 435 | — | 4 |
| **合计** | **4,899** | **1,067** | **5,966** | 3,500+ | 82 |

P 超估计 2.3 倍，原因：`prompt-set-texts.ts` 296 行、`continuation-brief.ts` 365/324（旧默认文字全部参数化并加 `packString` 严格读取）、两份 preparation 与 `context-*` 配方接线、5 个新测试文件 + 6 个旧测试改写；S 与 R 在估计内或略高。

**旧测试改动（仅 §5.3 点名）**：

- P：`W2-role-skills`、`AG6-agent-assembly`、`C2-runtime-platform-tools`（Skill 内容改从包/冻结集取，保留显式子集/空选择/自定义目录）；`WP1-units-fixture`、`K3-35-manifest-trim-pure`、`S3-prepared-context-admission`（手写 manifest 补 `promptSet`；K3-35 的边界按加了 `promptSet` 后的字节手算重定，仅此一处）。
- S：`B1-kernel-assembly`（三个旧 `skills` 用例移到准备/启动）、`cpp-source-index`、`R4c-execution-history`、`R4c-graph-history`、`R4c-session-continuity`、`source-text-loop-migration`、`source-tool-lifecycle`（只改参数为 `frozenPromptInputs` 等价 helper，断言不变）。
- R：`A2-step1-codecs`（新字段接受/拒绝）、`B2-execution-fixture` ~316 与 `B2-model-request`（写模型请求处补事实/sequence）。
- 没有改其他旧断言；`S3-prepared-context-admission` 的等待问题是生产修正（§4.2）解决的，测试本身只补了 `promptSet`。

**白名单**：删除 PC-1a 加的全部 13 条 PC-1b 条目（PLATFORM_SKILLS、PromptPackSourcePort、createPlatformPromptPackSource、PROMPT_TEXT_CONTENT_TYPE、PROMPT_TOOL_SPECS_CONTENT_TYPE、ModelRequestPromptFactsV1、QueryRequestPromptFactsV1、PromptRecordRequestV1、PromptRecordReadResultV1、PromptRecordReadV1、PromptSetV1、promptSelectionOf、decodePromptSetV1）。另加 18 条 `wire-format`：9 条是被 reach walker 跟不到的类型/可选端口成员（`PromptRecord*`、`RuntimeExecutionPort.readPromptRecord`、`ModelRequestReadPort.listRunModelRequests`）、4 条是 `readPromptRecord` 的实现 helper（`messageOf`/`rejected`/`sameQueryRunRef`/`readQueryPromptSet`）、`completeRunRef`，以及 4 个仍被旧契约测试引用的兼容常量与 `INITIAL_COORDINATION_RESPONSE_GUIDE`。没有 PC-1a 的条目留下。

## 8. PC-15 平台用例与剩余生成包 importer

**PC-15 平台用例未完成，也没有在 base 树上跑。** 冻结夹具的 WP2 只允许很小的 `wp2-read.txt`，构造不出“可删的大段历史”；`continuation()` 第二次运行一直 `busy`（"verifying/finalize its round first"）。另外 `responseFormat` 在 `src` 里没有 Host 配置通路（只有 `observed-model-run.ts` 的选项），平台层注入不了。按代码推理：base 树在选材后才追加 `systemInstruction`/`responseFormat`，meter 量完整请求，预算紧时会 `ContextCapacityExceeded`；新代码先把可删历史删掉再 preview，meter 接受。这个推理没有在 base 树上实测，作为 HANDOFF 留下。S 组的 reserve 用例（956/900）已 GREEN。

**剩余 `platform-pack.generated` importer**（`grep -rln`）：
`src/app/host.ts`、`src/business/workflow/consultation.ts`、`src/contracts/note.ts`、`src/contracts/prompts/prompt-pack.ts`、`src/contracts/continuation-brief.ts`、`src/contracts/core/prepared-execution.ts`、`src/core/agent-runtime/{architecture-reminders,command-rerun-tools,communication-tools,context-fact-text,context-query-recipe,context-rendering,context-review-recipe,context-work-recipe,execution-inputs,exploration-tools,graph-tools,note-tool,project-source-tool,query-preparation,readonly-command-tool,role-profiles,session-discovery-tools,unknown-call-review-tools,whiteboard-tools}.ts`、`src/core/work-graph/notes/note-read-model.ts`、`src/core/work-graph/views/context-extensions.ts`。准备/入口链路里只剩“无参数默认”的渲染器 import；工具工厂与业务层文字按裁定 14 留在 PC-1。

## 9. 疑似任务书/清单/工作表的错误

1. `tests/app/PC-host-prompt-selection.test.ts:262` 断言平台 Skill 根目录存在，但裁定 23 删除其全部内容后目录从干净检出消失；§5.3 未点名，白名单也不允许改 `tests/app/PC-*`。本轮只在当前工作树（空目录尚在）通过，干净检出会红。
2. 冻结夹具 `frozenPromptInputs` 运行时必然失败（`tools: []` 被 WP2 Role 安装拒绝），而 §5.3 要求七个旧测试用它；只允许修类型错误的规定解决不了。
3. 裁定 16 与 `S3-prepared-context-admission` 的旧 Host 模型 revision 冲突（§1.1），§5.3 没把它列为要改的旧测试。
4. PC-15 平台用例与冻结夹具能力不匹配（大历史、`responseFormat` 的 Host 通路都没有）；按当前夹具写不出这一行。
5. §4 只冻结了 `ModelRequestReadPort` 接口，没冻结“谁提供它”，r1 用独立工厂、r3 先按服务对象接线，多花了一轮。
6. 工作表的 `RuntimeDeps` 与代码的 `RuntimeExecutionDependencies` 名称不一致（工作表已提示，记录在此）。

## 10. HANDOFF

已完成：p0；P（14/15/18/19、p2 的 17）；S（16/20–25）；R（26–30）；联合 PC-06/07/08/09/10 与 allowlist 清理；五道检查全绿；31+3 个测试文件全过；九条提交；工作区干净。

未完成：**PC-15 平台用例**（S 的 reserve 用例已完成）。

最短路径：给 `tests/helpers/PC-platform-fixture.ts` 的 WP2 world 加一个可删的大工具结果（或允许测试注入一段长历史正文），并把 `responseFormat` 通过 Host 绑定/配置暴露给平台；然后在新 `tests/runtime/PC-joint-budget-removal.test.ts` 里按 §5.2 写：长 Host 说明 + `responseFormat` + 紧窗口 + 可删历史，预算取“删后刚好 fit”，断言新代码删除历史且 meter 接受；在 base 树上同一固定输入应得到 `ContextCapacityExceeded`（需另建 base 工作树实测）。夹具是 Codex 冻结的，改动应由 lead 走冻结流程。
