from fastapi import APIRouter, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List
import uuid
from ..database import async_session
from ..models import TrainingSession, SessionExercise, ExerciseSet, Exercise, VolumeHistory
from ..schemas import SessionCreate, SessionUpdate, SessionResponse
from ..schemas import SessionExerciseCreate, SessionExerciseUpdate, SessionExerciseResponse
from ..schemas import ExerciseSetCreate, ExerciseSetUpdate, ExerciseSetResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

@router.get("", response_model=List[SessionResponse])
async def list_sessions(user_id: str = Query(...)):
    async with async_session() as session:
        result = await session.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets))
            .where(TrainingSession.user_id == user_id)
        )
        sessions = result.scalars().all()
        return sessions

@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    async with async_session() as session:
        result = await session.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets))
            .where(TrainingSession.id == session_id)
        )
        session_obj = result.scalar_one_or_none()
        if not session_obj:
            raise HTTPException(status_code=404, detail="Session not found")
        return session_obj

@router.post("", response_model=SessionResponse)
async def create_session(session: SessionCreate, user_id: str = Query(...)):
    async with async_session() as session_db:
        new_session = TrainingSession(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=session.name,
            meso_cycle_id=session.meso_cycle_id,
            micro_cycle_id=session.micro_cycle_id,
            scheduled_date=session.scheduled_date,
            status=session.status,
            notes=session.notes
        )
        session_db.add(new_session)
        await session_db.commit()
        await session_db.refresh(new_session)
        return new_session

@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, session: SessionUpdate):
    async with async_session() as session_db:
        result = await session_db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
        db_session = result.scalar_one_or_none()
        if not db_session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        for field, value in session.model_dump(exclude_unset=True).items():
            setattr(db_session, field, value)
        
        await session_db.commit()
        await session_db.refresh(db_session)
        return db_session

@router.delete("/{session_id}")
async def delete_session(session_id: str):
    async with async_session() as session_db:
        result = await session_db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
        db_session = result.scalar_one_or_none()
        if not db_session:
            raise HTTPException(status_code=404, detail="Session not found")
        await session_db.delete(db_session)
        await session_db.commit()
        return {"message": "Session deleted"}

@router.post("/{session_id}/complete")
async def complete_session(session_id: str):
    async with async_session() as session_db:
        result = await session_db.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets))
            .where(TrainingSession.id == session_id)
        )
        db_session = result.scalar_one_or_none()
        if not db_session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        db_session.status = "completed"
        
        total_volume = 0.0
        for se in db_session.session_exercises:
            exercise_volume = 0.0
            for s in se.sets:
                if s.is_completed and not s.is_warmup and s.reps and s.weight:
                    exercise_volume += s.reps * s.weight
            
            if exercise_volume > 0:
                total_volume += exercise_volume
                volume_record = VolumeHistory(
                    id=str(uuid.uuid4()),
                    user_id=db_session.user_id,
                    exercise_id=se.exercise_id,
                    session_id=db_session.id,
                    total_volume=exercise_volume
                )
                session_db.add(volume_record)
        
        db_session.total_volume = total_volume
        await session_db.commit()
        return {"message": "Session completed", "total_volume": total_volume}

@router.post("/{session_id}/exercises", response_model=SessionExerciseResponse)
async def add_exercise_to_session(session_id: str, exercise: SessionExerciseCreate):
    async with async_session() as session_db:
        new_se = SessionExercise(
            id=str(uuid.uuid4()),
            session_id=session_id,
            exercise_id=exercise.exercise_id,
            order_index=exercise.order_index,
            notes=exercise.notes
        )
        session_db.add(new_se)
        await session_db.commit()
        await session_db.refresh(new_se)
        return new_se

@router.put("/session-exercises/{se_id}", response_model=SessionExerciseResponse)
async def update_session_exercise(se_id: str, exercise: SessionExerciseUpdate):
    async with async_session() as session_db:
        result = await session_db.execute(select(SessionExercise).where(SessionExercise.id == se_id))
        db_se = result.scalar_one_or_none()
        if not db_se:
            raise HTTPException(status_code=404, detail="Session exercise not found")
        
        for field, value in exercise.model_dump(exclude_unset=True).items():
            setattr(db_se, field, value)
        
        await session_db.commit()
        await session_db.refresh(db_se)
        return db_se

@router.delete("/session-exercises/{se_id}")
async def remove_exercise_from_session(se_id: str):
    async with async_session() as session_db:
        result = await session_db.execute(select(SessionExercise).where(SessionExercise.id == se_id))
        db_se = result.scalar_one_or_none()
        if not db_se:
            raise HTTPException(status_code=404, detail="Session exercise not found")
        await session_db.delete(db_se)
        await session_db.commit()
        return {"message": "Exercise removed from session"}

@router.post("/session-exercises/{se_id}/sets", response_model=ExerciseSetResponse)
async def add_set_to_exercise(se_id: str, set_data: ExerciseSetCreate):
    async with async_session() as session_db:
        new_set = ExerciseSet(
            id=str(uuid.uuid4()),
            session_exercise_id=se_id,
            set_number=set_data.set_number,
            reps=set_data.reps,
            weight=set_data.weight,
            rpe=set_data.rpe,
            is_warmup=set_data.is_warmup
        )
        session_db.add(new_set)
        await session_db.commit()
        await session_db.refresh(new_set)
        return new_set

@router.put("/exercise-sets/{set_id}", response_model=ExerciseSetResponse)
async def update_set(set_id: str, set_data: ExerciseSetUpdate):
    async with async_session() as session_db:
        result = await session_db.execute(select(ExerciseSet).where(ExerciseSet.id == set_id))
        db_set = result.scalar_one_or_none()
        if not db_set:
            raise HTTPException(status_code=404, detail="Set not found")
        
        for field, value in set_data.model_dump(exclude_unset=True).items():
            setattr(db_set, field, value)
        
        await session_db.commit()
        await session_db.refresh(db_set)
        return db_set

@router.delete("/exercise-sets/{set_id}")
async def delete_set(set_id: str):
    async with async_session() as session_db:
        result = await session_db.execute(select(ExerciseSet).where(ExerciseSet.id == set_id))
        db_set = result.scalar_one_or_none()
        if not db_set:
            raise HTTPException(status_code=404, detail="Set not found")
        await session_db.delete(db_set)
        await session_db.commit()
        return {"message": "Set deleted"}
