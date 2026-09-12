# Handoff protocol reference

The queue folders are inbox, processing, done, and failed below the handoff
root. A task directory contains STATE, HANDOFF.md, and eventually STATUS.md.
Folder moves use the verified current and destination parent IDs.

Target resolution is deliberately narrow: Repo and Folder are mutually
exclusive. A folder target maps to /Users/chengli/Workspace/<Folder> and does
not need to be a Git repository. A repository target requires one unambiguous
direct-child repository match and an origin identity match.

Terminal states are persisted in Drive before notification. Notification
delivery is non-authoritative; a delivery error is recorded locally and does
not reopen or alter the Drive task.
