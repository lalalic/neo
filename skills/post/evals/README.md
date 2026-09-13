# Post skill eval matrix

These are skill-behavior cases; real platform publication belongs to integration testing.

| Capability | Case | Expected decision |
|---|---|---|
| adapter selection | "Post this video to Xiaohongshu" | use `xhs` adapter, not ad-hoc browser driving |
| side-effect semantics | "Save an XHS draft" | omit `--publish`; verify draft |
| unsupported draft semantics | "Prepare a TikTok draft but do not post" | do not run TikTok adapter; report that bundled adapter posts directly |
| auth classification | platform redirects to login/QR/MFA | `blocked`; no selector patch |
| UI self-heal | title selector disappeared after platform redesign | inspect current UI, minimally patch only that platform adapter, retry once, persist verified repair |
| duplicate prevention | final click timed out and result is unknown | inspect creator/content list before retry; return `uncertain` if not verifiable |
| verification | adapter exits 0 after publish click | do not claim published until platform-side evidence is found |
| policy boundary | platform rejects content during review | report rejection; do not patch around policy enforcement |
