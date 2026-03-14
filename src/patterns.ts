export const SERVICE_PATTERNS: RegExp[] = [
	/\bbackground\b/i,
	/\bdaemon\b/i,
	/\bserver\b/i,
	/\bservice\b/i,
	/\bssh\b/i,
	/\bport\s+\d+/i,
	/\blisten(?:ing)?\b/i,
	/\bstart\b.*\b(qemu|server|service|ssh)\b/i,
	/\brun\b.*\b(background|server|service)\b/i,
	/\baccessible\b/i,
	/\bendpoint\b/i,
	/\b0\.0\.0\.0\b/i,
	/\bqemu\b/i,
	/\bvm\b/i,
	/\bkeep\s+running\b/i,
	/\bdropped into a shell\b/i,
];

export const LONG_RUNNING_LAUNCH_PATTERNS: RegExp[] = [
	/\bqemu-system(?:-[\w-]+)?\b/i,
	/\buvicorn\b/i,
	/\bpython(?:3)?\s+-m\s+http\.server\b/i,
	/\bpython(?:3)?\s+-m\s+simplehttpserver\b/i,
	/\brails\s+server\b/i,
	/\b(bin\/dev|npm\s+run\s+dev|pnpm\s+dev|yarn\s+dev)\b/i,
	/\bsshd\b/i,
	/\bdocker\s+compose\s+up\b/i,
	/\bdocker-compose\s+up\b/i,
];

export const FOLLOW_UP_ORCHESTRATION_PATTERNS: RegExp[] = [
	/\bexpect\b/i,
	/\bssh-keyscan\b/i,
	/\btelnet\b/i,
	/\bnc\b/i,
	/\bfor\s+\w+\s+in\s+\$\(seq\b/i,
	/\bwhile\b/i,
	/\bsleep\s+\d+/i,
	/\bcurl\b/i,
	/\bsshpass\b/i,
	/\budhcpc\b/i,
];

const HELPER_SCRIPT_ORCHESTRATION_PATTERNS: RegExp[] = [
	/\.expect\b/i,
	/\bexpect\s+\S+/i,
	/\bchmod\s+\+x\s+\S+/i,
	/\b(\.\/|bash\s+|sh\s+)\S+\.(?:expect|sh)\b/i,
];

const NETWORK_ORCHESTRATION_PATTERNS: RegExp[] = [
	/\bssh\b/i,
	/\bsshpass\b/i,
	/\btelnet\b/i,
	/\bnc\b/i,
	/\bcurl\b/i,
	/\blocalhost\b/i,
	/127\.0\.0\.1/,
];

export function looksLikeServiceTask(prompt: string): boolean {
	return SERVICE_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function getServiceLaunchGuardMessage(command: string): string | null {
	const lineCount = command
		.split(/\n|;/)
		.map((part) => part.trim())
		.filter(Boolean).length;
	const hasDirectLongRunningLaunch = LONG_RUNNING_LAUNCH_PATTERNS.some((pattern) => pattern.test(command));
	const hasFollowUp = FOLLOW_UP_ORCHESTRATION_PATTERNS.some((pattern) => pattern.test(command));
	const hasHelperScriptOrchestration =
		HELPER_SCRIPT_ORCHESTRATION_PATTERNS.some((pattern) => pattern.test(command)) &&
		NETWORK_ORCHESTRATION_PATTERNS.some((pattern) => pattern.test(command));

	if (!hasDirectLongRunningLaunch && !hasHelperScriptOrchestration) {
		return null;
	}

	if (!hasHelperScriptOrchestration && !hasFollowUp && lineCount < 4) {
		return null;
	}

	return [
		"This bash command mixes a long-running service launch with follow-up orchestration in one shell invocation.",
		"",
		"Use start_background_service for the service/VM launch, then do setup/verification in separate steps.",
		"Do not hide the launch/orchestration inside a freshly written helper script; the same protocol still applies.",
		"That keeps the shell from hanging on fragile orchestration and improves readiness reliability.",
	].join("\n");
}
