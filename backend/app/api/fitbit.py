from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.models import User, TrainingSession
from app.schemas.schemas import FitbitAuthUrl, FitbitCallback, SessionResponse
from app.services.fitbit_service import FitbitService
from app.deps import get_current_user_id
from typing import List
import uuid

router = APIRouter(prefix="/api/fitbit", tags=["fitbit"])
fitbit_service = FitbitService()


async def _get_user(user_id: str, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/auth-url", response_model=FitbitAuthUrl)
async def get_fitbit_auth_url(user_id: str = Depends(get_current_user_id)):
    state = str(uuid.uuid4())
    url = fitbit_service.get_auth_url(state)
    return {"url": url}


@router.post("/callback")
async def fitbit_callback(
    data: FitbitCallback,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_user(user_id, db)
    await fitbit_service.exchange_code(data.code, db, user)
    return {"message": "Fitbit connected successfully"}


@router.post("/disconnect")
async def disconnect_fitbit(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_user(user_id, db)
    user.fitbit_access_token = None
    user.fitbit_refresh_token = None
    user.fitbit_user_id = None
    user.fitbit_token_expires_at = None
    await db.commit()
    return {"message": "Fitbit disconnected"}


@router.get("/status")
async def fitbit_status(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_user(user_id, db)
    return {"connected": bool(user.fitbit_access_token)}


@router.get("/today-stats")
async def fitbit_today_stats(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_user(user_id, db)
    if not user.fitbit_access_token:
        return {"connected": False}
    return await fitbit_service.get_today_stats(db, user)


@router.post("/sync-session/{session_id}", response_model=SessionResponse)
async def sync_session_metrics(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    from app.models.models import SessionExercise

    user = await _get_user(user_id, db)

    if not user.fitbit_access_token:
        raise HTTPException(status_code=400, detail="Fitbit not connected")

    stmt = (
        select(TrainingSession)
        .where(TrainingSession.id == session_id, TrainingSession.user_id == user_id)
        .options(
            joinedload(TrainingSession.session_exercises).joinedload(SessionExercise.exercise),
            joinedload(TrainingSession.session_exercises).joinedload(SessionExercise.sets),
            joinedload(TrainingSession.health_metric),
        )
    )

    result = await db.execute(stmt)
    session = result.scalars().first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await fitbit_service.sync_session_metrics(db, session, user)
    await db.commit()

    result = await db.execute(stmt)
    return result.scalars().first()
