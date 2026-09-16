# Producer loop

Codex is responsible for performing the jobs described by the runtime. The runtime does not launch a resident agent.

The resident `com.neo.vlog-autopilot` LaunchAgent closes that gap for the fixed NeoX intent, “Create a vlog from today’s photos and videos.” It validates the private-LAN MCP endpoint, then launches a dedicated Codex producer run. It peeks before claiming, so other NeoX handoff messages remain queued for their intended consumer. The worker takes work through storyboard review and never publishes or bypasses editorial approval.

1. Run `status` to recover context and `run` to inspect queued work. Inspect the original event and prior artifacts. Resolve actual media paths and series/template/style/persona context. Enforce the audio and voice contract in `docs/architecture.md`.
2. Claim one job with `run --claim JOB_ID`. Preserve its token. A claim is exclusive and has a lease; a crashed worker's expired claim is recovered by the next claim operation.
3. Perform the task using the selected route. Command arrays are templates, not shell strings: resolve placeholders and execute arguments without shell interpolation. An empty command means a role task performed by Codex.
4. Record a successful result with `run --complete JOB_ID --token TOKEN --artifact JSON`. Record failures with `run --fail JOB_ID --token TOKEN --error TEXT`. Retry failed work with `retry JOB_ID`; the same job has at most three attempts.
5. For storyboard and final review, include actual reviewed files and a review note in the artifact, for example `{"files":[{"path":"runs/<run-id>/vlog.md"}],"review":"Describe observed results here"}`. Before render approval, confirm the storyboard contains a sourced episode BGM asset and either preserved appropriate original voice or tested Ray-timbre/fallback narration. For final review, listen to the complete video and record BGM mix/end and generated-narration QA results; include the rendered video, not only the storyboard. The runtime calculates file hashes.
6. Show the relevant Markcut preview to the user. Record editorial approval only when the user gives it, using `approve EPISODE --stage STAGE --revision N --hash SHA256 --by NAME`. Use the revision/hash returned by completion. Technical tests must never impersonate this approval.

An unapproved review can be retried and completed as a new revision. Approvals reject obsolete revisions and changed files. Rendering checks the approved storyboard files again before its job is claimed. This bootstrap does not offer a general rewind of already-approved downstream work; if the approved story must change, create a distinct revision event/episode and preserve the old history.

The final `ready` state is a handoff point for a future publisher. It does not upload, schedule, or reply to comments.

For long Markcut work, preserve the claim context and avoid starting competing producers. The default lease is 15 minutes and there is no heartbeat renewal command in the bootstrap; configure a sufficient `lease_seconds` for long jobs before claiming them.
