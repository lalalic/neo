# Shopify and fulfillment connectors

Neo Commerce is an orchestrator for verified merchant offers; it does not accept payment itself.

## Shopify

The Storefront API uses GraphQL at the authorized merchant's myshopify.com hostname and the server-held Storefront token. The read-only product lookup returns live product/variant availability and CAD prices. Draft items do not appear as public Storefront products.

Only after an authenticated merchant/owner approves a specific product offer and a buyer taps Checkout may the backend create a Shopify cart and hand off its checkoutUrl. The payment, refunds, taxes and buyer identity are handled by Shopify; creating the cart is not proof of payment. Never put access tokens in Treasure's iOS bundle. Never generate checkout for third-party listings that the merchant is not authorized to sell.

The Python client in scripts/shopify_storefront.py implements validation, live product lookup and approval-gated cartCreate. It is not currently connected to any live store API because no authenticated Storefront token or eligible published product has been provided.

## Shopify Collective

Canada and CAD are supported with merchant eligibility conditions. An eligible retailer imports supplier-shared products, synchronizes inventory and price, and forwards paid orders to the supplier for fulfillment, tracking and supplier payment. The store must be fully eligible and linked to each supplier. No supplier connected in this project yet.

## CJ dropshipping

CJ API supports product and variant lists, inventory, freight quotes, Create Order V3, paid order handling, logistics and dispute operations. An order may be routed to unconnected/invalid status when the store variant has no SKU mapping. Only confirmed products/warehouse/shipping quote with an explicit owner payment gate may progress. Shopify's CJ app may sync orders; do not imply there is a mandatory manual approval toggle inside CJ Shopify app without evidence.

Source pages:
- https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage
- https://help.shopify.com/en/manual/online-sales-channels/shopify-collective/retailers/requirements-and-considerations
- https://developers.cjdropshipping.com/en/api/start/Orders-Synchronization-Processing.html

## Private project and iOS integration

Historical real SKU and email research remains in ignored runs/, never in tracked Neo public files. Treasure's private repo holds docs/NEO_COMMERCE_INTEGRATION.md and pending Share Extension. Current unapproved items have no checkout.
