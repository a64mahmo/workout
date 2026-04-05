import os
import uuid
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, text

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./workout.db")

# Convert postgresql:// to postgresql+asyncpg:// if needed
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

is_sqlite = "sqlite" in DATABASE_URL

connect_args = {"check_same_thread": False} if is_sqlite else {}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
)

if is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()

async def get_db():
    async with async_session() as session:
        yield session

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def migrate_exercise_ownership() -> None:
    """
    One-time background migration: copy global exercises (user_id IS NULL)
    to each user and re-key all references. Safe to run multiple times.
    """
    try:
        async with engine.begin() as conn:
            global_exs = (await conn.execute(text(
                "SELECT id, name, muscle_group, category, description, created_at "
                "FROM exercises WHERE user_id IS NULL"
            ))).fetchall()

            if not global_exs:
                return

            users = (await conn.execute(text("SELECT id FROM users"))).fetchall()
            log.info(f"Migrating {len(global_exs)} global exercises for {len(users)} users...")

            for (uid,) in users:
                for old_id, name, mg, cat, desc, created in global_exs:
                    existing = (await conn.execute(text(
                        "SELECT id FROM exercises WHERE user_id = :uid AND name = :name"
                    ), {"uid": uid, "name": name})).fetchone()

                    if existing:
                        new_id = existing[0]
                    else:
                        new_id = str(uuid.uuid4())
                        await conn.execute(text(
                            "INSERT INTO exercises (id, user_id, name, muscle_group, category, description, created_at) "
                            "VALUES (:id, :uid, :name, :mg, :cat, :desc, :created)"
                        ), {"id": new_id, "uid": uid, "name": name, "mg": mg,
                            "cat": cat or "weighted", "desc": desc, "created": created})

                    await conn.execute(text(
                        "UPDATE session_exercises SET exercise_id = :new "
                        "WHERE exercise_id = :old AND session_id IN "
                        "(SELECT id FROM training_sessions WHERE user_id = :uid)"
                    ), {"new": new_id, "old": old_id, "uid": uid})

                    await conn.execute(text(
                        "UPDATE plan_exercises SET exercise_id = :new "
                        "WHERE exercise_id = :old AND plan_session_id IN "
                        "(SELECT ps.id FROM plan_sessions ps "
                        " JOIN plans p ON ps.plan_id = p.id WHERE p.user_id = :uid)"
                    ), {"new": new_id, "old": old_id, "uid": uid})

                    await conn.execute(text(
                        "UPDATE suggestion_logs SET exercise_id = :new "
                        "WHERE exercise_id = :old AND user_id = :uid"
                    ), {"new": new_id, "old": old_id, "uid": uid})

                    await conn.execute(text(
                        "UPDATE volume_history SET exercise_id = :new "
                        "WHERE exercise_id = :old AND user_id = :uid"
                    ), {"new": new_id, "old": old_id, "uid": uid})

            for (old_id, *_) in global_exs:
                still_ref = (await conn.execute(text(
                    "SELECT 1 FROM session_exercises WHERE exercise_id = :id LIMIT 1"
                ), {"id": old_id})).fetchone()
                if not still_ref:
                    await conn.execute(text(
                        "DELETE FROM exercises WHERE id = :id AND user_id IS NULL"
                    ), {"id": old_id})

            log.info("Exercise ownership migration complete.")
    except Exception as e:
        log.warning(f"Exercise ownership migration failed (will retry next restart): {e}")


async def migrate_volume_history() -> None:
    """
    Backfill VolumeHistory for all completed sessions that are missing it.
    Uses SQLAlchemy Core for cross-DB compatibility (SQLite/Postgres).
    """
    from .models.models import TrainingSession, VolumeHistory, SessionExercise, ExerciseSet
    from sqlalchemy import select, insert, func

    try:
        async with async_session() as session:
            # 1. Find completed sessions missing volume history
            # Using a subquery for 'NOT IN' is safe and cross-compatible
            subq = select(VolumeHistory.session_id).distinct()
            stmt = (
                select(TrainingSession.id, TrainingSession.user_id)
                .where(TrainingSession.status == 'completed')
                .where(TrainingSession.id.not_in(subq))
            )
            result = await session.execute(stmt)
            sessions_to_migrate = result.all()

            if not sessions_to_migrate:
                return

            log.info(f"Backfilling volume history for {len(sessions_to_migrate)} sessions...")

            for sid, uid in sessions_to_migrate:
                # 2. Calculate volume per exercise for this session
                # SQLAlchemy handles the boolean comparison (is_completed=True) 
                # correctly for both SQLite (1) and Postgres (TRUE).
                vol_stmt = (
                    select(
                        SessionExercise.exercise_id,
                        func.sum(ExerciseSet.reps * ExerciseSet.weight).label("volume")
                    )
                    .join(ExerciseSet, SessionExercise.id == ExerciseSet.session_exercise_id)
                    .where(SessionExercise.session_id == sid)
                    .where(ExerciseSet.is_completed == True)
                    .where(ExerciseSet.is_warmup == False)
                    .where(ExerciseSet.reps != None)
                    .where(ExerciseSet.weight != None)
                    .group_by(SessionExercise.exercise_id)
                    .having(func.sum(ExerciseSet.reps * ExerciseSet.weight) > 0)
                )
                vol_result = await session.execute(vol_stmt)
                exercise_volumes = vol_result.all()

                for eid, vol in exercise_volumes:
                    # 3. Insert the summary record
                    await session.execute(
                        insert(VolumeHistory).values(
                            id=str(uuid.uuid4()),
                            user_id=uid,
                            exercise_id=eid,
                            session_id=sid,
                            total_volume=float(vol),
                            calculated_at=datetime.utcnow()
                        )
                    )
            
            await session.commit()
            log.info("Volume history backfill complete.")
    except Exception as e:
        log.warning(f"Volume history backfill failed: {e}")
        # rollback is handled by the async_session context manager on error
