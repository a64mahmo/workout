"""
Export users from the current database (SQLite or Postgres via DATABASE_URL)
into one JSON file per user, in the format the Cloudflare Worker's
POST /api/admin/import endpoint expects.

    DATABASE_URL=postgresql://... python export_for_cloudflare.py --out ./cf-export
    # then, per file:
    curl -X POST https://<worker>/api/admin/import \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
      --data @cf-export/<user>.json

Datetimes are normalised to naive UTC ISO strings, like the API stores them.
"""
import argparse
import asyncio
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# table -> (columns to export, SQL that scopes rows to one user via :uid)
TABLES = {
    "exercises": (
        ["id", "name", "muscle_group", "category", "description", "created_at"],
        "SELECT {cols} FROM exercises WHERE user_id = :uid",
    ),
    "meso_cycles": (
        ["id", "name", "start_date", "end_date", "goal", "is_active", "created_at"],
        "SELECT {cols} FROM meso_cycles WHERE user_id = :uid",
    ),
    "micro_cycles": (
        ["id", "meso_cycle_id", "week_number", "focus", "start_date", "end_date"],
        "SELECT {cols} FROM micro_cycles WHERE meso_cycle_id IN (SELECT id FROM meso_cycles WHERE user_id = :uid)",
    ),
    "plans": (
        ["id", "name", "description", "is_active", "created_at"],
        "SELECT {cols} FROM plans WHERE user_id = :uid",
    ),
    "plan_sessions": (
        ["id", "plan_id", "name", "week_number", "order_index", "scheduled_date", "notes"],
        "SELECT {cols} FROM plan_sessions WHERE plan_id IN (SELECT id FROM plans WHERE user_id = :uid)",
    ),
    "plan_exercises": (
        ["id", "plan_session_id", "exercise_id", "order_index", "target_sets", "target_reps",
         "target_weight", "target_rpe", "rest_seconds", "notes"],
        "SELECT {cols} FROM plan_exercises WHERE plan_session_id IN "
        "(SELECT ps.id FROM plan_sessions ps JOIN plans p ON ps.plan_id = p.id WHERE p.user_id = :uid)",
    ),
    "training_sessions": (
        ["id", "meso_cycle_id", "micro_cycle_id", "plan_session_id", "name", "scheduled_date", "actual_date",
         "status", "notes", "total_volume", "created_at", "start_time", "end_time", "average_hr", "max_hr"],
        "SELECT {cols} FROM training_sessions WHERE user_id = :uid",
    ),
    "session_exercises": (
        ["id", "session_id", "exercise_id", "order_index", "notes"],
        "SELECT {cols} FROM session_exercises WHERE session_id IN (SELECT id FROM training_sessions WHERE user_id = :uid)",
    ),
    "exercise_sets": (
        ["id", "session_exercise_id", "set_number", "reps", "weight", "rpe", "is_warmup", "is_completed"],
        "SELECT {cols} FROM exercise_sets WHERE session_exercise_id IN "
        "(SELECT se.id FROM session_exercises se JOIN training_sessions ts ON se.session_id = ts.id WHERE ts.user_id = :uid)",
    ),
    "health_metrics": (
        ["id", "session_id", "date", "sleep_duration_seconds", "sleep_score", "sleep_efficiency", "weight_kg",
         "body_fat_pct", "bmi", "steps", "resting_hr", "fitbit_synced_at", "created_at"],
        "SELECT {cols} FROM health_metrics WHERE user_id = :uid",
    ),
    "volume_history": (
        ["id", "exercise_id", "session_id", "total_volume", "calculated_at"],
        "SELECT {cols} FROM volume_history WHERE user_id = :uid",
    ),
    "suggestion_logs": (
        ["id", "exercise_id", "meso_cycle_id", "previous_weight", "average_rpe", "suggested_weight",
         "adjustment_reason", "actual_weight", "actual_reps", "actual_rpe", "created_at"],
        "SELECT {cols} FROM suggestion_logs WHERE user_id = :uid",
    ),
}


def norm(v):
    if isinstance(v, datetime):
        if v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str) and len(v) >= 19 and v[10] in "T " and v[4] == "-":
        # SQLite stores datetimes as text; normalise "YYYY-MM-DD HH:MM:SS[.ffffff][+00:00]"
        try:
            return norm(datetime.fromisoformat(v))
        except ValueError:
            return v
    return v


async def main(out_dir: str, only_email: str | None) -> None:
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./workout.db")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(url)
    os.makedirs(out_dir, exist_ok=True)
    async with engine.connect() as conn:
        q = "SELECT id, email, name, hashed_password, created_at, fitbit_access_token, fitbit_refresh_token, " \
            "fitbit_user_id, fitbit_token_expires_at FROM users"
        users = (await conn.execute(text(q + (" WHERE email = :e" if only_email else "")),
                                    {"e": only_email} if only_email else {})).mappings().all()
        for u in users:
            dump = {
                "hashed_password": u["hashed_password"],
                "profile": {k: norm(u[k]) for k in u.keys() if k != "hashed_password"},
                "tables": {},
            }
            for table, (cols, sql) in TABLES.items():
                rows = (await conn.execute(text(sql.format(cols=", ".join(cols))), {"uid": u["id"]})).mappings().all()
                dump["tables"][table] = [{c: norm(r[c]) for c in cols} for r in rows]
            path = os.path.join(out_dir, f"{u['id']}.json")
            with open(path, "w") as f:
                json.dump(dump, f)
            counts = ", ".join(f"{t}={len(r)}" for t, r in dump["tables"].items() if r)
            print(f"{u['email']} -> {path} ({counts or 'no data'})")
    await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./cf-export")
    ap.add_argument("--email", help="export only this user")
    args = ap.parse_args()
    asyncio.run(main(args.out, args.email))
