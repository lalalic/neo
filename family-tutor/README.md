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

## Guided setup

Open Neo.app → Projects → Family Tutor → **Setup with Agent**. Neo.app opens a new user Chrome tab with a ChatGPT prompt pointing @neo to the absolute [setup/bootstrap.md](setup/bootstrap.md) path. The agent resumes the existing Discord bot, child/parent channels and persistent ChatGPT Project threads, then verifies real first-Hello replies and parent status. This interactive setup is separate from the technical lifecycle script below.

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

The local Discord Gateway uses an outbound Discord connection. Discord replies
are sent by the Runtime, not by an Agent-owned Discord MCP Tool. ChatGPT turns
use existing Project/thread bindings without any app mention. There is no
website, Cloudflare Worker, separate MCP Server or Chrome extension requirement.

Run `node scripts/verify-chatgpt-bindings.mjs` to check both configured learner
threads without sending a message. Then follow [e2e.md](e2e.md) for authorized
interactive acceptance. Never automatically replace missing Project bindings.
