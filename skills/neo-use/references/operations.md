# NeoUse Runner operations (macOS host + iPhone XCTest)

## Dependencies

- Xcode with signing identity, devicectl, paired real iPhone with Developer
  Mode and Settings > Developer > Enable UI Automation.
- Git for the official Appium WebDriverAgent checkout; system Python 3 to
  prepare a signed catalog, patch WDA, brand/re-sign the generated test host.
- NO Node.js, npm, embedded AppCopilotKit or always-on Mac MCP server.
- An existing Apple Development identity configured in an authorized Xcode
  project; NEVER hardcode credentials or publish device addresses.

Read neouse README and the public protocol SKILL.md before changing the runner.
Confirm current device and Xcode:

    xcodebuild -version
    xcrun devicectl list devices
    git -C ~/Workspace/neouse status -sb

## First install / start

    cd ~/Workspace/neouse
    export NEOUSE_TEAM_ID=ACTUAL_SIGNING_TEAM
    export NEOUSE_WDA_RUNNER_BUNDLE_ID=com.example.neouse.WebDriverAgentRunner
    ./scripts/start-wda.sh ACTUAL_IPHONE_COREDEVICE_ID

The start script clones official WDA into ignored .state/WebDriverAgent,
installs NeoUse native MCP commands, obtains a host-synchronized App catalog,
generates the local bearer token, builds the iOS test host, sets its
CFBundleDisplayName to NeoUse, re-signs it, and runs test-without-building.
The xcodebuild test process must stay active for WDA HTTP to serve requests.

Record ServerURLHere from its test log. Verify /status returns ready:true.
Never rely on an old iPhone LAN IP.

Check actual installed name using:

    xcrun devicectl device info apps --device DEVICE_ID --include-all-apps

Search for NeoUse, with the existing .xctrunner Bundle ID. App display name
and technical Bundle ID are separate; do NOT rename the latter unnecessarily.

## MCP and Sessions

MCP URL: http://OBSERVED_IPHONE_IP:8100/mcp
Bearer: contents of ignored .state/native-mcp-token (0600).

MCP client calls:

    initialize (JSON-RPC 2.0, protocolVersion 2025-03-26)
    tools/list
    tools/call: neouse.apps {"query":"ToyAlive"}
    tools/call: neouse.session.start {"app":"ToyAlive"}
    tools/call: agent.pilot {"session_id":"returned-id","command":"snapshot"}
    tools/call: neouse.qa.list {"session_id":"returned-id"}
    tools/call: neouse.session.close {"session_id":"returned-id"}

The host App catalog is a **snapshot embedded at build time**; rebuild Runner
to reflect newly installed Apps. Calls must not pass conflicting Bundle IDs.
Competing Sessions get device_busy; close in finally.

To verify without Node or mutation, after WDA is ready run:

    python3 scripts/verify-native.py --base-url http://OBSERVED_IPHONE_IP:8100 --app ToyAlive

If ToyAlive is installing, unavailable or currently being developed by
another task, do not force reinstall/uninstall. Report iOS's actual error.
No QA Bridge tools are guaranteed until ToyAlive implements the public
NeoUse QA Bridge v1 contract.

## Security / teardown

WDA's native /mcp requires a bearer, but the upstream WebDriver HTTP endpoints
are NOT covered by that protection. Keep the endpoint on trusted local networks
only, or use a secure developer tunnel. Stop only the xcodebuild test process
that this task started after using the Runner, unless the user explicitly
wants it left running. Leaving the signed NeoUse App installed is fine.
Never commit .state contents, token, signing certs, App inventory or screenshots.

## Troubleshooting

- Timed out enabling automation: unlock phone, verify UI Automation setting,
  accept XCTest trust prompt.
- Missing App: ensure host catalog was rebuilt with devicectl
  --include-all-apps; old snapshots are not live App inventory.
- Restarting after unexpected exit: inspect Xcode xcresult and the device's
  actual test host process. Do not report a successful long-running service.
- Session start Busy installing/uninstalling: wait until the device finishes
  the other install, rather than replacing installed App data.
- QA Bridge not_supported: App lacks a DEBUG bridge or wasn't explicitly
  relaunched with authorized Session variables; normal pilot still works.
