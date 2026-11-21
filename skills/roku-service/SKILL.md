---
name: roku-service
description: Manage Roku Neo native Rust backend, WebHelm IYF Actions, and iPhone photo wall.
requires:
  skills:
    - daemon-service-manage
---

# Roku Service (Rust)

The canonical service is one native Rust executable, supervised by Neo
service management under the name roku-service/server (PM2-backed Neo CLI).
The installed executable is:
~/.local/lib/neo-roku-service/1.0.0/neo-roku-service

Do not run the persistent process from a development checkout.

## Responsibilities

- Preserve Roku Neo HTTP API at 10.0.0.111:8788: health, service/status,
  home, search, episodes, play, live, photos/albums, photos, photos/image,
  photos/select, register, catalog, demo, demo.mp4, simulator.
- IYF website access exclusively through WebHelm iyf Platform Actions with
  --auto-session. Browser sessions are recycled, never held by Roku.
- iPhone photos through Neo Phone MCP media.albums, media.search,
  media.thumbnail and phone.transaction.start/end. Keep cached JPEG photos
  available when phone is offline. No cloud photo uploads.
- Roku native app stays under ~/Workspace/iyf-roku/channel.
- Spotify playlist entry and backend are intentionally removed.

## Management

neo service status roku-service/server
neo service restart roku-service/server --apply
neo service stop roku-service/server --apply
neo service start roku-service/server --apply
npx pm2 logs roku-service/server --lines 100 --nostream

Neo CLI service commands currently use PM2. Do not claim native launchd
reboot persistence without verifying PM2 startup integration.

Health: http://10.0.0.111:8788/service/status must report engine=rust.
The photo endpoints allow only the Neo Master and Roku LAN addresses.

## Build and rollback

Source directory: ~/Workspace/iyf-roku/rust/
cargo fmt --check; cargo clippy --all-targets -- -D warnings;
cargo test; cargo build --release

Python comparison test: ~/Workspace/iyf-roku/tests/rust_parity_e2e.py
Uses staging ports and a synthetic iPhone MCP. Run before retirement.

The original Python wheel remains in
~/Library/Application Support/NeoRoku/build/neo_roku_service-1.0.7-py3-none-any.whl
as rollback only. Do not run Python and Rust on production port concurrently.

When changing a service, inspect PM2 existing definition, verify staging,
and health-gate production replacement before saving PM2 state.
