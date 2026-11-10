# Neo Harness, independent Projects, and Relay

**Agreed design, with remaining release gates explicitly noted.** This is the
Neo-side integration contract. For Relay's generic boundary and remaining
Neo-specific runtime references, see
`agents-relay/docs/harness-independence.md` in the Relay source repository.

## Component boundary

- **Neo.app (`neox`)** installs and updates the managed Harness and CLI, hosts
  native macOS permissions and the authenticated MCP gateway, and provides
  user settings. It does not implement Relay workflows.
- **Neo Harness (`neo`)** provides CLI/bootstrap, shared Agents/Skills, direct
  Neo Project discovery and Project-to-Relay execution-context binding.
- **Agents Relay** executes durable Jobs, Tasks and DAGs, performs routing,
  recovery and reviews; Relay is designed to run without Neo.
- **Neo Project** owns its independent Git history, agents, Shortcuts, DAG,
  contracts, code and private Runs.

```text
/Applications/Neo.app               # Native app (if installed)
<app-managed>/harness/              # Managed CLI + shared Agents/Skills
~/Workspace/                        # Default NEO_ROOT
  vlog/.git                         # Independent Project repo
  content-distribution/.git         # Independent Project repo
  other-project/.git
```

The installed Harness path is derived from the actual CLI package location,
**not** from `NEO_ROOT` or a source checkout. Source developers may separately
have `~/Workspace/neo` without making it a required installed path.

## One Neo configuration: `NEO_ROOT`

`NEO_ROOT` is both the name of the logical Projects root and a real,
**optional environment-variable override**. Selection order:

1. `NEO_ROOT` environment variable, when present;
2. `neoRoot` in `~/.config/neo/workspace.json`;
3. `~/Workspace` for a new/default installation.

Saved configuration has exactly these fields:

```json
{
  "schemaVersion": 1,
  "neoRoot": "/absolute/path/to/projects-parent"
}
```

On **Neo Master**, the saved `neoRoot` is `~/Workspace/neo` so the migrated
`vlog/` and `content-distribution/` projects keep their existing directory
and private Run paths. Do **not** interpret that local choice as a global
convention. `workspaceRoot` and `projectsRoot` are no longer valid saved
configuration keys. The Neo.app upgrade path converts an existing saved
configuration once, preserving the previously selected project root. A
malformed saved file must not silently trigger a fallback or move files.

Relay's *generic* execution-context `workspaceRoot` is separate from Neo's
saved configuration; when needed Neo supplies the bounded path to Relay as
Job context. Never conflate it with an additional Neo setting.

## Project discovery and source layout

`neo project list`, `neo project resolve <name>` and
`neo project run --project <name>` accept only a direct child directory of
`NEO_ROOT` that has:

- its own Git root (`<project>/.git`), independent of parent Git;
- `AGENTS.md`, `README.md`, and `graph.mmd`;
- additional optional files such as `agents/`, `agents/.shortcut/`,
  `contracts/`, `scripts/` and `project.run.json`.

A local Git repository **does not need a GitHub remote**. The source
repository's former `neo/vlog` aliases, nested project discovery and
monorepo fallback are intentionally unsupported. Git identity belongs to the
selected Project, not to `lalalic/neo`. A canonical private `runs/` directory
is ignored by Project source Git. Existing media and nested Run Git histories
are never imported, reset, or relocated during source-repo migration.

## Agent, Skill and Shortcut rules

Neo supplies a configured shared root pointing to its installed Harness and
a selected project execution context to Relay. Global, shared, bounded
ancestor and project-local sources are resolved with **closest applicable
project definition taking precedence**. `AGENTS.md` uses bounded folder-up
instruction inheritance; `agents/*.agent.md` uses explicit definition
selection and optional `extends:`. A Shortcut follows its **resolved Agent
source**, not a separate filename search:

```text
project/
  agents/
    director.agent.md
    .shortcut/director.agent.mjs
```

A local Agent without explicit inheritance must not execute an unrelated
same-named shared Shortcut. `extends: shared/visioner` may intentionally
inherit a differently named installed shared base Agent. Shared Agents and
Skills ship with the managed Harness package, not via a sibling Git checkout.

## Execution and migration safety

The Neo CLI validates Project and Run contracts, then invokes the generic
Relay CLI with the actual Project Git root, graph, required input/contracts,
shared capability location and runtime context. Relay owns lifecycle and
review state. A workflow without publication is valid for a local-only repo.

The historic Neo Master split preserved both source histories and left all
canonical private Runs in place. **Do not automatically rewrite old bound
Relay Jobs**: old `lalalic/neo` Run bindings need a separately verified job
migration, even though new Jobs resolve to the independent repositories.

`neo project run` details remain in
[Neo Project Run Contract](neo-project-run-contract.md). A project-specific
Agent's Markcut/media validation belongs in the Project or its own Shortcut;
it must not become a required feature of Relay.

## Release readiness and known limits

- Independent Neo Projects, single-root configuration, installed shared Agent
  staging and dry-run execution have been tested locally.
- Neo.app's pinned `@lalalic/neo@1.0.3` package must be published **before**
  the app can deploy the matching managed Harness version.
- A clean Neo.app installation still requires an available Node.js/npm
  runtime; a fully bundled zero-prerequisite install is a future gate.
- Relay still has Neo-specific source-level coupling; its standalone target
  is specified in `agents-relay/docs/harness-independence.md`.
- Code and Git-index migration changes are pending owner approval. Do not
  infer merge, push, npm publication, live app install or a completed
  historical Job-binding migration from these documents.
