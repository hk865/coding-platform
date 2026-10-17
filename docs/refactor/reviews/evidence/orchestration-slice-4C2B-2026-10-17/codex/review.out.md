只读审查完成；未改文件，未运行测试或构建。以下 `notes/、views/、state/、communication/、persistence/、model/` 均指 `src/core/work-graph/` 下的目录。

1. **必须改：答复正文读取失败，被当成了用户没有填写条件。**  
   `src/composition/create-platform.ts:1403–1415` 将非 ready 的 `readDecisionAnswer` 静默换成空文本；但正文读取失败本来会明确返回 unavailable（`communication/decision-service.ts:883–890`）。最小反例：用户选择并存，填写“仅适用于旧接口”，答复提交后正文读取暂时失败；落实仍成功，条件变成“决定卡：coexist”。恢复后重试，还会因 `conditions` 属于指纹而发生幂等冲突（`notes/note-service.ts:1482–1490`）。  
   **修改思路：** adapter 遇读取失败立即保留“已答、待落实”，不得调用处置；只有成功读到的正文确实为空，才能采用任务书规定的默认文字。重试始终使用同一份已保存答复。

2. **必须改：`source_stale` 的错误码错误，指针移动也没有在 `readSource` 正确识别。**  
   `communication/decision-source-facts.ts:658`、`src/composition/create-platform.ts:1421` 返回的是 `revision_conflict`，只是 reason 写成 `source_stale`；任务书 `.lead-ref/s4c2b-impl.md:185–187` 明确要求 CoreRejection 的 `source_stale`。此外，前者 `:647–665` 直接采用重新读取的 pins，没有比较请求中旧的 CurrentPointer pin。最小反例：读取待审理解卡后，撤下原当前理解；待审头没变、指针变了，`readSource` 仍接受新 pins，未按约定拒绝旧来源。  
   **修改思路：** 比较原头及指针 pin，移动时返回正确错误码；同步修正锁定错误结果的 `tests/work-graph/S4C2-U3.test.ts:142–147`、`tests/scenarios/S4C2-U6-note-card-e2e.test.ts:177`。

3. **必须改：卡处置复制了第二套核心，并漏掉拒绝理解卡的提交守卫。**  
   `notes/note-service.ts:1231` 的 `dispose` 与 `:1478` 的 `applyNoteDecision` 各自组织处置；`:1420–1462` 与 `:1633–1669` 重复守卫、提交、失败补查及回执构造。已经出现行为分叉：卡路径 `:1544–1550` 只预读指针，`:1578` 仅非 reject 才安装指针写入守卫，最后也未补只读指针守卫。最小反例：拒绝卡读完指针后，另一公开写入先移动指针；拒绝仍可提交，违反卡 pins 的并发保护要求。  
   **修改思路：** 将处置准备与提交收成一个核心，以明确模式保留书记的 contradicted-only 集合和卡的实际目标集合；卡模式为全部捕获 pins 加守卫，包括 reject 时的指针。这同时修正确性并删除实质重复，不只是压行数。

4. **必须改：证明的 before/after 没有记录同一个被改头。**  
   `notes/note-service.ts:1614–1620` 写成 `NoteHead@v → NoteVersion(version=v+1)@1`，而任务书 `:40–41` 要求每个被改头一项变化。最小例子是拒绝 v1：实际头变成 v2，证明却把“after”指向另一个不可变版本聚合，无法准确表达头的版本迁移。头本身已有正确的记录 revision（`persistence/note-record-codecs.ts:464–471`）。  
   **修改思路：** 主体及被取代目标均写同一 NoteHead 的 `v → v+1`；保留版本记录、最后事件及 acknowledgement。当前读取器能接受这种证明，不代表其变更内容正确。

5. **必须改：U7 尚未交付可供第二个来源登记的通用适配器。**  
   `views/decision-read-model.ts:215–261` 是硬编码 note_review 的第四个手写来源，缓存键、集合调用、身份解析和投影均绑定注记。K3 下一来源无法只提供集合、key、投影、关闭判断来复用分页，仍须复制这段实现；不符合任务书 `:54–57`。  
   **修改思路：** 抽出一次组装、缓存、分页及按键读取的适配器，注记作为第一份登记；旧三源仍留给 C1。  
   **建议：** U6 也将现有冲突函数登记进同一 adapter 表。现在仍有内置来源分支（`src/business/workflow/decision-actions.ts:418–422`），组合根仅登记注记（`src/composition/create-platform.ts:1600`）。统一登记可消除协调器对特定来源的知识，冲突规则原样保留。

