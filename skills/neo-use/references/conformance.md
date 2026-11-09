# NeoUse QA Bridge v1 conformance checks

## Native MCP and sessions

1. iPhone install reports CFBundleDisplayName NeoUse while preserving the signed XCTest host Bundle ID.
2. /mcp rejects no/invalid bearer, initializes as NeoUse, exposes the Session tools.
3. Session start binds correct foreground Bundle ID and returns unpredictable session_id.
4. Concurrent start receives device_busy without switching Apps.
5. Wrong/expired/closed session_id cannot call pilot, demo or QA tools.
6. An App switch invalidates UI refs and QA tools; close releases the lease without implicitly deleting App data.
7. App inventory includes non-developer Apps only when host has synchronized the full devicectl catalog.

## App-local QA Bridge

1. Only the selected DEBUG QA build starts 127.0.0.1 listener after validated launch env values.
2. Missing/wrong bearer -> HTTP 401. 64 KiB request / 256 KiB response limits enforced.
3. GET /neouse/qa/v1/tools returns protocol, exact Bundle ID and Session UUID; each tool includes effect and schema.
4. App different from Session or wrong Session UUID -> federation is rejected.
5. POST /neouse/qa/v1/call returns the exact call ID and JSON result. A repeated ID must not execute a side effect twice.
6. Read-only QA call succeeds; stateful QA call is refused without explicit authorization.
7. Background/close invalidates listener and Session token. No unrelated App's QA tools can be called.

Use both protocol-level negative tests and real iPhone XCTest. Compilation, simulator tests and WDA installation are not sufficient by themselves.

## Universal native Demo overlay E2E

1. No target App QA Bridge or App-supplied Demo renderer is required.
2. After `agent.demo step/caption` the **next** native pilot screenshot and
   MJPEG frame show a visible overlay in the correct screen coordinates.
3. `spotlight/annotate/cursor/highlight` resolve a fresh XCTest ref/label,
   apply correct orientation and pixel scale, and reject stale references.
4. Mac preview consumes native MJPEG; a separate FFmpeg process captures
   those annotated frames into a playable MP4 and timestamps match events.
5. `clear`, Session.close and lease expiry remove the overlay, and a new
   Session cannot see the previous Session's decorations.
6. Raw WDA screenshot remains unmodified; demo output must not intercept
   touches or change the physical target App screen.
7. Test on Simulator first, then physical iPhone before declaring complete.
