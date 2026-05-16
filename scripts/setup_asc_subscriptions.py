#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import httpx
import jwt

APP_ID = "6770088501"
GROUP_REFERENCE_NAME = "Parking Reminder Timer Pro"

PRODUCTS = [
    {
        "product_id": "parking_reminder_timer_weekly",
        "reference_name": "Parking Reminder Timer Weekly",
        "period": "ONE_WEEK",
        "group_level": 2,
        "name": "Parking Reminder Timer Weekly",
        "price": "4.99",
        "trial": "ONE_WEEK",
        "description": "Timers, alerts, find-car notes, streak cards.",
    },
    {
        "product_id": "parking_reminder_timer_annual",
        "reference_name": "Parking Reminder Timer Annual",
        "period": "ONE_YEAR",
        "group_level": 1,
        "name": "Parking Reminder Timer Annual",
        "price": "19.99",
        "trial": None,
        "description": "Lower yearly price for timers and alerts.",
    },
]


def read_asc_config() -> dict[str, str]:
    text = Path.home().joinpath(".codex/config.toml").read_text()
    config: dict[str, str] = {}
    for key in ("ASC_ISSUER_ID", "ASC_KEY_ID", "ASC_PRIVATE_KEY_PATH"):
        match = re.search(rf'{key}\s*=\s*"([^"]+)"', text)
        if not match:
            raise RuntimeError(f"Missing {key} in ~/.codex/config.toml")
        config[key] = match.group(1)
    return config


def make_token(config: dict[str, str]) -> str:
    private_key = Path(config["ASC_PRIVATE_KEY_PATH"]).read_text()
    now = int(time.time())
    payload = {
        "iss": config["ASC_ISSUER_ID"],
        "iat": now,
        "exp": now + 1200,
        "aud": "appstoreconnect-v1",
    }
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": config["ASC_KEY_ID"]})


class AscClient:
    def __init__(self) -> None:
        config = read_asc_config()
        self.client = httpx.Client(
            base_url="https://api.appstoreconnect.apple.com/v1",
            timeout=45,
            headers={
                "Authorization": f"Bearer {make_token(config)}",
                "Content-Type": "application/json",
            },
        )

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.client.get(path, params=params)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(path, json=body)
        if response.status_code == 409:
            return {"errors": response.json().get("errors", [])}
        if not response.is_success:
            raise RuntimeError(f"POST {path} failed: {response.status_code} {response.text}")
        return response.json()

    def patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.client.patch(path, json=body)
        if not response.is_success:
            raise RuntimeError(f"PATCH {path} failed: {response.status_code} {response.text}")
        return response.json()


def find_group(client: AscClient) -> dict[str, Any] | None:
    groups = client.get(f"apps/{APP_ID}/subscriptionGroups", {"limit": 50}).get("data", [])
    return next((group for group in groups if group["attributes"].get("referenceName") == GROUP_REFERENCE_NAME), None)


def ensure_group(client: AscClient) -> dict[str, Any]:
    group = find_group(client)
    if group:
        return group

    created = client.post(
        "subscriptionGroups",
        {
            "data": {
                "type": "subscriptionGroups",
                "attributes": {"referenceName": GROUP_REFERENCE_NAME},
                "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
            }
        },
    )
    group = created["data"]
    client.post(
        "subscriptionGroupLocalizations",
        {
            "data": {
                "type": "subscriptionGroupLocalizations",
                "attributes": {"locale": "en-US", "name": "Parking Timer Pro"},
                "relationships": {"subscriptionGroup": {"data": {"type": "subscriptionGroups", "id": group["id"]}}},
            }
        },
    )
    return group


def find_subscription(client: AscClient, group_id: str, product_id: str) -> dict[str, Any] | None:
    subs = client.get(f"subscriptionGroups/{group_id}/subscriptions", {"limit": 50}).get("data", [])
    return next((sub for sub in subs if sub["attributes"].get("productId") == product_id), None)


def ensure_subscription(client: AscClient, group_id: str, product: dict[str, Any]) -> dict[str, Any]:
    sub = find_subscription(client, group_id, product["product_id"])
    if sub:
        client.patch(
            f"subscriptions/{sub['id']}",
            {
                "data": {
                    "type": "subscriptions",
                    "id": sub["id"],
                    "attributes": {
                        "name": product["reference_name"],
                        "familySharable": False,
                        "groupLevel": product["group_level"],
                        "reviewNote": "No login is required. The subscription unlocks unlimited parking reminder sessions, smart meter alerts, find-car notes, and ticket-free streak sharing.",
                    },
                }
            },
        )
        return sub

    body = {
        "data": {
            "type": "subscriptions",
            "attributes": {
                "productId": product["product_id"],
                "name": product["reference_name"],
                "familySharable": False,
                "groupLevel": product["group_level"],
                "subscriptionPeriod": product["period"],
                "reviewNote": "No login is required. The subscription unlocks unlimited parking reminder sessions, smart meter alerts, find-car notes, and ticket-free streak sharing.",
            },
            "relationships": {"group": {"data": {"type": "subscriptionGroups", "id": group_id}}},
        }
    }
    created = client.post("subscriptions", body)
    if "data" not in created:
        raise RuntimeError(f"Could not create {product['product_id']}: {json.dumps(created)}")
    return created["data"]


