# Codex handoff

The handoff skill defines the Drive-backed task lifecycle and the local worker
that executes one NEW task per run. SKILL.md is the concise operating contract;
protocol and notification details live in references/.

## Local PM2 lifecycle

    ./scripts/install-pm2.sh
    npx pm2 status codex-handoff-worker
    npx pm2 logs codex-handoff-worker
    npx pm2 restart codex-handoff-worker
    npx pm2 stop codex-handoff-worker

The PM2 process inherits the existing environment, including the optional
local-only CODEX_HANDOFF_IMESSAGE_RECIPIENT. It does not store recipient
values in this tree.
