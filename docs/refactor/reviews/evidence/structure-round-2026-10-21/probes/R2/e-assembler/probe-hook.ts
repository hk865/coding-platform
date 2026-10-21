/**
 * COPY-ONLY byte-proof probe (S4/D3b). Written by
 * probes/e-assembler/apply-probes.mjs into a scratch copy; never part of the
 * repository. One JSON line per captured call, keyed by
 * (relative testPath, testName, probe, callIndex) plus the test's runIndex.
 * `undefined` is kept apart from a missing key and from `null` with a sentinel.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type ProbeContext = { testPath: string; testName: string; runIndex: number };
type ProbeCall = { context: ProbeContext; kind: string; callIndex: number };

const context: ProbeContext = { testPath: 'unknown', testName: '', runIndex: 0 };
const testRunCounters = new Map<string, number>();
const callCounters = new Map<string, number>();
const madeDirectories = new Set<string>();

export function relProbePath(file: string | undefined): string {
  if (file === undefined || file === '') return 'unknown';
  return relative(process.cwd(), file).split(sep).join('/');
}

export function nextTestRunIndex(testPath: string): number {
  const next = testRunCounters.get(testPath) ?? 0;
  testRunCounters.set(testPath, next + 1);
  return next;
}

export function setProbeContext(next: Partial<ProbeContext>): void {
  if (next.testPath !== undefined) context.testPath = next.testPath;
  if (next.testName !== undefined) context.testName = next.testName;
  if (next.runIndex !== undefined) context.runIndex = next.runIndex;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  try { return String(error); } catch { return '<unstringifiable>'; }
}

export function describeError(error: unknown): unknown {
  if (error instanceof Error) {
    const extra: Record<string, unknown> = {};
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) extra.code = code;
    return { name: error.name, message: error.message, ...extra };
  }
  try { return { thrown: String(error) }; } catch { return { thrown: '<unstringifiable>' }; }
}

/** Keeps missing vs undefined vs null apart; own keys stay in insertion order. */
export function encodeProbeValue(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === undefined) return { $probe: 'undefined' };
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    return Number.isFinite(value) ? value : { $probe: 'number', value: String(value) };
  }
  if (type === 'bigint') return { $probe: 'bigint', value: String(value) };
  if (type === 'symbol') return { $probe: 'symbol', value: String(value.description) };
  if (type === 'function') return { $probe: 'function', name: (value as Function).name };
  const object = value as object;
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(object)) return { $probe: 'circular' };
  visited.add(object);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        out.push(index in value ? encodeProbeValue(value[index], visited) : { $probe: 'array-hole' });
      }
      return out;
    }
    if (value instanceof Date) return { $probe: 'date', value: value.toISOString() };
    if (value instanceof AbortSignal) return { $probe: 'abort-signal', aborted: value.aborted };
    if (value instanceof RegExp) return { $probe: 'regexp', value: String(value) };
    if (ArrayBuffer.isView(value)) {
      return { $probe: 'bytes', base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
    }
    if (value instanceof Map) {
      return { $probe: 'map', entries: [...value.entries()].map(([k, v]) => [encodeProbeValue(k, visited), encodeProbeValue(v, visited)]) };
    }
    if (value instanceof Set) {
      return { $probe: 'set', values: [...value.values()].map(item => encodeProbeValue(item, visited)) };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      let entry: unknown;
      try { entry = encodeProbeValue((value as Record<string, unknown>)[key], visited); }
      catch (error) { entry = { $probe: 'getter-threw', message: messageOf(error) }; }
      out[key] = entry;
    }
    return out;
  } finally {
    visited.delete(object);
  }
}

function writeRecord(call: ProbeCall, payload: unknown): void {
  const directory = process.env.S85_PROBE_DIR;
  if (directory === undefined || directory === '') return;
  if (!madeDirectories.has(directory)) {
    mkdirSync(directory, { recursive: true });
    madeDirectories.add(directory);
  }
  const fileName = call.context.testPath.replace(/[^A-Za-z0-9._-]/g, '__') + '.jsonl';
  const line = JSON.stringify({
    schema: 1,
    testPath: call.context.testPath,
    testName: call.context.testName,
    runIndex: call.context.runIndex,
    probe: call.kind,
    callIndex: call.callIndex,
    payload,
  });
  appendFileSync(join(directory, fileName), line + '\n', 'utf8');
}

/**
 * Q1-01/Q2-02 copy-only call-site log (separate from the compared payloads, so
 * base and result line numbers never enter a comparison). One line per call,
 * with the first eight frames under src/ or tests/.
 */
