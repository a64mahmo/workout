// Port of backend/app/services/progression.py. Uses Python-compatible
// rounding (half-to-even) and float formatting so reasons read identically.
import { pyFloat as f, pyRound } from "./http";

export interface SessionStats {
  volume: number;
  set_count: number;
  top_weight: number;
  top_reps: number | null;
  avg_rpe: number | null;
  max_rpe: number | null;
  date: string | null;
  meso_cycle_id: string | null;
}

export interface ProgressionPhase {
  phase: string;
  label: string;
  target_rpe: number;
  weight_modifier: number | null;
  volume_directive: string;
}

export interface SuggestionResult {
  suggested_weight: number;
  adjustment_reason: string;
  meso_week: number;
  meso_phase: string;
  meso_phase_label: string;
  target_rpe: number;
  suggested_sets: number;
  volume_directive: string;
  estimated_1rm: number | null;
}

const DELOAD_DIRECTIVE = "Drop to ~50% of peak volume and ~65% of peak weight";

export function getPhaseConfig(week: number, totalWeeks: number, maxRpe: number | null = null): ProgressionPhase {
  const position = (week - 1) / Math.max(totalWeeks - 1, 1);

  if (maxRpe !== null && maxRpe >= 9.5) {
    return { phase: "deload", label: "Deload - Reset & recover", target_rpe: 5.5, weight_modifier: 0.65, volume_directive: DELOAD_DIRECTIVE };
  }
  if (week > totalWeeks) {
    return { phase: "deload", label: `Deload (past week ${totalWeeks})`, target_rpe: 5.5, weight_modifier: 0.65, volume_directive: DELOAD_DIRECTIVE };
  }
  if (position < 0.15) {
    return {
      phase: "accumulation",
      label: `Week ${week} - Light start (form & feel)`,
      target_rpe: 7.0,
      weight_modifier: null,
      volume_directive: "Start at MEV (~3-4 working sets), prioritise technique",
    };
  }
  if (position < 0.55) {
    return {
      phase: "accumulation",
      label: `Week ${week} - Accumulate volume`,
      target_rpe: pyRound(7.5 + ((position - 0.15) / 0.4) * 1.0, 1),
      weight_modifier: null,
      volume_directive: "Add 1 set if recovery allows (low soreness/fatigue)",
    };
  }
  if (position < 0.85) {
    return {
      phase: "intensification",
      label: `Week ${week} - Intensify`,
      target_rpe: pyRound(8.5 + ((position - 0.55) / 0.3) * 0.5, 1),
      weight_modifier: null,
      volume_directive: "Approach MRV, maintain or cut 1 set if very sore",
    };
  }
  return {
    phase: "peak",
    label: `Week ${week} - Peak effort`,
    target_rpe: 9.5,
    weight_modifier: null,
    volume_directive: "Final push - hold volume, max intensity, deload follows",
  };
}

export function calculateSuggestion(last: SessionStats, mesoWeek: number, mesoTotalWeeks = 4): SuggestionResult {
  const lastWeight = last.top_weight;
  const { avg_rpe: avgRpe, max_rpe: maxRpe, set_count: setCount } = last;

  const cfg = getPhaseConfig(mesoWeek, mesoTotalWeeks, maxRpe);
  const { phase, target_rpe: targetRpe, volume_directive: volumeDirective } = cfg;

  let suggested: number;
  let parts: string[];

  if (phase === "deload") {
    const modifier = cfg.weight_modifier ?? 0.65;
    suggested = lastWeight * modifier;
    parts = ["DELOAD"];
    if (maxRpe !== null && maxRpe >= 9.5) parts.push(`peak RPE ${f(maxRpe)} reached`);
    parts.push(`reset to ${f(pyRound(suggested, 1))} lbs (${Math.trunc(modifier * 100)}% of ${f(lastWeight)} lbs)`);
    parts.push(`target RPE ${f(targetRpe)}`);
  } else if (avgRpe === null) {
    let bump = pyRound(pyRound((lastWeight * 0.025) / 2.5) * 2.5, 1);
    bump = Math.max(bump, 2.5);
    suggested = lastWeight + bump;
    parts = [
      `Week ${mesoWeek} ${phase}`,
      `target RPE ${f(targetRpe)}`,
      `no RPE logged - add ${f(bump)} lbs (${f(pyRound((bump / lastWeight) * 100, 1))}%) and track effort next session`,
    ];
  } else {
    const rpeDelta = targetRpe - avgRpe;
    const pctChange = Math.max(-0.15, Math.min(0.1, rpeDelta * 0.025));
    suggested = lastWeight * (1 + pctChange);
    suggested = pyRound(pyRound(suggested / 2.5) * 2.5, 1);
    const deltaLbs = pyRound(suggested - lastWeight, 1);

    if (Math.abs(rpeDelta) <= 0.4 || deltaLbs === 0) {
      parts = [`Week ${mesoWeek} ${phase}`, `RPE ${f(avgRpe)} ≈ target ${f(targetRpe)}`, "maintain weight, focus on reps and execution"];
    } else if (deltaLbs > 0) {
      parts = [
        `Week ${mesoWeek} ${phase}`,
        `RPE ${f(avgRpe)} → target ${f(targetRpe)}`,
        `add ${f(deltaLbs)} lbs (+${f(pyRound(Math.abs(pctChange) * 100, 1))}%)`,
      ];
    } else {
      parts = [
        `Week ${mesoWeek} ${phase}`,
        `RPE ${f(avgRpe)} → target ${f(targetRpe)}`,
        `reduce ${f(Math.abs(deltaLbs))} lbs (${f(pyRound(Math.abs(pctChange) * 100, 1))}%)`,
      ];
    }
  }

  if (!(phase !== "deload" && avgRpe !== null)) {
    suggested = pyRound(pyRound(suggested / 2.5) * 2.5, 1);
  }

  // ── Volume autoregulation ──
  let sets: number;
  if (phase === "deload") sets = Math.max(2, Math.floor(setCount / 2));
  else if (avgRpe === null) sets = setCount + 1;
  else if (avgRpe < 7.0) sets = setCount + 2;
  else if (avgRpe < 7.5) sets = setCount + 1;
  else if (avgRpe < 8.5) sets = phase === "accumulation" ? setCount + 1 : setCount;
  else if (avgRpe < 9.0)
    sets = phase === "accumulation" ? setCount + 1 : phase === "intensification" ? Math.max(1, setCount - 1) : setCount;
  else sets = phase === "peak" || phase === "intensification" ? Math.max(1, setCount - 1) : setCount;
  sets = Math.min(sets, 12);

  // Epley e1RM from the top set
  let e1rm: number | null = null;
  if (last.top_weight > 0 && last.top_reps && last.top_reps > 0) {
    if (last.top_reps === 1) e1rm = last.top_weight;
    else {
      let eff = last.top_reps;
      if (maxRpe !== null) eff += 10.0 - maxRpe;
      e1rm = pyRound(last.top_weight * (1 + eff / 30.0), 1);
    }
  }

  return {
    suggested_weight: suggested,
    adjustment_reason: parts.join(" | "),
    meso_week: mesoWeek,
    meso_phase: phase,
    meso_phase_label: cfg.label,
    target_rpe: targetRpe,
    suggested_sets: sets,
    volume_directive: volumeDirective,
    estimated_1rm: e1rm,
  };
}
