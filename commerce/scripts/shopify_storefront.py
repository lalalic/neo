"""Shopify storefront bridge: live merchandise lookup and explicit cart handoff.

Private Storefront token is supplied by deployment; never embed it in iOS.
A cart URL is not a completed purchase. No payment or order action here.
"""
from __future__ import annotations

import json
import re
import urllib.request
from urllib.parse import urlparse


class StorefrontError(ValueError):
    pass


class ShopifyStorefront:
    def __init__(self, store_domain: str, access_token: str,
                 transport=None, approval_verifier=None):
        host = store_domain.lower().strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com", host):
            raise StorefrontError("Expected a verified .myshopify.com domain")
        if not access_token or len(access_token) < 10:
            raise StorefrontError("Private Storefront access token required")
        self.endpoint = f"https://{host}/api/2026-10/graphql.json"
        self.token = access_token
        self.transport = transport
        self.approval_verifier = approval_verifier

    def _query(self, query: str, variables: dict) -> dict:
        payload = json.dumps({"query": query, "variables": variables}).encode()
        if self.transport:
            response = self.transport(self.endpoint, payload)
        else:
            req = urllib.request.Request(self.endpoint, data=payload, method="POST",
                                         headers={"Content-Type": "application/json",
                                                  "X-Shopify-Storefront-Access-Token": self.token})
            with urllib.request.urlopen(req, timeout=12) as handle:
                response = json.load(handle)
        if response.get("errors"):
            raise StorefrontError("Shopify API returned GraphQL errors")
        return response.get("data") or {}

    def product(self, handle: str) -> dict:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,120}", handle):
            raise StorefrontError("Invalid product handle")
        query = """query($handle:String!){
          product(handle:$handle){
            id title availableForSale
            variants(first:30){nodes{
              id availableForSale title
              price{amount currencyCode}
            }}
          }
        }"""
        product = self._query(query, {"handle": handle}).get("product")
        if not product:
            raise StorefrontError("Product is not published to this Storefront")
        return product

    def cart_checkout_url(self, variant_id: str, sale_gate: dict,
                          explicit_buyer_intent: bool) -> str:
        """Builds a cart only after operator policies and a real buyer tap.

        This method never collects customer data or submits a payment.
        """
        from commerce import evaluate

        if not explicit_buyer_intent:
            raise StorefrontError("Buyer explicitly choosing Checkout is required")
        if not self.approval_verifier or not self.approval_verifier(sale_gate):
            raise StorefrontError("Trusted server approval required")
        if not evaluate(sale_gate).can_offer:
            raise StorefrontError("Sale readiness gate is blocked")
        handle = sale_gate.get("shopify_handle")
        if not isinstance(handle, str):
            raise StorefrontError("Live Shopify product handle required")
        listing = self.product(handle)
        if not listing.get("availableForSale") or not any(
            variant.get("id") == variant_id and variant.get("availableForSale") is True
            for variant in (listing.get("variants") or {}).get("nodes", [])
        ):
            raise StorefrontError("This live product variant is unavailable")
        if not re.fullmatch(r"gid://shopify/ProductVariant/[0-9]+", variant_id):
            raise StorefrontError("Invalid Shopify variant ID")
        query = """mutation($input:CartInput!){
          cartCreate(input:$input){
            cart{checkoutUrl}
            userErrors{field message}
          }
        }"""
        response = self._query(query, {"input": {
            "lines": [{"merchandiseId": variant_id, "quantity": 1}]
        }}).get("cartCreate") or {}
        if response.get("userErrors"):
            raise StorefrontError("Shopify refused to create the cart")
        target = (response.get("cart") or {}).get("checkoutUrl", "")
        parsed = urlparse(target)
        if parsed.scheme != "https" or not parsed.hostname:
            raise StorefrontError("Shopify returned an invalid checkout URL")
        return target
