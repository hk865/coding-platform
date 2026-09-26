# B2 Kernel 既有完整性validator公开导出：第二阶段

主审已完成中审，见 docs/refactor/reviews/next-b2-c1-middle-review-2026-09-26.md。第一阶段已生成stub产物；next-types通过，公开测试10项中9项因unsupported或非StoreError而红，1项原公共面保留绿。测试已冻结，仅允许改同名scope的 vendor/coding-agent/patches/public-api.ts。

立即执行唯一生产变更：删除第一阶段末尾新增的TranscriptEntry type import及assertTranscriptExchangeIntegrity unsupported函数，替换为既有函数纯re-export：
export { assertTranscriptExchangeIntegrity } from './core/ports/session_store/session-history.js';

保留前190行来源全文不变。不能复制validator、改变私有算法、导出额外符号、改dist/构建脚本/测试。只用Python/Node原地写现有文件，不用rename，不需权限升级。不重新研究整批架构或运行模型。运行 scripts/build-kernel-patch.mjs --check：它临时编译成功即可，public-api产物预期未发布而不匹配；SQLite必须全MATCH。主审后续生成dist、复验公开测试与历史回归。报告最小源diff/摘要与构建结果，完成即停。