function probeSite(kind: string, method: string, call: ProbeCall): void {
  const directory = process.env.S85_PROBE_SITE_DIR;
  if (directory === undefined || directory === '') return;
  if (!madeDirectories.has(directory)) {
    mkdirSync(directory, { recursive: true });
    madeDirectories.add(directory);
  }
  const frames: string[] = [];
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n')) {
    if (line.includes('probe-hook')) continue;
    const match = line.match(/(?:\/|\s)((?:src|tests)\/[A-Za-z0-9._/-]+\.(?:ts|js)):(\d+):\d+/);
    if (match !== null) frames.push(match[1] + ':' + match[2]);
    if (frames.length >= 8) break;
  }
  const fileName = call.context.testPath.replace(/[^A-Za-z0-9._-]/g, '__') + '.jsonl';
  appendFileSync(join(directory, fileName), JSON.stringify({
    testPath: call.context.testPath, testName: call.context.testName,
    probe: call.kind, callIndex: call.callIndex, method, frames,
  }) + '\n', 'utf8');
}

/** Allocate the call index at call time, so concurrent calls keep call order. */
export function beginProbeCall(kind: string): ProbeCall {
  const snapshot: ProbeContext = { ...context };
  // A fixture may assemble in a `beforeAll` hook, before the per-test setup:
  // take the test file from the stack instead of recording 'unknown'.
  if (snapshot.testPath === 'unknown') {
    const stack = new Error().stack ?? '';
    for (const line of stack.split('\n')) {
      const match = line.match(/(tests\/[A-Za-z0-9._/-]+\.test\.ts)/);
      if (match !== null) { snapshot.testPath = match[1]; break; }
    }
  }
  const key = snapshot.testPath + '\u0000' + snapshot.testName + '\u0000' + kind;
  const callIndex = callCounters.get(key) ?? 0;
  callCounters.set(key, callIndex + 1);
  return { context: snapshot, kind, callIndex };
}

export function finishProbeCall(call: ProbeCall, payload: unknown): void {
  writeRecord(call, encodeProbeValue(payload));
}

/** The next call index for a probe in the current test (call order, no allocation). */
export function probeCursor(kind: string): number {
  return probeCursorAt(context, kind);
}

export function probeCursorAt(snapshot: ProbeContext, kind: string): number {
  const key = snapshot.testPath + '\u0000' + snapshot.testName + '\u0000' + kind;
  return callCounters.get(key) ?? 0;
}

export function probeLog(kind: string, payload: unknown): void {
  finishProbeCall(beginProbeCall(kind), payload);
}

export function probeStoredManifest(kind: string, payload: unknown): void {
  probeLog(kind, payload);
}

// ------------------------------------------------------------------------ //
// The deps proxy (item 2)                                                   //
// ------------------------------------------------------------------------ //

const proxyTargets = new WeakMap<object, object>();

/** The dependency shape of one assembler call, recorded for the replay plan. */
export function depsShapeOf(deps: unknown): unknown {
  const target = deps !== null && typeof deps === 'object'
    ? proxyTargets.get(deps as object) ?? (deps as object) : deps;
  if (target === null || typeof target !== 'object') return {};
  const shape: Record<string, unknown> = {};
  const clock = (target as Record<string, unknown>).now;
  shape.now = typeof clock === 'function'
    ? { present: true, kind: 'function' }
    : { present: clock !== undefined, kind: typeof clock };
  for (const key of PORT_KEYS) {
    const value = (target as Record<string, unknown>)[key];
    if (value === undefined) { shape[key] = { present: false }; continue; }
    if (typeof value === 'function') { shape[key] = { present: true, kind: 'function' }; continue; }
    if (value === null || typeof value !== 'object') {
      shape[key] = { present: true, kind: typeof value };
      continue;
    }
    const methods = new Set<string>();
    let cursor: object | null = value;
    while (cursor !== null && cursor !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(cursor)) {
        const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
        if (descriptor !== undefined && typeof descriptor.value === 'function') methods.add(name);
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
    shape[key] = { present: true, kind: 'object', methods: [...methods] };
  }
  return shape;
}

const PORT_KEYS = new Set([
  'executions', 'roles', 'materials', 'bodies', 'plans', 'sessions', 'kernelStores',
  'workspaceHost', 'workspaceSource', 'kernel', 'unknownCallReviews', 'commandRerunRequests',
  'graphContext', 'taskInputs', 'architectureReminders',
]);

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

function recordMethod(
  value: unknown, property: PropertyKey, prefix: string, self: unknown, original: object,
): unknown {
  if (typeof value !== 'function') return value;
  const method = prefix === '' ? String(property) : prefix + '.' + String(property);
  return function recordPortCall(this: unknown, ...args: unknown[]): unknown {
    const call = beginProbeCall('deps');
    // Encode the arguments as passed, before the call can mutate them.
    const encodedArgs = encodeProbeValue(args);
    probeSite('deps', method, call);
    // Q1-01: the Kernel history reads happen inside the `withStore` callback on
    // the store/reader it receives; hand it a recording wrapper of the same shape.
    if (String(property) === 'withStore' && args.length >= 2 && typeof args[1] === 'function') {
      const callback = args[1] as (store: unknown) => unknown;
      args = [args[0], (store: unknown) => callback(wrapKernelStore(store, call.callIndex))];
    }
    const receiver = this === self ? original : this;
    const base = { method, seq: call.callIndex, args: encodedArgs };
    let result: unknown;
    try {
      result = Reflect.apply(value as (...values: unknown[]) => unknown, receiver, args);
    } catch (error) {
      finishProbeCall(call, { ...base, outcome: { status: 'threw', error: describeError(error) } });
      throw error;
    }
    if (isThenable(result)) {
      Promise.resolve(result).then(
        resolved => finishProbeCall(call, { ...base, outcome: { status: 'fulfilled', value: resolved } }),
        error => finishProbeCall(call, { ...base, outcome: { status: 'rejected', error: describeError(error) } }),
      );
      return result;
    }
    finishProbeCall(call, { ...base, outcome: { status: 'returned', value: result } });
    return result;
  };
}

/** A Proxy may not lie about a non-configurable, non-writable own data property. */
function needsClone(target: object): boolean {
  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor !== undefined && 'value' in descriptor
      && descriptor.configurable === false && descriptor.writable === false) return true;
  }
  return false;
}

