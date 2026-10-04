/**
 * Production reach analysis (rule of 2026-10-04): code that no production
 * path reaches must not stay in `src/`.
 *
 * Production entry points, read from the repository itself:
 *
 * - the workbench CLI `src/app/main.ts` (`node dist/app/main.js <config>`,
 *   README and `WORKBENCH_CLI_USAGE`): only its top-level statements run;
 * - `package.json` `bin` (top-level statements) and `main`/`exports` (every
 *   export), mapped from `dist/<path>.js` to `src/<path>.ts` (none today);
 * - the browser bundles of `scripts/build-workbench.mjs` (`const entries`,
 *   `src/ui/<name>.ts`): only top-level statements run, because nothing
 *   imports a bundle's exports (`index.html` loads `main.js`; `views.js` is
 *   published but loaded by no page);
 * - every `src` module a `scripts/*.mjs` file loads from `dist/` (a static
 *   `import { … } from '../dist/<path>.js'` or a `{ … } = await
 *   import('./dist/<path>.js')` in a `node -e` string): the named exports.
 *   Any other `dist/<path>.js` text in a script is refused, so a new loading
 *   form cannot go unnoticed.
 *
 * Not entry points: `scripts/build-kernel-patch.mjs` compiles
 * `vendor/coding-agent/patches` only; `scripts/check-boundaries.mjs` and
 * `scripts/import-graph*.mjs` read `src/` as text; the Python analyzers under
 * `scripts/` are run by `src/core/workspace` and import no `src` module;
 * `runtime-assets.json` lists data files only; nothing in `src/` loads a module
 * by a computed or configured name.
 *
 * Nodes are the top-level declarations of every `src/` file (functions,
 * classes, interfaces, type aliases, enums, namespaces, each variable name),
 * the members of top-level classes, and the members of the operation
 * surfaces: every interface or type alias whose name ends in `Port`, and the
 * declared return type of every `create*Service` factory (for an alias, the
 * members of the type literals it is made of). `src/ui/` is analysed with
 * `tsconfig.ui.json`, the rest with `tsconfig.json`; a node is identified by
 * file and name (`Type.member` for a member), so both Programs agree on it.
 *
 * Edges are identifier references resolved by the checker, through import
 * aliases and re-exports; a type-only reference is a reference, while an
 * import that is never used and the name a declaration introduces are not
 * (a reached interface does not use its own members). A reached file's
 * top-level statements (anything that is not a declaration, an import or an
 * export) are reached code, and a reached file evaluates the files it
 * value-imports or re-exports from (ESM evaluation), so their top-level
 * statements are reached too.
 *
 * Code is walked only when it can run or is named by reached code:
 * - a function declared inside another function (or a local `const` holding a
 *   function or arrow) is walked when reached code references it;
 * - an object-literal property whose contextual property is a surface member
 *   (a service factory's returned operations, a port built in place) is walked
 *   only when that member is reached: implementing an operation is not
 *   calling it.
 *
 * A surface member is an operation: it is reached when reached code reads it
 * (a property access, an element access with a literal key, destructuring), or
 * when a type that names the same member is read and the surface is assignable
 * to that type (the value may flow there). An indexed access type `Port['m']`
 * reaches the types in the member's signature, not the member.
 *
 * A class member is reached when its class is reached and one of these holds
 * (conservative: prefer reached over a false "unreached"):
 * - reached code references the member itself;
 * - reached code reads a same-named member of another type (an interface, a
 *   type literal or a class) and the class is assignable to that type;
 * - an implemented or extended type has the same-named member and that member
 *   is declared outside `src/` or is a reached member node;
 * - reached code reads a property of that name on an `any`/`unknown` value or
 *   one whose symbol does not resolve;
 * - it is the constructor, has a computed name, or is a name the language calls
 *   implicitly (`toString`, `toJSON`, `valueOf`, `then`).
 * A member of an unreached class or surface is not reported on its own: its
 * owner covers it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type ReachNodeKind = 'function' | 'class' | 'member' | 'interface' | 'type' | 'enum' | 'namespace' | 'variable';

export type ReachNode = {
  /** Path relative to the project root. */
  file: string;
  /** The top-level name, or `Owner.member` for a member of a class or surface. */
  name: string;
  kind: ReachNodeKind;
  /** 1-based line of the first declaration. */
  line: number;
  /** Source lines of every declaration of the node, leading JSDoc included. */
  lines: number;
};

