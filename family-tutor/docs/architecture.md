# Architecture

```mermaid
flowchart LR
  K1[Kid 1 Discord] --> B[tutor-bridge / PM2]
  K2[Kid 2 Discord] --> B
  B --> MDB[DevMacBridge ChatGPT runtime]
  MDB --> T1[Persistent Kid 1 ChatGPT thread]
  MDB --> T2[Persistent Kid 2 ChatGPT thread]
  T1 --> MDB
  T2 --> MDB
  MDB --> B
  B --> K1
  B --> K2
  T1 --> P[Parent learning telemetry]
  T2 --> P
  P --> PD[Parent Discord]
```

The reusable implementation lives in `skills/family-tutor`; this project contains only public architecture/docs; each real family instance lives under `runs/<run-id>/`.
