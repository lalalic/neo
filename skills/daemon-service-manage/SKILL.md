---
name: daemon-service-manage
description: Inspect and manage persistent daemons, services, and background processes across machines using SSH for access and PM2 for lifecycle, status, logs, restart, and persistence.
---

# daemon-service-manage

Use SSH to reach a machine and PM2 to manage persistent services. A daemon must not depend on the lifetime of Codex, pi, a shell, or a terminal session.

## Inspection first

For status and troubleshooting, inspect before mutating:

```bash
npx pm2 list
npx pm2 describe <service>
npx pm2 logs <service> --lines 200 --nostream
```

Remote inspection uses the same commands through SSH, for example:

```bash
ssh <host> 'npx pm2 list'
ssh <host> 'npx pm2 describe <service>'
```

Resolve unknown hosts or services from existing environment registries or configuration rather than guessing. Keep credentials, private keys, environment variables, and secrets out of output.

## PM2 lifecycle

Use `npx pm2` for PM2 operations so lifecycle management does not depend on a locally installed repository copy of PM2. More importantly, a PM2-managed application service must run from its distributable package launcher rather than directly from a developer checkout: use `npx` for Node/npm services and `uvx` for Python/PyPI services. Do not restart a managed production/persistent service by invoking source files from a local repository path.

Keep the supervised package command in the foreground. Examples include:

```bash
npx pm2 start npx --name cli-service -- <package-or-command> <args>
npx pm2 start uvx --name python-service -- <package-or-command> <args>
```

`npx` and `uvx` launchers are valid when the launched program remains a foreground, long-running process. Do not use `nohup`, a naked `&`, or an agent session as the service owner.

When updating or restarting an existing service, inspect `npx pm2 describe <service>` first. If its executable/script points into a local repository checkout, replace that PM2 definition with the package-backed `npx`/`uvx` command, verify the process is healthy, then `npx pm2 save`. A code checkout is for development and inspection; it is not the executable source of truth for a PM2-managed service.

Common lifecycle operations:

```bash
npx pm2 start <command> --name <service>
npx pm2 restart <service>
npx pm2 stop <service>
npx pm2 delete <service>
npx pm2 save
```

## First-time boot persistence

When PM2 is first used on a machine, configure its startup integration before
handing off a long-running service. Inspect first, then run:

```bash
npx pm2 startup
```

PM2 prints a platform-specific command, usually requiring elevated privileges.
Review that command and ask for authorization immediately before running it;
do not execute the printed `sudo` command silently. After the startup hook is
installed, save the current process list:

```bash
npx pm2 save
```

Verify the result by checking that the startup integration is registered and
that `npx pm2 resurrect` can restore the intended process list. On macOS this
normally creates a per-user launchd service; on Linux it normally uses
systemd. If startup integration is already present, do not recreate it—run
`npx pm2 save` after adding or changing services.

For a remote host, run both the inspection and setup through the same SSH
alias. Keep the PM2 process list and startup integration on the same user
account that owns the services. A PM2 process started from an agent session
can survive that session only after PM2 startup integration has been enabled
and the process list has been saved.

Before stop, restart, delete, log deletion, or startup changes, confirm the target and that the requested mutation is authorized. Do not recreate a missing service blindly; inspect its expected command and working directory first.

For reboot persistence, use PM2's supported startup integration and `npx pm2 save`. Do not silently execute privileged commands printed by `npx pm2 startup`; surface them for authorization.

## Multiple machines and failures

Use existing SSH aliases. Do not introduce Ansible, Kubernetes, a custom control plane, or another orchestration layer for ordinary operations.

If SSH fails, report the host and distinguish alias/DNS, authentication, timeout, and connection-refused failures from service failures. If the host is reachable but PM2 is unavailable, report that separately and inspect whether another service manager owns the process.

## Event-driven package service updater

For package-backed PM2 services that should follow successful package releases, use the external updater in this skill rather than making the publishing application or its orchestrator restart itself.

The release producer emits a canonical `package.published` events-bus fact only after the exact package version is pullable. The updater subscribes to `neo.events.job.*.package.published`, maps the package through local configuration, restarts the existing PM2 service definition, verifies it, saves PM2 state, and emits `service.deploy.started`, `service.deploy.completed`, or `service.deploy.failed`.

Tracked source contains no machine-specific mapping. Copy `references/package-service-updater.example.json` to `~/.neo/package-service-updater.json` and customize it locally. State is stored at `~/.neo/package-service-updater-state.json`; both are outside Git.

Each package entry supports:
- `pm2Service`: required existing PM2 process name.
- `settleMs`: optional delay after restart before verification.
- `healthCommand`: optional argv array; exit 0 means healthy.
- `versionCommand`: optional argv array; stdout must equal the published version.
- `verifyTimeoutMs`: optional per-command verification timeout.
- `verifyAttempts`: optional health/version retry count (default 10).
- `verifyIntervalMs`: optional delay between verification attempts (default 1000 ms).

The updater always checks `npm view <package>@<version> version` first. It never edits the PM2 process definition, so the service must already use the package-backed launcher contract described above. Duplicate package/version events are ignored after a successful deployment. Failed verification does not update deployment state and does not run `pm2 save`.

Run directly:

```bash
node ~/Workspace/neo/skills/daemon-service-manage/scripts/package-service-updater.mjs
```

On macOS, keep the updater outside the PM2 process tree it manages. Install it as a per-user LaunchAgent:

```bash
~/Workspace/neo/skills/daemon-service-manage/scripts/install-package-service-updater-macos.sh
```

The installer copies the updater plus its events-bus transport/dependencies into a durable runtime under `~/.neo/package-service-updater/runtime`, writes `~/Library/LaunchAgents/com.neo.package-service-updater.plist`, and starts the per-user service from that runtime. Logs and mutable state stay under `~/.neo/`. Re-run the installer after updating this capability. Do not add the source checkout script to PM2; PM2-managed application services must continue to use distributable package launchers.

The updater is deliberately outside Agents Relay. Agents Relay may emit release facts; it must not own package-to-service mappings, PM2 restart policy, or deployment health checks.

Deployment event sources are domain identities such as `service-updater/<host>/<service>`. Do not reuse or infer model-worker ownership from them. Model-backed task lifecycle remains bound to the exact execution source id `job/<job-id>/task/<task-id>/execution/<execution-id>`.
