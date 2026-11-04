import { isMainThread, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import type { LineRange } from './single-file-syntax.js';

/**
 * The second tier's analysis thread (slice-8E2-SPEC W1, W3, W6, W7). `reference-analyzer.ts`
 * value-imports this module's URL, so the production reach check sees the edge; the thread's
 * entry runs only inside a thread started with the analyzer's role marker (a vitest `threads`
 * worker is not main-thread either, so `isMainThread` alone is not enough).
 *
 * The thread imports nothing but TypeScript and Node: it runs from the TS source under Node's
 * type stripping in tests, where a relative `.js` import would not resolve. The main thread owns
 * every workspace read, the configuration and finding X (W5); the thread builds one program per
 * request from the files it is handed, asks for the ones TypeScript wants that it was not given,
 * answers each question with `getDocumentHighlights` over the whole program, and keeps the
 * parsed files in one cache shared by every request.
 */
export const REFERENCE_ANALYZER_WORKER_URL: string = import.meta.url;
export const REFERENCE_ANALYZER_ROLE = 'reference-analysis';

/** One question the thread answers; positions are one-based, X's is its navigation item's `start`. */
export type ReferenceWorkerQuestion = {
  evidence: string; ranges: LineRange[] | null;
  definition: string; line: number; column: number; name: string;
};
export type ReferenceWorkerFile = { name: string; content: string; version: string } | { name: string; unreadable: true };
export type ReferenceWorkerAnswer = 'found' | 'not_found' | 'undecided' | 'failed';
export type ReferenceWorkerJob = {
  type: 'verify'; id: number; workspaceKey: string;
  options: ts.CompilerOptions; currentDirectory: string; defaultLibFileName: string;
  roots: string[]; inventory: string[]; files: ReferenceWorkerFile[];
  /** null: already decided by the main thread. */
  groups: (ReferenceWorkerQuestion | null)[][];
  /** Background requests stop between groups when the main thread says something more urgent waits (W2). */
  yieldable: boolean;
};
export type ToReferenceWorker = ReferenceWorkerJob
  | { type: 'files'; id: number; files: ReferenceWorkerFile[] | null }
  | { type: 'preempt'; id: number };
export type FromReferenceWorker =
  | { type: 'need'; id: number; names: string[] }
  | { type: 'group'; id: number; index: number; answers: (ReferenceWorkerAnswer | null)[] }
  | { type: 'done'; id: number; used: string[] }
  | { type: 'failed'; id: number; reason: string };

/** W7: the parse cache's source-text budget; §3.2 item 6 measured about 30–32 bytes of heap per byte. */
const PARSE_CACHE_SOURCE_BYTES_MAX = 24 * 1024 * 1024;

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};

type CachedFile = { file: ts.SourceFile; bytes: number; optionsKey: string };

/**
 * W7: parsed (and, once a program binds them, bound) files shared by every request, keyed by
 * path + content version + the digest of the whole normalized compiler options + the file's
 * module format. LRU by source bytes. A workspace whose options changed drops the entries of its
 * old options unless another workspace still uses them. Releasing a language service drops
 * nothing: only the LRU evicts.
 */
class ParseCache {
  private readonly entries = new Map<string, CachedFile>();
  private bytes = 0;
  private readonly optionsOf = new Map<string, string>();

  useOptions(workspaceKey: string, optionsKey: string): void {
    const previous = this.optionsOf.get(workspaceKey);
    this.optionsOf.set(workspaceKey, optionsKey);
    if (previous === undefined || previous === optionsKey || [...this.optionsOf.values()].includes(previous)) return;
    for (const [key, entry] of this.entries) if (entry.optionsKey === previous) { this.entries.delete(key); this.bytes -= entry.bytes; }
  }

