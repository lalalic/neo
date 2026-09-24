---
name: browser-workspace-manager
description: Configure Browser Harness to operate only inside one named Browser Workspace Manager Chrome tab group.
---

# Browser Workspace Manager + Browser Harness

Use this skill whenever Browser Harness should operate inside a managed Chrome tab-group workspace instead of seeing the user's other Chrome tabs.

The Chrome extension source lives in the standalone repository:

`~/Workspace/browser-workspace-manager`

GitHub repository:

`lalalic/browser-workspace-manager`

Do not copy extension source back into Neo. Neo owns only the Browser Harness integration.

## One-time Chrome extension setup

In the user's normal signed-in Chrome profile:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `~/Workspace/browser-workspace-manager/extension`.

The development extension ID is stable:

`kgbghhigmbpefppgkocgjgnnnbhjchic`

The extension owns only workspace/group/pool lifecycle. Browser Harness remains responsible for page navigation, DOM/AX operations, clicks, typing, screenshots, uploads, and downloads.

## Browser Harness setup

Install the Neo helper into Browser Harness:

```bash
neo/skills/browser-workspace-manager/scripts/install.sh
```

The installer copies `browser-harness/agent_helpers.py` into:

`$BH_AGENT_WORKSPACE/agent_helpers.py`

or, when `BH_AGENT_WORKSPACE` is unset:

`~/.config/browser-harness/agent-workspace/agent_helpers.py`

It also writes these values into the Browser Harness workspace `.env`:

```bash
BH_WORKSPACE_NAME=MDB
BH_WORKSPACE_POOL_SIZE=8
BH_WORKSPACE_MANAGER_EXTENSION_ID=kgbghhigmbpefppgkocgjgnnnbhjchic
```

Set `BH_WORKSPACE_NAME` and `BH_WORKSPACE_POOL_SIZE` before running the installer to choose different defaults.

Example:

```bash
BH_WORKSPACE_NAME=Research \
BH_WORKSPACE_POOL_SIZE=4 \
neo/skills/browser-workspace-manager/scripts/install.sh
```

## Runtime behavior

After setup, use `browser-harness` normally.

Each new Browser Harness process reads the configured environment. The helper:

- creates the selected workspace automatically when it is missing;
- exposes only tabs in `BH_WORKSPACE_NAME`;
- leases `new_tab(url)` from that workspace pool;
- returns `close_tab()` tabs to the pool;
- refuses visible activation and operations on tabs outside the workspace;
- fails closed when Chrome tab to CDP target mapping is ambiguous.

`BH_WORKSPACE_POOL_SIZE=N` means exactly **N Chrome tabs total in the group**. There is no extra marker tab.

Workspace identity is the unique Chrome tab-group title. Chrome `groupId` is treated as ephemeral and rediscovered after restarts. Duplicate groups with the same workspace title are considered ambiguous and fail closed.

## Changing workspace

Changing the env value affects the next Browser Harness process:

```bash
export BH_WORKSPACE_NAME=Research
export BH_WORKSPACE_POOL_SIZE=4
browser-harness
```

An already-running Browser Harness process keeps the values it started with.

For an existing workspace, `BH_WORKSPACE_POOL_SIZE` is the creation/default size. To resize an existing workspace explicitly, use:

```python
workspace_resize("Research", 6)
```

## Workspace helpers

The installed helper also exposes:

```python
workspace_create("Research", 4)
workspace_status()
workspace_list()
workspace_resize("Research", 6)
workspace_delete("Research")
```

Normal Browser Harness page operations remain unchanged.
