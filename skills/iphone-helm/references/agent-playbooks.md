# iPhoneHelm Agent playbooks

This reference tells an agent what to *do*, what to *assert* and what to *deliver*. The physical iPhone's installed Runner may differ; discover tool support first. Use one App Session at a time.

## Development: bug reproduction

1. `neouse.apps({"query":"ToyAlive"})` → ensure exactly one intended target.
2. `neouse.session.start({"app":"ToyAlive","owner":"dev-repro-ticket"})` → save `session_id` and any `owner_token`.
3. `agent.pilot({"session_id":"...","owner_token":"...","command":"snapshot_fast"})` → record relevant visible IDs and snapshot `coverage`. On a layout defect, use `command:"screenshot"`.
4. For one intended UI action, prefer `agent.pilot({"command":"tap_locator","locator":{"identifier":"companion-settings"},"request_id":"dev-repro-1"})`. Verify a screen-specific postcondition using `command:"wait_for"` or another snapshot. If a locator is ambiguous, narrow it or explicitly target a measured screen coordinate after inspection; do not guess.
5. If available, use `neouse.qa.list` and a discovered **read** tool such as ToyAlive `qa.model.inspect` to diagnose internal state.
6. After the app fix, run the **same** sequence. Show before/after observable evidence; report gaps.
7. Always `neouse.session.close` in finally.

**Expected dev report:** build/device, bug scenario, expected/actual before, root cause if established, exact change, actual after, evidence, remaining issues. No false claims from a successful compile.

## QA: regression

1. Define checks: each has a precondition, steps, and visible or QA assertion. Read-only black-box tests are appropriate for any third-party app.
2. Acquire a Session. For WeChat, restrict to launch/read/safe navigation; never send or change account/contact information.
3. Observe `snapshot_fast` (or `snapshot_json` if refs are necessary). Only assert absence with appropriately scoped observations; partial snapshots cannot prove global absence.
4. Discover `neouse.flow.list`. A bundled flow is valid only for its declared target bundle ID. Use `neouse.flow.run({"session_id":"...","flow_id":"wechat/read-only-smoke"})` on current Runner when available. If a flow contains a mutation, it must have explicit approval and an idempotency `request_id`.
5. On outcome `unknown` or an uncertain timed-out action, do not replay. Inspect state and stop if uncertainty remains. Re-run only proven safe reads.
6. On a ToyAlive QA build, `neouse.qa.list` identifies tool names and effects. Verify one read effect and deliberately verify **rejection** of an unapproved write (without performing the write). After closing the Session, ensure old credentials cannot operate its QA tools.
7. Record performance with at least 30 comparable samples where feasible; include p50/p95 and sample size. Record test evidence without private UI data.
8. Release Session in finally.

**Expected QA report:** a PASS/FAIL/BLOCKED/NOT TESTED matrix, observed status per step, timing, actual device, build, logs/artifacts, and the release gate verdict.

## Marketing: product demo

1. Write a storyboard: target audience, 3–5 truthful feature beats, opening promise and closing result. Obtain a safe foreground App state, not a customer's private chat.
2. Rehearse `agent.pilot` actions; confirm semantic element IDs and expected screens before recording. Estimate timing using measured action duration plus headroom.
3. Create a timed plan of `agent.demo` overlays (`step`, `spotlight`, `caption`, `say`, `clear`) and real `agent.pilot` navigation. A narration command **does not** instantly make audio in the native stream; the Markcut export synthesizes it.
4. Run the capture companion from the iPhoneHelm installation with the physical iPhone's observed MCP endpoint and existing bearer token, for example:

   ```bash
   python3 "$HOME/.local/iphone-helm/engine/scripts/demo-session.py" capture \
     --mcp http://OBSERVED_IPHONE_IP:8100 \
     --token-file .state/native-mcp-token \
     --app ToyAlive --seconds 40 \
     --plan /path/to/demo-plan.json \
     --output-dir /path/to/new/clean/demo-output \
     --markcut /opt/homebrew/bin/markcut --render
   ```

   The output folder must be new or empty. When the Runner uses an owner token, ensure capture forwards it to **every** scoped call; otherwise do not attempt a session takeover.
5. Inspect the Demo `calls.json` for failed actions and the `timeline.json` for event times. Reject video if narration or a required interaction extends past actual duration; recapture instead.
6. Verify `ffprobe` reports an actual MP4 with H.264 video and an audio track, and `markcut verify` passes. Inspect representative frames for overlays and product content. Final deliverables: `capture.mp4`, `markcut/video.md`, `markcut/video.mp4`, `timeline.json`, and a **verified** share link if a link is requested.
7. Close the Session, stop only the task-owned capture process, and avoid exposing the source MJPEG endpoint publicly.

**Expected demo report:** storyline, duration, actual device, number of successful steps, voice/narration status, playable video, Markcut project, and issues or limitations.

## Action outcome interpretation

| Observed result | Agent meaning | Next step |
| --- | --- | --- |
| `outcome:applied, verified:true` | Input dispatched; requested observable postcondition met | Continue |
| `outcome:applied, verified:null` | Input dispatched, no postcondition proof | Observe/assert state before treating as success |
| `outcome:not_sent` | Input was rejected pre-dispatch | Fix selector/session and retry only if `retry_safe:true` |
| `outcome:unknown` | May have happened despite an error or timeout | Do not repeat a side-effecting command; inspect current state |
| `coverage:partial` | Returned UI elements are incomplete | Continue snapshot or narrow semantic search; no absence proof |
| `device_busy` / wrong-App session | Another owner or state mismatch | Do not take control; release task-owned resources and report |