6. **必须改：卡源突破读取上界，并出现二次方计算。**  
   `notes/note-decision-source.ts:169` 已批读全部关系头，`:171` 又经 `:78` 调用完整 `checkNotes`；后者新建空缓存并逐项重读头（`views/note-views.ts:1261–1272`）。N 个不同目标至少额外产生 N 次头读取，已读计划也没有共享缓存。另 `note-decision-source.ts:180–181` 每张卡复制全目标事实，`state/note-machine.ts:155` 每次重建完整 Map：两万张卡各关联一个不同目标，就是四亿项映射工作。  
   **修改思路：** 复用已有头与本次调用缓存，只批量求需要的主锚点退役事实；每张卡只取自己的实际目标事实。依据是 §11.7 的单次批读及 §12.7 的一次计划窗口要求。净增 1,343 行超过软预算本身不构成缺陷；第3、5项的重复才是具体收敛点。

7. **必须改：通知折叠重新引入无界实参展开。**  
   `views/notice-grouping.ts:98` 的 `list.push(...membersOf(item))` 将整个折叠组变成函数实参。一个目标累计的未读处置超过引擎实参上限后，即使请求一行，计算 seenThrough 也会抛错，队列无法读取。  
   **修改思路：** 改为逐项 push 或 concat，保留全部成员；这是 `slice-2A-SPEC.md:182` 已明确要求的读法，不需要增加数量上限。

8. **必须改：若干验收行被事实注入或较窄测试替代。**  
   最明显的是 N1/N2/N3：直接提交版本、手填 noticeClass（`tests/work-graph/S4C2-N1.test.ts:42–52、74–75`；`S4C2-N2.test.ts:74–81`；`S4C2-N3.test.ts:77–82`）。N1 可造出执行者撤回、状态却为 accepted 的 scribe_result；真实 writer 接线即使失效，测试仍能通过。N3 的最终位置还取自被测返回值（`:111`），不是独立手算期望。  
   卡服务夹具固定 memory（`tests/helpers/S4C2-note-decision-fixture.ts:65、83`）；U7 用手写卡及假来源，身份还是正式卡不生成的 NoteVersion（`tests/work-graph/S4C2-U7.test.ts:36–65`）。D-04、D-08、D-09、D-11、D-12 缺公开队列层面的卡断言；D-05/D-13 只覆盖内部来源结果（`S4C2-note-decision-source.test.ts:78–96`）。现有真实 resolveDecision 场景覆盖了三项落实，但没有证明全部关卡顺序、结构性 accept 和并存旧版本历史（`tests/scenarios/S4C2-U6-note-card-e2e.test.ts:99–149、240–271`）。  
   **修改思路：** 经真实写入、书记处置及答复产生数据，再从队列、读卡、公开历史验证；服务行同时跑 Memory/SQLite，期望用手算字面量。U3 明确要求的伪造证明属于允许的故障注入；NE6 的真实 Host 心跳部分属于已验收 A，不在这里重复要求。

9. **必须改测试期望：F06 的 2 是正确结果，不是 A 的遗留回归。**  
   B 注册 note_review（`src/composition/create-platform.ts:818–824`），缺源提示只为 not_available 生成（`views/context-extensions.ts:129–136`），因此少的正是该提示。手算：A 为“note_review 缺源1＋message_release 缺源1＋目标理解该更新1＝3”；B 为“0＋1＋1＝2”。夹具没有阶段（`tests/helpers/task-claim-fixture.ts:260`），失败后实际返工（`tests/composition/WP2-wiring.test.ts:494、500–510`）；无当前理解仍有目标状态行，updateDue 生成一条提醒（`notes/note-read-model.ts:2037–2053`；`src/core/agent-runtime/context-assembler.ts:684–688`）。零预算省略计数按实际行数计算（同文件 `:278–285`）。  
   **修改思路：** 将 `tests/composition/WP2-wiring.test.ts:539` 改为2并写清上述手算。三处 `toContain → not.toContain` 均合理：该文件 `:467、627` 及 `tests/scenarios/WP2-wiring-scenario.test.ts:82`。

对明确询问的取舍：全选项 `effect:'apply'` 正确，reject 也要落实状态并记回执（`notes/note-decision-source.ts:118–122`；`communication/decision-service.ts:602–607`）；三种注记引用登记正确（`persistence/decision-record-codecs.ts:240–242`）。普通结构性注记 accepted write 即发通知符合 §11.6（`state/note-machine.ts:280–289`）。U3 已是可加行的表（`communication/decision-application.ts:67–97`）。action 的准确联合为 `WriteResult<{goals: GoalSnapshot[]}> | NoteDispositionResult | CoreRejection | null`，HTTP 按别名跟随，类型扩宽没有发现问题（`model/decision-contracts.ts:392–398`；`src/app/core-http-types.ts:387`）。

先改完列出的几处