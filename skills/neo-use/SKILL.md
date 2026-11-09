---
name: neo-use
description: Install, start, inspect and use the neouse iPhone XCTest runner; discover apps and tools, and implement the public NeoUse QA Bridge v1 session-scoped federation protocol.
---

# NeoUse — public QA Bridge v1

Use for neouse installation, iPhone testing, app enumeration, QA tool registration, session control, and recovery. **This Skill defines the public, implementer-independent protocol.** No shared Swift package is required; any App may implement the wire contract.

## Architecture

- **Runner:** one signed iPhone XCTest host App branded NeoUse (CFBundleDisplayName); its technical XCTest Bundle ID does not need to change. One WebDriverAgent executor per device. It offers MCP tools for sessions, UI control and QA tool federation.
- **App QA Bridge:** opt-in QA builds can expose a tiny HTTP/1.1 JSON listener on iPhone loopback (`127.0.0.1`), without MCP, App Groups, Bonjour or external HTTP exposure.
- **Limit:** iPhone has one active foreground UI. Concurrent sessions are allowed on different devices, **not on one device**; a paused/background App cannot be assumed to serve QA requests. Xcode may be required to start XCTest and enumerate installed Apps.

## Session contract (normative)

**Start:** `neouse.session.start({"app":"ToyAlive","device_id":"optional"})` resolves the installed App name once, atomically acquires an exclusive lease for that physical device, activates the App and verifies foreground ownership, negotiates QA Bridge discovery when supported, and returns:

```json
{"session_id":"c153e952-5d4a-4aaf-a4ef-4f000fc0eabe","device_id":"paired-device-id","app":"ToyAlive","bundle_id":"com.lalalic.toyalive","expires_in_seconds":900,"qa_tools":["qa.model.inspect"]}
```

- Device lock MUST be acquired *before* async App switching or tool discovery. A competing start returns `device_busy`; never switch its target App, steal its WDA session or inject tools into its MCP client.
- Session scope is **(device, app, owner/client identity, unpredictable session_id)**. A session ID is not itself an authentication credential. Tools can use an authenticated per-connection session binding, or include `session_id` explicitly. In the portable MCP tool interface, use `session_id` on all control and QA calls. **No per-tool app name or bundle_id:** Runner fills it from the bound Session and ignores/rejects contradictory target arguments.
- Tools from one App are never visible/invocable in another Session. Federation keeps identity keyed by `(session_id, bundle_id, tool_name)`. Dynamic MCP tool registration is optional; stable tools `neouse.qa.list({session_id})` and `neouse.qa.call({session_id,name,arguments})` are mandatory for clients that do not support dynamic tool refresh.
- UI and QA operations MUST be serialized within the device lease, even from concurrent MCP clients. Refresh element refs after each snapshot, action or switch. A failed, closed, expired, wrong-owner or wrong-session call MUST error without operating the device.
- **Close:** `neouse.session.close({"session_id":"..."})` first drains or cancels in-flight operations, revokes the QA token, clears refs and dynamic tools, releases the device lease, and returns `{"closed":true}`. Closing the same completed Session is idempotent; a stale ID cannot close a newer Session. App termination is optional, never implicit.
- **Liveness:** `neouse.session.status({session_id})` and `neouse.session.renew({session_id})` support an idle TTL (default 900 seconds; configurable). Expiration invalidates tools and releases the lease only after in-flight operations finish. Unexpected WDA termination or App backgrounding invalidates QA federation; never silently redirect a request to another App.
- Treat `neouse.app select/activate` without a Session as **legacy**, unavailable while any Session owns the device. New orchestrations use start → tool calls → close in a `finally` block. Do not claim a device lease is enforced by an older implementation until tests prove it.

## App QA Bridge v1 wire format (normative)

**Activation:** Runner creates a random 256-bit token, UUID and available port. It launches an *explicit QA build* with `NEOUSE_QA_PROTOCOL=1`, `NEOUSE_QA_PORT=<1024..65535>`, `NEOUSE_QA_TOKEN=<64 hex digits>`, `NEOUSE_QA_SESSION=<UUID>`. No implicit App relaunch to inject values. No QA listener in production. Avoid logging launch tokens.

**Transport:** HTTP/1.1 JSON on iPhone `127.0.0.1` only, authenticated with `Authorization: Bearer <token>`, checked in constant time; `Accept: application/json`, `Content-Type: application/json` for POST, `Cache-Control: no-store`. Maximum body 64 KiB; response 256 KiB; no redirects or public bindings.

**Discovery:** `GET /neouse/qa/v1/tools` returns:

