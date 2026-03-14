import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CapturedCommandResult = {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

export type StoredServiceMeta = {
	serviceId: string;
	label: string;
	cwd: string;
	pid: number;
	command: string;
	readyCommand: string | null;
	createdAt: string;
	stoppedAt?: string | null;
	stdoutPath: string;
	stderrPath: string;
	probeLogPath: string;
	pidPath: string;
};

export type ListedService = StoredServiceMeta & {
	alive: boolean;
	serviceDir: string;
};

export function resolvePath(inputPath: string | undefined, cwd: string): string {
	if (!inputPath || !inputPath.trim()) return cwd;
	let value = inputPath.trim();
	if (value.startsWith("@")) value = value.slice(1);
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

export function slugify(value: string | undefined): string {
	const input = (value ?? "service").trim().toLowerCase();
	const slug = input.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return slug || "service";
}

export function trimOutput(value: string, maxChars: number = 4000): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n...[truncated]`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(new Error("Cancelled"));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(new Error("Cancelled"));
		};
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function readIfExists(filePath: string): Promise<string> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return "";
	}
}

export async function runShell(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CapturedCommandResult> {
	return await new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Cancelled"));
			return;
		}

		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const maxBytes = 32 * 1024;

		child.stdout.on("data", (chunk) => {
			if (stdout.length < maxBytes) stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			if (stderr.length < maxBytes) stderr += String(chunk);
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1000).unref();
		}, timeoutMs);

		const onAbort = () => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1000).unref();
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", (error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ code, stdout, stderr, timedOut });
		});
	});
}

export function getServiceDir(rootDir: string, serviceId: string): string {
	return path.join(rootDir, serviceId);
}

export async function ensureRootDir(rootDir: string): Promise<void> {
	await fs.mkdir(rootDir, { recursive: true });
}

export async function createServiceRecord(rootDir: string, params: {
	label?: string;
	cwd: string;
	command: string;
	readyCommand?: string;
}): Promise<StoredServiceMeta & { serviceDir: string; stdoutFd: number; stderrFd: number }> {
	await ensureRootDir(rootDir);
	const serviceId = `${slugify(params.label)}-${randomUUID().slice(0, 8)}`;
	const serviceDir = getServiceDir(rootDir, serviceId);
	await fs.mkdir(serviceDir, { recursive: true });
	const stdoutPath = path.join(serviceDir, "stdout.log");
	const stderrPath = path.join(serviceDir, "stderr.log");
	const pidPath = path.join(serviceDir, "service.pid");
	const probeLogPath = path.join(serviceDir, "probe.log");
	const stdoutFd = openSync(stdoutPath, "a");
	const stderrFd = openSync(stderrPath, "a");
	return {
		serviceId,
		serviceDir,
		label: params.label ?? serviceId,
		cwd: params.cwd,
		pid: 0,
		command: params.command,
		readyCommand: params.readyCommand ?? null,
		createdAt: new Date().toISOString(),
		stoppedAt: null,
		stdoutPath,
		stderrPath,
		probeLogPath,
		pidPath,
		stdoutFd,
		stderrFd,
	};
}

export async function writeServiceMeta(meta: StoredServiceMeta, serviceDir: string): Promise<string> {
	const metaPath = path.join(serviceDir, "meta.json");
	await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
	return metaPath;
}

export function closeLogFds(stdoutFd: number, stderrFd: number): void {
	closeSync(stdoutFd);
	closeSync(stderrFd);
}

export async function listServices(rootDir: string): Promise<ListedService[]> {
	try {
		const entries = await fs.readdir(rootDir, { withFileTypes: true });
		const services = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
			const serviceDir = path.join(rootDir, entry.name);
			try {
				const metaRaw = await fs.readFile(path.join(serviceDir, "meta.json"), "utf8");
				const meta = JSON.parse(metaRaw) as StoredServiceMeta;
				return { ...meta, alive: isProcessAlive(meta.pid), serviceDir } satisfies ListedService;
			} catch {
				return null;
			}
		}));
		return services.filter((service): service is ListedService => service != null).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
	} catch {
		return [];
	}
}

export async function findService(rootDir: string, serviceId: string): Promise<ListedService | null> {
	const services = await listServices(rootDir);
	return services.find((service) => service.serviceId === serviceId) ?? null;
}

export async function stopService(params: {
	rootDir: string;
	serviceId: string;
	force?: boolean;
	killWaitMs?: number;
}): Promise<{ service: ListedService; stopped: boolean; escalated: boolean }> {
	const service = await findService(params.rootDir, params.serviceId);
	if (!service) throw new Error(`No background service found for serviceId=${params.serviceId}`);

	if (!service.alive) {
		return { service, stopped: false, escalated: false };
	}

	process.kill(service.pid, "SIGTERM");
	const killWaitMs = Math.max(100, Math.floor(params.killWaitMs ?? 1500));
	const started = Date.now();
	while (Date.now() - started < killWaitMs) {
		if (!isProcessAlive(service.pid)) {
			const updated = { ...service, alive: false, stoppedAt: new Date().toISOString() };
			await writeServiceMeta(updated, service.serviceDir);
			return { service: updated, stopped: true, escalated: false };
		}
		await sleep(100);
	}

	if (params.force) {
		process.kill(service.pid, "SIGKILL");
		const updated = { ...service, alive: false, stoppedAt: new Date().toISOString() };
		await writeServiceMeta(updated, service.serviceDir);
		return { service: updated, stopped: true, escalated: true };
	}

	return { service, stopped: false, escalated: false };
}
