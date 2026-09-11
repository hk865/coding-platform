import fs from 'node:fs';
const path = 'src/runtime/coding-agent-runtime.ts';
const before = fs.readFileSync(path, 'utf8');
const anchor = "'symbols', 'code_index', 'source_excerpt'";
if (before.split(anchor).length !== 3) throw Error('unexpected tool configuration');
fs.writeFileSync(path, before.replaceAll(anchor, "'symbols', 'code_index', 'project_index', 'source_excerpt'"));
