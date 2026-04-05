import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, text

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

    # Run each migration in its own transaction so a failure (column already
    # exists) doesn't abort the rest — especially important for PostgreSQL.
    migrations = [
        "ALTER TABLE health_metrics ADD COLUMN steps INTEGER",
        "ALTER TABLE health_metrics ADD COLUMN resting_hr INTEGER",
        "ALTER TABLE health_metrics ADD COLUMN fitbit_synced_at TIMESTAMP",
        "ALTER TABLE exercises ADD COLUMN category TEXT DEFAULT 'weighted'",
        "ALTER TABLE plan_sessions ADD COLUMN week_number INTEGER DEFAULT 1",
        "ALTER TABLE suggestion_logs ADD COLUMN actual_weight REAL",
        "ALTER TABLE suggestion_logs ADD COLUMN actual_reps INTEGER",
        "ALTER TABLE suggestion_logs ADD COLUMN actual_rpe REAL",
        "ALTER TABLE training_sessions ADD COLUMN plan_session_id TEXT REFERENCES plan_sessions(id)",
        "ALTER TABLE exercises ADD COLUMN user_id TEXT REFERENCES users(id)",
    ]
    for stmt in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception:
            pass  # Column already exists


async def migrate_exercise_ownership() -> None:
    """
    One-time background migration: copy global exercises (user_id IS NULL)
    to each user and re-key all references. Safe to run multiple times.
    """
    import uuid as _uuid
    import logging as _logging
    log = _logging.getLogger(__name__)
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
                        new_id = str(_uuid.uuid4())
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
