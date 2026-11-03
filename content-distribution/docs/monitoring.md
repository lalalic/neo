# Social publishing and feedback monitoring

The execution node is **Worknode**. Follow [commercial readiness](commercial-readiness.md) for complete rights, clickable-link, release and attribution gates and the [private measurement schema](../contracts/attribution-snapshot.schema.json). Project account identities and current Safelist state are exclusively in [accounts.md](../accounts.md); do not duplicate them in runs or store login secrets.

1. Before any task, verify the Worknode **managed Chrome** account using the relevant WebHelm Platform `inspect` Action with the expected account identity. Stop on `blocked` or an identity mismatch; a Neo Master login does not authenticate Worknode.
2. For a real signed and independently verified publication grant, first run the project-local [publication gate](commercial-readiness.md) and **reserve the attempt in the canonical private Run**. Only after the business gate passes may the generic platform `post` Action be called with `confirm_publish:true`, the exact channel identity and a matching staged Worknode video SHA-256. A browser Send/Post/Save click yields only an *unverified submission*. Collect the actual published post URL, visibility and channel receipt, or fail closed if ambiguous. No public posting was authorized during this platform review.
3. Use the read-only `monitor` Action with `mode:posts` (YouTube `content_type:shorts`) and `mode:comments`. Record the returned `observed_at`, source URL, post IDs, observed counts and comment snippets in the campaign Run, with exact source provenance. These Actions never respond to commenters.
4. Treat `null` metrics, `unverified`, or `blocked` as **missing information**, never zero. Link metrics by observed post ID/URL and time; compare repeated samples for trends. Follow up on actual user feedback and legitimate provider purchases separately; no platform likes/views imply a CPS sale.
5. Safelist registration is an account-level prerequisite, not approval to publish. Obtain explicit owner approval for each revised video, account and link, and observe current RS Boost permissions before posting. Financial withdrawals and sensitive identity/bank/tax submissions require separate approval.

Platform Actions are maintained in the **Worknode** `~/.local/webhelm/platforms/{tiktok,youtube}` checkout. Read the installed WebHelm Skill and `platform profile`/`platform run --help` for current interfaces, not a copied CLI grammar. Platform features stay marked unverified until a real authenticated end-to-end result is observed.

## Latest live read-only check (2026-11-02)

- TikTok on Worknode: authenticated `lalalic001`; `inspect` returned `ready`, `monitor(mode=posts)` returned one existing public post and visible metrics (107 views, 1 like, 0 comments); `monitor(mode=comments)` returned a verified empty Comments page. These are not RS Boost campaign metrics.
- YouTube on Worknode: `inspect` returned `ready` for channel `UCOoJX2s21KrOcRE0B46vx6g`; Shorts list and comments pages were accessible but returned `unverified` because no rows were observed.
- Both platform publish Actions remain **not live E2E verified**. No test media was uploaded or published.

**Fail-closed duplication:** the monitored 30 rows (including a list that simply omits `posts`) cannot prove a post does not exist. The generic posting Action requires a trustworthy sourced, recent and fully observed inventory; absent that it must block and require manual full-channel/drafts/private-Run reconciliation. See [commercial authorization](commercial-readiness.md).
