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
    ]
    for stmt in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception:
            pass  # Column already exists