export type ProductionEntry = {
  file: string;
  /** `none`: only the file's top-level statements run; `all`: every export; or the named exports a loader imports. */
  exports: 'none' | 'all' | readonly string[];
  via: string;
};

export type ReachReport = {
  entries: ProductionEntry[];
  files: number;
  nodes: number;
  /** The operation surfaces whose members are nodes (`file#Type`), sorted. */
  surfaces: string[];
  /** Sorted by file and line. */
  unreached: ReachNode[];
  elapsedMs: number;
};

const CLI_ENTRY = 'src/app/main.ts';
const UI_DIRECTORY = 'src/ui/';
const PORT_NAME = /Port$/;
const SERVICE_FACTORY = /^create\w*Service$/;
const IMPLICIT_MEMBERS = new Set(['constructor', 'toString', 'toJSON', 'valueOf', 'then']);
const MEMBER_FLAGS = ts.SymbolFlags.Property | ts.SymbolFlags.Method | ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor;

const DIST_IMPORT = /(?:import\s*\{([^}]*)\}\s*from\s*|\{([^}]*)\}\s*=\s*await\s+import\(\s*)'\.{1,2}\/dist\/([\w./-]+)\.js'/g;
/** The project's own `dist/` (not `vendor/coding-agent/dist/`). */
const DIST_MENTION = /(?<![\w/.-])(?:\.{1,2}\/)?dist\/[\w./-]+\.js/g;

function namesOf(list: string): string[] {
  return list.split(',').map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim())
    .filter(name => name.length > 0);
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf);
  return [];
}

/** `dist/<path>.js` (optionally `./`-prefixed) → `src/<path>.ts`. */
function sourceOfBuilt(path: string): string | undefined {
  const match = /^(?:\.\/)?dist\/([\w./-]+)\.js$/.exec(path);
  return match ? `src/${match[1]}.ts` : undefined;
}

/** The production entry points of the project at `root` (see the file header). */
export function productionEntries(root: string): ProductionEntry[] {
  const entries: ProductionEntry[] = [{ file: CLI_ENTRY, exports: 'none', via: 'workbench CLI: node dist/app/main.js <config> (README, WORKBENCH_CLI_USAGE)' }];
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
  for (const field of ['bin', 'main', 'exports'] as const) {
    for (const target of stringsOf(manifest[field])) {
      const file = sourceOfBuilt(target);
      if (file === undefined) throw new Error(`package.json ${field} names ${target}, which is not a dist/*.js file built from src/`);
      entries.push({ file, exports: field === 'bin' ? 'none' : 'all', via: `package.json ${field}` });
    }
  }
  const scripts = join(root, 'scripts');
  const build = readFileSync(join(scripts, 'build-workbench.mjs'), 'utf8');
  const bundles = /const entries = \[([^\]]*)\]/.exec(build);
  if (bundles === null) throw new Error('scripts/build-workbench.mjs no longer declares `const entries = [...]`; update the reach analysis');
  for (const name of bundles[1]!.matchAll(/'([^']+)'/g))
    entries.push({ file: `${UI_DIRECTORY}${name[1]}.ts`, exports: 'none', via: 'browser bundle of scripts/build-workbench.mjs' });
  for (const script of readdirSync(scripts).filter(name => name.endsWith('.mjs')).sort()) {
    const text = readFileSync(join(scripts, script), 'utf8');
    let covered = 0;
    for (const match of text.matchAll(DIST_IMPORT)) {
      covered += 1;
      entries.push({ file: `src/${match[3]}.ts`, exports: namesOf(match[1] ?? match[2] ?? ''), via: `scripts/${script}` });
    }
    const mentions = [...text.matchAll(DIST_MENTION)].length;
    if (mentions !== covered)
      throw new Error(`scripts/${script} names a dist/*.js file in a form the reach analysis does not read; extend DIST_IMPORT`);
  }
  for (const entry of entries)
    if (!existsSync(join(root, entry.file))) throw new Error(`production entry ${entry.file} (${entry.via}) does not exist`);
  return entries;
}

function createSourceProgram(root: string, config: string, include: (file: string) => boolean): ts.Program {
  const configPath = join(root, config);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  const rootNames = parsed.fileNames.filter(name => include(relative(root, name).split(sep).join('/')));
  return ts.createProgram({ rootNames, options: { ...parsed.options, noEmit: true } });
}

type OwnerDeclaration = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

