# Neo Visioner private WebHelm adapter

This adapter is owned by the Neo Visioner, **not Markcut**. It is an
external executable for Markcut Vision's public generic CLI templates:

```sh
neo_root=/path/to/neo
node /path/to/markcut/bin/markcut vision /path/to/media \
  --itt "node $neo_root/agents/visioner-adapters/deepseek-infer.mjs --input {input} --prompt {prompt_quoted}" \
  --vtt "node $neo_root/agents/visioner-adapters/deepseek-infer.mjs --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}" \
  --instruct "<project-owned, source-grounded context>"
```

Agent chooses an authorized adapter; Markcut does not recognize
provider-specific flags. This adapter requires `webhelm` with an authorized
signed-in session and local `ffmpeg`/`ffprobe`. It returns observed visual
descriptions only; Markcut still owns metadata/STT/segmentation. It reports
errors instead of silently returning invented descriptions. Do not disclose
private inputs to an unapproved provider or resend uncertain browser uploads.

Test: `node --test agents/visioner-adapters/deepseek-infer.test.mjs`.
