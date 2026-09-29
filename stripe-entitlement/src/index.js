const ACTIVE_STATUSES = new Set(["active", "trialing"])
const SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9_-]+$/

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  })
}

async function stripeGet(path, secret, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Stripe request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

export async function resolveEntitlement(sessionId, secret, fetchImpl = fetch, now = Date.now()) {
  const session = await stripeGet(`checkout/sessions/${encodeURIComponent(sessionId)}`, secret, fetchImpl)
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  if (!subscriptionId) return { active: false, status: "no_subscription", currentPeriodEnd: null }

  const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`, secret, fetchImpl)
  const status = String(subscription.status || "unknown")
  const period = Number(subscription.current_period_end)
  const currentPeriodEnd = Number.isFinite(period) && period > 0 ? new Date(period * 1000).toISOString() : null
  const active = ACTIVE_STATUSES.has(status) && (!currentPeriodEnd || Date.parse(currentPeriodEnd) > now)
  return { active, status, currentPeriodEnd }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url)
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } })
  }
  if (url.pathname === "/health") return json({ ok: true, configured: Boolean(env.STRIPE_SECRET_KEY) })
  if (request.method !== "GET" || url.pathname !== "/v1/entitlement") return json({ error: "not_found" }, 404)

  const sessionId = String(url.searchParams.get("session_id") || "").trim()
  if (!SESSION_RE.test(sessionId)) return json({ error: "invalid_session_id" }, 400)
  if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503)

  try {
    return json(await resolveEntitlement(sessionId, env.STRIPE_SECRET_KEY, fetchImpl))
  } catch (error) {
    if (error?.status === 404) return json({ active: false, status: "not_found", currentPeriodEnd: null })
    return json({ error: "stripe_unavailable" }, 502)
  }
}

export default { fetch: handleRequest }
