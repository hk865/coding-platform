import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = 'D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const changed = [];
function edit(file, fn) {
  const path = join(root, 'dev_docs', file);
  const before = readFileSync(path, 'utf8');
  const after = fn(before.replaceAll('\r\n', '\n'));
  if (after === before.replaceAll('\r\n', '\n')) throw Error('No change: ' + file);
  writeFileSync(path, after);
  changed.push('dev_docs/' + file);
}
function replace(text, from, to) {
  if (!text.includes(from)) throw Error('Missing text: ' + from.slice(0, 100));
  return text.replace(from, to);
}
function current(text, paragraph) {
  const header = '## 当前源码边界（2026-09-09）';
  return replace(text, header, '## 当前源码边界（2026-09-11）\n\n' + paragraph);
}
edit('modules/data/artifact-vault.md', text => {
  text = replace(text, '无其他产品 Module 调用依赖；存储 Adapter 注入。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。',
    'StateLedger、ReadModelIndex、WorkspaceReader：候选授权由投影发现，canonical 授权、撤销与版本由账本复核，原生来源适用性由 WorkspaceReader 提供。存储 Adapter 与这些接口由宿主注入；注入不消除实际 Module 依赖。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准。');
  text = replace(text, '宿主读取时再次核对读者的实际工作区与 Goal 归属，因此修复前登记的错误工作区授权也不能继续读取。Vault 本身仍不依赖 Ledger/Control，账本检查由注入解析器完成。',
    'Vault 的 material-access-policy 读取时再次核对读者的实际工作区与 Goal 归属，因此修复前登记的错误工作区授权也不能继续读取。canonical 复核属于 Vault 的授权实现，依赖 StateLedger；宿主只注入接口，不另持一套授权政策。');
  text = text.replace('`vault/artifact-vault.ts` 与 `vault/sqlite-artifact-vault.ts`', '`src/data/artifact-vault/artifact-vault.ts` 与 `src/data/artifact-vault/sqlite-artifact-vault.ts`');
  return current(text, '本节与上方 Dependencies 共同替代早期“Vault 无 Module 依赖”的描述；修订前原文按原样保存在本次收口 history 中。授权规则及旧正文/历史 grant 不因职责同步而改写。');
});
edit('modules/control/plan-compiler.md', text => current(text,
  '计划影响报告使用 Control 的 `resolveTaskWorkIdentity` 读取实际工作绑定；`planning-work-materials.ts` 为已接受源计划的任务取材，两种提案编译器只消费显式材料，不再用 taskId 拼造 workId。派发与影响报告共用 `taskWorkOrigin` 的同一返工起源链规则；显式身份与已有推导身份均原样保留。没有绑定时不虚构引用，读取不可用或未供材料时明确影响清单不完整。该说明不授予权限，不代替 Control 的受理守卫，也不声称受影响 Context 的实际刷新已全部接通。'));
edit('modules/control/control-engine.md', text => current(text,
  '`ControlReworkDisposition.projectIssues` 是当前义务处置的只读解释入口：读取当前 Plan 的义务承担者及适用的正式 Evidence，复用已有来源、版本与独立审阅资格政策。Verification 的原失败材料与当前处置状态分开；本地 PASS、未接纳 Reviewer decision、过期 Evidence 不能抑制未处理返工。读取中 canonical 版本移动返回 unknown，不提交状态。正式返工受理仍由 acceptReworkProposal 与既有计划变更命令执行。\n\n任务工作身份由 bindWorkContext 的权威解析守卫与 Ledger 提交时的唯一性约束共同保证，不依赖调用方先查。历史重复绑定保留可追溯，不据新规则删除或改名；旧库提交兼容见 StateLedger Module。'));
