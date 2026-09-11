import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const product = process.cwd(), docs = resolve(product, '../agent_learn/agent_dev/agent_platform');
const evidence = resolve(product, 'evidence/2026-09-10-def17');
const read = p => readFileSync(p, 'utf8');
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const digest = body => createHash('sha256').update(body).digest('hex');
const snapshots = ['candidate', 'full-end', 'browser-end', 'final'].map(name => {
  const file = name + '-source-sha256.json', value = JSON.parse(read(resolve(evidence, file)));
  if (value.fileCount !== 747 || value.digest !== 'c399856b781f56862ae18af72bed80c2220aa26d9d3b144be87a6167cd6bac61' || digest(JSON.stringify(value.files)) !== value.digest) throw Error('Source identity drift: ' + file);
  for (const item of value.files) if (digest(readFileSync(resolve(product, item.path))) !== item.sha256) throw Error('Changed source: ' + item.path);
  return { file, fileCount: value.fileCount, digest: value.digest };
});
const checks = ['full-tests-final', 'browser-final', 'backend-types', 'ui-types', 'build', 'module-boundaries'].map(name => {
  const file = name + '.log', bytes = readFileSync(resolve(evidence, file)), text = strip(bytes.toString());
  if (!/EXIT_CODE=0\s*$/.test(text)) throw Error('Incomplete or failed validation: ' + file);
  if (name === 'full-tests-final' && (!/Test Files\s+256 passed \(256\)/.test(text) || !/Tests\s+1664 passed \(1664\)/.test(text))) throw Error('Unexpected full test count');
  if (name === 'browser-final' && !/25 passed/.test(text)) throw Error('Unexpected browser test count');
  return { file, command: text.split('\n')[0], exitCode: 0, sha256: digest(bytes) };
});
const edit = (root, file, fn) => { const path = resolve(root, file); writeFileSync(path, fn(read(path))); };
const report = read(resolve(evidence, 'independent-review.md'));
if (!report.includes('最终验证关联核对')) throw Error('Independent final verification has not been appended');
edit(product, 'evidence/2026-09-10-def17/acceptance.md', s => s
  .replace('状态：候选代码独立审查接受，最终全仓与完整浏览器验证待完成。', '状态：**原修复状态核对与 DEF-17 均按限定范围验收接受，当前委托已完成并停止。**')
  .replace('候选代码接受；最后全量日志与结束身份待审查者关联确认。', '候选代码、最终全量日志与结束身份均经独立关联核对接受，无未处置代码发现。')
  .replace('| 待最终完成 | [full-tests-final.log]', '| exit 0；256 文件 / 1664 项全部通过 | [full-tests-final.log]')
  .replace('| 待最终完成 | browser-final.log |', '| exit 0；25 项全部通过 | [browser-final.log](browser-final.log) |')
  .replace('当前 13/13；最终状态编辑后再核对', '最终状态编辑后另行核对（见最终文档日志）')
  .replace('## DEF-17 实现与场景', '开始候选、全仓结束、浏览器结束和最终源码四份清单摘要相同，均为747文件/c399…ac61，当前源码逐文件无漂移。结束清单为 [full-end](full-end-source-sha256.json)、[browser-end](browser-end-source-sha256.json)、[final](final-source-sha256.json)。日志命令、退出码和字节摘要见 [verification-results.json](verification-results.json)。最终计数从原1641增加23项：SA-01两项、DEF-17核心11项、HTTP八项、持久观察两项；浏览器从23增加两项。\n\n## DEF-17 实现与场景'));
edit(docs, 'dev_docs/planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md', s => s
  .replace('状态：implementing；', '状态：accepted（限定范围）；')
  .replace('待实施后追加实际日志、独立审查、最终源码身份与限定结论。第一阶段原批次身份和证据保持独立，不覆盖原清单。', '已按本票场景验收：最终747文件/c399…ac61；全仓256文件/1664项、浏览器25项、两套类型、构建、边界均通过，独立审查无未处置发现。完整日志、开始/结束身份、历史实例存在性与模型替身边界见[验收入口](../../../verification/2026-09-10-def17/acceptance.md)。第一阶段原批次身份和证据保持独立，不覆盖原清单；完成后停止，不启动其他核心功能。'));
