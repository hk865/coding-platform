import assert from "node:assert/strict";

import { isAuthorized } from "./src/auth.mjs";

assert.equal(isAuthorized("Bearer abc", "abc"), true);
assert.equal(isAuthorized(undefined, "abc"), false);
console.log("public tests passed");
