import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import {
	closeLogFds,
	createServiceRecord,
	findService,
	isProcessAlive,
	listServices,
	readIfExists,
	resolvePath,
	runShell,
	sleep,
	stopService,
	trimOutput,
	writeServiceMeta,
} from "../src/services.js";
import { loadConfig } from "../src/config.js";
import { getServiceLaunchGuardMessage, looksLikeServiceTask } from "../src/patterns.js";

const START_TOOL_PARAMS = Type.Object({
	label: Type.Optional(Type.String({ description: "Short label for log/pid directory naming." })),
	command: Type.String({
		description:
			"Shell command to launch as a persistent detached service. This command should start the server, VM, worker, tunnel, or daemon.",
	}),
	cwd: Type.Optional(Type.String({ description: "Working directory for both the service command and readiness probe." })),
	readyCommand: Type.Optional(Type.String({
		description:
			"Shell probe command that must succeed before the service is considered ready. Use the real user-facing interface, e.g. curl/ssh/pg_isready.",
	})),
	attempts: Type.Optional(Type.Number({ description: "Maximum readiness attempts.", default: 30, minimum: 1 })),
	delayMs: Type.Optional(Type.Number({ description: "Delay between readiness attempts in milliseconds.", default: 2000, minimum: 100 })),
	stablePasses: Type.Optional(Type.Number({ description: "Consecutive successful readiness probes required before declaring readiness.", default: 2, minimum: 1 })),
	probeTimeoutMs: Type.Optional(Type.Number({ description: "Timeout per readiness probe in milliseconds.", default: 15000, minimum: 1000 })),
});

const LIST_TOOL_PARAMS = Type.Object({
	includeStopped: Type.Optional(Type.Boolean({ description: "Include services whose process is no longer alive." })),
});

const STOP_TOOL_PARAMS = Type.Object({
	serviceId: Type.String({ description: "serviceId returned by start_background_service or list_background_services." }),
	force: Type.Optional(Type.Boolean({ description: "Escalate to SIGKILL if SIGTERM does not stop the process in time." })),
	killWaitMs: Type.Optional(Type.Number({ description: "How long to wait after SIGTERM before giving up or escalating.", default: 1500, minimum: 100 })),
});

type StartToolParams = {
	label?: string;
	command: string;
	cwd?: string;
	readyCommand?: string;
	attempts?: number;
	delayMs?: number;
	stablePasses?: number;
	probeTimeoutMs?: number;
};

type ListToolParams = {
	includeStopped?: boolean;
};

type StopToolParams = {
	serviceId: string;
	force?: boolean;
	killWaitMs?: number;
};

