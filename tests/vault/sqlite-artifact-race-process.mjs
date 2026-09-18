import '../coordination/process-loader.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (request.ready) {
  const prepare = DatabaseSync.prototype.prepare;
  let armed = true;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    if (sql === 'SELECT record FROM artifacts WHERE key = ?') {
      const get = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = get(...args);
        if (!row && armed) {
          armed = false; writeFileSync(request.ready, String(process.pid));
          const deadline = Date.now() + 45000;
          const cell = new Int32Array(new SharedArrayBuffer(4));
          while (!existsSync(request.go)) {
            if (Date.now() >= deadline) throw Error('read-miss barrier timed out');
            Atomics.wait(cell, 0, 0, 10);
          }
        }
        return row;
      };
    }
    return statement;
  };
}
const { SqliteArtifactVault } = await import('../../src/data/artifact-vault/sqlite-artifact-vault.ts');
const vault = new SqliteArtifactVault(request.database);
try {
  const result = request.record ? await vault.put(request.record)
    : await Promise.all(request.owners.map(requesterRunRef => vault.open(request.ref, {requesterRunRef, includeOwner: true})));
  process.stdout.write(JSON.stringify({pid:process.pid,result}));
} catch(error) { process.stdout.write(JSON.stringify({pid:process.pid,error:String(error)})); }
finally { await vault.close(); }