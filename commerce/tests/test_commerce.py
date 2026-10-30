import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import commerce


class CommerceTests(unittest.TestCase):
    def candidate(self):
        return {"candidate_id": "sample", "source_url": "https://example.org/item",
                "provider": "cj_manual", "checks": {}}

    def test_drafts_block_checkout(self):
        result = commerce.evaluate(self.candidate())
        self.assertFalse(result.can_offer)
        self.assertFalse(result.can_fulfill)

    def test_url_must_be_https(self):
        item = self.candidate()
        item["source_url"] = "http://example.org/item"
        self.assertIn("valid_https_source", commerce.evaluate(item).reasons)

    def test_promotion_requires_rights(self):
        item = self.candidate()
        item["checks"] = dict.fromkeys(commerce.REQUIRED_TO_PROMOTE, True)
        result = commerce.evaluate(item)
        self.assertTrue(result.can_promote)
        self.assertFalse(result.can_offer)

    def test_supplier_approval_gate(self):
        item = self.candidate()
        item["checks"] = dict.fromkeys(
            commerce.REQUIRED_TO_PROMOTE + commerce.REQUIRED_TO_OFFER, True)
        self.assertIn("cj_order_manual_gate_enabled", commerce.evaluate(item).reasons)

    def test_verified_offer_not_automatically_fulfillable(self):
        item = self.candidate()
        item["checks"] = dict.fromkeys(
            commerce.REQUIRED_TO_PROMOTE + commerce.REQUIRED_TO_OFFER, True)
        item["checks"]["cj_order_manual_gate_enabled"] = True
        result = commerce.evaluate(item)
        self.assertTrue(result.can_offer)
        self.assertFalse(result.can_fulfill)

    def test_complete_policy_can_pass(self):
        item = self.candidate()
        item["checks"] = dict.fromkeys(
            commerce.REQUIRED_TO_PROMOTE + commerce.REQUIRED_TO_OFFER
            + commerce.REQUIRED_TO_FULFILL, True)
        item["checks"]["cj_order_manual_gate_enabled"] = True
        self.assertTrue(commerce.evaluate(item).can_fulfill)

    def test_catalog_stays_readonly(self):
        data = commerce.validate_catalog({"candidates": [self.candidate()]})
        self.assertEqual(data["sellable_count"], 0)


if __name__ == "__main__":
    unittest.main()
