import pytest
import pytest_asyncio
import uuid
from datetime import datetime
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models.models import User, Exercise, TrainingSession, SessionExercise, ExerciseSet, MesoCycle, SuggestionLog
from app.api.auth import _create_token

# Use in-memory SQLite for tests
DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

@pytest_asyncio.fixture(scope="function")
async def db_session():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async with TestingSessionLocal() as session:
        yield session
        
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture(scope="function")
async def client(db_session):
    async def override_get_db():
        yield db_session
    
    # We also need to override the session used in the actual API calls if they don't use get_db
    # Looking at the code, many routes use 'async_session' directly from database.py.
    # This is a common pattern in this codebase. We'll need to patch it.
    import app.api.auth as auth_api
    import app.api.exercises as exercises_api
    import app.api.suggestions as suggestions_api
    import app.api.sessions as sessions_api
    
    # Patch the async_session in the modules
    old_session = auth_api.async_session
    auth_api.async_session = TestingSessionLocal
    exercises_api.async_session = TestingSessionLocal
    suggestions_api.async_session = TestingSessionLocal
    sessions_api.async_session = TestingSessionLocal
    
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    
    auth_api.async_session = old_session
    exercises_api.async_session = old_session
    suggestions_api.async_session = old_session
    sessions_api.async_session = old_session
    app.dependency_overrides.clear()

@pytest_asyncio.fixture
async def test_user(db_session):
    user_id = str(uuid.uuid4())
    user = User(
        id=user_id,
        email=f"test_{user_id}@example.com",
        name="Test User",
        hashed_password="fakehashedpassword"
    )
    db_session.add(user)
    await db_session.commit()
    return user

@pytest.fixture
def auth_headers(test_user):
    token = _create_token(test_user.id)
    # The app uses cookies for auth, but let's see if we can pass it in headers or set cookie
    return {"Cookie": f"access_token={token}"}

