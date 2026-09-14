# Episode 001 Capture Review

Status: **production started — capture pending**

This file is the gate between recording and final Markcut preview. Update it
from actual desktop captures and NeoX `tour.status` results; do not mark an item
accepted before inspecting the media.

## Technical preflight

- Story rewritten against the current dynamic skill-discovery implementation: **yes**
- Temporary original BGM available at `assets/bgm/neo-build-log-001.mp3`: **yes**
- `npx @lalalic/markcut verify episodes/001/episode.md`: **pass**
- Current storyboard compiled in the Remotion player: **pass**
- Preview warning: Markcut edit-agent helper repeatedly restarted after exiting; preview server was stopped after compile verification.
- NeoX Capture Tour started: **no — phone was not discoverable over Bonjour during this run**

| Shot ID | Lane | Status | Media | Visible proof / content | Privacy + quality review | Editorial use |
| --- | --- | --- | --- | --- | --- | --- |
| `01-web-chat-gap` | desktop | missing | — | New Web ChatGPT context contrasted with real local skill directories | Pending | `gap` |
| `02-bootstrap-contract` | desktop | missing | — | Real `web-chatgpt-skills.md` bootstrap workflow | Pending | `bootstrap` |
| `03-dynamic-discovery` | desktop | missing | — | Real `.bin/list-web-chatgpt-skills` command + output | Pending | `discovery` |
| `04-select-and-load` | desktop | missing | — | One matching result followed by the corresponding real `SKILL.md` | Pending | `load` |
| `05-explicit-trigger` | desktop | missing | — | Optional `#skill-name` user override evidence | Pending | optional support |
| `06-local-execution` | desktop | missing | — | MacDevBridge/local task with an observable result | Pending | `proof` |
| `07-recursive-payoff` | desktop | missing | — | Episode 001 project files + successful Markcut verification | Pending | `payoff` |
| `presenter-circle` | neox | missing | `capture-tour.json` | Presenter head-and-shoulders take for recurring overlay | NeoX currently unreachable | overlay throughout |
| `discovery-flow-overlay` | generated/support | not-needed | — | Optional explanatory overlay; not evidence | N/A | optional support |

## Gate

- Essential desktop evidence accepted: **no**
- Essential NeoX presenter capture accepted: **no**
- Privacy review complete: **no**
- `episode.md` updated to accepted media: **no**
- Ready for final Markcut preview/render: **no**
