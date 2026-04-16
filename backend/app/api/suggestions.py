from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet, SuggestionLog, PlanSession, PlanExercise, MicroCycle
from ..deps import get_current_user_id

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("/exercises")
async def suggest_exercises(user_id: str = Depends(get_current_user_id)):
    """
    Return exercises the user has trained, ranked by total all-time volume.
    Computed directly from ExerciseSet so it works even without VolumeHistory.
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
                suggestion_reason = "High volume — maintain intensity"
            elif volume >= 10000:
                suggestion_reason = "Moderate volume — consider progression"
            else:
                suggestion_reason = "Lower volume — good candidate for more work"

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
    RP-style weight suggestion with week-aware periodisation.

    When a session_id is provided and links to a plan, the algorithm:
    1. Looks up the PlanExercise to find the target_rpe and target_reps for
       this exercise in the current week of the program.
    2. Estimates the lifter's e1RM from recent performance using the Epley
       formula:  e1RM = weight × (1 + reps / 30).
    3. Back-calculates the weight that should produce the target RPE at the
       prescribed rep count:
         RIR = 10 − target_rpe
         effective_reps = target_reps + RIR
         suggested_weight = e1RM / (1 + effective_reps / 30)

    Falls back to the original RPE-threshold heuristic when no plan context
    is available.
    """
    async with async_session() as session:
        # ── Try to resolve plan context from the current session ──────────
        plan_target_rpe = None
        plan_target_reps = None
        week_number = None
        total_weeks = None

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
                    week_number = ps_row.week_number

                    # Get total weeks in this plan
                    tw_result = await session.execute(
                        select(func.max(PlanSession.week_number))
                        .where(PlanSession.plan_id == ps_row.plan_id)
                    )
                    total_weeks = tw_result.scalar() or week_number

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
                ExerciseSet.set_number,
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

        result = await session.execute(base.limit(200))
        rows = result.all()

        if not rows:
            return {
                "previous_weight": 0,
                "suggested_weight": 0,
                "average_rpe": None,
                "adjustment_reason": "No history — start light and build up",
                "week_number": week_number,
                "total_weeks": total_weeks,
                "target_rpe": plan_target_rpe,
            }

        # Group sets by session_id, preserving recency order
        from collections import OrderedDict
        sessions_map: dict = OrderedDict()
        for row in rows:
            sid = row.session_id
            if sid not in sessions_map:
                sessions_map[sid] = []
            sessions_map[sid].append(row)

        session_ids = list(sessions_map.keys())  # most recent first

        def top_set(sets):
            """Heaviest working set in a session."""
            return max(sets, key=lambda r: float(r.weight))

        last_sets = sessions_map[session_ids[0]]
        last_top = top_set(last_sets)
        last_weight = float(last_top.weight)
        last_reps = int(last_top.reps) if last_top.reps else None

        # Average RPE of last session's working sets (ignore missing RPE)
        last_rpes = [float(r.rpe) for r in last_sets if r.rpe is not None]
        avg_rpe = round(sum(last_rpes) / len(last_rpes), 1) if last_rpes else None

        # Previous session top set (for progression detection)
        prev_weight = None
        if len(session_ids) > 1:
            prev_sets = sessions_map[session_ids[1]]
            prev_weight = float(top_set(prev_sets).weight)

        # ── e1RM-based suggestion (when we have plan context) ─────────────
        # Use the best e1RM estimate across recent working sets for robustness.
        if plan_target_rpe is not None and last_reps and last_reps > 0:
            target_reps = plan_target_reps or last_reps

            # Compute e1RM from each working set with RPE data for a better
            # estimate.  When RPE is logged we adjust: the lifter had RIR reps
            # left, so effective_total = reps + RIR.
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
                # Use the median to reduce impact of outlier sets
                e1rm_estimates.sort()
                mid = len(e1rm_estimates) // 2
                e1rm = e1rm_estimates[mid] if len(e1rm_estimates) % 2 else (e1rm_estimates[mid - 1] + e1rm_estimates[mid]) / 2

                suggested = _weight_for_rpe(e1rm, target_reps, plan_target_rpe)
                suggested = _round_to_plate(suggested)

                week_label = f"Week {week_number}/{total_weeks}" if week_number and total_weeks else f"Week {week_number}" if week_number else ""

                # Compare to last session for a human-friendly delta
                diff = suggested - last_weight
                if abs(diff) < 0.1:
                    delta = "same as last session"
                elif diff > 0:
                    delta = f"+{_round_to_plate(diff)} lbs from last"
                else:
                    delta = f"{_round_to_plate(diff)} lbs from last"

                rir = 10.0 - plan_target_rpe
                rpe_str = f"{int(plan_target_rpe)}" if plan_target_rpe == int(plan_target_rpe) else f"{plan_target_rpe}"
                rir_int = int(rir) if rir == int(rir) else round(rir)
                effort_label = f"RPE {rpe_str} ({rir_int} RIR)"

                if week_label:
                    reason = f"{week_label} · {effort_label} · {delta}"
                else:
                    reason = f"{effort_label} · {delta}"
            else:
                # Have plan context but no usable sets — fall through to heuristic
                plan_target_rpe = None

        # ── Heuristic fallback (no plan or no usable e1RM) ────────────────
        if plan_target_rpe is None:
            if avg_rpe is None:
                if prev_weight and last_weight > prev_weight:
                    suggested = last_weight + 2.5
                    reason = f"Beat last session ({prev_weight} → {last_weight} lbs) — keep progressing"
                elif prev_weight and last_weight == prev_weight:
                    suggested = last_weight + 2.5
                    reason = f"Matched last session at {last_weight} lbs — try adding 2.5 lbs"
                else:
                    suggested = last_weight
                    reason = f"Top set: {last_weight} lbs — no RPE logged, hold and track effort"
            elif avg_rpe >= 9.5:
                suggested = round(last_weight * 0.95, 1)
                reason = f"RPE {avg_rpe} — very high effort, back off ~5% to recover quality reps"
            elif avg_rpe >= 9.0:
                suggested = last_weight
                reason = f"RPE {avg_rpe} — hold at {last_weight} lbs and aim for {(last_reps or 0) + 1}+ reps"
            elif avg_rpe >= 8.0:
                suggested = last_weight + 2.5
                reason = f"RPE {avg_rpe} — solid effort, add 2.5 lbs"
            elif avg_rpe >= 7.0:
                suggested = last_weight + 2.5
                reason = f"RPE {avg_rpe} — in the zone, progress +2.5 lbs"
            else:
                suggested = last_weight + 5.0
                reason = f"RPE {avg_rpe} — felt easy, push harder (+5 lbs)"

            suggested = _round_to_plate(suggested)

        response = {
            "previous_weight": round(last_weight, 1),
            "suggested_weight": suggested,
            "average_rpe": avg_rpe,
            "adjustment_reason": reason,
            "week_number": week_number,
            "total_weeks": total_weeks,
            "target_rpe": plan_target_rpe,
            # Legacy fields kept for API compatibility
            "average_weight": round(last_weight, 1),
            "suggestion": reason,
            "percentage": round(suggested / last_weight * 100, 1) if last_weight else 100,
        }

        # Log this suggestion for the user
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
    """
    All-time volume per muscle group, computed directly from ExerciseSet.
    """
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
