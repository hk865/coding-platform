# A1：已结束 WorkLink 的定向发现（已准备，按用户要求停止）

2026-09-27。**根代理已批准原三文件 Stage1，草案六个源码依据 SHA 全部复核一致；fresh prepare `a1-ended-work-link-skeleton-20260927` 已完成，但用户随后要求停止新施工、转入独立仓库提交与交接。本批尚未执行 harness run、没有 DSH Session、没有候选代码改动、未运行测试、未导入。** 准备状态见[记录](../reviews/evidence/next-b2-2026-09-26/a1-ended-work-link-skeleton-preparation-paused.json)。后续重新获准推进时先核主树与保留 lane 基线，再开新会话，只交骨架及一条正常链后 STOP；本次不继续。 用户已授权持续推进，本文不新增用户审批步骤。范围是原 Session directory 的只读能力，独立于在途 R6 execution/Host/UI；不触及 composition、Host 路由、R6 main/views 或生命周期写入。

唯一 Stage1 范围见 [三路径 scope](A1-ended-work-link-discovery-skeleton-scope.json)：原 `sessions/contracts.ts`、`sessions/session-directory.ts`、既有 `tests/work-graph/A1-session-lifecycle.test.ts`。T=`W/coding-platform/next`，本文源码路径相对 T。Stage1 只公开可选字段与明确 unsupported 骨架，加一条最终正常链后 STOP；不提前实现查询算法。下一 Stage2 从中审最终基线新建单文件写范围，仅 `session-directory.ts`，本次不派。

## 1. 已有 owner 与索引证据

- `src/core/work-graph/sessions/contracts.ts::SessionDirectoryPort.findSessions` 已公开 `workspace/target?/role?/includeArchived/page`，返回 `ReadResult<SessionPage<SessionCard>>`。SessionCard.record 保持生命周期/可用性事实，links 是原 SessionWorkLink；不新增 Agent/历史目录。
- `session-directory.ts::targetRelationPlan` 使用 `SESSION_LINKS_BY_MODULE_LOOKUP`、`SESSION_LINKS_BY_TASK_LOOKUP`、`SESSION_LINKS_BY_WORK_LOOKUP`；`findSessionsByTarget` 合并 responsible/participates/investigated 三条按sessionId有序流，去重后只读取相关Session及自己的links。当前 `heads[].open = link.until===null`，`visible` 要求 openLink，导致所有匹配关系已结束的Session不能从target发现。
- `session-lifecycle.ts::runLinkAttempt` 的关闭分支写回**同一个** SessionWorkLink ref，revision+1，保留since，并把until绑定到真实commit cursor；不删除record，也不清理历史target索引。复开同一ref会更新当前区间，不每次另建关联聚合。
- `session-record-codecs.ts::SESSION_RECORD_SCHEMAS.lookups` 的target键只有project/target/ref/relation，不含until或active谓词；`sqlite-record-store.ts::createLookupIndexes/lookupInside` 直接在snapshot注册路径建表达式索引并查其值。因此closed条目仍在原索引中，**无需修改link writer、codec、索引注册、表或composition**。

本批只扩大“已存在关联的可发现范围”，不读事件重建全部开闭区间，不允许任何新生命周期，不把查询变成授权或当前Task执行资格。Task/Module仍用完整真实target，不能用当前Session的工作链接推断其它Task历史。

## 2. 最小公开契约

沿原方法输入增加一项，不包装第二接口：

```ts
findSessions(ctx, {
  workspace,
  target?,
  role?,
  includeArchived,
  includeEndedLinks?: boolean,
  page,
}): Promise<ReadResult<SessionPage<SessionCard>>>;
```

- `includeEndedLinks` 缺省或false：完全保持原当前关联行为；target查询仍至少有一条同target的link.until===null。非target目录查询保持原行为及原DirectoryCursor。
- true：只用于明确target的定向发现，允许原索引中匹配该target的当前或已结束link；不是“仅历史”，也不是查询所有Session。true而没有target返回invalid，不能暗中转为全workspace扫描。非boolean且非undefined返回invalid。
- `includeArchived` 与它独立：false仍只可见active Session；true才可见archived Session。结束关联不等于Session归档，Session归档也不等于link结束。
- 一个Session在三个relation流中有多个匹配link，仍只返回一个SessionCard；返回原完整links，消费者按完整target与until区分当前/已结束，不能将其它target的link归给本节点。
- 返回既有sourceCursor/nextCursor、availability、role过滤、现Host scope与actor约束；不返回新历史summary/假Run/墙钟时间。since/until是Platform commit cursor，不是Kernel history position。

### TargetCursor 兼容与固定过滤（Stage2）

原 `TargetCursor`、`encodeTargetCursor/decodeTargetCursor` 和游标续读校验保持单一实现。新target游标携带本次规范化includeEndedLinks过滤；续页必须和原过滤一致，否则invalid。旧v1 target游标缺该字段按false理解，只能继续默认/false查询，不能扩大到true；明确false与省略相同。不将新字段误当DirectoryCursor必填，不破坏旧非target游标。

继续现有targetKey、includeArchived、roleKey、actorKey、scope、sourceCursor和各relation position/exhausted绑定，不新增游标版本框架、全量seen集合、SQL、共享缓存或全系统一致性校验。输入在现公共入口同步读取规范化值后传入原helper即可。

## 3. Stage1 只做骨架，不实现算法

