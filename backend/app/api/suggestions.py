from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel
from ..database import async_session
from ..models import Exercise, TrainingSession, SessionExercise, ExerciseSet, SuggestionLog
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


@router.get("/weight")
async def suggest_weight(
    user_id: str = Depends(get_current_user_id),
    exercise_id: str = Query(...),
    meso_cycle_id: str = Query(None),
):
    """
    RP-style weight suggestion:
    - Reference point: top set (max weight) of the most recent completed session for this exercise,
      within the same meso cycle if provided (avoids data pollution from different programs).
    - Progression: compares last session's top set against the prior session's top set to detect
      whether the lifter is improving, stalling, or regressing.
    - RPE awareness: uses average RPE of last session's working sets. Thresholds are calibrated
      for hypertrophy (RPE 7-8 = normal, RPE 9+ = high, RPE 10 = max effort / consider deload).
    - Rep-aware: reports reps at the top set and adjusts suggestion messaging accordingly.
    - Meso-aware: restricts history to the current meso cycle when provided.
    """
    async with async_session() as session:
        # Build base query — fetch all working sets for this exercise, most recent sessions first.
        # Restrict to current meso cycle if provided to avoid data pollution.
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
            }

        # Group sets by session_id, preserving recency order
        from collections import defaultdict, OrderedDict
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

        # ── Suggestion logic ─────────────────────────────────────────────────
        # RPE thresholds calibrated for hypertrophy:
        #   < 7  (>3 RIR) — too easy, push harder next session
        #   7–8  (2-3 RIR) — optimal hypertrophy range, progress normally
        #   8–9  (1-2 RIR) — high effort, small increment or hold
        #   9–10 (0-1 RIR) — very high, hold weight and focus on reps/form
        #   10   (0 RIR)  — consider a small deload next session

        if avg_rpe is None:
            # No RPE data: fall back to simple session-over-session progression
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
            # Near/at failure — small deload to recover, don't hammer RPE 10 every session
            suggested = round(last_weight * 0.95, 1)
            reason = f"RPE {avg_rpe} — very high effort, back off ~5% to recover quality reps"
        elif avg_rpe >= 9.0:
            # Hard but manageable — hold weight, aim for more reps
            suggested = last_weight
            reason = f"RPE {avg_rpe} — hold at {last_weight} lbs and aim for {(last_reps or 0) + 1}+ reps"
        elif avg_rpe >= 8.0:
            # Normal late-meso intensity — small increment
            suggested = last_weight + 2.5
            reason = f"RPE {avg_rpe} — solid effort, add 2.5 lbs"
        elif avg_rpe >= 7.0:
            # Optimal range — standard progression
            suggested = last_weight + 2.5
            reason = f"RPE {avg_rpe} — in the zone, progress +2.5 lbs"
        else:
            # Too easy — bigger jump
            suggested = last_weight + 5.0
            reason = f"RPE {avg_rpe} — felt easy, push harder (+5 lbs)"

        # Round to nearest 2.5 for practical plate loading
        suggested = round(round(suggested / 2.5) * 2.5, 1)

        response = {
            "previous_weight": round(last_weight, 1),
            "suggested_weight": suggested,
            "average_rpe": avg_rpe,
            "adjustment_reason": reason,
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
