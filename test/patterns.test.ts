import test from "node:test";
import assert from "node:assert/strict";
import { getServiceLaunchGuardMessage, looksLikeServiceTask } from "../src/patterns.js";

test("looksLikeServiceTask detects service-oriented prompts", () => {
	assert.equal(looksLikeServiceTask("Start a local ssh server on port 2222 and keep it running"), true);
	assert.equal(looksLikeServiceTask("Refactor this pure function"), false);
});

test("getServiceLaunchGuardMessage ignores simple one-shot launches", () => {
	const message = getServiceLaunchGuardMessage("python -m http.server 8080 >/tmp/server.log 2>&1 &");
	assert.equal(message, null);
});

test("getServiceLaunchGuardMessage blocks monolithic long-running orchestration", () => {
	const message = getServiceLaunchGuardMessage([
		"qemu-system-x86_64 -daemonize -pidfile /tmp/vm.pid -serial telnet:127.0.0.1:4444,server,nowait",
		"sleep 5",
		"expect <<'EOF'",
		"spawn ssh -p 2222 root@localhost",
		"EOF",
	].join("\n"));
	assert.match(message ?? "", /mixes a long-running service launch/i);
	assert.match(message ?? "", /start_background_service/);
});

test("getServiceLaunchGuardMessage also blocks helper-script expect orchestration", () => {
	const message = getServiceLaunchGuardMessage([
		"chmod +x /app/test-setup.expect",
		"/app/test-setup.expect root@localhost 2222",
		"curl -fsS http://127.0.0.1:2222 || true",
	].join("\n"));
	assert.match(message ?? "", /helper script/i);
});
