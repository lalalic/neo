# Migration plan
1. Native runtime reference parity: batch, web, streaming, WebSocket, process lifecycle.
2. Candidate static Linux wrapper and real Docker E2E, retaining existing wrapper until validated.
3. Update host/provider launchers to support both immutable old images and new native images. Update packaged assets, exact runtime hash and hosted image build together.
4. Replace default wrapper, remove Node runtime reference, update docs and regression tests. Re-run Docker and host gates; only then merge, push, activate CLI and clean. No paid cloud run without explicit spend approval.

## Initial implementation checkpoint
- Native runtime compiles on Neo Master (macOS/arm64). Both unit tests pass.
- Existing batch/web fixture passes against the native binary, including HTTP streaming, app authorization restoration, prefix validation and WebSocket upgrade with an early frame.
- Three additional native process fixture scenarios pass: atomic uploads / output safety / one-shot execution, nonzero exit and missing executable.
- Separate static Linux wrapper candidate and CI steps added. Docker is not available on Neo Master; Linux build/real Docker tests have not run.
- The current default wrapper, provider launcher, packaging and production service are unchanged. Follow steps 2–4 before claiming release.
