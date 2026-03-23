from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import List, Dict
from .database import async_session
from .models import Exercise, VolumeHistory, TrainingSession, SessionExercise, ExerciseSet
from .schemas import ExerciseResponse

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])

@router.get("/exercises")
async def suggest_exercises(user_id: str = Query(...)):
    async with async_session() as session:
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        result = await session.execute(
            select(
                Exercise.id,
                Exercise.name,
                Exercise.muscle_group,
                func.coalesce(func.sum(VolumeHistory.total_volume), 0).label("volume")
            )
            .outerjoin(VolumeHistory, Exercise.id == VolumeHistory.exercise_id)
            .group_by(Exercise.id)
        )
        
        exercises = result.all()
        suggestions = []
        
        for ex in exercises:
            volume = float(ex.volume)
            if volume > 15000:
                suggestion = "High volume - consider deload week"
            elif volume > 10000:
                suggestion = "High volume - maintain current intensity"
            elif volume >= 5000:
                suggestion = "Moderate volume - consider progression"
            elif volume > 0:
                suggestion = "Low volume - good for adding volume"
            else:
                suggestion = "New exercise - start with light weight"
            
            suggestions.append({
                "id": ex.id,
                "name": ex.name,
                "muscle_group": ex.muscle_group,
                "volume_30d": volume,
                "suggestion": suggestion
            })
        
        return suggestions

@router.get("/weight")
async def suggest_weight(user_id: str = Query(...), exercise_id: str = Query(...)):
    async with async_session() as session:
        result = await session.execute(
            select(ExerciseSet, TrainingSession)
            .join(SessionExercise, ExerciseSet.session_exercise_id == SessionExercise.id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .where(SessionExercise.exercise_id == exercise_id)
            .where(TrainingSession.user_id == user_id)
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
            .order_by(TrainingSession.actual_date.desc())
            .limit(50)
        )
        
        sets = result.all()
        
        if not sets:
            return {"suggestion": "No history - start light", "percentage": 100}
        
        weights = [float(s.weight) for s in sets if s.weight]
        avg_weight = sum(weights) / len(weights) if weights else 0
        
        rpes = [float(s.rpe) for s in sets if s.rpe]
        avg_rpe = sum(rpes) / len(rpes) if rpes else 5
        
        if avg_rpe > 8:
            suggestion = "Deload - reduce weight by 40%"
            percentage = 60
        elif avg_rpe > 7:
            suggestion = "Recovery - reduce weight by 15%"
            percentage = 85
        else:
            suggestion = "Progression - increase weight by 2.5%"
            percentage = 102.5
        
        return {
            "average_weight": round(avg_weight, 1),
            "suggested_weight": round(avg_weight * percentage / 100, 1),
            "average_rpe": round(avg_rpe, 1),
            "suggestion": suggestion,
            "percentage": percentage
        }

@router.get("/muscle-groups")
async def volume_by_muscle_group(user_id: str = Query(...)):
    async with async_session() as session:
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        result = await session.execute(
            select(
                Exercise.muscle_group,
                func.coalesce(func.sum(VolumeHistory.total_volume), 0).label("volume")
            )
            .join(VolumeHistory, Exercise.id == VolumeHistory.exercise_id)
            .where(VolumeHistory.user_id == user_id)
            .group_by(Exercise.muscle_group)
        )
        
        groups = result.all()
        
        return [
            {"muscle_group": g.muscle_group, "volume_30d": float(g.volume)}
            for g in groups
        ]
