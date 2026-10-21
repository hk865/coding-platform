# S2 回复（C2、C1、A6、B1）

## 0. 问题与偏差

- 无阻塞性疑问。四项都按任务书完成，没有跳过步骤。
- **环境偏差（scratch 路径）**：任务书指定的 `/home/han001/dsh-work/s85-scratch/S2` 在 workspace 之外，本沙箱是 workspace-write，申请 danger-full-access 时没有审批通道（`no approval channel is available`）。实际 scratch 用 `/tmp/s85-scratch/S2`，路径写在每份 `report.md` 里。为便于 lead/Codex 复核，全部探针、日志和报告已复制到本仓库副本的 `.dsh-ref/s85-probes-S2/`（`.dsh-ref/` 被 git exclude，不进提交）。基带副本 `/tmp/s85-scratch/S2/base` 的 `node_modules` 与 `vendor/coding-agent/node_modules` 是指向本工作树的符号链接。
- **尺寸低于书上的估计**：合计 550（加 350 / 删 200），书上是 700–820。逐项都做了书列的动作，没有留下半搬的文件；差额主要在 B1（199，书 260–380）和 C1（112，书 160），因为工厂和搬移体比估计短，不是漏项。
- **测试清单的字面**：`s85-tests.txt` 含 `tests/work-graph/S2C-lines-scale.test.ts`，它不匹配“绝不跑 `*.scale.test.ts`”的 glob；按清单跑了它（不是规模批）。

## 1. 摘要（少于 300 词）

本 run 从 `s85-base` 完成 C2、C1、A6、B1 四项，行为不变、测试未改，一个提交 `c673759`（`S85 S2: C2 C1 A6 B1`）。

C2 把日历、Run 活动列表、轨道、任务时间线的四份稳定窗口循环收进 `readStableActivityWindow<T>`（每次尝试新 `Budget`，before → 延迟 `read(budget)` → after，只在两个水位 ready 且不等时重试，最多 4 次；Track 的 `ForbiddenError` 仍在调用方）。C1 把 `ReadFailureCode`/`ReadOutcome`/`readAllRecords`/`readAllHeads` 搬到 `note-base-reader.ts`、`renderUnderstandingBody` 搬到 `note-rendering.ts`，reader/writer/scribe 之间不再有运行时环，旧出口保留。A6 把六步替换规则搬进 `state/activity-replacement.ts` 的纯函数，`run-activity-service.ts` 只留改参数的包装（`existing === null ? null : existing.facts`）。B1 用 `createEventCodec(format)` 派生三个试点事件（GoalSettingsChanged、WorkspaceNoticeSeenChanged、WorkspaceLinePinsChanged）的 encode/decode/registration，四个阶段与错误原文不变，正文检查器作为钩子留在原处。

C2 的探针在最终提交的副本上重放：4 个探针、936 行调用、base 两次自比与 base/结果各 7/7 字节相同，0 差异。C1、A6、B1 按书要求做静态证明（搬移体逐字对比、判定表达式哈希相同、旧解码与新工厂并排）。`npm run typecheck`、`npm run check:architecture`、`npm run build` 全绿；清单 196 个测试文件 1717 项，1707 过、10 个失败全部是缺 `/usr/bin/bwrap` 的环境失败（base 副本同样 10 败 38 过），0 skip。

## 2. 分步表

