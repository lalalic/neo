# Family Tutor E2E verification

Family Tutor runs in the Neo Master as `family-tutor/local`. Its Discord Gateway
receives the family messages and replies through `discord.js`. Browser Workspace
uses each learner's existing ChatGPT Project and thread. No Discord relay,
Cloudflare service, ChatGPT MCP app mention, or Chrome extension is required.

## Read-only readiness (safe to run without sending messages)

1. Run `./neo-project status` and `./neo-project health`; both Discord and
   Tutor Browser Workspace sessions must be ready.
2. Run `node scripts/verify-chatgpt-bindings.mjs`. It validates every
   configured learner's existing Project/thread using Browser Workspace
   `chatgpt validate` with an automatically closed session.
3. Inspect only anonymized mapping counts and learner routing keys. Never
   print Project IDs, thread URLs, Discord channel IDs, or credentials.
4. Verify `runs/family/` is ignored and no learner transcripts enter Git.

## Authorized interactive acceptance

Only send test messages when the family has authorized channel interaction.

1. Send distinct text questions to two child channels and verify each
   verified ChatGPT assistant response returns only to its own channel.
2. Send an image and a voice recording. Verify that image upload and local
   `uvx mlx-audio` transcription reach the correct learner thread.
3. In the parent channel, mention exactly one configured child and ask a
   status question. Verify the answer goes to the parent channel.
4. Exercise `/status` and confirm access is restricted to the parent channel.
5. Restart the service, repeat one read-only binding validation, and confirm
   that existing Project and thread IDs remain unchanged.
6. Test error handling with a temporarily invalid binding in an isolated
   instance. Startup must fail without creating a replacement Project.

Record redacted results under ignored `runs/family/`. A healthy Gateway and
read-only Project validation do not by themselves prove the message round trip.
