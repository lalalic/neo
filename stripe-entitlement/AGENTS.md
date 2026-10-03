# Stripe Entitlement Worker

This project is reusable payment infrastructure. Keep it stateless unless a future requirement genuinely needs durable server-side state.

- Never commit or print Stripe secrets.
- `session_id` is treated as an opaque bearer reference from Stripe Checkout.
- Return only normalized entitlement information; never return customer, card, invoice, or raw Stripe objects.
- Subscription status is active only for Stripe `active` or `trialing`.
- Clients own caching policy. This service answers current Stripe state and must use `Cache-Control: no-store`.
- Unit tests must mock Stripe HTTP calls. The explicit `npm run test:e2e` path may call the dedicated Stripe Test Mode Worker/API fixture; tests must never hit Stripe production APIs.

## Project learnings

- 2026-09-29: For low-frequency extension subscription checks, a stateless Worker that resolves Checkout Session → subscription is simpler than webhook + database infrastructure and matches the client-side expiry-refresh model.