| 步骤 | 状态 | 说明 |
| --- | --- | --- |
| C2 新执行器 + 四段循环接入 | 完成 | 4 个文件；工厂和类型出口不变；`activity-read-helpers.ts` 未动 |
| C2 字节证明（探针，base 两次 + 结果） | 完成 | 7 个证明文件，936 行日志，0 差异；最终提交上重放仍 0 差异 |
| C1 搬 4 组符号，断运行时环 | 完成 | 5 个旧文件 + 2 个新文件；旧出口保留；`store-failures.ts`、组合根未动 |
| C1 静态证明（体 diff + 绑定表 + 环） | 完成 | 三个函数体逐字相同；base 3 个运行时环 → 0 |
| A6 规则进 `state/`，旧函数变包装 | 完成 | 2 个文件；无 Query 接线、无新检查 |
| A6 静态证明（表达式相同 + 包装适配） | 完成 | 归一化后表达式 SHA-256 相同（`e49eb47a…`） |
| B1 工厂 + 三个事件改造 | 完成 | 3 个文件；旧具名出口、schema 顺序、proof 类型、`decodeNoticeOrigin` 保留 |
| B1 静态证明（三事件并排） | 完成 | 同四调用/四早退/三 JSON 标签；validate 返回原对象 |
| typecheck / check:architecture / build | 完成 | 全绿，见 §5 |
| 全清单测试（192 + `tests/architecture`） | 完成 | 196 文件，1707 过，10 个 bwrap 环境失败 |
| 提交、范围、尺寸 | 完成 | `c673759`；白名单外 0；`tests/` 改动 0；工作树干净 |

## 3. 新模块接口表（S4 可据此编码）

| 路径 | 导出 | 签名 | 来源 | 使用者 |
| --- | --- | --- | --- | --- |
| `src/core/work-graph/views/activity-stable-window.ts` | `ACTIVITY_WINDOW_MAX_ATTEMPTS` | `const = 4` | 三个 view 文件里各一份 `WINDOW_MAX_ATTEMPTS`、四处内联循环 | 三个 view 模块 |
| 同上 | `readStableActivityWindow<T>` | `(input: { records: Parameters<typeof readWatermark>[0]; cap: number; read: (budget: Budget) => Promise<ReadResult<T>>; mapError: (error: unknown) => CoreRejection; exhausted: () => CoreRejection }): Promise<ReadResult<T>>` | 同上 | `activity-read-model.ts`（日历、Run 列表）、`track-read-model.ts`、`task-state-timeline.ts` |
| `src/core/work-graph/notes/note-base-reader.ts` | `ReadFailureCode` | `'invalid' \| 'not_found' \| 'revision_conflict' \| 'unavailable'` | `note-read-model.ts:98–101` | `note-read-model`（再导出 + 内部）、`note-service`、`scribe-scope`、`note-decision-source`、`note-scribe-todos` |
| 同上 | `ReadOutcome<T>` | `{ ok: true; value: T } \| { ok: false; code: ReadFailureCode; reason: string }` | 同上（base 中是私有类型，新模块导出供三个消费者使用） | `note-read-model`（内部） |
| 同上 | `readAllRecords` | `(records: RecordLookupPort, index: string, values: readonly (string \| null)[]): Promise<ReadOutcome<EncodedRecord[]>>` | `note-read-model.ts:122–138` | `note-read-model`（再导出 + 内部）、`scribe-scope` |
| 同上 | `readAllHeads` | `(records: RecordLookupPort, index: string, values: readonly (string \| null)[]): Promise<{ ok: true; heads: NoteHeadSnapshot[] } \| { ok: false; code: ReadFailureCode; reason: string }>` | `note-read-model.ts:140–152` | `note-read-model`（再导出 + 内部）、`note-service`、`scribe-scope`、`note-decision-source`、`note-scribe-todos` |
| `src/core/work-graph/notes/note-rendering.ts` | `renderUnderstandingBody` | `(sections: { status: string; decided: string; open: string; next: string; risks: string }): string` | `note-service.ts:351–354` | `note-service`（再导出 + `:393`/`:1482`）、`note-read-model`（`:2009` 分支） |
| `src/core/work-graph/state/activity-replacement.ts` | `ActivityWriteOutcome` | `'created' \| 'replaced' \| 'unchanged'` | `run-activity-service.ts:76` | `run-activity-service.ts`（`RunActivityWriteOutcome` 别名） |
| 同上 | `decideActivityOutcome` | `(existing: RunActivityFactsV1 \| null, incoming: RunActivityFactsV1, endCommit: boolean): ActivityWriteOutcome` | `run-activity-service.ts:138–167` | `run-activity-service.ts` 的 `decideRunActivityOutcome` 包装（`planRunActivity` 照旧调用包装） |
| `src/core/work-graph/persistence/event-codec-factory.ts` | `EventFormat` | `{ eventType: string; schemaVersion: 1; jsonLabel: string; bodyProblem: (value: unknown) => string \| null }` | 三条重复 decode 流水线 | `decision-record-codecs.ts`（2 份）、`line-settings-codecs.ts`（1 份） |
| 同上 | `createEventCodec<T extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string }>` | `(format: EventFormat): { encode(event: T): EncodedDomainEvent; decodeBody(event: EncodedDomainEvent): DecodeResult<UnknownRecord>; registration: EncodedEventSchema }` | 同上 | 同上 |

