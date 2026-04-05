import pytest
from sqlalchemy import select, text
from app.models.models import TrainingSession, VolumeHistory, SessionExercise, ExerciseSet, User, Exercise
from app.database import migrate_volume_history, async_session
import uuid
from datetime import datetime

@pytest.mark.asyncio
async def test_migrate_volume_history_backfills_missing_records():
    async with async_session() as session:
        # 1. Setup: Create a user and exercise
        user = User(
            id=str(uuid.uuid4()),
            email="migration@test.com",
            name="Migration User",
            hashed_password="hash"
        )
        exercise = Exercise(
            id=str(uuid.uuid4()),
            name="Migration Bench Press",
            muscle_group="chest"
        )
        session.add_all([user, exercise])
        await session.commit()

        # 2. Setup: Create a session with sets, marked as completed
        # We'll use raw SQL to simulate an "old" session that didn't trigger VolumeHistory logic
        session_id = str(uuid.uuid4())
        await session.execute(text(
            "INSERT INTO training_sessions (id, user_id, name, status, scheduled_date) "
            "VALUES (:id, :uid, :name, :status, :date)"
        ), {"id": session_id, "uid": user.id, "name": "Old Session", "status": "completed", "date": "2026-01-01"})

        se_id = str(uuid.uuid4())
        await session.execute(text(
            "INSERT INTO session_exercises (id, session_id, exercise_id, order_index) "
            "VALUES (:id, :sid, :eid, :idx)"
        ), {"id": se_id, "sid": session_id, "eid": exercise.id, "idx": 0})

        # Add 2 completed sets (10 reps * 100 lbs = 1000 volume each)
        for i in range(1, 3):
            await session.execute(text(
                "INSERT INTO exercise_sets (id, session_exercise_id, set_number, reps, weight, is_completed, is_warmup) "
                "VALUES (:id, :seid, :num, :reps, :weight, :comp, :warm)"
            ), {
                "id": str(uuid.uuid4()),
                "seid": se_id,
                "num": i,
                "reps": 10,
                "weight": 100.0,
                "comp": 1, # SQLite boolean literal in raw SQL
                "warm": 0
            })
        
        await session.commit()

        # Verify no VolumeHistory exists yet
        result = await session.execute(select(VolumeHistory).where(VolumeHistory.session_id == session_id))
        assert result.scalar_one_or_none() is None

    # 3. Run migration
    await migrate_volume_history()

    # 4. Verify VolumeHistory was created
    async with async_session() as session:
        result = await session.execute(select(VolumeHistory).where(VolumeHistory.session_id == session_id))
        history = result.scalar_one()
        assert history.user_id == user.id
        assert history.exercise_id == exercise.id
        assert history.total_volume == 2000.0 # 2 sets * 10 * 100

@pytest.mark.asyncio
async def test_migrate_volume_history_skips_if_already_exists():
    async with async_session() as session:
        # Setup similar to above
        user = User(id=str(uuid.uuid4()), email="skip@test.com", name="Skip User", hashed_password="hash")
        exercise = Exercise(id=str(uuid.uuid4()), name="Skip Bench Press", muscle_group="chest")
        session.add_all([user, exercise])
        await session.commit()

        session_id = str(uuid.uuid4())
        await session.execute(text(
            "INSERT INTO training_sessions (id, user_id, name, status) VALUES (:id, :uid, :name, 'completed')"
        ), {"id": session_id, "uid": user.id, "name": "Existing Session"})

        # Pre-create a VolumeHistory record
        history_id = str(uuid.uuid4())
        existing_history = VolumeHistory(
            id=history_id,
            user_id=user.id,
            exercise_id=exercise.id,
            session_id=session_id,
            total_volume=5000.0
        )
        session.add(existing_history)
        await session.commit()

    # Run migration
    await migrate_volume_history()

    # Verify no NEW record was created, and old one remains
    async with async_session() as session:
        result = await session.execute(select(VolumeHistory).where(VolumeHistory.session_id == session_id))
        records = result.scalars().all()
        assert len(records) == 1
        assert records[0].id == history_id
        assert records[0].total_volume == 5000.0
