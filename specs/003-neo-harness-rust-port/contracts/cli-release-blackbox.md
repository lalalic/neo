# Native Release private launcher and rollback acceptance

Build and run on Neo Master, without changing the production launcher:

```sh
cargo build --release --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-harness-release-blackbox.mjs
```

The driver uses a disposable HOME and versioned prefix. It links a private
`bin/neo` to the actual existing Node CLI, stages the optimized Rust binary
and committed assets using `package stage`, then atomically switches the
private symlink using rename. It checks the staged executable hash and Git
revision, bundle-root resolution, independent Bootstrap, agent/skill/project
discovery and diagnostics. The fixture includes an empty Agency integration
directory, as required by the current shared Agent catalog contract. Its
minimal PATH intentionally contains no Node or Python; only explicit git and
curl links are provided. No source-root override is used for installed Rust
CLI invocations. The real local Neo.app gateway is only queried for status.

The original Node target and workspace result are restored and verified;
a second activation and rollback exercise idempotency. The actual production
launcher target and executable content digest must remain unchanged. All
private installation artifacts are removed afterward. No actual production
cutover or rollback has occurred.

The native status/doctor exit status reflects the local gateway check;
Node/Python version fields remain available but missing runtimes are optional
for native core readiness. Project-declared JS preflight, Script Workers,
Node Eval workloads and other project-owned programs may still require their
respective runtimes. Healthy machine output remains compatible with the Node
reference. A missing gateway still returns exit 2.

Remaining release gates: managed Final Review, actual UI writes/real model,
Compute live Docker/HF/Vast and provider TLS/WSS (Docker not installed on
current Neo Master), and explicit approval for production cutover. Installed
Rust Relay PromptBuilder has passed the controlled-write Eval acceptance;
the previous stale-embedded-path observation is no longer a reproduced
blocker on this installed version.
