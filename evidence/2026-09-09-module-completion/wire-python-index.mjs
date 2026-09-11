import fs from 'node:fs';
for (const file of ['src/runtime/coding-agent-runtime.ts', 'tests/app/exploration-runtime.test.ts', 'tests/app/explorations.test.ts', 'tests/app/runtime-context.test.ts']) {
  let text = fs.readFileSync(file, 'utf8');
  if (file.startsWith('src/')) text = text.replaceAll("'project_index', 'source_excerpt'", "'project_index', 'python_index', 'source_excerpt'");
  else {
    text = text.replaceAll("['code_index', 'list_files', 'read', 'search', 'source_excerpt', 'symbols']", "['code_index', 'list_files', 'project_index', 'python_index', 'read', 'search', 'source_excerpt', 'symbols']");
    text = text.replaceAll("['code_index','list_files','read','search','source_excerpt','symbols']", "['code_index','list_files','project_index','python_index','read','search','source_excerpt','symbols']");
  }
  fs.writeFileSync(file, text);
}
