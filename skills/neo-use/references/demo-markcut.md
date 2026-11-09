# NeoUse Demo → Markcut

## Choose the user outcome

- **Live Demo**: invoke `agent.demo` for an active Session. NeoUse XCTest draws annotations on its outgoing screenshot and MJPEG stream. The target App is unmodified.
- **Record and deliver Markcut video**: use Mac `scripts/demo-session.py capture` with an App name, duration and optional timed action plan. It starts/ends the Session, captures annotated MJPEG, and generates `video.md`, assets and an optional rendered MP4.
- **MCP start/stop controls recording**: run `scripts/demo-session.py watch` on the Mac **before** calling `agent.demo start_recording`. The watcher observes the native Session, captures MJPEG, then exports Markcut on `stop_recording`. Without a watcher, these native commands record event metadata only.
- **Live screen preview**: `scripts/demo-stream.py preview --mjpeg http://OBSERVED_IPHONE_IP:9100/`. The Mac merely consumes already-composited frames.

This is a Python/FFmpeg capture **client**, not a Mac MCP server or Node Runner.

## Fully automatic capture and Markcut render

On the Mac with NeoUse + FFmpeg + Markcut:

~~~bash
cd ~/Workspace/neouse
python3 scripts/demo-session.py capture \
  --mcp http://OBSERVED_IPHONE_IP:8100 \
  --token-file .state/native-mcp-token \
  --app ToyAlive --seconds 30 \
  --output-dir /path/to/demos/demo-001 \
  --markcut /path/to/markcut/bin/markcut \
  --render
~~~

Optional `--plan /path/to/plan.json` is a JSON array of timed events:

~~~json
[
  {"at_seconds": 1.0, "arguments": {"command": "step", "title": "Demo"}},
  {"at_seconds": 1.5, "arguments": {"command": "say", "text": "Welcome"}},
  {"at_seconds": 3.0, "arguments": {"command": "spotlight", "label": "Settings"}}
]
~~~

The CLI creates the Session, records annotated MJPEG with wall-clock timestamps, calls `markcut verify`, and with `--render` calls `markcut render`. `say` commands are synthesized using macOS speech voices into timed AAC audio tracks during export (`--voice-zh`, `--voice-en`). Narration is audible in the final Markcut video, **not** directly in the iPhone MJPEG stream.

## Interactive recording controlled by MCP

1. Start `neouse.session.start({"app":"ToyAlive"})` and retain the returned `session_id`.
2. Start the Mac watcher before native Demo recording:

~~~bash
python3 scripts/demo-session.py watch \
  --mcp http://OBSERVED_IPHONE_IP:8100 \
  --token-file .state/native-mcp-token \
  --session-id ACTUAL_SESSION_ID \
  --output-dir /path/to/demos/demo-002 \
  --markcut /path/to/markcut/bin/markcut --render
~~~

3. Call `agent.demo({"session_id":"...","command":"start_recording"})`, perform Demo and Pilot actions, then `agent.demo({"session_id":"...","command":"stop_recording"})`.
4. Verify the watcher has completed the MP4 and Markcut export before closing the Session. If no watcher was running, native `video_recorded:false` is **not a completed video**.

## Output and acceptance

The output directory contains `capture.mp4` (actual annotated video), `timeline.json` (timed native events), `markcut/video.md`, `markcut/events.json`, `markcut/assets/screen.mp4`, optional `markcut/assets/voice-*.m4a` and, with `--render`, `markcut/video.mp4`.

The existing overlay visuals are **baked into screen.mp4**. Markcut can edit scenes and narration but removing an already-rendered overlay requires recapture or a future raw stream. Do not misrepresent them as separately editable.

Confirm the captured and rendered MP4 via `ffprobe`, validate `video.md` with Markcut and inspect playback. For a physical iPhone, require physical-device E2E, not only Simulator results. Do not expose unauthenticated WDA/MJPEG ports to untrusted networks or check private captures into Git.
