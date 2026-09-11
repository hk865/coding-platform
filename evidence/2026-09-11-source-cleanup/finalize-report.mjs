import fs from 'node:fs';
const f='evidence/2026-09-11-source-cleanup/verification.md';let s=fs.readFileSync(f,'utf8');
s=s.replace('| 完整构建及真实浏览器 | 验证进行中，结果只在完成后填写 |','| 完整构建及真实浏览器 | build.log exit 0；browser.log 26 项 PASS，真实 HTTP/SQLite/内核/工具及显式模型替身；最终 ui-artifacts.log exit 0，干净构建、旧资源替换、真实服务字节一致、单次构建生效全部通过 |');
s=s.replace('最终结果待填写','最终检查 323 个非 UI JS，stale=[]（build-artifacts-final.log）');
s=s.replace('| 文档 | 验证进行中，结果只在完成后填写 |','| 文档 | 首轮 docs.log 12/13，发现迁移后历史报告链接失效；仅同步链接并保存旧原文，docs-final.log 13/13 PASS。修改的 9 个产品说明文件另查 104 个本地链接，全部有效（source-docs.log） |');
s=s.replace('5. 盘点汇总','5. docs.log 的 12/13：校验器迁移后，一个既有 Reviewer 历史报告仍指旧源码路径。属于文档迁移遗漏，只改链接、不改历史结论，原报告保存到 history/docs，复验 13/13。\n6. 盘点汇总');
s=s.replace('## 下一步实现协调角色消费 FAIL 并调整计划','构建验证临时修改 src/ui/src/format.ts 后已逐字恢复；与起点 SHA256 一致，见 ui-probe-restoration.json。初次全仓执行时旧夹具仅追加一个时间戳 JSON 到上一目录（没有覆盖旧文件）；最终全仓及浏览器的记录全部进入本目录。测试/源码比对的补充读取和工具失败摘录见 tool-failure-excerpts.txt。\n\n独立复核的 4 类原发现、后续 6 处旧路径注释均已关闭；最后附带提醒的 src/testing/check-providers.double.ts 未来工具说明也已改为明确的确定性替身。最后变更均为注释，不改变已比对执行体；未再扩大独立审查范围。\n\n## 下一步实现协调角色消费 FAIL 并调整计划');
fs.writeFileSync(f,s);
