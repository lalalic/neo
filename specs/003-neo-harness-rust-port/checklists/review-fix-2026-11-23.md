# Rust Harness independent review–fix evidence — 2026-11-23

## Scope

Read-only code/security review of the native Escalation model lifecycle and
Tool Executor after T019 acceptance. Focus on unsafe assumptions at external
HTTP/MCP/tool boundaries, private results and observable failures. All work
stayed on branch `rust`; production `neo`/Relay/MCP and T020 cutover remain
unchanged. This review is an additional hardening gate, **not a release
approval**.

## Findings, red tests and fixes

1. **HIGH — Computer Use false success evidence.** Previously the Tool
   Executor treated `result["isError"] != true` as success, so `{}`, JSON
   `null`, a string `"false"`, or a response without `content` could become
   successful model tool evidence. Added fixture and state-machine integration
   tests that first failed, then changed acceptance to require an explicit
   boolean `isError:false` and an MCP `content` array. Malformed replies
   become failed tool results with a nonsecret diagnostic. A model cannot
   finish `resolved` on a malformed Computer Use ACK alone.
2. **HIGH — Credentials visible inside model tool results.** The prior Tool
   Executor only removed known Apple account/password values, permitting
   Bearer/Basic tokens, `.env` key assignments, URL query tokens, common SDK
   tokens and JWTs to reenter the in-memory inference context. Added synthetic
   secret fixtures that first failed. Mask those formats **before** returning
   Shell/WebHelm/Computer Use results to the model, in addition to existing
   final Challenge/Case redaction. These masks are defense-in-depth: they
   cannot substitute for restricting privileged Shell tools or account
   authorization.
3. **MEDIUM — False ready state for local inference.** HTTP 200 followed by
   invalid JSON or `{}` previously converted to an empty object and counted
   as healthy; a `loading` response was also checked. Added real disposable
   TCP server regressions for malformed HTTP 200 payloads, empty JSON and
   explicit loading; confirmed failing before fix. Model is now ready only
   after correctly decoded JSON explicitly reports status `ok` or `ready`.
   Invalid health eventually times out and the guardian cleans up its model
   group and global flock, without starting tools prematurely.
4. **MEDIUM — Lost stderr on failing tools.** If a Shell/WebHelm command
   produced both stdout and stderr, only stdout reached the model. Added a
   failing fixture and then combined bounded output streams, applying the
   same credential sanitizer before the model receives either stream.

## Verification

- New tests: **five** (3 Tool Executor individual regressions, 1
  cross-component model-evidence regression, 1 owned server health
  regression), all first red and now green.
- Entire Rust suite: **189/189 passing**.
- Strict `cargo clippy --workspace --all-targets --offline -- -D warnings`
  and `cargo fmt --all -- --check` pass.
- Actual configured read-only NeoY/Node-vs-Rust CLI comparison: **14/14**.
- Actual disposable Rust Relay daemon/SQLite/foreground Coordinator Project
  Run E2E **passed** with one ACTIVE Job, stable Job/Task IDs, unchanged Run Git
  HEAD, and `productionStateTouched:false`.
- These fixes did not require a new production model download, Apple
  credential use, live browser mutation, or production service restart.

## Remaining release gate

- **T020 remains open** until explicit approval to merge, install, switch
  launcher, verify live, remove superseded Node code, and clean. This review
  does not assert that regex redaction is complete against all forms of
  secrets, nor that arbitrary owner-authorized Shell has been sandboxed.
