---
name: chrome-web-store-platform
description: "Chrome Web Store platform flows for browser-platforms."
---

# Chrome Web Store

Read the parent `browser-platforms` contract and `browser-harness` first.
These assets are a platform skeleton: the flows document intended contracts,
and the browser-harness runner provides the reusable interaction boundary.
Live account verification is still pending, so the runner requires an
explicit action and reports observed evidence instead of inferring success.

Use only the publisher account and listing explicitly selected by the caller.
Publishing and listing updates have external side effects and require an
explicit user request.

## Runner

Invoke `browser-harness/_chrome_web_store_bh.py` through `browser-harness` with
an approved JSON configuration. The supported actions are:

`open-item`, `upload-package`, `update-listing`, `submit-review`,
`check-status`, and `verify-published`.

The runner is dry-run by default. `upload-package`, `update-listing`, and
`submit-review` require `commit: true`; `submit-review` additionally requires
the caller to explicitly opt in with `allow_external_submit: true`. This keeps
Release Agent responsible for authorization while this skill owns browser
mechanics. Every action emits a JSON evidence record containing the observed
URL, item id, action, and status (`draft`, `submitted`, `pending`, `rejected`,
`published`, or `unknown`).

The input `market_package` is product-owned content supplied by Market Agent;
this skill validates presence and maps supplied values to store fields but does
not invent copy or media. It accepts title, short/long description, release
notes, reviewer test instructions, support/privacy URLs, privacy/data-use
declarations, distribution/payment designation, permissions and host
justifications, screenshots, posters/feature graphics, and demo video.
`package_path` and `expected_version` are required for package upload; the ZIP's
`manifest.json` version must match before browser interaction begins.
