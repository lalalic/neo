# Family Tutor ChatGPT extension

This unpacked Manifest V3 extension is the browser-only side of the Family Tutor ChatGPT bridge. It stores child-to-tab bindings in `chrome.storage.local`, connects only to a loopback WebSocket bridge, routes each queued turn to that child's already-open ChatGPT tab, uploads loopback-hosted image attachments, fills the composer, submits, and reports `turn.ack` or `turn.error`.

It does not read Discord, switch tabs between children, scrape assistant replies, implement the MCP reply path, or use DevMacBridge/Chrome injection at runtime.

## Setup

1. In Chrome, load `skills/family-tutor/extension` as an unpacked extension.
2. Open one authenticated ChatGPT tab per child.
3. On each tab, open the extension popup, enter that child's private runtime id, the loopback bridge URL (default `ws://127.0.0.1:8787/ws`), and the bridge token, then choose **Bind this tab**.
4. Keep real child names, ids, tokens, and other family data only in local runtime/extension state; never add them to this repository.

The bridge protocol sends `turn` messages with `childId`, `prompt`, `correlation.correlationId`, and optional image attachments (`url`, `token`, `name`, `mimeType`). The extension sends `tab.bind` after connection plus `turn.ack` after composer submission or `turn.error` on failure.
