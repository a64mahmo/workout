from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel
from datetime import date as date_type
from collections import OrderedDict
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet, SuggestionLog, MesoCycle
from ..deps import get_current_user_id

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])

# ── RP meso phase configuration ────────────────────────────────────────────────
# Default 4-week arc: Week 1 light (RPE 7) → Week 4 peak (RPE 10) → Deload
# Scales to longer mesos using fractional week position.

_MESO_ARC = [
    # (min_week, max_week_fraction, phase, target_rpe, volume_directive)
    # Accessed via get_phase_config(week, total_weeks)
]

def _get_phase_config(week: int, total_weeks: int, just_hit_peak: bool) -> dict:
    """
    Returns RP phase config based on meso week position.
    Arc: accumulation (W1) → intensification (W2-3) → peak (W4) → deload
    Scales to any meso length by using fractional position.
    """
    if just_hit_peak:
        return {
            "phase": "deload",
            "label": "Deload - Reset & recover",
            "target_rpe": 5.5,
            "weight_modifier": 0.65,
            "volume_directive": "Drop to ~50% of peak volume and ~65% of peak weight",
        }

    # Fractional position in meso: 0.0 = start, 1.0 = end
    position = (week - 1) / max(total_weeks - 1, 1)

    if week > total_weeks:
        return {
            "phase": "deload",
            "label": f"Deload (past week {total_weeks})",
            "target_rpe": 5.5,
            "weight_modifier": 0.65,
            "volume_directive": "Drop to ~50% of peak volume and ~65% of peak weight",
        }
    elif position < 0.15:
        return {
            "phase": "accumulation",
            "label": f"Week {week} - Light start (form & feel)",
            "target_rpe": 7.0,
            "weight_modifier": None,
            "volume_directive": "Start at MEV (~3-4 working sets), prioritise technique",
        }
    elif position < 0.55:
        # Scale target RPE from 7.5 → 8.5 through accumulation
        target = round(7.5 + (position - 0.15) / 0.40 * 1.0, 1)
        return {
            "phase": "accumulation",
            "label": f"Week {week} - Accumulate volume",
            "target_rpe": target,
            "weight_modifier": None,
            "volume_directive": "Add 1 set if recovery allows (low soreness/fatigue)",
        }
    elif position < 0.85:
        target = round(8.5 + (position - 0.55) / 0.30 * 0.5, 1)
        return {
            "phase": "intensification",
            "label": f"Week {week} - Intensify",
            "target_rpe": target,
            "weight_modifier": None,
            "volume_directive": "Approach MRV, maintain or cut 1 set if very sore",
        }
    else:
        return {
            "phase": "peak",
            "label": f"Week {week} - Peak effort",
            "target_rpe": 9.5,
            "weight_modifier": None,
            "volume_directive": "Final push - hold volume, max intensity, deload follows",
        }


def _session_stats(sets: list) -> dict:
    """Compute per-session stats from a list of set rows."""
    valid = [r for r in sets if r.weight and r.reps]
    volume = sum(float(r.weight) * int(r.reps) for r in valid)
    set_count = len(valid)
    top = max(valid, key=lambda r: float(r.weight)) if valid else None
    rpes = [float(r.rpe) for r in sets if r.rpe is not None]
    avg_rpe = round(sum(rpes) / len(rpes), 1) if rpes else None
    max_rpe = max(rpes) if rpes else None
    return {
        "volume": volume,
        "set_count": set_count,
        "top_weight": float(top.weight) if top else 0.0,
        "top_reps": int(top.reps) if top and top.reps else None,
        "avg_rpe": avg_rpe,
        "max_rpe": max_rpe,
        "date": sets[0].scheduled_date,
        "meso_cycle_id": sets[0].meso_cycle_id,
    }


