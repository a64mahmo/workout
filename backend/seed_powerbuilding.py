import asyncio
import uuid
from sqlalchemy import select

from app.database import async_session, init_db
from app.models.models import Exercise, Plan, PlanSession, PlanExercise, User

DEFAULT_USER_ID = '8cb5dd7a-f6f3-4dbc-8ad0-ecfdb4fcd7e6'

exercises_to_add = [
    {"name": "Back squat", "muscle_group": "legs", "description": "Compound leg exercise"},
    {"name": "Front squat", "muscle_group": "legs", "description": "Quad-dominant squat variation"},
    {"name": "Box squat", "muscle_group": "legs", "description": "Squat to a box"},
    {"name": "Pin squat", "muscle_group": "legs", "description": "Squat from pins"},
    {"name": "Sissy squat", "muscle_group": "legs", "description": "Quad isolation squat"},
    {"name": "Hack squat", "muscle_group": "legs", "description": "Machine leg press variation"},
    {"name": "Unilateral leg press", "muscle_group": "legs", "description": "Single leg press"},
    {"name": "Bulgarian split squat", "muscle_group": "legs", "description": "Split squat with rear foot elevated"},
    {"name": "Single-leg hip thrust", "muscle_group": "glutes", "description": "Single leg hip thrust"},
    {"name": "Leg extension", "muscle_group": "legs", "description": "Quad isolation"},
    {"name": "Eccentric-accentuated leg extension", "muscle_group": "legs", "description": "Leg extension with 4-second lowering"},
    {"name": "Unilateral standing calf raise", "muscle_group": "legs", "description": "Single leg calf raise"},
    {"name": "Hip abduction", "muscle_group": "glutes", "description": "Hip abductor machine"},
    {"name": "L-sit hold", "muscle_group": "core", "description": "Hanging leg raise hold"},
    {"name": "Weighted crunch", "muscle_group": "core", "description": "Weighted ab crunch"},
    {"name": "Long-lever plank", "muscle_group": "core", "description": "Extended plank position"},
    {"name": "Prisoner back extension", "muscle_group": "back", "description": "Back extension hands behind head"},
    {"name": "Cable pull-through", "muscle_group": "glutes", "description": "Glute cable exercise"},
    {"name": "Glute-ham raise", "muscle_group": "hamstrings", "description": "GHR machine"},
    {"name": "Nordic ham curl", "muscle_group": "hamstrings", "description": "Eccentric hamstring exercise"},
    {"name": "Sliding leg curl", "muscle_group": "hamstrings", "description": "Slider hamstring curl"},
    {"name": "Barbell RDL", "muscle_group": "hamstrings", "description": "Romanian deadlift with barbell"},
    {"name": "Reset deadlift", "muscle_group": "back", "description": "Deadlift resetting each rep"},
    {"name": "Opposite stance deadlift", "muscle_group": "back", "description": "Sumo if normally conventional, or vice versa"},
    {"name": "6\" Block pull", "muscle_group": "back", "description": "Deadlift from 6 inch blocks"},
    {"name": "4\" Block pull", "muscle_group": "back", "description": "Deadlift from 4 inch blocks"},
    {"name": "2\" Block pull", "muscle_group": "back", "description": "Deadlift from 2 inch blocks"},
    {"name": "1\" Block pull", "muscle_group": "back", "description": "Deadlift from 1 inch blocks"},
    {"name": "Weighted pull-up", "muscle_group": "back", "description": "Pull-up with added weight"},
    {"name": "Chin-up", "muscle_group": "back", "description": "Underhand grip pull-up"},
    {"name": "Omni-grip lat pulldown", "muscle_group": "back", "description": "Various grip lat pulldown"},
    {"name": "Wide-grip lat pulldown", "muscle_group": "back", "description": "Wide grip lat pulldown"},
    {"name": "Single-arm pulldown", "muscle_group": "back", "description": "Single arm cable pulldown"},
    {"name": "Weighted neutral-grip pull-up", "muscle_group": "back", "description": "Neutral grip pull-up with weight"},
    {"name": "Weighted eccentric-overload pull-up", "muscle_group": "back", "description": "Eccentric pull-up with overload"},
    {"name": "Eccentric-accentuated pull-up", "muscle_group": "back", "description": "Pull-up with 3-second lowering"},
    {"name": "Meadows row", "muscle_group": "back", "description": "Single arm barbell row"},
    {"name": "Chest-supported row", "muscle_group": "back", "description": "Row supported on bench"},
    {"name": "Machine chest-supported row", "muscle_group": "back", "description": "Machine row with chest support"},
    {"name": "Pendlay row", "muscle_group": "back", "description": "Strict bent over row from floor"},
    {"name": "Bent over row", "muscle_group": "back", "description": "Cheat row with momentum"},
    {"name": "Seated cable row", "muscle_group": "back", "description": "Cable seated row"},
    {"name": "One-arm row", "muscle_group": "back", "description": "Dumbbell single arm row"},
    {"name": "Machine incline press", "muscle_group": "chest", "description": "Incline machine press"},
    {"name": "Pause db incline press", "muscle_group": "chest", "description": "Dumbbell incline press with 3-second pause"},
    {"name": "Pause barbell bench press", "muscle_group": "chest", "description": "Barbell bench with pause on chest"},
    {"name": "Larsen press", "muscle_group": "chest", "description": "Bench press with feet elevated"},
    {"name": "Close-grip bench press", "muscle_group": "chest", "description": "Narrow grip bench press"},
    {"name": "Deficit push-up", "muscle_group": "chest", "description": "Push-up from deficit"},
    {"name": "Dip", "muscle_group": "chest", "description": "Parallel bar dip"},
    {"name": "Pec flye", "muscle_group": "chest", "description": "Chest fly isolation"},
    {"name": "Cable reverse flye", "muscle_group": "shoulders", "description": "Rear delt cable fly"},
    {"name": "Prone trap raise", "muscle_group": "shoulders", "description": "Prone rear delt raise"},
    {"name": "Egyptian lateral raise", "muscle_group": "shoulders", "description": "Cable lateral raise"},
    {"name": "Dumbbell lateral raise 21s", "muscle_group": "shoulders", "description": "21s lateral raise"},
    {"name": "Cable reverse flye", "muscle_group": "shoulders", "description": "Cable rear delt fly"},
    {"name": "Seated face pull", "muscle_group": "shoulders", "description": "Cable face pull"},
    {"name": "Wall slide", "muscle_group": "shoulders", "description": "Shoulder stability exercise"},
    {"name": "Neck flexion/extension", "muscle_group": "neck", "description": "Neck flexion and extension"},
    {"name": "Standing calf raise", "muscle_group": "legs", "description": "Standing calf raise"},
    {"name": "Enhanced-eccentric calf raise", "muscle_group": "legs", "description": "Calf raise with unilateral eccentric"},
    {"name": "Plate shrug", "muscle_group": "traps", "description": "Barbell shrug with plate"},
    {"name": "Cable shrug-in", "muscle_group": "traps", "description": "Cable shrug inwards"},
    {"name": "Barbell or EZ bar curl", "muscle_group": "biceps", "description": "Standing barbell curl"},
    {"name": "Hammer cheat curl", "muscle_group": "biceps", "description": "Hammer curl with momentum"},
    {"name": "Incline dumbbell curl", "muscle_group": "biceps", "description": "Curl on incline bench"},
    {"name": "Inverse Zottman curl", "muscle_group": "biceps", "description": "Rotating curl variation"},
    {"name": "Constant-tension cable triceps kickback", "muscle_group": "triceps", "description": "Cable kickback with constant tension"},
    {"name": "Rope overhead triceps extension", "muscle_group": "triceps", "description": "Overhead rope triceps extension"},
    {"name": "Triceps pressdown 21s", "muscle_group": "triceps", "description": "21s triceps pressdown"},
    {"name": "Standing calf raise", "muscle_group": "legs", "description": "Standing calf raise"},
]

