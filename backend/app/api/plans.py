from fastapi import APIRouter, Depends, HTTPException, Query
from app.deps import get_current_user_id
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional, List, Any
from pydantic import BaseModel, field_serializer, Field
from datetime import datetime

from app.database import get_db
from app.models.models import Plan, PlanSession, PlanExercise, Exercise, TrainingSession

router = APIRouter(prefix="/api/plans", tags=["plans"])


class ExerciseBase(BaseModel):
    id: str
    name: str
    muscle_group: str
    category: str = 'weighted'

class PlanExerciseCreate(BaseModel):
    exercise_id: str
    order_index: int = 0
    target_sets: Optional[int] = 3
    target_reps: Optional[int] = 10
    target_weight: Optional[float] = None
    target_rpe: Optional[float] = None
    rest_seconds: Optional[int] = 60
    notes: Optional[str] = None

class PlanExerciseResponse(BaseModel):
    id: str
    plan_session_id: str
    exercise_id: str
    order_index: int
    target_sets: Optional[int] = 3
    target_reps: Optional[int] = 10
    target_weight: Optional[float] = None
    rest_seconds: Optional[int] = 60
    notes: Optional[str] = None
    exercise: Optional[ExerciseBase] = None

    model_config = {"from_attributes": True}

class PlanSessionCreate(BaseModel):
    name: str
    week_number: int = 1
    order_index: int = 0
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None

class PlanSessionResponse(BaseModel):
    id: str
    plan_id: str
    name: str
    week_number: int = 1
    order_index: int = 0
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None
    exercises: List[PlanExerciseResponse] = []

    model_config = {"from_attributes": True}

class PlanCreate(BaseModel):
    name: str
    description: Optional[str] = None

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class PlanResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str]
    is_active: bool
    created_at: Optional[Any] = None
    plan_sessions: List[PlanSessionResponse] = Field(default=[], validation_alias="sessions")
    meso_cycle_id: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}

    @field_serializer('created_at')
    def serialize_datetime(self, value):
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

class PlanSessionUpdate(BaseModel):
    name: Optional[str] = None
    week_number: Optional[int] = None
    order_index: Optional[int] = None
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None

class PlanExerciseUpdate(BaseModel):
    exercise_id: Optional[str] = None
    order_index: Optional[int] = None
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    target_rpe: Optional[float] = None
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None


@router.get("", response_model=List[PlanResponse])
async def get_plans(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Plan)
        .options(selectinload(Plan.sessions).selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(Plan.user_id == user_id)
        .order_by(Plan.created_at.desc())
    )
    plans = result.scalars().all()
    return plans


@router.get("/templates")
async def get_templates():
    return {
        "templates": [
            {"id": "ppl", "name": "Push/Pull/Legs", "description": "6-day split"},
            {"id": "upper-lower", "name": "Upper/Lower", "description": "4-day split"},
            {"id": "full-body", "name": "Full Body", "description": "3-day split"}
        ]
    }


