
######## v2:16c5aeafa5519c14ee9f0f3036a0b2808fce6a9d29d2d30f5a02f80e1b5a6593
{
 "findings": [
  {
   "id": "P4-01",
   "class": "建议",
   "file": "tests/work-graph/unknown-call-review-list.test.ts",
   "line": 289,
   "row": "W2b-20",
   "problem": "（可选，不确定算不算问题）游标用例只证明了「不是 invalid、游标之后没有记录」。第三条记录 later 是 needs_decision，所以只要实现对外来游标一律返回空，这个用例也会通过。测试本身也没有读出「返回的游标落在 decided 之后」，这一点只靠 service :1534-1539 的规则成立（注释 :287-288、:302-303 这样说，但没有断言）。w2-base :151-160 同样弱，不是这次改坏的，行也没有要求。",
   "fix": "可选：用 createPending 把 later 造成 pending_review；带 wider.value.nextCursor（原样传）做 pending-only 查询，断言 items 只有 later、nextCursor 为 null。这样能同时证明这个游标是 keyset 边界，并且落在 decided 和 later 之间。",
   "evidence": "head unknown-call-review-list.test.ts:287-307（later 走 createNeedsDecision，见 :289；最后断言 items: []，见 :307）；src/core/work-graph/tasks/unknown-call-review-service.ts:1534-1539（nextCursor = 窗口最后一条的 refKey）；w2-base-unknown-call-review-list.test.ts:151-160"
  },
  {
   "id": "P4-02",
   "class": "建议",
   "file": "tests/helpers/K3-proposal-round.ts",
   "line": 399,
   "row": "W2b-20",
   "problem": "（不确定是否在本行范围内）goal 和 open 两个用例里的 resolved 记录（head :210、:245，createResolved → runK3ReviewRound）要经过复核轮。runK3ReviewRound (:839) 调 claimK3ReviewRound，复核轮的 Session 仍然由 f.createS5Session 创建（:399），也就是 W2b-21 说的手写 Session。行的改法只用括号点名了 B2-crr-world.ts:127，§0 :53-55 又把 S5 默认路径留给用户，所以按字面已经做到。如果 lead 把「链里凡是用 createS5Session 建 Session 的地方」理解成包括这里，那就没做完。",
   "fix": "请 lead 裁定。如果算在范围内：给 claimK3ReviewRound/runK3ReviewRound 加一个可选的 realSession 选项（默认不变，R-15），本文件的 createResolved 打开它；否则维持现状，在 §6 记一句。",
   "evidence": "K3-proposal-round.ts:399（createS5Session）、:836-843；head unknown-call-review-list.test.ts:121-133、:210、:245；S5-decision-fixture.ts:636-649（手写 Session）；t-w2b-findings.md:55、:85"
  },
  {
   "id": "P4-03",
   "class": "建议",
   "file": "tests/helpers/K3-35-runtime.ts",
   "line": 130,
   "row": "W2b-20",
   "problem": "新导出的 k3_35AuthorizeConfigurationFor 没有外部导入者，只在本文件 :197 用到。测试只导入 authorizeK3_35Goal（head 测试 :33）。",
   "fix": "可选：去掉 :130 的 export，只留文件内部使用。",
   "evidence": "head K3-35-runtime.ts:130、:195-197；head unknown-call-review-list.test.ts:33"
  }
 ],
 "perRow": [
  {
   "row": "W2b-20",
   "status": "OK",
   "note": "只有建议 P4-01、P4-02、P4-03，没有会出错/违规/不整洁。(a) 第二个 Goal 的记录走的是真实链路：Goal A 的 PA1 由 S5 公开采用（S5-decision-fixture.ts:771-803）；公开 claim 带 goalRef GOAL_A（K3-35-continuation-fixture.ts:451-456），之后是真实 prepare/startRun、RUN-20/RUN-22（:697-699）；Session 走 createRealS5Session（S5-decision-fixture.ts:651-658）。w2-base :88/:118 的另一 Goal 记录恢复在 head :213、:246。w2-base :93-96 的 Goal 过滤排除恢复在 :218-221：toMatchObject 比数组时长度也要相等，Goal A 的 pending 记录如果混进来就会失败。:122-126 的跨 Goal open 断言恢复在 :255-259，两个后端都跑（:201、:236 的 it.each）。新断言比 w2-base 更强：Goal A 的 runId 是最后发出的，却排在最前，所以只按 runId 排序的实现会失败。K3-35-runtime.ts 默认不变：WeakMap 没有登记时用的就是原来的 k3_35AuthorizeConfiguration（:195-197）；k3_35AuthorizeConfigurationFor([GOAL_B]) 的条件和原来一样（:113-117 对 :132-136）。只有本测试调用 authorizeK3_35Goal (:94)，所以 R-15 下没有行为会变的导入者。直接导入者有：K3-15-ur3h、K3-review-workflow-rows、K3-47-continuation-gate、K3-merge-cancel-propagation、K3-proposal-round.ts:85、K3-35-continuation-fixture.ts:106。(b) 边界游标取自真实的宽页：limit 2 的宽页加上第三条 needs_decision，合并后 3 条大于 2，所以 hasMore（service :1536-1539）；游标原样传入（:306）；unknownCallReviewRefKey 的 import 已删。ledger 那一行（pendingKey<decidedKey）由 :296-299 的顺序断言替代，强度不低于原断言。(c) 只有存储分页用例带超时（:50、:355），值是 600_000，正好等于上限；实测时间写在 :313-319，与 t-state.md:382 一致。两页 200+5、第二页 nextCursor 为 null、runId 顺序这些断言都保留（:345-354）。B2-crr-world 的默认路径不变：harness 用 ??（:138），realSession 只在等于 true 时生效（:141-143），只在没传 harness 时关闭（:197）；22 个导入者都没传这两个选项。手写的顺序论证是对的：refKey = canonicalJson，键按字母排序（unknown-call-review-codecs.ts:543-544、fingerprint.ts:45），goalId 排在 projectId/runId 之前；service 按 UTF-8 字节排序（lookup-index.ts:573-574、service :1520），所以 \"A\" 在 \"B\" 前；runIdGeneratorOf 是定宽、递增的单一序列（B2-crr-world.ts:50-57），pending 先创建，所以 runId 更小。其余改动块都属于本行：类型 import；createPending 改为直接调用 blockedRecord 以带上 realSession（被绕过的 k3TakeTaskId 只有 createK3PendingReview 自己用，K3-proposal-round.ts:120-125、:265）；共享 harness 是默认不变的可选选项（R-15 允许的形式）。"
  }
 ],
 "r20": []
}
######## v2:9f5c153a10c25d3477a965c0739c749d5fd110f1747b0413fc01071c4d4a3ebb
{
 "verdicts": [
  {
   "id": "P4-01",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The code says what the finding claims. In head unknown-call-review-list.test.ts:289 the third record `later` comes from createNeedsDecision. The final query (:304-306) is pending-only with cursor = wider.value.nextCursor, and :307 asserts only `items: [], nextCursor: null`. In that world the only pending_review record is `pending`, which sorts before the cursor. So an implementation that returns an empty page for any foreign cursor still passes; only ignoring the cursor would fail (it would return `pending`). Nothing asserts where the returned cursor sits. That rests on unknown-call-review-service.ts:1534-1539 (nextCursor = refKey of the window's last item, here `decided`); the comments at :287-288 and :302-303 state it but do not check it. w2-base:151-160 has the same weakness (pending-only after decidedKey, expect []). Row W2b-20 (b), table :85, asks only that the cursor come from a real wider page and be passed on as returned, which head does (:293-306, A1 'used as it was returned', rule sheet v2 :32-35). So this is not a violation, and 建议 is the right class. The proposed fix works. With `later` made pending_review, the wider page (limit 2) still returns pending and decided; decoded has 3 records, more than 2, so hasMore is true and the cursor is decided's key. The pending-only query after that cursor then returns [later], and with exactly `limit` candidates the store's `next` is null (in-memory-record-store.ts:506; sqlite-record-store.ts:591 uses hasNext), so `nextCursor: null` holds."
  },
  {
   "id": "P4-02",
   "verdict": "refuted",
   "classOk": "yes",
   "reason": "The facts are right: createResolved (head :121-133, used at :210 and :245) calls runK3ReviewRound (K3-proposal-round.ts:836-843) → claimK3ReviewRound, whose round Session comes from the handwritten f.createS5Session (:399; S5-decision-fixture.ts:636-649). But the frozen table does not require anything here. Row W2b-20 (t-w2b-findings.md:85) lists only unknown-call-review-list.test.ts, K3-35-runtime.ts:113 and B2-crr-world.ts:127 as locations. Its Session clause names exactly `B2-crr-world.ts:127`, which is the blocked-record chain the row's records go through; in the base that line is the createS5Session call (P4.diff hunk -121), and head now switches it with `realSession`. §0 :53-55 keeps the S5 fixture's handwritten default path, 'inherited by the K3 world', for the user, and W2b-21 (:86) repeats 'The default path stays (§0)'. The resolved-record chain in the goal and open tests was already in the pre-rework base (P4.diff context lines), and K3-proposal-round.ts is a shared helper outside the row's location list. Changing it would be new scope under R-15, not a gap in this rework. The finding itself says the row is literally done. The lead can still rule on it as a question (建议 fits), but nothing in the table is left undone."
  },
  {
   "id": "P4-03",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Head K3-35-runtime.ts:130 exports k3_35AuthorizeConfigurationFor. Its only use is inside the same file (:197); the test imports only authorizeK3_35Goal (head test :33). A grep of the P4 head and of D:\\cxt\\t-w2r1 finds no other importer, and P4.diff touches only these three files. It is optional tidiness, not a fault: the function has a caller, so this is not the W2b-07 case (no caller at all, 不整洁). Neither rule sheet nor the table says anything about export visibility. The neighbouring k3_35AuthorizeConfiguration (:112) is also exported with no outside importer (the only other match is an old Codex audit note), so the new export follows the file's existing pattern. 建议 fits."
  }
 ]
}
######## v2:50a67ce5a9d802c86415001c0686ea59575d905b1bc8eff3d86c9c2b438c5915
{
 "findings": [
  {
   "id": "P3-01",
   "class": "会出错",
   "file": "tests/app/session-rendering.test.ts",
   "line": 447,
   "row": "W2b-41",
   "problem": "新增的 record:unknown 条目（:419-424，recordType 'future.unknown'）只在 :447-448 检查 html 和原始记录块里出现 'future.unknown'。'future.unknown' 本来就会经原始记录块出现在 html 里，所以未识别类型那一支（parse.ts:200；timeline.ts:275-278 渲染 `未识别记录 · <code>${recordType}</code>`）没有被断言。具体情况：假如 timeline.ts:275-278 什么都不渲染，原始记录块里仍有这个字符串，:447 和 :448 照样通过。",
   "fix": "在 :447 改为 expect(html).toContain('未识别记录 · <code>future.unknown</code>')（或断言该条目带 data-history-body=\"unknown\"），:448 对原始记录块的检查保留。",
   "evidence": "tests/app/session-rendering.test.ts:419-424, :447-448；src 里的 parse.ts:200，timeline.ts:275-278；:434-435 的 savedRaw 检查是对的"
  },
  {
   "id": "P3-02",
   "class": "违规",
   "file": "tests/composition/R3d-R3g-platform.test.ts",
   "line": 231,
   "row": "W2b-55",
   "problem": "§6 把尾段 :223-236 整段归为 R-20（缺入口，直接打开 SQLite 读）。四个事实里有两个其实有公开读法，类别不成立：(1) observedRef 能通过 platform.architecture.observationState 读到（create-platform.ts:1327 暴露；architecture-service.ts:856 用 pointer.observedRef 生成 current.captureRef；architecture-observation.ts:53-55）；(2) “没有 active baseline” 能通过 readArchitectureRevision({selection:{kind:'current'}}) 读到，返回 not_found（catalog-service.ts:373, :772-775）。只有 revision 2（:227）和 readThrough（:229）确实读不到（architecture-observation.ts:53-60 不对外给出）。",
   "fix": "重开 platform 后、close 之前，用 platform.architecture.observationState 断言 observedRef（替换 :230-232），用 readArchitectureRevision current 断言 not_found（替换 :233-235）；R-20 只保留 :227 revision 和 :229 readThrough 两项，并在注释里写出类别和 file:line。",
   "evidence": "tests/composition/R3d-R3g-platform.test.ts:223-236（:227 revision, :229 readThrough, :230-232 observedRef, :233-235 active-baseline）；src: create-platform.ts:1327；architecture-service.ts:856；architecture-observation.ts:53-60；catalog-service.ts:373, :772-775"
  },
  {
   "id": "P3-03",
   "class": "违规",
   "file": "tests/composition/A1-graph-session-platform.test.ts",
   "line": 106,
   "row": "W2b-56",
   "problem": "期望架构字面量里的 contentDigest 写成 `adopted.value.baseline.contentDigest`（:106），是程序输出，违反 R-11 / 规则表 F8（期望值必须是字面量加推算过程）。假如 digest 算法算错（例如规范化文本漏了字段），:115 的 toEqual 仍然通过，因为期望值和实际值出自同一次计算；:118、:175、:221 也引用这个期望对象。",
   "fix": "按 catalog-record-codecs.ts:193-202 的规范化形式和 catalog-service.ts:517-518 的 sha256，把 contentDigest 写成字面量，并在注释里写出规范化文本和字节数。我按代码手算出 183 字节的规范化文本，digest 为 27272b141e404048373f9886a5c179a23d500d987d486619fae262023fb055d5。这个值需 lead 复核后再冻结。",
   "evidence": "tests/composition/A1-graph-session-platform.test.ts:102-115（:106 contentDigest 取自 adopted），:115, :118, :175, :221；src: catalog-record-codecs.ts:193-202，catalog-service.ts:517-518"
  },
  {
   "id": "P3-04",
   "class": "不整洁",
   "file": "tests/helpers/R4-history-turn-support.ts",
   "line": 56,
   "row": "W2b-40",
   "problem": "`replies` 的注释写的是 \"Extra scripted replies after the first text reply\"，即在第一条文本回复之后追加。:127-128 的实现是 `replies: input.replies === undefined ? [{ kind: 'text', text: input.text }] : input.replies`：给了 replies 就整个替换那条 text 回复，不是追加。注释和代码相反。",
   "fix": "把 :56 改为“给出时替换单条 `text` 回复（不追加）”。",
   "evidence": "tests/helpers/R4-history-turn-support.ts:56 与 :127-128；:53-54 的注释是对的"
  },
  {
   "id": "P3-05",
   "class": "不整洁",
   "file": "tests/composition/K-R-previous-turn-bounds.test.ts",
   "line": 27,
   "row": "W2b-40",
   "problem": ":27-28 的注释说 \"(a counter records any call)\"。但唯一的测试在 :85 设了 seam.absent = true，:29-36 的 getter 在 absent 时返回 undefined，`wrapped` 根本拿不到，计数器（:33）是死代码；:93 的 expect(seam.calls).toBe(0) 永远不会失败。注释描述的保护并不存在。",
   "fix": "改正 :27-28 的注释：这里的 seam 是缺失的，如果被调用了，brief 就无法生成。死计数器（:33）和空断言（:93）是否删掉，由 lead 裁定。",
   "evidence": "tests/composition/K-R-previous-turn-bounds.test.ts:27-28, :29-36, :33, :85, :93"
  },
  {
   "id": "P3-06",
   "class": "建议",
   "file": "tests/app/host-settings.test.ts",
   "line": 930,
   "row": "W2b-42",
   "problem": "（不确定）rejects: 块（:930-999，approvalWorld、not_found 行、forbidden 行，走真实的 saveInitialPlanAnswer）本身是对的：删掉 host-settings.ts:773-776 的禁止检查后，forbidden 行会失败，因为 host.ts:979-1001 的 readCheckProposal 不检查命令。但 §6 和回报里说这个世界“只能用 SQLite”，理由不准确：host.ts:324-329 显示，只要给了 settingsDirectory，内存 Host 也会开启 settings；本文件 :109、:123-125、:246 就有内存加 settings 的用法。这一行没有引用 R-19，所以这只是理由文字的问题，不确定算不算违规。",
   "fix": "把 §6 的理由改准确（内存 Host 给了 settingsDirectory 也有 settings），或补一行内存版的同一 rejects，由 lead 定。",
   "evidence": "tests/app/host-settings.test.ts:930-999, :109, :123-125, :246；src/app/host-settings.ts:773-776；src/app/host.ts:324-329, :979-1001"
  },
  {
   "id": "P3-07",
   "class": "建议",
   "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
   "line": 137,
   "row": "W2b-49",
   "problem": "rejects 行里“另一个 principal”那一行（:137）和 R4b-session-recovery.test.ts:248 的新 rejects 行只断言了 status，没有断言错误码。R4c-execution-history.test.ts:302-309 对同类拒绝断言了 code 'invalid'（session-operations.ts:425-427）。这不是回退，只是同一形状可以更紧。",
   "fix": "两处都加上 expect(result.code).toBe('invalid')（以 session-operations.ts:425-427 的实际 code 为准）。",
   "evidence": "tests/runtime/R4b-session-input-boundaries.test.ts:110-151（:137）；tests/runtime/R4b-session-recovery.test.ts:228-252（:248）；tests/runtime/R4c-execution-history.test.ts:302-309；src/core/agent-runtime/session-operations.ts:425-427"
  }
 ],
 "perRow": [
  {
   "row": "W2b-36",
   "status": "OK",
   "note": "stored 变体的期望 models 是字面量，和 A2-settings-automation :122-147 一致"
  },
  {
   "row": "W2b-37",
   "status": "OK",
   "note": "S8E-A23 已按行改完"
  },
  {
   "row": "W2b-38",
   "status": "OK",
   "note": "C8 :456-478 已按行改完"
  },
  {
   "row": "W2b-39",
   "status": "OK",
   "note": "A2-runtime-capabilities 和 runtime-capabilities-fixture 已改；R-15：导入者有 A2-runtime-capabilities、K-R-runtime-capabilities，默认路径不变"
  },
  {
   "row": "W2b-40",
   "status": "P3-04, P3-05",
   "note": "R4-history-turn-support 的 replies 注释和代码相反；K-R-previous-turn-bounds 的计数器注释不成立，:93 是空断言"
  },
  {
   "row": "W2b-41",
   "status": "P3-01",
   "note": "未识别记录那一支没有被断言；savedRaw 检查 :434-435 正确"
  },
  {
   "row": "W2b-42",
   "status": "P3-06",
   "note": "删掉 host-settings.ts:773-776 后 forbidden 行会失败；“只能用 SQLite”的理由不准确（不确定）"
  },
  {
   "row": "W2b-43",
   "status": "OK",
   "note": "K3-19 注释已改"
  },
  {
   "row": "W2b-44",
   "status": "OK",
   "note": "WP2-duties 文件头已改"
  },
  {
   "row": "W2b-45",
   "status": "OK",
   "note": "W1-future-plan-platform :164, :180 已改"
  },
  {
   "row": "W2b-46",
   "status": "OK",
   "note": "S8E-A07 已改"
  },
  {
   "row": "W2b-47",
   "status": "OK",
   "note": "S8E-A08 已改"
  },
  {
   "row": "W2b-48",
   "status": "OK",
   "note": "S8D-platform-fixture.test.ts 已恢复"
  },
  {
   "row": "W2b-49",
   "status": "P3-07",
   "note": "rejects 行齐了，两处只断言 status（建议）"
  },
  {
   "row": "W2b-50",
   "status": "OK",
   "note": "S8A-L8 新增的 ready 分支 :393-407 正确"
  },
  {
   "row": "W2b-51",
   "status": "OK",
   "note": "S8A-L8 内联 throw 包装 :770-777 正确"
  },
  {
   "row": "W2b-52",
   "status": "OK",
   "note": "R4c 手算数核过：一个单回复 Run 5 条记录（turn.started + run.started、model.request_started、assistant.message_completed、run.completed），:169-178 的 11 和 5、:247-252 的 6、:273-276 的 scannedCount 5、:280-283 的 7 都对；R-18 框架见 :133-153；S2B-41 mailbox、R6/R4c-kernel 改名无问题"
  },
  {
   "row": "W2b-53",
   "status": "OK",
   "note": "三处 R-20 的类别属实（见 r20）。拷贝里没有 w2-base 原文，“恢复成 w2-base 原样”只能对照 diff 和回报核对"
  },
  {
   "row": "W2b-54",
   "status": "OK",
   "note": "R4b-session-recovery :100, :125, :147, :172 未改动，R-20 类别属实；新 rejects 行在 :228-252"
  },
  {
   "row": "W2b-55",
   "status": "P3-02",
   "note": "builderDigest 8874959184e543c8edb486773a272605682e9b6dde8a093359c7ee8ece3f78d5 已用 551 字节规范化文本复算一致（:33-45）；尾段 R-20 有两项其实可达"
  },
  {
   "row": "W2b-56",
   "status": "P3-03",
   "note": "期望架构字面量的 contentDigest 取自程序输出（:106）"
  }
 ],
 "r20": [
  {
   "row": "W2b-53",
   "part": "R4c-execution-history.test.ts:203-234 mixed pair（表中 :127）",
   "categoryTrue": "属实：不可达。observation-recovery.ts:235-240 需要两个不同来源的身份，而身份都是系统签发的值（规则表 v2 A1 / R-8），测试不能自造",
   "reachable": "不可达：没有公开步骤能让同一页里出现混合身份"
  },
  {
   "row": "W2b-53",
   "part": "R4c-execution-history.test.ts:375-382 not_ready（表中 :276）",
   "categoryTrue": "属实：缺入口。session-operations.ts:753, :767；session-directory.ts:1178-1204 没有 not_ready 分支",
   "reachable": "不可达：公开读法到不了 not_ready"
  },
  {
   "row": "W2b-53",
   "part": "R4c-execution-history.test.ts:481-515 page rewrite（表中 :400）",
   "categoryTrue": "属实：篡改 / 不可达。observation-recovery.ts:228-233 的检查只有改写已存的页才会触发",
   "reachable": "没找到公开步骤（不可达）"
  },
  {
   "row": "W2b-54",
   "part": "R4b-session-recovery.test.ts:100, :125, :147, :172",
   "categoryTrue": "属实：缺入口。findSessions 只读平台查找表（session-directory.ts:1527），readSession 见 :1192",
   "reachable": "不可达：没有公开写入能造出这些映射状态"
  },
  {
   "row": "W2b-55",
   "part": "R3d-R3g-platform.test.ts:223-236 直接读 SQLite 的尾段",
   "categoryTrue": "部分属实：revision（:227）和 readThrough（:229）不对外给出（architecture-observation.ts:53-60）；observedRef 和 active baseline 不属实",
   "reachable": "部分可达：observedRef 能通过 platform.architecture.observationState 读到（create-platform.ts:1327；architecture-service.ts:856）；“没有 active baseline”能通过 readArchitectureRevision current → not_found 读到（catalog-service.ts:373, :772-775）；revision 和 readThrough 不可达"
  }
 ]
}
######## v2:f61d91f4e6dfe3a32d25e7d30e0f62c84776b07bd24ff219d0fec031d532fb5a
{
 "findings": [
  {
   "id": "P2-01",
   "class": "违规",
   "file": "tests/work-graph/WP2-context-extensions.test.ts",
   "line": 510,
   "row": "W2b-22",
   "problem": "第二条 F07（:487，5,000 张卡）的期望 seedKeys 还是用生产函数 decisionSourceKey 算出来的（:510-515），违反 R-11 和规则表 F8。它的 anomalies 还是手写的 anomalyDouble（:489），而且只在 memory 上跑（不是 it.each）。W2b-22 的改法是“F07 的行 key 写成字面量、anomalies 接真实 SessionAnomaly 读取、F07 两种后端都跑”，这次只改了第一条 F07（:425-483）。这段代码在 base 里已经有，W2b-22 的位置栏也只引了第一条 F07 的行号；但两条测试都叫 F07，违反规则表这一点是确定的。",
   "fix": "照 :425-483 的写法改：seedKeys 写成规格格式的字面量，在注释里写出算法（引用值照公开读返回的用）；anomalies 改接同一世界的真实 SessionAnomaly 读取；要不要两种后端都跑，由 lead 按 R-19 定。",
   "evidence": "WP2-context-extensions.test.ts:487 的测试名以 'F07' 开头；:489 用 anomalyDouble()；:510-515 用 decisionSourceKey({...})；:32 有 decisionSourceKey 的 import；第一条 F07 在 :425 用 it.each(['memory','sqlite'])。t-w2b-findings.md:87 是 W2b-22 行。"
  },
  {
   "id": "P2-02",
   "class": "不整洁",
   "file": "tests/scenarios/K3-05-review-round.test.ts",
   "line": 48,
   "row": "W2b-27",
   "problem": "stand-in 的 execute 路径删掉以后，27 个 tests/scenarios 文件（共 53 处）还留着 vi.hoisted 状态里的 `executeChecks: false` 字段和 afterEach 里的 `sandbox.executeChecks = false` 复位。stand-in 已经不读这个字段，这些都是死代码。§6:188 也把它记成“无害”留下了。",
   "fix": "把这 27 个文件里 hoisted 对象中的 executeChecks 字段和 afterEach 里的复位语句都删掉。",
   "evidence": "K3-05-review-round.test.ts:48 `{ available: true as boolean, executeChecks: false as boolean }`，:70 `sandbox.executeChecks = false;`。process-sandbox-standin.ts:16-18 的状态只有 available。grep 结果：tests 下 27 个文件、53 处（K3-R1-second-cleanup 1 处，其余每个文件 2 处）。t-w2b-findings.md:188。"
  },
  {
   "id": "P2-03",
   "class": "建议",
   "file": ".lead-ref/books/test-rule-sheet-v2.md",
   "line": 59,
   "row": "W2b-27",
   "problem": "规则表 v2 的 A7 第 3 条还写着 stand-in 的 probe “with `executeChecks: false`”。W2b-27 之后 stand-in 已经没有这个选项，这处文字过时了。规则表归 lead 管，所以列为建议。",
   "fix": "lead 把 A7 第 3 条改成“stand-in 只回答 available，probe/execute 一律拒绝”，不再提 executeChecks。",
   "evidence": "test-rule-sheet-v2.md:59-60；process-sandbox-standin.ts:16-18（状态只有 available），:39-49（probe 和 execute 一律拒绝）。"
  },
  {
   "id": "P2-04",
   "class": "建议",
   "file": "tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts",
   "line": 123,
   "row": "W2b-21",
   "problem": "同一个预算测试文件里，proposalFixture 还在用手写的 createS5Session（F3：手造的 Kernel Session id 和登记）。W2b-21 的行文只点了 :192（现在的 nearBudgetPendingReview，:196 已改成 createRealS5Session），所以这里不算没做完；但真实路径已经有了，可以一起换。",
   "fix": "把 :123 换成 world.fixture.createRealS5Session(...)。如果 proposal 这几行有依赖 Session id 长度的字节数，按 :416-428 的写法重算并写出算法。",
   "evidence": "K3-48-2...test.ts:123 `world.fixture.createS5Session(`k3-48-2-record-session-${kind}`)`，:196 `createRealS5Session`；base 同文件 :123 和 :192 都是 createS5Session；t-w2b-findings.md:86 只点了 :192。"
  },
  {
   "id": "P2-05",
   "class": "建议",
   "file": "tests/runtime/S3-context-assembler.test.ts",
   "line": 688,
   "row": "W2b-35",
   "problem": "CA04 里 `counts.inputs` 等于 0 这条断言，计数器根本没被触发过，所以不管实现怎样它都会过。原因：WP2 memory 世界的 Plan 没有输入声明，装配器自己只对已选输入调 readTaskInputPage，所以这条路一次都不走；图读取内部读输入，用的是原始的 taskInputsOwner，不经过被包装的 f.platform.taskInputs。输入的实际读取都落在 counts.graph 里（:662 证明这个计数器在工作，:687 断言为 0），所以“不重读”这个说法本身仍然成立。base 里也一样空转（base :283 的 inputs 是 []），不算这次改弱。",
   "fix": "在 :687-688 旁加一句注释：这个世界没有输入声明，输入在图读取内部经原始 owner 读，由 counts.graph 覆盖；counts.inputs 只防装配器直接读页。",
   "evidence": "WP2-platform-support.ts:295-304 的 draft 里没有 inputRequirements；context-assembler.ts:1820-1826 只对 state==='selected' 的输入调 readTaskInputPage；create-platform.ts:1123 `inputs: taskInputsOwner`，:1161-1164 包装后的 taskInputs 才是 platform 对外给的；graph-context-reader.ts:1381 用 deps.inputs.readTaskInputs。"
  }
 ],
 "perRow": [
  {
   "row": "W2b-19",
   "status": "OK",
   "note": "UCR-settle-review.test.ts 里那五个 120_000 已经删掉，一个超时都没剩。"
  },
  {
   "row": "W2b-21",
   "status": "OK（附 P2-04 建议）",
   "note": "默认路径没变：S5-decision-fixture.ts:514 的 realRuntime 默认是 false，只有为 true 时 :659-661、:1007、:1234-1236 才换走手写路径；S2B-runtime-steps-fixture.ts:349 在没给 decisionMessages 时不展开这个字段。真实路径上，Session 来自 createSessionOperations(...).createSession（:651-658，id 由 session-directory.ts:140-142 发出），Run 经共享的 S2B Runtime start/finish（:939-1003），没有剩下手造的 Kernel id 或位置。决定消息经真实 mailbox 的 sendUserMessage 发出（:1097-1101，是公开的 owner 调用）。K3-48-2 的 422/341 和演算（:375、:416-428）对得上：156,024+274+422=156,720，156,105+274+341=156,720，422−81=341。F07 已改成 realRuntime:true（WP2-context-extensions.test.ts:276-348）。"
  },
  {
   "row": "W2b-22",
   "status": "P2-01",
   "note": "第一条 F07（:425-483）已做：两种后端都跑，key 是规格格式的字面量（PROJECT_ID 'P'、WORKSPACE_ID 'W' 来自 S5-decision-fixture.ts:154-155），anomalies 接的是真实读取（:344-345）。第二条同名 F07（:487-540）没改，见 P2-01。"
  },
  {
   "row": "W2b-23",
   "status": "OK",
   "note": "(a) settle_review 这一行改成了真实的 selectTask('k3-20-a')（K3-review-workflow-rows.test.ts:903），settle 次数从 0 变 1，这一行里不再有 savedRunRuntime 和类型强转；savedRunRuntime 和 performRun 只剩别的行在用（:805、:824、:860）。(b) revision 2/3 是手算的，expectedValue 是字面量，断言用 toEqual（:1005、:1007）。§6 记的三处 R-6 说明都属实：origin 字面量与 K3-35-continuation-fixture.ts:677-681 的 operator ctx 一致；startedAt 是 Kernel 的 recordedAt（run-reconcile.ts:502、:510）；workspace.detail 是生产代码拼出的文字（workspace-change-capture.ts:233、:237）。账本里的 :891、:967、:971 都对应这一行。"
  },
  {
   "row": "W2b-24",
   "status": "OK",
   "note": "S4C-note-tools.test.ts 的 :134-138、:157-161、:195-216 都改成了对整个请求 toStrictEqual，字面量没动；:144 那处 toEqual 不在这一行范围内。"
  },
  {
   "row": "W2b-25",
   "status": "OK",
   "note": "K3-14：世界在打开时就登记清理；先断言 start 为 2（手算），再断言字面量 3 和 4。账本 :83、:86、:88 对应这一行。"
  },
  {
   "row": "W2b-26",
   "status": "OK",
   "note": "桩已删除。K3-review-card-fixture.ts:338-341、S2A-window-fixture.ts:49-51、S5-decision-routes.test.ts:220-227 都改用 createGoalExecutedFilesReader。可能变化的地方：读 K3 卡片世界 readModel 的测试，footprintCompleteness 会变成 available（goal-executed-files-reader.ts:203-205，goal-conflicts.ts:265-270）；fixture 的 counts.lookups 会多出 lookup（:115），lookupOrdered 不计数（S5-decision-fixture.ts:280）；Run 或 RunActivity 解码失败时，队列可能变成 unavailable。S2A-queue-window.test.ts 只断言 counts.waitingAnswer 和 cardKeys，不受影响。断言 conflicts 的 18 个测试都不引用这几个 helper；K3-16-approval-application 只钉了 counts.commits（:323-328）。没找到哪个测试的结果会因此改变。"
  },
  {
   "row": "W2b-27",
   "status": "P2-02, P2-03",
   "note": "改成 'pass' 是允许的测试输入改动：harness.ts:288 的 'pass' 是 kind 为 static 的 node -e \"process.exit(0)\"，旧输入 {command} 默认也是 static（:294）；§6:188 给的理由是 process.execPath 不在沙箱挂载里，行文本来就要求在真实 ProcessSandbox 上跑。K3-29-disposition-recovery.test.ts:95-107 和 K3-44-recovery-answers.test.ts:180-187 都设了 sandbox.real=true，业务断言保留。stand-in 的 execute 路径已删（process-sandbox-standin.ts:39-49 一律拒绝）。"
  },
  {
   "row": "W2b-28",
   "status": "OK",
   "note": "K3-46-review-advance-failures.test.ts:551 加了 { key: 'failedReviewRefs', value: [] }，拒绝结果和其余断言都没变。"
  },
  {
   "row": "W2b-29",
   "status": "OK",
   "note": "三个 digest 字面量我用 sha256 复算过，都对：old-A dd7a3462…f4b7、A中B 6ca82105…8471（5 字节，41 e4 b8 ad 42）、new-A 06133157…a0cd。H 不再出现在期望值里，:928 的 sha256Hex 只用作 Host 输入。账本 :456、:464、:465、:490 对应这一行。"
  },
  {
   "row": "W2b-30",
   "status": "OK",
   "note": "GT07/08/09/13 用 STORAGE_KINDS 的 it.each 覆盖两种后端；S4C 解析器在两个 factory 上都用 vi.mock 做了 A4 接缝（create-platform.ts:673-674 只建一种后端）；GTN20/21 两种后端都跑。describe 的改名记在账本里，属于这一行。"
  },
  {
   "row": "W2b-31",
   "status": "OK",
   "note": "GTN21 在拒绝前后各公开读一次同一条 execution，用 toEqual(before) 整体比较，not_found 检查保留。账本 :309、:322 对应这一行，新断言更严。"
  },
  {
   "row": "W2b-32",
   "status": "OK",
   "note": "K3-45 那次读取的 toMatchObject 加了 rounds: [{ result: 'unfinished', round: 1 }]。toMatchObject 对数组按长度精确比较，所以“只有一条”也一并断言了。"
  },
  {
   "row": "W2b-33",
   "status": "OK",
   "note": "B2-04 改名为 B2-04/B2-09b (owner part)（:39），K3-45 改名为 K3-45 (一) R2/K3-37 (三)（:119），账本里是改名。"
  },
  {
   "row": "W2b-34",
   "status": "OK",
   "note": "逐项都改了：K3-11 :22 的引用指向 K3-11-r2 :271-386 的 second_consecutive 段；K3-14 改成先登记清理再打开世界；K3-29-recovery-round 的过时注释已改；K3-r1-seams 头部编号 1、2、3 连续；C6 头部（:11-12、:22-25）已改；K3-18 的双空行已删；K3-11-r2、K3-45 :117 已改；K3-35-continuation-fixture.ts:255 的导出类型补了 goalRef，与实现 :447-451 一致。"
  },
  {
   "row": "W2b-35",
   "status": "OK（附 P2-05 建议）",
   "note": "三行都还能证明各自的说法。CA03（:628-647）：两次 prepare 的 inputDigest 和 bundleRef 相等，按 manifest 的 contentType 过滤后，不同正文只有 1 份（body 是 string，见 body-ports.ts:11，Set 会去重）；如果 spy 没接上，数出来是 0，测试会失败。CA04（:649-693）：在 Run 入口提交时用 onCommit 取消，startRun 被拒为 cancelled；readExecution 显示 starting 且带 inputBinding（:670）；之后真实采用后继 Plan、Goal 指针移动（:674-676），真实写入一条 note（:677-680）；第二次 prepare toEqual 第一次，图、输入、brief 的读取都是 0；:662 证明图计数器在工作。CA15（:866-879）：真实 Goal 设置服务读取时抛错，结果是 rejected unavailable，正文写入 0 次，强度和 base :858-859 一样。只跑 memory，与 §6:190 一致。新文件里留着的 import 都还有别的行在用。账本 :655、:679-681、:859 对应这一行，新断言不比原来弱。"
  }
 ],
 "r20": []
}
######## v2:7fa9f57c4d19f1bd59a399730fd97aef89077466d1bf096ca9ee2d0760fc0dc4
{
 "verdicts": [
  {
   "id": "P2-01",
   "verdict": "refuted",
   "classOk": "建议",
   "reason": "The code facts are right: the second F07 at WP2-context-extensions.test.ts:487 uses anomalyDouble() (:489), builds seedKeys with decisionSourceKey (:510-515) and runs only on memory. But this is untouched w2-base code (base :467-540 is the same), and neither the table nor the item covers it. W2b-22 (t-w2b-findings.md:87) names base :90, :269 and :415-455. Base :435-446 is the decisionSourceKey block inside the first F07, and :269 is openDeferredDecisionHarness('memory'), which only the first F07 uses. All three fixes come from T1-067, and its 涉及测试 lists only 'F07 follows the real page boundary...' (t-items-T2.md:77-84). The Codex source T2a-10 (codex2/t-w2a-T2a.out.md:14) says the anomalies change is for that F07 only and adds '不扩大到其他未要求转换的兄弟用例'; that is what the table's 'F07 only' means. Rule sheet v2:17-20 binds wave 2's items, and the 5,000-card F07 is in no item. Rework 1 did what the row asks (:425-483). The leftover is not a rework violation; at most it is a suggestion for the lead to add to a later row or the user's end-of-T list."
  },
  {
   "id": "P2-02",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Checked. process-sandbox-standin.ts:16-18 now gives ProcessSandboxStandinState only the field available, and nothing in tests/ or src/ reads executeChecks. grep finds 53 hits in 27 tests/scenarios files: 26 files with 2 each and K3-R1-second-cleanup.test.ts:43 with 1. Example: K3-05-review-round.test.ts:48 (the hoisted field) and :70 (the afterEach reset). The W2b-27 deletion made these dead state. Typecheck passes because the hoisted object is a variable, not a fresh literal. The lead already logged them in §6:188 as a known 'harmless' leftover. That is a record, not a ruling that they must stay, so the 不整洁 finding stands. Cleaning them means editing 25 files that W2b-27 does not name, so the lead decides whether to do it now."
  },
  {
   "id": "P2-03",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Rule sheet v2 :59-60 still describes A7 entry 3 as the stand-in probe 'with `executeChecks: false`', and :64-66 still talks about uses that turn it on. After W2b-27 the stand-in has no such option: process-sandbox-standin.ts:16-18 has the state, :39-46 probe answers only available, and :47-49 execute always refuses. The text is stale, and since the sheet belongs to the lead, 建议 is the right class. One correction to the fix: rule sheet v1:14 says the sheet does not move during a slice and a change is a new version. So the wording should be fixed in the next version (v3), not edited into v2 in place. The same phrase is also in t-book.md:82."
  },
  {
   "id": "P2-04",
   "verdict": "refuted",
   "classOk": "yes",
   "reason": "The facts are right: proposalFixture at K3-48-2...test.ts:123 still calls the default createS5Session, and base has createS5Session at both :123 and :192. W2b-21 (t-w2b-findings.md:86) names only :192, and the rework changed that call to createRealS5Session at :196. But the lead ruled on the remaining default-path uses. §0:53-55 lists 'the default path of tests/helpers/S5-decision-fixture.ts (handwritten Session and entered ...; W2b-21 adds a real path beside it)' under 'Stay as they are, for the user at the end of T'. §5:146 says the same for the default path beyond W2b-21: '§0 (for the user)'. Switching :123 now would go against that ruling, which the instructions count as refuting the finding."
  },
  {
   "id": "P2-05",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Checked. countReads (S3-context-assembler.test.ts:381-385) wraps f.platform.taskInputs, the same object handed to the Runtime (create-platform.ts:1161-1164, :1214). The assembler calls only readTaskInputPage, and only for selected inputs (context-assembler.ts:1820-1826). The WP2 memory draft has no inputRequirements (WP2-platform-support.ts:295-304), so it has no selections. The graph reader reads inputs through the raw taskInputsOwner (create-platform.ts:1123; graph-context-reader.ts:1376-1381, under includeInputs, which the main prepare sets at context-assembler.ts:1703). Those reads go to counts.graph, which :662 shows is live and :687 requires to be 0. So counts.inputs is never incremented and :688 always passes. Base was the same (its stub at base :283/:404-405 also had inputs []), so this is not a weakening. The T2-034 correction only asks to keep the zero-read assertions (t-items-T2.md:225), so the suggested explanatory comment is a fair 建议."
  }
 ]
}
######## v2:8359f158696c7b4afe1c8750ee895d648f204c004254644cfd0a2d4d22b566de
{
 "findings": [
  {
   "id": "P1-01",
   "class": "违规",
   "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
   "line": 546,
   "row": "W2b-09",
   "problem": "§6 给 3d 归档时间的 R-20 理由（missing entry point）不成立。归档 requeue 的 requestedAt 有公开读口：plans.queryTaskGraph 返回的 TaskRow.rework.entries[] 列出该 Task 每个已结束 Run 的 TaskRequeue，带 archiveOrigin 的那条也在里面，每项都带 requestedAt。测试自己在 :495-497 已经从同一次 queryTaskGraph 读出这个 Task 的 requeueRef。结果是三处问题。第一，:546 的 archiveAt 取自被测读者 readGoalTriggerRecords 自己的输出（F8），只验证它和另外两个时间不同，没有绑定到它自己的源记录，这正是行文要求的“each equals the time read from its own source record”。第二，:565-678 保留的 w2-base 用例手写记录、用假 lookup 端口（:613 起直接拼 RunSnapshot@1 记录，F3/F4），R-20 的依据没了。第三，:537-545、:569-577 的 BLOCKED 注释和文件头 :24-30 的说法与代码不符。",
   "fix": "在 :546 改读同一次 graph：取 graph.value.tasks 中 taskId 为 archiveTaskId 的行，在其 rework.entries 中找 ref 等于 archiveRef 的那一项，按原样用它的 requestedAt 作为 archiveAt，再断言 archive 触发的 at 等于它。删掉 :537-545 的 BLOCKED 注释、:565-678 的 w2-base describe 及其专用 import 和常量，以及文件头 :24-30 中 BLOCKED 和保留 w2-base 用例的句子。W2b-09 记为 done。",
   "evidence": "src/core/work-graph/model/plan-contracts.ts:115-116 (TaskRow.rework); src/contracts/task-failure.ts:211-226 (TaskReworkSummaryEntryV1.requestedAt :219); src/core/work-graph/state/task-failure.ts:1002-1003 ('rework appears with at least one TaskRequeue'), :1265-1286 (every TaskRequeue → entry with requestedAt, no archive filter); src/core/work-graph/tasks/plan-service.ts:898 (requeues: facts.requeuesByTaskId), :988; src/core/work-graph/tasks/plan-readers.ts:1720-1731 (TaskRequeue of every ended Run of a selected Task); plan-readers.ts:1408-1418 (the reader's own T3 reads the same record's requestedAt for the archive trigger); tests/work-graph/S4C2-goal-triggers.test.ts:495-497 (same graph read already used for requeueRef)"
  },
  {
   "id": "P1-02",
   "class": "违规",
   "file": "tests/work-graph/A2-disposition-change.test.ts",
   "line": 623,
   "row": "W2b-10",
   "problem": "“gate 不改 disposition / 延后唯一 carrier 无效”这一行仍在 describe('rejects: …') 之外，一行里有两个拒绝（F11），拒绝前没有公开读，只有最后一次 activePlan 读。§6 说它“不是 wave-2 转换”，与代码和书不符，理由有四条。第一，W2b-10 点名的范围 :585-701 包含它（w2-merged 的位置是 base :624），R-18 写明适用于本表点名的行。第二，w2-base 的 setup 直接 commit 种子（t-w2base 中 A2-disposition-change.test.ts:137-160 的 seedCommit/scopeSeed），wave 2 把它换成公开 owner 的 setup，这一行的前置状态因此是被转换过的。第三，本次返工已经按 R-19 把这一行改成 setup(kind)（P1.diff 中该行的 -setup() / +setup(kind)），却没有同时做 R-18。第四，T3-106 的刷新（t-items-T1.md:614）要求“拒绝行按A6保留并公开读取零变化”。",
   "fix": "把这一行拆成两行，放进本 describe.each(BACKENDS) 下新开的 describe('rejects: …')：一行是 gate 改 cancelled，一行是延后唯一 carrier B。每行先读 activePlan 并断言等于 f.plan.ref，做一次 adopt，断言 rejected（code invalid，reason 沿用现有匹配），再读 activePlan 不变。",
   "evidence": "tests/work-graph/A2-disposition-change.test.ts:623-631 (current row, two adopts, no before read, outside rejects:); .lead-ref/t-w2b-findings.md:33-34 (R-18), :70 (W2b-10 names :585-701), :175 (§6 reason); .lead-ref/base/tests/work-graph/A2-disposition-change.test.ts:624; D:/cxt/t-w2base/tests/work-graph/A2-disposition-change.test.ts:137-160, :510-518; .lead-ref/books/t-items-T1.md:614"
  },
  {
   "id": "P1-03",
   "class": "不整洁",
   "file": "tests/helpers/S2B-r2-track-support.ts",
   "line": 48,
   "row": "W2b-57",
   "problem": "删除 S2B-r2-r5-not-entered.test.ts 以后，seedRawRunVariant（:42-82）已经没有调用者，全仓只有 .lead-ref 里的旧副本还引用它。它也是 :13 canonicalJson/JsonValue、:14 RunRef、:16 RUN_SCHEMA_ID 的唯一使用者，所以这几处也成了死代码。",
   "fix": "删掉 :42-82 的 seedRawRunVariant 及其注释，以及 :13、:14 两个 import 和 :16 的 RUN_SCHEMA_ID。",
   "evidence": "Grep seedRawRunVariant over D:/cxt/t-w2r1: only tests/helpers/S2B-r2-track-support.ts, .lead-ref/base/tests/work-graph/S2B-r2-r5-not-entered.test.ts:13 and .lead-ref/parts/P1.diff; tests/helpers/S2B-r2-track-support.ts:13-16, :55, :61, :74-76"
  },
  {
   "id": "P1-04",
   "class": "建议",
   "file": "tests/work-graph/A2-disposition-change.test.ts",
   "line": 379,
   "row": "W2b-10",
   "problem": "guard 2 的重启（unknownOutcome）把旧 Host 的 b2.entry 传给了 reconcileRunAtStartup，但 :356-361 的注释说是照 restartedHost 做的，而 restartedHost 用的是新 host 下 rebuildDeps(...) 的 entry。在本行走的 missing 探针路径上 entry 用不到，所以不影响结果，只是注释和实际做法不一致。controls 由调用方传入，这一点与 restartedHost 一样。这是可选项。",
   "fix": "可选：照 restartedHost 在新 hostInstance 下重建 entry 再传入；或者把 :356-361 的注释改成说明 entry 沿用旧 Host、在 W-14 路径上不被使用。",
   "evidence": "tests/work-graph/A2-disposition-change.test.ts:355-383; tests/helpers/S2B-runtime-tools-support.ts:82-88; src/core/agent-runtime/run-reconcile.ts:280-283, :303-308 (missing/damaged path submits through deps.reconcile only), :397 (entry used only on the readable path)"
  }
 ],
 "perRow": [
  {
   "row": "W2b-01",
   "status": "OK",
   "note": "tests/helpers/task-claim-fixture.ts:366-372 用 admit-${requestId} 的 meta 准入，与 w2-base 相同。"
  },
  {
   "row": "W2b-02",
   "status": "OK",
   "note": "R4b-session-boundaries.test.ts:126-145 与 w2-base :74-93 逐字相同。"
  },
  {
   "row": "W2b-03",
   "status": "OK",
   "note": "filler 循环已删，测试按目标查询命名（:226 'finds the matching Session by its target without a directory scan'），目标 Session、链接和发现断言都保留。"
  },
  {
   "row": "W2b-04",
   "status": "OK",
   "note": "A2-control-service.test.ts:305-353：恢复了 cancelled + not-entered 子例，带 countingCommits 和 commits()===0；entered 分支的拒绝也包在 countingCommits 里，断言 0。"
  },
  {
   "row": "W2b-05",
   "status": "OK",
   "note": "K3-16-second-unfinished-proposal.test.ts 和 K3-16-proposal-round-fixture.test.ts 都与 w2-base 逐字相同。"
  },
  {
   "row": "W2b-06",
   "status": "OK",
   "note": "goal-independent.test.ts:63-67 改为字面 workspaceRef 并附注释，pins 保持原样。"
  },
  {
   "row": "W2b-07",
   "status": "OK",
   "note": "agentActorIdFor、sha256Hex 已删，没用的 SessionRef import 也删了（lead）。"
  },
  {
   "row": "W2b-08",
   "status": "OK",
   "note": "S2C-node-detail-anomalies.test.ts:90-159 全程走真实步骤：line.createSession、fixture.claim、line.start、pauseAtSafePoint、restart（W-20 reconciled）、archiveLine、requeue、另一个 Session claim/start/entered，pickedUpBy 等于真实 claim 的 runRef，失败只注入 incomplete。:161-207 是 101 次真实归档，只有第二页失败，120_000 加实测注释，符合 R-14。hover 行（:209 起）不在 T1-040 范围（t-items-T1.md:268-272）。S2C-L-runs-support.ts 与 w2-base 相同。S2C-D-node-support.ts 的 runtimeLine 是可选项，schemas() 有默认值，默认路径不变；createSession 去掉的第三个参数已没有调用者。其他 importer（S2C-lines-read-only、S2C-node-detail-bounded、-executions、-hover、-next-kinds、-task、S4C-node-notes、S4C-path-ownership-callers）的行为不变。"
  },
  {
   "row": "W2b-09",
   "status": "P1-01",
   "note": "3a（:299-321）按行文完成。3d 的 rework 时间（timeline 的 requeue point）和 plan 时间（acceptedAt）都来自公开读；archive 时间的 R-20 理由不成立，见 P1-01。"
  },
  {
   "row": "W2b-10",
   "status": "P1-02, P1-04",
   "note": "guard 2：真实 outcome_unknown，Lease 仍持有，plan-machine.ts:658-663 的 guard 2 排在 2b（:664-668）和 4（:675-682）之前，去掉 guard 2 后 reason 会变成别的文字，这一行会失败。guard 9 的竞态：在 A3 commit 包装里通过 steps.controls.submitControl 做真实取消，去掉 pin 后 apply 会提交，这一行会失败。seedRun、seedLease、humanStop 都已删除。R-19 做了；gate 这一行没做 R-18，见 P1-02。"
  },
  {
   "row": "W2b-11",
   "status": "OK",
   "note": "S2C-lines-tiers.test.ts:155、A7-control.test.ts:451、S5R2-queue-history.test.ts:127 补上了源 id，只改了名字。"
  },
  {
   "row": "W2b-12",
   "status": "OK",
   "note": "S4C2-project-set-shared.test.ts:192-202 的第三个值只用来给行命名。"
  },
  {
   "row": "W2b-13",
   "status": "OK",
   "note": "S4C2-D-rows.test.ts 的 D-06 标题已删去 'and supersedes it'。"
  },
  {
   "row": "W2b-14",
   "status": "OK",
   "note": "D16 把整组组合参数化：文件行是 userOnGoal false 加 pitfall，Goal 行照旧；generalNote 默认 pitfall（S4C2-note-card-fixture.ts:105-107）。两个后端都跑。"
  },
  {
   "row": "W2b-15",
   "status": "OK",
   "note": "R4b-session-directory.test.ts:266-306 用 A3 包装 admitSessionCreation 观察 plannedSessionRef（长度 1），拒绝后 readSession 为 not_found。"
  },
  {
   "row": "W2b-16",
   "status": "OK",
   "note": "R4b-session-directory 和 S4C2-U3.test.ts:29 的拒绝行都在 rejects: 里，前后各有一次公开读（U3 在 :61、:91），U3 只跑 memory，按 §6。"
  },
  {
   "row": "W2b-17",
   "status": "OK",
   "note": "partial（R-20 成立）：W1-future-plan.test.ts:489-490、:545-546 只用 readJsons 比较 C 的 Reduction 字节；Run 和 Lease 改走公开的 execution 读。"
  },
  {
   "row": "W2b-18",
   "status": "OK",
   "note": "record-store/lookup.test.ts：readMany 的 json 和 revision 在 lookup 前后相同，重复 lookup 的 readThrough 不变；重开后 readMany 返回原 json，revision 为 1。"
  },
  {
   "row": "W2b-57",
   "status": "P1-03",
   "note": "activity-read-helpers.ts:186-187 缺 dispatch 记录时抛 unavailable 并带 ref key，签名不变。调用点：activity-read-model.ts:401（只在有 sessionRefs 时）、:431、:669，track-read-model.ts:509、:565、:601。生产中 Run 只由 claim-service.ts:456-467 创建，create_run 和 create_outbox 在同一次提交（task-machine.ts:929-931），所以生产流程到不了既没有 history 也没有 dispatch 记录的 Run。S2B-backfill-workflow.test.ts:68-90 的 legacy Run 也到不了：readCalendar 不带 sessionRefs（:349、:369），Run 是 ended，不进 :419-439 的未结束 Run 循环，readRunActivities 不调用它。S2C-X-scale-fixture.ts:321-357 的克隆 Run 保留了原 attemptId 和 history。R7 用例和头注释已删（S2B-r2-keyed-cap.test.ts:1-6）。"
  }
 ],
 "r20": [
  {
   "row": "W2b-09",
   "part": "3d：archive 触发的 at 绑定到归档 TaskRequeue 自己的 requestedAt（:546，以及 :565-678 保留的 w2-base 用例）",
   "categoryTrue": "不成立。所谓 missing entry point 不对：create-platform.ts:1263-1271 和 task-state-timeline.ts:149 说的只是 executions 读和 timeline 读，没有覆盖 plans.queryTaskGraph；后者的 TaskRow.rework.entries[].requestedAt 含归档 requeue（plan-contracts.ts:115-116；src/contracts/task-failure.ts:211-226；state/task-failure.ts:1265-1286；plan-service.ts:898；plan-readers.ts:1720-1731）。",
   "reachable": "可达：plans.queryTaskGraph → TaskRow（taskId 为 archiveTaskId）.rework.entries 中 ref 等于 archiveRef 那一项的 requestedAt。测试在 :495-497 已经对同一次读取用它的 requeueRef。"
  },
  {
   "row": "W2b-17",
   "part": "场景 C 的 TaskReduction（revision、reducedAt、anchor、evidence ids）前后字节不变（W1-future-plan.test.ts:489-490、:545-546，readJsons）",
   "categoryTrue": "成立。TaskRow 没有 reduction 字段（plan-contracts.ts:89-125；phaseCause.detail 也没有，src/contracts/task-failure.ts:45-59）；TaskReduction 只作为 completeTask 这个写操作的结果返回（task-contracts.ts:70-73）；GoalPhase 只在 completeGoal 之后才有（goal-phase.ts:21-31）。",
   "reachable": "不可达：没有哪个公开读返回完整的 TaskReduction，包括 anchor 和 evidence ids；读 Reduction 的地方都在内部（plan-readers.ts:188-218 的解码，:1391、:2270 的内部派生）。"
  }
 ]
}
######## v2:c6d0904ed79583b788c1847c6680100221e8cab53c562bb27293363ca3f0d2c7
{
 "verdicts": [
  {
   "id": "P3-01",
   "verdict": "refuted",
   "classOk": "建议",
   "reason": "The fact is true. rawRecordBody returns body.text (timeline.ts:311-314), and renderRawDisclosure puts it in the html escaped (timeline.ts:330), so 'future.unknown' reaches the html through the raw block. That makes :447 implied by :448, and the label at timeline.ts:275-278 is never asserted. But the rework did what the frozen row asked. W2b-41 改法 (t-w2b-findings.md:111) says 'add a future.unknown record and assert it in the html and its raw block', and :419-424 plus :447-448 do exactly that. The source assertion was also only html contains 'future.unknown' (R6:363 per ledger-cover T3-L1-01, D:\\cc-lead-notes\\impl\\t\\checks\\w2-ledger-cover.json:143). The lead adopted that finding's fix (:145) and not the pre-audit's data-history-body=\"unknown\" variant (w2-preaudit-dump.md:193). So no source coverage was lost and the table allows the change. A stronger assertion is only a suggestion."
  },
  {
   "id": "P3-02",
   "verdict": "refuted",
   "classOk": "建议",
   "reason": "Both facts hold. observationState exposes current.captureRef = pointer.observedRef (create-platform.ts:1327; architecture-service.ts:856; architecture-observation.ts:53-55). readArchitectureRevision {kind:'current'} returns not_found when there is no active pointer (catalog-service.ts:373, :772-775). But W2b-55 改法 (t-w2b-findings.md:125) rules 'the database tail: R-20 (missing entry point)' for the whole tail. The row's own problem text already says observationState lacks only the first two of the four facts, so the lead sent the tail to R-20 knowing observedRef was readable. R-20 (:37-39) requires the w2-base form exactly. The tail at tests/composition/R3d-R3g-platform.test.ts:223-236 is identical to .lead-ref/base :211-224, and §6 :199 records it as partial. The rework followed the ruling. Narrowing R-20 to :227 and :229 is a table question for the lead, not a rework violation."
  },
  {
   "id": "P3-03",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "At :106 contentDigest is copied from adopted.value.baseline.contentDigest. :115, :118, :175 and :221 then compare against that object, so the expected digest is the actual digest and a consistently wrong digest would pass. The decoder recomputes with the same function (catalog-record-codecs.ts:219-223). The digest is deterministic from the fixed adopt input: sha256(canonicalJson({schemaVersion, identity:{baselineId}, revision, content})) (catalog-record-codecs.ts:193-202; catalog-service.ts:517-518). It is not an issued id of the R-8 kind. R-11 (t-w1r2-findings.md:17-19) and F8 (rule-sheet v1:78) require the literal with its working. The same table did this for the sibling digest of a fixed body: W2b-55 'Digest literal with its working' and W2b-29 'Literals for the fixed bodies'. W2b-56's 'issued values as returned' does not cover it. One caveat: W2b-23 does treat argumentsDigest and capture digests as issued, so the lead should confirm the reading. I counted the canonical text at 183 bytes and that matches. I could not verify the SHA-256 value 27272b14…55d5 read-only."
  },
  {
   "id": "P3-04",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "tests/helpers/R4-history-turn-support.ts:56 says 'Extra scripted replies after the first text reply'. But :127-128 passes input.replies instead of [{kind:'text',text}] when it is given, which replaces rather than appends. The :56 line predates the rework (base :55). W2b-40 named this comment block (:53), and the rework's new :53-54 ('passed as the Run's only scripted reply when replies is absent') now flatly contradicts :56. It is a wrong comment in a row about fixing comments."
  },
  {
   "id": "P3-05",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The rework rewrote :27-28 to 'made absent ... (a counter records any call)' (P3.diff:368-371). The only test sets seam.absent = true at :85 before the scenario is built. The getter at :34-35 then returns undefined, and production resolves readTurnBounds at call time (session-operations.ts:1004; runtime.ts:352). So wrapped (:33) is never reachable, seam.calls stays 0, and :93 can never fail. What really protects the test is the item's basis: an absent seam answers unsupported and the brief cannot be built (t-items-T3.md:361). The comment describes a guard that does not exist. It is untidy (不整洁)."
  },
  {
   "id": "P3-06",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The core point holds. The §6 reason 'the memory Host answers unsupported for settings' (t-w2b-findings.md:194) is only true when there is no settingsDirectory. host.ts:324-329 enables settings for a memory store once settingsDirectory is given. The rejects block itself is sound: the forbidden row hits host-settings.ts:773-776 before readCheckProposal (host.ts:979-1001). Correction to the evidence: :246 is a memory Host with withSettings:false. No test in the file actually runs memory plus settings; only the helper allows it (:109, :116, :123-125). W2b-42 does not cite R-19, and the source rows ran on SQLite, so this is only about the reason text, a suggestion (建议)."
  },
  {
   "id": "P3-07",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "tests/runtime/R4b-session-input-boundaries.test.ts:137 and R4b-session-recovery.test.ts:248 assert only status 'rejected'. R4c-execution-history.test.ts:302-309 pins code 'invalid' for the same kind of cursor refusal. Both refusals pass through cursorMatches (session-operations.ts:225-231, principal and sessionId), and a mismatch is rejected('invalid') at :425-427. It is not a regression: the base asserted status only too (base R4b-session-input-boundaries :128-130; base R4b-session-recovery :226). W2b-49's R-18 does not require the code, so tightening it is a suggestion (建议)."
  }
 ]
}
######## v2:71cfc33e65ef2137c83b1e2a668a9691846ad72c85e23f45dfd8c15ba4ee3ab4
{
 "verdicts": [
  {
   "id": "P1-01",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "I could not refute it. The archive requeue's requestedAt does have a public read. The finding's evidence chain checks out line by line. plans.queryTaskGraph is the plan service's method, passed through unchanged (src/composition/create-platform.ts:1119, :1361-1362). It builds every row with taskRow (src/core/work-graph/tasks/plan-service.ts:1966-1967), and taskRow attaches rework (:970, :988). The work-Task input takes requeues from facts.requeuesByTaskId (:898). That map holds the TaskRequeue of every ended Run of the selected Tasks (plan-readers.ts:1720-1731, read by readReworkRecords at :1515-1555 with no archive filter). reworkSummary maps every requeue to an entry that carries requestedAt (state/task-failure.ts:1271-1285; contract src/contracts/task-failure.ts:211-219). Grep finds no archiveOrigin in state/task-failure.ts. The reader under test takes the archive trigger's at from that same record's requestedAt (plan-readers.ts:1409-1417). The test already does that graph read after the archive (S4C2-goal-triggers.test.ts:495-497) and takes archiveRef from it, so binding archiveAt to rework.entries[ref == archiveRef].requestedAt is possible. As a result, the §6 R-20 reason ('no public read', resting on create-platform.ts:1263-1271 and task-state-timeline.ts:149) is false. archiveAt at :546 comes from the reader's own output (F8), which contradicts W2b-09's wording that 'each equals the time read from its own source record'. Keeping the w2-base fake-record case (:565-678: hand-encoded RunSnapshot@1 at :608-615, fake lookup port at :639-655) loses its R-20 basis. The BLOCKED comments (:537-545, :569-577, header :24-30) say something the code contradicts. No ruling (§0, §5) allows this. R-20 needs a true BLOCKED category and says 'never work around it'. 违规 fits: a wrong reader is still caught by the kept fake case, so nothing goes wrong now; the defect is a false R-20 plus F3/F4/F8."
  },
  {
   "id": "P1-02",
   "verdict": "refuted",
   "classOk": "建议",
   "reason": "This is a disagreement with the lead's scope call, and the table already records that call. W2b-10's fix scopes R-18 to 'Converted refusal rows'. The :585-701 position is just the span of P T1a-01 (590-596) and T1a-02 (676-701), the guard-2 and guard-9 rows (checks/w2-preaudit.json:11, :25). Codex T1a-05, the finding that sources R-18 here, names :635, :671 and :705, not the gate row (codex2/t-w2a-T1a.out.md:11). Wave 2 did not convert the gate row. Its text is the same at w2-base (t-w2base A2-disposition-change.test.ts:510-518) and w2-merged (.lead-ref/base :624-632). It never used seedRun, seedLease or humanStop, unlike the TASK-19, traced and guard 7/9 rows (t-w2base :443-452, :466, :537-571). T3-106's refresh speaks to the branches that had to be converted. §6 (t-w2b-findings.md:175) explicitly records 'Left: the gate/only-carrier row (two refusals in one row) is not a wave-2 conversion'. The setup(kind) change is just the describe.each(BACKENDS) wrapper on the whole W16 describe (P1.diff :997-999), so it carries no weight. The F11 label does not hold either. Each adopt holds one error, so the row fails if either guard is removed. Without the gate guard, the first adopt commits and the 'rejected' match at :625-626 fails. Without the only-carrier guard, the second adopt (basedOn f.plan, still active) commits and :627-629 fails; any write would also show in the activePlan read at :630. The remaining point (outside rejects:, no read before) was already true at w2-base, so it is at most an optional tidy-up beyond the table."
  },
  {
   "id": "P1-03",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "S2B-r2-r5-not-entered.test.ts is gone from tests/work-graph (Glob lists no such file). A Grep for seedRawRunVariant over D:/cxt/t-w2r1 finds only its definition (tests/helpers/S2B-r2-track-support.ts:48) and the old copies in .lead-ref (base test :13/:39/:54, P1.diff :1570/:1596/:1611). The P4 tree has no use either. The imports and constant at :13-16 are used only inside it: canonicalJson/JsonValue at :55 and :74, RunRef at :52 and :61, RUN_SCHEMA_ID at :76. seedRealTrackRuns (:28-40) uses none of them. The function hand-commits a raw Run through commitRaw (:75-77), the F3 shape the deleted test needed. With no caller left it is dead code from the W2b-57 deletion, the same case as W2b-07 (an export with no caller, 不整洁, delete). No ruling keeps it; W2b-57 keeps only the production provenNotEnteredKernel."
  },
  {
   "id": "P1-04",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The facts are right, and the finding is correctly labelled optional. At A2-disposition-change.test.ts:379, unknownOutcome passes entry: b2.entry and controls: steps.controls to reconcileRunAtStartup. b2.entry is the B2 fixture's createExecutionEntryService, built with no hostInstance (tests/helpers/B2-execution-fixture.ts:202-211). restartedHost, which the comment at :356-361 cites, takes deps.entry from fx.rebuildDeps({ hostInstance: host, ... }) (S2B-runtime-tools-support.ts:83, :87). That entry is built with the new hostInstance (B2-runtime-fixture.ts:285-287), and controls come from the caller there too (:82, :86). On this row's missing-probe path, reconcileRunAtStartup uses only deps.reconcile (run-reconcile.ts:280-283, :303-307). deps.entry is touched only at :397 and deps.controls only at :423, both on the readable path, so the result does not change. One small correction: the comment lists the parts it copies and never says the entry is rebuilt, and b2.entry is not tied to any Host. Still, 'the restarted Host reconciles ... as restartedHost' does not match a mixed set of dependencies, so 建议 fits."
  }
 ]
}