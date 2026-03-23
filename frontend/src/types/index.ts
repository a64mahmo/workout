export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
  description?: string;
  created_at: string;
}

export interface MicroCycle {
  id: string;
  meso_cycle_id: string;
  week_number: number;
  focus: string;
  start_date: string;
  end_date: string;
}

export interface MesoCycle {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  end_date: string;
  goal: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  micro_cycles: MicroCycle[];
}

export interface ExerciseSet {
  id: string;
  session_exercise_id: string;
  set_number: number;
  reps: number;
  weight: number;
  rpe?: number;
  is_warmup: boolean;
  is_completed: boolean;
  created_at: string;
}

export interface SessionExercise {
  id: string;
  session_id: string;
  exercise_id: string;
  order_index: number;
  notes?: string;
  rest_seconds?: number;
  exercise: Exercise;
  sets: ExerciseSet[];
}

export interface TrainingSession {
  id: string;
  user_id: string;
  meso_cycle_id: string;
  micro_cycle_id?: string;
  name: string;
  scheduled_date: string;
  actual_date?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
  total_volume?: number;
  created_at: string;
  updated_at: string;
  exercises: SessionExercise[];
}

export interface VolumeHistory {
  id: string;
  user_id: string;
  exercise_id: string;
  session_id: string;
  total_volume: number;
  calculated_at: string;
}

export interface ExerciseSuggestion {
  exercise: Exercise;
  total_volume: number;
  last_performed?: string;
  suggestion_reason: string;
}

export interface WeightSuggestion {
  exercise_id: string;
  suggested_weight: number;
  previous_weight: number;
  average_rpe?: number;
  adjustment_reason: string;
}

export interface WorkoutPlanExercise {
  id: string;
  plan_session_id: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  target_reps: number;
  target_weight?: number;
  rest_seconds: number;
  notes?: string;
  exercise: Exercise;
}

export interface WorkoutPlanSession {
  id: string;
  plan_id: string;
  name: string;
  order_index: number;
  exercises: WorkoutPlanExercise[];
}

export interface WorkoutPlan {
  id: string;
  user_id: string;
  meso_cycle_id?: string;
  name: string;
  description?: string;
  created_at: string;
  plan_sessions: WorkoutPlanSession[];
}

export interface ExerciseProgressionSuggestion {
  plan_exercise_id: string;
  exercise: Exercise;
  target_sets: number;
  target_reps: number;
  suggested_weight?: number;
  previous_weight?: number;
  suggestion_reason: string;
  rest_seconds: number;
}
