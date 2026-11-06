# Vlog Publisher — publication contract

Publisher follows Producer in `graph.mmd` but is **conditional**.
Absent `publisher-request.json`, return a no-op `SKIPPED`
without browsing or uploading. An authorized draft action creates a draft
only. Neither private archive nor Markcut preview authorizes a post.

## Private per-run input

`runs/<episode>/publisher-request.json`:

```json
{
  "schemaVersion": 1,
  "videoSha256": "<sha256 of output/video.mp4>",
  "targets": [
    {
      "platform": "wechat-channels",
      "account": "<exact account label>",
      "action": "publish",
      "title": "<6-16 chars>",
      "description": "<text>",
      "tags": ["cycling"],
      "authorized": true
    },
    {
      "platform": "xhs",
      "account": "<exact account label>",
      "action": "publish",
      "title": "<up to 20 chars>",
      "description": "<text>",
      "tags": ["cycling"],
      "authorized": true
    }
  ]
}
```

Both `authorized` and the per-platform `action` must be explicit.
The account must have been verified as the signed-in account before live
submission. Existing WebHelm platform Actions may not expose that identity;
when they cannot verify it, Publisher holds rather than guessing.
There is no run-wide blanket publish permission.

## Shortcut behavior

The Shortcut uses WebHelm's canonical profile/action contract. Prepare
`publish/<platform>-config.json` in the canonical private Run. Write an
attempt ledger before side-effecting browser actions; once attempted,
the same platform is not automatically retried if any result is ambiguous.
Run `webhelm platform run <platform> post --auto-session --config <file>`
through the host command runner. Require platform-side state and stable
receipt, store `publish/<platform>-receipt.json`.
Only a verified `published` or `reviewing` status indicates a public
submission; `reviewing` is not publication success. Draft is private.
Always report partial results accurately.

Publisher does not modify `video.md` or source media; changes to video
invalidate the request fingerprint. Do not post if any rights, privacy,
account, missing media or authentication gate is unresolved. Use exact
platform names `wechat-channels` and `xhs`. Do not call generic
`post-agent` heuristically when the supported platform Actions exist.
