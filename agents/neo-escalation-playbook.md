# Neo Escalation: common recovery approaches

This is a reference of candidate approaches, not permission to access unrelated accounts or an instruction to bypass required confirmation. Check real tool output and the handoff before choosing a step. New scenarios belong here after independent review of captured `neo escalation cases` histories.

## API key or Secret is missing

1. Identify the missing destination variable, its scope and whether the target has a usable value (look up presence/status without exposing secret contents).
2. Inspect the known, authorized sources: original project setup, suitable private files, applicable macOS Keychain entry, explicitly connected Neo/Worknode environment, or authorized account browser session.
3. If the first source lacks it, switch to another relevant route; do not infer `needs_user` from one absent file, one machine, or a single Shell error. Prefer WebHelm for account UI and `neo computer-use` for native dialogs.
4. With existing authorization, provision into the correct destination using a private file, stdin, or supported secret store; avoid command-line arguments and user-facing logs containing the value.
5. Verify destination presence and a non-destructive authorized operation. If truly unavailable and no authorized source or recovery remains, identify the exact owner-only step and evidence.

## Target Secret Store setup (GitHub, npm, Cloudflare, others)

The owner permits repeated plaintext key handling **inside authorized local execution**, with no per-use limit. A target may need its own Secret Store, credential binding, or private authentication configuration; create that destination when the handoff authorizes the target. Never treat “no Secret Store exists yet” as requiring the owner to paste a key. Distinguish **source discovery**, **target setup**, **value provisioning**, and **verification**. Respect environment/repository/account scopes; do not provision credentials to an unrelated service.

- **GitHub repository or environment**: check the target with `gh auth status` and `gh secret list -R OWNER/REPO`. For the authorized repo, `gh secret set SECRET_NAME -R OWNER/REPO < private-key-file` reads the plaintext from stdin and encrypts it client-side. Select `--env ENV` when the target uses environment secrets, or an appropriate org target with explicit organization permission. Confirm presence with `gh secret list` and, if authorized, verify the intended workflow rather than attempting to read back the value.
- **npm registry / CI publishing**: determine whether the target is the local npm CLI, a CI runner, or the registry's trusted publishing configuration. Prefer an authorized trusted-publishing OIDC link where available; otherwise use the correct scope-specific npm auth token in a private, non-committed `~/.npmrc` or target CI secret. Ensure private config is mode 0600. Verify with `npm whoami --registry REGISTRY_URL` or a non-publishing authorized registry check; do not print token-bearing npm config. An npm token and a GitHub Actions Secret are different stores.
- **Cloudflare Worker**: check authenticated account, Worker name and environment before writing. Use `wrangler secret put SECRET_NAME --name WORKER_NAME` with the value from stdin, selecting `--env ENV` where appropriate. Confirm via `wrangler secret list` for the same target, then test the intended binding without echoing the secret. Do not implicitly deploy unrelated changes.
- **Other providers**: find the platform's actual secret manager or sanctioned credential setting, check CLI help and authenticated target identity, apply the same source → destination → verify pattern. For APIs with no readable secrets, use documented non-sensitive presence/use checks; do not fabricate verification.

A private plaintext file is permitted as an intermediate or required persistent target when scoped to the task, with owner-only permissions; do not turn a transient temporary file into a second uncontrolled copy. Do not include plaintext values in Git commits, externally shared logs or messages. If a source credential is irretrievable, distinguish a truly owner-only step from normal authorized provider UI recovery, and use the human fallback only with evidence.

## OAuth or device code pending

Keep an interactive CLI operation running in a background process with observable output. Open the authorized browser session via WebHelm, inspect native confirmation with Neo Computer Use if needed, complete only permitted steps, then rejoin and verify login (`whoami` or equivalent). Refresh an expired device code; never confuse an opened page with completed authorization. Leave personal biometric or hardware-key confirmation to the owner.

## macOS permission prompt / GUI control

Use `neo computer-use call list_apps`, get fresh application state, identify the actual dialog, and operate the supported accessibility controls. If the UI state is stale, refresh it. Verify the resulting permission against the originally blocked operation. Do not bypass system security mechanisms.

## CLI, remote node, or network failure

Capture the exact error and check executable version, flags, connection, target host and process state. Try a materially different strategy rather than repeating an identical failed command. A technical failure is `failed`, not automatically `needs_user`.

## Worker configuration or Cloudflare Secret provisioning

Check existing bindings and known authorized sources. Put permitted values into the intended Worker or equivalent secret store via stdin or private secure file, validate the binding is present and test its intended operation. Do not overwrite unrelated keys or deploy production services without the task's authorization. A missing source in Worknode is not proof that the owner must supply it.

## Pilot budget for paid service tests

The owner delegates up to USD 10 in necessary usage-based tests per authorized objective across all attempts; ToyAlive retains its previously approved single USD 10 pilot total, not USD 10 per agent run. Read prior spend and provider usage first. Keep any test within the remaining budget; if uncertain, do not initiate new billable actions. No subscription, automatic top-up or unrelated purchase.

## Human-only endpoint

If all relevant authorized recovery paths are exhausted, explain specifically which sources/tools were checked, why a human must act, and how completion can be verified. Notify through the established File Helper/iMessage policy only when the task allows contacting the owner.

## Transcripts and replies

Do not retain Agent session/thread records or persistent tool transcripts from a Neo Escalation run. A private, sanitized scenario/solution record may be kept for future learning, without raw key values or session content. Do not return a plaintext key, password, token, cookie or OTP in any final result or user notification; return verification status and location/name (never value) instead. Keep the original long-lived credential only in the specifically authorized target store.
