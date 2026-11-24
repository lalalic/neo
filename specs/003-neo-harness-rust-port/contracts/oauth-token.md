# Native NeoY OAuth MCP Token CLI (T017 sub-slice)

## Ownership and security boundary

- The installed native NeoY OAuth issuer remains authoritative. Neo Harness
  implements only an explicitly invoked OAuth PKCE client for the existing
  HTTPS origin; it does **not** create an issuer, background refresh daemon,
  permanent bearer store or new service.
- `neo-rs mcp token issue (--stdout | --output ABSOLUTE_PATH)
  [--origin HTTPS_URL] [--client-name NAME]` and
  `neo-rs mcp token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]`
  retain the original strict CLI argument exclusions.
- The optional `NEO_MCP_ORIGIN` and `NEO_MCP_OPERATOR_TOKEN_FILE` are used only
  when explicit issuance or revocation is requested. Default issuer is
  `https://neoy.qili2.com`, and the operator credential is read only for
  issuance, from a trusted local file. HTTPS-only, no URL credentials or paths.
- PKCE generates a cryptographically random 32-byte verifier, derives the
  SHA-256 base64url challenge, and creates an independent random 18-byte state.
  The callback must use the fixed 127.0.0.1:8765 path, match state and issuer,
  and contain a nonempty authorization code. HTTPS redirects are never followed.
- A successful exchange must contain a nonempty access token with a strict
  `expires_in:3600`. If the issuer returns an unused refresh token, revoke it
  successfully **before** disclosing the access credential.
- `--output` opens a **new** token file with exclusive `0600` permissions
  before contacting the issuer; existing paths are never replaced. On issuance
  failure the incomplete file is removed; successful metadata never contains
  operator/access tokens. Only explicit `--stdout` prints the access token.
- Revoke reads the specified regular local token file, invokes the issuer
  `/revoke` endpoint, and deletes the file **only after** HTTP 200.
  A failure preserves the original file for safe retry.
- The live Rust HTTP transport has a 15-second request bound, 1 MiB response
  bound, verified rustls HTTPS and disabled automatic redirects. Diagnostics
  do not log the operator token, access token, refresh token, authorization
  code, or the outbound form body.

## Tests and release scope

- Native **mock-transport only** OAuth tests: 7/7 passing, including
  cryptographic PKCE verification, issuer/state/path tampering, invalid
  expiry, refresh revocation failure, private file permissions, strict flags,
  exclusivity and retry behavior.
- `node --test test/neo-mcp-token.test.mjs test/neo-mcp-local.test.mjs`:
  original reference tests **17/17** passing.
- All Rust integration tests after OAuth port: **71/71 passing**; strict
  Clippy `-D warnings` passes.
- **No real operator credential has been read**, no production OAuth issuance
  or revocation was attempted. Live token issuance is a separately authorized
  user operation, not an acceptance test.
- T017 still covers native escalation coordination and the remaining core CLI
  dispatch boundaries. This sub-slice does **not** authorize release, install,
  production OAuth requests or replacing the canonical `neo` launcher.