@router.get("/exercises")
async def suggest_exercises(user_id: str = Depends(get_current_user_id)):
    """
    Return exercises the user has trained, ranked by total all-time volume.
    Computed directly from ExerciseSet.
    """
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.id,
                Exercise.name,
                Exercise.muscle_group,
                func.sum(ExerciseSet.reps * ExerciseSet.weight).label("volume"),
                func.max(TrainingSession.scheduled_date).label("last_performed"),
            )
            .join(SessionExercise, Exercise.id == SessionExercise.exercise_id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .join(ExerciseSet, ExerciseSet.session_exercise_id == SessionExercise.id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.is_warmup == False)
            .where(ExerciseSet.weight != None)
            .where(ExerciseSet.reps != None)
            .group_by(Exercise.id, Exercise.name, Exercise.muscle_group)
            .having(func.sum(ExerciseSet.reps * ExerciseSet.weight) > 0)
            .order_by(func.sum(ExerciseSet.reps * ExerciseSet.weight).desc())
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

        last_weight = last_stats["top_weight"]
        avg_rpe = last_stats["avg_rpe"]
        max_rpe = last_stats["max_rpe"]
        vol_last = last_stats["volume"]
        set_count = last_stats["set_count"]

        # ── Meso week detection ───────────────────────────────────────────────
        meso_week = None
        meso_total_weeks = 4  # default 4-week meso

        if meso_cycle_id and last_stats["date"]:
            meso_result = await session.execute(
                select(MesoCycle).where(MesoCycle.id == meso_cycle_id)
            )
            meso_obj = meso_result.scalar_one_or_none()
            if meso_obj and meso_obj.start_date:
                try:
                    meso_start = date_type.fromisoformat(meso_obj.start_date)
                    last_d = date_type.fromisoformat(last_stats["date"])
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

        # ── Phase configuration ───────────────────────────────────────────────
        just_hit_peak = max_rpe is not None and max_rpe >= 9.5
        phase_cfg = _get_phase_config(meso_week, meso_total_weeks, just_hit_peak)
        phase = phase_cfg["phase"]
        target_rpe = phase_cfg["target_rpe"]
        volume_directive = phase_cfg["volume_directive"]

        # ── Weight suggestion ─────────────────────────────────────────────────
        if phase == "deload":
            modifier = phase_cfg["weight_modifier"] or 0.65
            suggested = last_weight * modifier
            parts = [f"DELOAD"]
            if just_hit_peak:
                parts.append(f"peak RPE {max_rpe} reached")
            parts.append(f"reset to {round(suggested, 1)} lbs ({int(modifier*100)}% of {last_weight} lbs)")
            parts.append(f"target RPE {target_rpe}")

        elif avg_rpe is None:
            # No RPE logged - simple 2.5 lb progression
            suggested = last_weight + 2.5
            parts = [
                f"Week {meso_week} {phase}",
                f"target RPE {target_rpe}",
                "no RPE logged - add 2.5 lbs and track effort next session",
            ]

        else:
            # RPE-delta weight adjustment: 1 RPE unit ≈ 2.5% of working weight
            rpe_delta = target_rpe - avg_rpe
            pct_change = max(-0.15, min(0.10, rpe_delta * 0.025))
            suggested = last_weight * (1 + pct_change)
            # Round to 2.5 first so delta_lbs reflects what we'll actually suggest
            suggested = round(round(suggested / 2.5) * 2.5, 1)
            delta_lbs = round(suggested - last_weight, 1)

            if abs(rpe_delta) <= 0.4 or delta_lbs == 0:
                parts = [
                    f"Week {meso_week} {phase}",
                    f"RPE {avg_rpe} ≈ target {target_rpe}",
                    "maintain weight, focus on reps and execution",
                ]
            elif delta_lbs > 0:
                parts = [
                    f"Week {meso_week} {phase}",
                    f"RPE {avg_rpe} → target {target_rpe}",
                    f"add {delta_lbs} lbs (+{round(abs(pct_change)*100, 1)}%)",
                ]
            else:
                parts = [
                    f"Week {meso_week} {phase}",
                    f"RPE {avg_rpe} → target {target_rpe}",
                    f"reduce {abs(delta_lbs)} lbs ({round(abs(pct_change)*100, 1)}%)",
                ]

        # For non-RPE branches, round to nearest 2.5 here
        if phase != "deload" and avg_rpe is not None:
            pass  # already rounded above
        else:
            suggested = round(round(suggested / 2.5) * 2.5, 1)
        reason = " | ".join(parts)

        # ── Volume autoregulation (RP feedback via RPE proxy) ─────────────────
        # RP rules: 1s (easy) → +2-3 sets, 2s → +1 set, 3s → hold, 4s → deload
        # Proxy: RPE < 7 ≈ easy (1s), 7-7.5 ≈ moderate (2s), 7.5-9 ≈ solid (3s), 9+ ≈ hard (4s)
        if phase == "deload":
            suggested_sets = max(2, set_count // 2)
        elif avg_rpe is None:
            suggested_sets = set_count + 1  # no data, default to adding a set
        elif avg_rpe < 7.0:
            suggested_sets = set_count + 2   # very easy → add 2 sets
        elif avg_rpe < 7.5:
            suggested_sets = set_count + 1   # moderate → add 1 set
        elif avg_rpe < 9.0:
            # solid effort - add 1 in accumulation, hold in intensification/peak
            suggested_sets = set_count + 1 if phase == "accumulation" else set_count
        else:
            # high RPE - hold or cut 1 set (approaching MRV)
            suggested_sets = max(1, set_count - 1) if phase == "peak" else set_count

        suggested_sets = min(suggested_sets, 12)  # cap at reasonable MRV

        # ── Volume trend ──────────────────────────────────────────────────────
        vol_prev = prev_stats["volume"] if prev_stats else None
        if vol_prev is None:
            volume_trend = "no prior data"
        elif vol_last > vol_prev * 1.05:
            volume_trend = "increasing"
        elif vol_last < vol_prev * 0.95:
            volume_trend = "decreasing"
        else:
            volume_trend = "stable"

        response = {
            "previous_weight": round(last_weight, 1),
            "suggested_weight": suggested,
            "average_rpe": avg_rpe,
            "adjustment_reason": reason,
            # RP meso arc
            "meso_week": meso_week,
            "meso_phase": phase,
            "meso_phase_label": phase_cfg["label"],
            "target_rpe": target_rpe,
            # Volume
            "session_volume": round(vol_last, 1),
            "set_count": set_count,
            "previous_volume": round(vol_prev, 1) if vol_prev is not None else None,
            "volume_trend": volume_trend,
            # RP volume recommendation
            "suggested_sets": suggested_sets,
            "volume_directive": volume_directive,
            # Legacy fields (API compatibility)
            "average_weight": round(last_weight, 1),
            "suggestion": reason,
            "percentage": round(suggested / last_weight * 100, 1) if last_weight else 100,
        }

        log = SuggestionLog(
            user_id=user_id,
            exercise_id=exercise_id,
            meso_cycle_id=meso_cycle_id,
            previous_weight=round(last_weight, 1),
            average_rpe=avg_rpe,
            suggested_weight=suggested,
            adjustment_reason=reason,
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
    """All-time volume per muscle group, computed directly from ExerciseSet."""
    async with async_session() as session:
        result = await session.execute(
            select(
                Exercise.muscle_group,
                func.sum(ExerciseSet.reps * ExerciseSet.weight).label("volume"),
            )
            .join(SessionExercise, Exercise.id == SessionExercise.exercise_id)
            .join(TrainingSession, SessionExercise.session_id == TrainingSession.id)
            .join(ExerciseSet, ExerciseSet.session_exercise_id == SessionExercise.id)
            .where(TrainingSession.user_id == user_id)
            .where(TrainingSession.status == "completed")
            .where(ExerciseSet.is_completed == True)
            .where(ExerciseSet.weight != None)
            .where(ExerciseSet.reps != None)
            .group_by(Exercise.muscle_group)
        )

        groups = result.all()

        return {
            g.muscle_group: int(g.volume)
            for g in groups
            if g.volume and g.volume > 0
        }