async def seed():
    await init_db()

    async with async_session() as session:
        result = await session.execute(select(User).where(User.id == DEFAULT_USER_ID))
        user = result.scalar_one_or_none()
        if not user:
            user = User(
                id=DEFAULT_USER_ID,
                email="default@example.com",
                name="Default User",
                hashed_password="$2b$12$placeholder_hash_for_default_user",
            )
            session.add(user)
            await session.flush()
            print("Created default user")

        exercise_map = {}
        for ex_data in exercises_to_add:
            result = await session.execute(select(Exercise).where(Exercise.name == ex_data["name"]))
            existing = result.scalar_one_or_none()
            if not existing:
                new_ex = Exercise(
                    id=str(uuid.uuid4()),
                    name=ex_data["name"],
                    muscle_group=ex_data["muscle_group"],
                    description=ex_data["description"],
                )
                session.add(new_ex)
                exercise_map[ex_data["name"]] = new_ex.id
                print(f"Added exercise: {ex_data['name']}")
            else:
                exercise_map[ex_data["name"]] = existing.id

        await session.flush()

        plan = Plan(
            id=str(uuid.uuid4()),
            user_id=DEFAULT_USER_ID,
            name="Powerbuilding Phase 2",
            description="12-week powerbuilding program. Units: lbs. 1RM: Squat=100, Bench=100, Deadlift=100, OHP=100",
        )
        session.add(plan)
        await session.flush()
        print(f"Created plan: {plan.name}")

        def add_exercise(session_id, exercise_name, order, warmup_sets, reps, weight_pct, rpe, rest, notes, is_warmup=False):
            if exercise_name not in exercise_map:
                return None
            ex_id = exercise_map[exercise_name]
            return PlanExercise(
                id=str(uuid.uuid4()),
                plan_session_id=session_id,
                exercise_id=ex_id,
                order_index=order,
                target_sets=warmup_sets + 1,
                target_reps=reps,
                target_weight=weight_pct,
                target_rpe=rpe,
                rest_seconds=rest,
                notes=notes,
            )

        sessions_data = [
            ("Week 1 - FULL BODY 1", [
                ("Back squat", 4, 2, 82.5, 7, 180, "Top set, get comfortable with heavier loads while keeping perfect technique", True),
                ("Front squat", 0, 8, None, 7, 180, "If you low bar squat, do front squat. If you high bar squat, do barbell box squat", False),
                ("Barbell bench press", 4, 4, 80, 8.5, 180, "Top set, get comfortable with heavier loads while keeping perfect technique", True),
                ("Barbell bench press", 0, 6, 75, 7, 90, "Submaximal bench press, be hypercritical of form", False),
                ("Weighted pull-up", 1, 6, None, 8, 90, "1.5x shoulder width grip, pull your chest to the bar", False),
                ("Glute-ham raise", 1, 8, None, 7, 90, "Keep your hips straight, do Nordic ham curls if no GHR machine", False),
                ("Seated face pull", 0, 20, None, 9, 90, "Don't go too heavy, focus on mind-muscle connection", False),
            ]),
            ("Week 1 - FULL BODY 2", [
                ("Deadlift", 4, 4, 80, 7, 240, "Technique work, avoid turning these into touch-and-go reps", True),
                ("Barbell overhead press", 3, 5, 75, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back", False),
                ("Bulgarian split squat", 1, 10, None, 9, 150, "Start with your weaker leg working. Squat deep", False),
                ("Meadows row", 1, 15, None, 8, 150, "Brace with your other hand, stay light, emphasize form", False),
                ("Barbell or EZ bar curl", 1, 10, None, 8, 90, "Use minimal momentum, control the eccentric phase", False),
                ("Pec flye", 1, 15, None, 8, 90, "Perform with cables, bands, or dumbbells. Use full ROM. Stretch your pecs at the bottom", False),
            ]),
            ("Week 1 - FULL BODY 3", [
                ("Back squat", 4, 6, 75, 7, 180, "Sit back and down, keep your upper back tight to the bar", True),
                ("Pin squat", 0, 4, 70, 8, 180, "Set the pins to around parallel. Dead stop on the pins, don't bounce and go", False),
                ("Barbell bench press", 4, 1, 90, 8, 180, "Working top set, build confidence with heavier loads", True),
                ("Barbell bench press", 0, 5, 80, 8, 180, "Focus on perfecting technique, slight pause on the chest", False),
                ("Barbell bench press", 0, 10, 65, 8, 180, "Try to stay fluid with these, think of them as pause-and-go", False),
                ("Chin-up", 1, 0, None, 8, 180, "As many reps as possible, but stop at RPE8. Enter actual reps in notes", False),
                ("Single-leg hip thrust", 0, 12, None, 8, 90, "Keep your chin tucked down and squeeze your glutes to move the weight", False),
                ("Cable reverse flye", 0, 15, None, 8, 90, "Keep elbows locked in place, squeeze the cable handles hard!", False),
                ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top", False),
            ]),
            ("Week 1 - FULL BODY 4", [
                ("6\" Block pull", 4, 6, 90, 9, 300, "Get very tight prior to pulling, use 85% if you're not experienced with block pulls", True),
                ("Pause db incline press", 3, 8, None, 8, 180, "3-second pause. Sink the dumbbells as low as you comfortably can", False),
                ("Leg curl", 1, 15, None, 8, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl", False),
                ("Chest-supported row", 1, 12, None, 8, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top", False),
                ("Rope overhead triceps extension", 1, 15, None, 8, 90, "Focus on stretching the triceps at the bottom", False),
                ("Egyptian lateral raise", 1, 10, None, 8, 90, "Lean away from the cable. Focus on squeezing your delts.", False),
            ]),
        ]

        for idx, (session_name, exercises) in enumerate(sessions_data):
            ps = PlanSession(
                id=str(uuid.uuid4()),
                plan_id=plan.id,
                name=session_name,
                order_index=idx,
            )
            session.add(ps)
            await session.flush()
            
            for ex_idx, (ex_name, warmup_sets, reps, weight_pct, rpe, rest, notes, is_warmup) in enumerate(exercises):
                pe = add_exercise(ps.id, ex_name, ex_idx, warmup_sets, reps, weight_pct, rpe, rest, notes, is_warmup)
                if pe:
                    session.add(pe)

        await session.commit()
        print("Powerbuilding Phase 2 plan added successfully!")

if __name__ == "__main__":
    asyncio.run(seed())
