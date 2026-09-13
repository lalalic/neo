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

Prefer a globally installed `pm2` when available; otherwise use `npx pm2` so a global installation is not required. Keep the supervised command in the foreground. Examples include:

```bash
npx pm2 start server.py --name api --interpreter python3
npx pm2 start app.js --name web
npx pm2 start ./run-service.sh --name worker
npx pm2 start npx --name cli-service -- <package-or-command> <args>
npx pm2 start uvx --name python-service -- <package-or-command> <args>
```

`npx` and `uvx` launchers are valid when the launched program remains a foreground, long-running process. Do not use `nohup`, a naked `&`, or an agent session as the service owner.

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