旧出口保持：`note-read-model.ts` 再导出 `readAllRecords`/`readAllHeads`/`ReadFailureCode` 并保留 `mapStoreFailure`/`MappedStoreFailure`；`note-service.ts` 再导出 `renderUnderstandingBody`；`run-activity-service.ts` 的 `RunActivityWriteOutcome`/`decideRunActivityOutcome` 签名不变；B1 的三个 `encode…`/`decode…`、`DECISION_RECORD_SCHEMAS`/`LINE_SETTINGS_RECORD_SCHEMAS` 同名同序；`state-writes.test.ts:177` 点名的 decoder 仍在原文件。

## 4. 字节证明（§5.0）

探针与报告：仓库副本内 `./.dsh-ref/s85-probes-S2/`（原件 `/tmp/s85-scratch/S2/probes/`）。

### 4.1 C2：四个循环的读调用与日历时钟

做法：`apply-probe.mjs` 在 base 与结果副本中**同样**加入 `views/c2-probe.ts`（无生产入口引用），包住每个循环收到的 record port（`readMany`/`lookup`/`lookupOrdered`/`eventAt`）与日历 `now()`，每次调用按顺序写一行；`compare.mjs` 用 `Buffer.equals` 比较原始 UTF-8 字节。`result-c2` = base + 仅四个 C2 文件。七个证明文件每个在 base 跑两次、结果跑一次。

| 探针（包住的符号） | 文件 | base 行 | 调用数（base-run1） | base1=base2 | base=结果 |
| --- | --- | --- | ---: | --- | --- |
| 活动 record port（日历 + Run 列表） | `views/activity-read-model.ts` | 762（用于 773/775/777、798/800/802） | 262（`readMany` 158、`lookup` 38、`lookupOrdered` 64、`eventAt` 2） | 相同 | 相同 |
| 日历 `now()` | `views/activity-read-model.ts` | 763（调用 775） | 26 | 相同 | 相同 |
| 轨道 record port | `views/track-read-model.ts` | 1165（用于 1174/1176/1178） | 259（`readMany` 127、`lookup` 96、`lookupOrdered` 36） | 相同 | 相同 |
| 任务时间线 record port | `views/task-state-timeline.ts` | 539（用于 548/550/552） | 389（`readMany` 135、`lookup` 216、`lookupOrdered` 38） | 相同 | 相同 |

- 共 936 行；7/7 确定性比较、7/7 base-vs-结果比较逐字节相同，0 差异；每个文件测试全过（6/8/4/4/12/4/4 = 42 项）。
- **最终提交重放**：从 base 复制、用 `git archive HEAD` 覆盖为提交树、再施加同一探针，七个文件各跑一次（42 过），与 `base-run1` 日志 7/7 字节相同，0 差异（`logs/final-run1/`）。
- 探针唯一适配：base 把 `probedDeps` 直接交给内联循环，结果把 `probedDeps.records` 交给执行器、把 `probedDeps` 交给延迟 `read`；记录点相同（循环实际使用的 record 对象与日历 `now()` 表达式）。

### 4.2 C1：搬移体逐字对比与绑定表（静态）

