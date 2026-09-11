import {edit} from './edit.mjs';
edit('tests/context/query-execution-context.test.ts',s=>s.replace('s.compiler.request(s.request)','s.compiler.requestInitial(s.request)'));
edit('tests/contract-suite/p1-09-harness.ts',s=>s.replace(/(queryContext: QueryContextPort;[\s\S]*?)  queryContext: QueryContextPort;\r?\n/g,'$1'));
for(const file of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts'])edit(file,s=>s.replace(/^  \/\*\* bounded (work-context assembly|completed-work selection for a related new task)\. \*\/\r?\n/gm,''));
