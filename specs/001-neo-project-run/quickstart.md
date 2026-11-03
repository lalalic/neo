# Quickstart: Neo Project Run

## URL reference

Set `PRIVATE_SOURCE_URL` to your authorized HTTPS source reference in your private shell. No source URL needs to appear in the public project documentation.

```sh
neo project run --url="$PRIVATE_SOURCE_URL" --project=content-distribution --dry-run
neo project run --url "$PRIVATE_SOURCE_URL" --project content-distribution --dry-run
```

## Existing canonical Vlog run

```sh
neo project run --path=/absolute/neo/vlog/runs/2026-11-03-episode --project=vlog --dry-run
neo project run --project vlog --path /absolute/neo/vlog/runs/2026-11-03-episode --dry-run
```

`--dry-run` only validates and previews; it creates no files and makes no Relay calls. Remove it only when an owner intentionally wants the explicit run delegation. URL references do not grant rights or publication permission. Vlog source media must be owner-approved, and its preview, QA, and publication gates still apply.

## Verification

From the isolated Neo worktree, run `AGENTS_RELAY_DIST_CLI=/absolute/path/to/agents-relay/dist/cli.js npm test` when the Relay checkout is not a sibling of the worktree. The full suite must pass using the existing read-only Relay CLI for prompt building. Project-run tests use temporary workspaces and a stub Relay runner; they do not create Jobs or access production media. Package staging is verified by the suite using a synthetic destination; no publish occurs.
