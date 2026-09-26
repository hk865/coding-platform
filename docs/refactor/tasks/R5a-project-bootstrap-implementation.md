# R5a 正式初始化：中审冻结后实现

仅在主审导入已审骨架和17项目标测试并创建implementation lane后执行。详细契约以R5a-project-bootstrap-skeleton.md §1–9为准；本文件明确进入第二阶段，不再停在unsupported骨架。

## 阅读与范围

读当前HANDOFF、质量规范§2.1、DSH规范和原任务书；沿真实Goal/Plan/Architecture/Store与两冻结测试读上下游。只写implementation-scope两个生产文件：project-bootstrap-service.ts和project-bootstrap-record-codecs.ts。DTO/唯一政策digest/组合根/schema消费者及全部测试只读。旧工程、Kernel、DSH配置不改，全部原地写，不用同级临时文件rename。若有真实缺失的既有纯函数导出阻碍复用，报告精确符号/最小修改，不复制整体旧框架或自行扩scope。

## 实现重点

- 四个真实Host writer复用现有记录schema、commandIdentityKey、canonical ref/JSON、已导出的政策digest、局部Store guards。共享少量请求隔离/回执/提交接缝，不拆四服务或另一配置数据库。
- 第一await前隔离ctx/input/meta并保留原signal；结构/scope→原identity/fingerprint回执→fresh精确事实→一次commit。准确区分输入target跨项目forbidden和非法expected invalid；已有同身份payload/有效expected变化idempotency_conflict。
- Project首次创建仅guard本Project absent；Workspace仅核实际Project，不读未来Workspace、不打开目录。安装不可变内容revision行，行revision恒1；activate核实际已安装target/digest并只CAS推进本项目active pointer，不改已接受Plan。
- 原receipt从真实事件恢复原value/cursor/actor，后续active变化和晚取消不能覆写过去。fresh失败/确定commit冲突回查同键；未找到时保留确定拒绝码/current，commit抛错/失联且不能确认才unavailable未知，不宣称安全重复。
- 事件codec只校正常wire/identity对应关系；政策内容纯结构检查按旧专用函数规范，勿恢复通用validation框架、Role热换或直接内部篡改反例。沿实际Store/schema能力做最少解析，无额外全图/全账本读取。
- 17项冻结测试用真实backend/空SQLite公开链。确保实际到达后半段：第二项目/Workspace、政策安装与激活因果、真实Architecture/Plan、重开回执、两个miss并发、commit成功后取消、Host权限版本与领域版本分开。不要调整测试变绿。

## 自检与交回

python3 tools/dsh-refactor/check.py next-bootstrap next-plan next-catalog next-future-plan next-future-intent next-b2-composition；next-types/next-architecture单跑。按受影响路径检查，不重复全Store/Kernel矩阵。目标通过后STOP，报告真实达到的公开链、差异/hash与限制，等待独立验收。R5a不等于Query/Workflow/UI完成，不自动创建baseline解除门槛。

## 独立初审返修（等待主审刷新冻结测试后执行）

首轮13文件81项、types独立通过，但真实契约尚有以下缺口；仍仅原两生产文件可写，不扩接口/测试/组合根。

1. commitBootstrap实际提交成功后若响应丢失抛错，当前catch直接“transaction failed”不准确。先同identity+fingerprint查回执并eventAt恢复；实际found才committed/replayed，读不到或查询抛错返回unavailable且明确提交结果未确认，不断言未提交或安全重复。确定Store拒绝仍保留原code/current；同键冲突的判断不吞掉。
2. registerWorkspace/install的readProjectRevision与activate的readMany是合法await窗口；其后提交前必须检查首await前绑定的原signal，取消零提交。共享最末提交接缝可携带已绑定signal做一次最终检查，勿新造取消管理器、重读Role或额外授权链。确认提交后不再用取消覆盖事实。
3. install的expected policyPin必须指向input.contentRevision那一完整ref，不能拿另一个revision的缺席证明写本revision。wrong-ref是invalid，不能悄悄转成实际ref。
4. activate同一身份两次初始lookup都miss，A提交后B才读active，会在fresh revision_conflict处提前返回；应先回查原identity，found恢复原结果，not_found保留真实当前版本冲突。沿既有恢复接缝，不增加全图/全库读取。
5. create/Workspace/install新请求携带nonzero的“必须缺席”pin时，没有读到真实当前值就不可返回current:0。保留既定revision_conflict，但可省略未知current，不为此添加额外读取。

质量：复用ProjectBootstrapDependencies，删除完全相同的私有BootstrapDeps重复类型；仅可信Host写出的事件actor解析不需要额外agent分支，保持旧公共ActorRef类型兼容但不要为无生产者的分支扩测试。政策纯结构检查约20行可保留唯一导出，不为代码量拆四服务或创建通用验证器。保留真实请求隔离/局部CAS/原历史恢复。

主审将刷新唯一work-graph冻结测试（真实Store转发窗口、无内部篡改），先确认新回归在本实现上的真实失败，再开始修复。运行next-bootstrap和原相邻集合、next-types/architecture，目标通过后STOP。