  registry(): ts.DocumentRegistry {
    const keyOf = (settings: ts.CompilerOptions) => createHash('sha256').update(stable(settings)).digest('hex') as ts.DocumentRegistryBucketKey;
    const acquire = (fileName: string, path: string, key: string, snapshot: ts.IScriptSnapshot, version: string,
      scriptKind: ts.ScriptKind | undefined, sourceFileOptions: ts.CreateSourceFileOptions | ts.ScriptTarget | undefined): ts.SourceFile => {
      const options: ts.CreateSourceFileOptions = typeof sourceFileOptions === 'object' ? sourceFileOptions
        : { languageVersion: sourceFileOptions ?? ts.ScriptTarget.Latest };
      const cacheKey = stable([path, version, key, options.impliedNodeFormat ?? null, scriptKind ?? null]);
      const hit = this.entries.get(cacheKey);
      if (hit !== undefined) { this.entries.delete(cacheKey); this.entries.set(cacheKey, hit); return hit.file; }
      const file = ts.createLanguageServiceSourceFile(fileName, snapshot, options, version, false, scriptKind);
      const entry = { file, bytes: Buffer.byteLength(file.text), optionsKey: key };
      this.entries.set(cacheKey, entry);
      this.bytes += entry.bytes;
      for (const [oldest, old] of this.entries) {
        if (this.bytes <= PARSE_CACHE_SOURCE_BYTES_MAX || oldest === cacheKey) break;
        this.entries.delete(oldest); this.bytes -= old.bytes;
      }
      return file;
    };
    const registry: ts.DocumentRegistry = {
      acquireDocument: (fileName, settings, snapshot, version, scriptKind, sourceFileOptions) =>
        acquire(fileName, fileName, keyOf(settingsOf(settings)), snapshot, version, scriptKind, sourceFileOptions),
      acquireDocumentWithKey: (fileName, path, _settings, key, snapshot, version, scriptKind, sourceFileOptions) =>
        acquire(fileName, path, key, snapshot, version, scriptKind, sourceFileOptions),
      updateDocument: (fileName, settings, snapshot, version, scriptKind, sourceFileOptions) =>
        acquire(fileName, fileName, keyOf(settingsOf(settings)), snapshot, version, scriptKind, sourceFileOptions),
      updateDocumentWithKey: (fileName, path, _settings, key, snapshot, version, scriptKind, sourceFileOptions) =>
        acquire(fileName, path, key, snapshot, version, scriptKind, sourceFileOptions),
      getKeyForCompilationSettings: keyOf,
      releaseDocument: () => {},
      releaseDocumentWithKey: () => {},
      reportStats: () => JSON.stringify({ entries: this.entries.size, bytes: this.bytes }),
    };
    return registry;
  }
}

const settingsOf = (settings: ts.CompilerOptions | ts.MinimalResolutionCacheHost): ts.CompilerOptions =>
  'getCompilationSettings' in settings && typeof settings.getCompilationSettings === 'function' ? settings.getCompilationSettings() : settings as ts.CompilerOptions;

const inRanges = (line: number, ranges: LineRange[] | null) => ranges === null || ranges.some(range => line >= range.startLine && line <= range.endLine);

/** Has the contextual type, or any member of a union, a property of this name? (TS relates contextual literals member-wise.) */
function hasProperty(checker: ts.TypeChecker, type: ts.Type, name: string): boolean {
  const members = type.isUnion() ? type.types : [type];
  return members.some(member => checker.getPropertyOfType(checker.getApparentType(member), name) !== undefined);
}

const propertyNameText = (name: ts.Node | undefined): string | undefined =>
  name === undefined ? undefined
  : ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text
  : ts.isComputedPropertyName(name) && (ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression)) ? name.expression.text
  : undefined;

/**
 * W6 `undecided`: no hit, and inside the ranges X's name occurs as a property the compiler cannot
 * get at that place — after `.`/`?.` (type qualified names and `import('…')` qualifiers included)
 * or as a string in `[…]` when no symbol resolves there (the object unresolved, `any`, or its type
 * lacks it); as a destructured property or a property name of a contextually typed object
 * literal (shorthands and literal computed keys included) when the destructured value's whole
 * type lacks it (a union lacks it when any member does) or no member of the contextual type has
 * it (or the type does not resolve). Nothing else that fails to resolve counts.
 */
