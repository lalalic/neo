# iPhoneHelm App Actions — Agent reference

## Why two repositories?

- `iphone-helm`: native iPhone XCTest MCP engine, generic MJS Action Runner/CLI, device Session handling, Demo capture.
- `iphone-helm-actions`: separately installed, upgraded and versioned App-specific Action `.mjs`, `manifest.yaml`, `experiences/*.md` and tests. No Python App Actions and no Mac MCP server.
- `iphone-helm` Skill: all installation scripts and Agent documentation required to operate the above. It is an independent artifact and does not rely on developer checkout paths.

## Installation / upgrade

Use the Skill's bundled scripts. `setup.sh` clones the engine and links the `iphone-helm` CLI; it deliberately does not download Actions. `actions-install.sh` clones `iphone-helm-actions` under `~/.local/iphone-helm/actions` and registers whatever manifests are present. `actions-upgrade.sh` updates **only** that checkout via clean, fast-forward Git pull. `upgrade-engine.sh` upgrades **only** the engine. Neither command overwrites locally modified source, and neither restarts a Runner or takes over a live Session.

## Runtime command discovery

```sh
iphone-helm --help
iphone-helm actions status
iphone-helm app list
iphone-helm app profile wechat
iphone-helm app source wechat find-moments
iphone-helm app run wechat inspect --input '{}'
```

**Use App Actions first** when verified for the goal. A manifest's `effect` is a hard permission boundary: `read`, `navigation`, `local_write` or `external_write`. The CLI refuses external writes without `--approve-external-write`, and every Action must still verify its own actual result. The Session is acquired for the correct App and closed on success and failure. No App Action should silently retry an uncertain side effect.

**Creating or repairing Actions:** follow [App Action development](app-action-development.md) for the canonical folder layout, manifest grammar, complete Helper API, MJS examples, tests and publication gates.

## Experience vs Action

- `actions/*.mjs`: executable `export default async function run({ helpers, input, approved }) { ... }`; receives a restricted `helpers` interface over the native iPhone MCP.
- `experiences/*.md`: what the Agent learned about navigation, selector quirks, recovery and real-device evidence; this is not executable source.
- `tests/*.test.mjs`: contract and real-device conformance, with positive and negative paths. Do not claim real iPhone PASS from mocks.

## Target-specific rules

- **WeChat:** validate 2022 by personal Moments publication-year header, not by matching `2022` text in a newer post. Saving an image requires actual phone photo-album success evidence; a screenshot is not an original saved photo. Publication is not claimed functional until its specific media selection/publish receipt has passed on a real device with explicit approval. Never publish third-party photos or private chat data.
- **ToyAlive:** DEBUG-only QA Bridge read (`qa.model.inspect`) and denied unauthorized write. Demo overlays must be paired with actual real-phone video capture and final Markcut verification; merely setting a `step` overlay does not render MP4.

## Failure handling

Device busy, wrong foreground App, invalid/expired owner token, unknown outcome, ambiguous selector, partial snapshot, unverified media save or publish are blockers, not success. Do not steal other tasks' runners, replay uncertain external changes, or use the Simulator for real-device proof.