for (const file of ['README.md', 'ERR-01-reviewer-recovery.md', 'ERR-02-test-trust.md', 'ERR-03-boundaries-doc-audit.md']) edit(docs, 'dev_docs/planning/active/external-review-repair/' + file, s => s.replace('本次新增施工与最终验证仅为[DEF-17](DEF-17-reviewer-product-recovery.md)。', '本次唯一新增票[DEF-17](DEF-17-reviewer-product-recovery.md)已另票验收，当前委托完成并停止；[最新验收](../../../verification/2026-09-10-def17/acceptance.md)。'));
edit(docs, 'dev_docs/planning/active/external-review-repair/README.md', s => s.replace('## 冻结与恢复入口', '## 原批执行规则（历史，已完成；不构成重新施工授权）'));
edit(docs, 'dev_docs/planning/active/external-review-repair/deferred-register.md', s => s
  .replace('状态：active。本页登记**本批明确不修**的项', '状态：active（DEF-01…16继续延期；DEF-17已另票验收）。本页登记**明确延期**的项')
  .replace('**登记为后续**：本批只修分类与受控重新受理的**可达性**（端口层，有测试）；把它暴露为产品入口属于新的操作者工作流，涉及授权与 UI，登记 DEF-17', '**原批延期，后续已修**：原批只修端口可达性；当前用户另行授权DEF-17，现已完成HTTP/UI显式授权、持久身份与回执及实际结果链，见下行和Ticket')
  .replace('原批延期；2026-09-10当前用户已明确授权，仅按DEF-17票实施，待验收。原风险：操作者仍须写代码才能修复卡住的审阅。后续验收条件：有明确授权条件的入口 + 不洗掉真实 FAIL + 不重复模型执行/接纳 + 针对性 HTTP 与 UI 回归', '**accepted（另票限定范围）**：可信持久未启动判据、HTTP/UI显式授权、幂等并发/丢响应/重启与实际Reviewer结果链均通过；旧unknown/缺证仍拒绝。原“须写代码才能恢复”的产品入口缺口已关闭；证据见[DEF-17验收](../../../verification/2026-09-10-def17/acceptance.md)'));
edit(docs, 'dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md', s => s
  .replace('当前授权后续仅[DEF-17](../../planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)。', '后续[DEF-17](../../planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)已另票验收，当前委托完成并停止。')
  .replace('当前DEF-17另票验证', 'DEF-17已另票验收（见[最新入口](../2026-09-10-def17/acceptance.md)）'));
edit(docs, 'dev_docs/verification/2026-09-10-def17/acceptance.md', s => s
  .replace('状态：最终验证中。', '状态：accepted（限定范围），当前委托完成并停止。')
  .replace('DEF-17候选为747文件', 'DEF-17最终为747文件')
  .replace('已完成实际HTTP/UI恢复链及专项验证，最终全仓/完整浏览器正在执行。', '已完成实际HTTP/UI恢复链和最终全仓、完整浏览器、类型、构建、边界验证；开始/结束源码身份一致，独立审查已核对接受。')
  .replace('历史无需迁移：', '历史存在性已另作只读核对：22个现存数据目录及21个SQLite Ledger未找到实际Reviewer实例，不能声称恢复过旧用户记录，具体旧反例身份及搜索边界见产品新批historical-recovery-audit.md。历史无需迁移：'));
edit(docs, 'dev_docs/verification/README.md', s => s
  .replace('当前仅补可证明未启动Reviewer失败的授权恢复；原修复状态复核、最终源码与验证入口', '原修复状态复核及DEF-17限定验收已完成；最终源码、实际验证与历史证据边界入口')
  .replace('当前修复批次的范围、分工、冻结与恢复入口（ERR-01/02/03）', '已验收修复批次的范围、冻结和历史恢复入口（ERR-01/02/03）'));
edit(product, 'evidence/2026-09-10-external-review-repair/state-audit/acceptance.md', s => s
  .replace('DEF-17产品恢复入口另票实施验收。', 'DEF-17产品恢复入口已另票完成[验收](../../2026-09-10-def17/acceptance.md)。')
  .replace('最终DEF-17将重新冻结源码并执行适用全仓、浏览器、类型、构建、边界及文档检查。', 'DEF-17已另行冻结747文件/c399…ac61并完成适用全仓、浏览器、类型、构建、边界及文档检查；原739清单不覆盖或替代。'));
