---
name: apple-delivery
description: Directly build, sign and install iOS apps on a paired physical iPhone without TestFlight, or release iOS apps from any Neo Project to authorized internal TestFlight groups using a shared App Store Connect API-key CLI. Includes certificate/provisioning checks, deterministic build bump, encryption export compliance, tester assignment and verified release state. Use for TestFlight, App Store Connect builds, signing or Missing Compliance on Neox/ToyAlive/other apps.
---

# Apple Delivery

Goal: install an authorized development build directly on a physical iPhone for testing, or make an authorized iOS build available to its **existing internal TestFlight testers** with one repeatable, auditable flow. Do not confuse a compiled archive, uploaded binary, Apple `VALID`, internal beta availability, or an installed iPhone build.

## Direct physical iPhone install (development / QA)

For local app testing, use the direct install workflow **before considering TestFlight**. From an iOS project root (e.g. Neox or ToyAlive) with its optional `apple-delivery.json` and project wrapper:

```bash
scripts/testflight.py install --dry-run
scripts/testflight.py install --launch
# If multiple eligible devices are connected, explicitly select the intended one:
scripts/testflight.py install --device COREDEVICE_ID --launch
# Reuse a previously built, signed app matching this project's bundle/version/build:
scripts/testflight.py install --app /absolute/path/to/App.app --launch
```

The same script supports ordinary Xcode projects and workspaces, including apps never registered with App Store Connect. Without a wrapper or config, invoke the global Skill script directly:

```bash
python3 ~/.agents/skills/apple-delivery/apple_delivery.py --project /path/to/app install \
  --xcode-project App.xcodeproj --scheme App --bundle-id com.example.app --launch
# For a workspace, replace --xcode-project with --workspace App.xcworkspace.
# Or install an already signed device bundle:
python3 ~/.agents/skills/apple-delivery/apple_delivery.py install \
  --app /path/to/App.app --bundle-id com.example.app --launch
```

Discover the current Skill with `neo skill list --project PATH`. Local-only config needs only `bundle_id`, `scheme`, and `project` or `workspace`; a prebuilt app needs only its expected bundle ID. `team_id`, `configuration` (default Debug), `generator` (auto, none, xcodegen), and the existing paired `version_source`/`version_file` fields are optional. If versions are not configured, read them from the built Info.plist and compare with device inventory. Preserve project signing settings; XcodeGen is used automatically only when project.yml exists, or explicitly selected. No App Store Connect registration, API credentials, distribution certificate, or export classification is required for local installation. The default expects exactly one eligible paired iPhone with Developer Mode enabled. `--allow-provisioning-updates` explicitly opts in to automatic provisioning changes. Release retains its full configuration and authorization gates.

The command probes actual private-key signing before compilation, builds for `generic/platform=iOS` (not an iPhone destination, which can fail on developer disk image mounting), verifies the signed bundle identity, installs via `xcrun devicectl`, and checks the exact installed bundle/version/build. Private logs and build products are under the project's ignored `runs/device-install-*`. No uninstall, simulator substitution, credential extraction, ACL changes or automatic TestFlight fallback. For a signing error `errSecInternalComponent`, inspect the legitimate Keychain access prompt, unlock the login Keychain using Keychain Access if needed, and retry the command. A transient signing error during build permits one incremental retry only after a fresh signing probe succeeds. An install timeout is uncertain: inspect the device app inventory before trying again. A launch acknowledgement is not UI evidence; use `iphone-helm` on the authorized physical device for acceptance, and deploy the matching backend separately when required.

## Capabilities

1. **Prepare** an app from its project-owned `apple-delivery.json`: verify the exact bundle/app/team, Apple API key, version/build number, Xcode signing identities and cached provisioning. The shared CLI takes deterministic decisions; do not re-discover known IDs each release.
2. **Release**: increase the build number, XcodeGen/archive Release, automatically refresh signing with the authorized API key, export/upload and read back the exact build.
3. **Resolve export compliance**: verify the per-app reviewed encryption classification in generated `Info.plist`; if Apple still shows Missing Compliance, apply only that reviewed classification using `PATCH /v1/builds/{id}` and read back. If a new library changes encryption, stop and reassess first; never equate *exempt encryption* with *no encryption*. If nonexempt encryption requires documentation, use Apple's approved declaration/code instead of claiming exemption.
4. **Distribute and verify**: link only the configured **existing internal** beta group, confirm Apple `IN_BETA_TESTING`, inspect TestFlight web UI for compliance and tester visibility, then verify on the real iPhone. No public App Store or external tester actions.

## Commands

In an iOS project's root, use the thin project wrapper (Neox and ToyAlive have this):

```bash
scripts/testflight.py doctor
scripts/testflight.py release --bump
scripts/testflight.py status --build 17 --resolve-compliance --assign-group
```

To use the skill directly in any project:

```bash
python3 ~/Workspace/neo/skills/apple-delivery/apple_delivery.py --project /absolute/project/path doctor
python3 ~/Workspace/neo/skills/apple-delivery/apple_delivery.py --project /absolute/project/path release --archive /absolute/build.xcarchive
```

Use `release --dry-run` for a read-only preflight. `status` is read-only unless `--resolve-compliance` or `--assign-group` is supplied. `release` performs both after verified upload/processing, based strictly on project configuration. Credentials: already-authorized local `~/.private_keys/AuthKey_<key_id>.p8` mode `0600` (or `ASC_PRIVATE_KEYS_DIR`), never copied into source/logs. `--bump` deliberately changes the project version file and must be committed separately. Logs and receipts remain private in the project's ignored `runs/`.

## Boundary and completion

- Only deliver to the app and internal group in the verified configuration. Do not auto-create users, external groups, public availability or new compliance claims.
- A previously approved `false` value for `uses_non_exempt_encryption` is reusable only while the app and linked crypto dependencies match that assessment. If not, inspect capabilities and ask for a new classification; do not blindly patch Apple.
- The CLI never signs away Keychain private-key access prompts. A blocked macOS `SecurityAgent` is a distinct authorized-user gate, not failed Apple API authentication; timeout with a clear diagnostic.
- Even after successful API readback, inspect the **App Store Connect TestFlight website** for the exact build and actually check/install it in TestFlight on a phone. Mark those gates unverified if not checked. See [`docs/testflight-release-playbook.md`](../../docs/testflight-release-playbook.md) for provider compliance and E2E guidance.

## Tests

`python3 -m unittest discover -s skills/apple-delivery/tests -p 'test_*.py' -v` covers positive/negative cases; see `evals/README.md` for capability coverage. Do not run real upload or mutate Apple state as a unit test.