/**
 * Wrap one dependency object. A plain object is a live recording Proxy (later
 * mutations of the double stay visible); a frozen object cannot be proxied by
 * the invariant rule, so its own properties are copied onto the same prototype
 * (the frozen double cannot be mutated afterwards, so the copy is equivalent).
 */
function wrapPort(target: object, prefix: string, cache: Map<object, object>): object {
  const cached = cache.get(target);
  if (cached !== undefined) return cached;
  const nested = (value: unknown, property: PropertyKey): unknown => {
    if (prefix === '' && typeof property === 'string' && PORT_KEYS.has(property)
      && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return wrapPort(value as object, property, cache);
    }
    return value;
  };
  if (needsClone(target)) {
    const clone = Object.create(Object.getPrototypeOf(target) as object) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(target)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor === undefined) continue;
      if ('value' in descriptor) {
        Object.defineProperty(clone, key, {
          value: recordMethod(nested(descriptor.value, key), key, prefix, clone, target),
          writable: true, enumerable: descriptor.enumerable, configurable: true,
        });
      } else {
        Object.defineProperty(clone, key, {
          configurable: true, enumerable: descriptor.enumerable,
          get: descriptor.get === undefined
            ? undefined
            : () => recordMethod(nested(descriptor.get!.call(target), key), key, prefix, clone, target),
          set: descriptor.set === undefined
            ? undefined
            : (next: unknown) => { descriptor.set!.call(target, next); },
        });
      }
    }
    proxyTargets.set(clone, target);
    cache.set(target, clone);
    return clone;
  }
  let proxy: unknown;
  proxy = new Proxy(target, {
    get(inner, property) {
      const value = Reflect.get(inner, property, inner);
      const port = nested(value, property);
      if (port !== value) return port;
      return recordMethod(value, property, prefix, proxy, target);
    },
  });
  proxyTargets.set(proxy as object, target);
  cache.set(target, proxy);
  return proxy;
}

/**
 * Q1-01: a call on the store/reader a `withStore` callback receives. It is
 * recorded like a dependency call, with the opening `withStore` call's `seq` as
 * `parent`, but under the `kernel` probe name so the nesting is explicit.
 */
function recordKernelMethod(
  value: (...args: unknown[]) => unknown, name: string, parent: number, self: unknown, original: object,
): unknown {
  return function recordKernelCall(this: unknown, ...args: unknown[]): unknown {
    const call = beginProbeCall('kernel');
    const encodedArgs = encodeProbeValue(args);
    probeSite('kernel', name, call);
    const receiver = this === self ? original : this;
    const base = { method: name, seq: call.callIndex, parent, args: encodedArgs };
    let result: unknown;
    try {
      result = Reflect.apply(value, receiver, args);
    } catch (error) {
      finishProbeCall(call, { ...base, outcome: { status: 'threw', error: describeError(error) } });
      throw error;
    }
    if (isThenable(result)) {
      Promise.resolve(result).then(
        resolved => finishProbeCall(call, { ...base, outcome: { status: 'fulfilled', value: resolved } }),
        error => finishProbeCall(call, { ...base, outcome: { status: 'rejected', error: describeError(error) } }),
      );
      return result;
    }
    finishProbeCall(call, { ...base, outcome: { status: 'returned', value: result } });
    return result;
  };
}