1. contracts.ts 的原findSessions输入加入文档化 `includeEndedLinks?:boolean`；保持其余DTO原样。
2. session-directory.ts 的原实现签名加入同字段，在现公共输入/target解析处完成便宜局部形状检查。合法 `includeEndedLinks:true` 且target存在时返回 `{status:'rejected',code:'unsupported',reason:'ended work-link discovery is not implemented'}`。将此分支置于任何target候选lookup/read之前；默认/false继续走**原**算法。
3. 本阶段不得改 `findSessionsByTarget` 的openLink/visible/merge算法，不启用closed候选，不假造ready空结果，不提前实现游标新过滤。target cursor固定语义先由任务和新正常链约束，Stage2才落生产。
4. 只在既有 A1-session-lifecycle.test.ts 文件新增**一个独立SQLite it**（放在既有describe.each块外，复用make('sqlite')），不让新case再扩成后端×类型×并发矩阵。所有旧tests、fixture与生产依赖只读；不删除/放宽已有断言，不整理旧用例。

## 4. 一条真实最终正常链（骨架预期首红）

建议测试名：`discovers ended target links through the original paged index independently of Session archive`。复用已有 `make/createGraphSessionFixture`、`fixture.adopt`、`fixture.createSession`、`moduleTarget`、`linkRequest`、`lifecycleRequest`、原session/lifecycle方法与spy；不写新fixture。

准备一个正式已采用Module target：

- Session A：公开link，再公开close，保持active；其since保留、until真实非null。
- Session B：公开link→close→archive；仍是同target，links和until事实保留。
- Session C：同target开放link，保持active，用于证明默认行为没有回退。
- Session U：仅关联另一个正式Module，用于确认定向发现不返回/读取无关对象。

全部准备先完成，再开始分页；分页期间不制造并发写入、损坏数据或结果未知条件。

**首个true调用前**，断言省略/显式false仍只发现C（即便includeArchived=true，也不能发现只有closed匹配的A/B）。随后请求 `{target,includeEndedLinks:true,includeArchived:false,page:{limit:1}}` 并直接期望ready；**Stage1必须在这里因unsupported首红**，不能把unsupported当成功、跳过用例或mock返回。

最终实现后，同一个it继续：

- 顺着原opaque nextCursor完成active结果分页，收集恰好A/C，无重复、没有U；对应A的匹配link.until非null，C的匹配link.until为null。
- 使用同target+includeEndedLinks=true+includeArchived=true发新头部查询，得到A/B/C，B仍archived；证明两个过滤独立。新查询使用新cursor，不在旧cursor上改变filter后期待成功。
- 利用本链非空续页cursor，改变includeEndedLinks为false的续读应invalid；保持原true续读成功。只这一项真实翻页过滤边界，不展开cursor破坏矩阵。
- 在本链定向查询阶段用已有fixture.spy核lookup只走原target索引及返回Session自己的SESSION_WORK_LINKS_LOOKUP，不调用Session workspace候选扫描，不读U。这个断言保护实际索引复用，不要求固定查询次数/实现内部调用顺序，不加入大规模性能用例。

不新增完整重启/更多relation/Task与Module笛卡尔积/篡改并发矩阵；旧发现与生命周期用例继续提供既有覆盖。新case只验证原公开链，不能raw seed或overwrite Session/link来构造业务成功。

## 5. 实现阶段边界（中审冻结后）

Stage2只改session-directory.ts：把规范化includeEndedLinks传入原findSessionsByTarget，沿原三条候选流允许closed匹配，保持Session去重、过滤、分页与读取预算；把筛选固定到原TargetCursor。复用既有codec/index与SessionCard装配，不改writer、schema、Store或模型/Runtime。不存在public生命周期可达问题之外的额外防御校验。

若实现者发现本任务所核实的索引/codec边界与实际快照不同，应报具体路径与事实，不能自行扩scope或造历史库。当前读证据已经足以维持三文件骨架、单文件算法实现。

## 6. 固定检查、交付与停止

- 运行既有 `tools/dsh-refactor/check.py next-graph-agent`，包含原A1 catalog/lifecycle/discovery集合；新增**仅一条**SQLite正常链。Stage1预期旧用例通过、新case在首个true请求处unsupported首红。若存在不相关既有失败，如实报告，不扩大修复。
- 运行原 `next-types`。不新增check注册，不跑全仓/全平台或追加矩阵。
- DSH Stage1提供实际差异、三文件hash、新case准确失败位置与类型结果，立即STOP，不实现查询算法、不导入主树、不自行派Stage2。
- Astra中审仅核接口/真实writer链/原default不回退/首红原因，冻结测试与contracts后再发单文件实现。原固定集合通过后停止局部打磨，交回R6消费者主线。

## 7. 阅读快照（不是派发基线）

- `coding-platform/next/src/core/work-graph/sessions/contracts.ts` SHA256 `b7a0247a09fb0d4db07979f0148b4af199740053b2fdf6d9f8229583f1646795`
- `coding-platform/next/src/core/work-graph/sessions/session-directory.ts` SHA256 `ff0288306c911419e938dc444c856e05db4bc64848ebb8320d41727ad397fe56`
- `coding-platform/next/tests/work-graph/A1-session-lifecycle.test.ts` SHA256 `86ef4c7123498a6c59649a8d3b0058d0594b2934b77519c241da89c05faa95ad`
- `coding-platform/next/src/core/work-graph/sessions/session-lifecycle.ts` SHA256 `bec16c76ba064c200645c6c7bb72671af1ab63b3109464eca484561ca3055738`
- `coding-platform/next/src/core/work-graph/sessions/session-record-codecs.ts` SHA256 `d9034fdebe36fc31219adafbd6df4d439a97ace0949797912eb4c4b75edfa725`
- `coding-platform/next/src/core/record-store/sqlite-record-store.ts` SHA256 `fac2a5c00efa553d6547058774ad81af9ca781ffe75014b5116220e8d0393bed`
