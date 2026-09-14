# Episode 001 source notes

## Working title

给 Web ChatGPT 补一个 Skills 系统

## Event

The user wanted Web ChatGPT to operate more like a local agent harness: discover
locally available skills, load only the instructions relevant to the current
task, and then use local tools when the task depends on the user's Mac.

Web ChatGPT does not natively scan the user's local skill directories. A new
chat therefore needs an explicit bootstrap contract before it can discover and
use those local skills.

## Working solution

The current solution is a lightweight external bootstrap:

1. `web-chatgpt-skills.md` defines the Web ChatGPT orchestration contract.
2. The bootstrap tells Web ChatGPT to use MacDevBridge for local-machine work.
3. `/Users/chengli/Workspace/neo/.bin/list-web-chatgpt-skills` dynamically scans
   installed/project skill locations and returns only `name`, `description`,
   and absolute `SKILL.md` path.
4. The orchestrator chooses only the relevant skill(s), then reads those
   `SKILL.md` files on demand instead of loading the whole library.
5. `#skill-name` gives the user an explicit override when they want a particular
   skill loaded first.
6. The selected skill can then drive actual local work through MacDevBridge or
   another appropriate tool.

This replaced the earlier idea of maintaining a static skills index by hand.
The dynamic discovery script is the current implementation and should be the
primary evidence in the episode.

## Story guardrails

- Do not claim Web ChatGPT gained native local-skill extensibility. This is an
  external bootstrap/orchestration layer around the product.
- Do not present Google Drive or a static `SKILLS_INDEX.md` as the current
  architecture; those were earlier ideas, not the final implementation.
- Show the real `.bin/list-web-chatgpt-skills` command and a real selected
  `SKILL.md` as evidence.
- Keep credentials, private messages, tokens, and unrelated local files out of
  captures.
- Prefer one concrete end-to-end example over a catalog of all available skills.

## Natural next hook

Once Web ChatGPT can discover and load a local skill, the next question is
whether it can reliably turn that skill into real local execution and visible
progress on the user's Mac. That is the natural bridge into the next build log.
