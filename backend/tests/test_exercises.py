"""
Tests for /api/exercises — CRUD and per-user exercise history.
"""
import pytest
from httpx import AsyncClient


# ── List / Get ────────────────────────────────────────────────────────────────

async def test_list_exercises_empty(client: AsyncClient):
    r = await client.get("/api/exercises")
    assert r.status_code == 200
    assert r.json() == []


async def test_list_exercises_returns_all(auth_client: AsyncClient):
    for mg in ["chest", "back", "legs"]:
        await auth_client.post(
            "/api/exercises",
            json={"name": f"{mg} exercise", "muscle_group": mg, "category": "weighted"},
        )
    r = await auth_client.get("/api/exercises")
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_list_exercises_filter_by_muscle_group(auth_client: AsyncClient):
    await auth_client.post(
        "/api/exercises",
        json={"name": "Squat", "muscle_group": "legs", "category": "weighted"},
    )
    await auth_client.post(
        "/api/exercises",
        json={"name": "Bench", "muscle_group": "chest", "category": "weighted"},
    )
    r = await auth_client.get("/api/exercises?muscle_group=legs")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["muscle_group"] == "legs"


async def test_get_exercise_by_id(auth_client: AsyncClient, exercise: dict):
    r = await auth_client.get(f"/api/exercises/{exercise['id']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Bench Press"


async def test_get_exercise_not_found(client: AsyncClient):
    r = await client.get("/api/exercises/nonexistent-id-123")
    assert r.status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

async def test_create_exercise_requires_auth(client: AsyncClient):
    r = await client.post(
        "/api/exercises",
        json={"name": "Squat", "muscle_group": "legs", "category": "weighted"},
    )
    assert r.status_code == 401


async def test_create_exercise_success(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={
            "name": "Overhead Press",
            "muscle_group": "shoulders",
            "category": "weighted",
            "description": "Standing barbell press",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Overhead Press"
    assert body["muscle_group"] == "shoulders"
    assert body["category"] == "weighted"
    assert body["description"] == "Standing barbell press"
    assert "id" in body


async def test_create_bodyweight_exercise(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={"name": "Dip", "muscle_group": "chest", "category": "bodyweight"},
    )
    assert r.status_code == 200
    assert r.json()["category"] == "bodyweight"


async def test_create_exercise_defaults_to_weighted(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={"name": "Cable Fly", "muscle_group": "chest"},
    )
    assert r.status_code == 200
    assert r.json()["category"] == "weighted"


async def test_create_exercise_missing_name(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={"muscle_group": "chest", "category": "weighted"},
    )
    assert r.status_code == 422


# ── Update ────────────────────────────────────────────────────────────────────

async def test_update_exercise_name(auth_client: AsyncClient, exercise: dict):
    r = await auth_client.put(
        f"/api/exercises/{exercise['id']}",
        json={"name": "Barbell Bench Press"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Barbell Bench Press"
    assert r.json()["muscle_group"] == "chest"  # unchanged


async def test_update_exercise_not_found(auth_client: AsyncClient):
    r = await auth_client.put(
        "/api/exercises/doesnotexist",
        json={"name": "Updated Name"},
    )
    assert r.status_code == 404


async def test_update_exercise_partial(auth_client: AsyncClient, exercise: dict):
    r = await auth_client.put(
        f"/api/exercises/{exercise['id']}",
        json={"description": "Updated description"},
    )
    assert r.status_code == 200
    assert r.json()["description"] == "Updated description"
    assert r.json()["name"] == "Bench Press"  # untouched


# ── Delete ────────────────────────────────────────────────────────────────────

async def test_delete_exercise(auth_client: AsyncClient, exercise: dict):
    r = await auth_client.delete(f"/api/exercises/{exercise['id']}")
    assert r.status_code == 200
    assert r.json()["message"] == "Exercise deleted"
    # Confirm gone
    r2 = await auth_client.get(f"/api/exercises/{exercise['id']}")
    assert r2.status_code == 404


async def test_delete_exercise_not_found(auth_client: AsyncClient):
    r = await auth_client.delete("/api/exercises/ghost-id")
    assert r.status_code == 404


# ── History ───────────────────────────────────────────────────────────────────

async def test_exercise_history_requires_auth(client: AsyncClient, exercise: dict):
    r = await client.get(f"/api/exercises/{exercise['id']}/history")
    assert r.status_code == 401


async def test_exercise_history_empty(auth_client: AsyncClient, exercise: dict):
    """No completed sessions → empty history."""
    r = await auth_client.get(f"/api/exercises/{exercise['id']}/history")
    assert r.status_code == 200
    assert r.json() == []


async def test_exercise_history_returns_completed_sessions(
    auth_client: AsyncClient, session_with_sets: dict
):
    """After completing a session, history should reflect that session."""
    session = session_with_sets["session"]
    exercise = session_with_sets["exercise"]
    sid = session["id"]

    # Complete the session
    r = await auth_client.post(f"/api/sessions/{sid}/complete")
    assert r.status_code == 200

    r = await auth_client.get(f"/api/exercises/{exercise['id']}/history")
    assert r.status_code == 200
    history = r.json()
    assert len(history) == 1
    entry = history[0]
    assert entry["session_name"] == "Push Day"
    assert len(entry["sets"]) == 3
    # Warmup sets should not be included (none were warmup here)
    # Total volume = 10*100 + 10*105 + 8*110 = 1000 + 1050 + 880 = 2930
    assert entry["total_volume"] == pytest.approx(2930.0)


async def test_exercise_history_excludes_warmup_sets(
    auth_client: AsyncClient, started_session: dict, exercise: dict
):
    """Warmup sets must be excluded from history volume."""
    sid = started_session["id"]
    r = await auth_client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    se_id = r.json()["id"]

    # Warmup set
    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 1, "reps": 10, "weight": 60.0, "is_warmup": True},
    )
    warmup_id = r.json()["id"]
    await auth_client.put(
        f"/api/sessions/exercise-sets/{warmup_id}", json={"is_completed": True}
    )

    # Working set
    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 2, "reps": 8, "weight": 100.0, "is_warmup": False},
    )
    work_id = r.json()["id"]
    await auth_client.put(
        f"/api/sessions/exercise-sets/{work_id}", json={"is_completed": True}
    )

    await auth_client.post(f"/api/sessions/{sid}/complete")

    r = await auth_client.get(f"/api/exercises/{exercise['id']}/history")
    history = r.json()
    assert len(history) == 1
    # Only the working set (8 * 100 = 800) should be in volume
    assert history[0]["total_volume"] == pytest.approx(800.0)
    assert len(history[0]["sets"]) == 1  # Only non-warmup sets


async def test_exercise_history_user_isolation(
    auth_client: AsyncClient,
    second_auth_client: AsyncClient,
    session_with_sets: dict,
):
    """Another user cannot see user1's exercise history."""
    session = session_with_sets["session"]
    exercise = session_with_sets["exercise"]
    sid = session["id"]
    await auth_client.post(f"/api/sessions/{sid}/complete")

    # Second user has no sessions for this exercise
    r = await second_auth_client.get(f"/api/exercises/{exercise['id']}/history")
    assert r.status_code == 200
    assert r.json() == []


async def test_exercise_history_limit(auth_client: AsyncClient, exercise: dict, cycle: dict):
    """limit query param should cap the number of sessions returned."""
    # Create and complete 3 sessions with this exercise
    for i in range(3):
        sr = await auth_client.post(
            "/api/sessions",
            json={
                "name": f"Session {i}",
                "meso_cycle_id": cycle["id"],
                "scheduled_date": f"2026-04-0{i+1}",
            },
        )
        sid = sr.json()["id"]
        await auth_client.post(f"/api/sessions/{sid}/start")
        r = await auth_client.post(
            f"/api/sessions/{sid}/exercises",
            json={"exercise_id": exercise["id"], "order_index": 0},
        )
        se_id = r.json()["id"]
        r = await auth_client.post(
            f"/api/sessions/session-exercises/{se_id}/sets",
            json={"set_number": 1, "reps": 5, "weight": 50.0},
        )
        await auth_client.put(
            f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
        )
        await auth_client.post(f"/api/sessions/{sid}/complete")

    r = await auth_client.get(f"/api/exercises/{exercise['id']}/history?limit=2")
    assert r.status_code == 200
    assert len(r.json()) == 2
