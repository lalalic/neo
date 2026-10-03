import test from "node:test"
import assert from "node:assert/strict"
import worker, { handleRequest, resolveEntitlement } from "../src/index.js"

function stripeFetch({ session = { subscription: "sub_123", metadata: { product: "team-mate", plan: "weekly" } }, subscription = { status: "active", current_period_end: 4_102_444_800, metadata: { product: "team-mate", plan: "weekly" } }, product = { id: "prod_123", metadata: { product: "team-mate" } }, sessionStatus = 200, subscriptionStatus = 200, productStatus = 200 } = {}) {
  return async (url) => {
    if (url.includes("checkout/sessions/")) return new Response(JSON.stringify(sessionStatus === 200 ? session : { error: { message: "missing" } }), { status: sessionStatus, headers: { "content-type": "application/json" } })
    if (url.includes("subscriptions/")) return new Response(JSON.stringify(subscriptionStatus === 200 ? subscription : { error: { message: "missing" } }), { status: subscriptionStatus, headers: { "content-type": "application/json" } })
    if (url.includes("products/")) return new Response(JSON.stringify(productStatus === 200 ? product : { error: { message: "missing" } }), { status: productStatus, headers: { "content-type": "application/json" } })
    throw new Error(`unexpected url ${url}`)
  }
}

for (const status of ["active", "trialing"]) {
  test(`${status} subscription is active`, async () => {
    const result = await resolveEntitlement("cs_test_123", "team-mate", "sk_test_redacted", stripeFetch({ subscription: { status, current_period_end: 4_102_444_800 } }), 1_000)
    assert.equal(result.active, true)
    assert.equal(result.status, status)
    assert.equal(result.product, "team-mate")
    assert.equal(result.plan, "weekly")
  })
}

for (const status of ["canceled", "past_due", "unpaid", "incomplete", "incomplete_expired"]) {
  test(`${status} subscription is inactive`, async () => {
    const result = await resolveEntitlement("cs_test_123", "team-mate", "sk_test_redacted", stripeFetch({ subscription: { status, current_period_end: 4_102_444_800 } }), 1_000)
    assert.equal(result.active, false)
    assert.equal(result.status, status)
    assert.equal(result.product, "team-mate")
    assert.equal(result.plan, "weekly")
  })
}

test("missing subscription is inactive", async () => {
  const result = await resolveEntitlement("cs_test_123", "team-mate", "sk_test_redacted", stripeFetch({ session: { subscription: null } }))
  assert.deepEqual(result, { active: false, product: "team-mate", plan: null, status: "no_subscription", currentPeriodEnd: null })
})

test("expired period is inactive even if Stripe status says active", async () => {
  const result = await resolveEntitlement("cs_test_123", "team-mate", "sk_test_redacted", stripeFetch({ subscription: { status: "active", current_period_end: 1 } }), 10_000)
  assert.equal(result.active, false)
})

test("default Worker handler does not treat ExecutionContext as fetch implementation", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = stripeFetch({ sessionStatus: 404 })
  try {
    const response = await worker.fetch(
      new Request("https://worker/v1/entitlement?session_id=cs_test_123&product=team-mate"),
      { STRIPE_SECRET_KEY: "credential_value" },
      { waitUntil() {} },
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, "not_found")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("HTTP API rejects malformed session id", async () => {
  const response = await handleRequest(new Request("https://worker/v1/entitlement?session_id=nope&product=team-mate"), { STRIPE_SECRET_KEY: "secret" }, stripeFetch())
  assert.equal(response.status, 400)
})

test("HTTP API is explicit when Stripe secret is not configured", async () => {
  const response = await handleRequest(new Request("https://worker/v1/entitlement?session_id=cs_test_123&product=team-mate"), {}, stripeFetch())
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "stripe_not_configured" })
})

