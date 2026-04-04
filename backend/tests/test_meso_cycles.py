"""
Tests for /api/meso-cycles — CRUD and micro-cycle management.
"""
import pytest
from httpx import AsyncClient


# ── Meso Cycles ───────────────────────────────────────────────────────────────

async def test_create_cycle_requires_auth(client: AsyncClient):
    r = await client.post(
        "/api/meso-cycles",
        json={"name": "Block 1", "goal": "hypertrophy"},
    )
    assert r.status_code == 401


async def test_create_cycle_success(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/meso-cycles",
        json={
            "name": "Strength Block",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "goal": "strength",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Strength Block"
    assert body["goal"] == "strength"
    assert body["is_active"] is True


async def test_create_cycle_minimal(auth_client: AsyncClient):
    """Only name is required."""
    r = await auth_client.post("/api/meso-cycles", json={"name": "Minimal"})
    assert r.status_code == 200


async def test_list_cycles_user_isolation(
    auth_client: AsyncClient, second_auth_client: AsyncClient
):
    await auth_client.post("/api/meso-cycles", json={"name": "My Cycle"})
    r = await second_auth_client.get("/api/meso-cycles")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_cycles_returns_all_for_user(auth_client: AsyncClient):
    for i in range(3):
        await auth_client.post("/api/meso-cycles", json={"name": f"Cycle {i}"})
    r = await auth_client.get("/api/meso-cycles")
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_get_cycle(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.get(f"/api/meso-cycles/{cycle['id']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Hypertrophy Block"


async def test_get_cycle_not_found(client: AsyncClient):
    r = await client.get("/api/meso-cycles/nonexistent")
    assert r.status_code == 404


async def test_update_cycle(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.put(
        f"/api/meso-cycles/{cycle['id']}",
        json={"name": "Renamed Block", "goal": "endurance", "is_active": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed Block"
    assert body["goal"] == "endurance"
    assert body["is_active"] is False


async def test_update_cycle_not_found(auth_client: AsyncClient):
    r = await auth_client.put("/api/meso-cycles/ghost", json={"name": "X"})
    assert r.status_code == 404


async def test_delete_cycle(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.delete(f"/api/meso-cycles/{cycle['id']}")
    assert r.status_code == 200
    r2 = await auth_client.get(f"/api/meso-cycles/{cycle['id']}")
    assert r2.status_code == 404


async def test_delete_cycle_not_found(auth_client: AsyncClient):
    r = await auth_client.delete("/api/meso-cycles/ghost")
    assert r.status_code == 404


# ── Micro Cycles ──────────────────────────────────────────────────────────────

async def test_create_micro_cycle(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.post(
        f"/api/meso-cycles/{cycle['id']}/micro-cycles",
        json={
            "week_number": 1,
            "focus": "normal",
            "start_date": "2026-01-01",
            "end_date": "2026-01-07",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["week_number"] == 1
    assert body["focus"] == "normal"
    assert body["meso_cycle_id"] == cycle["id"]


async def test_list_micro_cycles(auth_client: AsyncClient, cycle: dict):
    for i in range(1, 4):
        await auth_client.post(
            f"/api/meso-cycles/{cycle['id']}/micro-cycles",
            json={"week_number": i, "focus": "normal"},
        )
    r = await auth_client.get(f"/api/meso-cycles/{cycle['id']}/micro-cycles")
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_delete_cycle_cascades_to_micro_cycles(
    auth_client: AsyncClient, cycle: dict
):
    """Deleting a meso cycle should also delete its micro cycles."""
    # Create 2 micro cycles
    await auth_client.post(
        f"/api/meso-cycles/{cycle['id']}/micro-cycles",
        json={"week_number": 1, "focus": "normal"},
    )
    await auth_client.post(
        f"/api/meso-cycles/{cycle['id']}/micro-cycles",
        json={"week_number": 2, "focus": "deload"},
    )

    await auth_client.delete(f"/api/meso-cycles/{cycle['id']}")

    # Trying to list micro cycles for deleted parent still returns 200 (empty)
    r = await auth_client.get(f"/api/meso-cycles/{cycle['id']}/micro-cycles")
    # The route doesn't validate parent existence, so returns []
    assert r.status_code == 200
    assert r.json() == []


async def test_micro_cycle_all_focus_types(auth_client: AsyncClient, cycle: dict):
    """All documented focus types should be accepted."""
    for focus in ["normal", "deload", "peak", "intensification", "accumulation"]:
        r = await auth_client.post(
            f"/api/meso-cycles/{cycle['id']}/micro-cycles",
            json={"week_number": 1, "focus": focus},
        )
        assert r.status_code == 200


async def test_micro_cycle_missing_week_number(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.post(
        f"/api/meso-cycles/{cycle['id']}/micro-cycles",
        json={"focus": "normal"},
    )
    assert r.status_code == 422
