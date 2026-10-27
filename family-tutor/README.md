# Family Tutor

Family Tutor is a local Neo Project in the `lalalic/neo` monorepo. It runs on
the Neo Master; it is not a hosted multi-tenant product.

```text
Discord private child / parent channels
               |
               v
Local Discord Gateway (PM2: family-tutor/local)
               |
               v
Isolated Browser Workspace / ChatGPT learner thread
               |
               v
Reply to verified origin / minimal parent telemetry
```

The canonical normal workflow is [graph.mmd](graph.mmd). [AGENTS.md](AGENTS.md)
defines privacy, Task ownership and acceptance rules. Project-specific roles
are under `agents/`. The project uses Browser Workspace for ChatGPT sessions.

## Lifecycle

```bash
./neo-project setup
./neo-project start
./neo-project status
./neo-project health
./neo-project restart
./neo-project stop
./neo-project uninstall
```

Setup creates private `runs/family/config/family.config.json` only if absent,
and packages the local service. It does not start the service. Configure a
parent channel and child identifiers before start; supply `DISCORD_BOT_TOKEN`
through the Neo Master service environment. Never commit credentials or
learner state. Uninstall only removes its PM2 entry.

The local Discord Gateway uses an outbound Discord connection. The bundled
loopback bridge is part of the same process and is not a separately deployed
MCP service. There is no public inbound listener, independent website,
Cloudflare Worker, Durable Object or Chrome extension requirement.

Real Discord delivery must be verified before switching off the old service.
Learner Project/thread bindings and private runs must be preserved.
