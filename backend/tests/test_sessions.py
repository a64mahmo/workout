"""
Tests for /api/sessions — full workout lifecycle:
create → start → add exercises → log sets → complete/cancel
plus pre-summary, volume calculation, and PR detection.
"""
import pytest
from httpx import AsyncClient


# ── Create session ────────────────────────────────────────────────────────────

async def test_create_session_requires_auth(client: AsyncClient, cycle: dict):
    r = await client.post(
        "/api/sessions",
        json={"name": "Test", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-04"},
    )
    assert r.status_code == 401


async def test_create_session_success(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.post(
        "/api/sessions",
        json={
            "name": "Push Day",
            "meso_cycle_id": cycle["id"],
            "scheduled_date": "2026-04-04",
            "notes": "Focus on chest",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Push Day"
    assert body["status"] in ("scheduled", "Scheduled")
    assert body["total_volume"] == 0.0
    assert body["exercises"] == []


async def test_create_session_without_cycle(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/sessions",
        json={"name": "Orphan Session", "scheduled_date": "2026-04-04"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Orphan Session"


async def test_create_session_missing_name(auth_client: AsyncClient):
    r = await auth_client.post("/api/sessions", json={"scheduled_date": "2026-04-04"})
    assert r.status_code == 422


# ── List / Get sessions ───────────────────────────────────────────────────────

async def test_list_sessions_returns_only_own(
    auth_client: AsyncClient,
    second_auth_client: AsyncClient,
    cycle: dict,
):
    await auth_client.post(
        "/api/sessions",
        json={"name": "My Session", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-04"},
    )
    r = await second_auth_client.get("/api/sessions")
    assert r.status_code == 200
    assert r.json() == []


async def test_get_session_includes_exercises_and_sets(
    auth_client: AsyncClient, session_with_sets: dict
):
    sid = session_with_sets["session"]["id"]
    r = await auth_client.get(f"/api/sessions/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert len(body["exercises"]) == 1
    assert len(body["exercises"][0]["sets"]) == 3


async def test_get_session_not_found(auth_client: AsyncClient):
    r = await auth_client.get("/api/sessions/nonexistent")
    assert r.status_code == 404


# ── Update / Delete ───────────────────────────────────────────────────────────

async def test_update_session(auth_client: AsyncClient, session_obj: dict):
    r = await auth_client.put(
        f"/api/sessions/{session_obj['id']}",
        json={"name": "Renamed Session", "notes": "New notes"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed Session"
    assert body["notes"] == "New notes"


async def test_delete_session_cascades(
    auth_client: AsyncClient, session_with_sets: dict
):
    """Deleting a session should cascade to exercises and sets."""
    sid = session_with_sets["session"]["id"]
    r = await auth_client.delete(f"/api/sessions/{sid}")
    assert r.status_code == 200
    # Session gone
    r2 = await auth_client.get(f"/api/sessions/{sid}")
    assert r2.status_code == 404


async def test_delete_nonexistent_session(auth_client: AsyncClient):
    r = await auth_client.delete("/api/sessions/ghost")
    assert r.status_code == 404


# ── Session lifecycle ─────────────────────────────────────────────────────────

async def test_start_session(auth_client: AsyncClient, session_obj: dict):
    r = await auth_client.post(f"/api/sessions/{session_obj['id']}/start")
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "Session started"
    assert "start_time" in body

    # Verify status in DB
    r2 = await auth_client.get(f"/api/sessions/{session_obj['id']}")
    assert r2.json()["status"] == "in_progress"


async def test_start_nonexistent_session(auth_client: AsyncClient):
    r = await auth_client.post("/api/sessions/ghost/start")
    assert r.status_code == 404


async def test_cancel_session(auth_client: AsyncClient, session_obj: dict):
    r = await auth_client.post(f"/api/sessions/{session_obj['id']}/cancel")
    assert r.status_code == 200
    r2 = await auth_client.get(f"/api/sessions/{session_obj['id']}")
    assert r2.json()["status"] == "cancelled"


async def test_complete_session_calculates_volume(
    auth_client: AsyncClient, session_with_sets: dict
):
    """
    Session has 3 sets: 10×100, 10×105, 8×110.
    Expected volume = 1000 + 1050 + 880 = 2930.
    """
    sid = session_with_sets["session"]["id"]
    r = await auth_client.post(f"/api/sessions/{sid}/complete")
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "Session completed"
    assert body["total_volume"] == pytest.approx(2930.0)

    # Status updated
    r2 = await auth_client.get(f"/api/sessions/{sid}")
    assert r2.json()["status"] == "completed"
    assert r2.json()["total_volume"] == pytest.approx(2930.0)


async def test_complete_session_warmup_not_counted(
    auth_client: AsyncClient, started_session: dict, exercise: dict
):
    """Warmup sets must not contribute to total_volume."""
    sid = started_session["id"]

    r = await auth_client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    se_id = r.json()["id"]

    # Warmup
    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 1, "reps": 10, "weight": 50.0, "is_warmup": True},
    )
    await auth_client.put(
        f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
    )

    # Working set
    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 2, "reps": 8, "weight": 100.0, "is_warmup": False},
    )
    await auth_client.put(
        f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
    )

    r = await auth_client.post(f"/api/sessions/{sid}/complete")
    assert r.json()["total_volume"] == pytest.approx(800.0)  # 8 * 100 only


async def test_complete_session_incomplete_sets_not_counted(
    auth_client: AsyncClient, started_session: dict, exercise: dict
):
    """Only sets where is_completed=True should be counted."""
    sid = started_session["id"]
    r = await auth_client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    se_id = r.json()["id"]

    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 1, "reps": 10, "weight": 100.0},
    )
    # NOT marking it complete
    r = await auth_client.post(f"/api/sessions/{sid}/complete")
    assert r.json()["total_volume"] == pytest.approx(0.0)


async def test_complete_session_no_sets(auth_client: AsyncClient, started_session: dict):
    """Session with no exercises → volume 0, still completes."""
    sid = started_session["id"]
    r = await auth_client.post(f"/api/sessions/{sid}/complete")
    assert r.status_code == 200
    assert r.json()["total_volume"] == pytest.approx(0.0)


async def test_complete_nonexistent_session(auth_client: AsyncClient):
    r = await auth_client.post("/api/sessions/ghost/complete")
    assert r.status_code == 404


# ── Session Exercises ─────────────────────────────────────────────────────────

async def test_add_exercise_to_session(
    auth_client: AsyncClient, session_obj: dict, exercise: dict
):
    r = await auth_client.post(
        f"/api/sessions/{session_obj['id']}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["exercise_id"] == exercise["id"]
    assert body["sets"] == []
    assert body["exercise"]["name"] == "Bench Press"


async def test_add_same_exercise_twice(
    auth_client: AsyncClient, session_obj: dict, exercise: dict
):
    """Allowed — user might do same exercise in supersets."""
    for i in range(2):
        r = await auth_client.post(
            f"/api/sessions/{session_obj['id']}/exercises",
            json={"exercise_id": exercise["id"], "order_index": i},
        )
        assert r.status_code == 200
    r = await auth_client.get(f"/api/sessions/{session_obj['id']}")
    assert len(r.json()["exercises"]) == 2


async def test_remove_exercise_from_session(
    auth_client: AsyncClient, session_with_sets: dict
):
    se_id = session_with_sets["se_id"]
    r = await auth_client.delete(f"/api/sessions/session-exercises/{se_id}")
    assert r.status_code == 200
    # Session should now have 0 exercises
    sid = session_with_sets["session"]["id"]
    r2 = await auth_client.get(f"/api/sessions/{sid}")
    assert r2.json()["exercises"] == []


async def test_remove_nonexistent_exercise(auth_client: AsyncClient):
    r = await auth_client.delete("/api/sessions/session-exercises/ghost")
    assert r.status_code == 404


# ── Exercise Sets ─────────────────────────────────────────────────────────────

async def test_add_set(auth_client: AsyncClient, session_obj: dict, exercise: dict):
    r = await auth_client.post(
        f"/api/sessions/{session_obj['id']}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    se_id = r.json()["id"]

    r = await auth_client.post(
        f"/api/sessions/session-exercises/{se_id}/sets",
        json={"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["set_number"] == 1
    assert body["reps"] == 10
    assert body["weight"] == pytest.approx(100.0)
    assert body["rpe"] == pytest.approx(7.5)
    assert body["is_completed"] is False
    assert body["is_warmup"] is False


async def test_mark_set_completed(
    auth_client: AsyncClient, session_with_sets: dict
):
    set_id = session_with_sets["set_ids"][0]
    r = await auth_client.put(
        f"/api/sessions/exercise-sets/{set_id}",
        json={"is_completed": True, "reps": 12, "weight": 110.0, "rpe": 8.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_completed"] is True
    assert body["reps"] == 12
    assert body["weight"] == pytest.approx(110.0)


async def test_update_nonexistent_set(auth_client: AsyncClient):
    r = await auth_client.put(
        "/api/sessions/exercise-sets/ghost",
        json={"reps": 10},
    )
    assert r.status_code == 404


async def test_delete_set(auth_client: AsyncClient, session_with_sets: dict):
    set_id = session_with_sets["set_ids"][0]
    r = await auth_client.delete(f"/api/sessions/exercise-sets/{set_id}")
    assert r.status_code == 200

    sid = session_with_sets["session"]["id"]
    r2 = await auth_client.get(f"/api/sessions/{sid}")
    assert len(r2.json()["exercises"][0]["sets"]) == 2


async def test_delete_nonexistent_set(auth_client: AsyncClient):
    r = await auth_client.delete("/api/sessions/exercise-sets/ghost")
    assert r.status_code == 404


# ── Pre-completion summary ────────────────────────────────────────────────────

async def test_pre_summary_structure(
    auth_client: AsyncClient, session_with_sets: dict
):
    sid = session_with_sets["session"]["id"]
    r = await auth_client.get(f"/api/sessions/{sid}/pre-summary")
    assert r.status_code == 200
    body = r.json()
    assert body["workout_number"] == 1  # no prior completed sessions
    assert body["exercise_count"] == 1
    assert body["completed_sets"] == 3
    assert body["total_sets"] == 3
    assert body["total_volume"] == pytest.approx(2930.0)
    assert "prs" in body
    assert "duration_seconds" in body


async def test_pre_summary_detects_pr(
    auth_client: AsyncClient,
    cycle: dict,
    exercise: dict,
):
    """If current session has a heavier top set than all previous, report as PR."""

    async def _run_session(weight: float, reps: int):
        sr = await auth_client.post(
            "/api/sessions",
            json={"name": "S", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-01"},
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
            json={"set_number": 1, "reps": reps, "weight": weight},
        )
        await auth_client.put(
            f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
        )
        return sid

    # First session (creates history at 100 lbs)
    sid1 = await _run_session(100.0, 10)
    await auth_client.post(f"/api/sessions/{sid1}/complete")

    # Second session with heavier weight → should be a PR
    sid2 = await _run_session(120.0, 8)
    r = await auth_client.get(f"/api/sessions/{sid2}/pre-summary")
    prs = r.json()["prs"]
    assert len(prs) == 1
    pr = prs[0]
    assert pr["old_max"] == pytest.approx(100.0)
    assert pr["new_max"] == pytest.approx(120.0)


async def test_pre_summary_no_pr_same_weight(
    auth_client: AsyncClient, cycle: dict, exercise: dict
):
    """Matching previous max is not a PR."""

    async def _run_session(weight: float):
        sr = await auth_client.post(
            "/api/sessions",
            json={"name": "S", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-01"},
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
            json={"set_number": 1, "reps": 8, "weight": weight},
        )
        await auth_client.put(
            f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
        )
        return sid

    sid1 = await _run_session(100.0)
    await auth_client.post(f"/api/sessions/{sid1}/complete")

    sid2 = await _run_session(100.0)
    r = await auth_client.get(f"/api/sessions/{sid2}/pre-summary")
    assert r.json()["prs"] == []


async def test_pre_summary_workout_number(
    auth_client: AsyncClient, cycle: dict, exercise: dict
):
    """workout_number = completed sessions + 1."""

    for i in range(3):
        sr = await auth_client.post(
            "/api/sessions",
            json={"name": f"Session {i}", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-01"},
        )
        sid = sr.json()["id"]
        await auth_client.post(f"/api/sessions/{sid}/start")
        await auth_client.post(f"/api/sessions/{sid}/complete")

    # Current (4th) session
    sr = await auth_client.post(
        "/api/sessions",
        json={"name": "Current", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-04"},
    )
    sid = sr.json()["id"]
    r = await auth_client.get(f"/api/sessions/{sid}/pre-summary")
    assert r.json()["workout_number"] == 4
