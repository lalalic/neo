# Neo Visioner private WebHelm adapter

This adapter is owned by the Neo Visioner, **not Markcut**. It is an
external executable for Markcut Vision's public generic CLI templates:

```sh
neo_root=/path/to/neo
node /path/to/markcut/bin/markcut vision /path/to/media \
  --itt "node $neo_root/agents/visioner-adapters/deepseek-infer.mjs --input {input} --prompt {prompt_quoted}" \
  --vtt "node $neo_root/agents/visioner-adapters/deepseek-infer.mjs --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}" \
  --agent "node $neo_root/agents/visioner-adapters/deepseek-segment.mjs --prompt {prompt}" \
  --instruct "<project-owned, source-grounded context>"
```

The shared `run-visioner.mjs` helper selects these defaults when external transfer is authorized, reuses complete metadata, and delegates normalization to Markcut. Project wrappers retain source scope, context and review. Explicit local adapters are supported for offline projects. Agent chooses an authorized adapter; Markcut does not recognize
provider-specific flags. This adapter requires `webhelm` with an authorized
signed-in session and local `ffmpeg`/`ffprobe`. The visual adapter returns observed visual descriptions only. The text adapter calls DeepSeek new-thread with JSON response format; Markcut validates the segment timeline. Markcut still owns metadata/STT/segmentation. It reports
errors instead of silently returning invented descriptions. Do not disclose
private inputs to an unapproved provider or resend uncertain browser uploads.

Test: `node --test agents/visioner-adapters/deepseek-infer.test.mjs`.
