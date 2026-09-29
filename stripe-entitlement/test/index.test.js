import test from "node:test"
import assert from "node:assert/strict"
import { handleRequest, resolveEntitlement } from "../src/index.js"

function stripeFetch({ session = { subscription: "sub_123", metadata: { product: "team-mate", plan: "weekly" } }, subscription = { status: "active", current_period_end: 4_102_444_800, metadata: { product: "team-mate", plan: "weekly" } }, sessionStatus = 200, subscriptionStatus = 200 } = {}) {
  return async (url) => {
    if (url.includes("checkout/sessions/")) return new Response(JSON.stringify(sessionStatus === 200 ? session : { error: { message: "missing" } }), { status: sessionStatus, headers: { "content-type": "application/json" } })
    if (url.includes("subscriptions/")) return new Response(JSON.stringify(subscriptionStatus === 200 ? subscription : { error: { message: "missing" } }), { status: subscriptionStatus, headers: { "content-type": "application/json" } })
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