`probes/c1/body-diff.txt`：`readAllRecords`、`readAllHeads`、`renderUnderstandingBody` 旧/新文本 **无差异**；`ReadOutcome` 只多一个 `export`（base 中是私有类型，新模块必须导出给三个消费者；`ReadFailureCode` 的旧文本本身就有 `export`）。`probes/c1/binding-table.md` 列出每个标识符的旧/新来源（`RecordLookupPort` → `record-store/lookup-ports.js`、`EncodedRecord` → `record-store/ports.js`、`NoteHeadSnapshot` → `contracts/note.js`、`decodeNoteHeadSnapshot` → `persistence/note-record-codecs.js`、`asOutcome` → `notes/store-failures.js` 等）。`probes/c1/imports.txt`：base 的 reader↔writer、writer→scribe→reader 运行环 3 个，改后 0；`npm run check:architecture` 也通过。

### 4.3 A6：判定表达式与包装（静态）

`probes/a6/decision-diff.txt` + `expression-normalized.diff`：只把 `const old = existing.facts;` 归一化为 `const old = existing;` 后，旧 `run-activity-service.ts:156–167` 与新 `activity-replacement.ts:28–39` 的表达式文本逐字节相同（同一 SHA-256 `e49eb47a…`，`cmp` 退出 0）；规则注释也逐字节相同。`probes/a6/wrapper.md`：新包装只有 `decideActivityOutcome(existing === null ? null : existing.facts, incoming, endCommit)` 这一处适配；`planRunActivity` 的调用点与参数未变。

### 4.4 B1：三个事件的旧解码 vs 工厂路径（静态）

`probes/b1/side-by-side.md`：每个事件并排列出旧函数与新 `decodeBody` 路径，四个阶段调用、参数、四个早退、三个 JSON 标签（`GoalSettingsChanged event`、`WorkspaceNoticeSeenChanged event`、`WorkspaceLinePinsChanged event`）相同；正文检查器仍是原来的 `goalSettingsChangedEventProblem`/`workspaceNoticeSeenChangedEventProblem`/`workspaceLinePinsChangedEventProblem`，**未搬、未改**。`probes/b1/encode-validate.md`：`encode` 只转交 `encodeEventEnvelope(event)`；`registration.validate` 成功时 `{ status: 'decoded', value: event }`（同一个外层对象）；两个 schema bundle 的条目与顺序不变（decision 先 Goal 后 notice；line 一项）。

## 5. 测试与检查

### 5.1 最终清单（`s85-tests.txt` 192 个 + `tests/architecture` 4 个）

两半并行，每半 10 批、每批 ≤10 文件，命令均为 `timeout 900 npx vitest run --maxWorkers=2 <files>`，无批次超时。

| 半 | 文件 | 通过 | 失败 | skip | 批次耗时 |
| --- | ---: | ---: | ---: | ---: | --- |
| 奇数半（含 boundaries、production-reach） | 98 | 903 | 10 | 0 | 8.6–40.2 s |
| 偶数半（含 state-writes、record-store-literal-type） | 98 | 804 | 0 | 0 | 7.5–18.0 s |
| **合计** | **196** | **1707** | **10** | **0** | — |

10 个失败全部是环境失败（缺 `/usr/bin/bwrap`），不是本 run 的回归；在 **base 副本**用同三个文件重跑得到同样的 `3 failed / 10 failed | 38 passed`：

| 文件 | 失败测试 | 错误 |
| --- | --- | --- |
| `tests/composition/S2B-be1s-shell.test.ts` (3) | `2B-09 real shell changed-file cases: touch, ls, failing write`；`2B-09 a cancelled command that wrote a file is one step and one edit`；`2B-09 a timed-out command that changed nothing is tool.failed timeout with zero edits` | shell 返回 `sandbox_unavailable`；`ENOENT … access '/usr/bin/bwrap'` |
| `tests/runtime/S5-user-message-tools.test.ts` (1) | `TU07 keeps a user decision wait out of the real Session consultation consumer and pump` | `Error: TU07 expected completed: {… "reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}` |
| `tests/work-graph/S3-context-inputs.test.ts` (6 = 3×memory/sqlite) | IN05、IN11、IN12 | `{"status":"rejected","code":"unsupported","reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}` |