@pytest.mark.asyncio
async def test_create_exercise(client, auth_headers):
    payload = {
        "name": "Test Bench Press",
        "muscle_group": "chest",
        "category": "weighted",
        "description": "A test exercise"
    }
    response = await client.post("/api/exercises", json=payload, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Bench Press"
    assert data["category"] == "weighted"

@pytest.mark.asyncio
async def test_create_bodyweight_exercise(client, auth_headers):
    payload = {
        "name": "Test Pushups",
        "muscle_group": "chest",
        "category": "bodyweight",
        "description": "A bodyweight exercise"
    }
    response = await client.post("/api/exercises", json=payload, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["category"] == "bodyweight"

@pytest.mark.asyncio
async def test_suggestion_logic_progression(client, db_session, test_user, auth_headers):
    # 1. Setup an exercise
    ex_id = str(uuid.uuid4())
    exercise = Exercise(id=ex_id, name="Squat", muscle_group="legs", category="weighted")
    db_session.add(exercise)
    
    # 2. Setup a past session with RPE 7 (Optimal Range)
    session_id = str(uuid.uuid4())
    ts = TrainingSession(
        id=session_id,
        user_id=test_user.id,
        name="Leg Day",
        status="completed",
        scheduled_date="2026-03-01"
    )
    db_session.add(ts)
    
    se_id = str(uuid.uuid4())
    se = SessionExercise(id=se_id, session_id=session_id, exercise_id=ex_id)
    db_session.add(se)
    
    # Add a top set: 100lbs for 10 reps @ RPE 7
    es = ExerciseSet(
        id=str(uuid.uuid4()),
        session_exercise_id=se_id,
        set_number=1,
        reps=10,
        weight=100.0,
        rpe=7.0,
        is_completed=True,
        is_warmup=False
    )
    db_session.add(es)
    await db_session.commit()
    
    # 3. Get suggestion
    response = await client.get(f"/api/suggestions/weight?exercise_id={ex_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    
    # RP Logic: RPE 7 is optimal -> +2.5lbs
    assert data["suggested_weight"] == 102.5
    assert "RPE 7.0 — in the zone, progress +2.5 lbs" in data["adjustment_reason"]

@pytest.mark.asyncio
async def test_suggestion_logic_high_rpe_hold(client, db_session, test_user, auth_headers):
    ex_id = str(uuid.uuid4())
    exercise = Exercise(id=ex_id, name="Shoulder Press", muscle_group="shoulders")
    db_session.add(exercise)
    
    session_id = str(uuid.uuid4())
    ts = TrainingSession(id=session_id, user_id=test_user.id, name="Push Day", status="completed", scheduled_date="2026-03-01")
    db_session.add(ts)
    
    se_id = str(uuid.uuid4())
    se = SessionExercise(id=se_id, session_id=session_id, exercise_id=ex_id)
    db_session.add(se)
    
    # Top set: 50lbs @ RPE 9.2 (High Effort)
    db_session.add(ExerciseSet(
        session_exercise_id=se_id, set_number=1, reps=8, weight=50.0, rpe=9.2, is_completed=True, is_warmup=False
    ))
    await db_session.commit()
    
    response = await client.get(f"/api/suggestions/weight?exercise_id={ex_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    
    # RP Logic: RPE 9+ -> Hold weight, aim for reps
    assert data["suggested_weight"] == 50.0
    assert "hold at 50.0 lbs and aim for 9+ reps" in data["adjustment_reason"]

@pytest.mark.asyncio
async def test_suggestion_logic_very_high_rpe_backoff(client, db_session, test_user, auth_headers):
    ex_id = str(uuid.uuid4())
    exercise = Exercise(id=ex_id, name="Deadlift", muscle_group="back")
    db_session.add(exercise)
    
    session_id = str(uuid.uuid4())
    ts = TrainingSession(id=session_id, user_id=test_user.id, name="Back Day", status="completed", scheduled_date="2026-03-01")
    db_session.add(ts)
    
    se_id = str(uuid.uuid4())
    se = SessionExercise(id=se_id, session_id=session_id, exercise_id=ex_id)
    db_session.add(se)
    
    # Top set: 300lbs @ RPE 10 (Failure)
    db_session.add(ExerciseSet(
        session_exercise_id=se_id, set_number=1, reps=3, weight=300.0, rpe=10.0, is_completed=True, is_warmup=False
    ))
    await db_session.commit()
    
    response = await client.get(f"/api/suggestions/weight?exercise_id={ex_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    
    # RP Logic: RPE 9.5+ -> Back off 5%
    # 300 * 0.95 = 285
    assert data["suggested_weight"] == 285.0
    assert "back off ~5% to recover quality reps" in data["adjustment_reason"]

@pytest.mark.asyncio
async def test_suggestion_meso_cycle_isolation(client, db_session, test_user, auth_headers):
    ex_id = str(uuid.uuid4())
    exercise = Exercise(id=ex_id, name="Curl", muscle_group="biceps")
    db_session.add(exercise)
    
    meso_1 = MesoCycle(id="meso_1", user_id=test_user.id, name="Meso 1")
    meso_2 = MesoCycle(id="meso_2", user_id=test_user.id, name="Meso 2")
    db_session.add_all([meso_1, meso_2])
    
    # Meso 1: Heavy curls (40lbs)
    ts1 = TrainingSession(id="ts1", user_id=test_user.id, name="Meso 1 Session", meso_cycle_id="meso_1", status="completed", scheduled_date="2026-01-01")
    db_session.add(ts1)
    se1 = SessionExercise(id="se1", session_id="ts1", exercise_id=ex_id)
    db_session.add(se1)
    db_session.add(ExerciseSet(session_exercise_id="se1", set_number=1, reps=8, weight=40.0, rpe=7.0, is_completed=True))
    
    # Meso 2: Light curls (20lbs)
    ts2 = TrainingSession(id="ts2", user_id=test_user.id, name="Meso 2 Session", meso_cycle_id="meso_2", status="completed", scheduled_date="2026-02-01")
    db_session.add(ts2)
    se2 = SessionExercise(id="se2", session_id="ts2", exercise_id=ex_id)
    db_session.add(se2)
    db_session.add(ExerciseSet(session_exercise_id="se2", set_number=1, reps=15, weight=20.0, rpe=7.0, is_completed=True))
    
    await db_session.commit()
    
    # Query for Meso 2 only
    response = await client.get(f"/api/suggestions/weight?exercise_id={ex_id}&meso_cycle_id=meso_2", headers=auth_headers)
    data = response.json()
    
    # Should suggest based on Meso 2 (20lbs), not Meso 1 (40lbs)
    assert data["previous_weight"] == 20.0
    assert data["suggested_weight"] == 22.5

@pytest.mark.asyncio
async def test_suggestion_log_creation(client, db_session, test_user, auth_headers):
    ex_id = str(uuid.uuid4())
    db_session.add(Exercise(id=ex_id, name="Dips", muscle_group="triceps"))
    
    ts = TrainingSession(id="ts_log", user_id=test_user.id, name="Log Session", status="completed", scheduled_date="2026-03-01")
    db_session.add(ts)
    se = SessionExercise(id="se_log", session_id="ts_log", exercise_id=ex_id)
    db_session.add(se)
    db_session.add(ExerciseSet(session_exercise_id="se_log", set_number=1, reps=10, weight=50.0, rpe=8.0, is_completed=True))
    await db_session.commit()
    
    # Trigger suggestion
    response = await client.get(f"/api/suggestions/weight?exercise_id={ex_id}", headers=auth_headers)
    log_id = response.json()["log_id"]
    
    # Record outcome
    outcome_payload = {
        "actual_weight": 52.5,
        "actual_reps": 11,
        "actual_rpe": 8.5
    }
    patch_resp = await client.patch(f"/api/suggestions/weight/history/{log_id}", json=outcome_payload, headers=auth_headers)
    assert patch_resp.status_code == 200
    
    # Verify in history
    hist_resp = await client.get(f"/api/suggestions/weight/history?exercise_id={ex_id}", headers=auth_headers)
    history = hist_resp.json()
    assert len(history) > 0
    assert history[0]["actual_weight"] == 52.5
    assert history[0]["actual_reps"] == 11
    assert history[0]["actual_rpe"] == 8.5
