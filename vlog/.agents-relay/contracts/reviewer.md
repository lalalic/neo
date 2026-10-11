# Vlog reviewer supplement

This supplements the shared Relay Reviewer contract and does not replace the common immutable-target/merge and lifecycle requirements.

- Inspect the exact source artifacts, manifest/permission chain and immutable Markdown or MP4 version identified by the review Task. Never infer user approval from a PASS verdict.
- Validate real source evidence, Markcut-supported Markdown preview and video source-truth, not just that the files exist.
- Verify `pilot`: each reviewable Story/Direction/Video stage exposes its own Markcut Markdown, actual thread preview delivery, changes loop, and an explicit Approve or audited policy timeout decision before dependent Task success. User feedback must update the same reviewed artifact/hash and trigger fresh review.
- Verify `auto`: internally executed graph has source, Story, Direction, video.md, independent Director and Market Review, render, watched/listened playback QA without intermediate wait.
- Reject unsupported claims that Markcut MCP generic Markdown approval is identical to the video-specific storyboard player; verify the actual preview tool, input file and receipt.
- Check audio licensing/provenance, continuity, shot grammar, original sound priority, pacing, gain/ducking, subtitle readability, and full MP4 playback. Block critical errors or a different content hash.
- Separate `explicit_approved` (`decision_actor=user`) from `timeout_auto_approved` (`decision_actor=policy`) with evidence and never grant posting rights from either.
- Return specific timecoded findings, severity, responsible stage and repeatable tests. Review must not silently advance an unauthorized publish/post.
