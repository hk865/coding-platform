import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const product = process.cwd(), docs = resolve(product, '../agent_learn/agent_dev/agent_platform');
const evidence = resolve(product, 'evidence/2026-09-10-def17');
const digest = body => createHash('sha256').update(body).digest('hex');
const log = readFileSync(resolve(evidence, 'validate-docs-final.log'));
if (!/13\/13 checks passed/.test(log.toString()) || !/EXIT_CODE=0\s*$/.test(log.toString())) throw Error('Final documentation validation did not pass');
const acceptancePath = resolve(evidence, 'acceptance.md');
writeFileSync(acceptancePath, readFileSync(acceptancePath, 'utf8')
  .replace('最终状态编辑后另行核对（见最终文档日志） | [validate-docs-progress.log](validate-docs-progress.log)', 'exit 0；最终状态下13/13 | [validate-docs-final.log](validate-docs-final.log)'));
const paths = [
  ['docs','human/module-status.md'],
  ...['README.md','ERR-01-reviewer-recovery.md','ERR-02-test-trust.md','ERR-03-boundaries-doc-audit.md','DEF-17-reviewer-product-recovery.md','deferred-register.md'].map(p=>['docs','dev_docs/planning/active/external-review-repair/'+p]),
  ['docs','dev_docs/interfaces/independent-review.md'],
  ['docs','dev_docs/modules/control/verification-engine.md'],
  ['docs','dev_docs/verification/README.md'],
  ['docs','dev_docs/verification/2026-09-10-def17/acceptance.md'],
  ['docs','dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md'],
  ['docs','dev_docs/verification/2026-09-10-external-review-repair/independent-review.md'],
  ['product','IMPLEMENTATION-HANDOFF.md'],
  ['product','evidence/2026-09-10-external-review-repair/acceptance.md'],
  ['product','evidence/2026-09-10-external-review-repair/state-audit/acceptance.md'],
  ['product','evidence/2026-09-10-def17/acceptance.md'],
];
const files = paths.map(([root,path])=>({root,path,sha256:digest(readFileSync(resolve(root==='docs'?docs:product,path)))}));
writeFileSync(resolve(evidence,'final-document-sha256.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Final current state and directly relevant normative/review entries; separate from the 747-file source identity',fileCount:files.length,digest:digest(JSON.stringify(files)),files},null,2)+'\n');
const resultsPath=resolve(evidence,'verification-results.json'), results=JSON.parse(readFileSync(resultsPath,'utf8'));
results.docsFinalPending=false;
results.checks=results.checks.filter(item=>item.file!=='validate-docs-final.log');
results.checks.push({file:'validate-docs-final.log',command:log.toString().split('\n')[0],exitCode:0,passed:13,total:13,sha256:digest(log)});
results.independentReviewSha256=digest(readFileSync(resolve(evidence,'independent-review.md')));
writeFileSync(resultsPath,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({documentationChecks:'13/13',finalStateFiles:files.length,documentationDigest:digest(JSON.stringify(files)),docsFinalPending:false}));
