# Stripe Entitlement

Tiny stateless Cloudflare Worker that lets browser extensions validate a recurring Stripe subscription only when their local entitlement expires.

```text
extension local validUntil
        │ expired / force refresh
        ▼
GET /v1/entitlement?session_id=cs_...
        ▼
Cloudflare Worker
        ▼
Stripe Checkout Session → Subscription
        ▼
{ active, status, currentPeriodEnd }
```

The Worker stores no customer data and needs no D1/KV/webhook. `STRIPE_SECRET_KEY` is a Cloudflare Worker secret and never belongs in Git or the extension bundle.

## API

`GET /v1/entitlement?session_id=cs_test_...`

```json
{
  "active": true,
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
