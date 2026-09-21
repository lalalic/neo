# Parent observation and control

`#parents` is the single parent-facing control and status surface. Membership in and routing through the configured parent channel is the authorization boundary; Family Tutor does not maintain a second parent identity map or parent memory store.

Parents can speak naturally:

- `how is #sammy doing recently?`
- `please have #maggie review fractions tonight`
- `how are #sammy and #maggie doing this week?`
- after an explicit target, `what should I help with this weekend?` reuses the last successfully resolved child set.

An explicit mention set replaces the remembered target set. Multiple child mentions fan the same parent intent out independently to each child's exact Project/thread; the privacy-filtered results are combined in `#parents`. The remembered target set is process memory only and is never written to `AGENTS.md` or another durable file.

Parent output is concise learning telemetry: topic, evidence, misconception/progress, next step, and useful parent support. Do not mirror routine child messages, casual conversation, or raw transcripts.

The tutor should proactively post minimum-necessary parent telemetry when repeated meaningful learning difficulty, missed commitments, major assessment risk, need for support, or serious safety/wellbeing concerns arise. Include only the useful signal, context, and suggested parent action. When safe and appropriate, tell the child that an important concern is being escalated.

`/status` is available only in `#parents`. It may target one child channel or, with no child selected, return a compact overview for all configured children.
