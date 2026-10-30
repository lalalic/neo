import sys
import json
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from shopify_storefront import ShopifyStorefront, StorefrontError
import commerce


def permitted():
    item = {"candidate_id": "safe", "provider": "cj_manual",
            "source_url": "https://example.com/item",
            "checks": dict.fromkeys(
                commerce.REQUIRED_TO_PROMOTE + commerce.REQUIRED_TO_OFFER, True)}
    item["checks"]["cj_order_manual_gate_enabled"] = True
    item["shopify_handle"] = "journal"
    return item


class ShopifyStorefrontTests(unittest.TestCase):
    def make_client(self, payload):
        return ShopifyStorefront("safe-store.myshopify.com", "token-example-test",
                                transport=lambda _url, _body: payload,
                                approval_verifier=lambda _offer: True)

    def test_only_verified_shop_domains(self):
        with self.assertRaises(StorefrontError):
            ShopifyStorefront("localhost", "test-access-token")

    def test_drafts_have_no_live_product(self):
        client = self.make_client({"data": {"product": None}})
        with self.assertRaisesRegex(StorefrontError, "not published"):
            client.product("private-draft")

    def test_product_returns_real_provider_data(self):
        item = {"id": "gid://shopify/Product/1", "title": "Journal",
                "availableForSale": True,
                "variants": {"nodes": [{"id": "gid://shopify/ProductVariant/1",
                                        "availableForSale": True,
                                        "price": {"amount": "29.00", "currencyCode": "CAD"}}]}}
        self.assertEqual(self.make_client({"data": {"product": item}}).product("journal"), item)

    def test_checkout_rejected_when_provider_variant_unavailable(self):
        client = self.make_client({"data": {"product": {"availableForSale": False,
            "variants": {"nodes": []}}}})
        with self.assertRaisesRegex(StorefrontError, "unavailable"):
            client.cart_checkout_url("gid://shopify/ProductVariant/1", permitted(), True)

    def test_missing_trusted_approval_fails_closed(self):
        client = ShopifyStorefront("safe-store.myshopify.com", "token-example-test",
                                  transport=lambda _url, _body: {"data": {}})
        with self.assertRaisesRegex(StorefrontError, "Trusted server approval"):
            client.cart_checkout_url("gid://shopify/ProductVariant/1", permitted(), True)

    def test_cart_requires_buyer_tap(self):
        client = self.make_client({"data": {"cartCreate": {"cart": {"checkoutUrl":
            "https://safe-store.myshopify.com/checkouts/test"}, "userErrors": []}}})
        with self.assertRaisesRegex(StorefrontError, "explicitly"):
            client.cart_checkout_url("gid://shopify/ProductVariant/1", permitted(), False)

    def test_incomplete_seller_gate_rejects_cart(self):
        client = self.make_client({"data": {}})
        with self.assertRaisesRegex(StorefrontError, "blocked"):
            client.cart_checkout_url("gid://shopify/ProductVariant/1",
                                     {"candidate_id": "draft", "provider": "cj_manual"}, True)

    def test_approved_cart_is_checkout_url_only(self):
        def live_api(_endpoint, body):
            query = json.loads(body)["query"]
            if "mutation" in query:
                return {"data": {"cartCreate": {"cart": {"checkoutUrl":
                    "https://safe-store.myshopify.com/checkouts/abc"}, "userErrors": []}}}
            return {"data": {"product": {"availableForSale": True, "variants": {
                "nodes": [{"id": "gid://shopify/ProductVariant/123",
                           "availableForSale": True}]}}}}
        client = ShopifyStorefront(
            "safe-store.myshopify.com", "token-example-test",
            transport=live_api, approval_verifier=lambda _offer: True)
        self.assertEqual(client.cart_checkout_url(
            "gid://shopify/ProductVariant/123", permitted(), True),
            "https://safe-store.myshopify.com/checkouts/abc")


if __name__ == "__main__":
    unittest.main()
