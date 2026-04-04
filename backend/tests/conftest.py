"""
Shared test fixtures for the workout backend test suite.

All tests use an in-memory SQLite database that is created fresh per test
function and torn down afterwards.

Sessions router uses get_db (dependency injection).
Auth / exercises / meso_cycles routers use async_session directly from
app.database, so we patch those module-level references as well.
"""

import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models.models import User, Exercise, MesoCycle, TrainingSession, SessionExercise, ExerciseSet
from app.api.auth import _create_token

# ── In-memory database ──────────────────────────────────────────────────────
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


# ── Database fixture ─────────────────────────────────────────────────────────
@pytest_asyncio.fixture(scope="function")
async def db_session():
    """Fresh schema + session per test; schema is dropped after the test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ── HTTP client fixture ───────────────────────────────────────────────────────
@pytest_asyncio.fixture(scope="function")
async def client(db_session):
    """
    AsyncClient wired to the test app.

    * Overrides get_db so session-based routes use the test session.
    * Patches async_session in auth / exercises / meso_cycles modules so
      their direct async_session() calls also hit the test database.
    """

    async def override_get_db():
        yield db_session

    import app.api.auth as auth_api
    import app.api.exercises as exercises_api
    import app.api.meso_cycles as meso_api
    import app.api.suggestions as suggestions_api

    original = auth_api.async_session
    auth_api.async_session = TestingSessionLocal
    exercises_api.async_session = TestingSessionLocal
    meso_api.async_session = TestingSessionLocal
    suggestions_api.async_session = TestingSessionLocal

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    auth_api.async_session = original
    exercises_api.async_session = original
    meso_api.async_session = original
    suggestions_api.async_session = original
    app.dependency_overrides.clear()


# ── User / auth fixtures ─────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def test_user(db_session):
    """A committed User row ready for use in tests."""
    user = User(
        id=str(uuid.uuid4()),
        email=f"test_{uuid.uuid4().hex[:8]}@example.com",
        name="Test User",
        hashed_password="fakehash",
    )
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.fixture
def auth_headers(test_user):
    """Cookie header containing a valid JWT for test_user."""
    token = _create_token(test_user.id)
    return {"Cookie": f"access_token={token}"}


# ── Convenience factories ────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def test_exercise(db_session):
    """A committed Exercise row."""
    ex = Exercise(
        id=str(uuid.uuid4()),
        name="Bench Press",
        muscle_group="chest",
        category="weighted",
    )
    db_session.add(ex)
    await db_session.commit()
    return ex


@pytest_asyncio.fixture
async def test_cycle(db_session, test_user):
    """A committed MesoCycle row belonging to test_user."""
    cycle = MesoCycle(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        name="Test Cycle",
        is_active=True,
    )
    db_session.add(cycle)
    await db_session.commit()
    return cycle


@pytest_asyncio.fixture
async def test_session(db_session, test_user, test_cycle):
    """A committed TrainingSession belonging to test_user."""
    ts = TrainingSession(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        meso_cycle_id=test_cycle.id,
        name="Push Day",
        scheduled_date="2026-04-01",
        status="scheduled",
    )
    db_session.add(ts)
    await db_session.commit()
    return ts
