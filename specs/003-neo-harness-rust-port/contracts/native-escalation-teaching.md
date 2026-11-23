# Native owner-taught local Escalation lessons and lower-trust recall

Rust now prepares, stores, revises, finds and recalls **explicitly owner-confirmed**
Escalation lessons without confusing a taught procedure with completed work.

- A record has `source:owner_taught`, `outcome:taught`, `owner_confirmed:true`
  and `training_reviewed:false`. IDs derive from a stable scenario/strategy
  tuple. It is not a resolved execution, verified tool evidence or model training.
- Original owner teaching is reduced to sanitized scenario, steps, verification,
  failure reason and principle. Private 0700 directories and 0600 files are
  used; owner revisions replace only another taught record, never observed
  evidence. Raw Handoff/transcripts, arbitrary tool events, sensitive URLs,
  account secrets, OTPs and private filesystem paths are rejected.
- Similar future Handoffs select at most four relevant notes (<=4500 chars)
  by English tokens and CJK bigrams. They are inserted **only into the model
  user-message** as untrusted suggestions to verify in the current context.
  They never alter the system prompt, authorization, or successful Tool Result
  evidence requirement. A model cannot claim `resolved` merely by copying a
  saved lesson.
- Interactive teaching (`neo escalation learn`) is not implied by these
  primitives and remains a separately required CLI feature.

## Acceptance (2026-11-23)

- Six Rust tests passed for Node record equality, private create/revision,
  retrieval relevance, synthetic credential redaction, unsafe overwrites,
  symlink rejection, and enforcement that recalled teaching cannot forge
  completed work. Seven existing stateless tests also pass.
- Original Node teaching + Experience tests **20/20**, full Rust **166/166**,
  strict Clippy `-D warnings` passes. No real model, owner account, private
  production Case or browser was accessed.
- Still open in T017: interactive Learn, live model self-test and complete
  remaining parity; no production launcher was replaced.
