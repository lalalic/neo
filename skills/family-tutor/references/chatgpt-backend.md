# ChatGPT subscription backend

The preferred local backend uses DevMacBridge's direct-loopback wrapper around `chatgpt_conversation_start`:

```text
POST http://127.0.0.1:8787/experimental/chatgpt/conversation
Authorization: Bearer $MAC_DEV_BRIDGE_HTTP_TOKEN
```

It uses the signed-in ChatGPT consumer session. It does not require `OPENAI_API_KEY` and does not use OpenAI API billing.

For a new child tutor, supply the ChatGPT Project id plus a bootstrap prompt. Persist the returned conversation id. Every later child turn MUST continue that exact conversation id.

The runtime depends on a healthy DevMacBridge ChatGPT browser runtime and a signed-in ChatGPT session. Diagnose that prerequisite rather than silently falling back to API billing.
