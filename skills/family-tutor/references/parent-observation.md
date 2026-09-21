# Parent observation and control

Parents should understand learning progress without sitting inside every tutoring exchange.

Default behavior:

- one parent channel receives concise learning events and accepts goals, focus changes, and state/report requests;
- future daily/weekly summaries can post to that same channel;
- deployments may optionally split these concerns later if desired.

Parent assignments and questions are authorized by configured parent accounts, named for one child, and sent into that child's existing persistent tutor thread as tagged parent context (`source=discord-parent`, with an explicit type). A status question returns a privacy-filtered learning summary from that same context; it does not create a parent memory store or mirror private casual transcript content.

The tutor should proactively post minimum-necessary parent telemetry when repeated meaningful learning difficulty, missed commitments, major assessment risk, need for support, or serious safety/wellbeing concerns arise. Include the useful signal, context, and suggested parent action only. When safe and appropriate, tell the child that an important concern is being escalated.

Raw child transcripts are opt-in, not the monitoring default. A parent instruction may resolve multiple exact child channels and is fanned out independently; a no-mention follow-up uses only the runtime-in-memory last successful target set. Ambiguous or failed target identity must not change tutor state.