function propertyUnresolved(file: ts.SourceFile, ranges: LineRange[] | null, name: string, checker: ts.TypeChecker): boolean {
  // A computed key's range is its name's own line, not the line of its `[`.
  const inside = (node: ts.Node) => {
    const at = ts.isComputedPropertyName(node) ? node.expression : node;
    return inRanges(file.getLineAndCharacterOfPosition(at.getStart(file)).line + 1, ranges);
  };
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    let site: ts.Node | undefined, resolves: (() => boolean) | undefined;
    if (ts.isPropertyAccessExpression(node) && node.name.text === name) { site = node.name; resolves = () => checker.getSymbolAtLocation(node.name) !== undefined; }
    else if (ts.isQualifiedName(node) && node.right.text === name) { site = node.right; resolves = () => checker.getSymbolAtLocation(node.right) !== undefined; }
    else if (ts.isImportTypeNode(node) && node.qualifier !== undefined) {
      const last = ts.isIdentifier(node.qualifier) ? node.qualifier : node.qualifier.right;
      if (last.text === name) { site = last; resolves = () => checker.getSymbolAtLocation(last) !== undefined; }
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name) {
      const argument = node.argumentExpression;
      site = argument; resolves = () => checker.getSymbolAtLocation(argument) !== undefined;
    } else if (ts.isBindingElement(node) && node.dotDotDotToken === undefined && ts.isObjectBindingPattern(node.parent)
      && (node.propertyName !== undefined ? propertyNameText(node.propertyName) : ts.isIdentifier(node.name) ? node.name.text : undefined) === name) {
      const pattern = node.parent;
      // TS takes a destructured name from the whole pattern type, not member by member.
      site = node.propertyName ?? node.name; resolves = () => checker.getPropertyOfType(checker.getTypeAtLocation(pattern), name) !== undefined;
    } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && ts.isObjectLiteralExpression(node.parent)
      && propertyNameText(node.name) === name) {
      const contextual = checker.getContextualType(node.parent);
      if (contextual !== undefined) { site = node.name; resolves = () => hasProperty(checker, contextual, name); }
    }
    if (site !== undefined && resolves !== undefined && inside(site) && !resolves()) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function answer(service: ts.LanguageService, program: ts.Program, files: string[], question: ReferenceWorkerQuestion): ReferenceWorkerAnswer {
  const definition = program.getSourceFile(question.definition), evidence = program.getSourceFile(question.evidence);
  if (definition === undefined || evidence === undefined) throw new Error('question file outside the program');
  const position = definition.getPositionOfLineAndCharacter(question.line - 1, question.column - 1);
  // The search list is the whole program: the import tracker only finds importers inside the
  // list, so a re-export through a file outside it would hide a real reference.
  for (const highlights of service.getDocumentHighlights(question.definition, position, files) ?? []) {
    if (highlights.fileName !== question.evidence) continue;
    for (const span of highlights.highlightSpans) {
      if (question.evidence === question.definition && span.textSpan.start === position) continue;
      if (inRanges(evidence.getLineAndCharacterOfPosition(span.textSpan.start).line + 1, question.ranges)) return 'found';
    }
  }
  return propertyUnresolved(evidence, question.ranges, question.name, program.getTypeChecker()) ? 'undecided' : 'not_found';
}