/** A hand-out the callback can call methods on (a store or a reader). */
function readerLike(value: object): boolean {
  if (Array.isArray(value) || value instanceof Date || value instanceof RegExp
    || ArrayBuffer.isView(value) || value instanceof AbortSignal) return false;
  let cursor: object | null = value;
  while (cursor !== null && cursor !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
      if (descriptor !== undefined && typeof descriptor.value === 'function') return true;
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return false;
}

function wrapKernelObject(target: object, prefix: string, parent: number, cache: Map<object, object>): object {
  const cached = cache.get(target);
  if (cached !== undefined) return cached;
  const nameOf = (property: PropertyKey): string =>
    prefix === '' ? String(property) : prefix + '.' + String(property);
  if (needsClone(target)) {
    const clone = Object.create(Object.getPrototypeOf(target) as object) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(target)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor === undefined || !('value' in descriptor)) continue;
      const value = descriptor.value as unknown;
      Object.defineProperty(clone, key, {
        value: typeof value === 'function'
          ? recordKernelMethod(value as (...args: unknown[]) => unknown, nameOf(key), parent, clone, target)
          : value !== null && typeof value === 'object' && readerLike(value as object)
            ? wrapKernelObject(value as object, nameOf(key), parent, cache)
            : value,
        writable: true, enumerable: descriptor.enumerable, configurable: true,
      });
    }
    cache.set(target, clone);
    return clone;
  }
  let proxy: unknown;
  proxy = new Proxy(target, {
    get(inner, property) {
      const value = Reflect.get(inner, property, inner);
      if (typeof value === 'function') {
        return recordKernelMethod(value as (...args: unknown[]) => unknown, nameOf(property), parent, proxy, target);
      }
      if (value !== null && typeof value === 'object' && readerLike(value as object)) {
        return wrapKernelObject(value as object, nameOf(property), parent, cache);
      }
      return value;
    },
  });
  cache.set(target, proxy);
  return proxy;
}

/** Q1-01: the value one `withStore` hands to its callback. */
function wrapKernelStore(store: unknown, parent: number): unknown {
  if (store === null || typeof store !== 'object' || Array.isArray(store)) return store;
  return wrapKernelObject(store as object, '', parent, new Map<object, object>());
}

// ------------------------------------------------------------------------ //
// Q1-01: the exports tests call directly, without the factory              //
// ------------------------------------------------------------------------ //

const directBases = new Map<ProbeCall, Record<string, unknown>>();

/** True when a direct caller passed a deps object the factory already wrapped. */
export function probeIsWrappedDeps(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (proxyTargets.has(value as object)) return true;
  // The assembler sometimes hands a direct function a NEW literal holding the
  // factory's already-proxied members (`{ ...deps.kernelStores }`); wrapping it
  // again would record the same call twice.
  const record = value as Record<string, unknown>;
  for (const key of PORT_KEYS) {
    const member = record[key];
    if (member !== null && (typeof member === 'object' || typeof member === 'function')
      && proxyTargets.has(member as object)) return true;
  }
  return false;
}

export function probeDirectCallBegin(fn: string, args: unknown[], depsIndex: number | null): ProbeCall {
  const call = beginProbeCall('direct');
  probeSite('direct', fn, call);
  const kept = depsIndex === null ? args : args.filter((_value, index) => index !== depsIndex);
  directBases.set(call, {
    fn,
    args: encodeProbeValue(kept),
    ...(depsIndex === null ? {} : { depsShape: depsShapeOf(args[depsIndex]) }),
  });
  return call;
}

export function probeDirectCallEnd(call: ProbeCall, outcome: unknown): void {
  finishProbeCall(call, { ...(directBases.get(call) ?? {}), outcome });
  directBases.delete(call);
}

export function probeDeps<T>(deps: T): T {
  if (deps === null || typeof deps !== 'object') return deps;
  return wrapPort(deps as object, '', new Map<object, object>()) as T;
}

// ------------------------------------------------------------------------ //
// The whole assembler result (item 1)                                       //
// ------------------------------------------------------------------------ //

function assemblerProbeOf(method: string): string | null {
  if (method === 'assembleTask') return 'assembler:task';
  if (method === 'assembleQuery') return 'assembler:query';
  if (method === 'readAttentionGraph') return 'assembler:attention';
  return null;
}

