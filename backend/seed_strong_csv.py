import asyncio
import csv
import uuid
from collections import defaultdict
from datetime import datetime

from sqlalchemy import select

from app.database import async_session, init_db
from app.models.models import Exercise, ExerciseSet, SessionExercise, TrainingSession, User

DEFAULT_USER_ID = '8cb5dd7a-f6f3-4dbc-8ad0-ecfdb4fcd7e6'
CSV_PATH = 'strong_workouts.csv'


def parse_duration_minutes(s):
    """'36min' -> 36"""
    if not s:
        return None
    s = s.strip().replace('min', '')
    try:
        return int(s)
    except ValueError:
        return None


async def seed():
    await init_db()

    async with async_session() as session:
        # Verify user exists
        result = await session.execute(select(User).where(User.id == DEFAULT_USER_ID))
        if not result.scalar_one_or_none():
            print(f"User {DEFAULT_USER_ID} not found — run seed.py first")
            return

        # Load all existing exercises into a name->id map (case-insensitive)
        result = await session.execute(select(Exercise))
        existing_exercises = result.scalars().all()
        exercise_map = {ex.name.lower(): ex.id for ex in existing_exercises}

        # Check for already-imported sessions (by name + date) to allow reruns
        result = await session.execute(
            select(TrainingSession).where(TrainingSession.user_id == DEFAULT_USER_ID)
        )
        existing_sessions = {
            (s.name, s.actual_date) for s in result.scalars().all()
        }

        # Parse CSV — group rows by (date, workout_name)
        workouts = defaultdict(list)
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (row['Date'], row['Workout Name'].strip(), row['Duration'].strip())
                workouts[key].append(row)

        new_exercises_created = 0
        sessions_imported = 0
        sessions_skipped = 0

        for (date_str, workout_name, duration_str), rows in sorted(workouts.items()):
            # Parse date
            try:
                dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                actual_date = dt.strftime('%Y-%m-%d')
            except ValueError:
                actual_date = date_str[:10]

            # Skip if already imported
            if (workout_name, actual_date) in existing_sessions:
                sessions_skipped += 1
                continue

            # Calculate total volume from this workout
            total_volume = 0.0

            # Group rows by exercise name (preserving order)
            exercise_rows = defaultdict(list)
            exercise_order = []
            for row in rows:
                ex_name = row['Exercise Name'].strip()
                if ex_name not in exercise_order:
                    exercise_order.append(ex_name)
                exercise_rows[ex_name].append(row)

            # Create TrainingSession
            ts = TrainingSession(
                id=str(uuid.uuid4()),
                user_id=DEFAULT_USER_ID,
                name=workout_name,
                actual_date=actual_date,
                scheduled_date=actual_date,
                status='completed',
                notes=rows[0].get('Workout Notes', '').strip() or None,
                start_time=dt,
            )
            session.add(ts)
            await session.flush()

            for ex_idx, ex_name in enumerate(exercise_order):
                ex_key = ex_name.lower()

                # Create exercise if it doesn't exist
                if ex_key not in exercise_map:
                    new_ex = Exercise(
                        id=str(uuid.uuid4()),
                        name=ex_name,
                        muscle_group='other',
                        description=f'Imported from Strong app',
                    )
                    session.add(new_ex)
                    await session.flush()
                    exercise_map[ex_key] = new_ex.id
                    new_exercises_created += 1

                se = SessionExercise(
                    id=str(uuid.uuid4()),
                    session_id=ts.id,
                    exercise_id=exercise_map[ex_key],
                    order_index=ex_idx,
                )
                session.add(se)
                await session.flush()

                set_number = 0
                for row in exercise_rows[ex_name]:
                    # Skip rest timer rows
                    set_order = row['Set Order'].strip()
                    if set_order.lower() == 'rest timer':
                        continue

                    try:
                        set_number = int(set_order)
                    except ValueError:
                        set_number += 1

                    weight = float(row['Weight']) if row['Weight'] else 0.0
                    reps = int(float(row['Reps'])) if row['Reps'] else 0
                    rpe_val = row.get('RPE', '').strip()
                    rpe = float(rpe_val) if rpe_val else None

                    total_volume += weight * reps

                    es = ExerciseSet(
                        id=str(uuid.uuid4()),
                        session_exercise_id=se.id,
                        set_number=set_number,
                        reps=reps,
                        weight=weight,
                        rpe=rpe,
                        is_completed=True,
                    )
                    session.add(es)

            ts.total_volume = total_volume
            sessions_imported += 1

        await session.commit()

    print(f"Done!")
    print(f"  Sessions imported : {sessions_imported}")
    print(f"  Sessions skipped  : {sessions_skipped} (already in DB)")
    print(f"  New exercises     : {new_exercises_created}")


if __name__ == '__main__':
    asyncio.run(seed())
