# Visioner Agent: intelligent initial-cut preprocessing

The Neo Project Visioner Agent, not a keyword or regular-expression parser,
interprets speech, Hey Neo commands and semantic scene boundaries. STT WebVTT
subtitles are distinct from visual Video-to-Text inference.

## 1. Produce technical evidence

On an owner-approved dated Vlog run, invoke:

    node vlog/scripts/propose-initial-cut.mjs /Users/chengli/Workspace/neo/vlog/runs/<dated-episode> --context "骑行 Vlog"

This writes initial-cut-evidence.json (verified source hashes, durations and
timestamped raw STT cues) and initial-cut-agent-prompt.md (the Agent task).
No semantic speech recognition and no editing occurs in code at this step.

## 2. Agent chooses semantic cut boundaries

The Visioner Agent reads the prompt and context and decides whether speech
is ordinary dialogue or an editing command. It recognizes paraphrases,
commands spanning multiple caption cues and implicit references when grounded.
It can split a long video into several distinct source-time ranges and choose
their order, Hook/development/payoff, keep/remove, audio and shot intent.
For ambiguous targets, preserve uncertainty rather than guessing.

The Agent outputs a JSON decision with source IDs, STT cue IDs for commands,
source in/out seconds for each proposed cut, and reasons. Save it privately
as runs/<episode>/initial-cut-agent-result.json.

Then run:

    node vlog/scripts/propose-initial-cut.mjs /Users/chengli/Workspace/neo/vlog/runs/<dated-episode> --context "骑行 Vlog" --agent-result /absolute/agent-result.json --preview

The code only validates source, cue and time identities, then renders the
low-resolution initial-cut-preview.mp4 and writes initial-cut-proposal.json,
vision-context.json. These are unapproved private drafts, never published.

## 3. Visual Understanding with initial-cut context

The Visioner passes vision-context.json through Markcut Vision --context and
analyzes original media using original timestamps. Director challenges the
Agent's rough-cut choices against real visual evidence. The source-grounded
Director/Editor/Producer approvals remain mandatory, and no final video is
generated as part of this preprocessing step.
