# Neo Visioner inference adapters

The shared executable `run-visioner.mjs` owns inference configuration and metadata
reuse; Markcut owns normalization, frame sampling, prompts, STT and segmentation.
The default adapter invokes native `agents-relay infer` directly
with capability facts, hard `reasoning: low`, and verified eligible Codex profiles.
No source data or prompt goes to the routing decision engine. It runs exactly the
selected provider/model/profile through Codex with low reasoning and a read-only
sandbox. Semantic segmentation is text-only, with a validated JSON-object result.
No hidden provider fallback or resubmission.

Provision the dedicated `vision-low.config.toml` in CODEX_HOME (or ~/.codex)
using an authorized, image-capable model with low reasoning. On Neo Master the
verified profile is OpenAI `gpt-6-luna`, low. The operator may set
`NEO_VISION_PROFILES` to a comma-separated set of other authorized, verified
low-reasoning vision profiles; the canonical router decides among them.
An unavailable or ineligible route fails closed. Markcut uses its built-in
chronological VTT frame sampling via the ITT hook; an explicit custom adapter
can override both hooks. Projects must authorize external transfer.

The optional existing WebHelm DeepSeek adapter is retained for callers that
explicitly choose it; it is no longer the shared default.

## Markcut execution profiles

The Harness ships `profiles/prototype.json` and `profiles/product.json` with
its shared Visioner. Obtain the installed root using `neo workspace show`
(`harnessRoot`, not the configurable Projects root). For example:

```sh
harness=$(neo workspace show | node -p 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).harnessRoot')
markcut vision ./media --profile "$harness/agents/visioner-adapters/profiles/product.json"
markcut render video.md --profile "$harness/agents/visioner-adapters/profiles/product.json"
```

The Neo prototype extends Markcut's built-in `prototype`; the Neo product
implicitly extends Markcut's built-in `default`. Each stores only its overrides.
Both profiles explicitly route ITT and text-only semantic segmentation through
`agents-relay infer`; VTT remains Markcut's frame sampling through ITT. No Pi/OpenRouter
free-model guess, browser fallback or large local VLM is introduced. The eligible
vision profile pool remains `NEO_VISION_PROFILES` (default `vision-low`) with hard
low reasoning and provider/model pinned to Relay's decision. Select only verified
image-capable routes. Product does not invent an unverified higher-reasoning route.

Prototype uses Edge TTS, multilingual Whisper tiny on CPU (two threads) and
FFmpeg color-bar image/video placeholders. Product uses Edge TTS, Whisper turbo,
FLUX image generation and Markcut's TTI-to-video fallback. Neither changes authored
resolution. Both retain the default interactive Edit CLI; it is a different RPC
interface, not semantic inference. Provider credentials and source transfer
permission remain prerequisites; product FLUX generation requires compatible
local resources. Direct CLI template flags override the selected file.

Visioner always uses the product profile for source understanding. The specialized `product-elevenlabs.json` profile extends product and changes only STT to ElevenLabs Scribe v3. It is selected directly by authorized project callers (see the [Scribe Skill](../../skills/elevenlabs-stt/SKILL.md)); it must not be selected before source-specific cloud and cost authorization. Prototype
is for Editor/draft work, not Visioner. Project Shortcuts need not pass a profile;
explicit `profile: 'product'` is accepted and other profiles are rejected.
Authorized direct adapter overrides and valid metadata reuse remain supported.
Fresh routed inference requires project authorization for external transfer.

Tests: `node --test agents/visioner-adapters/*.test.mjs`.
