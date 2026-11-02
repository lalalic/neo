# Social publishing and feedback monitoring

The execution node is **Worknode**. Project account identities and current Safelist state are exclusively in [accounts.md](../accounts.md); do not duplicate them in runs or store login secrets.

1. Before any task, verify the Worknode **managed Chrome** account using the relevant WebHelm Platform `inspect` Action with the expected account identity. Stop on `blocked` or an identity mismatch; a Neo Master login does not authenticate Worknode.
2. For each owner-approved, rights-cleared creative, use the platform `post` Action **only** with the explicit `confirm_publish:true` guard and the exact permitted destination. A browser Send/Post/Save click yields only an *unverified submission*. Collect the actual published post URL, visibility and channel receipt, or fail closed if ambiguous. No public posting was authorized during this platform review.
3. Use the read-only `monitor` Action with `mode:posts` (YouTube `content_type:shorts`) and `mode:comments`. Record the returned `observed_at`, source URL, post IDs, observed counts and comment snippets in the campaign Run, with exact source provenance. These Actions never respond to commenters.
4. Treat `null` metrics, `unverified`, or `blocked` as **missing information**, never zero. Link metrics by observed post ID/URL and time; compare repeated samples for trends. Follow up on actual user feedback and legitimate provider purchases separately; no platform likes/views imply a CPS sale.
5. Safelist registration is an account-level prerequisite, not approval to publish. Obtain explicit owner approval for each revised video, account and link, and observe current RS Boost permissions before posting. Financial withdrawals and sensitive identity/bank/tax submissions require separate approval.

Platform Actions are maintained in the **Worknode** `~/.local/webhelm/platforms/{tiktok,youtube}` checkout. Read the installed WebHelm Skill and `platform profile`/`platform run --help` for current interfaces, not a copied CLI grammar. Platform features stay marked unverified until a real authenticated end-to-end result is observed.
