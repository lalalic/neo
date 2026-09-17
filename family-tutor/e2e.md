# Family Tutor Critical E2E Tests

This file defines the critical end-to-end acceptance tests for Family Tutor.

The purpose is to verify the real user path, not only service health, direct backend calls, or isolated unit behavior.

## Definition of end to end

A child E2E test is only successful when the full path works:

```text
real Discord child channel
  -> family-tutor bridge
  -> correct child routing
  -> correct ChatGPT Project
  -> correct dedicated ChatGPT tab/current thread
  -> tutor response
  -> same Discord child channel
```

A running PM2 process, a successful direct DevMacBridge call, or a successful ChatGPT response by itself is not sufficient evidence that Family Tutor works.

## Preconditions

Before running the tests:

- `family-tutor-bridge` is online.
- DevMacBridge is online.
- The Discord bot is connected.
- The user is logged in to Discord in Chrome.
- The user is logged in to ChatGPT in Chrome.
- Each child has a distinct Discord channel.
- Each child has a distinct ChatGPT Project.
- Each child has a distinct dedicated ChatGPT tab binding.
- The configured child/channel/project/tab mapping passes `doctor.mjs`.

## Critical Test 1: Sammy full round trip

Use the real Discord UI in `#sammy-tutor`.

Send a unique message such as:

```text
E2E SAMMY <unique-id> — reply with exactly: SAMMY_E2E_<unique-id>
```

Pass criteria:

- The message appears in `#sammy-tutor` as a user message.
- The bridge routes the turn to Sammy only.
- The turn uses Sammy's configured ChatGPT Project.
- The turn uses Sammy's configured dedicated ChatGPT tab.
- The tutor response appears back in `#sammy-tutor`.
- The response contains the expected unique token.
- No equivalent response appears in Maggie's channel.
- No `The tutor is temporarily unavailable` response is produced for this turn.

## Critical Test 2: Maggie full round trip

Use the real Discord UI in `#maggie-tutor`.

Send a different unique message such as:

```text
E2E MAGGIE <unique-id> — reply with exactly: MAGGIE_E2E_<unique-id>
```

Pass criteria:

- The message appears in `#maggie-tutor` as a user message.
- The bridge routes the turn to Maggie only.
- The turn uses Maggie's configured ChatGPT Project.
- The turn uses Maggie's configured dedicated ChatGPT tab.
- The tutor response appears back in `#maggie-tutor`.
- The response contains the expected unique token.
- No equivalent response appears in Sammy's channel.
- No `The tutor is temporarily unavailable` response is produced for this turn.

## Critical Test 3: Cross-child routing isolation

Run Sammy and Maggie probes close together using different unique tokens.

Example:

```text
#sammy-tutor
E2E ROUTE SAMMY <unique-id> — reply with exactly: SAMMY_ROUTE_<unique-id>

#maggie-tutor
E2E ROUTE MAGGIE <unique-id> — reply with exactly: MAGGIE_ROUTE_<unique-id>
```

Pass criteria:

- `SAMMY_ROUTE_<unique-id>` appears only in `#sammy-tutor`.
- `MAGGIE_ROUTE_<unique-id>` appears only in `#maggie-tutor`.
- Sammy's prompt does not appear in Maggie's ChatGPT Project/thread.
- Maggie's prompt does not appear in Sammy's ChatGPT Project/thread.
- The children remain isolated even when the requests overlap in time.

Any cross-child message, context, reply, or Project/tab routing is a critical failure.

## Critical Test 4: Concurrent child requests

This test protects against one child blocking another.

Send one probe to Sammy and one probe to Maggie with as little delay between them as practical.

Example:

```text
E2E CONCURRENT SAMMY <unique-id> — reply with exactly: SAMMY_CONCURRENT_<unique-id>
E2E CONCURRENT MAGGIE <unique-id> — reply with exactly: MAGGIE_CONCURRENT_<unique-id>
```

Pass criteria:

- Both messages are accepted independently.
- Both ChatGPT turns may be active independently.
- A slow or stalled Maggie turn must not prevent Sammy's turn from starting.
- A slow or stalled Sammy turn must not prevent Maggie's turn from starting.
- Each reply returns to its own Discord channel.

The implementation must not use a global backend queue that serializes all children. Serialization is allowed only where needed for the same child's ordered conversation.

## Critical Test 5: Correct ChatGPT identity

For each child, verify the configured Project/tab identity, not merely the text response.

Pass criteria:

- Sammy uses Sammy's `projectId` and `tabId`.
- Maggie uses Maggie's `projectId` and `tabId`.
- The two children do not share a Project or dedicated tab.
- A test must fail if a response is produced from the wrong child's Project even if the final text looks correct.

## Critical Test 5.1: Thread bootstrap and continuation

Start from a child tab at the Project home and send one unique student request. Then send a second unique request in the same Discord child channel without navigating the tab.

Pass criteria:

