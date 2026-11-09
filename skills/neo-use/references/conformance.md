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
