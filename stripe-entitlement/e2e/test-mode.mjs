import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolveEntitlement } from "../src/index.js"

const fixture = JSON.parse(
  await readFile(new URL("../test-mode-fixture.json", import.meta.url), "utf8"),
)

function stripeJson(args) {
  const output = execFileSync("stripe", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return JSON.parse(output)
}

async function stripeCliFetch(rawUrl) {
  const url = new URL(rawUrl)
  const parts = url.pathname.split("/").filter(Boolean)
  const resource = parts.at(-2)
  const id = decodeURIComponent(parts.at(-1) || "")

  let body
  if (resource === "sessions") {
    body = stripeJson(["checkout", "sessions", "retrieve", id])
  } else if (resource === "subscriptions") {
    body = stripeJson(["subscriptions", "retrieve", id])
  } else if (resource === "products") {
    body = stripeJson(["products", "retrieve", id])
  } else {
    throw new Error(`unexpected Stripe resource: ${url.pathname}`)
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const checkout = stripeJson(["checkout", "sessions", "retrieve", fixture.checkoutSessionId])
assert.equal(checkout.livemode, false, "fixture must stay in Stripe Test Mode")
assert.equal(checkout.status, "complete", "fixture Checkout Session must remain complete")
assert.equal(checkout.subscription, fixture.subscriptionId, "fixture subscription changed")

const result = await resolveEntitlement(
  fixture.checkoutSessionId,
  fixture.product,
  "stripe-cli-authenticated-test-mode",
  stripeCliFetch,
)

assert.equal(result.active, true, JSON.stringify(result))
assert.equal(result.product, fixture.product)
assert.ok(fixture.expectedStatuses.includes(result.status), `unexpected status: ${result.status}`)
assert.ok(result.plan === fixture.plan || result.plan === "week", `unexpected plan: ${result.plan}`)
assert.ok(!result.currentPeriodEnd || Date.parse(result.currentPeriodEnd) > Date.now(), `expired: ${result.currentPeriodEnd}`)

console.log(JSON.stringify({
  ok: true,
  mode: "stripe-test",
  checkoutSessionId: fixture.checkoutSessionId,
  subscriptionId: fixture.subscriptionId,
  status: result.status,
  currentPeriodEnd: result.currentPeriodEnd,
}))
