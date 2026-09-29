# Stripe Entitlement

Tiny stateless Cloudflare Worker that lets browser extensions validate a recurring Stripe subscription only when their local entitlement expires.

```text
extension local validUntil
        │ expired / force refresh
        ▼
GET /v1/entitlement?session_id=cs_...&product=team-mate
        ▼
Cloudflare Worker
        ▼
Stripe Checkout Session → Subscription
        ▼
{ active, status, currentPeriodEnd }
```

The Worker stores no customer data and needs no D1/KV/webhook. `STRIPE_SECRET_KEY` is a Cloudflare Worker secret and never belongs in Git or the extension bundle.

## API

`GET /v1/entitlement?session_id=cs_test_...&product=team-mate`

```json
{
  "active": true,
  "product": "team-mate",
  "plan": "weekly",
  "status": "active",
  "currentPeriodEnd": "2026-10-06T12:00:00.000Z"
}
```

Only Stripe `active` and `trialing` count as active. `past_due`, `unpaid`, `canceled`, missing subscriptions, and invalid Checkout sessions are inactive.

## Deploy

```bash
npm install
npm test
npx wrangler secret put STRIPE_SECRET_KEY
npm run deploy
```


## Multi-product contract

The same Worker is shared by all apps/extensions. Every recurring Stripe Checkout/Subscription must carry metadata:

```text
product = team-mate       # required, lowercase kebab-case
plan = weekly             # optional but recommended
```

Clients must send their expected product id in every entitlement request. The Worker compares it with Stripe metadata before returning an active entitlement. A valid subscription for one product therefore cannot unlock another product. Future products only need to choose a stable product id, add matching Stripe metadata, and call this same endpoint.
