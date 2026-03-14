import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig uses safe defaults", () => {
	const config = loadConfig({});
	assert.equal(config.guardMode, "block");
	assert.equal(config.enableTooling, true);
	assert.equal(config.enableGuidance, true);
	assert.match(config.servicesRootDir, /pi-background-services/);
});

test("loadConfig respects env overrides", () => {
	const config = loadConfig({
		PI_BACKGROUND_SERVICES_GUARD_MODE: "warn",
		PI_BACKGROUND_SERVICES_ENABLE_TOOLING: "false",
		PI_BACKGROUND_SERVICES_ENABLE_GUIDANCE: "0",
		PI_BACKGROUND_SERVICES_ROOT_DIR: "/tmp/custom-bg-root",
	});
	assert.equal(config.guardMode, "warn");
	assert.equal(config.enableTooling, false);
	assert.equal(config.enableGuidance, false);
	assert.equal(config.servicesRootDir, "/tmp/custom-bg-root");
});
