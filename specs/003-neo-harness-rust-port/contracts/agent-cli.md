# CLI Contract: neo-rs agent

## Invocation

```
neo-rs agent list [--project PATH] [--source project|shared|global|agency]
neo-rs agent search QUERY [--project PATH] [--source ...] [--limit N]
```

`agent list` rejects positional query words and `--limit`. `agent search`
requires nonempty query words; `--limit` accepts 1..283. Unknown flags and
invalid source values fail nonzero.

## JSON Output

A JSON array sorted as in the reference CLI. Each item:

```json
{
  "name": "reviewer",
  "description": "Shared code reviewer",
  "source": "shared",
  "path": "/absolute/path/reviewer.agent.md",
  "requires_project_manifest": false,
  "effective": true
}
```

Optional `type` and `extends` are present only if frontmatter provides a
nonempty value. No additional command envelopes or status objects are added.

## Discovery

- A project may be selected with `--project PATH`, otherwise inferred from cwd.
- Project precedence: project > global > shared > Agency.
- A missing Agency catalog is an error, not an empty successful list.
- `--source` filters results after precedence is established.
- Search scoring: exact name 100, name substring 50, description substring 25,
  plus 10 per matching word in name or 3 per matching word in description.
- Limit applies after sorting.
- stdout contains JSON only; errors are on stderr and exit nonzero.

## Compatibility Gate

For each fixture, run both implementations with the same env, cwd and
arguments; JSON values, ordering, and exit status MUST match. For error tests,
match failure class and relevant diagnostic rather than platform-specific
stack trace formatting.
