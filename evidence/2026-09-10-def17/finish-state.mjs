import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const product = process.cwd(), docs = resolve(product, '../agent_learn/agent_dev/agent_platform');
const edit = (root, path, fn) => { const full = resolve(root, path); writeFileSync(full, fn(readFileSync(full, 'utf8'))); };
for (const file of ['README.md','ERR-01-reviewer-recovery.md','ERR-02-test-trust.md','ERR-03-boundaries-doc-audit.md']) edit(docs, 'dev_docs/planning/active/external-review-repair/' + file, s => s
  .replace('状态：原修复已实施，最终状态复核中。', '状态：原修复限定范围已验收；2026-09-10最终状态复核及三项必要补证已独立通过。')
  .replace('本次新增施工仅为', '本次新增施工与最终验证仅为'));
edit(product, 'evidence/2026-09-10-external-review-repair/acceptance.md', s => s
  .replaceAll('../../../dev_docs/', '../../../agent_learn/agent_dev/agent_platform/dev_docs/')
  .replace('430 项未提交修改全部保留', '当时记录的430项未提交修改保留（历史计数，不代表当前git状态项数）')
  .replace('+ 8（Reviewer', '+ 9（Reviewer').replace(' + 8 + 1', ' + 9 + 1')
  .replace('测试字节快照：`test-snapshots/{before,after,diff}` 覆盖本批改动的 6 个测试文件与 16 个 restart fixture', '测试字节快照：`test-snapshots/{before,after,diff}` 覆盖原先冻结的6个测试文件与16个restart fixture；其余5个文件未冻结完整before/diff，见COVERAGE-NOTE及独立报告历史blob比对结论')
  .replace('**已补** `test-snapshots/`；独立审查另行比对确认无削弱', '**部分冻结**：COVERAGE-NOTE说明缺失before字节，仅补修后状态；原独立审查另行从blob比对的“无削弱”结论保留为历史审查证据')
  .replace('补 `tests/control/reviewer-lease-conflict-recovery.test.ts` 第二个用例', '原第二例实际只覆盖材料守卫；本次以 `tests/control/reviewer-runtime-start-rejection.test.ts` 补齐真实start catch及unknown对照，见state-audit')
  .replace('**已补**：`r4-probe-fault-injection/`（修复后 FAIL、修复前 SKIP、哨兵仍 SKIP 三向证据）', '**补证已核对**：原产物证明修复后FAIL和哨兵SKIP；修复前SKIP在本次 `state-audit/r4-prefix-skip.log` 单独证明（原顶层throw导致旧测试未注册）')
  .replace('**登记为 DEF-17**（属新的操作者工作流，不在本批范围）', '**原批延期为DEF-17，现已另票获授权**；结果见新批 `../2026-09-10-def17/acceptance.md`'));
edit(docs, 'dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md', s => s
  .replace('本批实现与验证已完成，等待独立审查复核后收口', '原批已按限定范围接受；本次独立状态复核及SA-01…03补证已完成，当前DEF-17另票验证')
  .replace('Reviewer 恢复 1、unknown 保持 1、就绪探针 5、替身 selection 1', 'Reviewer恢复原2项（其中start catch原覆盖声明不足，本次另补2项）、unknown保持1、就绪探针5、替身selection1及CodeGraph的+1')
  .replace('只读核对修复', '只读核对修复'));
edit(docs, 'dev_docs/planning/active/external-review-repair/deferred-register.md', s => s
  .replace('**已补**：新增 `test-snapshots/` 缺失文件的 before/after/diff；独立审查另行从悬空 git blob 恢复并比对了未快照文件，确认**无一处削弱**', '**有限补充**：缺失文件没有完整before/diff快照，COVERAGE-NOTE明示仅补修后状态；原独立审查从blob恢复比对5个文件的结论保留为历史证据，不能改称快照已全部补齐')
  .replace('断言 canonical Run 为 `ended/crashed`、恰好一条 `run_crashed` 终止事件、trace/usage 为空、模型 0 次调用', '原第二例实际在材料守卫拒绝；真实start catch及无法证明未启动的对照已由本次state-audit新测试补齐')
  .replace('本批补做注入并落盘 `evidence/.../r4-probe-fault-injection/`；独立审查另行独立复现（修复后 FAIL、修复前 SKIP）', '原产物证明修复后FAIL及哨兵SKIP；修复前SKIP本次单独补证于state-audit/r4-prefix-skip.log，原同次旧分支未注册的边界明确保留'));
edit(docs, 'human/module-status.md', s => s.replace('较早独立报告后的差异与必要补测正在核对', '较早独立报告后的有界补审与SA-01…03必要补证已独立通过，原批限定范围接受'));
edit(product, 'IMPLEMENTATION-HANDOFF.md', s => s
  .replace('正在补必要专项验证', '已补必要专项验证并通过独立补审，原批限定范围接受')
  .replace('当前用户授权：', '原修复状态核对已完成，当前DEF-17最终验证中。\n\n当前用户授权：'));
console.log('Original batch entries reconciled; DEF-17 final result remains pending.');
