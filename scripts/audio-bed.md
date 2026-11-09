# Neo generic audio bed preparation

Reusable by **any Neo project**. This is an offline FFmpeg-based music + SFX preparer, **not** Vlog-specific, a TTS model, a voice cloner, a Markcut audio engine replacement or a provider license validator. It creates one timed, pre-ducked music/SFX M4A bed; original spoken audio, recorded location ambience and narration remain separate original-source / TTS tracks in the target editor. The Markcut root bed is played at volume **1.0** so it is not attenuated twice.

Run `node /Users/chengli/Workspace/neo/scripts/audio-bed.mjs --plan /path/to/project/audio-plan.json` (or from the Neo repository, `node scripts/audio-bed.mjs --plan ...`).

Example project-owned plan (all paths relative to the plan file unless absolute):

```json
{
  "durationSeconds": 45,
  "music": {"path":"assets/music/licensed-bed.wav", "gain":1},
  "duck": {"gain":0.32,"fadeSeconds":0.18,"windows":[
    {"startSeconds":4,"endSeconds":9.3},
    {"startSeconds":15,"endSeconds":22}
  ]},
  "effects": [
    {"path":"assets/sfx/discovery-chime.wav","atSeconds":12.5,"gain":0.4}
  ],
  "output":"assets/audio/prepared-bed.m4a"
}
```

The result is 48-kHz stereo AAC at 192 kb/s, with verified duration/hash and small peak limiter. The input music file is looped to the episode duration. Overlapping duck windows merge, and a smooth fade is applied around each. Original SFX are positioned once at source timeline seconds, not mistaken for creator voice. Input files and existing output are never overwritten. The project must still clear all underlying music rights, and must listen to the final full mix with live speech: volume 1.0 is the **prepared bed playback multiplier**, not a promise the mix is balanced.

In a Markcut `video.md` root, use exactly `- audio src:assets/audio/prepared-bed.m4a isBackground:true volume:1.0` and **do not** also add the already-premixed SFX again as separate leaves. When no music is authorized, omit the music bed rather than silently substituting unlicensed audio. `ffmpeg` and `ffprobe` must be installed on the running node.

For the Vlog template, the permanent `brand-three-taps.wav` plays separately in the fixed intro scene. **Do not include that same cue in the prepared bed**, or it will play twice.