edit(docs, 'human/module-status.md', s => s
  .replace('**当前授权：核对外审修复最终状态，仅补齐DEF-17已知启动前Reviewer失败的产品授权恢复；完成本批验收即停止，其余核心功能保持延期。**', '**当前状态：外审修复最终状态核对与DEF-17已知启动前Reviewer失败的产品授权恢复均按限定范围验收，当前委托完成并停止，其余核心功能保持延期。**')
  .replace('旧入口全文已保留于产品state-audit/history/docs。', '旧入口全文已保留于产品state-audit/history/docs。最新[DEF-17验收](../dev_docs/verification/2026-09-10-def17/acceptance.md)：747文件/c399…ac61，全仓256文件/1664项、浏览器25项、两套类型/构建/边界/文档检查及独立审查通过；源码开始/结束身份一致。')
  .replace('该批次完成后，旧的 VR-01/VR-02 验收项在**本批记录**中重新打开并由最终身份下的全仓/浏览器/类型/构建/边界/文档检查与独立审查重新收口', '原修复执行期间，旧的 VR-01/VR-02 验收项曾在**该批记录**中重新打开，现已结合最终身份、实际验证与有界独立补审收口')
  .replace('当前新增工作仅DEF-17，其余核心功能保持延期', '唯一增量DEF-17已验收并停止，其余核心功能保持延期')
  .replace('Reviewer全量与独立审计已通过；返工与OS强杀另待；stale不自动撤销旧Evidence', 'Reviewer及DEF-17产品授权恢复已限定验收；返工与OS强杀另待；stale不自动撤销旧Evidence')
  .replace('独立审阅协议、Work/Result及分组Evidence原子接纳，版本／权限／当前资格与CAS在本模块复核', '独立审阅协议、Work/Result及分组Evidence原子接纳，DEF-17原子替代复用受限端口，版本／权限／当前资格与CAS在本模块复核')
  .replace('两套视图共享Reviewer记录与当前资格解释，保留最后已提交归约及原租约', '两套视图共享Reviewer记录与当前资格解释，DEF-17替代Work初始化Reviewer运行行，保留最后已提交归约及原租约')
  .replace('Reviewer固定配置/预算、有界包与完整grant复核，当前接纳和历史报告读取分开', 'Reviewer固定配置/预算、有界包与完整grant复核，DEF-17从可信持久事实判定未启动资格，当前接纳和历史报告读取分开'));
edit(product, 'IMPLEMENTATION-HANDOFF.md', s => s
  .replace('原修复状态核对已完成，当前DEF-17最终验证中。', '原修复状态核对与DEF-17均已按限定范围验收，当前委托完成并停止。')
  .replace('当前用户授权：', '已完成的用户委托：')
  .replace('- [原批验收]', '- [DEF-17最终验收](evidence/2026-09-10-def17/acceptance.md)：747文件/c399…ac61，最终全仓256文件/1664项、浏览器25项及类型/构建/边界/文档检查通过；源码开始/结束身份一致，独立审查接受。真实HTTP/UI授权恢复完成正常Reviewer执行与Result/Evidence链，历史unknown/缺证继续拒绝。\n- [原批验收]')
  .replace('DEF-17单独受理，其余延期保留', 'DEF-17另票验收，其余延期保留')
  .replace('环境按仓库', '[历史记录核对](evidence/2026-09-10-def17/historical-recovery-audit.md)：有界搜索未找到实际旧Reviewer实例，未执行历史恢复；旧unknown测试反例仍必须拒绝，日志不能代替当前持久资格。\n\n环境按仓库'));
writeFileSync(resolve(evidence, 'verification-results.json'), JSON.stringify({createdAt:new Date().toISOString(), snapshots, checks, docsFinalPending:true, independentReviewSha256:digest(readFileSync(resolve(evidence, 'independent-review.md')))}, null, 2) + '\n');
console.log('Final states reconciled; run and record final documentation validation next.');
