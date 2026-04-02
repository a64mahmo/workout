from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, func
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime
import uuid

from app.database import get_db
from app.models.models import TrainingSession, SessionExercise, ExerciseSet, Exercise, VolumeHistory, HealthMetric, MicroCycle, MesoCycle
from app.schemas import SessionCreate, SessionUpdate, SessionResponse
from app.schemas import SessionExerciseCreate, SessionExerciseUpdate, SessionExerciseResponse
from app.schemas import ExerciseSetCreate, ExerciseSetUpdate, ExerciseSetResponse
from app.deps import get_current_user_id

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

@router.get("", response_model=List[SessionResponse])
async def list_sessions(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingSession)
        .options(
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets),
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.exercise),
            selectinload(TrainingSession.health_metric)
        )
        .where(TrainingSession.user_id == user_id)
    )
    sessions = result.scalars().all()
    return sessions

@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingSession)
        .options(
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets),
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.exercise),
            selectinload(TrainingSession.health_metric)
        )
        .where(TrainingSession.id == session_id)
    )
    session_obj = result.scalar_one_or_none()
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_obj

@router.post("", response_model=SessionResponse)
async def create_session(session: SessionCreate, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    new_session = TrainingSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=session.name,
        meso_cycle_id=session.meso_cycle_id,
        micro_cycle_id=session.micro_cycle_id,
        scheduled_date=session.scheduled_date,
        status=session.status or "Scheduled",
        notes=session.notes
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    
    result = await db.execute(
        select(TrainingSession)
        .options(
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets),
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.exercise),
            selectinload(TrainingSession.health_metric)
        )
        .where(TrainingSession.id == new_session.id)
    )
    return result.scalar_one()

@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, session: SessionUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    for field, value in session.model_dump(exclude_unset=True).items():
        setattr(db_session, field, value)
    
    await db.commit()
    await db.refresh(db_session)
    
    result = await db.execute(
        select(TrainingSession)
        .options(
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets),
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.exercise),
            selectinload(TrainingSession.health_metric)
        )
        .where(TrainingSession.id == session_id)
    )
    return result.scalar_one()

@router.delete("/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Load session exercises to delete their sets first
    result = await db.execute(
        select(SessionExercise).where(SessionExercise.session_id == session_id)
    )
    for se in result.scalars().all():
        await db.execute(sa_delete(ExerciseSet).where(ExerciseSet.session_exercise_id == se.id))

    await db.execute(sa_delete(SessionExercise).where(SessionExercise.session_id == session_id))
    await db.execute(sa_delete(VolumeHistory).where(VolumeHistory.session_id == session_id))
    await db.execute(sa_delete(HealthMetric).where(HealthMetric.session_id == session_id))
    await db.delete(db_session)
    await db.commit()
    return {"message": "Session deleted"}

@router.post("/{session_id}/start")
async def start_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db_session.start_time = datetime.utcnow()
    db_session.status = "in_progress"
    if not db_session.actual_date:
        db_session.actual_date = datetime.utcnow().strftime("%Y-%m-%d")
    await db.commit()
    return {"message": "Session started", "start_time": db_session.start_time.isoformat()}

@router.get("/{session_id}/pre-summary")
async def get_session_pre_summary(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingSession)
        .options(
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets),
            selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.exercise),
        )
        .where(TrainingSession.id == session_id)
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    count_result = await db.execute(
        select(func.count(TrainingSession.id))
        .where(TrainingSession.user_id == db_session.user_id)
        .where(TrainingSession.status == 'completed')
    )
    workout_number = (count_result.scalar() or 0) + 1

    duration_seconds = None
    if db_session.start_time:
        duration_seconds = int((datetime.utcnow() - db_session.start_time).total_seconds())

    prs = []
    for se in db_session.session_exercises:
        completed = [s for s in se.sets if s.is_completed and not s.is_warmup and s.weight and s.weight > 0]
        if not completed:
            continue
        current_max = max(s.weight for s in completed)

        hist_result = await db.execute(
            select(func.max(ExerciseSet.weight))
            .join(SessionExercise, SessionExercise.id == ExerciseSet.session_exercise_id)
            .join(TrainingSession, TrainingSession.id == SessionExercise.session_id)
            .where(SessionExercise.exercise_id == se.exercise_id)
            .where(TrainingSession.user_id == db_session.user_id)
            .where(TrainingSession.id != session_id)
            .where(TrainingSession.status == 'completed')
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
        )
        hist_max = hist_result.scalar() or 0

        if current_max > hist_max:
            prs.append({
                "exercise_name": se.exercise.name,
                "old_max": float(hist_max),
                "new_max": float(current_max),
            })

    total_volume = sum(
        s.reps * s.weight
        for se in db_session.session_exercises
        for s in se.sets
        if s.is_completed and not s.is_warmup and s.reps and s.weight
    )
    completed_sets_count = sum(1 for se in db_session.session_exercises for s in se.sets if s.is_completed)
    total_sets_count = sum(len(se.sets) for se in db_session.session_exercises)

    return {
        "workout_number": workout_number,
        "duration_seconds": duration_seconds,
        "total_volume": total_volume,
        "completed_sets": completed_sets_count,
        "total_sets": total_sets_count,
        "exercise_count": len(db_session.session_exercises),
        "prs": prs,
    }


