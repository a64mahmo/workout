from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel
from datetime import date as date_type
from collections import OrderedDict
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet, SuggestionLog, MesoCycle, VolumeHistory
from ..deps import get_current_user_id

from ..services.progression import ProgressionService, SessionStats

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])

def _session_stats(sets: list) -> SessionStats:
    """Compute per-session stats from a list of set rows."""
    valid = [r for r in sets if r.weight and r.reps]
    volume = sum(float(r.weight) * int(r.reps) for r in valid)
    set_count = len(valid)
    top = max(valid, key=lambda r: float(r.weight)) if valid else None
    rpes = [float(r.rpe) for r in sets if r.rpe is not None]
    avg_rpe = round(sum(rpes) / len(rpes), 1) if rpes else None
    max_rpe = max(rpes) if rpes else None
    return SessionStats(
        volume=volume,
        set_count=set_count,
        top_weight=float(top.weight) if top else 0.0,
        top_reps=int(top.reps) if top and top.reps else None,
        avg_rpe=avg_rpe,
        max_rpe=max_rpe,
        date=sets[0].scheduled_date,
        meso_cycle_id=sets[0].meso_cycle_id,
    )


@router.get("/exercises")
async def suggest_exercises(user_id: str = Depends(get_current_user_id)):
    """
    Return exercises the user has trained, ranked by total all-time volume.
    Computed from VolumeHistory for performance.
    """
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.id,
                Exercise.name,
                Exercise.muscle_group,
                func.sum(VolumeHistory.total_volume).label("volume"),
                func.max(TrainingSession.scheduled_date).label("last_performed"),
            )
            .join(VolumeHistory, Exercise.id == VolumeHistory.exercise_id)
            .join(TrainingSession, VolumeHistory.session_id == TrainingSession.id)
            .where(VolumeHistory.user_id == user_id)
            .group_by(Exercise.id, Exercise.name, Exercise.muscle_group)
            .having(func.sum(VolumeHistory.total_volume) > 0)
            .order_by(func.sum(VolumeHistory.total_volume).desc())
        )

        exercises = result.all()
        suggestions = []

        for ex in exercises:
            volume = float(ex.volume)
            if volume > 50000:
                suggestion_reason = "High volume - maintain intensity"
            elif volume >= 10000:
                suggestion_reason = "Moderate volume - consider progression"
            else:
                suggestion_reason = "Lower volume - good candidate for more work"

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
    meso_cycle_id: str = Query(None),
):
    """
    RP-style hypertrophy suggestion engine.

    Progression arc (default 4-week meso):
      Week 1  - Light start, RPE ~7  (3 RIR) - build base volume
      Week 2  - Accumulate,  RPE ~7.5 (2.5 RIR) - add sets
      Week 3  - Intensify,   RPE ~8.5 (1.5 RIR) - add weight
      Week 4  - Peak,        RPE ~9.5 (0.5 RIR) - push to limit
      Deload  - ~65% weight, ~50% volume - recover and reset

    Volume autoregulation (RP feedback proxy via RPE):
      Last RPE < 7.0  → add 2 sets next week (too easy)
      Last RPE 7–7.5  → add 1 set next week
      Last RPE 7.5–9  → maintain or +1 set in accumulation
      Last RPE ≥ 9    → hold or cut 1 set (approaching MRV)

    Weight adjustment: 1 RPE unit ≈ 2.5% of working weight.
    Deload triggered when max_rpe ≥ 9.5 OR meso week exceeds total meso weeks.
    """
    async with async_session() as session:
        base = (
            select(
                ExerciseSet.weight,
                ExerciseSet.reps,
                ExerciseSet.rpe,
                TrainingSession.id.label("session_id"),
                TrainingSession.scheduled_date,
                TrainingSession.meso_cycle_id,
            )
            .join(SessionExercise, ExerciseSet.session_exercise_id == SessionExercise.id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .where(SessionExercise.exercise_id == exercise_id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
            .where(ExerciseSet.weight > 0)
            .order_by(TrainingSession.scheduled_date.desc())
        )

        if meso_cycle_id:
            base = base.where(TrainingSession.meso_cycle_id == meso_cycle_id)

        result = await session.execute(base.limit(300))
        rows = result.all()

        if not rows:
            return {
                "previous_weight": 0,
                "suggested_weight": 0,
                "average_rpe": None,
                "adjustment_reason": "No history - start light (RPE 6-7) and build up",
                "meso_week": 1,
                "meso_phase": "accumulation",
                "target_rpe": 7.0,
                "session_volume": 0,
                "set_count": 0,
                "previous_volume": None,
                "volume_trend": "none",
                "suggested_sets": 3,
                "volume_directive": "Start at MEV (~3-4 working sets), prioritise technique",
                # legacy
                "average_weight": 0,
                "suggestion": "No history - start light and build up",
                "percentage": 100,
            }

        # Group sets by session (OrderedDict preserves recency order)
        sessions_map: dict = OrderedDict()
        for row in rows:
            sid = row.session_id
            if sid not in sessions_map:
                sessions_map[sid] = []
            sessions_map[sid].append(row)

        session_ids = list(sessions_map.keys())
        last_stats = _session_stats(sessions_map[session_ids[0]])
        prev_stats = _session_stats(sessions_map[session_ids[1]]) if len(session_ids) > 1 else None

        last_weight = last_stats.top_weight
        avg_rpe = last_stats.avg_rpe
        max_rpe = last_stats.max_rpe
        vol_last = last_stats.volume
        set_count = last_stats.set_count

        # ── Meso week detection ───────────────────────────────────────────────
        meso_week = None
        meso_total_weeks = 4  # default 4-week meso

        if meso_cycle_id and last_stats.date:
            meso_result = await session.execute(
                select(MesoCycle).where(MesoCycle.id == meso_cycle_id)
            )
            meso_obj = meso_result.scalar_one_or_none()
            if meso_obj and meso_obj.start_date:
                try:
                    meso_start = date_type.fromisoformat(meso_obj.start_date)
                    last_d = date_type.fromisoformat(last_stats.date)
                    meso_week = max(1, (last_d - meso_start).days // 7 + 1)
                    if meso_obj.end_date:
                        end_d = date_type.fromisoformat(meso_obj.end_date)
                        meso_total_weeks = max(4, (end_d - meso_start).days // 7)
                except (ValueError, TypeError):
                    pass

        # Fallback: count distinct calendar weeks with sessions (recent 8 weeks)
        if meso_week is None:
            from datetime import timedelta
            today = date_type.today()
            cutoff = today - timedelta(weeks=8)
            distinct_weeks: set = set()
            for sets in sessions_map.values():
                d_str = sets[0].scheduled_date
                if d_str:
                    try:
                        d = date_type.fromisoformat(d_str)
                        if d >= cutoff:
                            distinct_weeks.add((d - cutoff).days // 7)
                    except (ValueError, TypeError):
                        pass
            meso_week = max(1, len(distinct_weeks)) if distinct_weeks else 1

        # ── Phase configuration & Suggestion Calculation ──────────────────────
        suggestion = ProgressionService.calculate_suggestion(
            last_stats, meso_week, meso_total_weeks
        )

        # ── Volume trend ──────────────────────────────────────────────────────
        vol_prev = prev_stats.volume if prev_stats else None
        vol_last = last_stats.volume
        if vol_prev is None:
            volume_trend = "no prior data"
        elif vol_last > vol_prev * 1.05:
            volume_trend = "increasing"
        elif vol_last < vol_prev * 0.95:
            volume_trend = "decreasing"
        else:
            volume_trend = "stable"

        response = {
            "previous_weight": round(last_stats.top_weight, 1),
            "suggested_weight": suggestion.suggested_weight,
            "average_rpe": last_stats.avg_rpe,
            "adjustment_reason": suggestion.adjustment_reason,
            # RP meso arc
            "meso_week": suggestion.meso_week,
            "meso_phase": suggestion.meso_phase,
            "meso_phase_label": suggestion.meso_phase_label,
            "target_rpe": suggestion.target_rpe,
            # Volume
            "session_volume": round(vol_last, 1),
            "set_count": last_stats.set_count,
            "previous_volume": round(vol_prev, 1) if vol_prev is not None else None,
            "volume_trend": volume_trend,
            # RP volume recommendation
            "suggested_sets": suggestion.suggested_sets,
            "volume_directive": suggestion.volume_directive,
            # Legacy fields (API compatibility)
            "average_weight": round(last_stats.top_weight, 1),
            "suggestion": suggestion.adjustment_reason,
            "percentage": round(suggestion.suggested_weight / last_stats.top_weight * 100, 1) if last_stats.top_weight else 100,
        }

        log = SuggestionLog(
            user_id=user_id,
            exercise_id=exercise_id,
            meso_cycle_id=meso_cycle_id,
            previous_weight=round(last_stats.top_weight, 1),
            average_rpe=last_stats.avg_rpe,
            suggested_weight=suggestion.suggested_weight,
            adjustment_reason=suggestion.adjustment_reason,
        )
        session.add(log)
        await session.commit()

        response["log_id"] = log.id
        return response


class SuggestionOutcome(BaseModel):
    actual_weight: Optional[float] = None
    actual_reps: Optional[int] = None
    actual_rpe: Optional[float] = None


@router.get("/weight/history")
async def suggestion_history(
    user_id: str = Depends(get_current_user_id),
    exercise_id: str = Query(None),
    meso_cycle_id: str = Query(None),
    limit: int = Query(20, le=100),
):
    """Return past suggestions for the user, optionally filtered by exercise or meso cycle."""
    async with async_session() as session:
        q = (
            select(SuggestionLog, Exercise.name.label("exercise_name"), Exercise.muscle_group)
            .join(Exercise, SuggestionLog.exercise_id == Exercise.id)
            .where(SuggestionLog.user_id == user_id)
        )
        if exercise_id:
            q = q.where(SuggestionLog.exercise_id == exercise_id)
        if meso_cycle_id:
            q = q.where(SuggestionLog.meso_cycle_id == meso_cycle_id)
        q = q.order_by(SuggestionLog.created_at.desc()).limit(limit)

        result = await session.execute(q)
        rows = result.all()

        return [
            {
                "id": row.SuggestionLog.id,
                "exercise_id": row.SuggestionLog.exercise_id,
                "exercise_name": row.exercise_name,
                "muscle_group": row.muscle_group,
                "meso_cycle_id": row.SuggestionLog.meso_cycle_id,
                "previous_weight": row.SuggestionLog.previous_weight,
                "suggested_weight": row.SuggestionLog.suggested_weight,
                "average_rpe": row.SuggestionLog.average_rpe,
                "adjustment_reason": row.SuggestionLog.adjustment_reason,
                "actual_weight": row.SuggestionLog.actual_weight,
                "actual_reps": row.SuggestionLog.actual_reps,
                "actual_rpe": row.SuggestionLog.actual_rpe,
                "created_at": row.SuggestionLog.created_at.isoformat() if row.SuggestionLog.created_at else None,
            }
            for row in rows
        ]


@router.patch("/weight/history/{log_id}")
async def record_suggestion_outcome(
    log_id: str,
    outcome: SuggestionOutcome,
    user_id: str = Depends(get_current_user_id),
):
    """Record what the user actually lifted after receiving a suggestion."""
    async with async_session() as session:
        result = await session.execute(
            select(SuggestionLog)
            .where(SuggestionLog.id == log_id)
            .where(SuggestionLog.user_id == user_id)
        )
        log = result.scalar_one_or_none()
        if not log:
            raise HTTPException(status_code=404, detail="Suggestion log not found")

        if outcome.actual_weight is not None:
            log.actual_weight = outcome.actual_weight
        if outcome.actual_reps is not None:
            log.actual_reps = outcome.actual_reps
        if outcome.actual_rpe is not None:
            log.actual_rpe = outcome.actual_rpe

        await session.commit()
        return {"message": "Outcome recorded", "log_id": log_id}


@router.get("/muscle-groups")
async def volume_by_muscle_group(user_id: str = Depends(get_current_user_id)):
    """All-time volume per muscle group, computed from VolumeHistory for performance."""
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.muscle_group,
                func.sum(VolumeHistory.total_volume).label("volume"),
            )
            .join(VolumeHistory, Exercise.id == VolumeHistory.exercise_id)
            .where(VolumeHistory.user_id == user_id)
            .group_by(Exercise.muscle_group)
        )

        groups = result.all()

        return {
            g.muscle_group: int(g.volume)
            for g in groups
            if g.volume and g.volume > 0
        }
