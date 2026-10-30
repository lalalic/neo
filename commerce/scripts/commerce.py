#!/usr/bin/env python3
"""Neo Commerce: read-only policy gate used by Treasure product imports.

No payment or publication functions are implemented in this module.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

REQUIRED_TO_PROMOTE = (
    "product_identified", "image_advertising_rights",
    "challenge_rules_reviewed", "venue_permission_verified",
)
REQUIRED_TO_OFFER = (
    "shopify_product_published", "live_sellable_variant", "seller_authorized",
    "supplier_fulfillment_confirmed", "landed_cost_verified",
    "canadian_tax_quoted", "refund_returns_verified", "shopify_payments_active",
    "store_checkout_unlocked", "owner_approved_public_offer",
)
REQUIRED_TO_FULFILL = (
    "order_paid_by_customer", "ship_to_postcode_supported",
    "stock_reservation_confirmed", "owner_approved_fulfillment",
)
VALID_PROVIDERS = {"shopify_collective", "cj_manual", "seller_owned"}
TRUSTED_STORE_DOMAIN_SUFFIX = ".myshopify.com"


@dataclass(frozen=True)
class CommerceDecision:
    candidate_id: str
    can_promote: bool
    can_offer: bool
    can_fulfill: bool
    reasons: tuple[str, ...]
    provider: str

    def as_json(self) -> dict:
        return dict(candidate_id=self.candidate_id,
                    can_promote=self.can_promote, can_offer=self.can_offer,
                    can_fulfill=self.can_fulfill, provider=self.provider,
                    missing=list(self.reasons))


def evaluate(candidate: dict) -> CommerceDecision:
    url = str(candidate.get("source_url") or "")
    parsed = urlparse(url)
    valid_source = (
        parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username
        and not parsed.password and parsed.hostname not in {"localhost", "127.0.0.1"}
        and len(url) <= 4096
    )
    provider = candidate.get("provider") or "unknown"
    flags = candidate.get("checks") or {}
    if not isinstance(flags, dict):
        flags = {}
    missing: list[str] = []
    if not valid_source:
        missing.append("valid_https_source")
    if provider not in VALID_PROVIDERS:
        missing.append("verified_supplier_provider")
    for key in REQUIRED_TO_PROMOTE + REQUIRED_TO_OFFER + REQUIRED_TO_FULFILL:
        if flags.get(key) is not True:
            missing.append(key)
    promotional_ok = valid_source and all(flags.get(k) is True for k in REQUIRED_TO_PROMOTE)
    offer_ok = promotional_ok and provider in VALID_PROVIDERS and all(
        flags.get(k) is True for k in REQUIRED_TO_OFFER
    )
    fulfill_ok = offer_ok and all(flags.get(k) is True for k in REQUIRED_TO_FULFILL)
    if provider == "shopify_collective" and flags.get("collective_supplier_connected") is not True:
        missing.append("collective_supplier_connected")
        offer_ok = fulfill_ok = False
    if provider == "cj_manual" and flags.get("cj_order_manual_gate_enabled") is not True:
        missing.append("cj_order_manual_gate_enabled")
        offer_ok = fulfill_ok = False
    return CommerceDecision(
        candidate_id=str(candidate.get("candidate_id") or "unidentified"),
        can_promote=promotional_ok,
        can_offer=offer_ok,
        can_fulfill=fulfill_ok,
        reasons=tuple(dict.fromkeys(missing)),
        provider=str(provider),
    )


def validate_catalog(document: dict) -> dict:
    candidates = document.get("candidates", [])
    if not isinstance(candidates, list):
        raise ValueError("candidates must be a list")
    evaluated = [evaluate(c).as_json() for c in candidates]
    return {"mode": "read_only_no_checkout_no_payment", "candidates": evaluated,
            "sellable_count": sum(c["can_offer"] for c in evaluated),
            "fulfillable_count": sum(c["can_fulfill"] for c in evaluated)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("validate",))
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    raw = json.loads(args.input.read_text())
    print(json.dumps(validate_catalog(raw), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
