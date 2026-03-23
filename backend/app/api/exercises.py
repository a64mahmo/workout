from fastapi import APIRouter, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
import uuid
from ..database import async_session
from ..models import Exercise
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
