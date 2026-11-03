import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { AnimatedNumber, CountUp } from '@/components/motion/animated-number';
import { AnimatedCheck, Fireworks, PulsingHeart } from '@/components/motion/celebrations';
import { Typewriter } from '@/components/motion/typewriter';

const visible = (c: HTMLElement) => c.querySelector('[aria-hidden]')?.textContent?.replace(/ /g, ' ');

describe('AnimatedNumber', () => {
  it('exposes the plain value for screen readers and text queries', () => {
    render(<AnimatedNumber value="1:30" numeric={90} />);
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('rolls only the changed digits, downward when the value decreases', () => {
    const { container, rerender } = render(<AnimatedNumber value="1:30" numeric={90} />);
    expect(container.querySelectorAll('.num-roll-up, .num-roll-down')).toHaveLength(0);
    rerender(<AnimatedNumber value="1:29" numeric={89} />);
    const rolled = container.querySelectorAll('.num-roll-down');
    expect([...rolled].map((n) => n.textContent)).toEqual(['2', '9']);
    expect(container.querySelectorAll('.num-roll-up')).toHaveLength(0);
    expect(visible(container)).toBe('1:29');
  });

  it('rolls upward when the value increases and keeps the roll across unrelated re-renders', () => {
    const { container, rerender } = render(<AnimatedNumber value="09" numeric={9} />);
    rerender(<AnimatedNumber value="10" numeric={10} />);
    expect(container.querySelectorAll('.num-roll-up')).toHaveLength(2);
    rerender(<AnimatedNumber value="10" numeric={10} />);
    expect(container.querySelectorAll('.num-roll-up')).toHaveLength(2);
  });
});

describe('CountUp', () => {
  it('always exposes the final value', () => {
    render(<CountUp to={12500} format={(n) => Math.round(n).toLocaleString('en-US')} />);
    expect(screen.getByText('12,500')).toBeInTheDocument();
  });
});

describe('Typewriter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('types the text in at ~0.035s per character, full text available immediately', () => {
    const { container } = render(<Typewriter text="add 5 lbs" />);
    expect(screen.getByText('add 5 lbs')).toBeInTheDocument();
    expect(visible(container)).toBe('▍'); // just the caret
    act(() => jest.advanceTimersByTime(35 * 4 + 5));
    expect(visible(container)).toBe('add ▍');
    act(() => jest.advanceTimersByTime(1000));
    expect(visible(container)).toBe('add 5 lbs');
    expect(container.querySelector('.typewriter-cursor')).toBeNull();
  });
});

describe('celebrations', () => {
  it('AnimatedCheck draws and bursts only when asked', () => {
    const { container, rerender } = render(<AnimatedCheck />);
    expect(container.querySelector('.check-spring')).toBeNull();
    rerender(<AnimatedCheck burst />);
    expect(container.querySelector('.check-spring')).not.toBeNull();
    expect(container.querySelectorAll('.check-spark')).toHaveLength(8);
  });

  it('PulsingHeart beats at the given heart rate, clamped', () => {
    const { container, rerender } = render(<PulsingHeart bpm={120}>♥</PulsingHeart>);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--beat')).toBe('0.5s');
    rerender(<PulsingHeart bpm={null}>♥</PulsingHeart>);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--beat')).toBe(`${60 / 70}s`);
  });

  it('Fireworks render deterministically and only while active', () => {
    const a = render(<Fireworks active />);
    const b = render(<Fireworks active />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
    const { container } = render(<Fireworks active={false} />);
    expect(container.innerHTML).toBe('');
  });
});