type Unit = {
  key: string;
  node: ReachNode;
  checker: ts.TypeChecker;
  /** The nodes whose references are this unit's edges. */
  bodies: ts.Node[];
  /** Members only: the owning class or surface. */
  member?: { ownerKey: string; name: string; owner: OwnerDeclaration; isStatic: boolean; computed: boolean };
};

type FileInfo = {
  checker: ts.TypeChecker;
  /** Top-level statements that are neither declarations nor imports/exports. */
  statements: ts.Statement[];
  /** Module specifiers the file evaluates (value imports and re-exports). */
  evaluates: ts.Expression[];
};

type NamedMember = ts.ClassElement | ts.TypeElement;

function memberNameOf(element: NamedMember): { name: string; computed: boolean } {
  if (ts.isConstructorDeclaration(element)) return { name: 'constructor', computed: false };
  const name = element.name;
  if (name === undefined) return { name: '(anonymous)', computed: true };
  if (ts.isComputedPropertyName(name)) return { name: `[${name.expression.getText()}]`, computed: true };
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return { name: name.text, computed: false };
  return { name: name.getText(), computed: true };
}

/** A property name as the checker keys it, or `undefined` for a computed or private name. */
function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text;
  return undefined;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

/** A top-level declaration statement other than a variable statement: its node name, kind and name node. */
function statementName(statement: ts.Node): { name: string; kind: ReachNodeKind; nameNode: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    return { name: statement.name?.text ?? 'default', kind: ts.isClassDeclaration(statement) ? 'class' : 'function',
      nameNode: statement.name ?? statement };
  if (ts.isInterfaceDeclaration(statement)) return { name: statement.name.text, kind: 'interface', nameNode: statement.name };
  if (ts.isTypeAliasDeclaration(statement)) return { name: statement.name.text, kind: 'type', nameNode: statement.name };
  if (ts.isEnumDeclaration(statement)) return { name: statement.name.text, kind: 'enum', nameNode: statement.name };
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)
    && (statement.flags & ts.NodeFlags.GlobalAugmentation) === 0)
    return { name: statement.name.text, kind: 'namespace', nameNode: statement.name };
  if (ts.isExportAssignment(statement)) return { name: 'default', kind: 'variable', nameNode: statement };
  return undefined;
}

/** The type literals an alias is made of (through parentheses, intersections and unions). */
function aliasLiterals(type: ts.TypeNode): ts.TypeLiteralNode[] {
  if (ts.isParenthesizedTypeNode(type)) return aliasLiterals(type.type);
  if (ts.isTypeLiteralNode(type)) return [type];
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap(aliasLiterals);
  return [];
}

/** The type references an annotation is made of (through parentheses, intersections and unions). */
function annotationReferences(type: ts.TypeNode): ts.TypeReferenceNode[] {
  if (ts.isParenthesizedTypeNode(type)) return annotationReferences(type.type);
  if (ts.isTypeReferenceNode(type)) return [type];
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap(annotationReferences);
  return [];
}

/** The named members of a surface declaration (its own, or those of the alias's type literals). */
function surfaceMembers(declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): ts.TypeElement[] {
  const elements = ts.isInterfaceDeclaration(declaration) ? [...declaration.members]
    : aliasLiterals(declaration.type).flatMap(literal => [...literal.members]);
  return elements.filter(element => (ts.isPropertySignature(element) || ts.isMethodSignature(element)
    || ts.isGetAccessorDeclaration(element) || ts.isSetAccessorDeclaration(element)));
}

function lineCount(sourceFile: ts.SourceFile, node: ts.Node, withJsDoc: boolean): number {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, withJsDoc)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
  return end - start + 1;
}

/** A function declared inside another body, or a local `const` holding a function: walked when referenced. */
function isLocalFunction(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return !ts.isSourceFile(node.parent);
  return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    && !ts.isSourceFile(node.parent.parent.parent);
}

/** The type parts of a member declaration: what an indexed access type `T['m']` names. */
function signatureParts(declaration: ts.Declaration): ts.Node[] {
  if (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration))
    return declaration.type === undefined ? [] : [declaration.type];
  if (ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration)
    || ts.isSetAccessorDeclaration(declaration))
    return [...(declaration.typeParameters ?? []), ...declaration.parameters.flatMap(parameter => parameter.type ?? []),
      ...(declaration.type === undefined ? [] : [declaration.type])];
  return [];
}

