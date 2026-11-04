import * as ts from 'typescript';

/**
 * Single-file TS/JS syntax facts (slice-8E2-SPEC W4, W10): pure, main thread, no program.
 *
 * One file's text is parsed once, by a language service that holds only that file and runs in
 * `LanguageServiceMode.Syntactic` (`noResolve`, `noLib`, ESNext): it never builds a program.
 * `sourceFile` is that service's own tree (`getNonBoundSourceFile`, the tree `getNavigationTree`
 * reads), so the navigation items, `fileSyntaxOf` and `namesInRanges` all read one parse. The
 * entry is not in `typescript.d.ts`: a TypeScript upgrade that removes it throws a TypeError at
 * once instead of answering differently. Lines and columns are one-based; columns count UTF-16
 * code units, the same as the capture's `location` (`typescript-source-query.ts`).
 */

export type LineRange = { startLine: number; endLine: number };
export type NavItemV1 = {
  name: string; kind: string;
  /** The enclosing navigation item's kind; top-level items have null. */
  parentKind: string | null;
  /** `nameSpan ?? spans[0]`: the name when the item has one, else the whole declaration (a constructor). */
  start: { line: number; column: number };
  end: { line: number; column: number };
  /** Every span of the item (overloads, merged declarations). */
  declarationRanges: LineRange[];
};
export type FileSyntaxV1 = {
  /** The file has an import or export (TypeScript's own external-module indicator). */
  isModule: boolean;
  /** Local names bound by imports, plus the names bound from `require(…)` and dynamic `import(…)`. */
  importNames: string[];
  /** Every declared or bound name in the file, `importNames` included. */
  boundNames: string[];
  /** The file has `declare global` or `declare module '…'`. */
  globalAugmented: boolean;
};
export type SyntaxTreeV1 = { readonly path: string; readonly sourceFile: ts.SourceFile;
  navigationItems(): NavItemV1[] };
export type NameUseV1 = 'free' | 'other';

type SyntacticService = ts.LanguageService & { getNonBoundSourceFile(fileName: string): ts.SourceFile };

const SYNTACTIC_OPTIONS: ts.CompilerOptions = Object.freeze({ noResolve: true, noLib: true, target: ts.ScriptTarget.ESNext, allowJs: true });

/** Parse one file's text once; the navigation tree comes from the same service without another parse. */
export function syntaxTreeOf(path: string, text: string): SyntaxTreeV1 {
  const snapshot = ts.ScriptSnapshot.fromString(text);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => SYNTACTIC_OPTIONS,
    getScriptFileNames: () => [path],
    getScriptVersion: () => '1',
    getScriptSnapshot: name => name === path ? snapshot : undefined,
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    fileExists: name => name === path,
    readFile: name => name === path ? text : undefined,
  };
  const service = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Syntactic) as SyntacticService;
  const sourceFile = service.getNonBoundSourceFile(path);
  let items: NavItemV1[] | undefined;
  return {
    path, sourceFile,
    navigationItems: () => {
      items ??= navigationItemsOfTree(service.getNavigationTree(path), sourceFile);
      return items.map(item => ({ ...item, start: { ...item.start }, end: { ...item.end },
        declarationRanges: item.declarationRanges.map(range => ({ ...range })) }));
    },
  };
}

/** The navigation items of one file; the capture's `symbols` and the first-tier read share this walk. */
export function navigationItemsOf(path: string, text: string): NavItemV1[] {
  return syntaxTreeOf(path, text).navigationItems();
}

/**
 * One visit of the navigation tree: position `nameSpan ?? spans[0]`, every span as a declaration
 * range. Positions go through the public `ts.getLineAndCharacterOfPosition` over the same text
 * (its line map is cached on `lines`), never through a program.
 */
function navigationItemsOfTree(root: ts.NavigationTree, lines: ts.SourceFileLike): NavItemV1[] {
  const out: NavItemV1[] = [];
  const at = (position: number) => {
    const { line, character } = ts.getLineAndCharacterOfPosition(lines, position);
    return { line: line + 1, column: character + 1 };
  };
  const visit = (item: ts.NavigationTree, parentKind: string | null) => {
    const span = item.nameSpan ?? item.spans[0];
    if (span) {
      out.push({ name: item.text, kind: item.kind, parentKind, start: at(span.start), end: at(span.start + span.length),
        declarationRanges: item.spans.map(entry => ({ startLine: at(entry.start).line, endLine: at(entry.start + entry.length).line })) });
    }
    item.childItems?.forEach(child => visit(child, item.kind));
  };
  root.childItems?.forEach(child => visit(child, null));
  return out;
}

