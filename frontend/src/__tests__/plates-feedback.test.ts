import { groupPlates, platesFor } from '@/lib/plates';
import { applyFeedback, isValidFeedback } from '@/lib/feedback';

describe('platesFor', () => {
  it('loads common barbell weights exactly', () => {
    expect(platesFor(135).perSide).toEqual([45]);
    expect(platesFor(225).perSide).toEqual([45, 45]);
    expect(platesFor(230).perSide).toEqual([45, 45, 2.5]);
    expect(platesFor(185).perSide).toEqual([45, 25]);
    expect(platesFor(315).remainder).toBe(0);
  });

  it('reports the closest loadable weight when it cannot be exact', () => {
    const load = platesFor(227);
    expect(load.loaded).toBe(225);
    expect(load.remainder).toBe(2);
  });

  it('handles the empty bar and other bars', () => {
    expect(platesFor(45).barOnly).toBe(true);
    expect(platesFor(30).barOnly).toBe(true);
    expect(platesFor(65, 35).perSide).toEqual([10, 5]);
  });

  it('groups plates for display', () => {
    expect(groupPlates([45, 45, 10, 2.5])).toEqual([
      { plate: 45, count: 2 },
      { plate: 10, count: 1 },
      { plate: 2.5, count: 1 },
    ]);
  });
});

describe('applyFeedback (RP-style)', () => {
  const base = { suggested_weight: 235, suggested_sets: 4, adjustment_reason: 'Week 3 | add 10 lbs', meso_phase: 'accumulation' };

  it('easy with low pump adds a set', () => {
    const { suggestion, note } = applyFeedback(base, { pump: 0, workload: 0, joints: 0 }, 225);
    expect(suggestion.suggested_sets).toBe(5);
    expect(suggestion.suggested_weight).toBe(235);
    expect(note).toContain('+1 set');
    expect(suggestion.adjustment_reason.split(' | ').pop()).toBe(note);
  });

  it('too much removes a set and holds the load', () => {
    const { suggestion } = applyFeedback(base, { pump: 2, workload: 3, joints: 0 }, 225);
    expect(suggestion.suggested_sets).toBe(3);
    expect(suggestion.suggested_weight).toBe(225);
  });

  it('joint discomfort holds the load without cutting sets; a lot of pain cuts a set too', () => {
    expect(applyFeedback(base, { pump: 1, workload: 1, joints: 1 }, 225).suggestion).toMatchObject({ suggested_sets: 4, suggested_weight: 225 });
    expect(applyFeedback(base, { pump: 1, workload: 1, joints: 2 }, 225).suggestion).toMatchObject({ suggested_sets: 3, suggested_weight: 225 });
  });

  it('good stimulus changes nothing, and deloads never add sets', () => {
    expect(applyFeedback(base, { pump: 2, workload: 2, joints: 0 }, 225).note).toBeNull();
    expect(applyFeedback({ ...base, meso_phase: 'deload' }, { pump: 0, workload: 0, joints: 0 }, 225).note).toBeNull();
  });

  it('validates feedback shape', () => {
    expect(isValidFeedback({ pump: 2, workload: 3, joints: 2 })).toBe(true);
    expect(isValidFeedback({ pump: 3, workload: 0, joints: 0 })).toBe(false);
    expect(isValidFeedback({ pump: 1, workload: 1 })).toBe(false);
    expect(isValidFeedback(null)).toBe(false);
  });
});