@router.post("/{session_id}/complete")
async def complete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingSession)
        .options(selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets))
        .where(TrainingSession.id == session_id)
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db_session.status = "completed"
    db_session.end_time = datetime.utcnow()
    if not db_session.actual_date:
        db_session.actual_date = datetime.utcnow().strftime("%Y-%m-%d")
    if not db_session.start_time:
        db_session.start_time = db_session.end_time
    
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
            db.add(volume_record)
    
    db_session.total_volume = total_volume
    await db.commit()
    return {"message": "Session completed", "total_volume": total_volume}

@router.post("/{session_id}/cancel")
async def cancel_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TrainingSession).where(TrainingSession.id == session_id))
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db_session.status = "cancelled"
    await db.commit()
    return {"message": "Session cancelled"}

@router.post("/{session_id}/exercises", response_model=SessionExerciseResponse)
async def add_exercise_to_session(session_id: str, exercise: SessionExerciseCreate, db: AsyncSession = Depends(get_db)):
    new_se = SessionExercise(
        id=str(uuid.uuid4()),
        session_id=session_id,
        exercise_id=exercise.exercise_id,
        order_index=exercise.order_index,
        notes=exercise.notes
    )
    db.add(new_se)
    await db.commit()

    result = await db.execute(
        select(SessionExercise)
        .options(
            selectinload(SessionExercise.exercise),
            selectinload(SessionExercise.sets),
        )
        .where(SessionExercise.id == new_se.id)
    )
    return result.scalar_one()

@router.put("/session-exercises/{se_id}", response_model=SessionExerciseResponse)
async def update_session_exercise(se_id: str, exercise: SessionExerciseUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SessionExercise).where(SessionExercise.id == se_id))
    db_se = result.scalar_one_or_none()
    if not db_se:
        raise HTTPException(status_code=404, detail="Session exercise not found")
    
    for field, value in exercise.model_dump(exclude_unset=True).items():
        setattr(db_se, field, value)
    
    await db.commit()
    await db.refresh(db_se)
    return db_se

@router.delete("/session-exercises/{se_id}")
async def remove_exercise_from_session(se_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SessionExercise).where(SessionExercise.id == se_id))
    db_se = result.scalar_one_or_none()
    if not db_se:
        raise HTTPException(status_code=404, detail="Session exercise not found")
    await db.delete(db_se)
    await db.commit()
    return {"message": "Exercise removed from session"}

@router.post("/session-exercises/{se_id}/sets", response_model=ExerciseSetResponse)
async def add_set_to_exercise(se_id: str, set_data: ExerciseSetCreate, db: AsyncSession = Depends(get_db)):
    new_set = ExerciseSet(
        id=str(uuid.uuid4()),
        session_exercise_id=se_id,
        set_number=set_data.set_number,
        reps=set_data.reps,
        weight=set_data.weight,
        rpe=set_data.rpe,
        is_warmup=set_data.is_warmup
    )
    db.add(new_set)
    await db.commit()
    await db.refresh(new_set)
    return new_set

@router.put("/exercise-sets/{set_id}", response_model=ExerciseSetResponse)
async def update_set(set_id: str, set_data: ExerciseSetUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExerciseSet).where(ExerciseSet.id == set_id))
    db_set = result.scalar_one_or_none()
    if not db_set:
        raise HTTPException(status_code=404, detail="Set not found")
    
    for field, value in set_data.model_dump(exclude_unset=True).items():
        setattr(db_set, field, value)
    
    await db.commit()
    await db.refresh(db_set)
    return db_set

@router.delete("/exercise-sets/{set_id}")
async def delete_set(set_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExerciseSet).where(ExerciseSet.id == set_id))
    db_set = result.scalar_one_or_none()
    if not db_set:
        raise HTTPException(status_code=404, detail="Set not found")
    await db.delete(db_set)
    await db.commit()
    return {"message": "Set deleted"}
