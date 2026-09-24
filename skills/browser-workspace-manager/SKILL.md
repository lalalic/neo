---
name: browser-workspace-manager
description: Manage isolated named Chrome tab-group workspaces with reusable pools for Browser Harness agents.
---

# Browser Workspace Manager

This skill owns a standalone Chrome extension that manages browser-agent operation spaces. It is independent of Mac Developer Bridge.

## Architecture

- The extension owns named Chrome tab groups and reusable tab pools.
- Browser Harness owns all page interaction: CDP, DOM/AX, navigation, clicks, typing, screenshots, uploads, and downloads.
- `agent_helpers.py` shadows Browser Harness tab-boundary helpers and only exposes tabs from one configured workspace.
- Workspace name is stable identity. Chrome `groupId` is runtime state discovered from a dedicated marker tab after restart.
- Every workspace has one non-leasable marker tab plus its configured reusable pool.

## Workspace contract

The extension service worker exposes:

- `workspace.create(name, poolSize)`
- `workspace.status(name)`
- `workspace.list()`
- `workspace.acquire(name, url)`
- `workspace.release(name, tabId)`
- `workspace.resize(name, poolSize)`
- `workspace.delete(name, force=false)`

Pool size may be 1–64 and is independent per workspace.

## Browser Harness

Install the helper:

```bash
<skill-folder>/scripts/install.sh
```

Defaults:

- extension id: `kgbghhigmbpefppgkocgjgnnnbhjchic`
- workspace: `MDB`
- pool size: `8`

Override with `BH_WORKSPACE_NAME` and `BH_WORKSPACE_POOL_SIZE`.

The helper wakes the extension's MV3 service worker through CDP, invokes its workspace contract directly, maps Chrome tab IDs to CDP targets, and fails closed if a mapping is ambiguous. It does not require Mac Developer Bridge or a native messaging host.

## Chrome installation

Run `<skill-folder>/scripts/install.sh`, then load `~/.config/browser-workspace-manager/extension` as an unpacked extension in the user's normal signed-in Chrome profile. The manifest contains a stable public key so the unpacked extension keeps the same extension ID.

## Safety boundary

This is an operation-isolation boundary, not a credential/security boundary. The helper refuses tab activation and only switches, closes/releases, or navigates tabs that the extension reports as owned by the selected workspace.