```json
{"protocol":"neouse.qa/1","bundle_id":"com.example.app","session_id":"UUID","tools":[{"name":"qa.model.inspect","description":"Inspect scene","inputSchema":{"type":"object","properties":{}},"effect":"read"}]}
```

Tool names must match `^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$` and be unique within the App. `effect` is `read` or `write`. Runner checks session UUID and bundle ID against the active lease. Discovery must not run a tool.

**Call:** `POST /neouse/qa/v1/call` with `{"id":"UUID","name":"qa.model.inspect","arguments":{}}`. Success HTTP 200: `{"id":"UUID","ok":true,"result":<JSON value>}`. Failure HTTP 4xx/5xx: `{"id":"UUID","ok":false,"error":{"code":"unauthorized|not_ready|unknown_tool|bad_arguments|forbidden|timeout|internal","message":"..."}}`. Same-session repeated call IDs cannot re-execute side effects; cache or reject duplicates. Write effects are not authorization to send messages, pay, delete or publish. An authenticated `POST /neouse/qa/v1/close` returns HTTP 200 with `{"ok":true,"session_id":"UUID"}` and then closes the App's QA listener. The Runner MUST call it on Session.close or expiration before forgetting the temporary token. A repeated close is safe and never revives an old Session.

## Universal NeoUse Virtual Demo Overlay (normative)

`agent.demo` is implemented by the **NeoUse XCTest Runner**, not by an App
QA Bridge. No App package, UI overlay, App Group, or developer-defined
`qa.demo` is required, including for third-party Apps.

- Commands: `step(title)`, `spotlight(ref|label,text?)`, `annotate(ref|label,text)`,
  `caption(text)`, `say(text)`, `cursor(ref|label)`, `highlight(ref|label)`,
  `clear`, `pause`, `resume`, `wait(ms)`, `status`, `start_recording`,
  `stop_recording`. For target commands, the Runner maps a *fresh* XCTest
  element ref/label to screen-point `frame:{x,y,width,height}` in the current
  Session. Reject stale refs, target-App mismatches and invalid coordinates.
- Rendering: a virtual overlay is drawn on **NeoUse-produced screenshots
  and MJPEG frames only**. It must not alter the other App's real UI or
  intercept touch input. The next MJPEG frame after a Demo call displays
  its caption/spotlight/step/cursor/highlight. `clear`, Session.close and
  expiry remove all overlay state.
- Transport: WDA MJPEG port 9100 emits the annotated live frames. Mac preview
  and FFmpeg recording subscribe to the same stream; do not implement a
  second App-local or Mac-only UI rendering engine. WDA's standard raw
  screenshot route remains available for debugging.
- Timing: `start_recording`/`stop_recording` record *only timestamped event
  metadata* and accurately report `video_recorded:false`. Video is captured
  by an independent Mac consumer of the annotated stream. Do not claim MP4
  capture from event recording alone. `say` currently captions an event;
  mixing narration audio into the MP4 is a separate capability.
- Security: upstream WDA MJPEG is unauthenticated; expose it only over a
  trusted local connection or authenticated tunnel. Secure the native MCP
  control route with its separate bearer token and Session lease.
- QA Federation is separate: `neouse.qa.list/call` still use the public
  opt-in App QA Bridge for internal debugging. Apps that do not implement
  QA Bridge retain the full universal `agent.demo` capability.

See [conformance cases](references/conformance.md). Simulator tests establish
protocol compatibility; require physical iPhone E2E for real-device PASS.

## Operating the Runner

1. Read [operations](references/operations.md), check actual Xcode, paired device, signing and NeoUse/WDA readiness. The first install must brand and re-sign the generated XCTest host App. An installed Runner is not necessarily running.
2. Call `neouse.apps {}` or `{"query":"ToyAlive"}` for installed Apps; the current Host inventory is gathered with `devicectl --include-all-apps` when the Runner is built, then synchronized to the iPhone; a new build refreshes the catalog.
3. New sessions: `neouse.session.start({"app":"ToyAlive"})`; call scoped `agent.pilot`, `agent.demo` and federated QA tools using the returned session ID. Do not send a new bundle ID with each tool call.
4. Always `neouse.session.close` in cleanup; stop only the WDA/Xcode process started for the task. Do not expose unauthenticated WDA HTTP to untrusted networks.

**Migration gate:** Keep the working AppCopilotKit in Neo Mobile/ToyAlive until the native Runner, bridge, device lease, and both Apps pass real iPhone conformance. A passing mock or design document is insufficient. See [conformance cases](references/conformance.md).

## Package policy

Public protocol compliance does **not** require a Swift package. The legacy public package may remain for QA tools until their migration passes real E2E. Any future small SDK is optional and must obey this Skill, not redefine it.
