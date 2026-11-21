# Developing iPhoneHelm App Actions

**Purpose:** Create or repair reusable, executable **MJS** Actions for real iPhone apps. This is the iPhoneHelm counterpart of WebHelm's `platforms/NEW_PLATFORM.md`. Read this reference when an Agent needs to support a new app, add an action, fix selectors, or turn a successful exploration into reusable code. For ordinary use, prefer an already installed Action; see [`actions.md`](actions.md).

## 1. Source of truth, layout, and lifecycle

- **Editable App behavior belongs exclusively in `iphone-helm-actions`**, not the `iphone-helm` engine repo, the Skill folder, a temporary `execute` file, or the iPhone Runner. The installed checkout is normally **`~/.local/iphone-helm/actions`**, a separate Git repository (`lalalic/iphone-helm-actions`). A developer may use an isolated clone/worktree, then commit and push reviewed changes to that repository.
- The engine provides the CLI, one native iPhone XCTest MCP Runner, a per-App Session and injected `helpers`. App Actions **never** implement their own MCP server, persist Session tokens, build a separate XCTest Runner, or manage a device queue.
- **MJS only** for executable Actions and tests. Markdown Experience explains what an Agent learned; it is not executable code. Use no Python for new App Action logic.
- The user-approved scope is **one physical iPhone 17**, no Simulator as real-device evidence. The global CLI lock and native MCP Session both enforce exclusive access; a second owner receives `device_busy` immediately. **No waiting queue, takeover or automatic retry.**

For a new app, create these files under the **Actions checkout**:

```text
~/.local/iphone-helm/actions/
  apps/
    example-app/
      manifest.yaml
      actions/
        inspect.mjs
        open-settings.mjs
      experiences/
        navigation.md
      tests/
        workflows.test.mjs
```

Do not put screenshots, photos, credentials, tokens, UI dumps, private messages, Xcode build directories, or generated video into Git. Place evidence under a local ignored `.state/` or `.artifacts/` directory and report a sanitized summary. The engine and Actions have **independent** installation/upgrade procedures; never upgrade one merely to edit the other.

## 2. Manifest contract

`manifest.yaml` is a deliberately restricted, one-level mapping format. Use exactly the keys supported by the runtime: `app`, `display_name`, `bundle_id`, `status`, `actions`, and `effects`. The `actions` and `effects` maps use two-space indentation; action file paths are relative `actions/<slug>.mjs`, with no `../` or symlinks outside the app folder.

```yaml
app: example-app
display_name: Example App
bundle_id: com.example.app
status: unverified
actions:
  inspect: actions/inspect.mjs
  open-settings: actions/open-settings.mjs
effects:
  inspect: read
  open-settings: navigation
```

Each action listed in `actions` **must** have exactly one effect entry. Valid effects:

| Effect | Intended operations | Required safeguard |
| --- | --- | --- |
| `read` | Snapshot, assert, read-only QA inspection | No taps, swipes, typing or approved QA writes |
| `navigation` | Open/close screens, safe UI navigation | Check observable destination and stop on unexpected state |
| `local_write` | Save a photo, change a local draft or setting | Explicitly verify persisted effect; no public publication |
| `external_write` | Send messages, upload/share/publish, modify contacts | Explicit user approval **and** `--approve-external-write`; verify exact external result, do not retry unknown outcome |

`status` is descriptive release metadata, **not** proof that every action works on the phone. Prefer `unverified`, `partial_real_iphone17_verified`, or another accurate explicit value. Mark individual action acceptance in tests and Experience notes; do not imply that a whole App has passed because one inspector succeeded.

## 3. Action module and result contract

Every Action must default-export an async function. The engine calls it with `{ helpers, input, approved }`, injecting a scoped Session and a permission-limited helper object. **The engine owns Session start/close**, even when the Action fails.

`actions/inspect.mjs`:

```js
export default async function run({ helpers, input }) {
  const screen = await helpers.snapshot({ limit: 500 });
  if (screen.coverage !== 'complete') {
    return { ok: false, reason: 'incomplete_accessibility_tree' };
  }

  // Return only nonsensitive signals, not raw chat or account contents.
  const buttons = screen.elements.filter(e =>
    e.identifier === 'settings-button' && e.frame?.width > 0);
  return {
    ok: buttons.length === 1,
    reason: buttons.length === 1 ? undefined : 'settings_button_not_unique',
    verified_by: 'unique_accessibility_identifier',
  };
}
```

