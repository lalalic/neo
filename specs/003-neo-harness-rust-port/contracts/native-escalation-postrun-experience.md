# Optional post-run local Experience recorder (T017 completion)

The original Node Escalation runtime asked the *same already loaded local*
model for a sanitized Experience classification when an executor failed to
produce stable scenario/strategy keys. Rust now supports that optional pass.

- Only after an actual verified stateless execution, and before the owned
  model server is unloaded, a second independent `response_format:json_object`
  request may ask the local model to classify the outcome.
- The recorder receives the installed `agents/escalation-experience.md`
  instructions, redacted Handoff summary, sanitized result summary/reason and
  **observed tool names/counts only**. It is never given raw tool output,
  model session/transcripts, command arguments, credentials or original
  private full Handoff. It cannot invoke a tool itself.
- If the executor already supplies a nonempty scenario/strategy pair, this
  extra request is skipped. Otherwise a successful candidate is still
  sanitized and validated by the existing strict Case storage boundary.
- If recorder inference, JSON parsing or private Case persistence fails,
  the original verified task result remains authoritative. It falls back to
  the existing minimal Experience rather than replaying a mutating action,
  fabricating completion or abandoning the Challenge terminal event.
- All model requests remain on explicitly local 127.0.0.1 endpoints and
  under the original global inference flock. No duplicate task or scheduler.

## Acceptance evidence (2026-11-23)

- Three additional Rust tests: two synthetic privacy/malformed recorder tests
  and a real spawned native CLI making three local model HTTP requests:
  Tool Use, tool-free verification decision, then sanitized post-run recorder.
  The final Case has `source:postrun_model`, correct classification and a
  **single** executed synthetic Shell action.
- Full Rust integration suite **182/182**; strict Clippy and fmt pass.
  Node Escalation, Learn, SelfTest, Control, Challenge, Experience and local
  model reference tests **72/72** pass. Four clean Mac distribution tests
  pass without a Node/Python runtime for the native core.
- No real models downloaded, owner accounts accessed, production records
  read/written or installed launcher replaced. Live Neo.app integration and
  release approval are reserved for T019 and T020.
