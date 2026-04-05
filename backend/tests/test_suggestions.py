"""
Tests for /api/suggestions — RP-style weight algorithm, exercise ranking,
muscle-group volume, and suggestion audit trail.

The weight suggestion algorithm is fully exercised through the API to test
the integration between set data → RPE thresholds → weight recommendation.
"""
import pytest
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_and_complete_session(
    client: AsyncClient,
    cycle_id: str,
    exercise_id: str,
    sets: list[dict],
    date: str = "2026-04-01",
) -> str:
    """Create a session, add an exercise, log sets (all completed), then complete it."""
    sr = await client.post(
        "/api/sessions",
        json={"name": "Test", "meso_cycle_id": cycle_id, "scheduled_date": date},
    )
    sid = sr.json()["id"]
    await client.post(f"/api/sessions/{sid}/start")

    r = await client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise_id, "order_index": 0},
    )
    se_id = r.json()["id"]

    for s in sets:
        r = await client.post(f"/api/sessions/session-exercises/{se_id}/sets", json=s)
        set_id = r.json()["id"]
        await client.put(
            f"/api/sessions/exercise-sets/{set_id}", json={"is_completed": True}
        )

    await client.post(f"/api/sessions/{sid}/complete")
    return sid


# ── Weight suggestion — no history ───────────────────────────────────────────

async def test_weight_suggestion_no_history(
    auth_client: AsyncClient, exercise: dict
):
    r = await auth_client.get(
        f"/api/suggestions/weight?exercise_id={exercise['id']}"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["previous_weight"] == 0
    assert body["suggested_weight"] == 0
    assert body["average_rpe"] is None
    assert "No history" in body["adjustment_reason"]


async def test_weight_suggestion_requires_auth(client: AsyncClient, exercise: dict):
    r = await client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.status_code == 401


# ── Weight suggestion — RPE thresholds ───────────────────────────────────────

async def _suggest(client, exercise_id, cycle_id, sets, date="2026-04-01"):
    await _create_and_complete_session(client, cycle_id, exercise_id, sets, date)
    r = await client.get(f"/api/suggestions/weight?exercise_id={exercise_id}")
    assert r.status_code == 200
    return r.json()


async def test_weight_suggestion_rpe_below_target_adds_weight(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """RPE below week-1 target (7.0) → increase weight by ~2.5% per RPE unit."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [
            {"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 6.0},
            {"set_number": 2, "reps": 10, "weight": 100.0, "rpe": 6.0},
        ],
    )
    # RPE 6.0, target 7.0 → delta 1.0 × 2.5% = +2.5 lbs → 102.5
    assert suggestion["suggested_weight"] == pytest.approx(102.5)
    assert suggestion["average_rpe"] == pytest.approx(6.0)
    assert "add" in suggestion["adjustment_reason"].lower()


async def test_weight_suggestion_rpe_at_target_maintains_weight(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """RPE close to week-1 target (7.0) → maintain weight."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [
            {"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5},
            {"set_number": 2, "reps": 10, "weight": 100.0, "rpe": 7.5},
        ],
    )
    # RPE 7.5, target 7.0 → small reduction rounds back to 100.0 → maintain
    assert suggestion["suggested_weight"] == pytest.approx(100.0)
    assert "maintain" in suggestion["adjustment_reason"].lower()


async def test_weight_suggestion_rpe_well_above_target_reduces_weight(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """RPE significantly above week-1 target → reduce weight to hit target RPE."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [
            {"set_number": 1, "reps": 8, "weight": 100.0, "rpe": 8.5},
            {"set_number": 2, "reps": 8, "weight": 100.0, "rpe": 8.5},
        ],
    )
    # RPE 8.5, target 7.0 → delta -1.5 × 2.5% = -3.75% → ~95.0
    assert suggestion["suggested_weight"] < 100.0
    assert "reduce" in suggestion["adjustment_reason"].lower()


async def test_weight_suggestion_high_rpe_reduces_weight(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """High RPE (9.2) well above week-1 target → weight reduced by ~5.5%."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [
            {"set_number": 1, "reps": 6, "weight": 100.0, "rpe": 9.2},
            {"set_number": 2, "reps": 6, "weight": 100.0, "rpe": 9.2},
        ],
    )
    # RPE 9.2, target 7.0 → -5.5% → 94.5 → 95.0
    assert suggestion["suggested_weight"] == pytest.approx(95.0)
    assert "reduce" in suggestion["adjustment_reason"].lower()


