'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { ExerciseSuggestion, WeightSuggestion } from '@/types';
import { useState, useEffect } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

export default function SuggestionsPage() {
  const [selectedExercise, setSelectedExercise] = useState('');
  const [userId, setUserId] = useState(DEFAULT_USER_ID);

  useEffect(() => {
    let stored = localStorage.getItem('userId');
    if (!stored || stored === 'default-user') {
      localStorage.setItem('userId', DEFAULT_USER_ID);
      stored = DEFAULT_USER_ID;
    }
    setUserId(stored);
  }, []);

  const { data: exerciseSuggestions, isLoading: loadingExercises } = useQuery({
    queryKey: ['suggestions', 'exercises', userId],
    queryFn: async () => {
      const res = await api.get(`/api/suggestions/exercises?user_id=${userId}`);
      return res.data as ExerciseSuggestion[];
    },
  });

  const { data: muscleGroups } = useQuery({
    queryKey: ['suggestions', 'muscle-groups', userId],
    queryFn: async () => {
      const res = await api.get(`/api/suggestions/muscle-groups?user_id=${userId}`);
      return res.data as Record<string, string>;
    },
  });

  const { data: weightSuggestion, refetch: fetchWeight } = useQuery({
    queryKey: ['suggestions', 'weight', userId, selectedExercise],
    queryFn: async () => {
      if (!selectedExercise) return null;
      const res = await api.get(`/api/suggestions/weight?user_id=${userId}&exercise_id=${selectedExercise}`);
      return res.data as WeightSuggestion;
    },
    enabled: !!selectedExercise,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Suggestions</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exercise Suggestions</CardTitle>
            <CardDescription>Based on your recent volume</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingExercises ? (
              <p>Loading...</p>
            ) : exerciseSuggestions && exerciseSuggestions.length > 0 ? (
              <div className="space-y-3">
                {exerciseSuggestions.map((suggestion, i) => (
                  <div key={`${suggestion.exercise.id}-${i}`} className="p-3 border rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{suggestion.exercise.name}</div>
                        <p className="text-sm text-muted-foreground">
                          {suggestion.exercise.muscle_group}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {suggestion.total_volume.toLocaleString()} lbs
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {suggestion.suggestion_reason}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Complete sessions to get suggestions</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Muscle Group Volume</CardTitle>
            <CardDescription>Volume distribution by muscle group</CardDescription>
          </CardHeader>
          <CardContent>
            {muscleGroups && Object.keys(muscleGroups).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(muscleGroups).map(([group, suggestion]) => (
                  <div key={group} className="flex justify-between items-center p-3 border rounded-lg">
                    <span className="font-medium capitalize">{group}</span>
                    <span className="text-sm text-muted-foreground">{suggestion}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Complete sessions to see volume distribution</p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Weight Suggestions</CardTitle>
            <CardDescription>Get weight recommendations based on your history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Select
                value={selectedExercise}
                onValueChange={(value) => value && setSelectedExercise(value)}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Select an exercise" />
                </SelectTrigger>
                <SelectContent>
                  {exerciseSuggestions?.map((suggestion, i) => (
                    <SelectItem key={`${suggestion.exercise.id}-${i}`} value={suggestion.exercise.id}>
                      {suggestion.exercise.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {weightSuggestion && (
                <div className="p-4 border rounded-lg bg-muted">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Suggested Weight</p>
                      <p className="text-2xl font-bold">{weightSuggestion.suggested_weight} lbs</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Previous Average</p>
                      <p className="text-2xl font-bold">{weightSuggestion.previous_weight} lbs</p>
                    </div>
                  </div>
                  {weightSuggestion.average_rpe && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Average RPE: {weightSuggestion.average_rpe}
                    </p>
                  )}
                  <p className="mt-2">{weightSuggestion.adjustment_reason}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
