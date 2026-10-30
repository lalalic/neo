# Neo Commerce project

Read root AGENTS.md. Reusable code belongs in scripts/ and tests/. Private merchant details, Gmail message links, product IDs, SKU quotes, runs, purchase approvals and user data belong only under ignored runs/ directories.

No payment, purchase, order submission, supplier authorization, product publication, or automatic shipment without specific owner approval. A research listing is never a verified store offer. Fail closed on incomplete supply-chain gates and stale inventory. Never claim a paid video is licensed based on an ordinary CJ product page; advertising edits require separate rights verification.

Treasure owns iPhone Share Extension, story/video, challenge gameplay and promotion. Neo Commerce owns seller policy, supplier sourcing, offer readiness and Shopify/CJ/Collective fulfillment connectors. Both sides use the same product origin URL, an internal candidate ID and verified provider mapping. All accounts and tokens remain backend-only.

Run: python3 -m unittest discover -s tests -v.
