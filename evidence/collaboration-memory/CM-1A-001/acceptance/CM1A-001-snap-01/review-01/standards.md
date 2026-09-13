# Standards 独立验收：CM1A-001-snap-01

范围：用户交验三工作段及 `src/control/control-engine/coordination.ts`；不把整份 `git diff HEAD` 归因本票。基点 `0eb02717d16412298c786166a75ca1a9d3e05ac7`。只读产品源码。规范依据：文档根 AGENTS、ARCHITECTURE、module-status、Control/Dispatch/StateLedger Module、runtime-collaboration、command-event、state-ledger、module-boundaries Interface，以及本票。

验收统筹独立复算当前树指纹 26529f1e926bc71220fdcaa128368ac5a168e96fc4f1e16b1104ef2ed5a44589，与交验声明不符；以下发现绑定当前实测树，不追认声明快照。

## 规范违反

1. **STD-01 / P1：下一页提交与专用校验不兼容，分页必拒。** `src/control/control-engine/records/coordination.ts:807–812` 在 nextIntent 非空时追加 CommunicationIntentRecorded 与新 intent 快照；`src/data/state-ledger/ledger-validation.ts:2307–2312` 既禁止该事件，又要求 intent 快照恰好一个。规范：Ticket §4 边界表及 A03 要求 page settle/checkpoint/Delivery/wait/next intent 同事务；StateLedger Module §Local 要求事件、快照、expected 对齐。独立反例直接调用真实 builder、validator、InMemoryLedger.commit：相同输入末页可 committed，续页返回 `invalid_commit`。仅加事件白名单仍不足，必须同时验证当前 settled intent 与下一页新 intent 的不同角色。此问题由第三处修复接线不完整引出，现有单页测试无法证明分页。

2. **STD-02 / P2：participation-start 专用校验遗漏原有事件基本约束。** `ledger-validation.ts:2210–2211` 仅检查事件名；原通用入口 `:2128–2129` 还检查 schemaVersion=1、非空 eventId。独立变异反例：合法 builder 产物单独改 eventId 为空或事件 schemaVersion=2，专用校验仍 true，而通用校验 false；逐例通过公开 InMemoryLedger.commit 复核，三种变异均实际 committed，下层没有兜底拒绝。规范：Command/Event §Schema/version（含 v1 事件定义及未知版本不得静默消费）、StateLedger 的完整性校验职责。该修复确实放宽了校验；需保留共同基本检查，再叠加专用关联规则。另将第二事件 workspaceId 改为其他 Workspace 仍通过，与该校验器 :2191–2192 的同范围保证不符；此项在通用校验中也存在，不归因为新退化。

## 三修复复核与启发式

waitRef 删除不存在的 workId 符合 canonical Ref 定义；admitWaitSuccessor `coordination.ts:1747–1756` 仍从快照核对 owner Work，未发现这一删除导致的反例。wait-register 新增 Recorded 事件可由通用白名单接受；route-page 结论见 STD-01。上述是规范/兼容性缺陷，未另报 Fowler 启发式问题。

## 重跑与边界

产品根执行：`node evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/standards-repro.mjs`。

Node v24.19.0，原始结果见 `standards-repro.log`，退出 0；脚本断言的是缺陷仍存在。仅运行隔离存储边界探针，不替代 WSL 测试入口、不声称跨进程或 A03 端到端验证。TypeScript 原生加载只读 resolve hook 把源码 .js 导入定位到对应 .ts。

Standards：2 项，其中最高 P1；未修改实施源码。

