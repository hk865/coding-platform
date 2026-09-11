import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const product = process.cwd();
const docs = resolve(product, '../agent_learn/agent_dev/agent_platform');
const history = resolve(product, 'evidence/2026-09-10-external-review-repair/state-audit/history');
function edit(root, relative, fn) {
  const path = resolve(root, relative), saved = resolve(history, root === product ? 'product' : 'docs', relative);
  mkdirSync(dirname(saved), { recursive: true });
  if (!existsSync(saved)) copyFileSync(path, saved);
  writeFileSync(path, fn(readFileSync(path, 'utf8')));
}
const note = '\n> 2026-09-10 最终状态复核：旧入口全文已保留于产品 `evidence/2026-09-10-external-review-repair/state-audit/history/`。旧数字与状态仅表示当时记录。原修复最终身份为739文件 / `5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364`，现有日志253文件/1641项、浏览器23项已核实。旧11b6身份的独立审查不能冒称覆盖后续全部修改；有界补审和必要补测见产品 `state-audit/`。本次新增施工仅为[DEF-17](DEF-17-reviewer-product-recovery.md)。\n';
for (const file of ['README.md','ERR-01-reviewer-recovery.md','ERR-02-test-trust.md','ERR-03-boundaries-doc-audit.md']) {
  edit(docs, 'dev_docs/planning/active/external-review-repair/' + file, s => s.replace(/状态：active[^。\n]*[。；]?/, '状态：原修复已实施，最终状态复核中。') .replace(/^(# .+\n)/, '$1' + note));
}
edit(product, 'evidence/2026-09-10-external-review-repair/acceptance.md', s => s
  .replace('状态：**已收口**（独立审查完成，其发现已逐项处置）。', '状态：**原修复已实施，当前正在补齐最终差异审查与必要覆盖**。原始已收口文字完整保存在 `state-audit/history/product/`，不得将旧独立报告直接视为后续修改的独立验收。')
  .replaceAll('当前 359 源文件 / 360 inventory / 0 issues', '最终原修复身份 362 源文件 / 363 inventory / 0 issues')
  .replace('HEAD 的 **27 个位置参数**', 'HEAD 的 **26 个位置参数**')
  .replace('95 行纯推导', '90 物理行 / 75 规范化行纯推导')
  .replace('它独立复算了最终清单摘要与全仓/浏览器结论', '它独立复算的是较早 `11b6…00e6` 清单；全仓/浏览器结论来自既有日志，未由原审查者重跑')
  .replace('E-1 已闭合（不是保留缺口）', 'E-1 恢复字节与历史清单匹配；历史来源时间不可独立证明')
  .replace('原始 19161 字节从悬空 git blob', '恢复的 19161 字节从悬空 git blob')
  .replace('证明 2026-09-09 的改动是**加强**而非削弱该测试', '证明恢复字节到所留后态的 diff 是**加强**而非削弱该测试；Git blob 无时间戳，历史哈希清单未跟踪，不能独立证明这些字节在2026-09-09的产生时间')
  .replace('曾要求 `oldRun.outcome !== \'failed\'` 即拒', '据保留失败日志记述，曾要求 `oldRun.outcome !== \'failed\'` 即拒（修复前字节缺失，该原条件不可独立证实）'));
edit(docs, 'dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md', s => s
  .replace(/^(# .+\n)/, '$1\n当前核对：原修复最终739文件、5a9e…0364已逐文件一致；原独立审查身份是11b6…00e6。补审范围与必要补测记录在产品 `evidence/2026-09-10-external-review-repair/state-audit/`。当前授权后续仅[DEF-17](../../planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)。旧全文已保留于同目录history/docs。\n')
  .replaceAll('11b6e71b75a221437a3b82dc79da76ce57a188b373804b1941ee6936898f00e6', '5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364')
  .replace('**新增 9、修改 56、删除 0**', '**新增 12、修改 57、删除 3**（删除均为被重建替换的workbench哈希命名产物；历史恢复7/7是重建前记录）')
  .replace('359 源文件 / 360 inventory', '362 源文件 / 363 inventory')
  .replace('2.9min', '3.7min').replace('253 文件 / 1640 项', '253 文件 / 1641 项')
  .replace('R-5 `buildHarness` 27 个位置参数', 'R-5 `buildHarness` 26 个位置参数（options 27字段）')
  .replace('95 行纯推导', '90 物理行 / 75 规范化行纯推导')
  .replace('DEF-01…DEF-16', 'DEF-01…DEF-17')
  .replace('**已闭合** | 原始 19161 字节', '**字节匹配，历史产生时间不可证** | 恢复19161字节'));
edit(docs, 'dev_docs/planning/active/external-review-repair/deferred-register.md', s => s
  .replace('两侧 95 行规范化后逐字相同', '两侧90物理行 / 75规范化行逐字相同')
  .replace('1633 − 2 + 8 + 1 = 1640', '1633 − 2 + 9 + 1 = 1641（含REV-01新增用例，实际分支覆盖不足由当前state-audit补测）')
  .replace('| DEF-17 | 把受控重新受理', '| DEF-17 | [已授权Ticket](DEF-17-reviewer-product-recovery.md)：把受控重新受理')
  .replace('属新的操作者工作流（授权、UI、HTTP 路由），不在本批范围；风险：', '原批延期；2026-09-10当前用户已明确授权，仅按DEF-17票实施，待验收。原风险：'));
edit(docs, 'human/module-status.md', s => s
  .replace(/\*\*用户已明确本轮范围：[^\n]+/, '**当前授权：核对外审修复最终状态，仅补齐DEF-17已知启动前Reviewer失败的产品授权恢复；完成本批验收即停止，其余核心功能保持延期。** [DEF-17票](../dev_docs/planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)。旧入口全文已保留于产品state-audit/history/docs。')
  .replace('2026-09-10 外部独立审查发现的缺陷正在按', '2026-09-10 原修复已实施，739文件5a9e…0364与实际源码逐文件一致，现有253/1641及浏览器23项日志已核实；较早独立报告后的差异与必要补测正在核对。范围与处置按')
  .replace('2026-09-10 外部独立审查发现的问题正由', '2026-09-10外审修复已实施，最终状态复核由')
  .replace('其余核心功能待用户审查后动工，顺序见', '当前新增工作仅DEF-17，其余核心功能保持延期，原顺序见'));
edit(product, 'IMPLEMENTATION-HANDOFF.md', () => `# Agent Platform 当前交接

更新：2026-09-10。产品根 D:/1.project/Software/agent_platform；权威文档根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

当前用户授权：核对外部审查修复批次最终状态，补齐DEF-17可证明未启动Reviewer失败的产品授权恢复；完成验收后停止。其他核心功能不动工。

- [工作包](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/external-review-repair/README.md)、[DEF-17 Ticket及验收场景](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)。
- [唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)、[独立Reviewer Interface](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/independent-review.md)。
- [原批验收](evidence/2026-09-10-external-review-repair/acceptance.md)：原修复已实施，739文件5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364已逐文件一致；既有全仓253文件/1641项、浏览器23项日志已核实。
- [最终状态补审目录](evidence/2026-09-10-external-review-repair/state-audit/)：旧独立报告审查11b6…00e6，完整旧清单未找到，按REV列表进行有界复核；REV-01原新增用例未覆盖所声称runtime.start catch，正在补必要专项验证。不得沿旧“环境故障、修复未完成”交接重做全部修复。
- [延期登记](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/external-review-repair/deferred-register.md)：DEF-17单独受理，其余延期保留。E-1恢复19161字节匹配历史哈希，但blob无时间戳、清单未跟踪，历史产生时间不可独立证明。

环境按仓库package.json与scripts/test-wsl.sh核实。已确认WSL Node24.18；工具沙箱内WSL服务E_ACCESSDENIED，经审批执行可用。真实模型语义、任意OS强杀、Windows原生与整个产品完成不由本批测试证明。

保留全部未提交修改和历史证据。不reset/clean/stash/commit/push，不改vendor，不重跑一次性迁移脚本，不新增累计预算。src/app/public/workbench是源码模式必需运行依赖，保留并与最终构建同步。

旧交接全文与旧数字见[整理前原文](evidence/2026-09-10-external-review-repair/state-audit/history/product/IMPLEMENTATION-HANDOFF.md)，仅供历史追溯。
`);
edit(docs, 'dev_docs/interfaces/independent-review.md', s => s.replace('12 Module/35边', '12 Module/34边'));
console.log('Current entry documents updated; original bytes preserved in ' + history);
