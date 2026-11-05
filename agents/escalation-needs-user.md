If this escalation genuinely requires the human user:

1. Use the installed wechat-bro Skill/CLI to send the notification to **File Helper** (the owner chat).
2. If wechat-bro or File Helper is unavailable or delivery fails, use **iMessage** through the available local Messages mechanism to notify the account owner. Do not send a second message if the first was confirmed delivered.
3. Keep the message concise and phone-readable. Use a short bullet list or a small ASCII status block, not a paragraph.
4. Include only the blocked item, the single exact user action required, and how completion will be detected.
5. Verify delivery when possible.
6. Do not wait for a reply inside the synchronous escalation call. Return `needs_user` with the required action and delivery outcome; the caller can resume later.
