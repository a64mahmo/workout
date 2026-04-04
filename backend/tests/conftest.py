"""
Shared test fixtures for the workout API.

Strategy:
- Use SQLite in-memory (per-test fresh state via drop/create).
- Modules that call `async_session()` directly (auth, exercises, meso_cycles,
  suggestions) have their local `async_session` reference patched in each test.
- Modules that use `Depends(get_db)` (sessions, plans) are handled via
  FastAPI's dependency_overrides.
- The rate-limiter dict in auth is cleared before every test.
"""
import os
import pytest
import pytest_asyncio
import asyncio

# Must be set BEFORE any app module is imported so the engine is built with
# the right URL.  pytest collects conftest.py before test files, so this runs
# first as long as no test file imports app code at module level.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_workout.db")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import Base, get_db
import app.database as db_module
import app.api.auth as auth_module
import app.api.exercises as exercises_module
import app.api.meso_cycles as meso_module
import app.api.suggestions as suggestions_module

TEST_DB_URL = "sqlite+aiosqlite:///./test_workout.db"

# One engine for the entire session
_test_engine = create_async_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(_test_engine.sync_engine, "connect")
def _set_pragma(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


_TestSession = async_sessionmaker(
    _test_engine, class_=AsyncSession, expire_on_commit=False
)


# ── DB reset ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(autouse=True)
async def reset_db():
    """Drop + recreate every table and patch session makers before each test."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # Patch all modules that call async_session() directly
    db_module.async_session = _TestSession
    auth_module.async_session = _TestSession
    exercises_module.async_session = _TestSession
    meso_module.async_session = _TestSession
    suggestions_module.async_session = _TestSession

    # Override Depends(get_db) for sessions & plans routers
    async def _override_get_db():
        async with _TestSession() as db:
            yield db

    app.dependency_overrides[get_db] = _override_get_db

    # Clear rate-limiter state between tests
    auth_module._login_attempts.clear()

    yield

    app.dependency_overrides.clear()


# ── HTTP clients ──────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client():
    """Unauthenticated async HTTP client (no cookie)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_client():
    """Separate authenticated client (registers its own user, owns its cookie)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/api/auth/register",
            json={"email": "user@test.com", "name": "Test User", "password": "password123"},
        )
        assert r.status_code == 200, r.text
        yield ac


@pytest_asyncio.fixture
async def second_auth_client():
    """A second authenticated client (different user) for isolation tests."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/api/auth/register",
            json={"email": "other@test.com", "name": "Other User", "password": "password123"},
        )
        assert r.status_code == 200, r.text
        yield ac


# ── Domain-level fixtures ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def exercise(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={"name": "Bench Press", "muscle_group": "chest", "category": "weighted"},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest_asyncio.fixture
async def bodyweight_exercise(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/exercises",
        json={"name": "Pull-up", "muscle_group": "back", "category": "bodyweight"},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest_asyncio.fixture
async def cycle(auth_client: AsyncClient):
    r = await auth_client.post(
        "/api/meso-cycles",
        json={
            "name": "Hypertrophy Block",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "goal": "hypertrophy",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest_asyncio.fixture
async def session_obj(auth_client: AsyncClient, cycle: dict):
    r = await auth_client.post(
        "/api/sessions",
        json={
            "name": "Push Day",
            "meso_cycle_id": cycle["id"],
            "scheduled_date": "2026-04-04",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest_asyncio.fixture
async def started_session(auth_client: AsyncClient, session_obj: dict):
    r = await auth_client.post(f"/api/sessions/{session_obj['id']}/start")
    assert r.status_code == 200, r.text
    return session_obj


@pytest_asyncio.fixture
async def session_with_sets(
    auth_client: AsyncClient, started_session: dict, exercise: dict
):
    """A started session that has one exercise with 3 completed working sets."""
    sid = started_session["id"]

    # Add exercise to session
    r = await auth_client.post(
        f"/api/sessions/{sid}/exercises",
        json={"exercise_id": exercise["id"], "order_index": 0},
    )
    assert r.status_code == 200, r.text
    se = r.json()
    se_id = se["id"]

    sets_data = [
        {"set_number": 1, "reps": 10, "weight": 100.0, "rpe": 7.0, "is_warmup": False},
        {"set_number": 2, "reps": 10, "weight": 105.0, "rpe": 7.5, "is_warmup": False},
        {"set_number": 3, "reps": 8, "weight": 110.0, "rpe": 8.0, "is_warmup": False},
    ]
    set_ids = []
    for s in sets_data:
        r = await auth_client.post(
            f"/api/sessions/session-exercises/{se_id}/sets", json=s
        )
        assert r.status_code == 200, r.text
        set_ids.append(r.json()["id"])

    # Mark all sets as completed
    for sid_set in set_ids:
        r = await auth_client.put(
            f"/api/sessions/exercise-sets/{sid_set}",
            json={"is_completed": True},
        )
        assert r.status_code == 200, r.text

    return {"session": started_session, "se_id": se_id, "set_ids": set_ids, "exercise": exercise}
