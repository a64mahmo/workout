"""
Tests for /api/meso-cycles  (CRUD + micro-cycles)

Coverage:
  - GET    /api/meso-cycles              — list, scoped to user
  - GET    /api/meso-cycles/{id}         — found, not found
  - POST   /api/meso-cycles              — success, requires auth
  - PUT    /api/meso-cycles/{id}         — full update, partial update, not found
  - DELETE /api/meso-cycles/{id}         — success, not found
  - GET    /api/meso-cycles/{id}/micro-cycles   — list micro-cycles
  - POST   /api/meso-cycles/{id}/micro-cycles   — create micro-cycle
"""

import uuid
import pytest
import pytest_asyncio

from app.models.models import User, MesoCycle, MicroCycle


# ── list ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_cycles_empty(client, auth_headers):
    resp = await client.get("/api/meso-cycles", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_cycles_returns_own_cycles(client, test_cycle, auth_headers):
    resp = await client.get("/api/meso-cycles", headers=auth_headers)
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert test_cycle.id in ids


@pytest.mark.asyncio
async def test_list_cycles_excludes_other_users(client, db_session, test_user, auth_headers):
    other = User(
        id=str(uuid.uuid4()), email="other2@example.com",
        name="Other", hashed_password="x",
    )
    db_session.add(other)
    cycle = MesoCycle(
        id=str(uuid.uuid4()), user_id=other.id, name="Other Cycle", is_active=True,
    )
    db_session.add(cycle)
    await db_session.commit()

    resp = await client.get("/api/meso-cycles", headers=auth_headers)
    ids = [c["id"] for c in resp.json()]
    assert cycle.id not in ids


@pytest.mark.asyncio
async def test_list_cycles_requires_auth(client):
    resp = await client.get("/api/meso-cycles")
    assert resp.status_code == 401


# ── get one ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_cycle_found(client, test_cycle):
    resp = await client.get(f"/api/meso-cycles/{test_cycle.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == test_cycle.id
    assert data["name"] == test_cycle.name


@pytest.mark.asyncio
async def test_get_cycle_not_found(client):
    resp = await client.get(f"/api/meso-cycles/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


# ── create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_cycle_requires_auth(client):
    resp = await client.post("/api/meso-cycles", json={"name": "Block 1"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_cycle_success(client, auth_headers, test_user):
    payload = {
        "name": "Hypertrophy Block",
        "start_date": "2026-01-01",
        "end_date": "2026-04-01",
        "goal": "Muscle gain",
        "is_active": True,
    }
    resp = await client.post("/api/meso-cycles", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Hypertrophy Block"
    assert data["user_id"] == test_user.id
    assert data["goal"] == "Muscle gain"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_create_cycle_minimal(client, auth_headers):
    resp = await client.post("/api/meso-cycles", json={"name": "Minimal"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Minimal"


# ── update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_cycle_name(client, test_cycle):
    resp = await client.put(
        f"/api/meso-cycles/{test_cycle.id}",
        json={"name": "Strength Block"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Strength Block"


@pytest.mark.asyncio
async def test_update_cycle_deactivate(client, test_cycle):
    resp = await client.put(
        f"/api/meso-cycles/{test_cycle.id}",
        json={"is_active": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_update_cycle_not_found(client):
    resp = await client.put(f"/api/meso-cycles/{uuid.uuid4()}", json={"name": "Ghost"})
    assert resp.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_cycle_success(client, test_cycle):
    resp = await client.delete(f"/api/meso-cycles/{test_cycle.id}")
    assert resp.status_code == 200
    assert "deleted" in resp.json()["message"].lower()

    resp2 = await client.get(f"/api/meso-cycles/{test_cycle.id}")
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_cycle_not_found(client):
    resp = await client.delete(f"/api/meso-cycles/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── micro-cycles ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_micro_cycles_empty(client, test_cycle):
    resp = await client.get(f"/api/meso-cycles/{test_cycle.id}/micro-cycles")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_micro_cycle_success(client, test_cycle):
    payload = {
        "week_number": 1,
        "focus": "Accumulation",
        "start_date": "2026-01-01",
        "end_date": "2026-01-07",
    }
    resp = await client.post(
        f"/api/meso-cycles/{test_cycle.id}/micro-cycles",
        json=payload,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["week_number"] == 1
    assert data["focus"] == "Accumulation"
    assert data["meso_cycle_id"] == test_cycle.id


@pytest.mark.asyncio
async def test_list_micro_cycles_after_create(client, test_cycle):
    await client.post(
        f"/api/meso-cycles/{test_cycle.id}/micro-cycles",
        json={"week_number": 1},
    )
    await client.post(
        f"/api/meso-cycles/{test_cycle.id}/micro-cycles",
        json={"week_number": 2},
    )

    resp = await client.get(f"/api/meso-cycles/{test_cycle.id}/micro-cycles")
    assert resp.status_code == 200
    weeks = [m["week_number"] for m in resp.json()]
    assert 1 in weeks
    assert 2 in weeks
