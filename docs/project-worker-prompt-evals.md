# Neo Project Worker Prompt Quality Evals

**Goal:** A project Worker must make the right domain decision from the project policy, its role, and actual task evidence. Correct Relay transport/bootstrap alone cannot prove quality.

## Capability tree

1. Understand source evidence and uncertainty for the assigned role.
2. Select the project-owned action; do not cross role or authorization boundaries.
3. Convert plan/brief into observable output, rather than merely writing plausible metadata.
4. Hold on missing playback, missing input, or missing human approval without claiming PASS.
5. Preserve source/version correlation and choose a recoverable failure action.

## Project-owned eval contract

Every Neo Project contains `.evals/cases.json` and a local `.evals/reports/` directory. For projects defining `agents/*.agent.md`, include at least one source-grounded positive, negative or adversarial choice per local Worker role. An empty cases array explicitly means `NOT_EVALUATED`, not a passing project. Each case includes a distinct `capability`, `task`, and an unambiguous set of decisions, with `expectedDecision`; optional `required` checks test concrete output detail. Scenarios are not derived by paraphrasing SKILL headings. Use [skill-builder](../skills/skill-builder/SKILL.md) and global Markdown rules for role or eval changes.

The shared runner calls **Agents Relay's production `managedWorkerInput` PromptBuilder** through the read-only `agents-relay prompt --eval-file` interface for every decision Case. The Builder resolves the effective Agent contract and produces two outputs from the same authoritative role: `productionPrompt` (actual Bootstrap, Contracts, Context references and execution identity) and `evaluationPrompt` (isolated role/test context that cannot publish Task events). The runner stores both byte-for-byte, executes only `evaluationPrompt` in Codex with the project directory as cwd, and grades the structured decision. Hand-assembling AGENTS.md plus role files is forbidden. The test never creates a durable Relay Job or execution. Project configs stay local; actual media/credentials do not enter eval fixtures. Evals store their complete prompt, raw model result and deterministic verdict under ignored `.evals/reports/`.

```bash
neo eval audit
neo eval list --project vlog
neo eval run --project vlog --dry-run
neo eval run --project vlog --model gpt-6-luna
neo eval run --project vlog --case template-verify
```

The runner resolves the Agents Relay PromptBuilder CLI in this order: an explicitly configured `AGENTS_RELAY_DIST_CLI` (absolute path), an adjacent development checkout, then the installed `agents-relay` executable on `PATH`. Installed Relay must be compatible with the Harness; when testing unmerged changes, explicitly set `AGENTS_RELAY_DIST_CLI` to the matching local build. Neo Eval supplies installed shared Agents via `AGENTS_RELAY_SHARED_ROOT` and the configured Neo project boundary via `AGENTS_RELAY_WORKSPACE_ROOT`. It uses `NEO_ROOT` rather than assuming a project lives in the Harness source checkout. Missing or incompatible Builder is a hard failure, never a static-prompt fallback. The `neo` executable is owned by this repository's `package.json` bin (`.bin/neo.mjs`). From a checkout, `node .bin/neo.mjs eval ...` is equivalent. Without `--project`, run in the project root. `--case` selects one ID; `--dry-run` assembles and validates but executes neither a model call nor a test. The runner writes all evidence to a timestamped directory under `.evals/reports/` (ignored by Git). Historical eval reports were migrated there from `runs/evals/worker-prompts/`.

## Case types

- **Decision** (`type: "decision"` or omitted): Relay PromptBuilder generates the prompt first; supply `id`, `role`, `capability`, `task`, `choices`, and `expectedDecision`; optionally `references`, `required`, `forbidden`. The runner assembles actual role/project rules and asks the configured Codex model for structured intent. The verdict is a deterministic comparison, not a claim of real tool execution.
- **Executable verification** (`type: "node-tests"`): supply `id`, `role`, `capability`, and a nonempty `testFiles` array of project-local `test/*.test.mjs`. The runner executes Node's test runner and checks its real exit status. A missing test file, failed render or invalid Markcut DSL fails the case. It is not an LLM opinion; no API model call is made for that case.

An executable test is a separate layer from model decisions. Do not label a dry run as PASS or include a deterministic test in a model-only success rate.


**Coverage does not imply quality PASS.** Projects without local role definitions are reported as `NO_LOCAL_WORKER_ROLES`; project tasks executed by shared agents still need task-specific eval scenarios before asserting coverage. If a project lacks `.evals/cases.json`, or a local role has no case, `neo eval audit` fails. Shared Worker roles that are not project-local still need project-specific scenarios before claiming outcome coverage. An eval with a valid model decision but a brittle wording assertion must be corrected as an eval defect, not used to hide an execution defect.

## Separation from other gates

| Gate | What it measures | Does not establish |
| --- | --- | --- |
| Project prompt eval | Domain decisions in source-based, role-aware simulated tasks | Tool actually performed an action |
| Relay PromptBuilder/L4 | Adapter, bootstrap, contract reachability and events | Creator/consumer outcome quality |
| Project integration | Markcut compile/render, real audio/visual playback, complete revision-bound review | Human approval, publishing consent |

`agents-relay prompt --eval-file CASE.json --adapter codex` runs the production Builder using isolated synthetic execution IDs, without persisting a Job or Task. This validates current PromptBuilder assembly, not an old Task's immutable historical prompt. Each report contains `*.builder-input.json`, `*.builder-output.json`, `*.production.prompt.txt`, `*.prompt.txt`, `*.response.txt`, and reference snapshots. The generated production prompt is **inspected**, never executed (it contains Task events); only the Builder's safe evaluation mode is fed to the model. To evaluate an exact historical Task prompt, use a persisted execution-bound Relay `prompt --id --task-id` when its execution ID is still available; never claim synthetic IDs are historical.

## Vlog quality matrix

| Role | Observable decision |
| --- | --- |
| Visioner | Do not treat unverified STT as witnessed speech |
| Director | Turn source facts into a story with audible delivery plan before shot handoff |
| Editor | Preserve the spoken payoff, not just attractive frames |
| Producer | Reject silent scenic slideshow; use the template's exact song; hold on inaccessible reviewer playback |
| Producer template-verify | Execute canonical Markcut template identity, compilation, real render and audio checks; reject run-local song overrides |
| Final QA | Missing owner approval or sound review cannot PASS |
| Video Director / Market | Cannot PASS from contact sheets without AV playback |
| Planner | Build actual five stages from the Vlog Graph, not a wrapper Task |

When adding more Worker roles or cases, extend this matrix and run the model eval, then verify implementation separately. Generic word-search tests are for Markdown links and budgets, not creative quality.
