# Web ChatGPT Skill Bootstrap

Web ChatGPT is the top-level orchestrator. Use this file as the copy/paste bootstrap instruction for Web ChatGPT. Local skills are discovered dynamically. When a skill must be uploaded manually, package it on demand with `.bin/package-web-chatgpt-skill`; generated ZIPs are temporary artifacts and are not stored in this repository.

## Mandatory bootstrap skills

### events-bus

Canonical local skill:

`/Users/chengli/Workspace/neo/skills/events-bus/SKILL.md`

If a ZIP upload is needed temporarily, generate it outside the repository or under the ignored `web-chatgpt/bootstrap/` directory, for example:

```bash
/Users/chengli/Workspace/neo/.bin/package-web-chatgpt-skill \
  /Users/chengli/Workspace/neo/skills/events-bus \
  /tmp/events-bus.zip
```

**Load `events-bus` first in every orchestration session.** For every delegated or background job, follow its bundled `references/protocol.md`: create and propagate one `job_id`, establish event consumption before launching sub-agents, and proactively surface `visibility=user` milestones, blocked/failure states, resource-release events such as `phone.released`, and completion in the current ChatGPT conversation. A progress event that exists only in a child process log is not user-visible progress and does not satisfy the contract. Keep event consumption active for the lifetime of the delegated job; do not wait for the user to ask for status before reporting an already-observed user-visible event.

## Bootstrap workflow

1. Load every skill listed under **Mandatory bootstrap skills** before delegating work.
2. Read `/Users/chengli/Workspace/neo/skills/chatgpt-orchestrator/SKILL.md`.
3. Run `/Users/chengli/Workspace/neo/.bin/list-web-chatgpt-skills` through DevMacBridge to discover currently available non-bootstrap skills.
4. Select relevant skills from each skill's `name`, `description`, and absolute `path`; read only the selected `SKILL.md` files before executing them.
5. If the user writes `#skill-name`, explicitly load that skill first. Explicit selection takes precedence over automatic matching.
6. Re-run discovery when the environment may have changed. Do not load every non-bootstrap skill body into context.

## Rules

- Projects are under `/Users/chengli/Workspace`.
- `lalalic/neo/xxx` means the `xxx` folder inside the `lalalic/neo` repository checkout.
- Prefer local skills and DevMacBridge when the task depends on the user's Mac, local repositories, authenticated CLI state, or local app state.
- Use ChatGPT as the orchestrator; delegate bounded implementation/execution to local harnesses when appropriate, then inspect observable results rather than trusting a success message alone.
- Apply the `model-router` skill before creating a new delegated model job. Prefer suitable already-paid capacity when quality is equivalent. Once a persistent worker thread is bound to a profile, keep it sticky unless rerouting is justified.
- For configured `zai` and `deepseek` profiles, default reasoning effort is `high` unless the task explicitly calls for something else.

## Explicit skill trigger

`#skill-name` means: load that skill's `SKILL.md` and follow it for this task.
