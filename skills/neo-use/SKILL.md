---
name: neo-use
description: Help AI agents develop, QA-test and demonstrate iPhone apps on a real device. Choose the right NeoUse workflow, operate UI safely, inspect optional App QA tools, record product demos and deliver verified evidence.
---

# NeoUse — real iPhone agent workflows

Use NeoUse when an agent needs to **see, understand, operate, test or present an iPhone app**. The native iPhone Runner exposes an MCP tool interface, including UI automation, optional app-internal QA and narrated product demonstrations. **Start from the user outcome**, not infrastructure details.

## Choose the mode

| User request | Agent objective | Outcome to deliver |
| --- | --- | --- |
| **Develop / debug:** “reproduce this iPhone issue”, “verify my fix”, “inspect this screen” | Observe the real app, reproduce the behavior, diagnose with optional QA tools, compare before vs. after | Reproduction steps, relevant UI/state evidence, fix verification |
| **QA / regression:** “test this release”, “run smoke tests”, “check app behavior on iPhone” | Perform deterministic, safely bounded tests; compare observed results with expected results | PASS/FAIL/NOT TESTED, failed step, action evidence, timings, regression report |
| **Market / product demo:** “make a video”, “show the feature”, “record an App walkthrough” | Design a truthful product story, drive the real app, add demo annotations and narration, render a video | Actual real-device MP4, Markcut `video.md`, timeline, verified playback link |

**For all three modes:** Use the actual paired physical iPhone when real-device proof is requested. Do **not** use a Simulator as a substitute; in the current NeoUse workflow, only iPhone 17 is authorized. Do not add multi-device complexity. A successful build or tool call is not proof of an end-to-end result.

## Shared operating loop

1. **Preflight:** Check the authorized physical device, Runner health and installed Apps (`neouse.health` and `neouse.apps`, where supported). If the Runner is unavailable, consult [operations](references/operations.md). Do not kill another task's XCTest process or take over its session.
2. **Acquire:** `neouse.session.start({"app":"Target App","owner":"task-id"})`. Retain the returned `session_id` and, if present, `owner_token`. Pass them unchanged to subsequent scoped calls. If the device is busy, report it; never steal its lease.
3. **Observe:** Use `agent.pilot` with `command:"snapshot_fast"` where available (structured semantics, no tap refs), `snapshot_json` when an actual element ref is needed, or `screenshot` for visual proof. If a snapshot is `partial` or `unknown`, do not claim an element is absent.
4. **Act + verify:** Choose a semantic locator (`identifier`, then exact label) whenever possible; coordinate taps are a fallback. For mutating actions use a stable `request_id` to prevent accidental duplicate execution. Always verify the **resulting UI or app state**, not just whether XCTest returned.
5. **Recover safely:** On `not_sent`, inspect reason and correct the precondition. On `unknown`, **do not replay any possible side effect**; observe current UI and resolve uncertainty first. On wrong app/session, fail closed and obtain a fresh Session. Never switch apps behind another owner.
6. **Clean up:** Call `neouse.session.close` in a `finally` path. Record only task-relevant, privacy-safe evidence. Stop only task-owned capture/Runner processes.

Tool vocabulary:

| Tool | Agent use |
| --- | --- |
| `neouse.apps`, `neouse.health` | Discover the target, check readiness |
| `neouse.session.start/status/renew/close` | Own one target App session and release it |
| `agent.pilot` | Inspect, locate, act, wait, assert, screenshot, replay steps |
| `neouse.flow.list/run`, `agent.pilot run_steps` | Repeat bounded automated workflows when available |
| `neouse.flow.record.start/stop` | Collect a reusable *draft* semantic flow; review before replay |
| `neouse.qa.list/call` | App-internal diagnostics in a specifically QA-enabled build |
| `agent.demo` | Steps, spotlight, captions, narration events, cursor and recording controls |

Tool availability varies with the installed Runner; inspect actual `tools/list`, not a remembered API. `snapshot_fast` does **not** return clickable refs. When multiple elements share the same accessibility label/identifier, inspect candidates and disambiguate; do not take an arbitrary match. `outcome:"applied"` without an observed postcondition is **not** a verified business result.

## Mode A — Development and bug fixing

**Trigger:** An agent is implementing a change, investigating an iOS defect or validating UI behavior.

