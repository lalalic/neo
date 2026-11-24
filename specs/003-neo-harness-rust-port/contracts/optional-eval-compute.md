# Eval / Compute — superseded Node extension boundary (2026-11-23)

**This contract replaces the original optional Node CLI adapter design.**
The Rust Harness now directly dispatches `neo-rs eval` and
`neo-rs compute` to native Rust modules. The former `dynamic_extensions.rs`
transport, its tests, and the top-level legacy `neo gpu` alias have been
removed from the migration branch. There is no silent fallback to Node for
unsupported Neo CLI functions.

The word "GPU" remains a hardware category and a versioned **container
runtime** namespace (`gpu/runtime/{service,web,launcher}.mjs` and
`Dockerfile.wrap`), not a Neo CLI command alias. The current container
image still uses its original internal Node runtime; the native Rust CLI
does not start Node to implement `compute` itself. Explicit project-owned
JavaScript preflight or `eval` `.test.mjs` cases may invoke Node as a
**workload test runner**, not as a Neo CLI implementation.

See [native Eval and Compute acceptance](native-eval-compute.md) for the
security model, standalone command matrix, E2E evidence and known release
limitations. The older five-test optional-adapter evidence is historical and
**must not** be cited as final native implementation evidence.
