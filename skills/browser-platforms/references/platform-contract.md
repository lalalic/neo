# Platform asset contract

Each platform directory contains a `manifest.yaml` and one markdown file per
flow. The manifest records:

- `platform`: stable external-platform identifier;
- `status`: `discovered`, `working`, or `verified`;
- `last_verified`: ISO date, or `null` when not verified;
- `browser_harness`: compatibility/version evidence, when known;
- `url_patterns`: URLs the flow may operate on;
- `flows`: per-flow maturity and evidence;
- `authentication` and `side_effects`: operator-facing cautions;
- `provenance`: source of migrated verified code, when applicable.

Flow documents must describe preconditions, navigation/interaction intent,
verification evidence, and side effects. They must not contain credentials,
cookies, tokens, or machine-local runtime paths.

