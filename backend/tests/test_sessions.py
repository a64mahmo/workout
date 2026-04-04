"""
Tests for /api/sessions  (CRUD · lifecycle · exercises · sets)

Coverage:
  - GET    /api/sessions               — list, scoped to user
  - GET    /api/sessions/{id}          — found, not found
  - POST   /api/sessions               — success, requires auth
  - PUT    /api/sessions/{id}          — update fields
  - DELETE /api/sessions/{id}          — success, not found, cascades sets
  - POST   /api/sessions/{id}/start    — transitions to in_progress
  - POST   /api/sessions/{id}/complete — transitions to completed, calculates volume
  - POST   /api/sessions/{id}/cancel   — transitions to cancelled
  - POST   /api/sessions/{id}/exercises         — add exercise
  - DELETE /api/sessions/session-exercises/{se_id}  — remove exercise
  - POST   /api/sessions/session-exercises/{se_id}/sets  — add set
  - PUT    /api/sessions/exercise-sets/{set_id}  — update set (mark completed, weight/reps)
  - DELETE /api/sessions/exercise-sets/{set_id}  — delete set
  - GET    /api/sessions/{id}/pre-summary        — PR detection + volume
"""

import uuid
import pytest
import pytest_asyncio

from app.models.models import (
    TrainingSession, SessionExercise, ExerciseSet, Exercise
)


# ── helpers ───────────────────────────────────────────────────────────────────