export function probeAssembler<T extends object>(assembler: T, deps?: unknown): T {
  if (assembler === null || typeof assembler !== 'object') return assembler;
  let proxy: unknown;
  proxy = new Proxy(assembler, {
    get(inner, property) {
      const value = Reflect.get(inner, property, inner);
      const kind = typeof property === 'string' ? assemblerProbeOf(property) : null;
      if (typeof value !== 'function' || kind === null) return value;
      const method = String(property);
      return function recordAssemblerCall(this: unknown, ...args: unknown[]): unknown {
        const call = beginProbeCall(kind);
        // The complete call arguments and the dependency shape are kept for the
        // recorded-input replay plan.
        const encodedArgs = encodeProbeValue(args);
        const depsFrom = probeCursor('deps');
        const depsShape = depsShapeOf(deps);
        const receiver = this === proxy ? inner : this;
        let result: unknown;
        try {
          result = Reflect.apply(value as (...values: unknown[]) => unknown, receiver, args);
        } catch (error) {
          finishProbeCall(call, { method, args: encodedArgs, depsRange: [depsFrom, probeCursorAt(call.context, 'deps')], depsShape, threw: describeError(error) });
          throw error;
        }
        if (isThenable(result)) {
          Promise.resolve(result).then(
            resolved => finishProbeCall(call, { method, args: encodedArgs, depsRange: [depsFrom, probeCursorAt(call.context, 'deps')], depsShape, result: resolved }),
            error => finishProbeCall(call, { method, args: encodedArgs, depsRange: [depsFrom, probeCursorAt(call.context, 'deps')], depsShape, threw: describeError(error) }),
          );
          return result;
        }
        finishProbeCall(call, { method, args: encodedArgs, depsRange: [depsFrom, probeCursorAt(call.context, 'deps')], depsShape, result });
        return result;
      };
    },
  });
  return proxy as T;
}

// ------------------------------------------------------------------------ //
// Determinism for the probe copies (book §5.0 rule 3)                      //
// ------------------------------------------------------------------------ //

let idCounter = 0;

/**
 * Seeded replacement for the production `randomUUID` in the probe copies. The
 * counter is per process/test file, so two identical runs generate the same
 * sequence of ids. The shape stays a canonical UUID string, never erased from
 * the captured payloads.
 */
export function probeRandomId(): string {
  idCounter += 1;
  return '00000000-0000-4000-8000-' + idCounter.toString(16).padStart(12, '0');
}

let clockCounter = 0;

/** The probe copies' fixed, monotonic clock (book §5.0 rule 3). */
export function probeNow(): string {
  clockCounter += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + clockCounter * 1000).toISOString();
}


/** Inverse of `encodeProbeValue`, for the recorded-input replay driver. */
export function decodeProbeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => decodeProbeValue(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    switch (record.$probe) {
      case 'undefined': return undefined;
      case 'array-hole': return undefined;
      case 'date': return new Date(String(record.value));
      case 'bytes': return Buffer.from(String(record.base64), 'base64');
      case 'abort-signal': {
        const controller = new AbortController();
        if (record.aborted === true) controller.abort();
        return controller.signal;
      }
      case 'number': return Number(record.value);
      case 'bigint': return BigInt(String(record.value));
      case 'regexp': return new RegExp(String(record.value));
      case 'map': return new Map((record.entries as [unknown, unknown][]).map(([k, v]) => [decodeProbeValue(k), decodeProbeValue(v)]));
      case 'set': return new Set((record.values as unknown[]).map(item => decodeProbeValue(item)));
      default: break;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) out[key] = decodeProbeValue(record[key]);
    return out;
  }
  return value;
}

let tempCounter = 0;
const tempCounters = new Map<string, number>();

/**
 * A deterministic `mkdtemp` suffix for the probe copies (book §5.0 rule 3).
 * The test file is read from the call stack, so the same call site gets the
 * same path in every run, independent of worker scheduling; the per-file
 * counter keeps paths unique inside one run.
 */
export function probeTempSuffix(): string {
  let file = context.testPath;
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n')) {
    const match = line.match(/(tests\/[A-Za-z0-9._/-]+\.test\.ts)/);
    if (match !== null) { file = match[1]; break; }
  }
  const count = (tempCounters.get(file) ?? 0) + 1;
  tempCounters.set(file, count);
  tempCounter += 1;
  let hash = 2166136261;
  for (let index = 0; index < file.length; index += 1) {
    hash ^= file.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + '-' + String(count) + '-' + String(tempCounter);
}
