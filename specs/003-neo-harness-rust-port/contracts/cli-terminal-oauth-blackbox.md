# Native Rust Neo Harness terminal and OAuth CLI black-box gates

Reproduce on branch `rust` with a compiled native executable:

```sh
cargo build --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay --terminal
node scripts/verify-rust-harness-oauth-blackbox.mjs
```

## Actual local Script DAG terminal lifecycle

The installed Rust Relay executable and daemon are copied into a disposable
fixture with isolated SQLite, workspace, HOME, port and event history. The
fixture uses the supported private canonical Vlog `--no-review` contract with
synthetic owner-approved private source manifest. No real media or publishing.
A real local Script Worker executes a deterministic module through Relay's
ordinary DAG/Task Graph, not injected completion events or a seeded terminal
state. Assert the Job is COMPLETED, child SUCCEEDED with one attempt, exactly
two durable script execution outbox events, Coordinator receipt with child
output, and stable Job/Task identity on re-entry without fresh Preflight.
No separate Final Review is asserted by this private test.

## HTTPS OAuth native executable

A disposable loopback HTTPS issuer with an ephemeral local CA validates the
actual CLI requests: registration, authorization, state, PKCE S256 challenge,
code exchange, automatic refresh-token revocation and access-token revocation.
It never uses production operator credentials. Seven black-box assertions:

- untrusted CA fails before any HTTP request and rolls back output;
- explicit private CA is rejected for non-loopback origin;
- correct PKCE issuance and private 0600 access-token file; refresh revoked;
- existing output refuses overwrite and does not register again;
- failed access-token revocation retains the original file;
- successful revoke deletes the file and revokes the issued token;
- wrong callback state prevents exchange and rolls back output.

`NEO_MCP_LOOPBACK_CA_FILE` accepts an explicit absolute regular PEM CA file
only for `https://127.0.0.1` issuer. TLS certificate/host verification remains
on, proxy routing is disabled for this loopback-only configuration, no global
trust is installed, and public origins continue to use default WebPKI trust.
The local issuer is a test protocol fixture, not an actual NeoY account.

Remaining: independent managed Final Review in a real Job, authorized real UI
and browser interaction, production NeoY OAuth with explicit owner approval
(if desired), Docker/provider/TLS proxy verification, and installation/rollback
of the default CLI. No production Job, token, credential, or launcher touched.
