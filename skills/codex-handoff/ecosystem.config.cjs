module.exports = {
  apps: [{
    name: 'codex-handoff-worker',
    script: './worker/pm2_entry.js',
    interpreter: 'node',
    cwd: __dirname,
    instances: Number(process.env.CODEX_HANDOFF_WORKERS || 4),
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 5000,
    env: {}
  }]
};
