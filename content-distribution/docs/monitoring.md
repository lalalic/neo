# Social publishing and feedback monitoring

The execution node is **Worknode**. Follow [commercial readiness](commercial-readiness.md) for Campaign authorization, link, release and attribution checks and the [private measurement schema](../contracts/attribution-snapshot.schema.json). Account registry is in [accounts.md](../accounts.md).

1. Before any task, verify the Worknode **managed Chrome** account using the relevant WebHelm Platform `inspect` Action with the expected account identity. Stop on `blocked` or an identity mismatch; a Neo Master login does not authenticate Worknode.
2. For a real owner-signed **Campaign** publication authorization, run the project-local [publication gate](commercial-readiness.md) and **reserve the unique attempt**. Only then invoke the generic WebHelm post Action with matching video SHA-256 and account. An upload click remains unverified without its URL and visibility.
3. Use the read-only `monitor` Action with `mode:posts` (YouTube `content_type:shorts`) and `mode:comments`. Record the returned `observed_at`, source URL, post IDs, observed counts and comment snippets in the campaign Run, with exact source provenance. These Actions never respond to commenters.
4. Treat `null` metrics, `unverified`, or `blocked` as **missing information**, never zero. Link metrics by observed post ID/URL and time; compare repeated samples for trends. Follow up on actual user feedback and legitimate provider purchases separately; no platform likes/views imply a CPS sale.
5. Safelist filing is account-level: record `Pending Update` as an attribution/earnings uncertainty, not a requirement for RS Boost review of every clip. One Campaign authorization may cover many clips across its named platforms. Payment and identity changes remain separately gated.

Platform Actions are maintained in the **Worknode** `~/.local/webhelm/platforms/{tiktok,youtube}` checkout. Read the installed WebHelm Skill and `platform profile`/`platform run --help` for current interfaces, not a copied CLI grammar. Platform features stay marked unverified until a real authenticated end-to-end result is observed.

## Latest live read-only check (2026-11-02)

- TikTok on Worknode: authenticated `lalalic001`; `inspect` returned `ready`, `monitor(mode=posts)` returned one existing public post and visible metrics (107 views, 1 like, 0 comments); `monitor(mode=comments)` returned a verified empty Comments page. These are not RS Boost campaign metrics.
- YouTube on Worknode: `inspect` returned `ready` for channel `UCOoJX2s21KrOcRE0B46vx6g`; Shorts list and comments pages were accessible but returned `unverified` because no rows were observed.
- Both platform publish Actions remain **not live E2E verified**. No test media was uploaded or published.

**Fail-closed duplication:** the monitored 30 rows (including a list that simply omits `posts`) cannot prove a post does not exist. The generic posting Action requires a trustworthy sourced, recent and fully observed inventory; absent that it must block and require manual full-channel/drafts/private-Run reconciliation. See [commercial authorization](commercial-readiness.md).
