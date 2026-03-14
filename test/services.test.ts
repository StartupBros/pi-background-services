import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	closeLogFds,
	createServiceRecord,
	listServices,
	stopService,
	writeServiceMeta,
} from "../src/services.js";

test("service registry can list and stop a tracked detached process", async () => {
	const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-bg-test-"));
	const record = await createServiceRecord(rootDir, {
		label: "test-sleeper",
		cwd: rootDir,
		command: "sleep 30",
	});

	let pid = 0;
	try {
		const child = spawn("bash", ["-lc", "sleep 30"], {
			cwd: rootDir,
			detached: true,
			stdio: ["ignore", record.stdoutFd, record.stderrFd],
		});
		pid = child.pid ?? 0;
		child.unref();
	} finally {
		closeLogFds(record.stdoutFd, record.stderrFd);
	}

	assert.ok(pid > 0);
	await fs.writeFile(record.pidPath, `${pid}\n`, "utf8");
	await writeServiceMeta({
		...record,
		pid,
		stoppedAt: null,
	}, record.serviceDir);

	const services = await listServices(rootDir);
	assert.equal(services.length, 1);
	assert.equal(services[0]?.serviceId, record.serviceId);
	assert.equal(services[0]?.alive, true);

	const result = await stopService({
		rootDir,
		serviceId: record.serviceId,
		force: true,
		killWaitMs: 500,
	});
	assert.equal(result.stopped, true);
	assert.equal(result.service.serviceId, record.serviceId);
});
