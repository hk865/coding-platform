# mk-baseline.sh: the full Vitest JSON report of baseline-full.sh -> _common/baseline-full.json (the checkers' baseline).
# 2026-10-07 (task D prepare): the note is computed from the report and the base commit instead of the fixed bfb6075
# sentence; the bfb6075 version is kept in the scratchpad taskd/prepare/old-bfb6075/.
. "$(dirname "$0")/env.sh"
BASE_SUBJECT=$(git -C ~/dsh-work/base log -1 --format=%s) node -e '
const r=require(process.env.HOME+"/dsh-work/ladder/_full-baseline.json");
const tests=r.testResults.flatMap(f=>f.assertionResults);
const failing=tests.filter(a=>a.status==="failed").length;
const failedFiles=r.testResults.filter(f=>f.status==="failed").length;
const out={note:`vitest JSON report of a freshly set-up copy of base (${process.env.BASE_SUBJECT} + vendor zod/openai), full suite, WSL, --maxWorkers=4, ${new Date().toISOString().slice(0,10)}; ${r.testResults.length} test files, ${tests.length} tests, ${failing} failing in ${failedFiles} files (check sandbox unavailable)`,
 testResults:r.testResults.map(f=>({name:f.name,status:f.status,message:f.message||"",assertionResults:f.assertionResults.map(a=>({fullName:a.fullName,status:a.status}))}))};
const s=JSON.stringify(out);
require("fs").writeFileSync(process.env.TOOLS+"/../_common/baseline-full.json",s);
console.log(s.length, out.note);'
