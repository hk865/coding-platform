import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';

// Formatting-only pass over this lane's new source files. Never traverses shared modules.
const paths = [
  'src/contracts/exploration-session.ts',
  'src/interaction/exploration-session.ts',
  'src/context/exploration-session-context.ts',
  'src/control/exploration-startup-reconciliation.ts',
  'src/verification/exploration-report-verifier.ts',
  'src/contracts/verification-context.ts',
  'src/contracts/verification-service.ts',
  'src/context/verification-context.ts',
  'src/context/verification-migration-context.ts',
  'src/data/candidate-workspace-reader.ts',
  'src/verification/candidate-patch-check.ts',
  'src/verification/verification-service.ts',
  'src/verification/command-check-lifecycle.ts',
  'src/verification/benchmark-verification.ts',
  'src/verification/verification-journal.ts',
  'src/verification/verification-reports.ts',
  'src/verification/verification-input.ts',
  'src/verification/verification-plan-compiler.ts',
  'tests/interaction/exploration-session.test.ts',
];
for (const path of paths) {
  let source = await readFile(path, 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw Error('Refuse formatting an invalid file: ' + path);
  const breaks = new Set();
  function expand(node) {
    let items = [];
    if (ts.isObjectLiteralExpression(node) && node.end - node.pos > 100) items = node.properties;
    if (ts.isArrayLiteralExpression(node) && node.end - node.pos > 120 && node.elements.length > 2) items = node.elements;
    if (ts.isCallExpression(node) && node.end - node.pos > 180 && node.arguments.length > 1) items = node.arguments;
    if (ts.isBlock(node) && node.statements.length) items = node.statements;
    if (items.length) {
      for (const item of items) breaks.add(item.getStart(file));
      breaks.add(node.end - 1);
    }
    if (ts.isVariableDeclarationList(node) && node.declarations.length > 1) {
      for (const declaration of node.declarations.slice(1)) breaks.add(declaration.getStart(file));
    }
    ts.forEachChild(node, expand);
  }
  expand(file);
  for (const position of [...breaks].sort((a, b) => b - a)) {
    if (!source.slice(source.lastIndexOf('\n', position - 1) + 1, position).trim()) continue;
    source = source.slice(0, position) + '\n' + source.slice(position);
  }
  const host = {
    getCompilationSettings: () => ({}), getScriptFileNames: () => [path], getScriptVersion: () => '1',
    getScriptSnapshot: name => name === path ? ts.ScriptSnapshot.fromString(source) : undefined,
    getCurrentDirectory: () => process.cwd(), getDefaultLibFileName: () => '',
    fileExists: () => false, readFile: () => undefined,
  };
  const service = ts.createLanguageService(host);
  const edits = service.getFormattingEditsForDocument(path, {
    indentSize: 2, tabSize: 2, convertTabsToSpaces: true, newLineCharacter: '\n',
    insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true,
    insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true,
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
  });
  for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) {
    source = source.slice(0, edit.span.start) + edit.newText + source.slice(edit.span.start + edit.span.length);
  }
  service.dispose();
  await writeFile(path, source);
}
