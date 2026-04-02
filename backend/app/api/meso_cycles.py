from fastapi import APIRouter, HTTPException, Header, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
import uuid
from ..database import async_session
from ..models import MesoCycle, MicroCycle
from ..schemas import MesoCycleCreate, MesoCycleUpdate, MesoCycleResponse
from ..schemas import MicroCycleCreate, MicroCycleUpdate, MicroCycleResponse
from ..deps import get_current_user_id

router = APIRouter(prefix="/api/meso-cycles", tags=["meso-cycles"])

@router.get("", response_model=List[MesoCycleResponse])
async def list_cycles(user_id: str = Depends(get_current_user_id)):
    async with async_session() as session:
        result = await session.execute(
            select(MesoCycle).where(MesoCycle.user_id == user_id)
        )
        cycles = result.scalars().all()
        return cycles

@router.get("/{cycle_id}", response_model=MesoCycleResponse)
async def get_cycle(cycle_id: str):
    async with async_session() as session:
        result = await session.execute(select(MesoCycle).where(MesoCycle.id == cycle_id))
        cycle = result.scalar_one_or_none()
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        return cycle

@router.post("", response_model=MesoCycleResponse)
async def create_cycle(cycle: MesoCycleCreate, user_id: str = Depends(get_current_user_id)):
    async with async_session() as session:
        new_cycle = MesoCycle(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=cycle.name,
            start_date=cycle.start_date,
            end_date=cycle.end_date,
            goal=cycle.goal,
            is_active=cycle.is_active
        )
        session.add(new_cycle)
        await session.commit()
        await session.refresh(new_cycle)
        return new_cycle

@router.put("/{cycle_id}", response_model=MesoCycleResponse)
async def update_cycle(cycle_id: str, cycle: MesoCycleUpdate):
    async with async_session() as session:
        result = await session.execute(select(MesoCycle).where(MesoCycle.id == cycle_id))
        db_cycle = result.scalar_one_or_none()
        if not db_cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        
        for field, value in cycle.model_dump(exclude_unset=True).items():
            setattr(db_cycle, field, value)
        
        await session.commit()
        await session.refresh(db_cycle)
        return db_cycle

@router.delete("/{cycle_id}")
async def delete_cycle(cycle_id: str):
    async with async_session() as session:
        result = await session.execute(select(MesoCycle).where(MesoCycle.id == cycle_id))
        cycle = result.scalar_one_or_none()
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        await session.delete(cycle)
        await session.commit()
        return {"message": "Cycle deleted"}

@router.get("/{cycle_id}/micro-cycles", response_model=List[MicroCycleResponse])
async def list_micro_cycles(cycle_id: str):
    async with async_session() as session:
        result = await session.execute(
            select(MicroCycle).where(MicroCycle.meso_cycle_id == cycle_id)
        )
        micro_cycles = result.scalars().all()
        return micro_cycles

@router.post("/{cycle_id}/micro-cycles", response_model=MicroCycleResponse)
async def create_micro_cycle(cycle_id: str, micro_cycle: MicroCycleCreate):
    async with async_session() as session:
        new_micro = MicroCycle(
            id=str(uuid.uuid4()),
            meso_cycle_id=cycle_id,
            week_number=micro_cycle.week_number,
            focus=micro_cycle.focus,
            start_date=micro_cycle.start_date,
            end_date=micro_cycle.end_date
        )
        session.add(new_micro)
        await session.commit()
        await session.refresh(new_micro)
        return new_micro
