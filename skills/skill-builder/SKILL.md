---
name: skill-builder
description: Create, review, and improve AI agent skills by first identifying the skill's real user goals and capability tree, then separating behavioral contracts from implementation details, restructuring the skill around outcomes, aligning agent prompts, and generating capability-based evals.
---

# skill-builder

Use this skill to create a new AI agent skill, review an existing skill, or improve a skill together with its evals.

The central rule is:

> **Find the skill's real goal before editing the skill.**

Do not begin by rewriting `SKILL.md`, reorganizing headings, or generating tests from the existing document. First determine what the skill is actually supposed to let an agent accomplish.

A skill is successful when an agent reliably chooses and performs the right behavior for the user's goal. It is not successful merely because its API or protocol documentation is complete.

---

## 1. Find the real goal first

Before changing anything, answer:

1. What real outcomes should a user be able to achieve with this skill?
2. What are the smallest distinct capabilities required to achieve those outcomes?
3. Which capabilities are primary workflows, and which are only implementation details or reference material?
4. Which decisions are already deterministic in code/configuration?
5. Which decisions genuinely require model reasoning?
6. Which capabilities must remain extensible for custom implementations?

Produce a short **capability tree** before editing.

Example:

```text
Skill goal: maintain WeChat conversations through an AI harness

Capabilities:
1. start the managed orchestrator
2. configure watched contacts and behavior
3. handle escalation to the owner
4. choose the correct WeChat action/command
5. build a custom listener/orchestrator when the managed workflow is insufficient
```

This capability tree is the source of truth for both the skill structure and the eval plan.

### Bad starting point

Do not derive the goal from the existing table of contents:

```text
SKILL.md contains:
- WebSocket events
- commands
- media fields
- markdown
```

That only tells you what is documented, not what the skill is for.

### Good starting point

Ask:

```text
What should an agent be able to accomplish because this skill exists?
```

Then work backward to the required behaviors, interfaces, and reference details.

If the real goal is ambiguous, inspect the implementation, examples, agent prompts, tests, README, and user workflow before deciding.

---

## 2. Inspect implementation before defining the contract

For an existing skill, inspect enough related implementation to distinguish:

- behavior enforced by code;
- behavior enforced by agent/system prompts;
- behavior controlled by configuration;
- behavior only described in documentation;
- behavior intentionally left to model judgment.

Do not over-document implementation that is already deterministic.

Example:

```text
If the orchestrator hard-codes:
- session location
- routing
- mode
- watch-list derivation

then the skill should document the usage contract and configuration surface,
not ask a contact agent to infer those things again.
```

Classify important information into four buckets:

```text
1. User/capability contract
2. Agent behavior contract
3. Implementation/configuration detail
4. Protocol/reference
```

The first two deserve prominent placement. The last two usually belong later in the skill.

---

## 3. Separate deterministic decisions from model decisions

Prefer deterministic routing and policy whenever the system already has enough information.

Typical deterministic decisions:

```text
- routing target
- selected mode
- watch-list membership
- session identity/path
- configured agent
- task type
```

Typical model decisions:

```text
- whether a conversational reply is useful
- natural wording
- whether a new commitment requires user authorization
- what facts are durable enough to remember
- how to summarize or explain something
```

Watch for the anti-pattern:

> The system already knows the answer, but the prompt asks the model to infer it again.

Prefer:

```json
{
  "mode": "assistant",
  "taskType": "respond"
}
```

over making the agent infer mode from message syntax when the orchestrator already decided it.

---

## 4. Define contracts that are mutually exclusive and testable

Every behavioral state should have a single clear meaning.

Bad:

```text
addressed = replied OR deliberately silent
ignored = no reply needed
```

These overlap.

Better:

```text
addressed = an outbound action occurred
ignored = no outbound action was needed
escalated = user/owner decision is required
failed = the task did not complete
```

Check contracts for:

- overlapping statuses;
- contradictory modes;
- ambiguous precedence;
- unsafe fallback behavior;
- malformed output being treated as success;
- uncorrelated escalation;
- implicit assumptions that cannot be tested.

Prefer explicit precedence where multiple instructions can apply:

```text
1. immutable agent/safety contract
2. contact-specific rules
3. global/shared rules
4. contact memory
5. global/shared memory
6. conversation history
```

Only use a precedence rule when it matches the implementation and intended behavior.

---

## 5. Structure the skill around outcomes, not protocol order

A good default information architecture is:

```text
# What this skill enables

## 1. Primary workflow
## 2. Configuration / control
## 3. Escalation / failure / lifecycle
## 4. Purpose -> action or command
## 5. Extension / custom implementation

## Reference
### Protocol
### Event fields
### Configuration schema
### Advanced behavior
```

Prefer this flow:

```text
What should I do?
-> Which layer should I use?
-> How do I operate/configure it?
-> What behavioral contract must I follow?
-> What are the low-level details?
```

Avoid leading with protocol/reference material unless the protocol itself is the skill's main user goal.

---

## 6. Keep the skill concise at the decision points

