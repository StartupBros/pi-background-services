# pi-background-services

Robust background service orchestration for [Pi](https://github.com/badlogic/pi-mono).

This package helps Pi start long-running processes more reliably by giving the agent a first-class tool for detached launches, stable readiness checks, and tracked process cleanup.

It is especially useful for tasks involving:

- dev servers
- workers
- SSH daemons
- tunnels
- local APIs
- QEMU VMs
- Docker Compose services
- any process that must keep running after the current tool call finishes

## Why this exists

Terminal agents often make the same mistake:

1. start a long-running process
2. mix launch, setup, retries, and verification into one giant `bash` command
3. accidentally hang the shell, lose observability, or race readiness

`pi-background-services` pushes Pi toward a better protocol:

**launch → verify → continue**

That improves both benchmark behavior and real day-to-day developer workflows.

## What it provides

### `start_background_service`
Starts a persistent process fully detached from the active shell.

Features:
- detached process group
- pid file
- stdout/stderr log files
- optional repeated readiness probes
- stable-success requirement via consecutive probe passes

### `list_background_services`
Lists tracked background services, including process health and log paths.

### `stop_background_service`
Stops a tracked service cleanly, with optional forced escalation.

### Prompt-time service guidance
For service-like tasks, the package injects compact protocol guidance so Pi prefers robust detached launches and stable readiness checks.

### Guard against brittle monolithic bash orchestration
The package can block or warn on bash commands that try to do all of this in one shell invocation:
- launch a long-running service
- run follow-up orchestration
- perform verification and retries inline

This is the behavior that materially improved `qemu-alpine-ssh` in Harbor + Terminal-Bench.

## Install

### Install from GitHub

```bash
pi install git:github.com/StartupBros/pi-background-services
```

### Try without installing

```bash
pi -e git:github.com/StartupBros/pi-background-services
```

### Install from a local checkout

```bash
pi install /absolute/path/to/pi-background-services
```

## Configuration

Configuration is optional and currently environment-variable based.

### Guard mode

```bash
export PI_BACKGROUND_SERVICES_GUARD_MODE=block
```

Options:
- `block` (default) — block brittle monolithic service-launch bash commands
- `warn` — allow the command but warn in the UI
- `off` — disable the guard

### Disable tooling or guidance

```bash
export PI_BACKGROUND_SERVICES_ENABLE_TOOLING=false
export PI_BACKGROUND_SERVICES_ENABLE_GUIDANCE=false
```

### Custom service registry root

```bash
export PI_BACKGROUND_SERVICES_ROOT_DIR=/tmp/my-pi-services
```

## Example

Instead of asking Pi to improvise a single shell blob, Pi can use:

- `start_background_service` to launch the service
- `list_background_services` to inspect tracked services
- `stop_background_service` to clean up afterward

## Development

```bash
pnpm install
pnpm check
pi -e .
```

## Validation so far

This package started as a Pi-local extension during Harbor + Terminal-Bench forensics.

Notable early result:

- `qemu-alpine-ssh` on `gpt-5.4 x5`
  - before: `60% (3/5)`
  - after: `80% (4/5)`

Additional smoke tests after cleanup:
- `hf-model-inference` on `gpt-5.1` passed
- `pypi-server` on `gpt-5.1` passed

## Scope

This package is intentionally focused on persistent process orchestration.

It is not a general process manager, container orchestrator, or init system. It gives Pi better primitives for the common agent workflow of starting a service, verifying readiness, and moving on.

## License

MIT
