const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
for (const name of ['read-model-index', 'sqlite-read-model-index']) {
  const file = `src/data/read-model-index/${name}.ts`;
  let source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(ts.isClassDeclaration).members.find(member => member.name?.getText(ast) === 'isHandledEventType');
  if (!declaration) throw new Error(`No isHandledEventType in ${file}`);
  const replacement = `\n  private isHandledEventType(eventType: string): boolean {\n    return readModelHandlesEvent(eventType);\n  }`;
  source = source.slice(0, declaration.getFullStart()) + replacement + source.slice(declaration.end);
  if (!source.includes("from './handled-event-types.js'")) source = `import { readModelHandlesEvent } from './handled-event-types.js';\n${source}`;
  fs.writeFileSync(file, source);
}
