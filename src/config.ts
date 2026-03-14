import os from "node:os";
import path from "node:path";

export type GuardMode = "off" | "warn" | "block";

export type BackgroundServicesConfig = {
	guardMode: GuardMode;
	enableTooling: boolean;
	enableGuidance: boolean;
	servicesRootDir: string;
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
	if (value == null || value.trim() === "") return defaultValue;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return defaultValue;
}

function parseGuardMode(value: string | undefined): GuardMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "off" || normalized === "warn" || normalized === "block") return normalized;
	return "block";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackgroundServicesConfig {
	const defaultRoot = path.join(os.tmpdir(), "pi-background-services");
	return {
		guardMode: parseGuardMode(env.PI_BACKGROUND_SERVICES_GUARD_MODE),
		enableTooling: parseBoolean(env.PI_BACKGROUND_SERVICES_ENABLE_TOOLING, true),
		enableGuidance: parseBoolean(env.PI_BACKGROUND_SERVICES_ENABLE_GUIDANCE, true),
		servicesRootDir: env.PI_BACKGROUND_SERVICES_ROOT_DIR?.trim() || defaultRoot,
	};
}
