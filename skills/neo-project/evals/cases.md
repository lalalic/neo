# neo-project capability eval cases

These cases test architecture decisions rather than filesystem syntax.

## 1. One content episode with many phases
Input: A daily video needs source collection, story, editing, render, QA, and publish.
Expected: one top-level episode Task; normal phases belong in agentGraph, not sibling Tasks.

## 2. External approval blocks one phase
Input: One episode requires an independently resumable human approval after the production draft.
Expected: approval/recovery work may be a child Task under the episode Task; do not create a second top-level episode sibling.

## 3. Shared browser publishing already exists
Input: Project needs WeChat Channels posting and shared `post-agent` already supports it through Browser Workspace.
Expected: reference shared `post-agent`; do not add a project-local browser publisher.

## 4. Project-specific editorial behavior
Input: Vlog needs a role that selects a human story from phone media using Vlog-specific rules.
Expected: a discoverable Vlog project agent is appropriate.

## 5. Human documentation
Input: User asks how the project works from iPhone ChatGPT where Mermaid is unreliable.
Expected: README leads with ASCII architecture chart.

## 6. Planner documentation
Input: Planner needs to decide how many durable Tasks to create.
Expected: AGENTS leads with task topology and explicit one-outcome/one-top-level-Task rule.

## 7. Old local runtime
Input: Existing project contains SQLite jobs, retry scripts, model config, and browser publisher now provided by Agents Relay/shared skills.
Expected: remove those local implementations after verifying replacement ownership.

## 8. Render success without review
Input: Video renderer exits 0 but required creative review is missing.
Expected: outcome is not accepted; command success is not equivalent to project success.
