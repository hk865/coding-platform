import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const workspace = path.resolve(process.argv[2]);
  const moduleUrl = `${pathToFileURL(path.join(workspace, "src/auth.mjs")).href}?trial=${Date.now()}`;
  const { isAuthorized } = await import(moduleUrl);
  assert.equal(isAuthorized("Bearer abc", "abc"), true);
  assert.equal(isAuthorized("Bearer abc-extra", "abc"), false);
  assert.equal(isAuthorized("prefix Bearer abc", "abc"), false);
  assert.equal(isAuthorized("bearer abc", "abc"), false);
  assert.equal(isAuthorized(null, "abc"), false);
  process.stdout.write('{"resolved":true,"checks":5}\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "assertion failed"}\n`);
  process.exitCode = 1;
}
