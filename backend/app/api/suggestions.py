from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel
from datetime import date as date_type
from collections import OrderedDict
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet, SuggestionLog, MesoCycle, VolumeHistory, PlanSession, PlanExercise
from ..deps import get_current_user_id

from ..services.progression import ProgressionService, SessionStats, SuggestionResult

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


def _epley_e1rm(weight: float, reps: int) -> float:
    """Estimate 1RM using Epley formula.  weight × (1 + reps/30)."""
    if reps <= 0 or weight <= 0:
        return weight
    if reps == 1:
        return weight
    return weight * (1 + reps / 30.0)


def _weight_for_rpe(e1rm: float, target_reps: int, target_rpe: float) -> float:
    """Back-calculate the working weight that should produce a given RPE at target reps.

    RPE maps to Reps-In-Reserve (RIR):  RIR = 10 - RPE
    The lifter can theoretically do (target_reps + RIR) total reps at that weight.
    We invert Epley:  weight = e1RM / (1 + effective_reps / 30)
    """
    rir = 10.0 - target_rpe
    effective_reps = target_reps + rir
    if effective_reps <= 0:
        return e1rm
    return e1rm / (1 + effective_reps / 30.0)


def _round_to_plate(weight: float) -> float:
    """Round to nearest 2.5 lbs for practical plate loading."""
    return round(round(weight / 2.5) * 2.5, 1)


@router.get("/weight")
async def suggest_weight(
    user_id: str = Depends(get_current_user_id),
    exercise_id: str = Query(...),
    meso_cycle_id: str = Query(None),
    session_id: str = Query(None),
):
    """
    RP-style hypertrophy suggestion engine with plan-aware periodisation.

    When a session_id is provided and links to a plan, the algorithm uses the 
    prescribed target RPE and reps. Otherwise, it follows the general 
    meso-cycle arc (accumulation -> peak -> deload).
    """
    async with async_session() as session:
        # ── Try to resolve plan context from the current session ──────────
        plan_target_rpe = None
        plan_target_reps = None
        plan_week_number = None
        plan_total_weeks = None

        if session_id:
            ts_result = await session.execute(
                select(TrainingSession.plan_session_id, TrainingSession.meso_cycle_id)
                .where(TrainingSession.id == session_id)
            )
            ts_row = ts_result.first()

            if ts_row and ts_row.plan_session_id:
                # Get week number from PlanSession
                ps_result = await session.execute(
                    select(PlanSession.week_number, PlanSession.plan_id)
                    .where(PlanSession.id == ts_row.plan_session_id)
                )
                ps_row = ps_result.first()
                if ps_row:
                    plan_week_number = ps_row.week_number

                    # Get total weeks in this plan
                    tw_result = await session.execute(
                        select(func.max(PlanSession.week_number))
                        .where(PlanSession.plan_id == ps_row.plan_id)
                    )
                    plan_total_weeks = tw_result.scalar() or plan_week_number

                # Look up target RPE and reps for this exercise in this plan session
                pe_result = await session.execute(
                    select(PlanExercise.target_rpe, PlanExercise.target_reps)
                    .where(PlanExercise.plan_session_id == ts_row.plan_session_id)
                    .where(PlanExercise.exercise_id == exercise_id)
                )
                pe_row = pe_result.first()
                if pe_row:
                    plan_target_rpe = float(pe_row.target_rpe) if pe_row.target_rpe else None
                    plan_target_reps = int(pe_row.target_reps) if pe_row.target_reps else None

            # Inherit meso_cycle_id from the session if not provided
            if not meso_cycle_id and ts_row and ts_row.meso_cycle_id:
                meso_cycle_id = ts_row.meso_cycle_id

        # ── Fetch exercise history ────────────────────────────────────────
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
                "meso_week": plan_week_number or 1,
                "meso_phase": "accumulation",
                "target_rpe": plan_target_rpe or 7.0,
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
        last_sets = sessions_map[session_ids[0]]
        last_stats = _session_stats(last_sets)
        prev_stats = _session_stats(sessions_map[session_ids[1]]) if len(session_ids) > 1 else None

        # ── Meso week detection ───────────────────────────────────────────────
        meso_week = plan_week_number
        meso_total_weeks = plan_total_weeks or 4

        if meso_week is None:
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

        # ── Suggestion Calculation ────────────────────────────────────────────
        if plan_target_rpe is not None and last_stats.top_reps:
            # Plan-specific logic (e1RM-based)
            target_reps = plan_target_reps or last_stats.top_reps
            
            # Compute e1RM estimate from last sets
            e1rm_estimates = []
            for s in last_sets:
                w, r = float(s.weight), int(s.reps) if s.reps else 0
                if w <= 0 or r <= 0:
                    continue
                if s.rpe is not None:
                    rir = 10.0 - float(s.rpe)
                    effective = r + rir
                    e1rm_estimates.append(w * (1 + effective / 30.0))
                else:
                    e1rm_estimates.append(_epley_e1rm(w, r))

            if e1rm_estimates:
                e1rm_estimates.sort()
                mid = len(e1rm_estimates) // 2
                e1rm = e1rm_estimates[mid] if len(e1rm_estimates) % 2 else (e1rm_estimates[mid - 1] + e1rm_estimates[mid]) / 2

                suggested_weight = _weight_for_rpe(e1rm, target_reps, plan_target_rpe)
                suggested_weight = _round_to_plate(suggested_weight)

                week_label = f"Week {plan_week_number}/{plan_total_weeks}" if plan_week_number and plan_total_weeks else f"Week {plan_week_number}" if plan_week_number else ""
                
                # Compare to last session
                diff = suggested_weight - last_stats.top_weight
                if abs(diff) < 0.1:
                    delta = "same as last session"
                elif diff > 0:
                    delta = f"+{_round_to_plate(diff)} lbs from last"
                else:
                    delta = f"{_round_to_plate(diff)} lbs from last"

                effort_label = f"RPE {plan_target_rpe}"
                reason = f"{week_label} · {effort_label} · {delta}" if week_label else f"{effort_label} · {delta}"
                
                # Volume autoregulation still useful for plans? 
                # For now use the same heuristic from ProgressionService based on the plan's target RPE
                # (We can pretend we are in 'intensification' phase if it's a plan)
                phase = "plan"
                suggested_sets = last_stats.set_count
                if last_stats.avg_rpe is not None:
                    if last_stats.avg_rpe < 7.5: suggested_sets += 1
                    elif last_stats.avg_rpe >= 9.0: suggested_sets = max(1, suggested_sets - 1)
                
                suggestion = SuggestionResult(
                    suggested_weight=suggested_weight,
                    adjustment_reason=reason,
                    meso_week=meso_week,
                    meso_phase=phase,
                    meso_phase_label="Programmed" if not week_label else f"Programmed ({week_label})",
                    target_rpe=plan_target_rpe,
                    suggested_sets=min(suggested_sets, 12),
                    volume_directive="Follow plan volume",
                    estimated_1rm=round(e1rm, 1)
                )
            else:
                # Fallback to general logic if no usable sets for e1RM
                suggestion = ProgressionService.calculate_suggestion(
                    last_stats, meso_week, meso_total_weeks
                )
        else:
            # General RP logic
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
            "estimated_1rm": suggestion.estimated_1rm,
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
async def record_outcome(
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