- The Project-home turn receives the child's current `memory.md` together with that student message.
- The second active-thread turn receives only the new student content; it does not receive another copy of `memory.md`.
- After a controlled rollover, the dedicated tab returns to Project home and the next turn receives the updated `memory.md` again.
- Restarting `family-tutor-bridge` while the child tab remains on an active conversation does not inject memory again on the next student turn.

Evidence can use ChatGPT's per-thread visible history plus deterministic tutor acknowledgements or local prompt unit tests; do not introduce a local conversation-state file as test scaffolding.

## Critical Test 5.2: Dedicated tab remains mounted

Complete one ordinary child turn while Family Tutor's preserved-tab mode is enabled.

Pass criteria:

- The dedicated ChatGPT tab remains on the same mounted conversation and does not visibly reload at the end of the turn.
- The reply returned to Discord matches the assistant message observed on that mounted tab.
- If exact assistant-message verification is unavailable, the turn fails visibly rather than accepting an unverified response or silently reloading.

## Critical Test 6: Failure is visible to the user

Temporarily create or reproduce a backend failure where practical.

Pass criteria:

- The Discord message is not silently lost.
- The failure is logged with the affected child id.
- The child receives a bounded user-visible failure message.
- A failure in one child's turn does not stop the bridge from serving the other child.
- Subsequent messages can recover without restarting unrelated child state when possible.

## Critical Test 7: Service restart recovery

Restart `family-tutor-bridge`, then repeat one Sammy and one Maggie round trip.

Pass criteria:

- Discord reconnects.
- Existing child Project/tab bindings remain valid.
- Durable `memory.md` remains intact.
- No child is accidentally rebound to another child's Project/tab.
- Both child channels successfully complete a new round trip.

## Critical Test 8: Thread continuity

Send two related messages to one child through Discord.

Example:

```text
Message 1: Remember that my test topic is photosynthesis.
Message 2: What test topic did I just tell you?
```

Pass criteria:

- The second response demonstrates continuity from the same child's tutor context.
- The other child's context is unaffected.
- No local conversation transcript/state file is required for normal continuity.

## Critical Test 9: Thread rollover

When testing rollover behavior, trigger `<FAMILY_TUTOR_ROLLOVER/>` in a controlled test conversation.

Pass criteria:

- Any durable facts are written to that child's `memory.md` before rollover.
- The rollover marker is not shown to the child in Discord.
- The dedicated tab returns to that child's Project home/new-thread state.
- The next Discord turn starts a fresh thread inside the same child Project.
- Durable learner context remains available through `memory.md`.

## Critical Test 10: Parent telemetry separation

Use a tutor response that emits a `<FAMILY_TUTOR_PARENT>` block.

Pass criteria:

- The child-facing response does not contain the parent telemetry markers or payload.
- The parent channel receives the concise telemetry.
- The parent channel does not receive the full raw child transcript by default.
- Sammy telemetry is labelled/routed as Sammy.
- Maggie telemetry is labelled/routed as Maggie.

## Browser interaction rule

Critical E2E tests must mimic the actual Discord interaction closely enough to prove the user path.

For Discord composer testing:

- use the real logged-in Discord tab;
- enter text into the real `Message #<channel>` composer;
- submit using the interaction Discord actually responds to, such as an Enter key event;
- do not treat generic HTML `requestSubmit()` or a filled contenteditable as evidence that Discord sent the message;
- verify the sent message appears in the channel before waiting for a tutor response.

## Required assertions for an automated E2E runner

An automated critical E2E runner should record, for every probe:

```text
child id
Discord channel id
unique probe id
expected reply token
configured ChatGPT project id
configured ChatGPT tab id
sent-at timestamp
reply-at timestamp
elapsed time
result: pass/fail
failure reason
```

It must explicitly detect:

- message was never actually sent;
- no tutor response before timeout;
- backend error response;
- response in wrong Discord channel;
- wrong expected token;
- cross-child token leakage;
- wrong Project/tab binding;
- one child's stalled request blocking another child.

## Timeout guidance

Do not use the ChatGPT backend's maximum runtime as the normal E2E success threshold.

For simple exact-token probes, a response should normally arrive much sooner. The test runner should have:

- a short normal-response threshold for reporting slowness;
- a bounded hard timeout;
- diagnostics that distinguish Discord-send failure, bridge-routing failure, ChatGPT-backend failure, and Discord-return failure.

A timeout is a test failure even if the backend later eventually produces a response.

## Minimum release gate

Before considering Family Tutor operational after a meaningful runtime/routing/backend change, all of these must pass:

1. Sammy real Discord round trip.
2. Maggie real Discord round trip.
3. Cross-child routing isolation.
4. Concurrent Sammy + Maggie requests.
5. Correct Project/tab identity for both children.
6. No unexpected `temporarily unavailable` responses during the probes.

The release gate must be run through the real Discord UI path. Direct backend tests are useful diagnostics, but they do not replace this gate.