test("Stripe 404 becomes inactive without leaking raw Stripe error", async () => {
  const response = await handleRequest(new Request("https://worker/v1/entitlement?session_id=cs_test_123&product=team-mate"), { STRIPE_SECRET_KEY: "secret" }, stripeFetch({ sessionStatus: 404 }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { active: false, product: "team-mate", plan: null, status: "not_found", currentPeriodEnd: null })
})


test("Stripe auth failures are classified without exposing Stripe details", async () => {
  const fetcher = async () => new Response(JSON.stringify({ error: { message: "sensitive detail" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  })
  const response = await handleRequest(
    new Request("https://stripe.qili2.com/v1/entitlement?session_id=cs_live_probe123&product=team-mate"),
    { STRIPE_SECRET_KEY: "sk_live_redacted" },
    fetcher,
  )
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: "stripe_auth_failed" })
})

test("Stripe permission failures are classified without exposing Stripe details", async () => {
  const fetcher = async () => new Response(JSON.stringify({ error: { message: "sensitive detail" } }), {
    status: 403,
    headers: { "content-type": "application/json" },
  })
  const response = await handleRequest(
    new Request("https://stripe.qili2.com/v1/entitlement?session_id=cs_live_probe123&product=team-mate"),
    { STRIPE_SECRET_KEY: "rk_live_redacted" },
    fetcher,
  )
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: "stripe_forbidden" })
})

test("HTTP API requires a valid product id", async () => {
  const response = await handleRequest(new Request("https://worker/v1/entitlement?session_id=cs_test_123"), { STRIPE_SECRET_KEY: "secret" }, stripeFetch())
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "invalid_product" })
})

test("subscription for another product cannot unlock requested product", async () => {
  const result = await resolveEntitlement("cs_test_123", "family-tutor", "sk_test_redacted", stripeFetch(), 1_000)
  assert.deepEqual(result, { active: false, product: "family-tutor", plan: "weekly", status: "product_mismatch", currentPeriodEnd: null })
})

test("missing product metadata cannot unlock requested product", async () => {
  const result = await resolveEntitlement("cs_test_123", "team-mate", "sk_test_redacted", stripeFetch({ session: { subscription: "sub_123", metadata: {} }, subscription: { status: "active", current_period_end: 4_102_444_800, metadata: {} } }), 1_000)
  assert.deepEqual(result, { active: false, product: "team-mate", plan: null, status: "product_mismatch", currentPeriodEnd: null })
})


test("price metadata can identify a product without checkout/subscription metadata", async () => {
  const fetcher = stripeFetch({
    session: { subscription: "sub_123", metadata: {} },
    subscription: {
      status: "active",
      current_period_end: 4_102_444_800,
      metadata: {},
      items: { data: [{ price: { metadata: { appid: "team-mate", plan: "weekly" }, recurring: { interval: "week" } } }] },
    },
  })
  const result = await resolveEntitlement("cs_live_123", "team-mate", "rk_live_redacted", fetcher, 1_000)
  assert.equal(result.active, true)
  assert.equal(result.product, "team-mate")
  assert.equal(result.plan, "weekly")
})


test("success page creates extension handoff without product coupling", async () => {
  const response = await handleRequest(new Request("https://stripe.qili2.com/success?session_id=cs_live_abc123&purchase=weekly&extension_id=afofndbgnogoaimmgmdeljbnbghlenkn"), {})
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /chrome-extension:\/\/afofndbgnogoaimmgmdeljbnbghlenkn\/setup\.html/)
  assert.match(body, /purchase=weekly/)
})

test("success page rejects an invalid extension id", async () => {
  const response = await handleRequest(new Request("https://stripe.qili2.com/success?session_id=cs_live_abc123&extension_id=bad"), {})
  assert.equal(response.status, 400)
})


test("product metadata can identify a subscription through its Price product id", async () => {
  const fetcher = stripeFetch({
    session: { subscription: "sub_123", metadata: {} },
    subscription: {
      status: "active",
      current_period_end: 4_102_444_800,
      metadata: {},
      items: { data: [{ price: { product: "prod_123", metadata: {}, recurring: { interval: "week" } } }] },
    },
    product: { id: "prod_123", metadata: { appid: "team-mate" } },
  })
  const result = await resolveEntitlement("cs_live_123", "team-mate", "rk_live_redacted", fetcher, 1_000)
  assert.equal(result.active, true)
  assert.equal(result.product, "team-mate")
  assert.equal(result.plan, "week")
})
