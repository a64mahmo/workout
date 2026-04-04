/**
 * Computes ghost placeholder values for pending sets within a single exercise.
 *
 * Ghost values show the "last used" weight/reps in the input placeholder so
 * the user doesn't have to re-type the same numbers.  The seed is derived in
 * this priority order:
 *   1. Last completed non-warmup set (survives after completing a set, because
 *      the edit entry for that set is deleted when it is marked complete)
 *   2. First pending set's template value (e.g. plan pre-fill on a fresh session)
 *
 * As we walk forward through pending sets, any set that has a typed value
 * replaces the running ghost if it is numerically greater.
 */

export interface SetLike {
  id: string;
  is_completed: boolean;
  is_warmup: boolean;
  weight: number;
  reps: number;
}

export interface GhostValues {
  weight?: string;
  reps?: string;
}

/**
 * @param sets         Ordered sets for a single session-exercise.
 * @param editWeightFn Returns the currently typed weight string for a set id,
 *                     or '' / undefined when nothing has been typed yet.
 * @param editRepsFn   Returns the currently typed reps string for a set id,
 *                     or '' / undefined when nothing has been typed yet.
 */
export function computeGhostMap(
  sets: SetLike[],
  editWeightFn: (id: string) => string,
  editRepsFn: (id: string) => string,
): Record<string, GhostValues> {
  const ghostMap: Record<string, GhostValues> = {};

  // Step 1: seed from last completed working set.
  let lastGhostWeight = '';
  let lastGhostReps = '';
  for (const s of sets) {
    if (s.is_completed && !s.is_warmup) {
      if (s.weight > 0) lastGhostWeight = String(s.weight);
      if (s.reps   > 0) lastGhostReps   = String(s.reps);
    }
  }

  // Step 2: fall back to template values on the first pending set.
  if (!lastGhostWeight || !lastGhostReps) {
    const firstPending = sets.find(s => !s.is_completed);
    if (firstPending) {
      if (!lastGhostWeight && firstPending.weight > 0)
        lastGhostWeight = String(firstPending.weight);
      if (!lastGhostReps && firstPending.reps > 0)
        lastGhostReps = String(firstPending.reps);
    }
  }

  // Step 3: walk pending sets in order, propagating / updating the ghost.
  for (const s of sets) {
    if (s.is_completed) continue;
    const editWeight = editWeightFn(s.id);
    const editReps   = editRepsFn(s.id);
    const ghost: GhostValues = {};

    if (editWeight) {
      if (parseFloat(editWeight) > parseFloat(lastGhostWeight || '0'))
        lastGhostWeight = editWeight;
    } else {
      if (lastGhostWeight) ghost.weight = lastGhostWeight;
    }

    if (editReps) {
      if (parseInt(editReps) > parseInt(lastGhostReps || '0'))
        lastGhostReps = editReps;
    } else {
      if (lastGhostReps) ghost.reps = lastGhostReps;
    }

    if (ghost.weight || ghost.reps) ghostMap[s.id] = ghost;
  }

  return ghostMap;
}