function serve(port: MessagePort): void {
  const cache = new ParseCache();
  /** W2: the one job running now, and whether the main thread asked it to stop between groups. */
  let current: { id: number; preempted: boolean } | null = null;
  const waiting = new Map<number, (files: ReferenceWorkerFile[] | null) => void>();
  const post = (message: FromReferenceWorker) => port.postMessage(message);
  const ask = (id: number, names: string[]) => new Promise<ReferenceWorkerFile[] | null>(resolve => {
    waiting.set(id, resolve);
    post({ type: 'need', id, names });
  });
  const run = async (job: ReferenceWorkerJob): Promise<void> => {
    const contents = new Map<string, { snapshot: ts.IScriptSnapshot; content: string; version: string } | null>();
    const take = (files: readonly ReferenceWorkerFile[]) => {
      for (const file of files) contents.set(file.name, 'unreadable' in file ? null
        : { snapshot: ts.ScriptSnapshot.fromString(file.content), content: file.content, version: file.version });
    };
    take(job.files);
    const inventory = new Set(job.inventory), directories = new Set<string>();
    for (const name of inventory) for (let at = name.lastIndexOf('/'); at > 0; at = name.lastIndexOf('/', at - 1)) directories.add(name.slice(0, at));
    const trimmed = (name: string) => name.replace(/\/$/, '');
    const used = new Set<string>();
    const optionsKey = createHash('sha256').update(stable(job.options)).digest('hex');
    cache.useOptions(job.workspaceKey, optionsKey);
    const registry = cache.registry();
    let service: ts.LanguageService | undefined;
    let program: ts.Program | undefined;
    for (;;) {
      const missing = new Set<string>();
      const lookup = (name: string) => {
        const file = contents.get(name);
        if (file === undefined) { if (inventory.has(name)) missing.add(name); return undefined; }
        if (file !== null) used.add(name);
        return file ?? undefined;
      };
      const host: ts.LanguageServiceHost = {
        getCompilationSettings: () => job.options, getCurrentDirectory: () => job.currentDirectory,
        getDefaultLibFileName: () => job.defaultLibFileName, getScriptFileNames: () => job.roots,
        getScriptVersion: name => contents.get(name)?.version ?? '',
        getScriptSnapshot: name => lookup(name)?.snapshot,
        readFile: name => lookup(name)?.content,
        fileExists: name => inventory.has(name) && contents.get(name) !== null,
        directoryExists: name => directories.has(trimmed(name)),
        getDirectories: name => {
          const prefix = trimmed(name) + '/';
          return [...directories].filter(directory => directory.startsWith(prefix) && !directory.slice(prefix.length).includes('/'))
            .map(directory => directory.slice(prefix.length));
        },
        realpath: name => name, useCaseSensitiveFileNames: () => true,
      };
      service?.dispose();
      service = ts.createLanguageService(host, registry);
      program = service.getProgram();
      if (program === undefined) throw new Error('no TS/JS program');
      if (missing.size === 0) break;
      const files = await ask(job.id, [...missing].sort());
      if (files === null) { post({ type: 'failed', id: job.id, reason: 'request cancelled' }); service.dispose(); return; }
      take(files);
      // A file TypeScript needs that cannot be read leaves the program unknowable, like a capture.
      if (files.some(file => 'unreadable' in file)) { post({ type: 'failed', id: job.id, reason: 'a project file could not be read' }); service.dispose(); return; }
    }
    const built = program, analysis = service;
    // Binding every file once here also gives the cached trees their parent pointers.
    built.getTypeChecker();
    const all = built.getSourceFiles().map(file => file.fileName);
    const answerOf = (question: ReferenceWorkerQuestion): ReferenceWorkerAnswer => {
      try { return answer(analysis, built, all, question); } catch { return 'failed'; }
    };
    for (let index = 0; index < job.groups.length; index += 1) {
      if (index > 0 && job.yieldable) {
        await new Promise<void>(resolve => setImmediate(resolve));
        if (current?.preempted === true) break;
      }
      post({ type: 'group', id: job.id, index, answers: job.groups[index]!.map(question => question === null ? null : answerOf(question)) });
    }
    analysis.dispose();
    post({ type: 'done', id: job.id, used: [...used] });
  };
  port.on('message', (message: ToReferenceWorker) => {
    if (message.type === 'verify') {
      current = { id: message.id, preempted: false };
      void run(message).catch(error => post({ type: 'failed', id: message.id, reason: error instanceof Error ? error.name + ': ' + error.message.slice(0, 200) : String(error) }))
        .finally(() => { current = null; });
    } else if (message.type === 'files') {
      const resolve = waiting.get(message.id);
      waiting.delete(message.id);
      resolve?.(message.files);
    } else if (current?.id === message.id) current.preempted = true;
  });
}

if (!isMainThread && parentPort !== null && (workerData as { role?: unknown } | null | undefined)?.role === REFERENCE_ANALYZER_ROLE) serve(parentPort);
