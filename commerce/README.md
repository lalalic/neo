Neo Commerce is the shared policy and integration project for Treasure and other Neo projects.

Workflow: user shares an HTTPS product URL to Treasure; merchant listing is imported as a sourcing candidate, not a sellable SKU. A commerce adapter checks source rights, active seller inventory, supplier commitments, verified freight/taxes/returns and per-payment owner authorization before it can expose any shopping checkout. Only a confirmed published and available Shopify product can lead to Shopify Storefront API cartCreate and checkoutUrl. Shopify Collective supplier flow and CJ reviewed manual fulfillment are distinct provider types; no auto-payment or stock claims are authorized.

Read-only checks: python3 scripts/commerce.py validate --input runs/2026-10-30-treasure-integration/offers.json. Unit tests: python3 -m unittest discover -s tests -v.

Run data is private and ignored. Never commit product/merchant identifiers, private email evidence, orders, account identifiers, secrets or real customers in this public Neo monorepo. Existing Shopify draft products have last-observed inventory zero, no confirmed fulfillment, and no verified license for paid video edits. All current states must be refreshed via authenticated provider before checkout becomes available.
