# Native Compute container runtime
- Replace the injected Node runtime with a static Linux/amd64 Rust executable; application runtime and project Dockerfile remain independent.
- Keep neo-gpu-v1 and neo-gpu-web-v1 health, routes, NEO_GPU_* environment and command semantics, file bounds, one-start state, exit status and bounded logs.
- Batch uploads are atomic; refuse start during active uploads; reject unsafe names and nonregular outputs.
- Web mode streams HTTP and WebSocket upgrades, preserves app credentials but strips provider credentials, validates prefix, probes readiness and supervises child process lifetime.
- New and existing immutable images remain executable from HF and Vast. No new cloud spend or uploads without explicit authorization.
- Lock dependencies; hash every runtime build input identically on host and hosted builder; bundle all required source assets.
- Gates: native unit and black-box parity tests; Linux static binary; real batch and Web Docker E2E without cloud spending; host build/transport/package regressions. Do not remove reference or deploy until gate passes.
