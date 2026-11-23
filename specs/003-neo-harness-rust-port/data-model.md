# Data Model: Rust Neo Harness

This feature introduces no new persistent business database. It reads
existing resource declarations and preserves their original ownership.

## HarnessAssets

- `root`: verified absolute path to installed resource tree
- `agents_dir`: `root/agents`
- `bootstrap_doc`: `root/skills/xchat-orchestrator/xchat-bootstrap.md`
- **Rules**: independent from user Project root; must exist and be readable
  for the command that requires it.

## WorkspaceConfig

- `schemaVersion`: exactly 1
- `neoRoot`: absolute existing directory, user-selected
- `harnessRoot`: independent installed Harness resources
- **Rules**: no destructive reset or implicit Project migration.

## AgentDefinition

- `name`, `description`, `source`, `path`: required
- `type`, `extends`: optional frontmatter fields
- `requires_project_manifest`: true only for Agency templates
- `effective`: true for first discovered case-folded name
- **Sources, precedence**: explicit project, global, shared, Agency
- **Ordering**: final catalog sorted by name, then source; search sorted by
  match score, effective flag, then name
- **State**: computed on each query, never persisted.

## SkillDefinition (later slice)

- `name`, `description`, `absolutePath`, `available`
- `missing_required_skills`: optional
- **Rules**: resolve through the canonical Skills catalog, not a second
  independently maintained registry.

## Project and Run (later slices)

Existing independent Project and private Run declarations remain unchanged.
The Harness prepares and resolves them but does not own Relay's durable Job
or Task records.

## State Transitions

- Discovery: request → path/config validation → catalog assembly → filtered
  and ranked result or explicit error.
- Project Run: validation → input binding → private Run preparation →
  downstream acceptance → explicit terminal event from owning runtime.