The most important information is information that changes agent behavior.

Prominently document:

- when to use the skill;
- architecture/layer selection;
- important modes;
- configuration that changes behavior;
- escalation conditions;
- action/command selection;
- failure semantics;
- extension path.

Move exhaustive field tables, wire formats, rendering details, and long examples into reference sections unless they are necessary for choosing the right behavior.

A useful test is:

> If this paragraph were removed, could the agent still choose the correct action?

If yes, it may belong in reference material.

---

## 7. Use the user's language for behavior, preserve technical identifiers

When the main user workflow is in a particular language, use that language for:

- intent examples;
- behavioral instructions;
- escalation rules;
- user-facing explanations.

Keep real technical identifiers unchanged:

```text
contacts-assistant
send-text
message:text
mentionMe
rules.md
memory.md
status
```

Prefer:

```text
`contacts-assistant`：以 assistant-managed mode 关注的联系人
```

over translating the actual configuration key.

---

## 8. Align companion agent prompts

If the skill ships agent prompts, review them after the main skill contract is stable.

Each agent prompt should:

1. consume deterministic decisions rather than re-derive them;
2. use the same status semantics as the main skill;
3. use the same escalation criteria;
4. use the same rule/memory distinction;
5. avoid contradictory persona requirements;
6. expose only the commands needed by that role.

For a multi-agent architecture, clearly divide responsibilities.

Example:

```text
Orchestrator:
- deterministic routing
- watch configuration
- mode selection
- escalation routing
- session ownership

Contact agent:
- reply relevance
- natural language
- authorization judgment
- memory extraction
```

---

# Building evals

Do not generate evals by walking through the skill document section by section.

Generate evals from the **capability tree**.

The question is not:

> What facts are mentioned in SKILL.md?

The question is:

> What decisions must an agent get right for this skill to achieve its goal?

---

## 9. Build a capability-based eval matrix

For each capability, identify observable decisions.

Example:

| Capability | Decision to test |
|---|---|
| architecture selection | managed workflow vs direct action vs custom implementation |
| configuration | add/remove/change configuration |
| behavior policy | reply vs ignore vs escalate |
| persistence | rule vs memory, global vs contact |
| action selection | user purpose -> command/tool |
| lifecycle | status/result semantics |
| extension | custom listener/orchestrator behavior |
| privacy/safety | unauthorized disclosure or consequential action |

For each important capability, include:

- a normal/happy-path case;
- a negative case;
- an ambiguous or adversarial case where useful.

Avoid generating many nearly identical syntax tests.

---

## 10. Test skill behavior, not underlying implementation correctness

A skill unit eval should usually test:

```text
skill + user/task context
-> agent decision
-> intended action
```

It should not primarily test whether the product implementation successfully performs network, browser, upload, or external API behavior.

For example:

Good skill eval:

```text
User wants to send a PDF once.
Expected decision: use send-file, not start the orchestrator.
```

Implementation/integration test:

```text
Does send-file actually upload the PDF to WeChat?
```

Those are different test layers.

Keep them separate.

---

## 11. Prefer structured dry-run outputs for unit evals

When practical, make the eval prompt return structured intent rather than requiring real side effects.

Example:

```json
{
  "decision": "reply|ignore|escalate|configure|execute",
  "mode": "maintainer|assistant|null",
  "actions": [
    {
      "type": "send-text",
      "target": "Alice"
    }
  ],
  "persistence": [
    {
      "type": "rule",
      "scope": "contact",
      "contact": "Alice"
    }
  ],
  "finalStatus": "addressed|ignored|escalated|failed"
}
```

Use real integration/action transcripts in a separate eval layer when the implementation itself must be verified.

---

## 12. Prefer deterministic assertions

If an outcome can be checked deterministically, do not use an LLM judge for it.

Use deterministic assertions for:

```text
- exact status
- selected mode
- selected command/tool
- target contact
- configuration key
- whether an action exists
- JSON schema
- required mention syntax
```

Use model-graded rubrics for genuinely qualitative behavior:

```text
- whether a response avoids making an unauthorized commitment
- whether escalation contains enough context
- whether wording is natural and appropriate
- whether architecture selection is well justified
```

Rule:

> Deterministic facts should have deterministic assertions.

---

## 13. Suggested eval distribution

As a default:

```text
60-70% capability/behavior decisions
15-20% edge/adversarial cases
10-20% protocol or command knowledge
```

Adjust this based on the actual capability tree.

Do not let protocol trivia dominate unless protocol use is the skill's primary purpose.

---

## 14. Review eval failures correctly

An eval failure can indicate different problems:

```text
A. skill contract is unclear
B. agent prompt contradicts the skill
C. eval expectation is wrong or overly narrow
D. implementation and documented contract disagree
E. model behavior is genuinely poor despite a clear contract
```

Do not immediately patch the prompt to satisfy a failing test.

First classify the failure.

Use this loop:

```text
real goal
-> capability tree
-> skill contract
-> agent prompts
-> eval matrix
-> eval results
-> classify failures
-> improve contract/evals
```

