# Optional Skills in Neo.app

Neo.app ships the versioned Neo Harness **core** Skill catalog. An optional
Skill is **not** part of the `@lalalic/neo` or Rust Harness distribution and
is not installed or upgraded merely because Neo.app starts. The existing Neo
Skill discovery also checks direct children of `~/.agents/skills/`, so users
who deliberately install an independent Skill can use it without changing
Neo.app or copying its files into the Harness checkout.

## iPhoneHelm (optional)

**Owner:** [`lalalic/iphone-helm`](https://github.com/lalalic/iphone-helm).
**Purpose:** Real iPhone development, QA, and product-demo automation.
**Distribution:** Standalone iPhoneHelm engine/Skill and separately installed
App Actions. It is not required to run Neo.app, build Neo Harness, or use
other Neo Skills. Availability of the Skill does **not** imply that the
physical device is paired, signed, or ready for automation.

Explicit installation on macOS (from a trusted checkout of the independent
repository):

```sh
# Clone only if the independent checkout is not already installed.
git clone https://github.com/lalalic/iphone-helm.git "$HOME/.local/iphone-helm/engine"
sh "$HOME/.local/iphone-helm/engine/skills/iphone-helm/scripts/setup.sh"
neo skill list  # iphone-helm is now discoverable through ~/.agents/skills
```

The standalone setup script creates a global Skill link and installs the
engine; use the Skill's own `actions-install.sh` only when additional App
Actions are wanted. Never copy its `SKILL.md`, Runner, automation binaries,
credentials, tests, or Actions source into Neo Harness.

To disable discovery **without uninstalling the engine**, unlink only the
optional global Skill entry after confirming it is a symlink:

```sh
test -L "$HOME/.agents/skills/iphone-helm" &&
  unlink "$HOME/.agents/skills/iphone-helm"
```

Re-enabling it through the independent setup script restores discovery.
Neo.app core functionality remains available when iPhoneHelm is absent.
The older bundled `neo-use` alias has been retired; use `iphone-helm` by name.
