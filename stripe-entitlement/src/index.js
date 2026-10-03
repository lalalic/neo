const ACTIVE_STATUSES = new Set(["active", "trialing"])
const SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9_-]+$/
const PRODUCT_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

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


function html(body, status = 200) {
  return new Response(body, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  } })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))
}

function successPage(url) {
  const sessionId = String(url.searchParams.get("session_id") || "").trim()
  const extensionId = String(url.searchParams.get("extension_id") || "").trim()
  const purchase = url.searchParams.get("purchase") === "weekly" ? "weekly" : "one_time"
  const valid = SESSION_RE.test(sessionId) && /^[a-p]{32}$/.test(extensionId)
  const href = valid
    ? `chrome-extension://${extensionId}/setup.html?session_id=${encodeURIComponent(sessionId)}&purchase=${encodeURIComponent(purchase)}`
    : ""
  return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment complete</title><main style="font:16px system-ui;max-width:560px;margin:64px auto;padding:24px"><h1>${valid ? "Payment complete" : "Activation link unavailable"}</h1><p>${valid ? "Return to the extension to activate Premium." : "The Stripe session or extension identifier is missing or invalid."}</p>${valid ? `<p><a href="${escapeHtml(href)}">Return to extension</a></p>` : ""}</main>`, valid ? 200 : 400)
}
async function stripeGet(path, secret, fetchImpl = fetch) {
  const normalizedSecret = String(secret || "").trim()
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${normalizedSecret}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Stripe request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

export async function resolveEntitlement(sessionId, requestedProduct, secret, fetchImpl = fetch, now = Date.now()) {
  const session = await stripeGet(`checkout/sessions/${encodeURIComponent(sessionId)}`, secret, fetchImpl)
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  if (!subscriptionId) return { active: false, product: requestedProduct, plan: null, status: "no_subscription", currentPeriodEnd: null }

  const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`, secret, fetchImpl)
  const price = subscription?.items?.data?.[0]?.price
  const priceMetadata = price?.metadata || {}
  let product = String(
    subscription?.metadata?.product ||
    session?.metadata?.product ||
    priceMetadata.product ||
    priceMetadata.appid ||
    ""
  ).trim()
  const plan = String(
    subscription?.metadata?.plan ||
    session?.metadata?.plan ||
    priceMetadata.plan ||
    price?.recurring?.interval ||
    ""
  ).trim() || null

  if (!product) {
    const productId = typeof price?.product === "string" ? price.product : price?.product?.id
    if (productId) {
      try {
        const stripeProduct = await stripeGet(`products/${encodeURIComponent(productId)}`, secret, fetchImpl)
        product = String(stripeProduct?.metadata?.product || stripeProduct?.metadata?.appid || "").trim()
      } catch {
        product = ""
      }
    }
  }

  if (!product || product !== requestedProduct) {
    return { active: false, product: requestedProduct, plan, status: "product_mismatch", currentPeriodEnd: null }
  }

  const status = String(subscription.status || "unknown")
  const period = Number(subscription.current_period_end)
  const currentPeriodEnd = Number.isFinite(period) && period > 0 ? new Date(period * 1000).toISOString() : null
  const active = ACTIVE_STATUSES.has(status) && (!currentPeriodEnd || Date.parse(currentPeriodEnd) > now)
  return { active, product: requestedProduct, plan, status, currentPeriodEnd }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url)
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } })
  }
  if (url.pathname === "/health") return json({ ok: true, configured: Boolean(env.STRIPE_SECRET_KEY) })
  if (request.method === "GET" && url.pathname === "/success") return successPage(url)
  if (request.method !== "GET" || url.pathname !== "/v1/entitlement") return json({ error: "not_found" }, 404)

  const sessionId = String(url.searchParams.get("session_id") || "").trim()
  const product = String(url.searchParams.get("product") || "").trim().toLowerCase()
  if (!SESSION_RE.test(sessionId)) return json({ error: "invalid_session_id" }, 400)
  if (!PRODUCT_RE.test(product)) return json({ error: "invalid_product" }, 400)
  if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503)

  try {
    return json(await resolveEntitlement(sessionId, product, env.STRIPE_SECRET_KEY, fetchImpl))
  } catch (error) {
    if (error?.status === 404) return json({ active: false, product, plan: null, status: "not_found", currentPeriodEnd: null })
    if (error?.status === 401) return json({ error: "stripe_auth_failed" }, 502)
    if (error?.status === 403) return json({ error: "stripe_forbidden" }, 502)
    return json({ error: "stripe_unavailable" }, 502)
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
}