async def test_weight_suggestion_rpe_above_9_5_triggers_deload(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """max_rpe >= 9.5 → peak hit → deload at 65% of last weight."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [
            {"set_number": 1, "reps": 5, "weight": 100.0, "rpe": 9.8},
            {"set_number": 2, "reps": 5, "weight": 100.0, "rpe": 9.8},
        ],
    )
    # 100 * 0.65 = 65.0
    assert suggestion["suggested_weight"] == pytest.approx(65.0)
    assert "deload" in suggestion["adjustment_reason"].lower()
    assert suggestion["meso_phase"] == "deload"


async def test_weight_suggestion_rounding_to_2_5(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """Suggested weight must be rounded to nearest 2.5 lbs."""
    suggestion = await _suggest(
        auth_client,
        exercise["id"],
        cycle["id"],
        [{"set_number": 1, "reps": 8, "weight": 101.0, "rpe": 7.5}],
    )
    # 101 + 2.5 = 103.5 → nearest 2.5 = 102.5 (floor) or 105 (ceil)
    # round(103.5 / 2.5) * 2.5 = round(41.4) * 2.5 = 41 * 2.5 = 102.5
    assert suggestion["suggested_weight"] % 2.5 == pytest.approx(0.0)


# ── Weight suggestion — no RPE fallback ──────────────────────────────────────

async def test_weight_suggestion_no_rpe_single_session(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """No RPE logged and only one session → hold weight."""
    await _create_and_complete_session(
        auth_client,
        cycle["id"],
        exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 80.0}],
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["average_rpe"] is None
    assert body["previous_weight"] == pytest.approx(80.0)


async def test_weight_suggestion_no_rpe_two_sessions_improving(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """No RPE, two sessions with improvement → keep progressing."""
    await _create_and_complete_session(
        auth_client,
        cycle["id"],
        exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 80.0}],
        date="2026-03-01",
    )
    await _create_and_complete_session(
        auth_client,
        cycle["id"],
        exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 85.0}],
        date="2026-03-08",
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    body = r.json()
    # 85 + 2.5 = 87.5
    assert body["suggested_weight"] == pytest.approx(87.5)


# ── Weight suggestion — top-set logic ────────────────────────────────────────

async def test_weight_suggestion_uses_top_set_not_first_set(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """The reference weight should be the heaviest set, not set_number=1."""
    await _create_and_complete_session(
        auth_client,
        cycle["id"],
        exercise["id"],
        [
            {"set_number": 1, "reps": 12, "weight": 90.0, "rpe": 7.0},
            {"set_number": 2, "reps": 10, "weight": 100.0, "rpe": 8.0},
            {"set_number": 3, "reps": 8, "weight": 110.0, "rpe": 8.5},
        ],
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    body = r.json()
    # Top set weight is 110 lbs
    assert body["previous_weight"] == pytest.approx(110.0)


# ── Weight suggestion — meso cycle filter ────────────────────────────────────

async def test_weight_suggestion_meso_filter_excludes_other_cycles(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """If meso_cycle_id is provided, data from other cycles is ignored."""
    # Session in a different cycle
    r = await auth_client.post(
        "/api/meso-cycles",
        json={"name": "Old Block", "start_date": "2025-01-01", "end_date": "2025-03-31", "goal": "strength"},
    )
    old_cycle_id = r.json()["id"]

    await _create_and_complete_session(
        auth_client,
        old_cycle_id,
        exercise["id"],
        [{"set_number": 1, "reps": 5, "weight": 200.0, "rpe": 9.5}],
    )

    # Now query with current cycle filter → no history for this cycle
    r = await auth_client.get(
        f"/api/suggestions/weight?exercise_id={exercise['id']}&meso_cycle_id={cycle['id']}"
    )
    body = r.json()
    assert body["previous_weight"] == 0  # No data in this cycle
    assert "No history" in body["adjustment_reason"]


async def test_weight_suggestion_creates_log(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    """Every weight suggestion request should create a SuggestionLog entry."""
    await _create_and_complete_session(
        auth_client,
        cycle["id"],
        exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5}],
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    body = r.json()
    assert "log_id" in body
    assert body["log_id"] is not None


# ── Suggestion history & outcomes ────────────────────────────────────────────

async def test_suggestion_history(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    await _create_and_complete_session(
        auth_client, cycle["id"], exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5}],
    )
    # Trigger a suggestion to create a log
    await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")

    r = await auth_client.get(f"/api/suggestions/weight/history?exercise_id={exercise['id']}")
    assert r.status_code == 200
    history = r.json()
    assert len(history) == 1
    assert history[0]["exercise_id"] == exercise["id"]
    assert history[0]["previous_weight"] == pytest.approx(100.0)


async def test_record_suggestion_outcome(
    auth_client: AsyncClient, exercise: dict, cycle: dict
):
    await _create_and_complete_session(
        auth_client, cycle["id"], exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5}],
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    log_id = r.json()["log_id"]

    r = await auth_client.patch(
        f"/api/suggestions/weight/history/{log_id}",
        json={"actual_weight": 102.5, "actual_reps": 10, "actual_rpe": 7.5},
    )
    assert r.status_code == 200

    r = await auth_client.get(f"/api/suggestions/weight/history?exercise_id={exercise['id']}")
    entry = r.json()[0]
    assert entry["actual_weight"] == pytest.approx(102.5)
    assert entry["actual_reps"] == 10
    assert entry["actual_rpe"] == pytest.approx(7.5)


async def test_record_outcome_wrong_user(
    auth_client: AsyncClient,
    second_auth_client: AsyncClient,
    exercise: dict,
    cycle: dict,
):
    """User B should not be able to update user A's suggestion log."""
    await _create_and_complete_session(
        auth_client, cycle["id"], exercise["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.5}],
    )
    r = await auth_client.get(f"/api/suggestions/weight?exercise_id={exercise['id']}")
    log_id = r.json()["log_id"]

    r = await second_auth_client.patch(
        f"/api/suggestions/weight/history/{log_id}",
        json={"actual_weight": 50.0},
    )
    assert r.status_code == 404


# ── Exercise suggestions ──────────────────────────────────────────────────────

async def test_exercise_suggestions_empty(auth_client: AsyncClient):
    r = await auth_client.get("/api/suggestions/exercises")
    assert r.status_code == 200
    assert r.json() == []


async def test_exercise_suggestions_ranked_by_volume(
    auth_client: AsyncClient, cycle: dict
):
    """Exercises are ranked by all-time volume (highest first)."""
    # Create two exercises
    r1 = await auth_client.post(
        "/api/exercises", json={"name": "Squat", "muscle_group": "legs", "category": "weighted"}
    )
    squat_id = r1.json()["id"]

    r2 = await auth_client.post(
        "/api/exercises", json={"name": "Curl", "muscle_group": "biceps", "category": "weighted"}
    )
    curl_id = r2.json()["id"]

    # Squat: high volume (10 * 100 = 1000)
    await _create_and_complete_session(
        auth_client, cycle["id"], squat_id,
        [{"set_number": 1, "reps": 10, "weight": 100.0}],
    )
    # Curl: low volume (10 * 20 = 200)
    await _create_and_complete_session(
        auth_client, cycle["id"], curl_id,
        [{"set_number": 1, "reps": 10, "weight": 20.0}],
    )

    r = await auth_client.get("/api/suggestions/exercises")
    suggestions = r.json()
    assert len(suggestions) == 2
    assert suggestions[0]["exercise"]["id"] == squat_id  # Higher volume first
    assert suggestions[1]["exercise"]["id"] == curl_id


async def test_exercise_suggestion_reasons(
    auth_client: AsyncClient, cycle: dict
):
    """Volume thresholds map to correct suggestion_reason strings."""
    r = await auth_client.post(
        "/api/exercises", json={"name": "Heavy", "muscle_group": "legs", "category": "weighted"}
    )
    heavy_id = r.json()["id"]

    # Create volume > 50000
    await _create_and_complete_session(
        auth_client, cycle["id"], heavy_id,
        [{"set_number": 1, "reps": 100, "weight": 600.0}],  # 60000 total
    )

    r = await auth_client.get("/api/suggestions/exercises")
    suggestions = r.json()
    heavy = next(s for s in suggestions if s["exercise"]["id"] == heavy_id)
    assert "High volume" in heavy["suggestion_reason"]


async def test_exercise_suggestions_excludes_incomplete_sessions(
    auth_client: AsyncClient, cycle: dict, exercise: dict
):
    """Sessions that are not completed should not count toward suggestions."""
    # Create session with sets but don't complete it
    sr = await auth_client.post(
        "/api/sessions",
        json={"name": "Incomplete", "meso_cycle_id": cycle["id"], "scheduled_date": "2026-04-04"},
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
        json={"set_number": 1, "reps": 10, "weight": 100.0},
    )
    await auth_client.put(
        f"/api/sessions/exercise-sets/{r.json()['id']}", json={"is_completed": True}
    )
    # Do NOT complete the session

    r = await auth_client.get("/api/suggestions/exercises")
    assert r.json() == []


# ── Muscle group volume ───────────────────────────────────────────────────────

async def test_muscle_group_volume_empty(auth_client: AsyncClient):
    r = await auth_client.get("/api/suggestions/muscle-groups")
    assert r.status_code == 200
    assert r.json() == {}


async def test_muscle_group_volume_aggregates(
    auth_client: AsyncClient, cycle: dict
):
    chest_ex = (await auth_client.post(
        "/api/exercises", json={"name": "Bench", "muscle_group": "chest", "category": "weighted"}
    )).json()
    back_ex = (await auth_client.post(
        "/api/exercises", json={"name": "Row", "muscle_group": "back", "category": "weighted"}
    )).json()

    await _create_and_complete_session(
        auth_client, cycle["id"], chest_ex["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0}],
    )
    await _create_and_complete_session(
        auth_client, cycle["id"], back_ex["id"],
        [{"set_number": 1, "reps": 10, "weight": 80.0}],
    )

    r = await auth_client.get("/api/suggestions/muscle-groups")
    data = r.json()
    assert "chest" in data
    assert data["chest"] == 1000  # 10 * 100
    assert "back" in data
    assert data["back"] == 800  # 10 * 80


async def test_muscle_group_volume_user_isolation(
    auth_client: AsyncClient,
    second_auth_client: AsyncClient,
    cycle: dict,
):
    chest_ex = (await auth_client.post(
        "/api/exercises", json={"name": "Bench", "muscle_group": "chest", "category": "weighted"}
    )).json()
    await _create_and_complete_session(
        auth_client, cycle["id"], chest_ex["id"],
        [{"set_number": 1, "reps": 10, "weight": 100.0}],
    )

    r = await second_auth_client.get("/api/suggestions/muscle-groups")
    assert r.json() == {}
