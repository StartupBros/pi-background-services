import test from "node:test";
import assert from "node:assert/strict";
import { extractReferencedShellScript } from "../extensions/index.js";

test("extractReferencedShellScript finds bash-invoked shell scripts", () => {
	assert.equal(extractReferencedShellScript("bash -x /app/start_alpine_ssh.sh"), "/app/start_alpine_ssh.sh");
	assert.equal(extractReferencedShellScript("sh ./bin/dev.sh"), "./bin/dev.sh");
	assert.equal(extractReferencedShellScript("./scripts/run-server.sh"), "./scripts/run-server.sh");
	assert.equal(extractReferencedShellScript("python3 -m http.server 8000"), null);
});
