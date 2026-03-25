import asyncio
import uuid
from sqlalchemy import select

from app.database import async_session, init_db
from app.models.models import Exercise, Plan, PlanSession, PlanExercise, User

DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000'

all_sessions = [
    # WEEK 1
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
        ("6\" Block pull", 4, 6, 90, 9, 300, "Get very tight prior to pulling, use 85% if you're not experienced with block pulls"),
        ("Pause db incline press", 3, 8, None, 8, 180, "3-second pause. Sink the dumbbells as low as you comfortably can"),
        ("Leg curl", 1, 15, None, 8, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Chest-supported row", 1, 12, None, 8, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Rope overhead triceps extension", 1, 15, None, 8, 90, "Focus on stretching the triceps at the bottom"),
        ("Egyptian lateral raise", 1, 10, None, 8, 90, "Lean away from the cable. Focus on squeezing your delts."),
    ]),
    # WEEK 2
    ("Week 2", "LOWER #1", [
        ("Back squat", 3, 4, 75, 7, 240, "Submaximal sets, approach these sets with confidence. Focus on technique"),
        ("Barbell RDL", 2, 10, None, 6, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Unilateral leg press", 1, 15, None, 8, 90, "High and wide foot positioning, start with your weaker leg"),
        ("Eccentric-accentuated leg extension", 0, 12, None, 10, 150, "4-second lowering phase"),
        ("Leg curl", 0, 15, None, 10, 150, "Dropset: do 10 reps, lower the weight ~30-50%, do another 15 reps"),
        ("Standing calf raise", 1, 15, None, 8, 150, "Think about rolling back and forth on the balls of your feet"),
        ("Weighted crunch", 0, 12, None, 8, 0, "Hold a plate or DB to your chest and crunch hard!"),
        ("Long-lever plank", 0, 30, None, 8, 90, "Contract your glutes and position your elbows under your eyes to make the plank more difficult"),
    ]),
    ("Week 2", "UPPER #1", [
        ("Barbell bench press", 3, 8, 72.5, 7, 180, "Submaximal sets, focus on form"),
        ("Weighted pull-up", 2, 6, None, 9, 150, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Machine incline press", 2, 12, None, 9, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Seated cable row", 2, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Egyptian lateral raise", 0, 10, None, 10, 90, "Do 8-10 reps to failure. Rest 3-4 seconds. Do another 4 reps. Rest 2-3 seconds. Do another 4 reps"),
        ("Constant-tension cable triceps kickback", 0, 30, None, 10, 90, "Maintain a consistent pace of 1 second up and 1 second down"),
        ("Hammer cheat curl", 1, 10, None, 9, 90, "You can use slight momentum on the concentric, but control the eccentric"),
    ]),
    ("Week 2", "LOWER #2", [
        ("Reset deadlift", 4, 3, 80, 8, 240, "Stand up between each rep to work on technique"),
        ("Hack squat", 2, 12, None, 8, 180, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Single-leg hip thrust", 2, 12, None, 9, 150, "Contract your glutes hard at the top"),
        ("Glute-ham raise", 0, 8, None, 9, 0, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Prisoner back extension", 0, 20, None, 9, 90, "Place your hands behind your head and squeeze your glutes to straighten your hips"),
        ("Unilateral standing calf raise", 1, 10, None, 8, 90, "Start with your weaker side. Think about rolling back and forth on the balls of your feet"),
        ("L-sit hold", 0, 20, None, 8, 90, "Hold the top position of a hanging leg raise for the time interval given"),
    ]),
    ("Week 2", "UPPER #2", [
        ("Omni-grip lat pulldown", 2, 12, None, 8, 150, "1 set wide grip, 1 set middle grip, 1 set close grip"),
        ("Barbell overhead press", 3, 4, 80, 8, 150, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Chest-supported row", 2, 12, None, 9, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Close-grip bench press", 2, 10, None, 8, 150, "Tuck your elbows against your sides more than standard grip bench press"),
        ("Seated face pull", 0, 20, None, 9, 90, "Mind muscle connection with rear delts on set 1, mid-traps on set 2"),
        ("Dumbbell lateral raise 21s", 0, 7, None, 9, 90, "First 7 reps: top half of ROM, middle 7 reps: full ROM, last 7 reps: bottom half of ROM"),
        ("Incline dumbbell curl", 0, 30, None, 9, 90, "Keep your elbows locked in place to maintain a stretch on the biceps"),
        ("Neck flexion/extension", 0, 10, None, 8, 90, "10 reps flexion (front of neck), 10 reps extension (back of neck)"),
    ]),
    # WEEK 3
    ("Week 3", "FULL BODY 1", [
        ("Back squat", 4, 4, 80, 7, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Front squat", 0, 8, None, 7, 180, "If you low bar squat, do front squat. If you high bar squat, do barbell box squat"),
        ("Barbell bench press", 4, 2, 87.5, 8.5, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Barbell bench press", 0, 4, 80, 7, 90, "Submaximal bench press, be critical of form"),
        ("Weighted pull-up", 1, 6, None, 8, 90, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Glute-ham raise", 1, 8, None, 7, 90, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Seated face pull", 0, 20, None, 9, 90, "Don't go too heavy, focus on mind-muscle connection"),
    ]),
    ("Week 3", "FULL BODY 2", [
        ("Deadlift", 4, 5, 80, 7, 240, "Technique work, avoid turning these into touch-and-go reps"),
        ("Barbell overhead press", 3, 6, 75, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Bulgarian split squat", 1, 10, None, 9, 150, "Start with your weaker leg working. Squat deep"),
        ("Meadows row", 1, 15, None, 8, 150, "Brace with your other hand, stay light, emphasize form"),
        ("Barbell or EZ bar curl", 1, 10, None, 8, 90, "Use minimal momentum, control the eccentric phase"),
        ("Pec flye", 1, 15, None, 8, 90, "Perform with cables, bands, or dumbbells. Use full ROM. Stretch your pecs at the bottom"),
    ]),
    ("Week 3", "FULL BODY 3", [
        ("Back squat", 4, 8, 75, 7, 180, "Sit back and down, keep your upper back tight to the bar"),
        ("Pin squat", 0, 5, 70, 8, 180, "Set the pins to around parallel. Dead stop on the pins, don't bounce and go"),
        ("Barbell bench press", 4, 1, 92.5, 8, 180, "Working top set, build confidence with heavier loads"),
        ("Barbell bench press", 0, 5, 82.5, 8, 180, "Focus on perfecting technique, slight pause on the chest"),
        ("Barbell bench press", 0, 12, 65, 8, 180, "Try to stay fluid with these, think of them as 'pause-and-go'"),
        ("Chin-up", 1, 0, None, 8, 180, "As many reps as possible, but stop at RPE8"),
        ("Single-leg hip thrust", 0, 12, None, 8, 90, "Keep your chin tucked down and squeeze your glutes to move the weight"),
        ("Cable reverse flye", 0, 15, None, 8, 90, "Keep elbows locked in place, squeeze the cable handles hard!"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 3", "FULL BODY 4", [
        ("4\" Block pull", 4, 5, 90, 9, 300, "Get very tight prior to pulling, use 85% if you're not experienced with block pulls"),
        ("Pause db incline press", 3, 8, None, 8, 180, "3-second pause. Sink the dumbbells as low as you comfortably can"),
        ("Leg curl", 1, 15, None, 8, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Chest-supported row", 1, 12, None, 8, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Rope overhead triceps extension", 1, 15, None, 8, 90, "Focus on stretching the triceps at the bottom"),
        ("Egyptian lateral raise", 1, 10, None, 8, 90, "Lean away from the cable. Focus on squeezing your delts."),
    ]),
    # WEEK 4
    ("Week 4", "LOWER #1", [
        ("Back squat", 3, 4, 75, 8, 240, "Submaximal sets, approach these sets with confidence. Focus on technique"),
        ("Barbell RDL", 2, 10, None, 7, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Unilateral leg press", 1, 15, None, 8, 90, "High and wide foot positioning, start with your weaker leg"),
        ("Eccentric-accentuated leg extension", 0, 12, None, 10, 150, "4-second lowering phase"),
        ("Leg curl", 0, 15, None, 10, 150, "Dropset: do 10 reps, lower the weight ~30-50%, do another 15 reps"),
        ("Standing calf raise", 1, 15, None, 8, 150, "Think about rolling back and forth on the balls of your feet"),
        ("Weighted crunch", 0, 12, None, 8, 0, "Hold a plate or DB to your chest and crunch hard!"),
        ("Long-lever plank", 0, 30, None, 8, 90, "Contract your glutes and position your elbows under your eyes"),
    ]),
    ("Week 4", "UPPER #1", [
        ("Barbell bench press", 3, 8, 72.5, 7, 180, "Submaximal sets, focus on form"),
        ("Weighted pull-up", 2, 6, None, 9, 150, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Machine incline press", 2, 12, None, 9, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Seated cable row", 2, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Egyptian lateral raise", 0, 10, None, 10, 90, "Do 8-10 reps to failure. Rest 3-4 seconds. Do another 4 reps. Rest 2-3 seconds. Do another 4 reps"),
        ("Constant-tension cable triceps kickback", 0, 30, None, 10, 90, "Maintain a consistent pace of 1 second up and 1 second down"),
        ("Hammer cheat curl", 1, 10, None, 9, 90, "You can use slight momentum on the concentric, but control the eccentric"),
    ]),
    ("Week 4", "LOWER #2", [
        ("Reset deadlift", 4, 4, 80, 8, 240, "Stand up between each rep to work on technique"),
        ("Hack squat", 2, 12, None, 8, 180, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Single-leg hip thrust", 2, 12, None, 9, 150, "Contract your glutes hard at the top"),
        ("Glute-ham raise", 0, 8, None, 9, 0, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Prisoner back extension", 0, 20, None, 9, 90, "Place your hands behind your head and squeeze your glutes to straighten your hips"),
        ("Unilateral standing calf raise", 1, 10, None, 8, 90, "Start with your weaker side"),
        ("L-sit hold", 0, 25, None, 8, 90, "Hold the top position of a hanging leg raise. Aim to increase the hold time week to week."),
    ]),
    ("Week 4", "UPPER #2", [
        ("Omni-grip lat pulldown", 2, 12, None, 8, 150, "1 set wide grip, 1 set middle grip, 1 set close grip"),
        ("Barbell overhead press", 3, 4, 80, 8, 150, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Chest-supported row", 2, 12, None, 9, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Close-grip bench press", 2, 11, None, 8, 150, "Tuck your elbows against your sides more than standard grip bench press"),
        ("Seated face pull", 0, 20, None, 9, 90, "Mind muscle connection with rear delts on set 1, mid-traps on set 2"),
        ("Dumbbell lateral raise 21s", 0, 7, None, 9, 90, "First 7 reps: top half of ROM, middle 7 reps: full ROM, last 7 reps: bottom half of ROM"),
        ("Incline dumbbell curl", 0, 30, None, 9, 90, "Keep your elbows locked in place to maintain a stretch on the biceps"),
        ("Neck flexion/extension", 0, 10, None, 8, 90, "10 reps flexion (front of neck), 10 reps extension (back of neck)"),
    ]),
    # WEEK 5
    ("Week 5", "FULL BODY 1", [
        ("Back squat", 4, 5, 80, 8, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Front squat", 0, 8, None, 7, 180, "If you low bar squat, do front squat. If you high bar squat, do barbell box squat"),
        ("Barbell bench press", 4, 5, 80, 8.5, 180, "Top set, get comfortable with heavier loads while keeping perfect technique"),
        ("Barbell bench press", 0, 2, 80, 7, 150, "Submaximal bench press, be critical of form"),
        ("Weighted pull-up", 1, 6, None, 8, 90, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Glute-ham raise", 1, 8, None, 7, 90, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Seated face pull", 0, 20, None, 9, 90, "Don't go too heavy, focus on mind-muscle connection"),
    ]),
    ("Week 5", "FULL BODY 2", [
        ("Deadlift", 4, 5, 82.5, 7, 240, "Technique work, avoid turning these into touch-and-go reps"),
        ("Barbell overhead press", 3, 7, 75, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Bulgarian split squat", 1, 10, None, 9, 150, "Start with your weaker leg working. Squat deep"),
        ("Meadows row", 1, 15, None, 8, 150, "Brace with your other hand, stay light, emphasize form"),
        ("Barbell or EZ bar curl", 1, 10, None, 8, 90, "Use minimal momentum, control the eccentric phase"),
        ("Pec flye", 1, 15, None, 8, 90, "Perform with cables, bands, or dumbbells. Use full ROM. Stretch your pecs at the bottom"),
    ]),
    ("Week 5", "FULL BODY 3", [
        ("Back squat", 4, 10, 75, 7, 180, "Sit back and down, keep your upper back tight to the bar"),
        ("Pin squat", 0, 6, 70, 8, 180, "Set the pins to around parallel. Dead stop on the pins, don't bounce and go"),
        ("Barbell bench press", 4, 1, 95, 8.5, 180, "Working top set, build confidence with heavier loads"),
        ("Barbell bench press", 0, 6, 80, 8, 180, "Focus on perfecting technique, slight pause on the chest"),
        ("Barbell bench press", 0, 12, 70, 8, 180, "Try to stay fluid with these, think of them as 'pause-and-go'"),
        ("Chin-up", 1, 0, None, 8, 180, "As many reps as possible, but stop at RPE8"),
        ("Single-leg hip thrust", 0, 12, None, 8, 90, "Keep your chin tucked down and squeeze your glutes to move the weight"),
        ("Cable reverse flye", 0, 15, None, 8, 90, "Keep elbows locked in place, squeeze the cable handles hard!"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 5", "FULL BODY 4", [
        ("2\" Block pull", 4, 4, 90, 9, 300, "Get very tight prior to pulling, use 85% if you're not experienced with block pulls"),
        ("Pause db incline press", 3, 8, None, 8, 180, "3-second pause. Sink the dumbbells as low as you comfortably can"),
        ("Leg curl", 1, 15, None, 8, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Chest-supported row", 1, 12, None, 8, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Rope overhead triceps extension", 1, 15, None, 8, 90, "Focus on stretching the triceps at the bottom"),
        ("Egyptian lateral raise", 1, 10, None, 8, 90, "Lean away from the cable. Focus on squeezing your delts."),
    ]),
    # WEEK 6
    ("Week 6", "LOWER #1", [
        ("Back squat", 3, 4, 75, 8, 240, "Submaximal sets, approach these sets with confidence. Focus on technique"),
        ("Barbell RDL", 2, 10, None, 8, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Unilateral leg press", 1, 15, None, 8, 90, "High and wide foot positioning, start with your weaker leg"),
        ("Eccentric-accentuated leg extension", 0, 12, None, 10, 150, "4-second lowering phase"),
        ("Leg curl", 0, 15, None, 10, 150, "Dropset: do 10 reps, lower the weight ~30-50%, do another 15 reps"),
        ("Standing calf raise", 1, 15, None, 8, 150, "Think about rolling back and forth on the balls of your feet"),
        ("Weighted crunch", 0, 12, None, 8, 0, "Hold a plate or DB to your chest and crunch hard!"),
        ("Long-lever plank", 0, 30, None, 8, 90, "Contract your glutes and position your elbows under your eyes"),
    ]),
    ("Week 6", "UPPER #1", [
        ("Barbell bench press", 3, 8, 72.5, 8, 180, "Submaximal sets, focus on form"),
        ("Weighted pull-up", 2, 6, None, 9, 150, "1.5x shoulder width grip, pull your chest to the bar"),
        ("Machine incline press", 2, 12, None, 9, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Seated cable row", 2, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Egyptian lateral raise", 0, 10, None, 10, 90, "Do 8-10 reps to failure. Rest 3-4 seconds. Do another 4 reps. Rest 2-3 seconds. Do another 4 reps"),
        ("Constant-tension cable triceps kickback", 0, 30, None, 10, 90, "Maintain a consistent pace of 1 second up and 1 second down"),
        ("Hammer cheat curl", 1, 10, None, 9, 90, "You can use slight momentum on the concentric, but control the eccentric"),
    ]),
    ("Week 6", "LOWER #2", [
        ("Reset deadlift", 4, 5, 80, 8, 240, "Stand up between each rep to work on technique"),
        ("Hack squat", 2, 12, None, 8, 180, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Single-leg hip thrust", 2, 12, None, 9, 150, "Contract your glutes hard at the top"),
        ("Glute-ham raise", 0, 8, None, 9, 0, "Keep your hips straight, do Nordic ham curls if no GHR machine"),
        ("Prisoner back extension", 0, 20, None, 9, 90, "Place your hands behind your head and squeeze your glutes to straighten your hips"),
        ("Unilateral standing calf raise", 1, 10, None, 8, 90, "Start with your weaker side"),
        ("L-sit hold", 0, 30, None, 8, 90, "Hold the top position of a hanging leg raise. Aim to increase the hold time week to week."),
    ]),
    ("Week 6", "UPPER #2", [
        ("Omni-grip lat pulldown", 2, 12, None, 8, 150, "1 set wide grip, 1 set middle grip, 1 set close grip"),
        ("Barbell overhead press", 3, 4, 80, 8, 150, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Chest-supported row", 2, 12, None, 9, 150, "Can use machine or dumbbells. Full stretch at the bottom, squeeze at the top"),
        ("Close-grip bench press", 2, 12, None, 8, 150, "Tuck your elbows against your sides more than standard grip bench press"),
        ("Seated face pull", 0, 20, None, 9, 90, "Mind muscle connection with rear delts on set 1, mid-traps on set 2"),
        ("Dumbbell lateral raise 21s", 0, 7, None, 9, 90, "First 7 reps: top half of ROM, middle 7 reps: full ROM, last 7 reps: bottom half of ROM"),
        ("Incline dumbbell curl", 0, 30, None, 9, 90, "Keep your elbows locked in place to maintain a stretch on the biceps"),
        ("Neck flexion/extension", 0, 10, None, 8, 90, "10 reps flexion (front of neck), 10 reps extension (back of neck)"),
    ]),
    # WEEK 7
    ("Week 7", "FULL BODY 1", [
        ("Back squat", 4, 3, 85, 8, 180, "Maintain tight pressure in your upper back against the bar"),
        ("Barbell bench press", 4, 8, 75, 8, 90, "Set up a comfortable arch, quick pause on the chest and explode up on each rep"),
        ("Wide-grip lat pulldown", 1, 8, None, 8, 90, "1.5x shoulder width grip. Think about pulling your elbows 'down' and 'in'"),
        ("Sliding leg curl", 1, 12, None, 7, 90, "Keep your hips high, think about 'pulling your heels into your hips'"),
        ("Wall slide", 0, 20, None, 7, 90, "Don't use weight. These will help with shoulder stability. Don't skip!"),
    ]),
    ("Week 7", "FULL BODY 2", [
        ("Opposite stance deadlift", 4, 5, 75, 8, 240, "If you normally perform deadlifts sumo, perform conventional, and vice versa"),
        ("Barbell overhead press", 3, 8, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Leg press", 1, 12, None, 7, 150, "If you low bar squat, use a low foot placement. If you high bar squat, use a high foot placement"),
        ("Seated cable row", 1, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Hammer curl", 1, 20, None, 9, 90, "Go heavy, use a tiny bit of momentum"),
        ("Barbell or dumbbell isometric hold", 1, 30, None, 8, 90, "Do an isometric hold with dumbbells or a barbell for grip work"),
    ]),
    ("Week 7", "FULL BODY 3", [
        ("Front squat", 3, 8, None, 7, 180, "Try adding weight to the load you used in Week 5"),
        ("Pause barbell bench press", 3, 2, 87.5, 8, 180, "Get comfortable pausing with heavy weight, 2-3 second pause"),
        ("Weighted neutral-grip pull-up", 3, 6, None, 8, 150, "Pull your chest to the bar, add weight if needed to hit RPE"),
        ("Leg curl", 1, 15, None, 9, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Prone trap raise", 1, 15, None, 8, 90, "Think about tucking your shoulder blades 'down' as you raise your arms"),
        ("Hanging leg raise", 1, 12, None, 9, 90, "Knees to chest, controlled reps, straighten legs more to increase difficulty"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 7", "FULL BODY 4", [
        ("1\" Block pull", 4, 4, 90, 9, 300, "These will start to feel very heavy. Only do 1 set if you're feeling very fatigued"),
        ("Dip", 3, 10, None, 7, 180, "Add weight or assistance as needed. Do DB floor press if no access to dip handles"),
        ("One-arm row", 1, 12, None, 8, 150, "Can use DB or cable. Minimize torso momentum"),
        ("Triceps pressdown 21s", 1, 7, None, 8, 90, "First 7 reps: full ROM, next 7 reps: bottom half of ROM, last 7 reps: top half of ROM"),
        ("DB lateral raise", 1, 20, None, 8, 90, "Focus on contracting your delts"),
    ]),
    # WEEK 8 - SEMI DELOAD
    ("Week 8 - Semi Deload", "LOWER #1", [
        ("Pin squat", 3, 4, 72.5, 8, 180, "Set the pins to just above parallel"),
        ("Barbell RDL", 2, 8, None, 6, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Sissy squat", 1, 12, None, 8, 0, "Or leg press with low foot placement. Let your knees travel forward"),
        ("Nordic ham curl", 0, 8, None, 8, 150, "Keep your hips as straight as you can, can sub for lying leg curl"),
        ("Unilateral standing calf raise", 0, 12, None, 8, 90, "Start with your weaker side"),
        ("Hip abduction", 0, 15, None, 9, 90, "Machine, band, or weighted, 1 second isometric hold at the top of each rep"),
        ("Cable crunch", 0, 15, None, 8, 0, "Squeeze your six pack to crunch the weight, don't yank with your hands"),
        ("Cable shrug-in", 0, 15, None, 8, 90, "Set up two cable handles low and shrug up and in"),
    ]),
    ("Week 8 - Semi Deload", "UPPER #1", [
        ("Larsen press", 3, 10, None, 7, 180, "Shoulder blades still retracted and depressed. Slight arch in upper back. Zero leg drive"),
        ("Machine chest-supported row", 1, 12, None, 8, 150, "Dropset on the last set"),
        ("Machine incline press", 2, 12, None, 8, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Single-arm pulldown", 2, 10, None, 8, 90, "Start with your weaker side"),
        ("Triceps pressdown", 1, 15, None, 8, 90, "Focus on contracting your triceps"),
        ("Inverse Zottman curl", 0, 15, None, 8, 90, "Hammer curl on concentric, supinated curl on the eccentric"),
        ("Lateral raise", 0, 20, None, 9, 90, "Can use cable, dumbbell or bands. Use what you 'feel' the most. Stay in constant tension"),
    ]),
    ("Week 8 - Semi Deload", "LOWER #2", [
        ("Deadlift", 3, 5, 75, 6, 180, "These are intentionally light. Lock in your technique and move the bar with max speed"),
        ("Hack squat", 2, 12, None, 8, 150, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Cable pull-through", 1, 15, None, 8, 90, "Contract your glutes hard at the top, don't allow your lower back to round"),
        ("Leg extension", 0, 10, None, 9, 90, "Dropset. Do 15 reps, drop the weight up to 50%, do another 10 reps"),
        ("Unilateral leg curl", 0, 12, None, 8, 90, "Can perform seated or lying. Focus on contracting your hamstrings"),
        ("Standing calf raise", 0, 12, None, 8, 90, "Think about rolling back and forth on the balls of your feet"),
        ("L-sit hold", 0, 30, None, 7, 90, "Hold the top position of a hanging leg raise for the time interval given"),
    ]),
    ("Week 8 - Semi Deload", "UPPER #2", [
        ("Weighted eccentric-overload pull-up", 2, 5, None, 8, 0, "Jump up to assist with the positive or use a partner, then control the negative for 5 seconds"),
        ("Eccentric-accentuated pull-up", 0, 8, None, 8, 150, "3-second lowering phase. Use assistance/resistance as needed"),
        ("Barbell overhead press", 3, 4, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Pendlay row", 0, 5, None, 8, 90, "First 5 reps: very strict Pendlay rows"),
        ("Bent over row", 0, 10, None, 8, 90, "Final 10 reps: 'cheat' barbell bent over rows (use controlled momentum and pull to stomach)"),
        ("Deficit push-up", 2, 0, None, 8, 150, "4 inch deficit. Sink your chest deep. Track your reps for next week"),
        ("Barbell or EZ bar curl", 2, 12, None, 8, 90, "Focus on contracting your biceps, minimize torso momentum"),
        ("Dumbbell lateral raise iso-hold", 0, 45, None, 8, 90, "Hold the dumbbell with your arms parallel to the floor for the time specified"),
    ]),
    # WEEK 9
    ("Week 9", "FULL BODY 1", [
        ("Back squat", 4, 2, 85, 8, 180, "Maintain tight pressure in your upper back against the bar"),
        ("Barbell bench press", 4, 6, 77.5, 8, 90, "Set up a comfortable arch, quick pause on the chest and explode up on each rep"),
        ("Wide-grip lat pulldown", 1, 8, None, 8, 90, "1.5x shoulder width grip. Think about pulling your elbows 'down' and 'in'"),
        ("Sliding leg curl", 1, 12, None, 7, 90, "Keep your hips high, think about 'pulling your heels into your hips'"),
        ("Wall slide", 0, 20, None, 7, 90, "Don't use weight. These will help with shoulder stability. Don't skip!"),
    ]),
    ("Week 9", "FULL BODY 2", [
        ("Opposite stance deadlift", 4, 2, 75, 3, 240, "If you normally perform deadlifts sumo, perform conventional, and vice versa. Go lighter this week"),
        ("Barbell overhead press", 3, 8, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Leg press", 1, 12, None, 7, 150, "If you low bar squat, use a low foot placement. If you high bar squat, use a high foot placement"),
        ("Seated cable row", 1, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Hammer curl", 1, 20, None, 9, 90, "Go heavy, use a tiny bit of momentum"),
        ("Barbell or dumbbell isometric hold", 1, 30, None, 8, 90, "Do an isometric hold with dumbbells or a barbell for grip work"),
    ]),
    ("Week 9", "FULL BODY 3", [
        ("Front squat", 3, 8, None, 6, 180, "Stay light, keep your torso upright"),
        ("Pause barbell bench press", 3, 2, 90, 9, 180, "Get comfortable pausing with heavy weight, 2-3 second pause"),
        ("Weighted neutral-grip pull-up", 3, 6, None, 8, 150, "Pull your chest to the bar, add weight if needed to hit RPE"),
        ("Leg curl", 1, 15, None, 9, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Prone trap raise", 1, 15, None, 8, 90, "Think about tucking your shoulder blades 'down' as you raise your arms"),
        ("Hanging leg raise", 1, 12, None, 9, 90, "Knees to chest, controlled reps, straighten legs more to increase difficulty"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 9", "FULL BODY 4", [
        ("Deadlift", 4, 0, 90, 9, 300, "AMRAP - Aim for a PR for 3-6 reps"),
        ("Dip", 3, 10, None, 7, 180, "Add weight or assistance as needed. Do DB floor press if no access to dip handles"),
        ("One-arm row", 1, 12, None, 8, 150, "Can use DB or cable. Minimize torso momentum"),
        ("Triceps pressdown 21s", 1, 7, None, 8, 90, "First 7 reps: full ROM, next 7 reps: bottom half of ROM, last 7 reps: top half of ROM"),
        ("DB lateral raise", 1, 20, None, 8, 90, "Focus on contracting your delts"),
    ]),
    # WEEK 10
    ("Week 10", "LOWER #1", [
        ("Pin squat", 3, 5, 72.5, 8, 180, "Set the pins to just above parallel"),
        ("Barbell RDL", 2, 10, None, 9, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Sissy squat", 1, 12, None, 9, 0, "Or leg press with low foot placement. Let your knees travel forward"),
        ("Nordic ham curl", 0, 8, None, 9, 150, "Keep your hips as straight as you can, can sub for lying leg curl"),
        ("Unilateral standing calf raise", 0, 12, None, 8, 90, "Start with your weaker side"),
        ("Hip abduction", 0, 15, None, 10, 90, "Machine, band, or weighted, 1 second isometric hold at the top of each rep"),
        ("Cable crunch", 0, 15, None, 8, 0, "Squeeze your six pack to crunch the weight, don't yank with your hands"),
        ("Cable shrug-in", 0, 15, None, 8, 90, "Set up two cable handles low and shrug up and in"),
    ]),
    ("Week 10", "UPPER #1", [
        ("Larsen press", 3, 10, None, 7, 180, "Shoulder blades still retracted and depressed. Slight arch in upper back. Zero leg drive"),
        ("Machine chest-supported row", 1, 12, None, 9, 150, "Dropset on the last set"),
        ("Machine incline press", 2, 12, None, 9, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Single-arm pulldown", 2, 10, None, 9, 90, "Start with your weaker side"),
        ("Triceps pressdown", 1, 15, None, 9, 90, "Focus on contracting your triceps"),
        ("Inverse Zottman curl", 0, 15, None, 9, 90, "Hammer curl on concentric, supinated curl on the eccentric"),
        ("Lateral raise", 0, 20, None, 10, 90, "Can use cable, dumbbell or bands. Use what you 'feel' the most. Stay in constant tension"),
    ]),
    ("Week 10", "LOWER #2", [
        ("Deadlift", 3, 6, 75, 7, 180, "Use this as a time to perfect your form"),
        ("Hack squat", 2, 12, None, 8, 150, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Cable pull-through", 1, 15, None, 8, 90, "Contract your glutes hard at the top, don't allow your lower back to round"),
        ("Leg extension", 0, 10, None, 10, 90, "Dropset. Do 15 reps, drop the weight up to 50%, do another 10 reps"),
        ("Unilateral leg curl", 0, 12, None, 8, 90, "Can perform seated or lying. Focus on contracting your hamstrings"),
        ("Standing calf raise", 0, 12, None, 8, 90, "Think about rolling back and forth on the balls of your feet"),
        ("L-sit hold", 0, 30, None, 7, 90, "Hold the top position of a hanging leg raise for the time interval given"),
    ]),
    ("Week 10", "UPPER #2", [
        ("Weighted eccentric-overload pull-up", 2, 5, None, 9, 0, "Jump up to assist with the positive or use a partner, then control the negative for 5 seconds"),
        ("Eccentric-accentuated pull-up", 0, 8, None, 9, 150, "3-second lowering phase. Use assistance/resistance as needed"),
        ("Barbell overhead press", 3, 5, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Pendlay row", 0, 5, None, 9, 90, "First 5 reps: very strict Pendlay rows"),
        ("Bent over row", 0, 10, None, 9, 90, "Final 10 reps: 'cheat' barbell bent over rows"),
        ("Deficit push-up", 2, 0, None, 9, 150, "4 inch deficit. Sink your chest deep. Beat your reps from last week"),
        ("Barbell or EZ bar curl", 2, 12, None, 9, 90, "Focus on contracting your biceps, minimize torso momentum"),
        ("Dumbbell lateral raise iso-hold", 0, 45, None, 8, 90, "Hold the dumbbell with your arms parallel to the floor for the time specified"),
    ]),
    # WEEK 11
    ("Week 11", "FULL BODY 1", [
        ("Back squat", 4, 1, 92.5, 8.5, 180, "Maintain tight pressure in your upper back against the bar"),
        ("Barbell bench press", 4, 6, 80, 9, 90, "Set up a comfortable arch, quick pause on the chest and explode up on each rep"),
        ("Wide-grip lat pulldown", 1, 8, None, 8, 90, "1.5x shoulder width grip. Think about pulling your elbows 'down' and 'in'"),
        ("Sliding leg curl", 1, 12, None, 7, 90, "Keep your hips high, think about 'pulling your heels into your hips'"),
        ("Wall slide", 0, 20, None, 7, 90, "Don't use weight. These will help with shoulder stability. Don't skip!"),
    ]),
    ("Week 11", "FULL BODY 2", [
        ("Opposite stance deadlift", 4, 3, 80, 6, 240, "If you normally perform deadlifts sumo, perform conventional, and vice versa"),
        ("Barbell overhead press", 3, 8, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Leg press", 1, 12, None, 7, 150, "If you low bar squat, use a low foot placement. If you high bar squat, use a high foot placement"),
        ("Seated cable row", 1, 12, None, 9, 150, "Focus on squeezing your shoulder blades together, drive your elbows down and back"),
        ("Hammer curl", 1, 20, None, 9, 90, "Go heavy, use a tiny bit of momentum"),
        ("Barbell or dumbbell isometric hold", 1, 30, None, 8, 90, "Do an isometric hold with dumbbells or a barbell for grip work"),
    ]),
    ("Week 11", "FULL BODY 3", [
        ("Front squat", 3, 8, None, 6, 180, "Stay light, keep your torso upright"),
        ("Pause barbell bench press", 3, 1, 92.5, 9, 180, "Get comfortable pausing with heavy weight, 1-2 second pause"),
        ("Weighted neutral-grip pull-up", 3, 6, None, 8, 150, "Pull your chest to the bar, add weight if needed to hit RPE"),
        ("Leg curl", 1, 15, None, 9, 150, "Use seated leg curl if available. Can use lying leg curl or Nordic ham curl"),
        ("Prone trap raise", 1, 15, None, 8, 90, "Think about tucking your shoulder blades 'down' as you raise your arms"),
        ("Hanging leg raise", 1, 12, None, 9, 90, "Knees to chest, controlled reps, straighten legs more to increase difficulty"),
        ("Standing calf raise", 0, 10, None, 9, 90, "1-2 second pause at the bottom of each rep, full squeeze at the top"),
    ]),
    ("Week 11", "FULL BODY 4", [
        ("Deadlift", 4, 3, 85, 8, 300, "Pull the slack out of the bar before lifting, take your time with the set up"),
        ("Dip", 3, 10, None, 7, 180, "Add weight or assistance as needed. Do DB floor press if no access to dip handles"),
        ("One-arm row", 1, 12, None, 8, 150, "Can use DB or cable. Minimize torso momentum"),
        ("Triceps pressdown 21s", 1, 7, None, 8, 90, "First 7 reps: full ROM, next 7 reps: bottom half of ROM, last 7 reps: top half of ROM"),
        ("DB lateral raise", 1, 20, None, 8, 90, "Focus on contracting your delts"),
    ]),
    # WEEK 12
    ("Week 12", "LOWER #1", [
        ("Pin squat", 3, 6, 72.5, 8, 180, "Set the pins to just above parallel"),
        ("Barbell RDL", 2, 12, None, 9, 180, "Emphasize the stretch in your hamstrings, prevent your lower back from rounding"),
        ("Sissy squat", 1, 12, None, 9, 0, "Or leg press with low foot placement. Let your knees travel forward"),
        ("Nordic ham curl", 0, 8, None, 9, 150, "Keep your hips as straight as you can, can sub for lying leg curl"),
        ("Unilateral standing calf raise", 0, 12, None, 8, 90, "Start with your weaker side"),
        ("Hip abduction", 0, 15, None, 10, 90, "Machine, band, or weighted, 1 second isometric hold at the top of each rep"),
        ("Cable crunch", 0, 15, None, 8, 0, "Squeeze your six pack to crunch the weight, don't yank with your hands"),
        ("Cable shrug-in", 0, 15, None, 8, 90, "Set up two cable handles low and shrug up and in"),
    ]),
    ("Week 12", "UPPER #1", [
        ("Barbell bench press", 3, 0, 85, 9.5, 180, "Do as many reps as possible to an RPE 9-9.5. Don't actually fail. Use a spotter"),
        ("Barbell bench press", 0, 10, None, 7, 180, "Go lighter, flare your elbows slightly more than normal"),
        ("Machine chest-supported row", 1, 12, None, 9, 150, "Dropset on the last set"),
        ("Machine incline press", 2, 12, None, 9, 180, "Smith machine or hammer strength machine. ~45 degree incline"),
        ("Single-arm pulldown", 2, 10, None, 9, 90, "Start with your weaker side"),
        ("Triceps pressdown", 1, 15, None, 9, 90, "Focus on contracting your triceps"),
        ("Inverse Zottman curl", 0, 15, None, 9, 90, "Hammer curl on concentric, supinated curl on the eccentric"),
        ("Lateral raise", 0, 20, None, 10, 90, "Can use cable, dumbbell or bands. Use what you 'feel' the most. Stay in constant tension"),
    ]),
    ("Week 12", "LOWER #2", [
        ("Deadlift", 3, 6, 75, 7, 180, "Pull the slack out of the bar before lifting, take your time with the set up"),
        ("Hack squat", 2, 12, None, 8, 150, "Allow your knees to come forward (past your toes), focus the tension on your quads"),
        ("Cable pull-through", 1, 15, None, 8, 90, "Contract your glutes hard at the top, don't allow your lower back to round"),
        ("Leg extension", 0, 10, None, 10, 90, "Dropset. Do 15 reps, drop the weight up to 50%, do another 10 reps"),
        ("Unilateral leg curl", 0, 12, None, 8, 90, "Can perform seated or lying. Focus on contracting your hamstrings"),
        ("Standing calf raise", 0, 12, None, 8, 90, "Think about rolling back and forth on the balls of your feet"),
        ("L-sit hold", 0, 30, None, 7, 90, "Hold the top position of a hanging leg raise for the time interval given"),
    ]),
    ("Week 12", "UPPER #2", [
        ("Weighted eccentric-overload pull-up", 2, 5, None, 9, 0, "Jump up to assist with the positive or use a partner, then control the negative for 5 seconds"),
        ("Eccentric-accentuated pull-up", 0, 8, None, 9, 150, "3-second lowering phase. Use assistance/resistance as needed"),
        ("Barbell overhead press", 3, 6, None, 8, 180, "Squeeze your glutes to keep your torso upright, press up and slightly back"),
        ("Pendlay row", 0, 5, None, 9, 90, "First 5 reps: very strict Pendlay rows"),
        ("Bent over row", 0, 10, None, 9, 90, "Final 10 reps: 'cheat' barbell bent over rows"),
        ("Deficit push-up", 2, 0, None, 9, 150, "4 inch deficit. Sink your chest deep. Beat your reps from last week"),
        ("Barbell or EZ bar curl", 2, 12, None, 9, 90, "Focus on contracting your biceps, minimize torso momentum"),
        ("Dumbbell lateral raise iso-hold", 0, 45, None, 8, 90, "Hold the dumbbell with your arms parallel to the floor for the time specified"),
    ]),
]


async def seed():
    await init_db()

    async with async_session() as session:
        result = await session.execute(select(Plan).where(Plan.name == 'Powerbuilding Phase 2'))
        plan = result.scalar_one_or_none()
        
        if not plan:
            print("Plan not found!")
            return
        
        result = await session.execute(select(Exercise))
        exercises = result.scalars().all()
        exercise_map = {ex.name: ex.id for ex in exercises}
        
        session_order = 4
        for week, session_name, exercises_list in all_sessions:
            session_name_full = f"{week} - {session_name}"
            
            existing = await session.execute(
                select(PlanSession).where(
                    PlanSession.plan_id == plan.id,
                    PlanSession.name == session_name_full
                )
            )
            if existing.scalar_one_or_none():
                print(f"Skipping {session_name_full} (already exists)")
                continue
            
            ps = PlanSession(
                id=str(uuid.uuid4()),
                plan_id=plan.id,
                name=session_name_full,
                order_index=session_order,
            )
            session.add(ps)
            await session.flush()
            
            for ex_idx, (ex_name, warmup_sets, reps, weight_pct, rpe, rest, notes) in enumerate(exercises_list):
                if ex_name not in exercise_map:
                    print(f"Warning: Exercise '{ex_name}' not found in database")
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
                session.add(pe)
            
            session_order += 1
            print(f"Added {session_name_full} with {len(exercises_list)} exercises")
        
        await session.commit()
        print("\nAll weeks added successfully!")

if __name__ == "__main__":
    asyncio.run(seed())
