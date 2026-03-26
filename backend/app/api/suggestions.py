from fastapi import APIRouter, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Dict
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet
from ..deps import get_current_user_id

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("/exercises")
async def suggest_exercises(user_id: str = Depends(get_current_user_id)):
    """
    Return exercises the user has trained, ranked by total all-time volume.
    Computed directly from ExerciseSet so it works even without VolumeHistory.
    """
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.id,
                Exercise.name,
                Exercise.muscle_group,
                func.sum(ExerciseSet.reps * ExerciseSet.weight).label("volume"),
                func.max(TrainingSession.scheduled_date).label("last_performed"),
            )
            .join(SessionExercise, Exercise.id == SessionExercise.exercise_id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .join(ExerciseSet, ExerciseSet.session_exercise_id == SessionExercise.id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
            .where(ExerciseSet.weight != None)
            .where(ExerciseSet.reps != None)
            .group_by(Exercise.id, Exercise.name, Exercise.muscle_group)
            .having(func.sum(ExerciseSet.reps * ExerciseSet.weight) > 0)
            .order_by(func.sum(ExerciseSet.reps * ExerciseSet.weight).desc())
        )

        exercises = result.all()
        suggestions = []

        for ex in exercises:
            volume = float(ex.volume)
            if volume > 50000:
                suggestion_reason = "High volume — maintain intensity"
            elif volume >= 10000:
                suggestion_reason = "Moderate volume — consider progression"
            else:
                suggestion_reason = "Lower volume — good candidate for more work"

            suggestions.append({
                "exercise": {
                    "id": ex.id,
                    "name": ex.name,
                    "muscle_group": ex.muscle_group,
                    "description": None,
                    "created_at": None
                },
                "total_volume": volume,
                "last_performed": ex.last_performed if ex.last_performed else None,
                "suggestion_reason": suggestion_reason
            })

        return suggestions


@router.get("/weight")
async def suggest_weight(
    user_id: str = Depends(get_current_user_id),
    exercise_id: str = Query(...),
):
    async with async_session() as session:
        result = await session.execute(
            select(ExerciseSet, TrainingSession)
            .join(SessionExercise, ExerciseSet.session_exercise_id == SessionExercise.id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .where(SessionExercise.exercise_id == exercise_id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
            .where(ExerciseSet.weight != None)
            .order_by(TrainingSession.scheduled_date.desc())
            .limit(50)
        )

        rows = result.all()

        if not rows:
            return {
                "average_weight": 0,
                "previous_weight": 0,
                "suggested_weight": 0,
                "average_rpe": None,
                "suggestion": "No history — start light and build up",
                "adjustment_reason": "No history — start light and build up",
                "percentage": 100,
            }

        weights = [float(r[0].weight) for r in rows if r[0].weight]
        avg_weight = sum(weights) / len(weights) if weights else 0

        rpes = [float(r[0].rpe) for r in rows if r[0].rpe]
        avg_rpe = sum(rpes) / len(rpes) if rpes else None

        if avg_rpe and avg_rpe > 8:
            suggestion = "Deload — reduce weight by 40%"
            percentage = 60
        elif avg_rpe and avg_rpe > 7:
            suggestion = "Recovery — reduce weight by 15%"
            percentage = 85
        else:
            suggestion = "Progression — increase weight by 2.5%"
            percentage = 102.5

        suggested = round(avg_weight * percentage / 100, 1)

        return {
            "average_weight": round(avg_weight, 1),
            "previous_weight": round(avg_weight, 1),
            "suggested_weight": round(suggested, 1),
            "average_rpe": round(avg_rpe, 1) if avg_rpe else None,
            "suggestion": suggestion,
            "adjustment_reason": suggestion,
            "percentage": percentage,
        }


@router.get("/muscle-groups")
async def volume_by_muscle_group(user_id: str = Depends(get_current_user_id)):
    """
    All-time volume per muscle group, computed directly from ExerciseSet.
    """
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.muscle_group,
                func.sum(ExerciseSet.reps * ExerciseSet.weight).label("volume"),
            )
            .join(SessionExercise, Exercise.id == SessionExercise.exercise_id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .join(ExerciseSet, ExerciseSet.session_exercise_id == SessionExercise.id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.weight != None)
            .where(ExerciseSet.reps != None)
            .group_by(Exercise.muscle_group)
        )

        groups = result.all()

        return {
            g.muscle_group: int(g.volume)
            for g in groups
            if g.volume and g.volume > 0
        }
