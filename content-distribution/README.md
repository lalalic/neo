# Content Distribution

Neo Project for **licensed short-video affiliate distribution**. The first provider is ReelShort RS Boost; other providers, including ReelTree, remain research candidates until their current rights and settlement terms are verified. The goal is measurable, compliant conversion—not a promise of revenue.

The canonical stage topology is [graph.mmd](graph.mmd). [AGENTS.md](AGENTS.md) defines the approval and evidence gates. Project-only roles live in `agents/`; the existing Markcut Skill produces and previews video. Do not fork the Vlog renderer, reproduce the Commerce checkout integration or create a new task queue.

## First use

1. Run `neo project resolve content-distribution` to locate this project.
2. Review the [provider research pointers](config/providers.json) against the *current authenticated provider pages*; do not treat historical promotional rates or old correspondence as active campaign terms.
3. Open a dated private run at `runs/<YYYY-MM-DD[-campaign]>/` under this **canonical** directory; record the authorized account's observed status and the exact episode/material/channel rights without putting private data into Git.
4. Produce a private three-creative campaign plan and use Markcut to prepare `video.md` and previews from provider-approved material only.
5. Obtain explicit owner approval of the exact preview, target accounts and release plan **before** safelist submission or public posting. Record link attribution and channel receipts, then track actual eligible conversions and settlement.

A self-service account, a working referral URL, an approved creative and a paid commission are different evidence states. Production runs, media, license snapshots, referrals, account IDs, receipts and financial exports are private under ignored `runs/`. Never commit secrets or third-party licensed video to this public repository.

No persistent service or `neo-project` lifecycle entrypoint is needed for the current agent-only project. Existing Neo/Markcut/WebHelm integrations are invoked when the owner authorizes their relevant actions.