- Capture a **before** observation: target App/build, visible screen, relevant accessibility identifiers, and exact user-visible problem. Prefer `snapshot_fast` for quick reconnaissance; use screenshot for layout issues.
- Reproduce with the *smallest safe interaction sequence*. Check the outcome of every step. When the app offers QA Bridge tools, use **read-effect** diagnostics (e.g., ToyAlive `qa.model.inspect`) to distinguish UI symptoms from internal state.
- Fix code in the owning project, not in the running App through ad hoc QA commands. Install/test the approved build only when the device and repo workflow permit it.
- Repeat the same sequence to capture an **after** observation. Distinguish fixed, not reproducible, and not tested; do not call a compile-only pass an iPhone fix.
- Report precise steps, expected vs. observed behavior, supported evidence, and any remaining regression risks.

**Development gate:** A real-device repro and an equivalent real-device post-fix check, or explicit `BLOCKED` with what prevented either. Use [developer recipe](references/agent-playbooks.md#development-bug-reproduction).

## Mode B — QA, regression and release verification

**Trigger:** An agent is asked to verify a build, execute a test plan, or investigate an intermittent failure.

- Convert requirements into checks with an **observable UI or QA-state assertion**, not “tap succeeded”. Run smoke checks first, then longer replay/regression flows.
- Use `neouse.flow.run` or bounded `agent.pilot run_steps` for repeatable UI sequences. Inspect `failed_step`, `outcome`, `verified`, and `retry_safe`; stop at the first uncertain side effect. Do not silently rerun failed batches.
- For QA-enabled Apps, discover tools using `neouse.qa.list` **after** starting the right App session. Read-only tools may inspect internals. A QA tool marked `write` requires explicit task-specific authorization; never infer it from the ability to invoke it.
- For third-party Apps such as **WeChat** use black-box UI verification only. Test opening, visible elements, safe navigation, snapshot accuracy and recovery **without sending messages, changing contacts, payments, accounts or private data**.
- For **ToyAlive**, use the DEBUG QA Bridge for read discovery/state checks and expected denial of unauthorized writes. Verify tool isolation after Session close/expiry.
- For performance compare the same iPhone, app screen and connection mode. Record p50/p95, sample count, failures and timing method. Never use upstream benchmark numbers as local proof.

**QA gate:** `PASS` only for checks actually observed on the requested device; include `FAIL`, `BLOCKED`, and `NOT TESTED` separately. Keep private chat text/screenshots out of logs and shared files. See [QA recipe](references/agent-playbooks.md#qa-regression).

## Mode C — Marketing and product demos

**Trigger:** An agent is asked to demonstrate features, produce product footage, record a promotional walkthrough or create a Markcut-ready video.

- Draft a short **storyboard**: opening benefit → authentic feature interaction → why it matters → closing. Choose *real supported features*; do not fabricate capabilities or hide errors by pretending the app did something it did not.
- Open the actual App and rehearse a safe workflow. Use `agent.pilot` for real taps/swipes and `agent.demo` for `step`, `spotlight`, `caption`, `say`, `cursor`, `highlight`, and `clear` overlays. These annotations appear only in NeoUse screenshots/video, not as changes to the product UI.
- Use **managed video capture**, not just native `start_recording`. Start the capture companion before Demo event recording; otherwise you only have event metadata. Capture the actual annotated iPhone stream and deliver `capture.mp4`, timeline and Markcut `video.md`.
- Render final MP4 with synchronized narration, verify **H.264 video, audio, duration, all required steps within the recording**, and view representative frames. If any step was cut off, correct and recapture; do not claim the first recording as final.
- Produce a link to a **verified** output (and the Markcut edit project when requested). Ensure the video does not expose private messages, contacts, tokens, account details or sensitive data.

**Marketing demo gate:** Successful real-device capture + complete story + playable MP4 + verified Markcut timeline, not just demo tool receipts. See [demo recipe](references/agent-playbooks.md#marketing-product-demo) and [Demo → Markcut workflow](references/demo-markcut.md).

## When to stop rather than guess

- `device_busy`, unauthorized XCTest, wrong foreground App, session/token mismatch, unknown or failed action outcome, stale/ambiguous element, partial snapshot proving no absence, unavailable QA tool, or media shorter than narration/events.
- First attempt a **safe, limited diagnostic**; report exact blocker. Never override another task's lease, retry a possibly applied destructive action, use simulator results as physical-device evidence, or replace an App's production build solely to enable QA.
- Release the Session and preserve intermediate artifacts; a failed gate must remain visibly failed.

## Reference material (only when needed)

- [Agent playbooks](references/agent-playbooks.md): compact tool-call recipes and acceptance templates.
- [Operating / recovery guide](references/operations.md): signed Runner and connectivity diagnostics.
- [QA Bridge / native contract](references/technical-contract.md): protocol details for maintainers or App implementers, not normal Agent workflow.
- [Conformance](references/conformance.md): QA and Demo compatibility cases.
- [Demo → Markcut](references/demo-markcut.md): real capture/export/render commands.