edit('modules/control/dispatch-engine.md', text => {
  text = replace(text, 'ControlEngine、ContextCompiler、WorkerRuntime、ArtifactVault。', 'ControlEngine、ContextCompiler、WorkerRuntime、ArtifactVault、StateLedger、PlanCompiler。');
  return current(text, '返工驱动接收组合根提供的 `issueMaterials`，不回调 VerificationEngine；缺少问题材料明确返回 unavailable。每个任务组受理后经 Control 的 ReworkDispositionPort 重新解释当前承担者与正式 Evidence，不能把来源 Plan 失效等同于义务已处置。问题事实与原报告保留，结果逐项说明已接手、仍待处理或明确阻塞。工作影响材料同样复用 Control 的工作身份解析。该路径保持既有 ModuleDependencyDAG，不新增 Dispatch→Verification 依赖。');
});
edit('modules/control/verification-engine.md', text => {
  text = current(text, 'Verification 持有检查/审阅 journal 与原始问题材料；canonical 运行产出读取经 VerificationContextPort 的 `runOutputWitness` 取得，load/events 与读取适配归 ContextCompiler，不直接依赖 StateLedger。原失败的当前性、义务承担者及正式 Evidence 是否已重验通过，经 Control 的 ReworkDispositionPort 解释；Verifier 不再用 journal PASS 或本地 Reviewer decision 另算一套处置资格。组合根将读取到的问题材料交 Dispatch，Verification 不成为 Dispatch 的回调依赖。\n\n角色规格 requiredOutputs 是声明性期望，仍如实记录已见证与缺项；它不降低轮次结论、不扣留归约。Plan 中正式 AcceptanceObligation/VerificationRequirement 继续按原验证与归约规则执行。未来记忆产出核对仍在现有 12 Module 内，不能据“记忆模块”新建架构。');
  text = replace(text, '；授权返工仍延期。', '；授权内返工的提案、受理及派发已有消费者，最新版本自动重验、再次独立审阅与最终归约闭环仍未完成。');
  text = replace(text, '## 2026-09-08 实际命令检查消费者', '## 历史切片：2026-09-08 实际命令检查消费者');
  return text;
});
edit('modules/control/architecture-reconciler.md', text => {
  text = replace(text, '## 2026-09-08 后续实现所缺的核心约定', '## 历史缺口：2026-09-08（由下方 2026-09-09 来源绑定实现替代）');
  text = replace(text, '2026-09-08：纯图差分新增', '历史记录（不作为当前待办）：2026-09-08 纯图差分新增');
  text = current(text, '当前 inspect 已按取材、差分、Finding/Brief 构造与逐步登记组织领域步骤；源码读取及版本供材仍经 Context，语义变化不因可读性整理而改变。下方 2026-09-09 来源绑定条款是已实现的局部机制，早期 revision 0 与固定 Finding 缺口保留为历史；真实初始基线、产品 inspect 入口、语义架构审阅与 MigrationGate 完整行为仍以唯一模块状态的未完义务为准。');
  return text;
});
edit('modules/data/state-ledger.md', text => {
  text = current(text, 'task 工作绑定提交在同一事务中核对并占用 `(projectId, workspaceId, goalId, taskId)` 的唯一身份槽，事件、绑定快照与槽冲突不能部分成功。SQLite 旧库可能已有 WorkContextBinding 而没有 identity_claims 槽：提交在事务内检查这些旧快照，不能因槽表为空给同一任务另建身份。旧绑定与历史重复原样保留；新写入不能扩大重复。内存与 SQLite 使用同一身份键规则，Control 的先查守卫只负责可读拒绝，不替代事务约束。');
  return text.replace('`ledger/in-memory-ledger.ts` 与 `sqlite-ledger/sqlite-ledger.ts`', '`src/data/state-ledger/in-memory-ledger.ts` 与 `src/data/state-ledger/sqlite-ledger.ts`')
    .replace('`data/governance-records.ts`', '`src/data/state-ledger/governance-records.ts`')
    .replace('`data/ledger-scope-catalog.ts`', '`src/data/state-ledger/ledger-scope-catalog.ts`');
});
edit('modules/data/read-model-index.md', text => {
  text = replace(text, '- 不依赖 ControlEngine 或 HumanCollaboration Implementation。', '- 只读政策解释复用 ControlEngine 的 PolicyExplanationPort；不提交 Control 命令，不依赖 HumanCollaboration。');
  return current(text, 'GovernanceViewPort 的实现 `src/data/read-model-index/governance-view.ts` 按需读取已提交治理事件与 canonical active/revision，组织当前生效内容、操作者及缺口。它不另存 active 权威、不提交治理命令；app/governance 只委托查询并适配人类命令与回执。此前治理查询留在 Host 的例外已结束，原文保存在本次 history；不需要出现第二消费者才将查询归 Module。');
});
edit('modules/data/context-compiler.md', text => current(text,
  'VerificationContextPort 的运行产出材料由 `run-output-materials.ts` 提供：从 canonical 记录及已提交事件查找可归属到当前 Run 的 ReviewWork 输出、PatchRecord、IntegrationResult 与 ExecutionNote，范围/版本不一致及读取不完整明确返回 unavailable。Verification 决定如何记录产出见证，Control 决定正式 Evidence 与义务处置；Context 不归约状态。\n\nWorkRunMaterialCompiler 保留工作/历史/角色必读材料的有界组织；code 材料仅经窄读取端口取得，原生列举、读取及拒绝路径由 WorkspaceReader 的 role-source-reader/denied-prefixes 管理。材料选择、权限、版本、缺口与最终 manifest 对齐的要求不变。'));
