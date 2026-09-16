# Chrome native messaging

Chrome launches the registered native host process itself when an extension calls `chrome.runtime.connectNative(...)`. Chrome reads the host executable path from the NativeMessagingHosts manifest and connects to that process over stdin/stdout using the native-messaging framing protocol.

## Important environment invariant

Do not assume a Chrome-launched native host inherits the user's interactive shell environment. In particular, custom DevMacBridge runtime locations such as `MAC_DEV_BRIDGE_DATA_DIR` may be absent when Chrome starts the host.

Therefore, when DevMacBridge is installed with a non-default data directory, the installer-generated native-host wrapper MUST explicitly carry the resolved runtime configuration into `chrome-native-host.mjs`, for example:

```sh
#!/bin/sh
export MAC_DEV_BRIDGE_DATA_DIR="<resolved data dir>"
exec "<node>" "<devmacbridge>/scripts/chrome-native-host.mjs"
```

Do not work around this by depending on `.zshenv`, `.zprofile`, or another interactive-shell startup file.

## Failure signature

A common symptom is the extension service worker reporting:

```text
Unchecked runtime.lastError: Native host has exited.
```

Check, in order:

1. the NativeMessagingHosts manifest points to the current generated wrapper;
2. the wrapper launches `chrome-native-host.mjs`, not a directory or stale path;
3. the wrapper exports the installer-resolved `MAC_DEV_BRIDGE_DATA_DIR` when a custom state directory is used;
4. the profile-binding file exists in that same data directory;
5. the host remains alive when launched with a minimal Chrome-like environment.

A useful regression test is to install with a custom data directory, launch the generated wrapper with only a minimal `HOME`/`PATH`, and verify the host listens on the socket inside that custom directory instead of falling back to `~/Library/Application Support/MacDeveloperBridge`.
