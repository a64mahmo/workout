from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List
import uuid
from app.database import async_session, init_db
from app.models import Exercise, TrainingSession, SessionExercise, ExerciseSet
from app.schemas import ExerciseResponse, SessionResponse, SessionExerciseResponse

app = FastAPI(title="Workout Tracker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/exercises", response_model=List[ExerciseResponse])
async def list_exercises(muscle_group: str = None):
    async with async_session() as session:
        query = select(Exercise)
        if muscle_group:
            query = query.where(Exercise.muscle_group == muscle_group)
        result = await session.execute(query)
        return result.scalars().all()

@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(user_id: str = Query(...), name: str = Query(...)):
    async with async_session() as session:
        new_session = TrainingSession(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            status="scheduled"
        )
        session.add(new_session)
        await session.commit()
        return new_session

@app.get("/api/sessions", response_model=List[SessionResponse])
async def list_sessions(user_id: str = Query(...)):
    async with async_session() as session:
        result = await session.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.session_exercises).selectinload(SessionExercise.sets))
            .where(TrainingSession.user_id == user_id)
        )
        return result.scalars().all()

@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
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

@app.post("/api/sessions/{session_id}/exercises", response_model=SessionExerciseResponse)
async def add_exercise(session_id: str, exercise_id: str = Query(...)):
    async with async_session() as session:
        new_se = SessionExercise(
            id=str(uuid.uuid4()),
            session_id=session_id,
            exercise_id=exercise_id
        )
        session.add(new_se)
        await session.commit()
        result = await session.execute(
            select(SessionExercise)
            .options(selectinload(SessionExercise.sets))
            .where(SessionExercise.id == new_se.id)
        )
        return result.scalar_one()

@app.post("/api/sessions/{session_id}/exercises/{se_id}/sets", response_model=dict)
async def add_set(session_id: str, se_id: str, set_number: int = Query(...), reps: int = Query(...), weight: float = Query(...)):
    async with async_session() as session:
        new_set = ExerciseSet(
            id=str(uuid.uuid4()),
            session_exercise_id=se_id,
            set_number=set_number,
            reps=reps,
            weight=weight
        )
        session.add(new_set)
        await session.commit()
        return {"id": new_set.id, "set_number": new_set.set_number, "reps": new_set.reps, "weight": new_set.weight}

@app.put("/api/sessions/exercise-sets/{set_id}")
async def update_set(set_id: str, reps: int = Query(None), weight: float = Query(None), is_completed: bool = Query(None)):
    async with async_session() as session:
        result = await session.execute(select(ExerciseSet).where(ExerciseSet.id == set_id))
        db_set = result.scalar_one_or_none()
        if not db_set:
            raise HTTPException(status_code=404, detail="Set not found")
        if reps is not None:
            db_set.reps = reps
        if weight is not None:
            db_set.weight = weight
        if is_completed is not None:
            db_set.is_completed = is_completed
        await session.commit()
        return {"id": db_set.id}