def ensure_localization(client: AscClient, subscription_id: str, product: dict[str, Any]) -> None:
    existing = client.get(f"subscriptions/{subscription_id}/subscriptionLocalizations", {"limit": 50}).get("data", [])
    current = next((item for item in existing if item["attributes"].get("locale") == "en-US"), None)
    if current:
        client.patch(
            f"subscriptionLocalizations/{current['id']}",
            {
                "data": {
                    "type": "subscriptionLocalizations",
                    "id": current["id"],
                    "attributes": {"name": product["name"], "description": product["description"]},
                }
            },
        )
        return
    client.post(
        "subscriptionLocalizations",
        {
            "data": {
                "type": "subscriptionLocalizations",
                "attributes": {
                    "locale": "en-US",
                    "name": product["name"],
                    "description": product["description"],
                },
                "relationships": {"subscription": {"data": {"type": "subscriptions", "id": subscription_id}}},
            }
        },
    )


def ensure_introductory_offer(client: AscClient, subscription_id: str, product: dict[str, Any]) -> None:
    existing = client.get(f"subscriptions/{subscription_id}/introductoryOffers", {"limit": 50}).get("data", [])
    has_week_trial = any(
        item["attributes"].get("offerMode") == "FREE_TRIAL" and item["attributes"].get("duration") == product["trial"]
        for item in existing
    )
    if product["trial"] and not has_week_trial:
        client.post(
            "subscriptionIntroductoryOffers",
            {
                "data": {
                    "type": "subscriptionIntroductoryOffers",
                    "attributes": {
                        "duration": product["trial"],
                        "offerMode": "FREE_TRIAL",
                        "numberOfPeriods": 1,
                    },
                    "relationships": {
                        "subscription": {"data": {"type": "subscriptions", "id": subscription_id}},
                        "territory": {"data": {"type": "territories", "id": "USA"}},
                    },
                }
            },
        )


def ensure_availability(client: AscClient, subscription_id: str) -> None:
    body = {
        "data": {
            "type": "subscriptionAvailabilities",
            "attributes": {"availableInNewTerritories": True},
            "relationships": {
                "availableTerritories": {"data": [{"type": "territories", "id": "USA"}]},
                "subscription": {"data": {"type": "subscriptions", "id": subscription_id}},
            },
        }
    }
    client.post("subscriptionAvailabilities", body)


def price_point_for(client: AscClient, subscription_id: str, target_price: str) -> str | None:
    next_url: str | None = f"subscriptions/{subscription_id}/pricePoints"
    params: dict[str, Any] | None = {"filter[territory]": "USA", "limit": 200}
    while next_url:
        response = client.client.get(next_url, params=params)
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("data", []):
            if item["attributes"].get("customerPrice") == target_price:
                return item["id"]
        next_url = payload.get("links", {}).get("next")
        params = None
    return None


def ensure_price(client: AscClient, subscription_id: str, product: dict[str, Any]) -> None:
    price_point_id = price_point_for(client, subscription_id, product["price"])
    if not price_point_id:
        raise RuntimeError(f"Could not find USA price point {product['price']} for {product['product_id']}")
    body = {
        "data": {
            "type": "subscriptionPrices",
            "attributes": {"preserveCurrentPrice": False},
            "relationships": {
                "subscription": {"data": {"type": "subscriptions", "id": subscription_id}},
                "subscriptionPricePoint": {"data": {"type": "subscriptionPricePoints", "id": price_point_id}},
            },
        }
    }
    client.post("subscriptionPrices", body)


def main() -> None:
    client = AscClient()
    group = ensure_group(client)
    print(f"subscription_group={group['id']}")
    for product in PRODUCTS:
        sub = ensure_subscription(client, group["id"], product)
        ensure_localization(client, sub["id"], product)
        ensure_availability(client, sub["id"])
        ensure_price(client, sub["id"], product)
        ensure_introductory_offer(client, sub["id"], product)
        print(f"{product['product_id']}={sub['id']}")


if __name__ == "__main__":
    main()
