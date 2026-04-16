import pytest
from httpx import AsyncClient
from datetime import date, timedelta
import uuid

async def _create_session(client, cycle_id, exercise_id, sets, date_str, plan_session_id=None):
    payload = {"name": "Test", "scheduled_date": date_str, "status": "completed"}
    if cycle_id: payload["meso_cycle_id"] = cycle_id
    if plan_session_id: payload["plan_session_id"] = plan_session_id
    
    sr = await client.post("/api/sessions", json=payload)
    sid = sr.json()["id"]
    
    # Ensure status is actually completed (POST might default to scheduled)
    await client.put(f"/api/sessions/{sid}", json={"status": "completed"})
    
    await client.post(f"/api/sessions/{sid}/start")
    r = await client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise_id, "order_index": 0},
    )
    se_id = r.json()["id"]
    for i, s in enumerate(sets):
        s_data = {**s, "set_number": i + 1}
        r = await client.post(f"/api/sessions/session-exercises/{se_id}/sets", json=s_data)
        r_json = r.json()
        await client.put(f"/api/sessions/exercise-sets/{r_json['id']}", json={"is_completed": True})
    await client.post(f"/api/sessions/{sid}/complete")
    return sid

@pytest.mark.asyncio
async def test_suggestion_extreme_reps_with_plan(auth_client: AsyncClient, exercise: dict):
    """
    Test e1RM plan-based suggestion with extreme rep history.
    """
    # 1. Create a Plan
    plan_res = await auth_client.post("/api/plans", json={"name": "Test Plan", "description": ""})
    plan_id = plan_res.json()["id"]
    
    # 2. Add a PlanSession
    ps_res = await auth_client.post(f"/api/plans/{plan_id}/sessions", json={"name": "Day 1", "day_number": 1, "week_number": 1})
    ps_id = ps_res.json()["id"]
    
    # 3. Add Exercise to PlanSession with target RPE/reps
    await auth_client.post(f"/api/plans/plan-sessions/{ps_id}/exercises", json={
        "exercise_id": exercise["id"],
        "target_sets": 3,
        "target_reps": 10,
        "target_rpe": 7.0,
        "order_index": 0
    })

    # 4. Create history (Extreme reps)
    # 10 lbs x 100 reps @ RPE 5.
    # e1RM = 10 * (1 + (100 + (10-5))/30) = 10 * (1 + 105/30) = 10 * 4.5 = 45.0
    await _create_session(auth_client, None, exercise["id"], 
        [{"reps": 100, "weight": 10.0, "rpe": 5.0}], "2026-04-01")
    
    # 5. Create current session linked to PlanSession
    curr_res = await auth_client.post("/api/sessions", json={
        "name": "Current", 
        "scheduled_date": "2026-04-10",
        "plan_session_id": ps_id
    })
    curr_id = curr_res.json()["id"]
    
    # 6. Ask for suggestion
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}&session_id={curr_id}")
    assert r.status_code == 200
    body = r.json()
    
    # target 10 reps @ RPE 7 (RIR 3)
    # effective reps = 13
    # suggested = 45 / (1 + 13/30) = 45 / 1.433 = 31.4 -> rounds to 32.5
    assert body["suggested_weight"] >= 30.0
    assert body["estimated_1rm"] == pytest.approx(45.0)

@pytest.mark.asyncio
async def test_suggestion_zero_weight_history(auth_client: AsyncClient, exercise: dict, cycle: dict):
    """If history has only 0 weight sets, should return 'no history' style."""
    await _create_session(auth_client, cycle["id"], exercise["id"], 
        [{"reps": 10, "weight": 0.0, "rpe": 5.0}], "2026-04-01")
    
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.status_code == 200
    assert r.json()["suggested_weight"] == 0
    assert "No history" in r.json()["adjustment_reason"]

@pytest.mark.asyncio
async def test_suggestion_session_id_mismatch(auth_client: AsyncClient, second_auth_client: AsyncClient, exercise: dict):
    """User A asks for suggestion using User B's session_id."""
    sr = await second_auth_client.post("/api/sessions", json={"name": "B Session", "scheduled_date": "2026-04-01"})
    sid_b = sr.json()["id"]

    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}&session_id={sid_b}")
    assert r.status_code == 200

@pytest.mark.asyncio
async def test_meso_week_calculation_leap_year_edge(auth_client: AsyncClient, exercise: dict):
    """Test week counting across boundaries."""
    await _create_session(auth_client, None, exercise["id"], [{"reps": 10, "weight": 100}], "2026-02-28")
    await _create_session(auth_client, None, exercise["id"], [{"reps": 10, "weight": 100}], "2026-03-01")
    
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.json()["meso_week"] >= 1

@pytest.mark.asyncio
async def test_suggestion_with_deleted_exercise(auth_client: AsyncClient, exercise: dict, cycle: dict):
    """Log a session, delete the exercise, then ask for suggestions."""
    await _create_session(auth_client, cycle["id"], exercise["id"], 
        [{"reps": 10, "weight": 100}], "2026-04-01")
    
    # SET NULL and cascade should work now
    res = await auth_client.delete(f"/api/exercises/{exercise['id']}")
    assert res.status_code == 200
    
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.status_code == 200
    assert "No history" in r.json()["adjustment_reason"]

@pytest.mark.asyncio
async def test_suggestion_multiple_sessions_same_day(auth_client: AsyncClient, exercise: dict, cycle: dict):
    """User logs two sessions for same exercise on same day."""
    # Session 1
    await _create_session(auth_client, cycle["id"], exercise["id"], [{"reps": 10, "weight": 100}], "2026-04-01")
    # Session 2
    await _create_session(auth_client, cycle["id"], exercise["id"], [{"reps": 10, "weight": 110}], "2026-04-01")
    
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.json()["previous_weight"] == 110.0