A successful Action returns an object with **`ok: true` only when its intended observable postcondition is verified**. For an incomplete, ambiguous or unsupported path return `{ok:false,reason:'...'}` or throw a precise error. The CLI rejects results without `ok:true`. Never infer a save, send or publish success from a tap return alone. Do not return user content or bearer tokens in `evidence`.

### Helpers available in current engine

All Helpers are asynchronous; **always `await` them**. Inspect the installed CLI and source (`iphone-helm app source APP ACTION`, and the engine's `cli/lib/mcp.mjs`) for the exact deployed contract before adding unfamiliar calls.

| Helper | Invocation | Notes |
| --- | --- | --- |
| `helpers.app` | `helpers.app` | Exact active bundle ID (string), not a tool |
| `helpers.snapshot` | `await helpers.snapshot({limit:500,offset:0})` | Fast semantic tree; check `coverage` and `elements`. Does **not** supply clickable refs |
| `helpers.snapshotRefs` | `await helpers.snapshotRefs({limit:500})` | Structured snapshot with session-scoped refs; invalidate after UI mutations |
| `helpers.screenshot` | `await helpers.screenshot()` | Returns native MCP response; avoid committing screenshots |
| `helpers.find` | `await helpers.find('Settings')` | UI search; inspect result and ambiguity before acting |
| `helpers.waitFor` | `await helpers.waitFor({identifier:'settings-title'},{timeout_ms:2000})` | Wait for an observed postcondition |
| `helpers.assert` | `await helpers.assert({identifier:'settings-title'})` | Read-only assertion; do not equate dispatch with an App state change |
| `helpers.tap` | `await helpers.tap({identifier:'settings-button'})` | Prefer exact identifier, then exact label; `{x,y}` is a measured fallback |
| `helpers.swipe` | `await helpers.swipe('up')` | Navigation/mutation effect required |
| `helpers.longPress` | `await helpers.longPress({x:180,y:420,duration:1.2})` | Native coordinate long press; requires observed target and effect permission |
| `helpers.type` | `await helpers.type(ref,'text')` | Ref from a fresh reference snapshot; do not type sensitive data into unverified fields |
| `helpers.qaList` | `await helpers.qaList()` | Discover App QA Bridge tools, if this build exposes them |
| `helpers.qaCall` | `await helpers.qaCall('qa.model.inspect',{},false)` | For `read` QA tools; writes require a correctly authorized external-write Action |
| `helpers.demo` | `await helpers.demo('caption',{text:'... '})` | Demo overlay/event only; an MP4 still requires a managed capture and Markcut render |

UI-mutation Helpers automatically add a `request_id` if none is provided and reject outcomes `unknown`, `not_sent`, or `verified:false`. This **does not** replace an Action's own observable postcondition: an action may return `applied` while the App is on a wrong screen. For intended retry/idempotency, a caller may supply a **stable** `request_id`; never regenerate it to blindly replay an uncertain external write. A returned `coverage:'partial'` cannot prove absence of a target.

## 4. Development workflow (WebHelm style)

1. **Discover rather than duplicate:** `iphone-helm actions status`, `iphone-helm app list`, `iphone-helm app profile APP`, `iphone-helm app source APP ACTION`. Confirm the live iPhone App bundle ID, the existing Action and the requested permission/effect.
2. **Explore safely:** For a new UI flow, use an authorized caller-owned **direct native MCP Session** or an Agent-authored one-shot `iphone-helm execute --app <bundle-id> --code-file /tmp/explore.mjs --effect read|navigation`. Do not edit private user content. A temporary script is exploration evidence, not the canonical Action.
3. **Document Experience:** Write `experiences/<topic>.md` with exact navigation route, observed selectors, UI version/device context, failure recovery, privacy restrictions, and what was *actually* verified. Separate guesswork from observations.
4. **Implement the MJS Action:** Keep it small and deterministic. Validate `input` before mutations. Prefer exact accessibility IDs and checked visible frames; reject ambiguous labels. Use bounded loops for year search/scrolling; never scan unbounded private feeds. Keep side effects and permission level aligned with the manifest.
5. **Write MJS tests:** Mock only the Helpers used by that Action. Test success, no-match/partial tree, ambiguous controls, timeout, `unknown` outcome, permission denial, and cleanup expectations where applicable. Tests must not send real messages or publish real posts by default.
6. **Verify real physical iPhone 17:** Run an allowed, read-only or authorized action on the paired device; verify an observable postcondition, no interfering Session, and clean Runner shutdown. A mocked test and a signed build are **not** real E2E evidence. Do not use a Simulator.
7. **Review and publish:** In the Actions checkout run `npm test`, `git diff --check`, check staged files for private content, review changed manifests/permissions, commit to `iphone-helm-actions`, and push with an ordinary non-force Git push. Then independently install/upgrade the Actions checkout on Neo Master using the Skill's `scripts/actions-install.sh` or `scripts/actions-upgrade.sh`. Confirm `iphone-helm actions status` and `iphone-helm app profile APP` show the updated Action. Do not restart the native Runner for a pure MJS Action change.

### CLI commands

```sh
iphone-helm actions status
iphone-helm app list
iphone-helm app profile wechat
iphone-helm app source wechat find-moments
iphone-helm app run wechat inspect --input '{}'
```

For an Agent-authored throwaway script, use `execute` (check `iphone-helm --help`; upgrade the engine separately if the installed version is older):

```sh
iphone-helm execute --app com.tencent.xin \
  --code-file /tmp/explore.mjs --effect read --input '{}'
```

External-write Actions require specific user authorization and both CLI and Action-level checks:

```sh
iphone-helm app run wechat publish-moments \
  --input '{"photoIds":["explicitly-selected-id"],"text":"approved text"}' \
  --approve-external-write
```

This is a **permission example**, not proof the WeChat publish workflow is complete; it is currently designed to fail closed until selecting real saved originals and verifying the publish receipt have passed physical-device QA. Do not use the command to test posting without the user's explicit authorization.

## 5. Tests: smallest useful MJS example

`tests/workflows.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import inspect from '../actions/inspect.mjs';

test('inspector requires a complete UI tree and unique target', async () => {
  const button = { identifier: 'settings-button', frame: { width: 48 } };
  const good = await inspect({
    helpers: { snapshot: async () => ({ coverage: 'complete', elements: [button] }) },
    input: {}, approved: false,
  });
  assert.equal(good.ok, true);

  const partial = await inspect({
    helpers: { snapshot: async () => ({ coverage: 'partial', elements: [button] }) },
    input: {}, approved: false,
  });
  assert.equal(partial.ok, false);
});
```

Run `npm test` in the **Actions checkout**, not just the engine repository. For real E2E, use an authorized App and the actual iPhone; preserve only sanitized outcomes (PASS/FAIL, tested build, selector assertions and timing) outside tracked files. Verify regression after changing any Action, Helpers, Manifest, or QA/Demo behavior that affects the flow.

## 6. Failure and safety gates

- **`device_busy`:** fail immediately. No queue, waiting, stealth retry, Session stealing or killing another Agent's XCTest Runner.
- **Wrong foreground App / revoked token:** do not send another command to a different App; close only your own Session and obtain a new authorized one.
- **Ambiguous locator / partial tree:** collect additional observation or stop. Never arbitrarily select the first UI candidate.
- **`unknown` side effect:** stop and inspect state. Never automatically retry a potentially applied tap/send/publish.
- **No verified saved photo or publish receipt:** report not verified; a screenshot or executed click is not a successful original photo download or public post.
- **QA Bridge:** `qaList` is discovery, not approval. Read-effect calls are safe only within a scoped DEBUG App Session; do not promote write calls into read-only Actions.
- **Demo:** `agent.demo` overlays are not video. Only call a demo complete after real-device capture, actual H.264/AAC playable MP4 and complete Markcut timeline validation.

**Ready-to-merge gate:** manifest parses, relevant MJS tests pass, the intended Action behaves on the real requested iPhone (or is explicitly marked unverified), permission scope is correct, no personal data/secrets are staged, and installed Actions can be upgraded independently. A failing or unavailable gate must remain visibly `FAIL`/`BLOCKED`/`NOT TESTED`.
