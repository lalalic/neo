import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolveEntitlement } from "../src/index.js"

const fixtures = JSON.parse(await readFile(new URL("../sandbox-fixtures.json", import.meta.url), "utf8"))
const config = process.env.STRIPE_E2E_CONFIG || (process.env.HOME + "/.config/stripe-meetmate-e2e/config.toml")

function stripeJson(args) {
  const output = execFileSync("npx", ["-y", "@stripe/cli", "--config", config, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  try {
    return JSON.parse(output)
  } catch {
    const start = output.indexOf("{")
    const end = output.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(output.slice(start, end + 1))
    throw new Error("Stripe CLI did not return JSON")
  }
}

function verifyPaymentDefinition(kind, fixture) {
  const product = stripeJson(["products", "retrieve", fixture.productId])
  const price = stripeJson(["prices", "retrieve", fixture.priceId])
  const link = stripeJson(["payment_links", "retrieve", fixture.paymentLinkId])

  assert.equal(product.livemode, false)
  assert.equal(price.livemode, false)
  assert.equal(link.livemode, false)
  assert.equal(product.metadata.product, fixtures.product)
  assert.equal(product.metadata.plan, fixture.plan)
  assert.equal(price.metadata.product, fixtures.product)
  assert.equal(price.metadata.plan, fixture.plan)
  assert.equal(price.unit_amount, fixture.unitAmount)
  assert.equal(price.currency, fixture.currency)
  assert.equal(link.url, fixture.paymentLinkUrl)

  if (kind === "weekly") {
    assert.equal(price.type, "recurring")
    assert.equal(price.recurring?.interval, "week")
  } else {
    assert.equal(price.type, "one_time")
    assert.equal(price.recurring, null)
  }
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function realStripeResolverFetch({ subscriptionId, sessionProduct = fixtures.product, sessionPlan = "weekly" }) {
  return async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.includes("/checkout/sessions/")) {
      return response({
        id: decodeURIComponent(url.pathname.split("/").at(-1)),
        livemode: false,
        subscription: subscriptionId,
        metadata: { product: sessionProduct, plan: sessionPlan },
      })
    }
    if (url.pathname.includes("/subscriptions/")) {
      return response(stripeJson(["subscriptions", "retrieve", subscriptionId]))
    }
    if (url.pathname.includes("/products/")) {
      const productId = decodeURIComponent(url.pathname.split("/").at(-1))
      return response(stripeJson(["products", "retrieve", productId]))
    }
    throw new Error("unexpected Stripe resource: " + url.pathname)
  }
}

verifyPaymentDefinition("one_time", fixtures.oneTime)
verifyPaymentDefinition("weekly", fixtures.weekly)

const oneTimeResult = await resolveEntitlement(
  "cs_test_e2e_one_time",
  fixtures.product,
  "sandbox-e2e",
  async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.includes("/checkout/sessions/")) {
      return response({
        id: "cs_test_e2e_one_time",
        livemode: false,
        subscription: null,
        metadata: { product: fixtures.product, plan: "one_time" },
      })
    }
    throw new Error("one-time resolver unexpectedly requested " + url.pathname)
  },
)
assert.deepEqual(oneTimeResult, {
  active: false,
  product: fixtures.product,
  plan: null,
  status: "no_subscription",
  currentPeriodEnd: null,
})

const customer = stripeJson([
  "customers", "create",
  "-d", "email=meetmate-e2e@qili2.invalid",
  "-d", "metadata[product]=team-mate",
  "-d", "metadata[purpose]=stripe-entitlement-e2e",
])

const subscription = stripeJson([
  "subscriptions", "create",
  "-d", "customer=" + customer.id,
  "-d", "items[0][price]=" + fixtures.weekly.priceId,
  "-d", "trial_period_days=7",
  "-d", "metadata[product]=team-mate",
  "-d", "metadata[plan]=weekly",
  "-d", "metadata[purpose]=stripe-entitlement-e2e",
])

assert.equal(subscription.livemode, false)
assert.ok(["trialing", "active"].includes(subscription.status), subscription.status)

const syntheticSessionId = "cs_test_e2e_weekly"
const fetcher = realStripeResolverFetch({ subscriptionId: subscription.id })

try {
  const active = await resolveEntitlement(
    syntheticSessionId,
    fixtures.product,
    "sandbox-e2e",
    fetcher,
  )
  assert.equal(active.active, true, JSON.stringify(active))
  assert.equal(active.product, fixtures.product)
  assert.ok(["active", "trialing"].includes(active.status), active.status)
  assert.ok(["weekly", "week"].includes(active.plan), active.plan)

  const wrongProduct = await resolveEntitlement(
    syntheticSessionId,
    "family-tutor",
    "sandbox-e2e",
    fetcher,
  )
  assert.equal(wrongProduct.active, false)
  assert.equal(wrongProduct.status, "product_mismatch")

  const canceled = stripeJson(["subscriptions", "cancel", subscription.id, "--confirm"])
  assert.equal(canceled.status, "canceled")

  const inactive = await resolveEntitlement(
    syntheticSessionId,
    fixtures.product,
    "sandbox-e2e",
    fetcher,
  )
  assert.equal(inactive.active, false, JSON.stringify(inactive))
  assert.equal(inactive.status, "canceled")

  console.log(JSON.stringify({
    ok: true,
    mode: "stripe-sandbox",
    sandboxAccountId: fixtures.sandboxAccountId,
    paymentDefinitions: {
      oneTime: fixtures.oneTime.paymentLinkId,
      weekly: fixtures.weekly.paymentLinkId
    },
    lifecycle: {
      initial: active.status,
      wrongProduct: wrongProduct.status,
      final: inactive.status
    }
  }))
} finally {
  try {
    const current = stripeJson(["subscriptions", "retrieve", subscription.id])
    if (current.status !== "canceled") stripeJson(["subscriptions", "cancel", subscription.id, "--confirm"])
  } catch {}
  try {
    stripeJson(["customers", "delete", customer.id])
  } catch {}
}