/** The innermost call of `require(…)` or dynamic `import(…)` an initializer reads through. */
function moduleLoadOf(expression: ts.Expression | undefined): boolean {
  let current = expression;
  while (current !== undefined) {
    if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)
      || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
    else if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    else if (ts.isCallExpression(current)) {
      return current.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(current.expression) && current.expression.text === 'require');
    } else return false;
  }
  return false;
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) { out.push(name.text); return; }
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, out);
}

/** The declarations whose `name` binds or declares a name (members and enum members included). */
const declaresName = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
  || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isEnumMember(node)
  || ts.isModuleDeclaration(node) || ts.isTypeParameterDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)
  || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
  || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isImportEqualsDeclaration(node)
  || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportSpecifier(node) || ts.isLabeledStatement(node);

/** The file-level syntax facts the first tier judges with (R5); one walk over the shared tree. */
export function fileSyntaxOf(tree: SyntaxTreeV1): FileSyntaxV1 {
  const file = tree.sourceFile;
  const importNames: string[] = [], bound: string[] = [];
  let globalAugmented = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) importNames.push(clause.name.text);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) importNames.push(named.name.text);
      else if (named) for (const element of named.elements) importNames.push(element.name.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      importNames.push(node.name.text);
    } else if (ts.isVariableDeclaration(node) && moduleLoadOf(node.initializer)) {
      bindingNames(node.name, importNames);
    }
    if (ts.isModuleDeclaration(node) && (ts.isStringLiteral(node.name) || (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0)) globalAugmented = true;
    if (declaresName(node)) {
      const name = ts.isLabeledStatement(node) ? node.label : (node as { name?: ts.Node }).name;
      if (name !== undefined && ts.isIdentifier(name)) bound.push(name.text);
      else if (name !== undefined && (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))) bindingNames(name, bound);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { isModule: ts.isExternalModule(file), importNames: [...new Set(importNames)],
    boundNames: [...new Set([...importNames, ...bound])], globalAugmented };
}

/** Where an identifier is code that may resolve to a binding in scope (W4 `free`). */
function isFreeIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
    || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)
    || ts.isJsxAttribute(parent)) && parent.name === node) return false;
  // A destructured or imported member name and an export alias name a property of another
  // value, not a binding in scope: `{ authorize: local }`, `import { authorize as local }`,
  // `export { local as authorize }`.
  if ((ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) && parent.propertyName === node) return false;
  if (ts.isExportSpecifier(parent) && parent.propertyName !== undefined && parent.name === node) return false;
  for (let current: ts.Node = parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isImportTypeNode(current)) return false;
    if (ts.isExportDeclaration(current) && current.moduleSpecifier !== undefined) return false;
  }
  return true;
}

/**
 * W4: each name's occurrences inside the ranges (null = the whole file), found by word boundary in
 * the raw text; every occurrence counts once. An occurrence that is an identifier of code, not
 * after `.`/`?.`, not a property key, not the right side of a qualified name, not inside an
 * `import('…')` type and not inside `export … from`, is `free`; every other one (comments and
 * strings included) is `other`. `textual` is "at least one occurrence".
 */
export function namesInRanges(tree: SyntaxTreeV1, ranges: LineRange[] | null, names: readonly string[]):
  { name: string; textual: boolean; uses: NameUseV1[] }[] {
  const file = tree.sourceFile, text = file.text;
  const lineStarts = file.getLineStarts();
  const spans: [number, number][] = ranges === null ? [[0, text.length]] : ranges.flatMap(range => {
    const first = Math.max(1, range.startLine), last = Math.min(lineStarts.length, range.endLine);
    if (first > last) return [];
    return [[lineStarts[first - 1]!, last < lineStarts.length ? lineStarts[last]! : text.length] as [number, number]];
  });
  const identifiers = new Map<number, ts.Identifier>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.set(node.getStart(file), node);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const isPart = (code: number | undefined) => code !== undefined && ts.isIdentifierPart(code, ts.ScriptTarget.ESNext);
  // The code point that ends right before `at`: a surrogate pair counts as one character.
  const before = (at: number) => {
    const pair = text.codePointAt(at - 2);
    return pair !== undefined && pair > 0xFFFF ? pair : text.codePointAt(at - 1);
  };
  return names.map(name => {
    const seen = new Set<number>(), uses: NameUseV1[] = [];
    if (name.length > 0) for (const [from, to] of spans) {
      for (let at = text.indexOf(name, from); at >= 0 && at + name.length <= to; at = text.indexOf(name, at + 1)) {
        if (seen.has(at) || isPart(before(at)) || isPart(text.codePointAt(at + name.length))) continue;
        seen.add(at);
        const identifier = identifiers.get(at);
        uses.push(identifier !== undefined && identifier.text === name && isFreeIdentifier(identifier) ? 'free' : 'other');
      }
    }
    return { name, textual: uses.length > 0, uses };
  });
}
