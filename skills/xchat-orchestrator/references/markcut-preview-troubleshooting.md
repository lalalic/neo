# Markcut native/MCP preview troubleshooting

Use for Markcut map, route, cinematic, playback, audio, subtitle, blank iframe and MCP App issues. **Do not equate compiled preview metadata with verified rendering.** Read XChat bootstrap, the bound project's AGENTS/README, and the Browser Workspace skill first. Reuse existing Relay Job/Task/PR; do not create duplicate Jobs.

## Workspace and native preview

All episode/demo files and evidence must stay in a named vlog run, e.g. neo/vlog/runs/2026-10-15-gps-route-template-validation/{video.md,source-manifest.json,qa.md,assets/,output/,reviews/}. Avoid scattering templates. Keep original GPS private and distinguish observed photo stops from inferred connecting routes. Shared player changes belong to a Markcut Git worktree under ~/Workspace/.worktrees/orchestrator/.

Start native Markcut with the **same absolute video.md** used later for MCP:

    cd ~/Workspace/markcut
    node src/render/cli.mjs preview ~/Workspace/neo/vlog/runs/<run>/video.md --port=3014 --no-browser

Use NeoY shell.start for long-running sessions; stop only the debug process you started. Avoid localhost:3000/Root: that is **Remotion Studio**, not the native Markcut player. Historically even "markcut preview --help" unexpectedly launched Studio.

Start a dedicated Browser Workspace session: webhelm session start --url http://localhost:3014/; use webhelm session exec <session-id> with page_info(), snapshot(), js(), and cdp(). Inspect **actual** visuals, play/pause/seek, Google tiles, markers, polyline, route movement and cinematic camera. For the 12s demo seek 6–9s route and 9–12s cinematic. Save screenshots in the run's output/. Differences in pixels can support animation evidence but do not prove route correctness. Inspect VTT text, audio element readyState/paused/muted/currentTime and verify audible sound separately.

If time freezes, inspect document.visibilityState: background Chrome tabs may be throttled. Use cdp("Page.bringToFront") and retest. Inspect window.remotion_delayRenderHandles and remotion_renderReady, but do not infer deadlock from a hidden tab alone.

## Browser Workspace DevTools

Install a console capture **before navigating**, then check after the relevant scene loads:

    cdp("Page.addScriptToEvaluateOnNewDocument", source="""
    window.__markcutErrors=[];
    for(const level of ['error','warn']) {
      const original=console[level];
      console[level]=function(...args) {
        window.__markcutErrors.push({level,message:args.map(String).join(' ')});
        return original.apply(this,args);
      };
    }
    """)
    goto_url("http://localhost:3014/")
    print(js("window.__markcutErrors"))

Save these Python statements in a file and use webhelm session exec <id> --code-file <path> when quoting is difficult. For DevTools/Network use cdp() and sanitized resource entries; **never print Google key= query values**, access tokens, private coordinates or cookies.

Observed signatures:
- ApiNotActivatedMapError: confirm API key's Google Cloud project, enable Maps JavaScript API on that project; inspect billing/referrer permissions based on evidence.
- Legacy Directions Service not enabled + DIRECTIONS_ROUTE REQUEST_DENIED: modernize from DirectionsService to google.maps.routes.Route.computeRoutes and enable Routes API for the owning Cloud project. Routes API may incur costs. Check ComputeRoutes RPC status **and** actual rendered path. Cache identical requests across Remotion seek/remount to reduce bills.
- DirectionsService deprecated or Remotion license warning alone is not the root cause. HTTP 200 and a static image do not prove an animated route.

## MCP tool and fresh ChatGPT thread/turn

Only after native preview passes, call the **actual NeoY markcut.preview** on that same absolute run video.md. Confirm returned resource URI/player version, revision/content hash, scene duration, map props, audio/VTT. This is a **compilation/resource gate**, not hosted-player approval.

For fresh MCP verification use NeoY chatgpt.thread (synchronous platform CLI), record verified thread ID and URL; an existing thread can use chatgpt.turn when suitable. Tell the new thread to call markcut.preview, **describe the image and play/seek 6–12 seconds in its own embedded player**, report errors, and **not approve**. Use a new thread for stale preview resource/cache, iframe isolation, or version testing. A thread still generating or displaying "Connection interrupted" may not have mounted the MCP App. Never claim map failure when only a DIL iframe exists: record "hosted iframe not instantiated" and retry/reload conservatively.

Open the resulting ChatGPT URL in an **exclusive Browser Workspace session**. Confirm iframe[title="Markcut Preview"], not just localhost. Via cdp("Target.getTargets") identify the web-sandbox.oaiusercontent.com **iframe target**. The actual Markcut DOM can be in that target's nested same-origin about:blank iframe. Use js(expression,target_id=<iframe-target>) to inspect nestedFrame.contentDocument, its body, buttons, .gm-style, map tiles, VTT/audio and errors. Do not bypass cross-origin protections. Observe actual picture at 6–9 and 9–12 seconds, and real pause/seek, not just DOM metadata. Never click Approve or Request changes for a diagnostic.

Capture nested iframe Console errors and Network failure statuses. Inspect effective outer sandbox response/host CSP as well as nested document: no CSP meta in about:blank **does not** prove Google Maps is allowed.

**2026-10-15 observed MCP-only failure:** native player showed Google tiles and Route.computeRoutes HTTP 200, whereas fresh hosted iframe Console repeatedly said "The Google Maps JavaScript API failed to load. Error: The Google Maps JavaScript API could not load." At ~6–7s it showed zero map nodes/tiles and repeated Maps JS requests. The exact CSP/network rejection was **not proven**. Do not mark MCP fixed because native passes.

## Verification evidence and cleanup

Record native / MCP compiler / hosted iframe as independent PASS/FAIL/UNKNOWN gates in the run's qa.md. Include UTC/local timestamp, commit/build version, thread ID, session ID, source video.md, scene time range, screenshots, sanitized errors/status, tests, unresolved blockers. Keep private GPS and keys out of logs and public mounts. After a fix rebuild Markcut native player and MCP bundle, verify deployed resource/version, repeat browser checks in a fresh thread if cache persists. Relay still owns task review/completion and approval is separate. Always webhelm session stop <id>, close exclusive tabs, and stop only your debug process.