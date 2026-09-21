# Family Tutor canonical architecture

Family Tutor is browser-backed. Discord is the transport; each learner is a
single ChatGPT Project and one persistent conversation in that Project.

~~~mermaid
flowchart LR
  C1[#sammy] --> O[Family Tutor orchestrator]
  C2[#maggie] --> O
  P[#parents] --> O
  O --> R{Exact Discord channel name}
  R --> S[neo/family-tutor/sammy]
  R --> M[neo/family-tutor/maggie]
  S --> T1[Same persistent ChatGPT thread]
  M --> T2[Same persistent ChatGPT thread]
  O --> F[Thinking reaction]
  F --> B[Loopback browser bridge]
  B <--> E[ChatGPT extension]
  E --> S
  E --> M
  T1 --> A1[runs/family/sammy/AGENTS.md]
  T2 --> A2[runs/family/maggie/AGENTS.md]
  T1 --> Q[Privacy-filtered parent reply/escalation]
  T2 --> Q
  Q --> P
~~~

## Contract

- #sammy maps exactly to child id sammy and Project neo/family-tutor/sammy.
  No aliases, channel-id map, tab lookup, or alternative Project is valid.
- Accepted child and parent messages immediately receive a transient thinking reaction; it is cleared on completion/failure and is never durable.
- Child messages, images, and audio attachments go through the loopback bridge
  to the assigned Project's existing persistent thread. Audio is attached
  directly to ChatGPT; the prompt identifies it as a Discord voice message and
  asks ChatGPT to transcribe and understand it without judging writing grammar.
- The only durable learner memory is runs/family/<child>/AGENTS.md. Thread
  identity and browser bridge runtime state are private runtime state; parent
  routing memory is in-memory only.
- In #parents, channel mentions may occur anywhere. A message with multiple
  mentions is sent independently to each corresponding Project/thread. A later
  message without a mention reuses the last successfully resolved target set;
  an explicit set replaces it. Replies are combined after privacy filtering.
- The parent channel receives minimum-necessary proactive academic or
  safety/wellbeing escalation, never routine transcripts. /status remains
  parent-only and reads the existing learner Project/thread.
- The extension owns ChatGPT tab attachment and multimodal submission. The
  bridge owns correlation, attachment bytes, per-child serialization, and
  delivery back to the originating Discord message.