edit('modules/data/workspace-reader.md', text => current(text,
  '`role-source-reader.ts` 隐藏角色 code 材料的原生列举、读取、根目录与路径边界；`denied-prefixes.ts` 是对应拒绝前缀的共同来源。ContextCompiler 通过窄端口索取有界索引/源码，不自行创建底层工作区读取适配。来源 pin、实际版本和不可用/越界结果保留原义；这一归位不扩展语言、持久增量或多文件原子快照能力。'));
edit('interfaces/module-boundaries.md', text => {
  const start = text.indexOf('### Host 只读视图的显式例外：治理视图');
  const end = text.indexOf('写入面没有例外：', start);
  if (start < 0 || end < 0) throw Error('Governance section missing');
  text = text.slice(0, start) + '### 治理查询的当前归属（2026-09-11）\n\nGovernanceViewPort 由 ReadModelIndex 的 `governance-view.ts` 实现，按需读取已提交安装/激活事件和 canonical active/revision，展示生效内容、来源与缺口。它不新增持久 active 权威，也不将视图作为授权输入。`app/governance.ts` 只委托查询、接收人的命令并适配回执；字段级构造使用正式 commands。\n\n此前“治理视图暂留 Host、第二消费者出现再迁移”的例外已由本次职责修复替代。原文按原样保存在[修订前快照](../verification/2026-09-11-architecture-convergence/history/dev_docs/interfaces/module-boundaries.md)，不再作为现行边界或新增旁路的依据。\n\n' + text.slice(end);
  text = text.replace('记忆模块接上产出核对后由它承担核对。', '后续产出核对属于现有 12 Module 内的记忆能力；不据此新增 Module，具体后续工作未在本次实施。Plan 的正式验收义务与要求不因 requiredOutputs 取消独立门禁而移除。');
  const marker = '## 自动返工与角色规格（ADR 0003）';
  text = replace(text, marker, marker + '\n\n当前责任（2026-09-11）：Verification 读取自身 journal 形成原始问题，经 ControlReworkDisposition 解释当前义务承担者和适用正式 Evidence；组合根捕获问题材料传给 Dispatch，不注入回调让 Dispatch 查询 Verification。驱动每组受理后仍向 Control 重核当前处置，缺材料/缺当前事实如实不可用，不把 Plan 换版当作失败义务已消失。Verification 的运行产出 canonical 读取经 Context 的 RunOutputMaterialPort，不直接读 Ledger。\n\n工作影响报告通过合法 Plan/Dispatch→Control 身份查询取得实际绑定；源计划返工链起源算法复用，不自行用 taskId 拼接身份。未建立绑定与读取不可用分开，不以不完整清单推断权限或已完成刷新。');
  text = text.replace('由 VerificationEngine 提供', '由 VerificationEngine 提供验证问题材料');
  return text;
});
edit('interfaces/runtime-collaboration.md', text => replace(text, '## 各 Module 的扩展 Interface',
  '## 当前返工材料与只读解释（2026-09-11）\n\nVerification 的原始问题来自其持久检查/审阅记录，当前义务承担者与重验适用性由 Control 的 ReworkDispositionPort 复用正式 Evidence 资格解释。组合根将问题材料传给 DispatchEngine；驱动不反调 VerificationEngine，每次计划换版后向 Control 重新核对剩余问题。缺少问题材料返回 unavailable，缺少当前归属返回 unknown，二者都不能视为已处置。\n\n运行产出的 canonical 读取通过 Context 的 RunOutputMaterialPort 提供给 Verification；该材料不会直接完成任务。角色规格 requiredOutputs 仅为声明性产出期望，Plan 的正式验收义务仍按当前证据归约。精确 TypeScript 形状见产品 contracts/rework-disposition.ts、rework-drive.ts、run-output-materials.ts；ModuleDependencyDAG 不变。\n\n## 各 Module 的扩展 Interface'));
edit('interfaces/context-lifecycle.md', text => replace(text, '## 职责与连续范围',
  '## 工作身份与影响材料（2026-09-11）\n\n任务工作身份由 Control 的 canonical 解析及 Ledger 原子提交约束保证；派发先解析，已有身份只链接新 Run，不改名或另造。返工后继任务沿已接受 Plan 的同一替换链关联起源工作，计划影响报告使用该权威结果，不用 taskId 拼接不存在的 WorkContextRef。未建立绑定是可核对的 absent；读取不完整或未供身份材料明确报告缺口，不能声称工作影响清单完整。旧绑定、历史失败及原始验收保留。\n\n角色规格的 requiredOutputs 是声明性产出期望；移除其独立门禁不改变 Plan 的 AcceptanceObligation/VerificationRequirement。后续运行产出与长期记忆核对仍在既有 12 Module 内讨论，不新增 MemoryStore Module。当前派发 WorkContext 消费已实现不表示完整补料、暂停/换手或决定刷新回执已接通；准确实现状态见唯一模块状态。\n\n## 职责与连续范围'));
console.log(JSON.stringify(changed, null, 2));