---

## 15. Run evals across different harnesses

When the same skill will be consumed by multiple agent harnesses, make provider selection a runtime concern rather than hard-coding one harness into the eval suite.

Use a simple target form:

```text
<harness-or-provider>:<model>
```

Examples:

```text
openai:gpt-5
anthropic:claude-sonnet
codex:gpt-5
claude:sonnet
copilot:gpt-5
pi:gpt-5
```

Important distinction:

- In native Promptfoo syntax, the segment before `:` is a **Promptfoo provider ID**, not automatically the executable name of a CLI.
- A harness name such as `codex`, `claude`, `copilot`, or `pi` can use this simple form only when Promptfoo already supports that provider ID or the project provides a resolver/adapter for it.
- Do not assume that `codex:gpt-5` means "execute the `codex` binary" unless the eval infrastructure explicitly defines that mapping.
- Prefer a project-level provider resolver/adapter so users can keep the clean `<harness>:<model>` interface instead of passing `.sh` wrapper paths.

The desired operator experience is:

```bash
promptfoo eval -c skills/<skill>/evals/promptfooconfig.yaml -r codex:gpt-5
promptfoo eval -c skills/<skill>/evals/promptfooconfig.yaml -r claude:sonnet
promptfoo eval -c skills/<skill>/evals/promptfooconfig.yaml -r copilot:gpt-5
promptfoo eval -c skills/<skill>/evals/promptfooconfig.yaml -r pi:gpt-5
```

If Promptfoo does not natively support one of those provider IDs, the skill author should document or provide the adapter that resolves:

```text
codex:<model>   -> current Codex harness/authentication + selected model
claude:<model>  -> current Claude harness/authentication + selected model
copilot:<model> -> current Copilot harness/authentication + selected model
pi:<model>      -> current pi harness/authentication + selected model
```

Do not force API-key-backed execution when the intended harness can already authenticate through its current local/session login.

Also distinguish the **model under test** from the **judge**:

```text
target provider/model
    -> produces the skill behavior being evaluated

assertion/judge
    -> grades that behavior
```

Prefer deterministic assertions so that running against a locally authenticated harness does not also require a separate judge API key.

When an LLM judge is genuinely necessary, make the judge provider configurable independently from the target provider.

For cross-harness compatibility, the same eval cases should be runnable unchanged against multiple targets. The provider/model choice should not change the meaning of the tests.

---

# Creation workflow

When creating a new skill:

1. Identify the real user goal.
2. Produce the capability tree.
3. Identify external tools/interfaces the skill controls.
4. Decide which decisions are deterministic vs model-driven.
5. Define explicit behavioral contracts and failure states.
6. Draft the skill around capabilities.
7. Put protocol/schema details into reference sections.
8. Add companion agent prompts only when they serve distinct roles.
9. Build the eval matrix from the capability tree.
10. Generate evals.
11. Validate configuration/syntax.
12. Run evals when possible.
13. Classify failures and revise.

---

# Improvement workflow

When improving an existing skill:

1. Read the current skill.
2. Inspect relevant implementation and companion prompts.
3. Ignore the current document structure temporarily.
4. Reconstruct the real goal and capability tree.
5. Compare that tree with what the skill currently emphasizes.
6. Identify missing, duplicated, contradictory, or implementation-level content.
7. Identify decisions that should move from model inference to deterministic configuration.
8. Fix ambiguous contracts before writing evals.
9. Rewrite the skill around the capability tree.
10. Align companion prompts.
11. Generate/update capability-based evals.
12. Validate and run evals.
13. Review failures by root cause.

---

# Review checklist

Before considering a skill complete, verify:

## Goal and structure

- The real user goal is stated or clearly implied.
- The capability tree is small enough to understand.
- Primary workflows appear before protocol/reference details.
- Each major section corresponds to a real capability or necessary contract.

## Behavior

- Deterministic decisions are not unnecessarily delegated to the model.
- Modes and statuses do not overlap.
- Rule/memory/configuration semantics are clear.
- Escalation or user-approval boundaries are explicit when applicable.
- Failure behavior does not silently become success.

## Extensibility

- The default managed workflow is clear.
- Lower-level primitives are documented when custom implementations are a real supported goal.
- The skill does not imply that one bundled implementation is the only possible architecture unless that is intentional.

## Evals

- Tests derive from capabilities, not headings.
- Important capabilities have positive and negative coverage.
- Edge/adversarial cases target real failure modes.
- Deterministic outcomes use deterministic assertions.
- LLM rubrics are reserved for qualitative judgments.
- Unit skill evals do not accidentally become implementation integration tests.

---

# Output expectations

When asked to create or improve a skill, produce at minimum:

1. a concise statement of the real goal;
2. the capability tree;
3. important implementation-vs-contract findings;
4. the revised `SKILL.md`;
5. aligned companion prompts if applicable;
6. an eval matrix;
7. eval files/config when requested;
8. a summary of unresolved implementation mismatches or risks.

If asked only for review, stop before modifying files unless the user asks for edits.
