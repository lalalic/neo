# ChatGPT subscription backend

The preferred local backend uses DevMacBridge's direct-loopback wrapper around `chatgpt_conversation_start`:

```text
POST http://127.0.0.1:<configured-port>/experimental/chatgpt/conversation
Authorization: Bearer $MAC_DEV_BRIDGE_HTTP_TOKEN
```

It uses the signed-in ChatGPT consumer session. It does not require `OPENAI_API_KEY` and does not use OpenAI API billing.

## Child binding

Bind each child to a distinct ChatGPT Project and a dedicated warm ChatGPT tab. Supply that child's `project_id` and `tab_id` on every turn. Do not persist a `conversation_id` in Family Tutor.

When the dedicated tab is already on a conversation inside the configured Project, DevMacBridge continues that mounted conversation in place. When the tab is on the Project home, the next turn creates a fresh thread in that Project. This keeps thread ownership in ChatGPT while avoiding a cold Project/conversation reload on every Discord message.

## Thread rollover

The child's loaded XChat/AGENTS context decides when a thread has become genuinely too long/noisy and emit `<FAMILY_TUTOR_ROLLOVER/>`. After processing the completed response and any memory update, Family Tutor navigates the dedicated tab back to that child's Project home. The following turn therefore starts a fresh ChatGPT thread with continuity supplied by the child's local `AGENTS.md`.

The runtime depends on a healthy DevMacBridge ChatGPT browser runtime and a signed-in ChatGPT session. Diagnose that prerequisite rather than silently falling back to API billing.
