# Native macOS Project TTS CLI (T017 sub-slice)

`neo-rs project tts (--text TEXT | --text-file PATH) --output ABSOLUTE.m4a|.wav
[--voice Tingting] [--rate 200] [--node local]` is implemented in Rust.

- **The underlying speech service remains Apple's installed `/usr/bin/say`**.
  Rust coordinates that existing engine with `ffmpeg` and `ffprobe`, rather
  than replicating Apple's voice models or starting a new inference service.
- Exactly one text source is accepted; UTF-16 length is limited to 6,000;
  NUL/control payloads, malformed voice/rate, unknown nodes, and unsafe
  output locations or extensions are rejected without creating an artifact.
- The audio must really exist and exceed 2048 bytes at the intermediate and
  encoded stages; `ffprobe` must report a valid audio stream and duration
  greater than 0.25 seconds. There is no success JSON without actual audio.
- Child commands are argument-array only, timeout bounded to 120 seconds,
  with 2 MiB captured-output limits. Scratch files use private random UUID
  names; failure cleans them. Successful output is mode `0600`, published by
  hard-link only if the destination still does not exist. An existing file
  is never silently overwritten, including a race during encoding.
- 4 native Rust tests passed: actual Chinese M4A and WAV, narration file,
  ffprobe stream/duration inspection, Node help/negative-flag parity,
  overwrite protection, and simulated external ffmpeg failure cleanup.
- Original Node `test/neo-project-tts.test.mjs`: **4/4 passed**.
  Full Rust suite **85/85 passed** and Clippy `-D warnings` passed.
- All generated speech is private test content in disposable temporary
  directories; no user media or publication was modified. Mac-native TTS
  still requires macOS voices and ffmpeg/ffprobe at runtime.