/** Analyse the project at `root` (the real tree, or a test fixture of the same layout). */
export function analyzeProductionReach(root: string): ReachReport {
  const started = performance.now();
  const projectRoot = resolve(root);
  const relativePath = (fileName: string) => relative(projectRoot, fileName).split(sep).join('/');
  const entries = productionEntries(projectRoot);
  const mainProgram = createSourceProgram(projectRoot, 'tsconfig.json', file => file.startsWith('src/') && !file.startsWith(UI_DIRECTORY));
  const uiProgram = createSourceProgram(projectRoot, 'tsconfig.ui.json', file => file.startsWith(UI_DIRECTORY));
  const ownSourceFiles = (program: ts.Program, own: (file: string) => boolean) => program.getSourceFiles()
    .filter(sourceFile => !sourceFile.isDeclarationFile && own(relativePath(sourceFile.fileName)));
  const programs = [
    { program: mainProgram, files: ownSourceFiles(mainProgram, file => file.startsWith('src/') && !file.startsWith(UI_DIRECTORY)) },
    { program: uiProgram, files: ownSourceFiles(uiProgram, file => file.startsWith(UI_DIRECTORY)) },
  ];

  // The operation surfaces: `*Port` types and the declared return types of `create*Service`.
  const surfaces = new Set<string>();
  for (const { program, files } of programs) {
    const checker = program.getTypeChecker();
    for (const sourceFile of files) {
      const file = relativePath(sourceFile.fileName);
      for (const statement of sourceFile.statements) {
        if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && PORT_NAME.test(statement.name.text))
          surfaces.add(`${file}#${statement.name.text}`);
        if (!ts.isFunctionDeclaration(statement) || statement.type === undefined || !SERVICE_FACTORY.test(statement.name?.text ?? ''))
          continue;
        for (const reference of annotationReferences(statement.type)) {
          const symbol = checker.getSymbolAtLocation(reference.typeName);
          const target = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
          for (const declaration of target?.declarations ?? []) {
            const owner = relativePath(declaration.getSourceFile().fileName);
            if ((ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) && ts.isSourceFile(declaration.parent)
              && owner.startsWith('src/') && !declaration.getSourceFile().isDeclarationFile)
              surfaces.add(`${owner}#${declaration.name.text}`);
          }
        }
      }
    }
  }

  const units = new Map<string, Unit>();
  const files = new Map<string, FileInfo>();
  const memberUnits: Unit[] = [];
  /** Member declarations walked as units of their own, not with their owner. */
  const separate = new Set<ts.Node>();

  function addUnit(file: string, name: string, kind: ReachNodeKind, checker: ts.TypeChecker, sourceFile: ts.SourceFile,
    nameNode: ts.Node, body: ts.Node, extent: ts.Node, withJsDoc: boolean, member?: Unit['member']): void {
    const key = `${file}#${name}`;
    const lines = lineCount(sourceFile, extent, withJsDoc);
    const existing = units.get(key);
    if (existing !== undefined) {
      existing.bodies.push(body);
      existing.node.lines += lines;
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(nameNode.getStart(sourceFile)).line + 1;
    const unit: Unit = { key, node: { file, name, kind, line, lines }, checker, bodies: [body], ...(member === undefined ? {} : { member }) };
    units.set(key, unit);
    if (member !== undefined) memberUnits.push(unit);
  }

  function addMember(file: string, owner: OwnerDeclaration, ownerName: string, element: NamedMember, checker: ts.TypeChecker,
    sourceFile: ts.SourceFile): void {
    const { name, computed } = memberNameOf(element);
    const isStatic = ts.isClassElement(element) && (ts.getCombinedModifierFlags(element as ts.Declaration) & ts.ModifierFlags.Static) !== 0;
    separate.add(element);
    addUnit(file, `${ownerName}.${name}`, 'member', checker, sourceFile, element.name ?? element, element, element, true,
      { ownerKey: `${file}#${ownerName}`, name, owner, isStatic, computed });
  }

  function register(sourceFile: ts.SourceFile, checker: ts.TypeChecker): void {
    const file = relativePath(sourceFile.fileName);
    const info: FileInfo = { checker, statements: [], evaluates: [] };
    files.set(file, info);
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (statement.importClause?.isTypeOnly !== true) info.evaluates.push(statement.moduleSpecifier);
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        if (!statement.isTypeOnly && statement.moduleSpecifier !== undefined) info.evaluates.push(statement.moduleSpecifier);
        continue;
      }
      if (ts.isImportEqualsDeclaration(statement)) continue;
      if (ts.isVariableStatement(statement)) {
        const single = statement.declarationList.declarations.length === 1;
        for (const declaration of statement.declarationList.declarations)
          for (const name of bindingNames(declaration.name))
            addUnit(file, name, 'variable', checker, sourceFile, declaration.name, declaration,
              single ? statement : declaration, single);
        continue;
      }
      const named = statementName(statement);
      if (named === undefined) {
        info.statements.push(statement);
        continue;
      }
      addUnit(file, named.name, named.kind, checker, sourceFile, named.nameNode, statement, statement, true);
      if (ts.isClassDeclaration(statement)) {
        for (const element of statement.members)
          if (!ts.isSemicolonClassElement(element) && !ts.isIndexSignatureDeclaration(element) && !ts.isClassStaticBlockDeclaration(element))
            addMember(file, statement, named.name, element, checker, sourceFile);
      } else if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && surfaces.has(`${file}#${named.name}`)) {
        for (const element of surfaceMembers(statement)) addMember(file, statement, named.name, element, checker, sourceFile);
      }
    }
  }

  for (const { program, files: own } of programs) for (const sourceFile of own) register(sourceFile, program.getTypeChecker());

  const ownedFile = (node: ts.Node): string | undefined => {
    const file = relativePath(node.getSourceFile().fileName);
    return files.has(file) ? file : undefined;
  };

  /** The member node a declaration inside a class or surface belongs to (by name, so both Programs agree). */
  function memberKeyOf(file: string, top: ts.Node, ownerName: string, chain: readonly ts.Node[]): string | undefined {
    let element: NamedMember | undefined;
    if (ts.isClassDeclaration(top)) {
      const below = chain[chain.length - 2];
      if (below !== undefined && ts.isClassElement(below)) element = below;
    } else if (ts.isInterfaceDeclaration(top) || ts.isTypeAliasDeclaration(top)) {
      const literals = ts.isTypeAliasDeclaration(top) ? aliasLiterals(top.type) : [];
      element = chain.find(node => ts.isTypeElement(node)
        && (node.parent === top || (ts.isTypeLiteralNode(node.parent) && literals.includes(node.parent)))) as ts.TypeElement | undefined;
    }
    if (element === undefined) return undefined;
    const key = `${file}#${ownerName}.${memberNameOf(element).name}`;
    return units.has(key) ? key : undefined;
  }

  /** The unit a declaration belongs to (its enclosing top-level node, class member or surface member). */
  function unitKeyOf(declaration: ts.Node): string | undefined {
    const file = ownedFile(declaration);
    if (file === undefined) return undefined;
    const chain: ts.Node[] = [];
    for (let node: ts.Node = declaration; !ts.isSourceFile(node); node = node.parent) chain.push(node);
    const top = chain[chain.length - 1];
    if (top === undefined) return undefined;
    if (ts.isVariableStatement(top)) {
      const variable = chain[chain.length - 3];
      if (variable === undefined || !ts.isVariableDeclaration(variable)) return undefined;
      const names = bindingNames(variable.name);
      const element = chain.find(node => ts.isBindingElement(node) && ts.isIdentifier(node.name)
        && node.pos >= variable.name.pos && node.end <= variable.name.end) as ts.BindingElement | undefined;
      const name = element !== undefined ? (element.name as ts.Identifier).text : names[0];
      return name === undefined ? undefined : `${file}#${name}`;
    }
    const named = statementName(top);
    if (named === undefined) return undefined;
    return memberKeyOf(file, top, named.name, chain) ?? `${file}#${named.name}`;
  }

  const reached = new Set<string>();
  const reachedFiles = new Set<string>();
  const work: { checker: ts.TypeChecker; bodies: readonly ts.Node[] }[] = [];
  /** Local functions and deferred object-literal properties already queued. */
  const walkedLocal = new Set<ts.Node>();
  /** Object-literal properties waiting for their surface member (member key → properties). */
  const deferred = new Map<string, { checker: ts.TypeChecker; property: ts.ObjectLiteralElementLike }[]>();
  /** Per Program: member name → the types reached code read it on. */
  const receivers = new Map<ts.TypeChecker, Map<string, Set<ts.Type>>>();
  /** Names read on an `any`/`unknown` value or through a symbol that does not resolve. */
  const unresolvedNames = new Set<string>();

  function reachFile(file: string): void {
    if (reachedFiles.has(file)) return;
    reachedFiles.add(file);
    const info = files.get(file);
    if (info === undefined) return;
    work.push({ checker: info.checker, bodies: info.statements });
    for (const specifier of info.evaluates) {
      const declaration = info.checker.getSymbolAtLocation(specifier)?.declarations?.[0];
      const target = declaration !== undefined && ts.isSourceFile(declaration) ? ownedFile(declaration) : undefined;
      if (target !== undefined) reachFile(target);
    }
  }

  function queue(checker: ts.TypeChecker, node: ts.Node): void {
    if (walkedLocal.has(node)) return;
    walkedLocal.add(node);
    work.push({ checker, bodies: [node] });
  }

  function reachUnit(key: string): void {
    if (reached.has(key)) return;
    const unit = units.get(key);
    if (unit === undefined) return;
    reached.add(key);
    reachFile(unit.node.file);
    if (unit.member !== undefined) reachUnit(unit.member.ownerKey);
    work.push({ checker: unit.checker, bodies: unit.bodies });
    for (const { checker, property } of deferred.get(key) ?? []) queue(checker, property);
    deferred.delete(key);
    if (unit.node.kind === 'class') reachUnit(`${key}.constructor`);
  }

  const isTypeMember = (declaration: ts.Declaration) =>
    ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration)
    || ((ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))
      && (ts.isInterfaceDeclaration(declaration.parent) || ts.isTypeLiteralNode(declaration.parent)));

  function reachSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): void {
    const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    for (const declaration of target.declarations ?? []) {
      if (ts.isSourceFile(declaration)) {
        const file = ownedFile(declaration);
        if (file !== undefined) reachFile(file);
        continue;
      }
      if (isLocalFunction(declaration) && ownedFile(declaration) !== undefined) {
        queue(checker, declaration);
        continue;
      }
      const key = unitKeyOf(declaration);
      if (key !== undefined) reachUnit(key);
    }
  }

  /** Record that reached code reads member `name` of a value of type `on` (the symbol is the member it resolved to). */
  function readMember(checker: ts.TypeChecker, symbol: ts.Symbol, on: ts.Type, name: string): void {
    if ((symbol.flags & MEMBER_FLAGS) === 0) return;
    const declarations = symbol.declarations ?? [];
    if (declarations.length > 0 && !declarations.some(declaration => isTypeMember(declaration) || ts.isClassLike(declaration.parent)))
      return;
    let type: ts.Type | undefined = checker.getNonNullableType(on);
    if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) type = checker.getBaseConstraintOfType(type);
    if (type === undefined || (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      unresolvedNames.add(name);
      return;
    }
    const byName = receivers.get(checker) ?? new Map<string, Set<ts.Type>>();
    receivers.set(checker, byName);
    const types = byName.get(name) ?? new Set<ts.Type>();
    byName.set(name, types);
    types.add(type);
  }

  /** The object a property-name position reads from (`x` of `x.m` or `x['m']`). */
  const receiverOf = (node: ts.Node): ts.Expression | undefined => {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return parent.expression;
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return parent.expression;
    return undefined;
  };

  /** The name a declaration introduces is not a reference (a reached interface does not use its own members). */
  const isDeclarationName = (node: ts.Node) => {
    const parent = node.parent;
    return (ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isPropertyDeclaration(parent)
      || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)
      || ts.isPropertyAssignment(parent) || ts.isEnumMember(parent) || ts.isEnumDeclaration(parent)
      || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)
      || ts.isModuleDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)
      || ts.isTypeParameterDeclaration(parent)) && parent.name === node;
  };

  function reference(checker: ts.TypeChecker, node: ts.Identifier | ts.PrivateIdentifier | ts.StringLiteral): void {
    if (isDeclarationName(node)) return;
    const parent = node.parent;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      const value = checker.getShorthandAssignmentValueSymbol(parent);
      if (value !== undefined) reachSymbol(checker, value);
    }
    if (ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent) && (parent.propertyName ?? parent.name) === node) {
      // `const { m } = value` reads property `m` of the value.
      const source = checker.getTypeAtLocation(parent.parent);
      const property = checker.getPropertyOfType(source, node.text);
      if (property !== undefined) {
        readMember(checker, property, source, node.text);
        reachSymbol(checker, property);
      } else unresolvedNames.add(node.text);
      if (parent.propertyName !== undefined) return;
    }
    const symbol = checker.getSymbolAtLocation(node);
    const receiver = receiverOf(node);
    if (symbol === undefined) {
      if (receiver !== undefined || (ts.isQualifiedName(parent) && parent.right === node)) unresolvedNames.add(node.text);
      return;
    }
    if (receiver !== undefined) readMember(checker, symbol, checker.getTypeAtLocation(receiver), node.text);
    reachSymbol(checker, symbol);
  }

  /** `T['m']` names the type of member `m`: walk its signature without reaching the member. */
  function indexedAccess(checker: ts.TypeChecker, node: ts.IndexedAccessTypeNode): void {
    const index = node.indexType;
    const literals = (ts.isUnionTypeNode(index) ? [...index.types] : [index]).flatMap(type =>
      ts.isLiteralTypeNode(type) && (ts.isStringLiteral(type.literal) || ts.isNumericLiteral(type.literal)) ? [type.literal.text] : []);
    if (literals.length === 0) return;
    const object = checker.getTypeFromTypeNode(node.objectType);
    for (const name of literals) {
      for (const declaration of checker.getPropertyOfType(object, name)?.declarations ?? []) {
        const key = unitKeyOf(declaration);
        const unit = key === undefined ? undefined : units.get(key);
        if (unit?.member === undefined) {
          if (key !== undefined) reachUnit(key);
          continue;
        }
        reachUnit(unit.member.ownerKey);
        for (const part of signatureParts(declaration)) queue(checker, part);
      }
    }
  }

  /** The surface member nodes an object-literal property implements (its contextual property). */
  function implementedMembers(checker: ts.TypeChecker, contextual: ts.Type, property: ts.ObjectLiteralElementLike): string[] {
    if (ts.isSpreadAssignment(property)) return [];
    const name = propertyNameText(property.name);
    if (name === undefined) return [];
    const keys = new Set<string>();
    for (const type of contextual.isUnion() ? contextual.types : [contextual]) {
      for (const declaration of checker.getPropertyOfType(type, name)?.declarations ?? []) {
        const key = unitKeyOf(declaration);
        const unit = key === undefined ? undefined : units.get(key);
        if (key !== undefined && unit?.member !== undefined && !ts.isClassDeclaration(unit.member.owner)) keys.add(key);
      }
    }
    return [...keys];
  }

  function walkObjectLiteral(checker: ts.TypeChecker, literal: ts.ObjectLiteralExpression, root: ts.Node): void {
    const contextual = checker.getContextualType(literal);
    for (const property of literal.properties) {
      const keys = contextual === undefined ? [] : implementedMembers(checker, contextual, property);
      if (keys.length === 0 || keys.some(key => reached.has(key))) {
        walk(checker, property, root);
        continue;
      }
      for (const key of keys) {
        const list = deferred.get(key) ?? [];
        list.push({ checker, property });
        deferred.set(key, list);
      }
    }
  }

  /** Walk one body: member units, local functions and deferred properties are walked on their own. */
  function walk(checker: ts.TypeChecker, node: ts.Node, root: ts.Node): void {
    if (node !== root && (separate.has(node) || isLocalFunction(node))) return;
    if (ts.isObjectLiteralExpression(node)) {
      walkObjectLiteral(checker, node, root);
      return;
    }
    if (ts.isIndexedAccessTypeNode(node)) indexedAccess(checker, node);
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) reference(checker, node);
    else if (ts.isStringLiteral(node) && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node)
      reference(checker, node);
    ts.forEachChild(node, child => walk(checker, child, root));
  }

  const ownerTypes = new Map<string, ts.Type | null>();
  /** The type a member's owner gives its values (`null`: generic, compared by name only). */
  function ownerType(unit: Unit & { member: NonNullable<Unit['member']> }): ts.Type | null {
    const cacheKey = `${unit.member.ownerKey}${unit.member.isStatic ? ' static' : ''}`;
    const cached = ownerTypes.get(cacheKey);
    if (cached !== undefined) return cached;
    const owner = unit.member.owner;
    const symbol = owner.name === undefined ? undefined : unit.checker.getSymbolAtLocation(owner.name);
    let type: ts.Type | null = null;
    if (symbol !== undefined && (owner.typeParameters ?? []).length === 0)
      type = unit.member.isStatic ? unit.checker.getTypeOfSymbol(symbol) : unit.checker.getDeclaredTypeOfSymbol(symbol);
    ownerTypes.set(cacheKey, type);
    return type;
  }

  /** Whether a type that reached code reads `name` on can hold a value of the member's owner. */
  function readThroughAssignableType(unit: Unit & { member: NonNullable<Unit['member']> }): boolean {
    const types = receivers.get(unit.checker)?.get(unit.member.name);
    if (types === undefined || types.size === 0) return false;
    const source = ownerType(unit);
    if (source === null) return true;
    for (const target of types) if (target !== source && unit.checker.isTypeAssignableTo(source, target)) return true;
    return false;
  }

  /** Whether an implemented or extended type gives this class member a production caller. */
  function inherited(unit: Unit & { member: NonNullable<Unit['member']> }): boolean {
    const declaration = unit.member.owner;
    if (!ts.isClassDeclaration(declaration) || declaration.name === undefined) return false;
    const checker = unit.checker;
    const classSymbol = checker.getSymbolAtLocation(declaration.name);
    if (classSymbol === undefined) return false;
    const bases: ts.Type[] = [];
    if (unit.member.isStatic) {
      const extendsClause = declaration.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword);
      for (const type of extendsClause?.types ?? []) bases.push(checker.getTypeAtLocation(type.expression));
    } else {
      const instance = checker.getDeclaredTypeOfSymbol(classSymbol);
      if ((instance.flags & ts.TypeFlags.Object) !== 0 && ((instance as ts.ObjectType).objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0)
        bases.push(...checker.getBaseTypes(instance as ts.InterfaceType));
      for (const clause of declaration.heritageClauses ?? [])
        if (clause.token === ts.SyntaxKind.ImplementsKeyword)
          for (const type of clause.types) bases.push(checker.getTypeAtLocation(type));
    }
    for (const base of bases) {
      const property = checker.getPropertyOfType(base, unit.member.name);
      for (const member of property?.declarations ?? []) {
        if (ownedFile(member) === undefined) return true;
        const key = unitKeyOf(member);
        if (key !== undefined && key !== unit.key && units.get(key)?.member !== undefined && reached.has(key)) return true;
      }
    }
    return false;
  }

  function reachedIndirectly(unit: Unit & { member: NonNullable<Unit['member']> }): boolean {
    const { name, computed, owner } = unit.member;
    if (computed || unresolvedNames.has(name)) return true;
    if (ts.isClassDeclaration(owner) && (IMPLICIT_MEMBERS.has(name) || inherited(unit))) return true;
    return readThroughAssignableType(unit);
  }

  function drain(): void {
    for (let item = work.pop(); item !== undefined; item = work.pop())
      for (const body of item.bodies) walk(item.checker, body, body);
  }

  for (const entry of entries) {
    reachFile(entry.file);
    if (entry.exports === 'none') continue;
    const sourceFile = mainProgram.getSourceFile(join(projectRoot, entry.file)) ?? uiProgram.getSourceFile(join(projectRoot, entry.file));
    const checker = entry.file.startsWith(UI_DIRECTORY) ? uiProgram.getTypeChecker() : mainProgram.getTypeChecker();
    const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) throw new Error(`production entry ${entry.file} (${entry.via}) is not a module of the Program`);
    const exported = new Map(checker.getExportsOfModule(moduleSymbol).map(symbol => [symbol.name, symbol]));
    for (const name of entry.exports === 'all' ? [...exported.keys()] : entry.exports) {
      const symbol = exported.get(name);
      if (symbol === undefined) throw new Error(`production entry ${entry.file} (${entry.via}) has no export ${name}`);
      reachSymbol(checker, symbol);
    }
  }

  for (;;) {
    drain();
    let added = false;
    for (const unit of memberUnits) {
      const member = unit.member!;
      if (reached.has(unit.key) || !reached.has(member.ownerKey)) continue;
      if (reachedIndirectly(unit as Unit & { member: typeof member })) {
        reachUnit(unit.key);
        added = true;
      }
    }
    if (!added && work.length === 0) break;
  }

  const unreached = [...units.values()]
    .filter(unit => !reached.has(unit.key) && (unit.member === undefined || reached.has(unit.member.ownerKey)))
    .map(unit => unit.node)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  return { entries, files: files.size, nodes: units.size, surfaces: [...surfaces].sort(), unreached,
    elapsedMs: Math.round(performance.now() - started) };
}
