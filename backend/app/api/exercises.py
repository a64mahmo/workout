from fastapi import APIRouter, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
import uuid
from ..database import async_session
from ..models import Exercise, TrainingSession
from ..schemas import ExerciseCreate, ExerciseUpdate, ExerciseResponse

router = APIRouter(prefix="/api/exercises", tags=["exercises"])

@router.get("", response_model=List[ExerciseResponse])
async def list_exercises(muscle_group: Optional[str] = None):
    async with async_session() as session:
        query = select(Exercise)
        if muscle_group:
            query = query.where(Exercise.muscle_group == muscle_group)
        result = await session.execute(query)
        exercises = result.scalars().all()
        return exercises

@router.get("/{exercise_id}", response_model=ExerciseResponse)
async def get_exercise(exercise_id: str):
    async with async_session() as session:
        result = await session.execute(select(Exercise).where(Exercise.id == exercise_id))
        exercise = result.scalar_one_or_none()
        if not exercise:
            raise HTTPException(status_code=404, detail="Exercise not found")
        return exercise

@router.post("", response_model=ExerciseResponse)
async def create_exercise(exercise: ExerciseCreate, x_user_id: str = Header(...)):
    async with async_session() as session:
        new_exercise = Exercise(
            id=str(uuid.uuid4()),
            name=exercise.name,
            muscle_group=exercise.muscle_group,
            description=exercise.description
        )
        session.add(new_exercise)
        await session.commit()
        await session.refresh(new_exercise)
        return new_exercise

@router.put("/{exercise_id}", response_model=ExerciseResponse)
async def update_exercise(exercise_id: str, exercise: ExerciseUpdate):
    async with async_session() as session:
        result = await session.execute(select(Exercise).where(Exercise.id == exercise_id))
        db_exercise = result.scalar_one_or_none()
        if not db_exercise:
            raise HTTPException(status_code=404, detail="Exercise not found")
        
        if exercise.name is not None:
            db_exercise.name = exercise.name
        if exercise.muscle_group is not None:
            db_exercise.muscle_group = exercise.muscle_group
        if exercise.description is not None:
            db_exercise.description = exercise.description
        
        await session.commit()
        await session.refresh(db_exercise)
        return db_exercise

@router.delete("/{exercise_id}")
async def delete_exercise(exercise_id: str):
    async with async_session() as session:
        result = await session.execute(select(Exercise).where(Exercise.id == exercise_id))
        exercise = result.scalar_one_or_none()
        if not exercise:
            raise HTTPException(status_code=404, detail="Exercise not found")
        await session.delete(exercise)
        await session.commit()
        return {"message": "Exercise deleted"}

@router.get("/{exercise_id}/history")
async def get_exercise_history(
    exercise_id: str,
    user_id: str = Query(...),
    limit: int = Query(10, ge=1, le=50)
):
    from app.models.models import SessionExercise as SES, ExerciseSet as ES
    async with async_session() as session:
        result = await session.execute(
            select(TrainingSession)
            .join(SES, SES.session_id == TrainingSession.id)
            .where(SES.exercise_id == exercise_id)
            .where(TrainingSession.user_id == user_id)
            .options(selectinload(TrainingSession.session_exercises).selectinload(SES.sets))
            .order_by(TrainingSession.scheduled_date.desc())
            .limit(limit)
        )
        sessions = result.scalars().all()
        
        history = []
        for ts in sessions:
            for se in ts.session_exercises:
                if se.exercise_id != exercise_id:
                    continue
                sets_data = []
                total_volume = 0
                for s in sorted(se.sets, key=lambda x: x.set_number):
                    if not s.is_warmup and s.is_completed:
                        volume = (s.reps or 0) * (s.weight or 0)
                        total_volume += volume
                        sets_data.append({
                            "set_number": s.set_number,
                            "reps": s.reps or 0,
                            "weight": s.weight or 0,
                            "rpe": s.rpe
                        })
                
                history.append({
                    "session_date": ts.scheduled_date,
                    "session_name": ts.name,
                    "sets": sets_data,
                    "total_volume": total_volume
                })
        
        return history
