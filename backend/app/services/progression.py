from typing import List, Optional, Dict, Any
from datetime import date as date_type
from pydantic import BaseModel

class SessionStats(BaseModel):
    volume: float
    set_count: int
    top_weight: float
    top_reps: Optional[int] = None
    avg_rpe: Optional[float] = None
    max_rpe: Optional[float] = None
    date: Optional[str] = None
    meso_cycle_id: Optional[str] = None

class ProgressionPhase(BaseModel):
    phase: str
    label: str
    target_rpe: float
    weight_modifier: Optional[float] = None
    volume_directive: str

class SuggestionResult(BaseModel):
    suggested_weight: float
    adjustment_reason: str
    meso_week: int
    meso_phase: str
    meso_phase_label: str
    target_rpe: float
    suggested_sets: int
    volume_directive: str

class ProgressionService:
    @staticmethod
    def get_phase_config(week: int, total_weeks: int, just_hit_peak: bool) -> ProgressionPhase:
        """
        Returns RP phase config based on meso week position.
        Arc: accumulation (W1) → intensification (W2-3) → peak (W4) → deload
        Scales to any meso length by using fractional position.
        """
        if just_hit_peak:
            return ProgressionPhase(
                phase="deload",
                label="Deload - Reset & recover",
                target_rpe=5.5,
                weight_modifier=0.65,
                volume_directive="Drop to ~50% of peak volume and ~65% of peak weight",
            )

        # Fractional position in meso: 0.0 = start, 1.0 = end
        position = (week - 1) / max(total_weeks - 1, 1)

        if week > total_weeks:
            return ProgressionPhase(
                phase="deload",
                label=f"Deload (past week {total_weeks})",
                target_rpe=5.5,
                weight_modifier=0.65,
                volume_directive="Drop to ~50% of peak volume and ~65% of peak weight",
            )
        elif position < 0.15:
            return ProgressionPhase(
                phase="accumulation",
                label=f"Week {week} - Light start (form & feel)",
                target_rpe=7.0,
                volume_directive="Start at MEV (~3-4 working sets), prioritise technique",
            )
        elif position < 0.55:
            # Scale target RPE from 7.5 → 8.5 through accumulation
            target = round(7.5 + (position - 0.15) / 0.40 * 1.0, 1)
            return ProgressionPhase(
                phase="accumulation",
                label=f"Week {week} - Accumulate volume",
                target_rpe=target,
                volume_directive="Add 1 set if recovery allows (low soreness/fatigue)",
            )
        elif position < 0.85:
            target = round(8.5 + (position - 0.55) / 0.30 * 0.5, 1)
            return ProgressionPhase(
                phase="intensification",
                label=f"Week {week} - Intensify",
                target_rpe=target,
                volume_directive="Approach MRV, maintain or cut 1 set if very sore",
            )
        else:
            return ProgressionPhase(
                phase="peak",
                label=f"Week {week} - Peak effort",
                target_rpe=9.5,
                volume_directive="Final push - hold volume, max intensity, deload follows",
            )

    @classmethod
    def calculate_suggestion(
        cls, 
        last_stats: SessionStats, 
        meso_week: int, 
        meso_total_weeks: int = 4
    ) -> SuggestionResult:
        """
        Calculates the next weight and set suggestion based on session history.
        """
        last_weight = last_stats.top_weight
        avg_rpe = last_stats.avg_rpe
        max_rpe = last_stats.max_rpe
        set_count = last_stats.set_count

        just_hit_peak = max_rpe is not None and max_rpe >= 9.5
        phase_cfg = cls.get_phase_config(meso_week, meso_total_weeks, just_hit_peak)
        
        phase = phase_cfg.phase
        target_rpe = phase_cfg.target_rpe
        volume_directive = phase_cfg.volume_directive

        # ── Weight suggestion ─────────────────────────────────────────────────
        if phase == "deload":
            modifier = phase_cfg.weight_modifier or 0.65
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
            # Round to 2.5
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

        if phase != "deload" and avg_rpe is not None:
            pass  # already rounded above
        else:
            suggested = round(round(suggested / 2.5) * 2.5, 1)
        
        reason = " | ".join(parts)

        # ── Volume autoregulation ─────────────────────────────────────────────
        if phase == "deload":
            suggested_sets = max(2, set_count // 2)
        elif avg_rpe is None:
            suggested_sets = set_count + 1
        elif avg_rpe < 7.0:
            suggested_sets = set_count + 2
        elif avg_rpe < 7.5:
            suggested_sets = set_count + 1
        elif avg_rpe < 9.0:
            suggested_sets = set_count + 1 if phase == "accumulation" else set_count
        else:
            suggested_sets = max(1, set_count - 1) if phase == "peak" else set_count

        suggested_sets = min(suggested_sets, 12)

        return SuggestionResult(
            suggested_weight=suggested,
            adjustment_reason=reason,
            meso_week=meso_week,
            meso_phase=phase,
            meso_phase_label=phase_cfg.label,
            target_rpe=target_rpe,
            suggested_sets=suggested_sets,
            volume_directive=volume_directive
        )
