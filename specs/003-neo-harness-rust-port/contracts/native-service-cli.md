# Native PM2 / NeoY launchd Service CLI

The Rust Harness is only the CLI facade. Actual process supervision and
restart policy belong to the already installed PM2 and NeoY native launchd.

- `neo-rs service list` queries `pm2 jlist` and `launchctl print
  gui/UID/com.neox.neoy.keepalive`. The native launchd NeoY record takes
  priority over obsolete PM2 `neoy` / `neoy/app` duplicates.
- `neo-rs service status NAME` resolves only a discovered managed service.
- `neo-rs service start|stop|restart NAME --apply` requires a valid exact
  service name from the current inventory and an explicit `--apply` marker.
  It delegates to `pm2` for PM2 services, or `launchctl kickstart [-k]` for
  NeoY, never shell interpolation, arbitrary launchd labels or direct PIDs.
  `service stop neoy/app` remains deliberately prohibited because its native
  launchd keepalive owns the lifecycle.
- External inventory commands have a 20-second execution bound and 16 MiB
  captured output bound, without creating another service registry.
- Read-only **live** Neo Master smoke: Node and Rust `service list` return
  **identical JSON**, ten named services including one NeoY launchd entry.
- Disposable PM2/launchctl mocks: 3 tests pass, including list/status parity
  and fake explicit-write delegation. No production service writes executed.
- Rust all-suite regression after this slice: **74/74**; strict Clippy passes;
  existing Node `neo-control` tests **15/15**.
