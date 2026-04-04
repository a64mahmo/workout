import { cn, formatStatus } from '@/lib/utils';

describe('cn', () => {
  it('joins class names with a space', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('ignores falsy values', () => {
    expect(cn('a', false && 'b', undefined, null as any, 'c')).toBe('a c');
  });

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    // tailwind-merge keeps the last conflicting utility
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('merges non-conflicting Tailwind classes', () => {
    const result = cn('p-2', 'mt-4');
    expect(result).toContain('p-2');
    expect(result).toContain('mt-4');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles array / object syntax via clsx', () => {
    expect(cn(['a', 'b'])).toBe('a b');
    expect(cn({ active: true, hidden: false })).toBe('active');
  });
});

describe('formatStatus', () => {
  it('converts underscores to spaces', () => {
    expect(formatStatus('in_progress')).toBe('In Progress');
  });

  it('capitalises a single word', () => {
    expect(formatStatus('completed')).toBe('Completed');
  });

  it('handles already-capitalised input', () => {
    expect(formatStatus('Scheduled')).toBe('Scheduled');
  });

  it('handles multiple underscores', () => {
    expect(formatStatus('foo_bar_baz')).toBe('Foo Bar Baz');
  });

  it('leaves a plain string unchanged (beyond capitalisation)', () => {
    expect(formatStatus('cancelled')).toBe('Cancelled');
  });
});
