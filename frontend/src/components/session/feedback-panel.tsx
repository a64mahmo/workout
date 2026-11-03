'use client';

import { useState } from 'react';
import { FEEDBACK_QUESTIONS, type ExerciseFeedback } from '@/lib/feedback';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

/**
 * RP-style check-in after an exercise's last set. Three taps; the answers
 * adjust next session's set count and load for this exercise.
 */
export function FeedbackPanel({
  exerciseName,
  onSave,
  onSkip,
  saving,
}: {
  exerciseName: string;
  onSave: (fb: ExerciseFeedback) => void;
  onSkip: () => void;
  saving?: boolean;
}) {
  const [answers, setAnswers] = useState<Partial<ExerciseFeedback>>({});
  const complete = FEEDBACK_QUESTIONS.every((q) => answers[q.key] !== undefined);

  return (
    <div className="mx-3 my-3 rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-3 stagger-in" role="group" aria-label={`How did ${exerciseName} feel?`}>
      <div>
        <p className="text-sm font-semibold">How did that feel?</p>
        <p className="text-xs text-muted-foreground">Next session&apos;s sets and load adjust to your answers.</p>
      </div>
      {FEEDBACK_QUESTIONS.map((q) => (
        <div key={q.key} className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{q.label}</p>
          <div className="flex gap-1.5" role="radiogroup" aria-label={q.label}>
            {q.options.map((label, value) => {
              const selected = answers[q.key] === value;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    haptic.selection();
                    setAnswers((a) => ({ ...a, [q.key]: value }));
                  }}
                  className={cn(
                    'flex-1 min-w-0 h-9 rounded-lg border text-xs font-medium press-spring px-1 truncate',
                    selected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background/80 border-border text-foreground hover:bg-muted',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onSkip} className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground">
          Skip
        </button>
        <button
          type="button"
          disabled={!complete || saving}
          onClick={() => complete && onSave(answers as ExerciseFeedback)}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 press-spring"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
