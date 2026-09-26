import { afterAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const original = DatabaseSync.prototype.exec;
const ids = new WeakMap<DatabaseSync, number>();
const opened = new WeakMap<DatabaseSync, number>();
let sequence = 0;
const spans: Array<{ connection: number; operation: string; durationMs: number; transactionBefore: boolean; transactionAfter: boolean; heldMs?: number; error?: string }> = [];
vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(this: DatabaseSync, sql: string) {
  let connection = ids.get(this);
  if (connection === undefined) { connection = ++sequence; ids.set(this, connection); }
  const operation = sql.trim().split(/\s+/)[0]!.toUpperCase();
  const tracked = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(operation);
  const transactionBefore = this.isTransaction;
  const start = performance.now();
  let error: string | undefined;
  try { return Reflect.apply(original, this, [sql]); }
  catch (e) { error = e instanceof Error ? e.name : 'unknown'; throw e; }
  finally {
    const end = performance.now();
    if (tracked) {
      const held = opened.get(this);
      spans.push({connection,operation,durationMs:end-start,transactionBefore,transactionAfter:this.isTransaction,
        ...(held !== undefined && ['COMMIT','ROLLBACK'].includes(operation) ? { heldMs:end-held } : {}),
        ...(error ? {error} : {}) });
      if (operation === 'BEGIN' && !error) opened.set(this, end);
      if (['COMMIT','ROLLBACK'].includes(operation) && !this.isTransaction) opened.delete(this);
    }
  }
});
afterAll(() => {
  const summarize = (op: string) => {
    const rows=spans.filter(s=>s.operation===op), values=rows.map(s=>s.durationMs).sort((a,b)=>a-b);
    return {count:rows.length,totalMs:values.reduce((a,b)=>a+b,0),maxMs:values.at(-1)??0,p50Ms:values[Math.floor(values.length/2)]??0};
  };
  writeFileSync('/tmp/r3a-r4a-independent-review/transaction-trace.json',JSON.stringify({
    scope:'Four existing p1-02 integration tests; exec-only instrumentation, not complete profiler',
    connectionsObserved:sequence,begin:summarize('BEGIN'),commit:summarize('COMMIT'),rollback:summarize('ROLLBACK'),
    nestedBegins:spans.filter(s=>s.operation==='BEGIN' && s.transactionBefore),
    savepoints:spans.filter(s=>s.operation==='SAVEPOINT'),spans
  },null,2)+'\n');
});
