本次仅作静态只读审查，未运行测试、构建或变异。发现 5 项违规、1 项不整洁。

| 编号 | 类别 | 位置 | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| P2-01 | 违规 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:92`、`:98`、`:115` | P-09；`.lead-ref/books/pc1-book.md:53` | 用 `preparedTexts()` 推算 driver 读取次数，再拦截内部 `RawArtifactBodyStore.prototype.read`，以次数证明故障发生于入口。这里依赖具体存储实现和内部读取次序，并非公开入口的独立故障接缝。 | **需 lead 裁定夹具支持**：通过 `ExecutionEntryDependencies.bodies`（`src/core/work-graph/model/execution-entry-contracts.ts:156`）只包装入口的读取端口，准备后开启一次故障；删除原型 spy 和 driver 次数推算。当前冻结夹具没有该选项（`tests/helpers/PC-platform-fixture.ts:65`）。 |
| P2-02 | 违规 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:113` | P-09 指定的变异证明；`.lead-ref/books/pc1b-findings.md:27` | 同规则的简单变异仍能通过：把入口不可读分支改为 `throw new Error(...)`，入口自己的 catch 仍返回 `unavailable`，读取次数及模型调用数也不变（`src/core/work-graph/tasks/execution-entry-service.ts:1011`、`:1636`）。因此当前断言不能证明入口自己的读取失败分支仍在。 | 增加公开返回 `reason` 的完整字面断言：`the frozen continuation-brief template could not be read: PC injected entry prompt-text read failure`，并用上述抛错变异验红。该原因来自现有分支（`execution-entry-service.ts:1012`）及测试故障字面量（测试文件`:106`）。 |
| P2-03 | 违规 | `tests/runtime/PC-prepare-prompt-freeze.test.ts:153` | P-10；`.lead-ref/books/pc1b-findings.md:28` | 独立调用 `snapshotRuntimeConfiguration` 不能证明公开准备实际取得的快照保留 `selection`。准备先从原配置另取 selection，再创建快照（`src/core/agent-runtime/execution-preparation.ts:393`、`:396`）；只在准备调用点丢掉快照的 selection，现有测试仍可通过。**不存在读取该局部快照的公开读口**；manifest 保存的是 `promptSet`（同文件`:577`、`:585`），`readPromptRecord` 也只读冻结集、请求和正文（`src/core/agent-runtime/ports.ts:83`）。 | **需 lead 修订此子项的验收裁定**：明确允许“纯函数契约测试＋静态核对准备调用点”，并注明它不构成公开准备链的快照证明；不要为此新增生产读口。 |
| P2-04 | 违规 | `tests/runtime/PC-prepare-prompt-freeze.test.ts:126`、`:180`、`:195` | P-10；裁定14（`.lead-ref/books/pc1-book.md:323`） | 两例暂停时均未改变 `reasoningReplay`；Query 又只断言 modelId/provider/model，遗漏 packId/reasoningReplay。把 Work/Query 的 reasoningReplay 单独改为 await 后读取，或把 Query 的 packId 改为 await 后读取原配置，相关用例仍过（对应生产赋值：`execution-preparation.ts:538`、`query-preparation.ts:294`）。 | 两例暂停时均将 reasoningReplay 从 `none` 改为 `current_run`；Query 补齐 `packId: 'platform'`、`reasoningReplay: 'none'` 的字面断言，并对上述单字段变异验红。 |
| P2-05 | 违规 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:75`、`:124`；`tests/work-graph/PC-entry-frozen-review.test.ts:75` | `.lead-ref/books/run-pc1b-r1.md:49`：不提高超时 | 三个已有用例新增 180,000 ms 限时；原来使用默认 30,000 ms（`vitest.config.ts:9`；continuation 基线`:58`，review 基线`:58`）。两文件实测分别仅 5,333、1,240 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5335`、`:5386`）。 | 删除这三个显式限时，恢复原默认值。 |
| P2-06 | 不整洁 | `tests/runtime/PC-prepare-architecture-reminders.test.ts:24`；`PC-prepare-prompt-text-put-failure.test.ts:28`、`:42`；`PC-prepare-prompt-freeze.test.ts:151`、`:206`；`PC-prepare-review-freeze.test.ts:71` | 本轮要求第7项：新测试限时 | 前三文件使用 120,000 ms，review 使用 180,000 ms；文件实测依次为 1,327、2,513、2,568、1,106 ms，均远超三倍且超过60秒（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5467`、`:5449`、`:5460`、`:5394`）。 | 删除这些显式限时，使用仓库默认 30,000 ms。 |

逐行结论：

- **P-01：P2-06（仅限时），修复本身 OK。** 唯一默认包读取在可选参数回退处；类别、时间、后缀、省略文字均取传入 texts，生产准备确实传参，不是测试专用路径（`src/core/agent-runtime/architecture-reminders.ts:34`、`:127`、`:133`、`:204`、`:214`；`context-work-recipe.ts:152`）。公开准备断言 `CUSTOM`，指定变异会失败（`tests/runtime/PC-prepare-architecture-reminders.test.ts:16`、`:20`）。
- **P-02：rejected, untouched。** 原渲染异常仍映射为 `unavailable`（`src/core/agent-runtime/execution-preparation.ts:514`）。
- **P-03：OK。** 只在平台分支查表前 trim，之后未知 ID 返回 `invalid`；自定义目录仍交公开 loader。旧 loader 的 trim 位于选择请求 schema（`src/core/agent-runtime/prompt-set-texts.ts:269`、`:275`、`:277`、`:291`；`vendor/coding-agent/dist/core/ports/skill_provider/skill-provider-port.js:7`）。去掉 trim 会使补空格用例失败（`tests/runtime/PC-prepare-skill-selection.test.ts:75`）。
- **P-04：rejected, untouched。** 省略标记守卫仍保留固定文字（`src/core/work-graph/state/context-input.ts:60`）。
- **P-05：OK。** secretary＋scribe、显式空选择的真实请求断言和该例 60,000 ms 已恢复；失败准备核对零模型调用（`tests/runtime/W2-role-skills.test.ts:90`、`:203`、`:209`、`:213`）。与上轮指出的缺项一致（`.lead-ref/audit1/P.out.md:13`）。
- **P-06：P2-06（仅限时），断言修复 OK。** 独立 Skill 正文、元数据、source 和摘要断言已补；公开 review 准备覆盖冻结结果（`tests/runtime/PC-prepare-skill-selection.test.ts:26`、`:48`；`PC-prepare-review-freeze.test.ts:50`、`:61`；`tests/contracts/PC-prompt-texts-store.test.ts:83`、`:92`）。注入正文及 review 字符串确实不同于生成包（`src/contracts/prompts/platform-pack.generated.ts:139`、`:553`），改读生成包会失败。
- **P-07：OK。** `你好/世界` 均为6字节，`SAME_TEXT/DIFF_TEXT` 均为9字节；另有独立长度负例，删除摘要校验会漏放篡改正文并使断言失败（`tests/contracts/PC-prompt-texts.test.ts:42`、`:50`；`PC-prompt-texts-store.test.ts:120`、`:132`、`:134`）。
- **P-08：P2-05。** 字符串冻结行为已修：两个用例注入实际使用的 summary/status lead，准备后修改，再启动并核对旧值（`tests/work-graph/PC-entry-frozen-continuation.test.ts:53`、`:64`、`:70`；`PC-entry-frozen-review.test.ts:53`、`:64`、`:70`）。生成包默认分别为“这是任务 ”和“状态：”，指定变异会造成入口拒绝（`src/contracts/prompts/platform-pack.generated.ts:326`、`:553`）。
- **P-09：P2-01、P2-02、P2-05。** 当前通过 `promptTextReads === driverReads + 1` 只失败一次；模型断言是已有首次运行的1次，即接续新增0次（`tests/work-graph/PC-entry-frozen-continuation.test.ts:104`、`:117`）。
- **P-10：P2-03、P2-04、P2-06。** 暂停 source、修改原配置和 resolve 一次断言已有，但不足以覆盖上述缺口（`tests/runtime/PC-prepare-prompt-freeze.test.ts:51`、`:123`、`:138`、`:179`、`:198`）。
- **P-11：P2-06（仅限时），行为断言 OK。** Work/Query 均通过 `failPutContentType` 故障公开准备，核对 unavailable、无 prepared 可启动及零调用；改映射为 invalid 会失败（`tests/runtime/PC-prepare-prompt-text-put-failure.test.ts:19`、`:22`、`:33`、`:36`）。
- **P-12：OK。** 两处注释已说明缺 source 安装平台默认（`src/core/agent-runtime/execution-preparation.ts:63`；`query-preparation.ts:145`）。
- **P-13：rejected, untouched。** 两张合法段表仍各自保留（`src/core/agent-runtime/context-rendering.ts:69`；`src/core/work-graph/state/context-input.ts:65`）。
- **L-03：OK。** 从公开 API 导入 loader，并使用 `options.kernel?.FileSkillLoader ?? KernelFileSkillLoader`；原 unavailable 分支已删，该文件其余生产变化只有 P-03（`src/core/agent-runtime/prompt-set-texts.ts:16`、`:275`、`:287`）。

DSH 自述核对：

- **§7.5／P-10：无公开快照读口的说明成立，替代完成的结论不成立。** 纯函数测试与实际准备快照之间仍缺观察证据，见 P2-03（`.lead-ref/replies/pc1b-r1-reply.md:150`）。
- **§2／P-09：故障只命中一次的说明成立，指定分支的变异证明不成立。** “继续用空串”的变异会改变结果，但上述抛错变异仍满足全部断言，见 P2-02（`.lead-ref/replies/pc1b-r1-reply.md:20`）。
- **§6／“没有提高超时”：不成立。** 两个入口文件提高了三个既有用例的限时，见 P2-05（`.lead-ref/replies/pc1b-r1-reply.md:128`）。

```json
[
  {
    "id": "P2-01",
    "class": "违规",
    "file": "tests/work-graph/PC-entry-frozen-continuation.test.ts",
    "line": 98,
    "basis": "P-09；.lead-ref/books/pc1-book.md:53",
    "problem": "从preparedTexts推算driver读取次数，并拦截内部RawArtifactBodyStore.prototype.read来证明入口首读失败，依赖私有存储实现和内部读取次序。",
    "fix": "由lead裁定夹具支持，通过ExecutionEntryDependencies.bodies只包装入口读取端口，准备后开启一次故障；删除原型spy和driver次数推算。"
  },
  {
    "id": "P2-02",
    "class": "违规",
    "file": "tests/work-graph/PC-entry-frozen-continuation.test.ts",
    "line": 113,
    "basis": "P-09；.lead-ref/books/pc1b-findings.md:27",
    "problem": "把入口不可读分支改为throw后，execution-entry-service.ts:1636的catch仍返回unavailable，读取次数和模型调用数也不变，当前测试仍通过。",
    "fix": "增加现有公开reason的完整字面断言：the frozen continuation-brief template could not be read: PC injected entry prompt-text read failure；用抛错变异验红。"
  },
  {
    "id": "P2-03",
    "class": "违规",
    "file": "tests/runtime/PC-prepare-prompt-freeze.test.ts",
    "line": 153,
    "basis": "P-10；.lead-ref/books/pc1b-findings.md:28",
    "problem": "独立纯函数测试不能证明公开准备实际取得的快照保留selection。该快照是局部对象，没有公开读口；公开manifest和readPromptRecord读取的是promptSet。",
    "fix": "由lead明确裁定该子项允许纯函数契约测试加静态调用点核对，并注明不构成公开准备链的快照证明；不新增生产读口。"
  },
  {
    "id": "P2-04",
    "class": "违规",
    "file": "tests/runtime/PC-prepare-prompt-freeze.test.ts",
    "line": 195,
    "basis": "P-10；.lead-ref/books/pc1-book.md:323",
    "problem": "Work和Query暂停时均未改变reasoningReplay；Query断言遗漏packId和reasoningReplay。单独将这些字段改为await后读取，相关测试仍能通过。",
    "fix": "两例暂停时将reasoningReplay从none改为current_run；Query补齐packId为platform、reasoningReplay为none的字面断言，并对单字段延迟读取变异验红。"
  },
  {
    "id": "P2-05",
    "class": "违规",
    "file": "tests/work-graph/PC-entry-frozen-continuation.test.ts",
    "line": 75,
    "basis": ".lead-ref/books/run-pc1b-r1.md:49；P-08、P-09",
    "problem": "continuation第75、124行和review第75行把三个已有用例从默认30000ms提高到180000ms。全量日志中两文件仅耗时5333ms和1240ms。",
    "fix": "删除三个显式timeout，恢复原默认30000ms。"
  },
  {
    "id": "P2-06",
    "class": "不整洁",
    "file": "tests/runtime/PC-prepare-architecture-reminders.test.ts",
    "line": 24,
    "basis": "本轮审查要求第7项；P-01、P-06、P-10、P-11",
    "problem": "architecture-reminders、prompt-text-put-failure、prompt-freeze使用120000ms，review-freeze使用180000ms；文件实测分别仅1327、2513、2568、1106ms。",
    "fix": "删除这四个文件相关用例的显式限时，使用仓库默认30000ms。"
  }
]
```

会出错 0，违规 5，不整洁 1，建议 0