@router.get("/templates/{template_id}")
async def get_template(template_id: str):
    templates = {
        "ppl": {
            "name": "Push/Pull/Legs",
            "days": [
                {"day": 1, "name": "Push", "muscle_groups": ["chest", "shoulders", "triceps"]},
                {"day": 2, "name": "Pull", "muscle_groups": ["back", "biceps"]},
                {"day": 3, "name": "Legs", "muscle_groups": ["legs", "core"]},
            ]
        },
        "upper-lower": {
            "name": "Upper/Lower",
            "days": [
                {"day": 1, "name": "Upper", "muscle_groups": ["chest", "back", "shoulders", "biceps", "triceps"]},
                {"day": 2, "name": "Lower", "muscle_groups": ["legs", "core"]},
            ]
        },
        "full-body": {
            "name": "Full Body",
            "days": [
                {"day": 1, "name": "Full Body A", "muscle_groups": ["chest", "back", "legs"]},
                {"day": 2, "name": "Full Body B", "muscle_groups": ["shoulders", "biceps", "triceps", "core"]},
            ]
        }
    }
    return templates.get(template_id, {"error": "Template not found"})


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(
    plan_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Plan)
        .options(selectinload(Plan.sessions).selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(Plan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.post("", response_model=PlanResponse)
async def create_plan(
    plan_data: PlanCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    plan = Plan(user_id=user_id, name=plan_data.name, description=plan_data.description)
    db.add(plan)
    await db.commit()
    
    result = await db.execute(
        select(Plan)
        .options(selectinload(Plan.sessions).selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(Plan.id == plan.id)
    )
    return result.scalar_one()


@router.put("/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: str,
    plan_data: PlanUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Plan)
        .options(selectinload(Plan.sessions).selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(Plan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan_data.name is not None:
        plan.name = plan_data.name
    if plan_data.description is not None:
        plan.description = plan_data.description
    await db.commit()
    await db.refresh(plan)
    result = await db.execute(
        select(Plan)
        .options(selectinload(Plan.sessions).selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(Plan.id == plan_id)
    )
    return result.scalar_one()


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    await db.delete(plan)
    await db.commit()
    return {"message": "Plan deleted"}


@router.post("/{plan_id}/sessions", response_model=PlanSessionResponse)
async def create_plan_session(
    plan_id: str,
    session_data: PlanSessionCreate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    session = PlanSession(
        plan_id=plan_id,
        name=session_data.name,
        week_number=session_data.week_number,
        order_index=session_data.order_index,
        scheduled_date=session_data.scheduled_date,
        notes=session_data.notes
    )
    db.add(session)
    await db.commit()
    
    result = await db.execute(
        select(PlanSession)
        .options(selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(PlanSession.id == session.id)
    )
    return result.scalar_one()


@router.put("/plan-sessions/{session_id}", response_model=PlanSessionResponse)
async def update_plan_session(
    session_id: str,
    session_data: PlanSessionUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PlanSession)
        .options(selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(PlanSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Plan session not found")
    
    if session_data.name is not None:
        session.name = session_data.name
    if session_data.week_number is not None:
        session.week_number = session_data.week_number
    if session_data.scheduled_date is not None:
        session.scheduled_date = session_data.scheduled_date
    if session_data.notes is not None:
        session.notes = session_data.notes
    if session_data.order_index is not None:
        session.order_index = session_data.order_index
    
    await db.commit()
    
    result = await db.execute(
        select(PlanSession)
        .options(selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(PlanSession.id == session_id)
    )
    return result.scalar_one()


@router.delete("/plan-sessions/{session_id}")
async def delete_plan_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(PlanSession).where(PlanSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Plan session not found")
    await db.delete(session)
    await db.commit()
    return {"message": "Plan session deleted"}


@router.post("/plan-sessions/{session_id}/exercises", response_model=PlanExerciseResponse)
async def add_plan_exercise(
    session_id: str,
    exercise_data: PlanExerciseCreate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(PlanSession).where(PlanSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Plan session not found")
    
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_data.exercise_id))
    exercise = result.scalar_one_or_none()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    plan_exercise = PlanExercise(
        plan_session_id=session_id,
        exercise_id=exercise_data.exercise_id,
        order_index=exercise_data.order_index,
        target_sets=exercise_data.target_sets,
        target_reps=exercise_data.target_reps,
        target_weight=exercise_data.target_weight,
        target_rpe=exercise_data.target_rpe,
        rest_seconds=exercise_data.rest_seconds,
        notes=exercise_data.notes
    )
    db.add(plan_exercise)
    await db.commit()
    await db.refresh(plan_exercise)
    plan_exercise.exercise = exercise
    return plan_exercise


@router.put("/plan-exercises/{exercise_id}", response_model=PlanExerciseResponse)
async def update_plan_exercise(
    exercise_id: str,
    exercise_data: PlanExerciseUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PlanExercise)
        .options(selectinload(PlanExercise.exercise))
        .where(PlanExercise.id == exercise_id)
    )
    plan_exercise = result.scalar_one_or_none()
    if not plan_exercise:
        raise HTTPException(status_code=404, detail="Plan exercise not found")
    
    if exercise_data.exercise_id is not None:
        plan_exercise.exercise_id = exercise_data.exercise_id
    if exercise_data.order_index is not None:
        plan_exercise.order_index = exercise_data.order_index
    if exercise_data.target_sets is not None:
        plan_exercise.target_sets = exercise_data.target_sets
    if exercise_data.target_reps is not None:
        plan_exercise.target_reps = exercise_data.target_reps
    if exercise_data.target_weight is not None:
        plan_exercise.target_weight = exercise_data.target_weight
    if exercise_data.target_rpe is not None:
        plan_exercise.target_rpe = exercise_data.target_rpe
    if exercise_data.rest_seconds is not None:
        plan_exercise.rest_seconds = exercise_data.rest_seconds
    if exercise_data.notes is not None:
        plan_exercise.notes = exercise_data.notes
    
    await db.commit()
    await db.refresh(plan_exercise)
    return plan_exercise


@router.delete("/plan-exercises/{exercise_id}")
async def delete_plan_exercise(
    exercise_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(PlanExercise).where(PlanExercise.id == exercise_id))
    plan_exercise = result.scalar_one_or_none()
    if not plan_exercise:
        raise HTTPException(status_code=404, detail="Plan exercise not found")
    await db.delete(plan_exercise)
    await db.commit()
    return {"message": "Plan exercise deleted"}


@router.get("/plan-sessions/{session_id}/preview")
async def preview_plan_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PlanSession)
        .options(selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(PlanSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Plan session not found")
    
    suggestions = []
    for pe in sorted(session.exercises, key=lambda x: x.order_index):
        exercise_data = pe.exercise
        suggestions.append({
            "plan_exercise_id": pe.id,
            "exercise": {
                "id": exercise_data.id if exercise_data else "",
                "name": exercise_data.name if exercise_data else "Unknown",
                "muscle_group": exercise_data.muscle_group if exercise_data else "Unknown",
                "description": None,
                "created_at": None
            } if exercise_data else {"id": "", "name": "Unknown", "muscle_group": "Unknown", "description": None, "created_at": None},
            "target_sets": pe.target_sets or 3,
            "target_reps": int(pe.target_reps) if pe.target_reps else 10,
            "suggested_weight": pe.target_weight,
            "previous_weight": None,
            "suggestion_reason": "Based on your plan",
            "rest_seconds": pe.rest_seconds or 60
        })
    
    return suggestions


@router.post("/plan-sessions/{session_id}/apply")
async def apply_plan_session(
    session_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import SessionExercise, ExerciseSet

    training_session_id = body.get("training_session_id")
    overrides = body.get("overrides", [])
    
    result = await db.execute(
        select(PlanSession)
        .options(selectinload(PlanSession.exercises).selectinload(PlanExercise.exercise))
        .where(PlanSession.id == session_id)
    )
    plan_session = result.scalar_one_or_none()
    if not plan_session:
        raise HTTPException(status_code=404, detail="Plan session not found")
    
    result = await db.execute(select(Plan).where(Plan.id == plan_session.plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    override_map = {o.get("plan_exercise_id"): o for o in overrides}

    # Record which plan session was applied on the training session
    ts_result = await db.execute(select(TrainingSession).where(TrainingSession.id == training_session_id))
    training_session = ts_result.scalar_one_or_none()
    if training_session:
        training_session.plan_session_id = plan_session.id

    for pe in sorted(plan_session.exercises, key=lambda x: x.order_index):
        override = override_map.get(pe.id, {})
        if not override.get("include", True):
            continue

        session_exercise = SessionExercise(
            session_id=training_session_id,
            exercise_id=pe.exercise_id,
            order_index=pe.order_index,
            notes=pe.notes
        )
        db.add(session_exercise)
        await db.flush()

        target_weight = override.get("weight") or pe.target_weight or 0

        for set_num in range(1, (pe.target_sets or 3) + 1):
            exercise_set = ExerciseSet(
                session_exercise_id=session_exercise.id,
                set_number=set_num,
                reps=pe.target_reps or 10,
                weight=float(target_weight) if target_weight else 0.0,
                is_completed=False
            )
            db.add(exercise_set)

    await db.commit()

    return {"message": "Plan session applied"}


@router.get("/progress")
async def get_plans_progress(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Return progress for all of the user's plans.
    Maps plan_id → { current_week, last_completed_at, last_session_name, completed_session_ids }
    """
    result = await db.execute(
        select(TrainingSession, PlanSession)
        .join(PlanSession, TrainingSession.plan_session_id == PlanSession.id)
        .where(
            TrainingSession.user_id == user_id,
            TrainingSession.plan_session_id.isnot(None),
        )
        .order_by(TrainingSession.actual_date.desc().nullslast(), TrainingSession.scheduled_date.desc())
    )
    rows = result.all()

    progress: dict = {}
    for ts, ps in rows:
        plan_id = ps.plan_id
        if plan_id not in progress:
            progress[plan_id] = {
                "current_week": ps.week_number,
                "last_completed_at": ts.actual_date or ts.scheduled_date,
                "last_session_name": ps.name,
                "completed_session_ids": [],
            }
        progress[plan_id]["completed_session_ids"].append(ps.id)

    return progress
