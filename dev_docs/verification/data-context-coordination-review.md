# Data／Context 与协调自治复核记录

日期：2026-09-05。依据：用户反馈 PRODUCT 基本符合要求但角色仍缺失；ARCHITECTURE 首图缺连线说明、ReadModel／Context 定义不清；协调图缺指挥反馈，并要求考虑事件驱动、小变更自治及记忆／Skill 支持。

## 已落盘

- [ARCHITECTURE](../../ARCHITECTURE.md)：逐边标注 Plane 图；Data Plane 包含持久事实、ReadModelIndex 与 ContextCompiler；明确查询、材料编译、验证流程和 Control 的职责；增加 ContextCompiler 对 ReadModelIndex 的候选源码依赖。
- [角色复核稿](../design/human-framework-role-review.md)：协调者直接提交分工、耦合／测试设计、集成和返工提案，框架反馈执行／验证结果；小变更按授权与影响判定。列出规范、耦合、外部信息、压缩、Token 和生命周期事件的候选处置；区分策略、案例记忆与 Skill。
- PRODUCT 与 CONTEXT 同步核心角色；ReadModel Module 与 GoalView Interface 补上投影与验证的区别。
- P0-06 记录产品基本符合、架构剩余部分未审；P1-11/13 与 MVP 标明自治和诊断路径待细化的范围；入口图同步当前职责。

## 边界与未决项

仅修订设计文档，未实现调度器、记忆系统或全局 Skill。部署时需显式配置版本化策略，未编造通用 Token／压缩／存活时间阈值，未授予新的目标或 baseline 修改权限。新版委托契约、角色 Context 拆分、诊断重试预算及完整 MVP 剧本仍待审阅收敛。

## 验证

运行现有文档检查，核对全部高层图连线有传递内容说明、Data 子图包含 ReadModel／Context，源码依赖保持无环；结果见本次交接。验证仅覆盖文档结构与图关系，不证明产品运行实现或语义验收已经完成。
