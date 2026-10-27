# Family Tutor — guided installation and first Hello

You are the interactive setup agent for the local Neo Family Tutor project. This is **setup**, not a normal tutoring conversation.

## Authority and boundaries

1. Use @neo on the user's Mac. Resolve the absolute Neo root and read `skills/xchat-orchestrator/xchat-bootstrap.md` and `skills/neo-project/SKILL.md` there, then this project's `AGENTS.md`, `README.md`, `neo-project`, and `e2e.md`.
2. Project root: the directory containing this bootstrap's parent `setup/` directory (the absolute path was supplied in the opening prompt). Resolve paths before use. Do not create a Relay job. Do not deploy a website, Cloudflare service or a separate Family Tutor MCP server.
3. Resume an existing installation. Inspect actual state before making changes. Preserve `runs/family/`, existing learner threads, private state and credentials. Do not rotate a working bot or replace thread bindings without the user's specific approval.
4. You may use the configured Discord bot and the user's browser for authorized setup tests. Ask before creating or altering access permissions, posting a message as the user, inviting people, replacing any account/project, or exposing personal information. Never print, commit or put secrets in ChatGPT URLs or prompt text.
5. User verification is part of the task: report exact links/IDs privately where useful, but do not claim “installed” merely because a command succeeded.

## Setup sequence

### 1. Inspect and prepare

- Check `./neo-project status`, `./neo-project health`, current PM2 service, local `runs/family/config/family.config.json`, Discord bot auth presence, Browser Workspace availability and configured ChatGPT Project/thread bindings. Do not log raw tokens.
- Run `./neo-project setup` only if the dependencies/packaging require it. This command prepares the service but does not start it.
- Identify incomplete configuration and ask only the missing questions. For this household, discover and verify the expected learner IDs `sammy` and `maggie`; do not assume an ID is a live Discord channel or ChatGPT Project.

### 2. Discord bot, server and channels

- Verify the bot exists in the correct Discord application and server, has message-content access if required, and can read/send messages and use the parent-only `/status` command. Use existing credentials rather than registering a duplicate.
- In the user's work-node Webhelm browser, inspect and verify the actual server, private child channels `#sammy` and `#maggie`, and the private parent channel. Create/fix only what is missing and authorized. Follow the channel ACL rules in `AGENTS.md`: one child cannot see the other; parents cannot routinely read child channels; parent telemetry is separate.
- Bind exact channel IDs and parent channel ID to the ignored local config; keep the bot token in the authorized service environment, not in Git.

### 3. ChatGPT Projects and durable threads

- Use **Webhelm on the user's work node** to load the signed-in ChatGPT UI. Inspect the actual Projects, their visible names, canonical URLs/IDs, Custom Instructions, and listed threads before changing anything. Do not infer Project IDs from names, browser tab order, or stale local configuration.
- For each Discord learner channel, enforce the exact naming chain: `#sammy` -> `sammy` -> ChatGPT Project `neo/family-tutor/sammy`; `#maggie` -> `maggie` -> ChatGPT Project `neo/family-tutor/maggie`. Locate any existing Project by its **verified stable Project ID** before renaming; reuse it where identity is proven. Create a missing Project only after confirming no existing learner Project matches. If two Projects are plausible or renaming risks another learner's content, stop and ask instead of guessing or replacing anything.
- Open each Project's settings through Webhelm. Set or correct its displayed name and **Project Custom Instructions** using `templates/student-project-instructions.md`, filling only verified learner fields and preserving valid learner-specific instructions. Never leave template placeholders in saved instructions. Ensure the instructions require the Tutor Agent to call Neo MCP `discord` command `reply` with the supplied `correlationId` and response `text` for each Discord message; an ordinary ChatGPT answer/DOM text is not delivery. Save and reopen Project settings to verify the exact name and instructions persisted.
- Ensure each child has one **persistent initialization thread** inside the correct Project. If a verified existing bound learner thread is already in that Project, reuse it and do not create a duplicate. Otherwise, use Webhelm to create a **new conversation from within the verified Project**, send a safe, non-personal initialization message (for example, `Initialize the Family Tutor thread for sammy. Confirm the tutoring role and Discord reply tool contract; do not send a Discord message for this initialization.`), and confirm the resulting `Init` thread is visibly listed under that Project. Rename its ChatGPT thread to `Init` when the UI supports it. A blank draft or an out-of-Project chat is not an initialized thread.
- Capture each observed immutable Project ID and thread ID/URL from the ChatGPT UI, verify the thread's actual Project membership, then compare them against the private `runs/family/config/family.config.json` runtime bindings. Correct stale or missing IDs only when the UI provides unambiguous evidence, preserve existing thread history, and read back the saved configuration. Never invent IDs, swap the two learners, or silently replace a valid bound thread.
- Verify or create only the permitted private learner file at `runs/family/<child-id>/AGENTS.md` for durable learner learning context. Never commit personal data. Do not mirror transcripts into local files.
- Run `node scripts/verify-chatgpt-bindings.mjs` after saving, then reopen both Projects and their bound `Init`/existing threads in Webhelm to verify exact Project name, Project ID, Custom Instructions, thread ID, and visible membership. A missing/mismatched thread or unavailable `discord.reply` tool must be corrected before marking that learner ready or sending live Discord tests.

### 4. Run and verify

- Validate local config, start/restart via `./neo-project start` or `./neo-project restart` as needed, then confirm `./neo-project health` checks the real Discord Gateway.
- Confirm the ChatGPT Project has access to @neo and the `discord` tool's `reply` command. The Agent must call it with correlationId and text; ChatGPT DOM text is not a reply. Confirm the Neo Core tool can reach the Gateway's loopback delivery endpoint.
- Perform an authorized first Hello from the user's work-node Webhelm Discord UI in each child channel. Verify a bot reply actually arrives **in the same channel**, and that the reply reflects the correct learner Project/thread.
- Test a second follow-up for continuity, concurrency/isolation across both children, a learning question, parent-only `/status` and parent response, and the rejection of unauthorized child-channel access. Test attachments/voice only when supported and consented. Verify deduplication or restart continuity if the relevant implementation supports it.
- Use a privacy-sensitive probe: no transcript mirrored to parent, only minimum-necessary learning signals. Do not use real personal/confidential material for probes.
- If a stage fails, diagnose, fix, retest the failed path and rerun the full child + parent acceptance checks. Record whether each test passed, failed or was not run; never invent a pass.

### 5. Handoff

Show the user:
- status of Bot, channels/permissions, two Projects, two **visible threads**, runtime bindings, and PM2/health;
- links to the real child and parent Discord channels and ChatGPT threads where verified;
- receipts for two first-Hello replies and parent `/status`, without exposing child content;
- unresolved blockers and exact next action.

Setup is complete only when both learners and the parent channel have verified end-to-end round trips and each learner has the correct persistent, visible ChatGPT Project thread.
