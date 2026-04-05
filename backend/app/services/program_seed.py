"""
Service for seeding default programs for a user.
Called automatically on registration and can be invoked via CLI.
"""
import re
import sys
import os
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models.models import Plan, PlanSession, PlanExercise, Exercise

# Load data from the existing seed scripts at backend root
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from seed_powerbuilding import exercises_to_add as _EXERCISES  # noqa: E402
from seed_powerbuilding_all import all_sessions as _WEEKS_2_12  # noqa: E402

# Week 1 sessions (extracted from seed_powerbuilding.py — same (week, name, exercises) format)
_WEEK_1_SESSIONS = [
    ("Week 1", "FULL BODY 1", [
        ("Back squat", 4, 2, 82.5, 7, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Front squat", 0, 8, None, 7, 180, "If you low bar squat, do front squat. If you high bar squat, do barbell box squat"),
        ("Barbell bench press", 4, 4, 80, 8.5, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Barbell bench press", 0, 6, 75, 7, 90, "Submaximal bench press, be hypercritical of form"),
        ("Weighted pull-up", 1, 6, None, 8, 90, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Glute-ham raise", 1, 8, None, 7, 90, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Seated face pull", 0, 20, None, 9, 90, "Don't go too heavy, focus on mind-muscle connection"),
    ]),
    ("Week 1", "FULL BODY 2", [
        ("Deadlift", 4, 4, 80, 7, 240, "Technique work, avoid turning these into touch-and-go reps"),
        ("Barbell overhead press", 3, 5, 75, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Bulgarian split squat", 1, 10, None, 9, 150, "Start with your weaker leg working. Squat deep"),
        ("Meadows row", 1, 15, None, 8, 150, "Brace with your other hand, stay light, emphasize form"),
        ("Barbell or EZ bar curl", 1, 10, None, 8, 90, "Use minimal momentum, control the eccentric phase"),
        ("Pec flye", 1, 15, None, 8, 90, "Perform with cables, bands, or dumbbells. Use full ROM. Stretch your pecs at the bottom"),
    ]),
    ("Week 1", "FULL BODY 3", [
        ("Back squat", 4, 6, 75, 7, 180, "Sit back and down, keep your upper back tight to the bar"),
        ("Pin squat", 0, 4, 70, 8, 180, "Set the pins to around parallel. Dead stop on the pins, don't bounce and go"),
        ("Barbell bench press", 4, 1, 90, 8, 180, "Working top set, build confidence with heavier loads"),
        ("Barbell bench press", 0, 5, 80, 8, 180, "Focus on perfecting technique, slight pause on the chest"),
        ("Barbell bench press", 0, 10, 65, 8, 180, "Try to stay fluid with these, think of them as 'pause-and-go'"),
        ("Chin-up", 1, 0, None, 8, 180, "As many reps as possible, but stop at RPE8. Enter actual reps in notes"),
        ("Single-leg hip thrust", 0, 12, None, 8, 90, "Keep your chin tucked down and squeeze your glutes to move the weight"),
        ("Cable reverse flye", 0, 15, None, 8, 90, "Keep elbows locked in place, squeeze the cable handles hard!"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 1", "FULL BODY 4", [
        ('6" Block pull', 4, 6, 90, 9, 300, "Get very tight prior to pulling, use 85% if you're not experienced with block pulls"),
        ("Pause db incline press", 3, 8, None, 8, 180, "3-second pause. Sink the dumbbells as low as you comfortably can"),
        ("Leg curl", 1, 15, None, 8, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Chest-supported row", 1, 12, None, 8, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Rope overhead triceps extension", 1, 15, None, 8, 90, "Focus on stretching the triceps at the bottom"),
        ("Egyptian lateral raise", 1, 10, None, 8, 90, "Lean away from the cable. Focus on squeezing your delts."),
    ]),
]

_ALL_SESSIONS = _WEEK_1_SESSIONS + list(_WEEKS_2_12)

PLAN_NAME = "Powerbuilding Phase 2"
PLAN_DESCRIPTION = "12-week powerbuilding program. Units: lbs. 1RM: Squat=100, Bench=100, Deadlift=100, OHP=100"


async def seed_programs_for_user(user_id: str, db: AsyncSession) -> None:
    """
    Create default programs (Plan + sessions + exercises) for a user.
    Idempotent — skips if the plan already exists for the user.
    """
    # Skip if user already has the plan
    result = await db.execute(
        select(Plan).where(Plan.name == PLAN_NAME, Plan.user_id == user_id)
    )
    if result.scalar_one_or_none():
        return

    # Ensure all exercises exist for this user and build the name→id map
    exercise_map: dict[str, str] = {}
    for ex_data in _EXERCISES:
        result = await db.execute(
            select(Exercise).where(Exercise.name == ex_data["name"], Exercise.user_id == user_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            exercise_map[ex_data["name"]] = existing.id
        else:
            new_ex = Exercise(
                id=str(uuid.uuid4()),
                user_id=user_id,
                name=ex_data["name"],
                muscle_group=ex_data["muscle_group"],
                category=ex_data.get("category", "weighted"),
                description=ex_data.get("description", ""),
            )
            db.add(new_ex)
            exercise_map[ex_data["name"]] = new_ex.id

    await db.flush()

    # Create the plan
    plan = Plan(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=PLAN_NAME,
        description=PLAN_DESCRIPTION,
    )
    db.add(plan)
    await db.flush()

    # Create all sessions + exercises
    for order_idx, (week, session_name, exercises_list) in enumerate(_ALL_SESSIONS):
        m = re.search(r'\d+', str(week))
        week_num = int(m.group()) if m else 1

        ps = PlanSession(
            id=str(uuid.uuid4()),
            plan_id=plan.id,
            name=f"{week} - {session_name}",
            week_number=week_num,
            order_index=order_idx,
        )
        db.add(ps)
        await db.flush()

        for ex_idx, (ex_name, warmup_sets, reps, weight_pct, rpe, rest, notes) in enumerate(exercises_list):
            if ex_name not in exercise_map:
                continue
            pe = PlanExercise(
                id=str(uuid.uuid4()),
                plan_session_id=ps.id,
                exercise_id=exercise_map[ex_name],
                order_index=ex_idx,
                target_sets=warmup_sets + 1,
                target_reps=reps,
                target_weight=weight_pct,
                target_rpe=rpe,
                rest_seconds=rest,
                notes=notes,
            )
            db.add(pe)

    await db.commit()
