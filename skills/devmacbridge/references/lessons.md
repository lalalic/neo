# Runtime notes

- Resolve every path from the skill directory; never assume where the skill is installed.
- The upstream checkout lives at `<skill-folder>/devmacbridge` and remains unmodified.
- `MAC_DEV_BRIDGE_DATA_DIR` is `<skill-folder>/.state`.
- PM2 owns two independent services: `devmacbridge-http` and `devmacbridge-tunnel`.
- Restarting only `devmacbridge-http` preserves the current Quick Tunnel hostname.
- The current hostname is the latest `https://*.trycloudflare.com` entry in `<skill-folder>/cloudflared.log`.
- Never print the consent token; copy it from `<skill-folder>/.state/http-token`.