### 5.2 各项自己的测试（与上面有重叠，非相加）

| 项 | 文件 | 结果 |
| --- | ---: | --- |
| C2 | 18 | 100 过，0 失败；7 个证明文件 42 过 |
| C1 | 38 | 444 过，2 个既有 skip，0 失败 |
| A6 | 20 | 41 过，0 失败 |
| B1 | 108 | 1136 过，7 个 bwrap 环境失败（S5-user-message 1、S3-context-inputs 6） |

### 5.3 §3 / run sheet 的检查

- `flock /tmp/s85-scratch/tsc.lock npm run typecheck`：绿（`tsc --noEmit -p tsconfig.json` 无输出）。
- `npm run check:architecture`：绿，末行 `next source boundaries: OK`；`pure submodules: WorkGraph/state`。
- `flock /tmp/s85-scratch/tsc.lock npm run build`：绿（`tsc -p tsconfig.build.json`）。
- 范围：`git diff --name-only s85-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt` 无输出；`git diff --name-only s85-base HEAD -- tests` 无输出；`git status --porcelain` 无输出（回复与探针在 `.dsh-ref/`，被 exclude）。
- 提交：`c673759` `S85 S2: C2 C1 A6 B1`。

## 6. 改动行数（对 `s85-base`，新文件按空文件计）

| 项 | 加 | 删 | 合计 |
| --- | ---: | ---: | ---: |
| C2 | 105 | 62 | 167 |
| C1 | 67 | 45 | 112 |
| A6 | 48 | 24 | 72 |
| B1 | 130 | 69 | 199 |
| **合计** | **350** | **200** | **550（净 +150）** |

`git diff --shortstat s85-base HEAD`：16 files changed, 350 insertions(+), 200 deletions(-)。书上的参考是 700–820；实际 550，逐项完成、没有为凑行数保留旧副本。

## 7. 书/盘点/运行单中可疑或需记一笔的地方

1. **scratch 路径**：运行单把 `$S85_SCRATCH` 定在 `/home/han001/dsh-work/s85-scratch`，但它是 workspace 之外、沙箱不允许写，且无审批通道；本轮实际用 `/tmp/s85-scratch/S2`，并把副本放进 `.dsh-ref/s85-probes-S2/`。下一轮若仍在这个沙箱，建议预先在运行单里给一个仓内可忽略的替代路径。
2. **C1 的 `ReadOutcome` 出口**：书 §5.4 只要求 `note-read-model.ts` 重导出 `readAllRecords`/`readAllHeads`/`ReadFailureCode`，没有列 `ReadOutcome`。base 中它是私有类型；新模块导出它是为了让 `note-read-model`/`note-service`/`scribe-scope` 继续引用同一类型。旧出口没有破坏（原本就不可导入），生产可达检查通过；这里与书不矛盾，只是容易被读成“也应当再导出”。
3. **B1 的 `EventFormat.schemaVersion`**：写成字面量 `1`，构造两份 decision 格式时传的是 `DECISION_EVENT_SCHEMA_VERSION`（`1 as const`）；如果以后有 `@2`，这个类型会先拒绝，和书里“试点只到 @1”一致。
4. **尺寸偏差**：见 §0；B1 的工厂 78 行、两份格式 52 行，比盘点的 170–240 新增少；C1 的搬移体本身就很短。没有发现被漏掉的搬移对象（`decodeNoticeOrigin`、`eventBodyProblem` 的直接调用行为都保留）。
5. **测试清单**：`S2C-lines-scale.test.ts` 在 192 个文件里，但运行单同时写“绝不跑 `*.scale.test.ts`”。按字面它不属于该 glob，本轮按清单跑了，未跑 `npm run test:scale`。

## 8. HANDOFF

无：四项、检查、提交、证明都在 180 分钟内完成，没有半搬的文件。后续只需 lead 合并三个 run、跑日常/规模批并由 Codex 复核；S4 可直接使用 §3 的接口表。