async def make_session_via_api(client, auth_headers, cycle_id, name="Test Session"):
    resp = await client.post(
        "/api/sessions",
        json={
            "name": name,
            "meso_cycle_id": cycle_id,
            "scheduled_date": "2026-04-01",
            "status": "scheduled",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()


# ── list sessions ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_sessions_empty(client, auth_headers):
    resp = await client.get("/api/sessions", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_sessions_returns_own_sessions(client, auth_headers, test_cycle, test_session):
    resp = await client.get("/api/sessions", headers=auth_headers)
    ids = [s["id"] for s in resp.json()]
    assert test_session.id in ids


@pytest.mark.asyncio
async def test_list_sessions_requires_auth(client):
    resp = await client.get("/api/sessions")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_sessions_excludes_other_users(client, db_session, test_user, auth_headers):
    from app.models.models import User
    other = User(id=str(uuid.uuid4()), email="other3@example.com", name="Other", hashed_password="x")
    db_session.add(other)
    ts = TrainingSession(
        id=str(uuid.uuid4()), user_id=other.id,
        name="Other Session", scheduled_date="2026-04-01", status="scheduled",
    )
    db_session.add(ts)
    await db_session.commit()

    resp = await client.get("/api/sessions", headers=auth_headers)
    ids = [s["id"] for s in resp.json()]
    assert ts.id not in ids


# ── get session ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_session_found(client, test_session):
    resp = await client.get(f"/api/sessions/{test_session.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == test_session.id
    assert data["name"] == test_session.name


@pytest.mark.asyncio
async def test_get_session_includes_exercises_list(client, test_session):
    resp = await client.get(f"/api/sessions/{test_session.id}")
    assert "exercises" in resp.json()


@pytest.mark.asyncio
async def test_get_session_not_found(client):
    resp = await client.get(f"/api/sessions/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── create session ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_session_requires_auth(client, test_cycle):
    resp = await client.post("/api/sessions", json={"name": "X", "meso_cycle_id": test_cycle.id, "scheduled_date": "2026-01-01"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_session_success(client, auth_headers, test_cycle, test_user):
    data = await make_session_via_api(client, auth_headers, test_cycle.id)
    assert data["name"] == "Test Session"
    assert data["user_id"] == test_user.id
    assert data["status"] in ("scheduled", "Scheduled")


@pytest.mark.asyncio
async def test_create_session_with_notes(client, auth_headers, test_cycle):
    resp = await client.post(
        "/api/sessions",
        json={"name": "Push Day", "meso_cycle_id": test_cycle.id,
              "scheduled_date": "2026-04-01", "notes": "Focus on chest"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Focus on chest"


# ── update session ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_session_name(client, test_session):
    resp = await client.put(f"/api/sessions/{test_session.id}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


@pytest.mark.asyncio
async def test_update_session_notes(client, test_session):
    resp = await client.put(f"/api/sessions/{test_session.id}", json={"notes": "Heavy today"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Heavy today"


@pytest.mark.asyncio
async def test_update_session_not_found(client):
    resp = await client.put(f"/api/sessions/{uuid.uuid4()}", json={"name": "Ghost"})
    assert resp.status_code == 404


# ── delete session ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_session_success(client, test_session):
    resp = await client.delete(f"/api/sessions/{test_session.id}")
    assert resp.status_code == 200
    assert "deleted" in resp.json()["message"].lower()

    resp2 = await client.get(f"/api/sessions/{test_session.id}")
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_not_found(client):
    resp = await client.delete(f"/api/sessions/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_cascades_sets(client, db_session, test_session, test_exercise):
    """Deleting a session should also remove its exercises and sets."""
    se = SessionExercise(
        id=str(uuid.uuid4()),
        session_id=test_session.id,
        exercise_id=test_exercise.id,
    )
    db_session.add(se)
    set_id = str(uuid.uuid4())
    db_session.add(ExerciseSet(
        id=set_id, session_exercise_id=se.id,
        set_number=1, reps=10, weight=100.0,
    ))
    await db_session.commit()

    resp = await client.delete(f"/api/sessions/{test_session.id}")
    assert resp.status_code == 200

    # The set should be gone too
    from sqlalchemy import select
    from app.models.models import ExerciseSet as ES
    result = await db_session.execute(select(ES).where(ES.id == set_id))
    assert result.scalar_one_or_none() is None


# ── lifecycle: start ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_session(client, test_session):
    resp = await client.post(f"/api/sessions/{test_session.id}/start")
    assert resp.status_code == 200
    assert resp.json()["message"] == "Session started"
    assert "start_time" in resp.json()


@pytest.mark.asyncio
async def test_start_session_sets_in_progress(client, db_session, test_session):
    await client.post(f"/api/sessions/{test_session.id}/start")
    await db_session.refresh(test_session)
    assert test_session.status == "in_progress"


@pytest.mark.asyncio
async def test_start_session_not_found(client):
    resp = await client.post(f"/api/sessions/{uuid.uuid4()}/start")
    assert resp.status_code == 404


# ── lifecycle: complete ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_complete_session(client, db_session, test_session, test_exercise):
    """Completing a session sets status=completed and computes total_volume."""
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id,
        set_number=1, reps=10, weight=100.0,
        is_completed=True, is_warmup=False,
    ))
    await db_session.commit()

    resp = await client.post(f"/api/sessions/{test_session.id}/complete")
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "Session completed"
    assert data["total_volume"] == 1000.0


@pytest.mark.asyncio
async def test_complete_session_updates_status(client, db_session, test_session):
    await client.post(f"/api/sessions/{test_session.id}/complete")
    await db_session.refresh(test_session)
    assert test_session.status == "completed"


@pytest.mark.asyncio
async def test_complete_session_ignores_warmup_sets(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    # warmup set — should NOT count toward volume
    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id,
        set_number=1, reps=10, weight=60.0,
        is_completed=True, is_warmup=True,
    ))
    # working set
    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id,
        set_number=2, reps=8, weight=100.0,
        is_completed=True, is_warmup=False,
    ))
    await db_session.commit()

    resp = await client.post(f"/api/sessions/{test_session.id}/complete")
    assert resp.json()["total_volume"] == 800.0  # only the working set


@pytest.mark.asyncio
async def test_complete_session_not_found(client):
    resp = await client.post(f"/api/sessions/{uuid.uuid4()}/complete")
    assert resp.status_code == 404


# ── lifecycle: cancel ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_session(client, db_session, test_session):
    resp = await client.post(f"/api/sessions/{test_session.id}/cancel")
    assert resp.status_code == 200
    await db_session.refresh(test_session)
    assert test_session.status == "cancelled"


@pytest.mark.asyncio
async def test_cancel_session_not_found(client):
    resp = await client.post(f"/api/sessions/{uuid.uuid4()}/cancel")
    assert resp.status_code == 404


# ── add / remove exercise from session ───────────────────────────────────────

@pytest.mark.asyncio
async def test_add_exercise_to_session(client, test_session, test_exercise):
    resp = await client.post(
        f"/api/sessions/{test_session.id}/exercises",
        json={"exercise_id": test_exercise.id, "order_index": 0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exercise_id"] == test_exercise.id
    assert "id" in data


@pytest.mark.asyncio
async def test_remove_exercise_from_session(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    await db_session.commit()

    resp = await client.delete(f"/api/sessions/session-exercises/{se.id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_remove_exercise_not_found(client):
    resp = await client.delete(f"/api/sessions/session-exercises/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── add / update / delete sets ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_set_to_exercise(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    await db_session.commit()

    resp = await client.post(
        f"/api/sessions/session-exercises/{se.id}/sets",
        json={"set_number": 1, "reps": 8, "weight": 80.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["set_number"] == 1
    assert data["reps"] == 8
    assert data["weight"] == 80.0
    assert data["is_completed"] is False


@pytest.mark.asyncio
async def test_update_set_mark_completed(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    es = ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id,
        set_number=1, reps=10, weight=100.0,
    )
    db_session.add(es)
    await db_session.commit()

    resp = await client.put(
        f"/api/sessions/exercise-sets/{es.id}",
        json={"is_completed": True},
    )
    assert resp.status_code == 200
    assert resp.json()["is_completed"] is True


@pytest.mark.asyncio
async def test_update_set_weight_and_reps(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    es = ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id, set_number=1,
    )
    db_session.add(es)
    await db_session.commit()

    resp = await client.put(
        f"/api/sessions/exercise-sets/{es.id}",
        json={"reps": 12, "weight": 105.0, "rpe": 8.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reps"] == 12
    assert data["weight"] == 105.0
    assert data["rpe"] == 8.0


@pytest.mark.asyncio
async def test_update_set_not_found(client):
    resp = await client.put(
        f"/api/sessions/exercise-sets/{uuid.uuid4()}",
        json={"reps": 10},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_set(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    es = ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id, set_number=1,
    )
    db_session.add(es)
    await db_session.commit()

    resp = await client.delete(f"/api/sessions/exercise-sets/{es.id}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_set_not_found(client):
    resp = await client.delete(f"/api/sessions/exercise-sets/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── pre-summary ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pre_summary_basic(client, test_session):
    resp = await client.get(f"/api/sessions/{test_session.id}/pre-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_volume" in data
    assert "completed_sets" in data
    assert "total_sets" in data
    assert "workout_number" in data


@pytest.mark.asyncio
async def test_pre_summary_volume_calculation(client, db_session, test_session, test_exercise):
    se = SessionExercise(
        id=str(uuid.uuid4()), session_id=test_session.id, exercise_id=test_exercise.id,
    )
    db_session.add(se)
    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()), session_exercise_id=se.id,
        set_number=1, reps=5, weight=200.0,
        is_completed=True, is_warmup=False,
    ))
    await db_session.commit()

    resp = await client.get(f"/api/sessions/{test_session.id}/pre-summary")
    assert resp.json()["total_volume"] == 1000.0


@pytest.mark.asyncio
async def test_pre_summary_not_found(client):
    resp = await client.get(f"/api/sessions/{uuid.uuid4()}/pre-summary")
    assert resp.status_code == 404
