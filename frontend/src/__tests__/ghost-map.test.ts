import { computeGhostMap, SetLike } from '@/lib/ghost-map';

// Helper to build a set with defaults
function makeSet(overrides: Partial<SetLike> & { id: string }): SetLike {
  return {
    is_completed: false,
    is_warmup: false,
    weight: 0,
    reps: 0,
    ...overrides,
  };
}

// No edits typed by user
const noEdit = (_id: string) => '';

describe('computeGhostMap', () => {
  describe('fresh session — no completed sets', () => {
    it('returns empty map when all sets have zero template values', () => {
      const sets = [
        makeSet({ id: 'a', weight: 0, reps: 0 }),
        makeSet({ id: 'b', weight: 0, reps: 0 }),
      ];
      expect(computeGhostMap(sets, noEdit, noEdit)).toEqual({});
    });

    it('propagates first pending set template values to all pending sets including itself', () => {
      const sets = [
        makeSet({ id: 'a', weight: 100, reps: 8 }),
        makeSet({ id: 'b', weight: 0,   reps: 0 }),
        makeSet({ id: 'c', weight: 0,   reps: 0 }),
      ];
      // Template from set a seeds lastGhostWeight/Reps; all pending sets show the ghost
      const result = computeGhostMap(sets, noEdit, noEdit);
      expect(result['a']).toEqual({ weight: '100', reps: '8' });
      expect(result['b']).toEqual({ weight: '100', reps: '8' });
      expect(result['c']).toEqual({ weight: '100', reps: '8' });
    });

    it('only shows ghost for fields where template has a positive value', () => {
      const sets = [
        makeSet({ id: 'a', weight: 100, reps: 0 }),
        makeSet({ id: 'b', weight: 0,   reps: 0 }),
      ];
      const result = computeGhostMap(sets, noEdit, noEdit);
      expect(result['b']).toEqual({ weight: '100' });
      expect(result['b']?.reps).toBeUndefined();
    });
  });

  describe('regression: completing a set must keep ghost for remaining sets', () => {
    it('seeds ghost from last completed working set after set 1 is completed', () => {
      // set 1 was just completed with weight=150, reps=10
      // set 2 and set 3 are pending with template weight/reps=0
      const sets = [
        makeSet({ id: 's1', is_completed: true,  weight: 150, reps: 10 }),
        makeSet({ id: 's2', is_completed: false, weight: 0,   reps: 0  }),
        makeSet({ id: 's3', is_completed: false, weight: 0,   reps: 0  }),
      ];
      const result = computeGhostMap(sets, noEdit, noEdit);
      expect(result['s2']).toEqual({ weight: '150', reps: '10' });
      expect(result['s3']).toEqual({ weight: '150', reps: '10' });
    });

    it('uses last completed set weight, not first, when multiple are done', () => {
      const sets = [
        makeSet({ id: 's1', is_completed: true,  weight: 100, reps: 10 }),
        makeSet({ id: 's2', is_completed: true,  weight: 105, reps: 9  }),
        makeSet({ id: 's3', is_completed: false, weight: 0,   reps: 0  }),
      ];
      const result = computeGhostMap(sets, noEdit, noEdit);
      expect(result['s3']).toEqual({ weight: '105', reps: '9' });
    });
  });

  describe('warmup sets are excluded from ghost seed', () => {
    it('does not use warmup set as ghost source', () => {
      const sets = [
        makeSet({ id: 'w1', is_completed: true,  is_warmup: true,  weight: 60, reps: 12 }),
        makeSet({ id: 's1', is_completed: false, weight: 0, reps: 0 }),
        makeSet({ id: 's2', is_completed: false, weight: 0, reps: 0 }),
      ];
      // warmup contributes nothing; template is also 0 → no ghost
      expect(computeGhostMap(sets, noEdit, noEdit)).toEqual({});
    });

    it('prefers completed working set over warmup', () => {
      const sets = [
        makeSet({ id: 'w1', is_completed: true,  is_warmup: true,  weight: 60, reps: 12 }),
        makeSet({ id: 's1', is_completed: true,  is_warmup: false, weight: 100, reps: 8 }),
        makeSet({ id: 's2', is_completed: false, weight: 0, reps: 0 }),
      ];
      const result = computeGhostMap(sets, noEdit, noEdit);
      expect(result['s2']).toEqual({ weight: '100', reps: '8' });
    });
  });

  describe('user-typed values update the running ghost', () => {
    it('typed value higher than ghost becomes the new ghost for next sets', () => {
      const sets = [
        makeSet({ id: 's1', is_completed: true,  weight: 100, reps: 8 }),
        makeSet({ id: 's2', is_completed: false, weight: 0,   reps: 0 }),
        makeSet({ id: 's3', is_completed: false, weight: 0,   reps: 0 }),
      ];
      // user has typed 110 for s2 (not yet completed)
      const editWeight = (id: string) => (id === 's2' ? '110' : '');
      const editReps   = (id: string) => (id === 's2' ? '7'   : '');
      const result = computeGhostMap(sets, editWeight, editReps);
      // s2 has a typed value → no ghost assigned to it
      expect(result['s2']).toBeUndefined();
      // s3 should see the updated ghost from s2's typed value
      expect(result['s3']).toEqual({ weight: '110', reps: '8' }); // reps: 8 > 7, keeps 8
    });

    it('typed reps updates ghost reps independently', () => {
      const sets = [
        makeSet({ id: 's1', is_completed: true,  weight: 100, reps: 8 }),
        makeSet({ id: 's2', is_completed: false, weight: 0,   reps: 0 }),
        makeSet({ id: 's3', is_completed: false, weight: 0,   reps: 0 }),
      ];
      const editWeight = (_id: string) => '';
      const editReps   = (id: string)  => (id === 's2' ? '10' : '');
      const result = computeGhostMap(sets, editWeight, editReps);
      expect(result['s2']).toEqual({ weight: '100' }); // reps has typed value, no reps ghost
      expect(result['s3']).toEqual({ weight: '100', reps: '10' }); // reps ghost updated to 10
    });
  });

  describe('completed set with zero values is ignored', () => {
    it('does not overwrite a previous ghost with zeros from a completed set', () => {
      // This can happen with bodyweight exercises where weight=0
      const sets = [
        makeSet({ id: 's1', is_completed: true,  weight: 0, reps: 10 }),
        makeSet({ id: 's2', is_completed: false, weight: 0, reps: 0  }),
      ];
      const result = computeGhostMap(sets, noEdit, noEdit);
      // weight is 0 → no weight ghost; reps=10 → reps ghost
      expect(result['s2']).toEqual({ reps: '10' });
      expect(result['s2']?.weight).toBeUndefined();
    });
  });
});