export default function backgroundServicesExtension(pi: ExtensionAPI) {
	const config = loadConfig();

	if (config.guardMode !== "off") {
		pi.on("tool_call", async (event, ctx) => {
			if (event.toolName !== "bash") return;
			const command = typeof event.input?.command === "string" ? event.input.command : "";
			const reason = getServiceLaunchGuardMessage(command);
			if (!reason) return;
			if (config.guardMode === "warn") {
				ctx.ui.notify(`Background services: ${reason}`, "warning");
				return;
			}
			return { block: true, reason };
		});
	}

	if (config.enableTooling) {
		pi.registerTool({
			name: "start_background_service",
			label: "Start background service",
			description:
				"Launch a persistent process fully detached with pid/log files, and optionally wait for stable readiness by repeatedly running a probe command.",
			promptSnippet:
				"Start a server/VM/daemon/worker detached from the current shell and optionally wait for stable readiness.",
			promptGuidelines: [
				"Use this tool instead of ad-hoc bash detachment when you need a long-running service, VM, SSH daemon, tunnel, watcher, or worker to keep running after the current step.",
				"When possible, provide readyCommand so the tool can verify the real user-facing interface at least twice before you declare success.",
			],
			parameters: START_TOOL_PARAMS,
			async execute(_toolCallId, params: StartToolParams, signal, onUpdate, ctx) {
				const resolvedCwd = resolvePath(params.cwd, ctx.cwd);
				const record = await createServiceRecord(config.servicesRootDir, {
					label: params.label,
					cwd: resolvedCwd,
					command: params.command,
					readyCommand: params.readyCommand,
				});
				let pid = 0;
				try {
					onUpdate?.({
						content: [{ type: "text", text: `Starting background service in ${record.serviceDir}...` }],
						details: { stage: "launch", serviceDir: record.serviceDir },
					});

					const child = spawn("bash", ["-lc", params.command], {
						cwd: resolvedCwd,
						env: process.env,
						detached: true,
						stdio: ["ignore", record.stdoutFd, record.stderrFd],
					});

					pid = child.pid ?? 0;
					child.unref();
				} finally {
					closeLogFds(record.stdoutFd, record.stderrFd);
				}

				if (!pid) {
					throw new Error("Failed to start background service: no PID returned");
				}

				const meta = {
					...record,
					pid,
				};
				delete (meta as { stdoutFd?: number }).stdoutFd;
				delete (meta as { stderrFd?: number }).stderrFd;
				await fs.writeFile(record.pidPath, `${pid}\n`, "utf8");
				await writeServiceMeta(meta, record.serviceDir);

				if (params.readyCommand) {
					const attempts = Math.max(1, Math.floor(params.attempts ?? 30));
					const delayMs = Math.max(100, Math.floor(params.delayMs ?? 2000));
					const stablePasses = Math.max(1, Math.floor(params.stablePasses ?? 2));
					const probeTimeoutMs = Math.max(1000, Math.floor(params.probeTimeoutMs ?? 15000));
					let consecutivePasses = 0;
					let lastProbe = "";

					for (let attempt = 1; attempt <= attempts; attempt += 1) {
						if (!isProcessAlive(pid)) {
							const stderr = trimOutput(await readIfExists(record.stderrPath));
							throw new Error(
								`Background service exited before becoming ready. PID=${pid}. Last stderr:\n${stderr || "<empty>"}`,
							);
						}

						onUpdate?.({
							content: [{ type: "text", text: `Readiness probe ${attempt}/${attempts} for service ${record.serviceId}...` }],
							details: { stage: "probe", attempt, attempts, pid, serviceId: record.serviceId },
						});

						const result = await runShell(params.readyCommand, resolvedCwd, probeTimeoutMs, signal);
						lastProbe = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
						await fs.appendFile(
							record.probeLogPath,
							[
								`=== attempt ${attempt} @ ${new Date().toISOString()} ===`,
								`code: ${result.code}`,
								`timedOut: ${result.timedOut}`,
								result.stdout ? `stdout:\n${result.stdout}` : "stdout:<empty>",
								result.stderr ? `stderr:\n${result.stderr}` : "stderr:<empty>",
								"",
							].join("\n"),
						);

						if (result.code === 0 && !result.timedOut) {
							consecutivePasses += 1;
							if (consecutivePasses >= stablePasses) {
								const summary = [
									"Background service started and verified.",
									`serviceId=${record.serviceId}`,
									`pid=${pid}`,
									`cwd=${resolvedCwd}`,
									`pidFile=${record.pidPath}`,
									`stdoutLog=${record.stdoutPath}`,
									`stderrLog=${record.stderrPath}`,
									`probeLog=${record.probeLogPath}`,
								].join("\n");
								return {
									content: [{ type: "text", text: summary }],
									details: {
										serviceId: record.serviceId,
										pid,
										cwd: resolvedCwd,
										pidPath: record.pidPath,
										stdoutPath: record.stdoutPath,
										stderrPath: record.stderrPath,
										probeLogPath: record.probeLogPath,
										readyCommand: params.readyCommand,
									},
								};
							}
						} else {
							consecutivePasses = 0;
						}

						if (attempt < attempts) {
							await sleep(delayMs, signal);
						}
					}

					const stderr = trimOutput(await readIfExists(record.stderrPath));
					throw new Error(
						[
							`Background service never reached stable readiness after ${attempts} attempts.`,
							`serviceId=${record.serviceId}`,
							`pid=${pid}`,
							"Last probe output:",
							lastProbe || "<empty>",
							"Last stderr:",
							stderr || "<empty>",
							`Probe log: ${record.probeLogPath}`,
						].join("\n"),
					);
				}

				return {
					content: [
						{
							type: "text",
							text: [
								"Background service started.",
								`serviceId=${record.serviceId}`,
								`pid=${pid}`,
								`cwd=${resolvedCwd}`,
								`pidFile=${record.pidPath}`,
								`stdoutLog=${record.stdoutPath}`,
								`stderrLog=${record.stderrPath}`,
							].join("\n"),
						},
					],
					details: {
						serviceId: record.serviceId,
						pid,
						cwd: resolvedCwd,
						pidPath: record.pidPath,
						stdoutPath: record.stdoutPath,
						stderrPath: record.stderrPath,
						probeLogPath: record.probeLogPath,
					},
				};
			},
		});

		pi.registerTool({
			name: "list_background_services",
			label: "List background services",
			description: "List background services previously started through this package, including process health and log file paths.",
			promptSnippet: "Inspect currently tracked background services and their health.",
			parameters: LIST_TOOL_PARAMS,
			async execute(_toolCallId, params: ListToolParams) {
				const services = await listServices(config.servicesRootDir);
				const filtered = params.includeStopped ? services : services.filter((service) => service.alive);
				if (filtered.length === 0) {
					return {
						content: [{ type: "text", text: "No tracked background services found." }],
						details: { services: [] },
					};
				}
				return {
					content: [{
						type: "text",
						text: filtered.map((service) => [
							`serviceId=${service.serviceId}`,
							`alive=${service.alive}`,
							`pid=${service.pid}`,
							`cwd=${service.cwd}`,
							`stdoutLog=${service.stdoutPath}`,
							`stderrLog=${service.stderrPath}`,
						].join("\n")).join("\n\n"),
					}],
					details: { services: filtered },
				};
			},
		});

		pi.registerTool({
			name: "stop_background_service",
			label: "Stop background service",
			description: "Stop a background service previously started through this package.",
			promptSnippet: "Stop a tracked background service cleanly.",
			parameters: STOP_TOOL_PARAMS,
			async execute(_toolCallId, params: StopToolParams) {
				const result = await stopService({
					rootDir: config.servicesRootDir,
					serviceId: params.serviceId,
					force: params.force,
					killWaitMs: params.killWaitMs,
				});
				return {
					content: [{
						type: "text",
						text: [
							`serviceId=${result.service.serviceId}`,
							`stopped=${result.stopped}`,
							`alive=${result.service.alive}`,
							`escalated=${result.escalated}`,
							`pid=${result.service.pid}`,
						].join("\n"),
					}],
					details: result,
				};
			},
		});
	}

	if (config.enableGuidance) {
		pi.on("before_agent_start", async (event) => {
			if (!looksLikeServiceTask(event.prompt)) {
				return;
			}

			return {
				systemPrompt: `${event.systemPrompt}

## Long-running service launch protocol
When a task requires starting a persistent process (server, VM, SSH daemon, tunnel, worker, watcher, or anything that must keep running after you finish), strongly prefer the start_background_service tool over ad-hoc bash detachment when practical.

Use this protocol unless the user explicitly asks for a different approach:
- Prefer a fully detached launch. Do not leave the long-running process attached to the active shell or tool invocation.
- Redirect stdin from /dev/null.
- Redirect stdout and stderr to log files.
- Save the PID to a pidfile.
- If available, prefer setsid or nohup so the process is not tied to the current shell.
- Do not leave behind tail -f, watch, or foreground log-following processes.
- Do not hide the launch/probe/orchestration sequence inside a freshly written helper script just to keep using bash or expect. The same protocol still applies.
- After launch, verify real readiness with the actual interface the user will use: HTTP request, SSH command, socket probe, etc.
- Require stability, not one lucky success: perform the readiness probe at least twice with a short delay before declaring success.
- If a probe fails, inspect logs and retry rather than immediately claiming success.
- Once readiness is confirmed, stop probing and finish the task promptly. Do not keep the bash tool open waiting on the background process.

If the task is to make a service reachable on a port, optimize for a robust detached launch and stable readiness verification before you finish.`,
			};
		});
	}
}
