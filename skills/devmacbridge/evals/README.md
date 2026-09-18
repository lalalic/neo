# DevMacBridge eval cases

1. Missing nested checkout: clone the configured source into `<skill-folder>/devmacbridge`.
2. Dirty nested checkout: preserve it without pull, stash, reset, clean, or overwrite.
3. Arbitrary installation path: resolve all paths from the skill directory.
4. Missing runtime state: create protected `<skill-folder>/.state` files without changing upstream code.
5. HTTP code update: restart only `devmacbridge-http` and preserve the tunnel hostname.
6. Tunnel recreation: extract the latest hostname from `<skill-folder>/cloudflared.log` and require the ChatGPT Server URL to be updated.
7. Consent token needed: copy it to the clipboard without printing it.
8. Local health succeeds but ChatGPT cannot call `bridge_status`: report setup as incomplete.

17. Pinned source reproduction: a clean checkout of the reviewed fork commit `07c29b6866ea4c4ceda2a9efd650ff4749153639` includes the OAuth and federation fixes without applying a local patch.
