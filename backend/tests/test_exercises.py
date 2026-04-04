"""
Tests for /api/exercises  (CRUD + history)

Coverage:
  - GET    /api/exercises              — list all, filter by muscle_group
  - GET    /api/exercises/{id}         — found, not found
  - POST   /api/exercises              — success, requires auth
  - PUT    /api/exercises/{id}         — full update, partial update, not found
  - DELETE /api/exercises/{id}         — success, not found
  - GET    /api/exercises/{id}/history — empty, with sets
"""

import uuid
import pytest
import pytest_asyncio

from app.models.models import (
    Exercise, TrainingSession, SessionExercise, ExerciseSet
)


# ── list ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_exercises_empty(client):
    resp = await client.get("/api/exercises")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_exercises_returns_all(client, test_exercise):
    resp = await client.get("/api/exercises")
    assert resp.status_code == 200
    ids = [e["id"] for e in resp.json()]
    assert test_exercise.id in ids


@pytest.mark.asyncio
async def test_list_exercises_filter_by_muscle_group(client, db_session):
    chest = Exercise(id=str(uuid.uuid4()), name="Bench", muscle_group="chest", category="weighted")
    back = Exercise(id=str(uuid.uuid4()), name="Row", muscle_group="back", category="weighted")
    db_session.add_all([chest, back])
    await db_session.commit()

    resp = await client.get("/api/exercises?muscle_group=chest")
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()]
    assert "Bench" in names
    assert "Row" not in names


# ── get one ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_exercise_found(client, test_exercise):
    resp = await client.get(f"/api/exercises/{test_exercise.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == test_exercise.id
    assert data["name"] == test_exercise.name
    assert data["muscle_group"] == test_exercise.muscle_group


@pytest.mark.asyncio
async def test_get_exercise_not_found(client):
    resp = await client.get(f"/api/exercises/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


# ── create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_exercise_requires_auth(client):
    resp = await client.post(
        "/api/exercises",
        json={"name": "Squat", "muscle_group": "legs", "category": "weighted"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_exercise_success(client, auth_headers):
    payload = {"name": "Squat", "muscle_group": "legs", "category": "weighted"}
    resp = await client.post("/api/exercises", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Squat"
    assert data["muscle_group"] == "legs"
    assert data["category"] == "weighted"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_bodyweight_exercise(client, auth_headers):
    payload = {"name": "Pull-up", "muscle_group": "back", "category": "bodyweight"}
    resp = await client.post("/api/exercises", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["category"] == "bodyweight"


@pytest.mark.asyncio
async def test_create_exercise_with_description(client, auth_headers):
    payload = {
        "name": "Deadlift",
        "muscle_group": "back",
        "category": "weighted",
        "description": "Hip-hinge compound movement",
    }
    resp = await client.post("/api/exercises", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["description"] == "Hip-hinge compound movement"


# ── update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_exercise_name(client, test_exercise):
    resp = await client.put(
        f"/api/exercises/{test_exercise.id}",
        json={"name": "Incline Bench Press"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Incline Bench Press"


@pytest.mark.asyncio
async def test_update_exercise_partial(client, test_exercise):
    """PUT with only some fields should update only those fields."""
    resp = await client.put(
        f"/api/exercises/{test_exercise.id}",
        json={"muscle_group": "shoulders"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["muscle_group"] == "shoulders"
    # name should be unchanged
    assert data["name"] == test_exercise.name


@pytest.mark.asyncio
async def test_update_exercise_not_found(client):
    resp = await client.put(
        f"/api/exercises/{uuid.uuid4()}",
        json={"name": "Ghost Exercise"},
    )
    assert resp.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_exercise_success(client, test_exercise):
    resp = await client.delete(f"/api/exercises/{test_exercise.id}")
    assert resp.status_code == 200
    assert "deleted" in resp.json()["message"].lower()

    # Confirm it's gone
    resp2 = await client.get(f"/api/exercises/{test_exercise.id}")
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_exercise_not_found(client):
    resp = await client.delete(f"/api/exercises/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── history ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_exercise_history_empty(client, test_exercise, auth_headers):
    resp = await client.get(
        f"/api/exercises/{test_exercise.id}/history",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_exercise_history_with_sets(client, db_session, test_user, test_exercise, auth_headers):
    ts = TrainingSession(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        name="Chest Day",
        scheduled_date="2026-03-01",
        status="completed",
    )
    db_session.add(ts)

    se = SessionExercise(
        id=str(uuid.uuid4()),
        session_id=ts.id,
        exercise_id=test_exercise.id,
    )
    db_session.add(se)

    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()),
        session_exercise_id=se.id,
        set_number=1,
        reps=10,
        weight=100.0,
        is_completed=True,
        is_warmup=False,
    ))
    await db_session.commit()

    resp = await client.get(
        f"/api/exercises/{test_exercise.id}/history",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    history = resp.json()
    assert len(history) == 1
    assert history[0]["total_volume"] == 1000.0
    assert history[0]["sets"][0]["weight"] == 100.0


@pytest.mark.asyncio
async def test_exercise_history_excludes_other_users(client, db_session, test_user, test_exercise, auth_headers):
    """History must only return sessions belonging to the authenticated user."""
    from app.models.models import User
    other_user = User(
        id=str(uuid.uuid4()),
        email="other@example.com",
        name="Other",
        hashed_password="x",
    )
    db_session.add(other_user)

    ts = TrainingSession(
        id=str(uuid.uuid4()),
        user_id=other_user.id,
        name="Other Chest Day",
        scheduled_date="2026-03-05",
        status="completed",
    )
    db_session.add(ts)
    se = SessionExercise(
        id=str(uuid.uuid4()),
        session_id=ts.id,
        exercise_id=test_exercise.id,
    )
    db_session.add(se)
    db_session.add(ExerciseSet(
        id=str(uuid.uuid4()),
        session_exercise_id=se.id,
        set_number=1,
        reps=5,
        weight=200.0,
        is_completed=True,
        is_warmup=False,
    ))
    await db_session.commit()

    resp = await client.get(
        f"/api/exercises/{test_exercise.id}/history",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []
